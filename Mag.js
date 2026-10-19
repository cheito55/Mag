// Magma Xtream + PlayPelis hybrid - GrayJay source
// Usa plpro.org para películas/series (con extractores) y mantiene live de m3uts
const PLATFORM = "MagmaXtream";
const PID = "5c0e7d3a-9b41-4e2f-8a67-1d3f6b2c9e55";

// Live (m3uts)
const LIVE_BASE = "https://tv.m3uts.xyz";
const LIVE_USER = "m";
const LIVE_PASS = "m";

// VOD / Series (plpro - funciona con links reales)
const VOD_BASE = "https://plpro.org";
const VOD_USER = "p";
const VOD_PASS = "p";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const HEADERS_LIVE = { "User-Agent": "Magma Player/10", "X-Version": "10/1.0.9" };
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const PAGE = 30;

let _config = null;
let _log = [];
let _liveCache = null;
let _liveCacheTime = 0;

function dbg(s) { _log.push(String(s)); log("[Mag] " + s); }

// ---------- Helpers ----------
function author() {
  return new PlatformAuthorLink(new PlatformID(PLATFORM, "magma", _config ? _config.id : PID), "Magma", "", "");
}
function fullThumb(u) {
  if (!u) return "";
  var s = String(u).trim();
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("ttps://")) {
    if (s.startsWith("ttps://")) s = "https" + s.substring(4);
    return s;
  }
  s = s.replace(/^\/+/, "");
  if (!s) return "";
  if (!/\.(jpg|png|webp)$/i.test(s)) s += ".jpg";
  return TMDB_IMG + "/" + s;
}
function thumbs(u) { return new Thumbnails(u ? [new Thumbnail(u, 0)] : []); }
function now() { return Math.floor(Date.now() / 1000); }

function httpGet(url, headers) {
  try {
    var h = headers || {};
    if (!h["User-Agent"] && !h["user-agent"]) h["User-Agent"] = UA;
    var r = http.GET(url, h);
    return (r && r.body) ? r.body : "";
  } catch (e) {
    dbg("HTTP error " + url + ": " + e);
    return "";
  }
}

// ---------- Live API (m3uts) ----------
function liveApi(action, extra) {
  var q = "player_api.php?username=" + LIVE_USER + "&password=" + LIVE_PASS + (action ? "&action=" + action : "") + (extra || "");
  var bases = [LIVE_BASE, "http://tv.m3uts.xyz"];
  for (var i = 0; i < bases.length; i++) {
    try {
      var r = http.GET(bases[i] + "/" + q, HEADERS_LIVE, false);
      if (r && r.isOk) return JSON.parse(r.body);
    } catch (e) {}
  }
  return null;
}
function asList(x) { return Array.isArray(x) ? x : (x && typeof x === "object" ? Object.values(x) : []); }
function safeLive(action, extra) { try { return asList(liveApi(action, extra)); } catch (e) { return []; } }

function getLiveStreamsCached() {
  var nowMs = Date.now();
  if (_liveCache && (nowMs - _liveCacheTime) < 120000) return _liveCache;
  _liveCache = safeLive("get_live_streams");
  _liveCacheTime = nowMs;
  return _liveCache;
}

// ---------- VOD API (plpro) ----------
function vodGet(path) {
  var sep = path.indexOf("?") !== -1 ? "&" : "?";
  var url = VOD_BASE + path + sep + "username=" + VOD_USER + "&password=" + VOD_PASS;
  try {
    var r = http.GET(url, { "User-Agent": "PLPro/8" });
    if (r && r.body) return JSON.parse(r.body);
  } catch (e) { dbg("vodGet " + path + ": " + e); }
  return null;
}

// ---------- Extractors (from PlPro.js, simplified) ----------
function cleanUrl(url) {
  if (!url) return "";
  var s = String(url).trim();
  s = s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  return s;
}
function isM3u8(url) { return url && /\.m3u8(\?|$)/i.test(url); }

function extractFromEmbed(pageUrl) {
  if (!pageUrl) return null;
  pageUrl = cleanUrl(pageUrl);
  if (isM3u8(pageUrl)) return pageUrl;

  var host = "";
  try { host = pageUrl.match(/^https?:\/\/([^\/]+)/i)[1].toLowerCase(); } catch (e) {}

  var html = httpGet(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
  if (!html || html.length < 200) return null;

  // Generic m3u8 search
  var m = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
  if (m) return cleanUrl(m[0]);

  m = html.match(/(?:file|source|hls)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i);
  if (m && m[1]) return cleanUrl(m[1]);

  // atob patterns (voe etc.)
  var am = html.match(/atob\(['"]([^'"]+)['"]\)/);
  if (am) {
    try {
      var decoded = atob(am[1]);
      var u = decoded.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
      if (u) return cleanUrl(u[0]);
    } catch (e) {}
  }

  return null;
}

function hlsOrFile(url, name) {
  if (!url) return null;
  if (isM3u8(url)) return new HLSSource({ name: name || "HLS", url: url, duration: 0, priority: true });
  return new VideoUrlSource({ name: name || "Directo", url: url, container: "video/mp4", width: 0, height: 0, duration: 0 });
}

// ---------- Items ----------
function liveItem(s) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "live" + s.stream_id, _config ? _config.id : PID),
    name: s.name || ("Canal " + s.stream_id),
    thumbnails: thumbs(fullThumb(s.stream_icon)),
    author: author(),
    uploadDate: now(),
    url: "xt://live/" + s.stream_id,
    duration: 0, viewCount: 0, isLive: true
  });
}
function movieItem(m) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "mov" + m.a, _config ? _config.id : PID),
    name: m.b || ("Película " + m.a),
    thumbnails: thumbs(fullThumb(m.d || m.c)),
    author: author(),
    uploadDate: now(),
    url: "pp://movie/" + m.a,
    duration: 0, viewCount: 0, isLive: false
  });
}
function seriesItem(s) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, "ser" + s.a, _config ? _config.id : PID),
    name: "📺 " + (s.b || ("Serie " + s.a)),
    thumbnails: thumbs(fullThumb(s.d || s.c)),
    author: author(),
    uploadDate: now(),
    url: "pp://serie/" + s.a,
    duration: 0, viewCount: 0, isLive: false
  });
}

