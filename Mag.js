// Magma Xtream - GrayJay source para servidores Xtream Codes (player_api.php)
// Mejorado: HTTPS preferido, URLs directas de live, extracción de URL de VOD, posters TMDB
const PLATFORM = "MagmaXtream";
const BASE = "https://tv.m3uts.xyz";
const BASE_ALT = "http://tv.m3uts.xyz";
const USER = "m";
const PASS = "m";
const UA = "Magma Player/10";
const HEADERS = { "User-Agent": UA, "X-Version": "10/1.0.9" };
const PAGE = 30;
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

let _base = BASE;
let _log = [];
let _liveCache = null;
let _liveCacheTime = 0;

function dbg(s) { _log.push(String(s)); log("[MagmaXtream] " + s); }

// ---------- HTTP ----------
function api(action, extra) {
  let q = "player_api.php?username=" + USER + "&password=" + PASS + (action ? "&action=" + action : "") + (extra || "");
  const bases = _base === BASE ? [BASE, BASE_ALT] : [BASE_ALT, BASE];
  let lastErr = null;
  for (const b of bases) {
    try {
      const r = http.GET(b + "/" + q, HEADERS, false);
      if (!r.isOk) { dbg(action + " " + b + " -> HTTP " + r.code); continue; }
      _base = b;
      const j = JSON.parse(r.body);
      return j;
    } catch (e) { lastErr = e; dbg(action + " " + b + " error: " + e); }
  }
  throw new ScriptException("Magma Xtream: sin respuesta del servidor. " + (lastErr || "") + " | " + _log.slice(-4).join(" ; "));
}
function asList(x) { return Array.isArray(x) ? x : (x && typeof x === "object" ? Object.values(x) : []); }

// ---------- helpers ----------
function author() {
  return new PlatformAuthorLink(new PlatformID(PLATFORM, "magma", config.id), "Magma", "", "");
}
function fullThumb(u) {
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  // Paths relativos de VOD son de TMDB
  if (u.startsWith("/")) return TMDB_IMG + u;
  return TMDB_IMG + "/" + u;
}
function thumbs(u) { return new Thumbnails(u ? [new Thumbnail(u, 0)] : []); }
function now() { return Math.floor(Date.now() / 1000); }

function getLiveStreamsCached() {
  const nowMs = Date.now();
  if (_liveCache && (nowMs - _liveCacheTime) < 120000) return _liveCache;
  _liveCache = safe("get_live_streams");
  _liveCacheTime = nowMs;
  return _liveCache;
}

function liveItem(s) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "live" + s.stream_id, config.id),
    name: s.name || ("Canal " + s.stream_id),
    thumbnails: thumbs(fullThumb(s.stream_icon)),
    author: author(),
    uploadDate: now(),
    url: "xt://live/" + s.stream_id,
    duration: 0,
    viewCount: 0,
    isLive: true
  });
}
function movieItem(s) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "mov" + s.stream_id, config.id),
    name: s.name || ("Película " + s.stream_id),
    thumbnails: thumbs(fullThumb(s.stream_icon)),
    author: author(),
    uploadDate: parseInt(s.added || s.release) || now(),
    url: "xt://movie/" + s.stream_id + "." + (s.container_extension || "mp4"),
    duration: 0,
    viewCount: 0,
    isLive: false
  });
}
function seriesItem(s) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "ser" + s.series_id, config.id),
    name: "📺 " + (s.name || ("Serie " + s.series_id)),
    thumbnails: thumbs(fullThumb(s.cover)),
    author: author(),
    uploadDate: parseInt(s.last_modified) || now(),
    url: "xt://series/" + s.series_id,
    duration: 0,
    viewCount: 0,
    isLive: false
  });
}

class ListPager extends VideoPager {
  constructor(all, pos) {
    const slice = all.slice(pos, pos + PAGE);
    super(slice, pos + PAGE < all.length);
    this._all = all; this._pos = pos;
  }
  nextPage() { return new ListPager(this._all, this._pos + PAGE); }
}