class ListPager extends VideoPager {
  constructor(all, pos) {
    var slice = all.slice(pos, pos + PAGE);
    super(slice, pos + PAGE < all.length);
    this._all = all; this._pos = pos;
  }
  nextPage() { return new ListPager(this._all, this._pos + PAGE); }
}

// ---------- Source ----------
source.enable = function (conf) { _config = conf; _log = []; _liveCache = null; };

source.getHome = function () {
  var items = [];
  // VOD from plpro
  try {
    var vod = vodGet("/movies/resume");
    if (vod && vod.movies) {
      for (var i = 0; i < Math.min(vod.movies.length, 80); i++) items.push(movieItem(vod.movies[i]));
    }
  } catch (e) { dbg("home vod: " + e); }
  // Series from plpro
  try {
    var ser = vodGet("/series");
    if (ser && ser.series) {
      for (var j = 0; j < Math.min(ser.series.length, 40); j++) items.push(seriesItem(ser.series[j]));
    }
  } catch (e) { dbg("home series: " + e); }
  // Live from m3uts
  var live = getLiveStreamsCached();
  for (var k = 0; k < live.length; k++) items.push(liveItem(live[k]));

  if (!items.length) {
    items.push(new PlatformVideo({
      id: new PlatformID(PLATFORM, "diag", _config ? _config.id : PID),
      name: "⚠️ Sin datos",
      thumbnails: thumbs(""), author: author(), uploadDate: now(),
      url: "xt://diag", duration: 0, viewCount: 0, isLive: false
    }));
  }
  return new ListPager(items, 0);
};

source.searchSuggestions = function () { return []; };
source.getSearchCapabilities = function () { return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological], filters: [] }; };

source.search = function (query) {
  var q = (query || "").toLowerCase();
  var out = [];
  try {
    var vod = vodGet("/movies/resume");
    if (vod && vod.movies) {
      for (var i = 0; i < vod.movies.length && out.length < 40; i++) {
        var m = vod.movies[i];
        if ((m.b || "").toLowerCase().indexOf(q) >= 0) out.push(movieItem(m));
      }
    }
  } catch (e) {}
  try {
    var ser = vodGet("/series");
    if (ser && ser.series) {
      for (var j = 0; j < ser.series.length && out.length < 60; j++) {
        var s = ser.series[j];
        if ((s.b || "").toLowerCase().indexOf(q) >= 0) out.push(seriesItem(s));
      }
    }
  } catch (e) {}
  var live = getLiveStreamsCached();
  for (var k = 0; k < live.length; k++) {
    if ((live[k].name || "").toLowerCase().indexOf(q) >= 0) out.push(liveItem(live[k]));
  }
  return new ListPager(out, 0);
};
source.getSearchChannelContents = function () { return new ListPager([], 0); };

source.isContentDetailsUrl = function (url) {
  return typeof url === "string" && (url.indexOf("xt://") === 0 || url.indexOf("pp://") === 0);
};