function safe(action, extra) { try { return asList(api(action, extra)); } catch (e) { dbg("safe " + action + ": " + e); return []; } }

// ---------- source ----------
source.enable = function (conf) { _log = []; _liveCache = null; };
source.getHome = function () {
  const items = [];
  const live = getLiveStreamsCached();
  const vod = safe("get_vod_streams");
  const ser = safe("get_series");
  dbg("home live=" + live.length + " vod=" + vod.length + " series=" + ser.length);
  vod.slice(0, 200).forEach(s => items.push(movieItem(s)));
  ser.slice(0, 200).forEach(s => items.push(seriesItem(s)));
  live.forEach(s => items.push(liveItem(s)));
  if (!items.length) {
    items.push(new PlatformVideo({
      id: new PlatformID(PLATFORM, "diag", config.id), name: "⚠️ Sin datos: " + _log.slice(-3).join(" | "),
      thumbnails: thumbs(""), author: author(), uploadDate: now(), url: "xt://diag", duration: 0, viewCount: 0, isLive: false
    }));
  }
  return new ListPager(items, 0);
};
source.searchSuggestions = function () { return []; };
source.getSearchCapabilities = function () { return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] }; };
source.search = function (query) {
  const q = (query || "").toLowerCase();
  const out = [];
  const m = s => (s.name || "").toLowerCase().indexOf(q) >= 0;
  getLiveStreamsCached().filter(m).forEach(s => out.push(liveItem(s)));
  safe("get_vod_streams").filter(m).forEach(s => out.push(movieItem(s)));
  safe("get_series").filter(m).forEach(s => out.push(seriesItem(s)));
  return new ListPager(out, 0);
};
source.getSearchChannelContents = function () { return new ListPager([], 0); };

// ---------- detalle ----------
source.isContentDetailsUrl = function (url) { return typeof url === "string" && url.indexOf("xt://") === 0; };

function hlsOrFile(url, name) {
  if (!url) return null;
  if (/\.m3u8(\?|$)/i.test(url)) return new HLSSource({ name: name, url: url, duration: 0, priority: true });
  return new VideoUrlSource({ name: name, url: url, container: "video/mp4", width: 0, height: 0, duration: 0, codec: "", bitrate: 0 });
}