source.getContentDetails = function (url) {
  var base = {
    author: author(),
    uploadDate: now(),
    url: url,
    viewCount: 0,
    rating: new RatingLikes(0),
    isLive: url.indexOf("xt://live/") === 0,
    shareUrl: url,
    subtitles: []
  };

  // LIVE
  if (url.indexOf("xt://live/") === 0) {
    var id = url.replace("xt://live/", "");
    var streamUrl = null, name = "Canal " + id, icon = "";
    try {
      var streams = getLiveStreamsCached();
      var found = streams.find(function(s) { return String(s.stream_id) === String(id); });
      if (found) {
        name = found.name || name;
        icon = fullThumb(found.stream_icon);
        streamUrl = found.url || found.direct_source || null;
      }
    } catch (e) {}
    var sources = [];
    if (streamUrl) {
      var s = hlsOrFile(streamUrl, "Directo");
      if (s) sources.push(s);
    }
    return new PlatformVideoDetails(Object.assign(base, {
      id: new PlatformID(PLATFORM, "live" + id, _config ? _config.id : PID),
      name: name, thumbnails: thumbs(icon), description: "", duration: 0,
      video: new VideoSourceDescriptor(sources)
    }));
  }

  // MOVIE (plpro)
  if (url.indexOf("pp://movie/") === 0) {
    var mid = url.replace("pp://movie/", "");
    var data = vodGet("/movies/" + mid);
    var name = (data && data.b) || ("Película " + mid);
    var desc = (data && data.e) || "";
    var img = data ? fullThumb(data.d || data.c) : "";
    var sources = [];

    var links = vodGet("/movies/" + mid + "/links");
    if (links && links.length) {
      for (var i = 0; i < Math.min(links.length, 6); i++) {
        var link = links[i];
        var extracted = extractFromEmbed(link.a);
        if (extracted) {
          var src = hlsOrFile(extracted, (link.b || "Servidor") + " " + (link.c || ""));
          if (src) sources.push(src);
        }
      }
    }
    if (!sources.length) desc += "\n\n⚠️ No se encontró fuente reproducible.";

    return new PlatformVideoDetails(Object.assign(base, {
      id: new PlatformID(PLATFORM, "mov" + mid, _config ? _config.id : PID),
      name: name, thumbnails: thumbs(img), description: desc, duration: 0,
      video: new VideoSourceDescriptor(sources)
    }));
  }

  // SERIES
  if (url.indexOf("pp://serie/") === 0) {
    var parts = url.replace("pp://serie/", "").split("/");
    var sid = parts[0];
    if (parts.length >= 3) {
      // Episode
      var season = parts[1], ep = parts[2];
      var sdata = vodGet("/series/" + sid);
      var title = ((sdata && sdata.b) || "Serie") + " S" + season + "E" + ep;
      var thumb = sdata ? fullThumb(sdata.d || sdata.c) : "";
      var sources = [];
      var links = vodGet("/series/" + sid + "/links/" + season + "/" + ep);
      if (links && links.length) {
        for (var i = 0; i < Math.min(links.length, 5); i++) {
          var extracted = extractFromEmbed(links[i].a);
          if (extracted) {
            var src = hlsOrFile(extracted, links[i].b || "Servidor");
            if (src) sources.push(src);
          }
        }
      }
      return new PlatformVideoDetails(Object.assign(base, {
        id: new PlatformID(PLATFORM, "ep" + sid + "_" + season + "_" + ep, _config ? _config.id : PID),
        name: title, thumbnails: thumbs(thumb), description: "", duration: 0,
        video: new VideoSourceDescriptor(sources)
      }));
    } else {
      // Series overview
      var sdata = vodGet("/series/" + sid);
      var title = (sdata && sdata.b) || "Serie " + sid;
      var thumb = sdata ? fullThumb(sdata.d || sdata.c) : "";
      var desc = (sdata && sdata.e) || "";
      var sources = [];
      // Try first episode
      var links = vodGet("/series/" + sid + "/links/1/1");
      if (links && links.length) {
        for (var i = 0; i < Math.min(links.length, 4); i++) {
          var extracted = extractFromEmbed(links[i].a);
          if (extracted) {
            var src = hlsOrFile(extracted, "T1E1 " + (links[i].b || ""));
            if (src) sources.push(src);
          }
        }
      }
      return new PlatformVideoDetails(Object.assign(base, {
        id: new PlatformID(PLATFORM, "ser" + sid, _config ? _config.id : PID),
        name: title, thumbnails: thumbs(thumb), description: desc, duration: 0,
        video: new VideoSourceDescriptor(sources)
      }));
    }
  }

  throw new ScriptException("URL no soportada: " + url);
};

source.getContentRecommendations = function (url) {
  if (url.indexOf("pp://serie/") !== 0) return new ListPager([], 0);
  var parts = url.replace("pp://serie/", "").split("/");
  if (parts.length !== 1) return new ListPager([], 0);
  var sid = parts[0];
  try {
    var data = vodGet("/series/" + sid);
    if (!data) return new ListPager([], 0);
    var seasons = data.seasons || data.f || [];
    if (typeof seasons === "number") seasons = [];
    var videos = [];
    var thumb = fullThumb(data.d || data.c);
    var title = data.b || "Serie";
    for (var si = 0; si < seasons.length; si++) {
      var season = seasons[si];
      var sn = season.num || season.a || (si + 1);
      var eps = season.episodes || season.b || [];
      for (var ei = 0; ei < eps.length; ei++) {
        var ep = eps[ei];
        var en = ep.num || ep.a || (ei + 1);
        videos.push(new PlatformVideo({
          id: new PlatformID(PLATFORM, "ep" + sid + "_" + sn + "_" + en, _config ? _config.id : PID),
          name: title + " S" + sn + "E" + en,
          thumbnails: thumbs(thumb),
          author: author(),
          uploadDate: now(),
          url: "pp://serie/" + sid + "/" + sn + "/" + en,
          duration: 0, viewCount: 0, isLive: false
        }));
      }
    }
    return new ListPager(videos, 0);
  } catch (e) { return new ListPager([], 0); }
};

log("Magma hybrid (plpro VOD + m3uts live) cargado");