function extractStreamUrl(obj) {
  if (!obj || typeof obj !== "object") return null;
  const candidates = [
    obj.url, obj.stream_url, obj.direct_source, obj.stream,
    obj.movie_data && obj.movie_data.url,
    obj.movie_data && obj.movie_data.stream_url,
    obj.movie_data && obj.movie_data.direct_source,
    obj.info && obj.info.url,
    obj.info && obj.info.stream_url,
    obj.info && obj.info.direct_source
  ];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

source.getContentDetails = function (url) {
  const m = url.match(/^xt:\/\/(live|movie|series|episode)\/(.+)$/);
  if (!m) throw new ScriptException("URL no soportada: " + url);
  const kind = m[1], id = m[2];
  const base = {
    id: new PlatformID(PLATFORM, kind + id, config.id),
    author: author(),
    uploadDate: now(),
    url: url,
    viewCount: 0,
    rating: new RatingLikes(0),
    isLive: kind === "live",
    shareUrl: url,
    subtitles: []
  };

  if (kind === "live") {
    let streamUrl = null;
    let name = "Canal " + id;
    let icon = "";
    try {
      const streams = getLiveStreamsCached();
      const found = streams.find(s => String(s.stream_id) === String(id));
      if (found) {
        name = found.name || name;
        icon = fullThumb(found.stream_icon);
        streamUrl = found.url || found.direct_source || null;
      }
    } catch (e) { dbg("live lookup: " + e); }

    const sources = [];
    if (streamUrl) {
      const s = hlsOrFile(streamUrl, "Directo");
      if (s) sources.push(s);
    }
    if (!sources.length) {
      const u = _base + "/live/" + USER + "/" + PASS + "/" + id;
      sources.push(hlsOrFile(u + ".m3u8", "HLS"));
      sources.push(hlsOrFile(u + ".ts", "TS"));
    }

    return new PlatformVideoDetails(Object.assign(base, {
      name: name,
      thumbnails: thumbs(icon),
      description: "",
      duration: 0,
      video: new VideoSourceDescriptor(sources.filter(Boolean))
    }));
  }

  if (kind === "movie") {
    const vid = id.split(".")[0];
    let name = "Película " + vid, desc = "", img = "", streamUrl = null;

    try {
      const info = api("get_vod_info", "&vod_id=" + vid);
      streamUrl = extractStreamUrl(info);
      if (info && info.info) {
        name = (info.movie_data && info.movie_data.name) || name;
        desc = info.info.plot || info.info.description || "";
        img = fullThumb(info.info.movie_image || info.info.cover || "");
      }
      if (info && info.movie_data) {
        name = info.movie_data.name || name;
      }
    } catch (e) { dbg("vod_info " + e); }

    const sources = [];
    if (streamUrl) {
      const s = hlsOrFile(streamUrl, "Directo");
      if (s) sources.push(s);
    }
    if (!sources.length) {
      // Fallback a rutas comunes (pueden no funcionar en este servidor)
      const ext = id.includes(".") ? id.split(".").pop() : "mp4";
      const u = _base + "/movie/" + USER + "/" + PASS + "/" + vid + "." + ext;
      sources.push(hlsOrFile(u, "Directo"));
    }

    return new PlatformVideoDetails(Object.assign(base, {
      name: name,
      thumbnails: thumbs(img),
      description: desc,
      duration: 0,
      video: new VideoSourceDescriptor(sources.filter(Boolean))
    }));
  }

  if (kind === "episode") {
    const u = _base + "/series/" + USER + "/" + PASS + "/" + id;
    return new PlatformVideoDetails(Object.assign(base, {
      name: "Episodio " + id.split(".")[0],
      thumbnails: thumbs(""),
      description: "",
      duration: 0,
      video: new VideoSourceDescriptor([hlsOrFile(u, "Directo")].filter(Boolean))
    }));
  }

  // series
  const info = api("get_series_info", "&series_id=" + id);
  const eps = flattenEpisodes(info);
  if (!eps.length) throw new ScriptException("Serie sin episodios");
  const first = eps[0];
  const u = _base + "/series/" + USER + "/" + PASS + "/" + first.id + "." + first.ext;
  const si = info.info || {};
  return new PlatformVideoDetails(Object.assign(base, {
    name: (si.name || "Serie " + id) + " - " + first.label,
    thumbnails: thumbs(fullThumb(si.cover)),
    description: si.plot || "",
    duration: 0,
    video: new VideoSourceDescriptor([hlsOrFile(u, "Directo")].filter(Boolean))
  }));
};

function flattenEpisodes(info) {
  const out = [];
  const eps = info && info.episodes;
  if (!eps) return out;
  const seasons = Array.isArray(eps) ? eps : Object.keys(eps).sort((a, b) => a - b).map(k => eps[k]);
  seasons.forEach(list => asList(list).forEach(e => {
    out.push({
      id: e.id,
      ext: e.container_extension || "mp4",
      label: "T" + (e.season || "?") + "E" + (e.episode_num || "?") + (e.title ? " " + e.title : ""),
      img: e.info && e.info.movie_image
    });
  }));
  return out;
}

source.getContentRecommendations = function (url) {
  const m = url.match(/^xt:\/\/series\/(.+)$/);
  if (!m) return new ListPager([], 0);
  try {
    const eps = flattenEpisodes(api("get_series_info", "&series_id=" + m[1])).slice(1);
    return new ListPager(eps.map(e => new PlatformVideo({
      id: new PlatformID(PLATFORM, "ep" + e.id, config.id),
      name: e.label,
      thumbnails: thumbs(fullThumb(e.img)),
      author: author(),
      uploadDate: now(),
      url: "xt://episode/" + e.id + "." + e.ext,
      duration: 0,
      viewCount: 0,
      isLive: false
    })), 0);
  } catch (e) { dbg("recs " + e); return new ListPager([], 0); }
};
log("MagmaXtream cargado (mejorado)");
