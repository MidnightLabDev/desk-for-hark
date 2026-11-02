// Injected by Desk for Hark into every page of the main window.
// Native commands only work on https://app.hark.com (see capabilities/).
// - Web notifications -> native Windows toasts, unread badge.
// - Keyboard: Ctrl+R/F5 reload, Ctrl +/-/0 and Ctrl+wheel zoom, Ctrl+P blocked.
// - Themes (CSS on top of Hark's design tokens).
// - Helpers the app calls: insert text, attach files, voice button.
// - Offline banner.
(function () {
  if (window.__deskForHark) return;
  window.__deskForHark = true;

  var isHark = location.hostname === "app.hark.com";

  function invoke(cmd, args) {
    try {
      var t = window.__TAURI_INTERNALS__;
      if (t && t.invoke) return t.invoke(cmd, args || {});
    } catch (e) {}
    return Promise.reject(new Error("no ipc"));
  }
  function quiet(p) { return p.catch(function () {}); }

  // ---- Native notifications -------------------------------------------
  if (isHark) {
    var DeskNotification = function (title, options) {
      options = options || {};
      this.title = String(title || "Hark");
      this.body = options.body ? String(options.body) : "";
      this.tag = options.tag || "";
      this.data = options.data;
      this.icon = options.icon || "";
      this.onclick = null; this.onshow = null; this.onclose = null; this.onerror = null;
      this._listeners = {};
      var self = this;
      quiet(invoke("notify", { title: this.title, body: this.body }).then(function () { self._fire("show"); }));
    };
    DeskNotification.prototype.addEventListener = function (type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    };
    DeskNotification.prototype.removeEventListener = function (type, fn) {
      var l = this._listeners[type] || [];
      this._listeners[type] = l.filter(function (f) { return f !== fn; });
    };
    DeskNotification.prototype.dispatchEvent = function () { return true; };
    DeskNotification.prototype._fire = function (type) {
      var ev = { type: type, target: this };
      var h = this["on" + type];
      try { if (typeof h === "function") h.call(this, ev); } catch (e) {}
      (this._listeners[type] || []).forEach(function (f) { try { f(ev); } catch (e) {} });
    };
    DeskNotification.prototype.close = function () { this._fire("close"); };
    Object.defineProperty(DeskNotification, "permission", { get: function () { return "granted"; } });
    DeskNotification.maxActions = 0;
    DeskNotification.requestPermission = function (cb) {
      if (typeof cb === "function") cb("granted");
      return Promise.resolve("granted");
    };
    try {
      Object.defineProperty(window, "Notification", { value: DeskNotification, writable: true, configurable: true });
    } catch (e) { window.Notification = DeskNotification; }

    try {
      if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype) {
        ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
          options = options || {};
          return quiet(invoke("notify", { title: String(title || "Hark"), body: options.body ? String(options.body) : "" }));
        };
      }
    } catch (e) {}

    try {
      if (navigator.permissions && navigator.permissions.query) {
        var origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function (desc) {
          if (desc && desc.name === "notifications") {
            return Promise.resolve({ state: "granted", status: "granted", onchange: null,
              addEventListener: function () {}, removeEventListener: function () {} });
          }
          return origQuery(desc);
        };
      }
    } catch (e) {}
  }

  // ---- Keyboard: reload, zoom ----------------------------------
  window.addEventListener("keydown", function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var k = e.key;
    if ((ctrl && !e.shiftKey && (k === "r" || k === "R")) || k === "F5") {
      e.preventDefault(); location.reload(); return;
    }
    if (!ctrl || e.altKey) return;
    if (k === "p" || k === "P") {
      e.preventDefault(); return; // printing is turned off in the app
    } else if (k === "=" || k === "+" || e.code === "NumpadAdd") {
      e.preventDefault(); quiet(invoke("zoom", { action: "in" }));
    } else if (k === "-" || k === "_" || e.code === "NumpadSubtract") {
      e.preventDefault(); quiet(invoke("zoom", { action: "out" }));
    } else if (k === "0" || e.code === "Numpad0") {
      e.preventDefault(); quiet(invoke("zoom", { action: "reset" }));
    }
  }, true);

  window.addEventListener("wheel", function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    quiet(invoke("zoom", { action: e.deltaY < 0 ? "in" : "out" }));
  }, { passive: false, capture: true });

  if (!isHark) return;

  // ---- Unread badge from the page title, e.g. "(2) Hark" -----------------
  var lastTitle = "";
  function checkTitle() {
    var t = document.title || "";
    if (t === lastTitle) return;
    lastTitle = t;
    var m = /^\((\d+)\)/.exec(t);
    quiet(invoke("badge", { on: !!(m && +m[1] > 0) }));
  }
  setInterval(checkTitle, 2000);

  // ---- Stay "visible" in the background ------------------------------------
  // Hark pauses live updates when its page is hidden. In the app the window
  // is often minimised or in the tray on purpose, so the page always reports
  // itself as visible and Hark keeps receiving replies.
  try {
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: function () { return false; } });
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: function () { return "visible"; } });
    Object.defineProperty(Document.prototype, "webkitHidden", { configurable: true, get: function () { return false; } });
    ["visibilitychange", "webkitvisibilitychange"].forEach(function (t) {
      document.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
      window.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
    });
  } catch (e) {}

  // ---- Hark files: preview and Download ---------------------------------
  // Hark's file preview fetches the file from its storage. A copy the
  // WebView cached earlier without the storage's cross-origin headers makes
  // that fetch fail, and Hark then shows only a Download card, so storage
  // files are always fetched fresh.
  function isStorage(u) {
    try {
      var h = new URL(u, location.href).hostname;
      return /\.amazonaws\.com$|\.cloudfront\.net$|hark-media/.test(h);
    } catch (e) { return false; }
  }
  var realFetch = window.fetch;
  window.__deskRealFetch = realFetch;
  window.fetch = function (input, init) {
    try {
      var u = typeof input === "string" ? input : (input && input.url) || String(input);
      // While the window is hidden or minimised, Hark still thinks you're
      // looking at the open chat and marks it read. The app holds that back
      // so the chat shows as unread (and notifies), then sends it once
      // you're back.
      var vm = window.__deskAway && /\/api\/conversations\/([^/?#]+)\/viewed/.exec(u);
      if (vm) {
        var held = window.__deskHeldViewed || (window.__deskHeldViewed = {});
        held[vm[1]] = 1;
        return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (isStorage(u)) {
        init = Object.assign({}, init || {}, { cache: "no-store" });
        if (typeof input !== "string" && input instanceof Request) input = input.url;
      }
    } catch (e) {}
    return realFetch.call(this, input, init);
  };
  // Download opens an empty window first and then points it at the file.
  // An empty app window just sat there black, so Hark gets a stand-in
  // window instead and the app is handed the file's real address: files are
  // saved, other pages open as usual. Files Hark builds in the page
  // (blob: or data: links) are saved through the normal download path.
  var realOpen = window.open;
  // Saving goes through the app's background downloader, never through
  // WebView2's own download (that locked the whole window on Hark's
  // preview Download). Stored files are fetched by the app; files built in
  // the page are handed over as bytes. Returns false to fall back.
  function bytesB64(buf) {
    var u8 = new Uint8Array(buf), s = "", CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function nameFrom(u, name, type) {
    if (name) return name;
    try { var last = decodeURIComponent(new URL(u, location.href).pathname.split("/").pop() || ""); if (/\.\w{1,8}$/.test(last)) return last; } catch (e) {}
    var ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf", "text/plain": ".txt", "application/zip": ".zip" }[(type || "").split(";")[0]] || "";
    return "download" + ext;
  }
  function deskSave(u, name, fallback) {
    if (!isHark) return false;
    u = String(u || "");
    var abs; try { abs = new URL(u, location.href).href; } catch (e) { return false; }
    if (isStorage(abs)) {
      invoke("download_file", { url: abs }).then(function (ok) { if (!ok && fallback) fallback(); }, function () { if (fallback) fallback(); });
      return true;
    }
    var hh = ""; try { hh = new URL(abs).hostname; } catch (e) {}
    if (/(^|\.)hark\.com$/.test(hh) && /^(blob|data):/i.test(abs) === false) {
      realFetch.call(window, abs, { credentials: "include" }).then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || /text\/html/i.test(ct)) throw new Error("page");
        var cd = r.headers.get("content-disposition") || "", m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd);
        return r.blob().then(function (b) { return b.arrayBuffer().then(function (buf) {
          return invoke("save_bytes", { name: nameFrom(abs, name || (m ? decodeURIComponent(m[1]) : ""), b.type), data: bytesB64(buf) }); }); });
      }).then(function (ok) { if (!ok && fallback) fallback(); }, function () { if (fallback) fallback(); });
      return true;
    }
    if (/^(blob|data):/i.test(abs)) {
      realFetch.call(window, abs).then(function (r) { return r.blob(); }).then(function (b) {
        return b.arrayBuffer().then(function (buf) { return invoke("save_bytes", { name: nameFrom(abs, name, b.type), data: bytesB64(buf) }); });
      }).then(function (ok) { if (!ok && fallback) fallback(); }, function () { if (fallback) fallback(); });
      return true;
    }
    return false;
  }
  var realAClick = HTMLAnchorElement.prototype.click;
  function wantsSave(a) {
    if (!a || a.__deskPass) return false;
    var h = a.getAttribute("href") || "";
    var hk = false; try { var uu = new URL(h, location.href); hk = /(^|\.)hark\.com$/.test(uu.hostname) && uu.pathname !== location.pathname; } catch (e) {}
    return a.hasAttribute("download") && (/^(blob|data):/i.test(h) || isStorage(h) || hk);
  }
  function passClick(a) { a.__deskPass = true; try { realAClick.call(a); } finally { setTimeout(function () { a.__deskPass = false; }, 0); } }
  HTMLAnchorElement.prototype.click = function () {
    var a = this;
    if (wantsSave(a) && deskSave(a.href, a.getAttribute("download") || "", function () { passClick(a); })) return;
    return realAClick.apply(this, arguments);
  };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[download]");
    if (!wantsSave(a)) return;
    if (deskSave(a.href, a.getAttribute("download") || "", function () { passClick(a); })) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // The browser's own "save file" picker can hang or crash the embedded
  // window, so Hark gets a stand-in: what it writes is collected and saved
  // by the app (straight to Downloads, or a Save As dialog when "Ask where
  // to save" is on), off the window's thread.
  if (isHark) {
    var deskPicker = function (opts) {
      var name = (opts && opts.suggestedName) || "download";
      function writable() {
        var parts = [], saved = false;
        function save() {
          if (saved) return Promise.resolve(); saved = true;
          var b = new Blob(parts);
          return b.arrayBuffer().then(function (buf) { return invoke("save_bytes", { name: nameFrom("", name, b.type), data: bytesB64(buf) }); })
            .then(function () {}, function () { banner("Couldn't save " + name + ".", 4000); });
        }
        function add(d) {
          if (d && typeof d === "object" && !(d instanceof Blob) && !(d instanceof ArrayBuffer) && !ArrayBuffer.isView(d) && "type" in d) {
            if (d.type === "write") parts.push(d.data);
            else if (d.type === "truncate" && d.size === 0) parts = [];
          } else if (d != null) parts.push(d);
        }
        var ws = new WritableStream({ write: function (c) { add(c); }, close: save, abort: function () { parts = []; } });
        ws.write = function (d) { add(d); return Promise.resolve(); };
        ws.seek = function () { return Promise.resolve(); };
        ws.truncate = function (n) { if (!n) parts = []; return Promise.resolve(); };
        var nativeClose = WritableStream.prototype.close;
        ws.close = function () { return save().then(function () { try { return nativeClose.call(ws); } catch (e) {} }).catch(function () {}); };
        return ws;
      }
      var handle = {
        kind: "file", name: name,
        createWritable: function () { return Promise.resolve(writable()); },
        getFile: function () { return Promise.resolve(new File([], name)); },
        queryPermission: function () { return Promise.resolve("granted"); },
        requestPermission: function () { return Promise.resolve("granted"); },
        isSameEntry: function (o) { return Promise.resolve(o === handle); }
      };
      return Promise.resolve(handle);
    };
    try { Object.defineProperty(window, "showSaveFilePicker", { configurable: true, writable: true, value: deskPicker }); } catch (e) {}
  }
  function saveBlob(u, name) {
    var a = document.createElement("a");
    a.href = u; a.download = name || "";
    a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); }, 1000);
  }
  function openReal(u, name, features) {
    u = String(u || "");
    if (/^(blob|data):/i.test(u)) { saveBlob(u, ""); return null; }
    if (isStorage(u) && deskSave(u, "", function () { realOpen.call(window, u, name, features); })) return null;
    return realOpen.call(window, u, name, features);
  }
  window.open = function (url, name, features) {
    if (url && String(url) !== "about:blank") return openReal(url, name, features);
    var sent = false;
    function go(u) { if (!sent && u && String(u) !== "about:blank") { sent = true; openReal(u, name, features); } }
    var loc = { assign: go, replace: go, reload: function () {}, toString: function () { return "about:blank"; } };
    Object.defineProperty(loc, "href", { get: function () { return "about:blank"; }, set: go });
    var fake = {
      closed: false, opener: null, name: name || "",
      close: function () { fake.closed = true; },
      focus: function () {}, blur: function () {}, postMessage: function () {},
      addEventListener: function () {}, removeEventListener: function () {},
      document: { title: "", open: function () {}, write: function () {}, writeln: function () {}, close: function () {}, body: null },
    };
    Object.defineProperty(fake, "location", { get: function () { return loc; }, set: go });
    return fake;
  };

  // New-reply notifications are handled by the app itself (it reads the
  // open chat while the window is away), so the page doesn't watch every
  // change. Watching every change froze Hark on big file previews.


  // ---- Themes -----------------------------------------------------------
  // Hark's design tokens (CSS custom properties) are overridden with
  // !important so they beat Hark's own :root[data-theme] rules.
  // Hark has two token sets: the older --color-* ones and the newer
  // --bg / --surface-secondary / --text-primary ones that its app shell
  // uses. Each palette sets both so no part of the page is left behind.
  // Light palettes keep Hark's own light theme (data-theme=light) and only
  // tint the backgrounds, so its text and sidebar contrast stay intact.
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }
  function palette(o) {
    var v = {
      // newer tokens (tints only; Hark keeps its own text scales)
      "--bg": o.bg, "--surface-secondary": o.surface,
      "--text-primary": o.ink, "--accent-fill-paper": o.light ? o.surface : rgba(o.ink, .13),
      "--regular-opaque-bg": o.panel, "--regular-solid-bg": rgba(o.panel, .96),
      "--regular-bg": rgba(o.panel, o.light ? .7 : .62),
      "--composer-bg": rgba(o.panel, o.light ? .65 : .62),
      "--bubble-agent-bg": rgba(o.panel, o.light ? .98 : .7),
      "--overlay-surface": rgba(o.panel, .9),
      // older tokens
      "--color-surface-primary": o.bg, "--color-surface-secondary": o.surface,
      "--color-text-primary": o.ink, "--color-text-secondary": o.sub, "--color-text-small": o.sub
    };
    if (!o.light) {
      v["--color-neutral-black"] = o.bg;
      v["--color-neutral-extra-dark-gray"] = o.surface;
      // Dark themes: every text level stays white or near-white.
      v["--text-primary"] = "#ffffff"; v["--color-text-primary"] = "#ffffff";
      v["--text-secondary"] = "rgba(255,255,255,.88)"; v["--text-tertiary"] = "rgba(255,255,255,.75)";
      v["--text-quaternary"] = "rgba(255,255,255,.65)"; v["--text-placeholder"] = "rgba(255,255,255,.6)";
      v["--color-text-secondary"] = "rgba(255,255,255,.88)"; v["--color-text-small"] = "rgba(255,255,255,.82)";
    }
    if (o.strong) {
      v["--text-secondary"] = rgba(o.ink, .8); v["--text-tertiary"] = rgba(o.ink, .6);
      v["--stroke-primary"] = rgba(o.ink, .5); v["--stroke-secondary"] = rgba(o.ink, .35);
      v["--color-border-color"] = rgba(o.ink, .45); v["--color-border-color-2"] = rgba(o.ink, .6);
    }
    return { dark: !o.light, light: !!o.light, caption: o.caption || o.bg, text: o.ink,
             accent: o.accent, body: !o.light, vars: v, extra: o.extra || "", effect: o.effect || "" };
  }
  var PALETTES = {
    midnight: palette({ bg: "#000000", surface: "#0c0c0e", panel: "#101013", ink: "#e8e8ea", sub: "#8a8f9c", accent: "#7aa2ff" }),
    teal: palette({ bg: "#0b1a24", surface: "#102632", panel: "#12303d", ink: "#eaf6f5", sub: "#8fb3b5", accent: "#19b3a6" }),
    // Global events
    christmas: palette({ bg: "#0e2419", surface: "#143222", panel: "#173a28", ink: "#f7f1e3", sub: "#b8c8b4",
                         accent: "#d23a44", effect: "snow", extra: "a:not([class]){color:#e3bf5a !important}" }),
    newyear: palette({ bg: "#0b0b0d", surface: "#151418", panel: "#1a191e", ink: "#f4efe4", sub: "#a9a294", accent: "#d4b46a", effect: "fireworks" }),
    halloween: palette({ bg: "#141214", surface: "#1e1a1d", panel: "#241f22", ink: "#f3ece6", sub: "#a99f98", accent: "#ff7a1a", effect: "bats" }),
    valentine: palette({ bg: "#24101a", surface: "#301622", panel: "#381a28", ink: "#fbeef2", sub: "#d4a9b7", accent: "#ff6b9a", effect: "hearts" }),
    lunar: palette({ bg: "#2a0c0c", surface: "#361212", panel: "#3e1515", ink: "#fbf1df", sub: "#d9b9a0", accent: "#f2c14e", effect: "lanterns" }),
    stpatricks: palette({ bg: "#08281a", surface: "#0e3523", panel: "#113d29", ink: "#eef8ef", sub: "#a9c9b1", accent: "#3ddc84", effect: "clovers",
                          extra: "a:not([class]){color:#e3bf5a !important}" }),
    earthday: palette({ bg: "#0c1f24", surface: "#12302f", panel: "#153836", ink: "#ecf6f0", sub: "#9fc3b8", accent: "#5ccf7a", effect: "leaves" }),
    // Moods
    aurora: palette({ bg: "#070b1a", surface: "#0e1528", panel: "#121a31", ink: "#eaf0ff", sub: "#9aa6c8", accent: "#7ef0c2", effect: "aurora" }),
    ocean: palette({ bg: "#061827", surface: "#0b2438", panel: "#0e2b42", ink: "#e8f6ff", sub: "#94b8cc", accent: "#2ec4e6", effect: "bubbles" }),
    contrast: palette({ bg: "#000000", surface: "#111111", panel: "#141414", ink: "#ffffff", sub: "#d6d6d6", accent: "#ffd400",
                        strong: true,
                        extra: "*:focus-visible{outline:2px solid #ffd400 !important;outline-offset:2px !important}" +
                               "a{text-decoration:underline !important}" }),
    // Hark's own light mode, used by Follow Windows / Scheduled in the daytime.
    light: { dark: false, light: true, caption: "#ffffff", text: "#1d1d1f", accent: "", vars: {}, extra: "" },
    hark: { dark: true, caption: "", text: "", accent: "", vars: {}, extra: "" }
  };

  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function scheduledDark(p) {
    var d = minutes(p.scheduleDark), l = minutes(p.scheduleLight);
    if (d === null || l === null) return true;
    var now = new Date(), n = now.getHours() * 60 + now.getMinutes();
    return d > l ? (n >= d || n < l) : (n >= d && n < l);
  }
  function resolvePalette(p) {
    var name = p.theme || "hark";
    if (name === "windows") name = p.windowsLight ? "light" : "hark";
    if (name === "schedule") name = scheduledDark(p) ? "midnight" : "light";
    var pal = PALETTES[name] || PALETTES.hark;
    var accent = p.accent || (p.theme === "windows" ? p.windowsAccent : "") || pal.accent;
    return { name: name, pal: pal, accent: accent };
  }


  // ---- Readable text guard ------------------------------------------------
  // On dark themes, any text that is too faint against what is behind it
  // is turned white. Runs in small batches every couple of seconds (never
  // on every page change: that froze Hark on big previews before).
  var guardOn = false, guardSeen = new WeakMap();
  function parseRgb(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }
    return .2126 * ch(c.r) + .7152 * ch(c.g) + .0722 * ch(c.b);
  }
  function mix(fg, bg) { var a = fg.a; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
  function bgOf(el, base) {
    var layers = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = parseRgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.05) { layers.push(c); if (c.a >= .95) break; }
    }
    var out = base;
    for (var i = layers.length - 1; i >= 0; i--) out = mix(layers[i], out);
    return out;
  }
  function hasText(el) {
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    return false;
  }
  function guardRun() {
    if (!guardOn || document.hidden) return;
    var base = parseRgb(getComputedStyle(document.body).backgroundColor);
    if (!base || base.a < .5) base = { r: 0, g: 0, b: 0, a: 1 };
    var all = document.body.getElementsByTagName("*"), done = 0;
    for (var i = 0; i < all.length && done < 600; i++) {
      var el = all[i];
      if (el.closest && el.closest("svg,canvas,video,img,pre code,.hljs")) continue;
      if (!hasText(el)) continue;
      var cs = getComputedStyle(el), key = cs.color + "|" + cs.backgroundColor;
      if (guardSeen.get(el) === key) continue;
      done++;
      var fg = parseRgb(cs.color); if (!fg) { guardSeen.set(el, key); continue; }
      var bg = bgOf(el, base), f = mix(fg, bg), op = parseFloat(cs.opacity) || 1;
      var a = lum(f), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (ratio < 4.5 && op > .2) {
        el.style.setProperty("color", b < .4 ? "#ffffff" : "#111111", "important");
        el.setAttribute("data-desk-readable", "");
        cs = getComputedStyle(el);
      }
      guardSeen.set(el, cs.color + "|" + cs.backgroundColor);
    }
  }
  function guardReset() {
    [].forEach.call(document.querySelectorAll("[data-desk-readable]"), function (n) { n.style.removeProperty("color"); n.removeAttribute("data-desk-readable"); });
    guardSeen = new WeakMap();
  }
  setInterval(function () { try { guardRun(); } catch (e) {} }, 2000);

  var currentPayload = null, forcedLight = false;
  function cssFor(p) {
    var r = resolvePalette(p), pal = r.pal, css = "";
    var vars = Object.keys(pal.vars).map(function (k) { return k + ":" + pal.vars[k] + " !important"; });
    if (r.accent) vars.push("--color-info:" + r.accent + " !important");
    if (vars.length) css += ":root,:root[data-theme],:root *{" + vars.join(";") + "}";
    if (pal.body) {
      css += "html,body{background-color:" + pal.vars["--color-surface-primary"] + " !important;color:" + pal.vars["--color-text-primary"] + "}";
    }
    if (r.accent) {
      css += ":root{accent-color:" + r.accent + ";caret-color:" + r.accent + "}" +
             "::selection{background:" + r.accent + ";color:#fff}" +
             "a:not([class]){color:" + r.accent + "}";
    }
    if (pal.extra) css += pal.extra;
    if (p.fontFamily) {
      var f = String(p.fontFamily).replace(/[;{}<>]/g, "");
      css += "body,body button,body input,body textarea,body p,body li,body span,body div,body h1,body h2,body h3,body h4,body a," +
             "body label{font-family:\"" + f + "\",\"Segoe UI Variable\",\"Segoe UI\",sans-serif !important}" +
             "body code,body pre,body kbd{font-family:Consolas,\"Cascadia Code\",monospace !important}";
    }
    var scale = +p.fontScale || 1;
    if (Math.abs(scale - 1) > 0.001) css += "html{font-size:" + (scale * 100).toFixed(0) + "% !important}";
    if (p.compact) {
      css += "body p,body li{line-height:1.4 !important;margin-block:.35em !important}" +
             "body ul,body ol{margin-block:.4em !important}";
    }
    if (p.customCss) css += "\n/* custom */\n" + p.customCss;
    return { css: css, r: r };
  }

  function applyTheme(p) {
    currentPayload = p;
    try {
      var rp = resolvePalette(p);
      guardReset();
      guardOn = !!rp.pal.dark && !rp.pal.light && rp.name !== "hark";
      if (guardOn) setTimeout(function () { try { guardRun(); } catch (e) {} }, 400);
    } catch (e) {}
    if (window.__deskFilesSetting) window.__deskFilesSetting(p.filesPanel !== false);
    var out = cssFor(p);
    var el = document.getElementById("desk-theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "desk-theme";
    }
    el.textContent = out.css;
    // Keep our style last so it wins ties.
    var parent = document.head || document.documentElement;
    if (el.parentNode !== parent || el.nextSibling) parent.appendChild(el);
    var pal = out.r.pal;
    var root = document.documentElement;
    if (pal.light) { if (root.getAttribute("data-theme") !== "light") { root.setAttribute("data-theme", "light"); forcedLight = true; } }
    else if (forcedLight || (out.r.name !== "hark" && root.getAttribute("data-theme") === "light")) {
      root.setAttribute("data-theme", "dark"); forcedLight = false;
    }
    quiet(invoke("title_bar", { caption: pal.caption || "", text: pal.text || "", dark: !!pal.dark }));
    effect(p.snow !== false ? pal.effect : "");
  }
  window.__deskApplyTheme = applyTheme;

  // ---- Theme effects (snow, fireworks, bats, hearts…) ----------------------
  // A see-through canvas on top that ignores the mouse, so nothing in Hark
  // moves or stops being clickable. Off with Settings > Theme effects, and
  // off when Windows asks for reduced motion.
  var fx = { canvas: null, raf: 0, kind: "", parts: [], t0: 0 };
  var EMOJI = { bats: "🦇", hearts: "💗", lanterns: "🏮", clovers: "☘️", leaves: "🍃" };
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function effect(kind) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) kind = "";
    if (kind === fx.kind && (fx.canvas || !kind)) return;
    if (fx.canvas) { cancelAnimationFrame(fx.raf); fx.canvas.remove(); fx.canvas = null; }
    fx.kind = kind;
    if (!kind || !document.body) { if (!document.body) fx.kind = ""; return; }
    var c = fx.canvas = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;opacity:" +
      (kind === "aurora" ? ".35" : kind === "snow" ? ".55" : ".5");
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    function size() { if (fx.canvas) { c.width = innerWidth; c.height = innerHeight; } }
    size(); addEventListener("resize", size);
    var count = { snow: 70, bubbles: 28, bats: 7, hearts: 14, lanterns: 8, clovers: 14, leaves: 14 }[kind] || 0;
    fx.parts = [];
    for (var i = 0; i < count; i++) fx.parts.push({ x: Math.random(), y: Math.random(), r: rnd(1, 2.2), s: rnd(.2, .8), d: Math.random() * 6, z: rnd(.6, 1.2) });
    var bursts = [], last = 0, nextBurst = 0;
    (function tick(t) {
      if (!fx.canvas || fx.canvas !== c) return;
      fx.raf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 33) return;
      last = t;
      var w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);
      if (kind === "aurora") {
        [["rgba(80,240,170,", .0002, 0], ["rgba(150,110,255,", .00015, 2]].forEach(function (b) {
          var cx = w * (.5 + Math.sin(t * b[1] + b[2]) * .35), cy = h * (.12 + Math.cos(t * b[1] * 1.3 + b[2]) * .06);
          var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * .55);
          g.addColorStop(0, b[0] + ".55)"); g.addColorStop(1, b[0] + "0)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        });
        return;
      }
      if (kind === "fireworks") {
        if (t > nextBurst) {
          nextBurst = t + rnd(1800, 4200);
          var bx = rnd(.15, .85) * w, by = rnd(.12, .45) * h, hue = ["#d4b46a", "#f4efe4", "#ff9e5e", "#9ec9ff"][Math.floor(rnd(0, 4))];
          for (var k = 0; k < 36; k++) { var ang = k / 36 * Math.PI * 2, sp = rnd(1.2, 2.6); bursts.push({ x: bx, y: by, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, col: hue }); }
        }
        bursts = bursts.filter(function (p) { return p.life > 0; });
        bursts.forEach(function (p) {
          p.x += p.vx; p.y += p.vy; p.vy += .03; p.vx *= .985; p.life -= .018;
          ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        return;
      }
      if (kind === "snow") {
        ctx.fillStyle = "#ffffff"; ctx.beginPath();
        fx.parts.forEach(function (f) {
          f.y += f.s / h * 2.2; f.d += .01;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
          var x = (f.x * w + Math.sin(f.d) * 12 + w) % w;
          ctx.moveTo(x, f.y * h); ctx.arc(x, f.y * h, f.r, 0, Math.PI * 2);
        });
        ctx.fill();
        return;
      }
      if (kind === "bubbles") {
        ctx.strokeStyle = "rgba(180,235,255,.8)"; ctx.lineWidth = 1;
        fx.parts.forEach(function (f) {
          f.y -= f.s / h * 2.5; f.d += .02;
          if (f.y < -0.03) { f.y = 1.03; f.x = Math.random(); }
          var x = f.x * w + Math.sin(f.d) * 6;
          ctx.beginPath(); ctx.arc(x, f.y * h, f.r * 3, 0, Math.PI * 2); ctx.stroke();
        });
        return;
      }
      // Emoji drifters: bats fly sideways, lanterns sway in place, the rest fall.
      var ch = EMOJI[kind];
      fx.parts.forEach(function (f) {
        var x, y, size = 14 * f.z;
        if (kind === "bats") {
          f.x += f.s / w * 2.4; f.d += .05;
          if (f.x > 1.05) { f.x = -0.05; f.y = Math.random() * .6; }
          x = f.x * w; y = f.y * h + Math.sin(f.d) * 10;
        } else if (kind === "lanterns") {
          f.d += .015; x = f.x * w + Math.sin(f.d) * 4; y = (.03 + (f.y * .1)) * h; size = 18 * f.z;
          if (f.x < .02 || f.x > .98) f.x = rnd(.05, .95);
        } else {
          f.y += f.s / h * 1.6; f.d += .02;
          if (f.y > 1.03) { f.y = -0.03; f.x = Math.random(); }
          x = f.x * w + Math.sin(f.d) * 18; y = f.y * h;
        }
        ctx.save(); ctx.translate(x, y);
        if (kind !== "bats" && kind !== "lanterns") ctx.rotate(Math.sin(f.d) * .6);
        ctx.font = size + 'px "Segoe UI Emoji",sans-serif'; ctx.fillText(ch, 0, 0); ctx.restore();
      });
    })(0);
  }

  function loadTheme() { quiet(invoke("get_theme").then(applyTheme)); }
  loadTheme();
  document.addEventListener("DOMContentLoaded", function () {
    if (currentPayload) applyTheme(currentPayload); else loadTheme();
  });
  // Re-apply when Hark swaps its own styles, and for the schedule.
  setInterval(function () {
    if (!currentPayload) return;
    var el = document.getElementById("desk-theme");
    var parent = document.head || document.documentElement;
    if (!el || el.parentNode !== parent || el.nextSibling || currentPayload.theme === "schedule") applyTheme(currentPayload);
  }, 30000);

  // ---- Composer helpers ----------------------------------------------------
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 10 && r.bottom > 0 && r.top < innerHeight;
  }
  function isEditable(el) {
    return el && (el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && /^(text|search)?$/i.test(el.type || "")) || el.isContentEditable);
  }
  function findComposer() {
    var a = document.activeElement;
    if (isEditable(a) && visible(a)) return a;
    var c = [].slice.call(document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"]')).filter(visible);
    if (!c.length) return null;
    // The chat box is usually the lowest one on screen.
    c.sort(function (x, y) { return y.getBoundingClientRect().bottom - x.getBoundingClientRect().bottom; });
    return c[0];
  }
  function setText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      var before = el.value || "";
      setter.call(el, before ? before + (/\s$/.test(before) ? "" : "\n") + text : text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("insertText", false, text);
    }
  }
  function textOf(el) { return (el.value !== undefined ? el.value : el.textContent) || ""; }
  function submit(el) {
    var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    setTimeout(function () {
      if (!textOf(el).trim()) return;
      var root = el.closest("form") || document;
      var btn = root.querySelector('button[type="submit"],button[aria-label*="send" i],button[data-testid*="send" i]');
      if (btn && !btn.disabled) btn.click();
    }, 350);
  }
  window.__deskInsertText = function (text, doSubmit) {
    var el = findComposer();
    if (!el) { banner("Couldn't find Hark's message box. Open a chat and try again.", 4000); return; }
    setText(el, text);
    if (doSubmit) setTimeout(function () { submit(el); }, 120);
  };

  function b64ToFile(f) {
    var bin = atob(f.b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.type || "application/octet-stream" });
  }
  window.__deskAttachFiles = function (list) {
    var files = list.map(b64ToFile);
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    var target = findComposer();
    // 1) Paste into the message box (how most chat apps take images and files).
    if (target) {
      target.focus();
      var pe = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(pe);
      if (pe.defaultPrevented) return;
    }
    // 2) A file input on the page.
    var inputs = [].slice.call(document.querySelectorAll('input[type="file"]'));
    if (inputs.length) {
      var input = inputs[inputs.length - 1];
      try {
        input.files = dt.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      } catch (e) {}
    }
    // 3) Drop onto the message box.
    var dropTarget = target || document.body;
    ["dragenter", "dragover", "drop"].forEach(function (type) {
      dropTarget.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
  };

  window.__deskVoice = function (selector) {
    var el = null;
    try { if (selector) el = document.querySelector(selector); } catch (e) {}
    if (!el) {
      var c = document.querySelectorAll('button[aria-label*="voice" i],button[aria-label*="microphone" i],' +
        'button[aria-label*="dictat" i],button[aria-label*="speak" i],button[aria-label*="record" i],' +
        'button[title*="voice" i],button[data-testid*="voice" i],button[data-testid*="mic" i]');
      for (var i = 0; i < c.length; i++) if (visible(c[i])) { el = c[i]; break; }
    }
    if (el) el.click();
    else banner("Couldn't find Hark's voice button. You can set it in Settings.", 4000);
  };

  // ---- Small banner (offline, hints) ----------------------------------------
  var bannerEl = null, bannerTimer = null;
  function banner(text, ms, action) {
    if (!document.body) return;
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.setAttribute("role", "status");
      bannerEl.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;" +
        "background:#1e1f24;color:#f5f5f7;border:1px solid rgba(255,255,255,.16);border-radius:14px;" +
        "padding:14px 22px;min-width:320px;max-width:min(640px,90vw);box-sizing:border-box;text-align:center;" +
        "font:600 15px/1.4 'Segoe UI Variable','Segoe UI',sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45);" +
        "display:flex;align-items:center;justify-content:center;gap:14px;pointer-events:none";
      document.body.appendChild(bannerEl);
    }
    bannerEl.textContent = "";
    bannerEl.appendChild(document.createElement("span")).textContent = text;
    bannerEl.style.pointerEvents = action ? "auto" : "none";
    if (action) {
      var ab = document.createElement("button");
      ab.textContent = action.label;
      ab.style.cssText = "border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:inherit;" +
        "padding:6px 14px;border-radius:9px;cursor:pointer;font:600 14px 'Segoe UI',sans-serif;flex:none";
      ab.onclick = function () { bannerEl.style.display = "none"; action.fn(); };
      bannerEl.appendChild(ab);
    }
    bannerEl.style.display = "flex";
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(function () { bannerEl.style.display = "none"; }, ms);
  }
  window.addEventListener("offline", function () { banner("You're offline. Hark will reconnect automatically."); });
  window.addEventListener("online", function () {
    banner("Back online. Reloading…", 1500);
    setTimeout(function () { location.reload(); }, 800);
  });

  // ---- Project files panel ----------------------------------------------
  // A list of every file in the open project's chat: what you uploaded and
  // what Hark sent you. Hark's web app has no list of a project's whole
  // workspace, so it reads the project's message history (the same request
  // Hark's own page makes) and collects the files in it. Hidden until
  // opened with Ctrl+Shift+F, the tab on the right edge, or the tray.
  (function () {
    var KEY = "deskForHark.filesOpen.v1";
    var enabled = true, open = false, pid = null, files = {}, msgs = {}, loading = false, err = "";
    var panel, tab, listEl, searchEl, statusEl, pollTimer = null, loadedFor = null;
    try { open = localStorage.getItem(KEY) === "1"; } catch (e) {}
    var realFetch = window.__deskRealFetch || window.fetch;

    function projectId() { return (location.pathname.match(/^\/project\/([^/?#]+)/) || [])[1] || null; }
    function hdr() {
      var m = document.querySelector('meta[name="hark-locale"]');
      return m && m.content ? { "X-Hark-Locale": m.content } : {};
    }
    function base(p) { p = String(p || ""); return p.split("?")[0].split("/").filter(Boolean).pop() || ""; }
    function stamp(m) {
      var t = m && (m.createdAt || m.created_at || m.timestamp);
      if (t == null) return 0;
      var n = typeof t === "number" ? t : Date.parse(t);
      if (typeof t === "number" && t < 1e12) n = t * 1000;
      return isNaN(n) ? 0 : n;
    }
    // Walks one message and picks up every object that looks like a file.
    function textOf(m) {
      var c = m && (m.content != null ? m.content : m.text);
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map(function (p) { return typeof p === "string" ? p : (p && (p.text || p.content)) || ""; }).filter(Boolean).join("\n");
      return "";
    }
    function collect(m) {
      var mine = m.role === "user", when = stamp(m), seen = 0;
      msgs[m.id] = { id: m.id, role: m.role, when: when, text: textOf(m).slice(0, 6000) };
      (function walk(o, depth) {
        if (!o || typeof o !== "object" || depth > 8 || seen > 200) return;
        if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) walk(o[i], depth + 1); return; }
        var key = o.s3Key || o.s3_key;
        var url = o.downloadUrl || o.download_url;
        if (typeof key === "string" && key && (url || o.path || o.filename || o.name)) {
          seen++;
          var name = o.filename || o.name || base(o.path) || base(key);
          if (!files[key] || files[key].when < when) {
            files[key] = { key: key, name: String(name), url: url || "", mine: mine, when: when,
              size: o.size || 0, msg: m.id, kind: o.contentType || o.content_type || o.media_type || "" };
          }
        }
        for (var k in o) if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1);
      })(m, 0);
    }
    function page(id, before) {
      var q = new URLSearchParams({ conversationId: id, v: "2" });
      if (before) { q.set("before", before.id); q.set("beforeCreatedAt", String(before.createdAt != null ? before.createdAt : before.created_at)); }
      return realFetch.call(window, "/api/messages/history?" + q.toString(), { credentials: "include", headers: hdr(), cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) {
          // Hark answers {messages: [...]} or, in its newer "records" shape,
          // {messages: {id: message}}; either way we want a plain list.
          var m = Array.isArray(j) ? j : (j && (j.messages || j.items || j.records)) || [];
          if (!Array.isArray(m)) m = typeof m === "object" ? Object.keys(m).map(function (k) { var v = m[k]; if (v && typeof v === "object" && !v.id) v.id = k; return v; }) : [];
          var more = j && j.older && typeof j.older.hasMore === "boolean" ? j.older.hasMore : (j && typeof j.hasMore === "boolean" ? j.hasMore : true);
          m.more = more;
          // Hark pages back with the cursor it hands out (older.cursor).
          m.cursor = j && j.older && j.older.cursor && j.older.cursor.id ? j.older.cursor : null;
          return m;
        });
    }
    function oldest(list) {
      var o = null;
      list.forEach(function (m) { if (m && m.id && (!o || stamp(m) < stamp(o))) o = m; });
      return o;
    }
    // Reads up to 10 pages back the first time, then only the newest page.
    function load(full) {
      var id = projectId();
      if (!id || loading) return;
      if (id !== loadedFor) { files = {}; msgs = {}; full = true; }
      loading = true; err = ""; render();
      var pages = 0, ids = {};
      function step(before) {
        return page(id, before).then(function (list) {
          var fresh = list.filter(function (m) { return m && m.id && !ids[m.id]; });
          fresh.forEach(function (m) { ids[m.id] = 1; collect(m); });
          pages++;
          if (full && fresh.length && list.more !== false && list.cursor && pages < 10)
            return step(list.cursor).catch(function () {}); // keep what earlier pages found
        });
      }
      step(null).then(function () { loadedFor = id; }, function (e) { err = "Couldn't read this project's files (" + (e && e.message || e) + ")."; })
        .then(function () { loading = false; if (projectId() === id) render(); });
    }

    function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
    var INK = "var(--text-primary,var(--color-text-primary,#f2f2f2))";
    var SUB = "var(--color-text-secondary,rgba(127,127,127,.95))";
    var BG = "var(--regular-opaque-bg,var(--surface-secondary,var(--color-surface-secondary,#1c1c1e)))";
    var LINE = "rgba(127,127,127,.22)";
    function build() {
      if (panel || !document.body) return;
      panel = el("aside", "position:fixed;top:0;right:0;bottom:0;width:300px;max-width:85vw;z-index:2147483000;display:none;" +
        "flex-direction:column;background:" + BG + ";color:" + INK + ";border-left:1px solid " + LINE + ";" +
        "box-shadow:-8px 0 30px rgba(0,0,0,.18);font:13px 'Segoe UI Variable','Segoe UI',sans-serif");
      panel.setAttribute("aria-label", "Project files");
      var head = el("div", "display:flex;align-items:center;gap:8px;padding:14px 14px 8px");
      head.appendChild(el("div", "flex:1;font-weight:600;font-size:14px", "Files"));
      var refresh = el("button", btnCss(), "↻"); refresh.title = "Refresh"; refresh.onclick = function () { load(true); };
      var close = el("button", btnCss(), "✕"); close.title = "Close (Ctrl+Shift+F)"; close.onclick = function () { toggle(false); };
      head.appendChild(refresh); head.appendChild(close);
      searchEl = el("input", "margin:0 14px 8px;padding:7px 10px;border-radius:8px;border:1px solid " + LINE + ";background:transparent;color:inherit;font:inherit;outline:none");
      searchEl.placeholder = "Search files"; searchEl.oninput = render;
      statusEl = el("div", "padding:0 14px 6px;color:" + SUB + ";font-size:12px");
      listEl = el("div", "flex:1;overflow:auto;padding:0 6px 14px");
      panel.appendChild(head); panel.appendChild(searchEl); panel.appendChild(statusEl); panel.appendChild(listEl);
      tab = el("button", "position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482999;display:none;" +
        "writing-mode:vertical-rl;padding:12px 5px;border:1px solid " + LINE + ";border-right:0;border-radius:8px 0 0 8px;" +
        "background:" + BG + ";color:" + SUB + ";font:600 11px 'Segoe UI',sans-serif;letter-spacing:.06em;cursor:pointer;opacity:.75", "FILES");
      tab.title = "Project files (Ctrl+Shift+F)";
      tab.onclick = function () { toggle(true); };
      document.body.appendChild(panel); document.body.appendChild(tab);
    }
    function btnCss() { return "border:0;background:transparent;color:inherit;font:14px 'Segoe UI',sans-serif;cursor:pointer;padding:4px 6px;border-radius:6px;opacity:.7"; }
    function icon(f) {
      var n = f.name.toLowerCase(), k = f.kind;
      if (/^image\//.test(k) || /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/.test(n)) return "🖼";
      if (/pdf/.test(k) || /\.pdf$/.test(n)) return "📕";
      if (/^(audio|video)\//.test(k) || /\.(mp3|wav|m4a|mp4|mov|webm)$/.test(n)) return "🎞";
      if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return "🗜";
      if (/\.(xlsx?|csv)$/.test(n)) return "📊";
      if (/\.(js|ts|tsx|jsx|py|rs|go|java|c|cpp|cs|html|css|json|sh|sql|ya?ml|toml)$/.test(n)) return "⌨";
      return "📄";
    }
    function when(t) {
      if (!t) return "";
      var d = new Date(t), now = new Date();
      return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
    }
    function size(b) { b = +b || 0; return !b ? "" : b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
    function row(f) {
      var r = el("div", "display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer");
      r.onmouseenter = function () { r.style.background = "rgba(127,127,127,.12)"; };
      r.onmouseleave = function () { r.style.background = "transparent"; };
      r.title = f.name + " · preview";
      r.appendChild(el("span", "width:18px;text-align:center", icon(f)));
      var mid = el("div", "flex:1;min-width:0");
      mid.appendChild(el("div", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis", f.name));
      mid.appendChild(el("div", "color:" + SUB + ";font-size:11px", [when(f.when), size(f.size)].filter(Boolean).join(" · ")));
      r.appendChild(mid);
      var copy = el("button", btnCss() + ";font-size:12px", "⧉"); copy.title = "Ask in chat (asks Hark to send it again)";
      copy.onclick = function (e) { e.stopPropagation(); askInChat(f); };
      var dl = el("button", btnCss(), "⤓"); dl.title = "Download to Downloads";
      dl.onclick = function (e) { e.stopPropagation(); download(f); };
      var chat = el("button", btnCss() + ";font-size:13px", "⌕"); chat.title = "Show in chat";
      chat.onclick = function (e) { e.stopPropagation(); goTo(f); };
      r.appendChild(chat); r.appendChild(copy); r.appendChild(dl);
      r.onclick = function () { preview(f); };
      return r;
    }
    function render() {
      if (!panel) return;
      var q = (searchEl.value || "").trim().toLowerCase();
      var all = Object.keys(files).map(function (k) { return files[k]; })
        .filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return b.when - a.when; });
      listEl.textContent = "";
      [["Sent by Hark", false], ["Uploaded by you", true]].forEach(function (g) {
        var part = all.filter(function (f) { return f.mine === g[1]; });
        if (!part.length) return;
        listEl.appendChild(el("div", "padding:10px 8px 4px;color:" + SUB + ";font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em", g[0] + " · " + part.length));
        part.forEach(function (f) { listEl.appendChild(row(f)); });
      });
      statusEl.textContent = err || (loading ? "Reading this project's files…" : (all.length ? "" : (q ? "No files match." : "No files in this project's chat yet.")));
    }
    // "Show in chat": scrolls to the message and outlines it. When it isn't
    // loaded yet, scrolls the chat up batch by batch so Hark loads older
    // messages, until it gets there. Never reloads the page.
    var finding = 0;
    function msgNode(id) {
      try { return document.querySelector('[data-message-id="' + CSS.escape(String(id)) + '"]'); } catch (e) { return null; }
    }
    // The part of the page the chat scrolls in: the nearest scrolling
    // parent of a message, else the tallest scrolling area outside the
    // panel, else the page itself.
    function scrolls(n) { return /(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4; }
    function scroller() {
      var any = document.querySelector("[data-message-id]");
      for (var n = any && any.parentElement; n && n !== document.body; n = n.parentElement) if (scrolls(n)) return n;
      var best = null, all = document.querySelectorAll("main *, [role=main] *, body div");
      for (var i = 0; i < all.length && i < 4000; i++) {
        var c = all[i];
        if (panel && panel.contains(c)) continue;
        if (viewer && viewer.contains(c)) continue;
        if (c.clientHeight < 200 || !scrolls(c)) continue;
        if (!best || c.scrollHeight > best.scrollHeight) best = c;
      }
      if (best) return best;
      var se = document.scrollingElement || document.documentElement;
      return se && se.scrollHeight > window.innerHeight + 4 ? se : null;
    }
    // Scrolls to the oldest end (Hark may lay the chat out bottom-up).
    function toTop(sc) {
      var rev = /column-reverse/.test(getComputedStyle(sc).flexDirection);
      sc.scrollTop = rev ? -sc.scrollHeight : 0;
    }
    function flash(node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      var old = node.style.outline, oldOff = node.style.outlineOffset;
      node.style.outline = "2px solid rgba(127,127,255,.65)"; node.style.outlineOffset = "4px";
      setTimeout(function () { node.style.outline = old; node.style.outlineOffset = oldOff; }, 1800);
    }
    // Writes a request for the file into Hark's message box (you press Enter).
    function askInChat(f) {
      closeViewer();
      var c = [].slice.call(document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"]'))
        .filter(function (n) { return visible(n) && !(panel && panel.contains(n)); });
      c.sort(function (x, y) { return y.getBoundingClientRect().bottom - x.getBoundingClientRect().bottom; });
      var box = c[0];
      var text = "Please send me " + f.name + " again" + (f.when ? " (from " + day(f.when) + ")" : "") + ".";
      if (!box) { try { navigator.clipboard.writeText(text); } catch (e) {} banner("Couldn't find the message box. The request is copied; paste it there.", 4000); return; }
      setText(box, text);
      try { box.focus(); } catch (e) {}
    }
    function day(t) { try { return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch (e) { return ""; } }
    function oldestLoaded() {
      var all = document.querySelectorAll("[data-message-id]"), best = 0;
      for (var i = 0; i < all.length; i++) {
        var m = msgs[all[i].getAttribute("data-message-id")];
        if (m && m.when && (!best || m.when < best)) best = m.when;
      }
      return best;
    }
    // Keeps loading older messages until the chat reaches the file's date,
    // waiting for each batch to arrive, then outlines the message. Stops
    // when it's found, when Hark has nothing older, or on Cancel / Esc.
    function goTo(f) {
      if (!f.msg) { banner("This file isn't linked to a message.", 2500); return; }
      var node = msgNode(f.msg);
      if (node) { flash(node); return; }
      var run = ++finding, idle = 0, target = (msgs[f.msg] && msgs[f.msg].when) || f.when || 0;
      function cancel() { finding++; if (bannerEl) bannerEl.style.display = "none"; document.removeEventListener("keydown", esc, true); }
      function esc(e) { if (e.key === "Escape" && run === finding) { e.stopPropagation(); cancel(); } }
      document.addEventListener("keydown", esc, true);
      function done(msg) { document.removeEventListener("keydown", esc, true); if (msg) banner(msg, 4500); else if (bannerEl) bannerEl.style.display = "none"; }
      function notFound() {
        document.removeEventListener("keydown", esc, true);
        banner("Couldn't find it in the chat. Ask Hark to send it again.", 9000, { label: "Ask in chat", fn: function () { askInChat(f); } });
      }
      function progress() {
        var at = oldestLoaded();
        banner("Going back to " + (target ? day(target) : "that message") + "…" + (at ? "  Now at " + day(at) + "." : ""), 0, { label: "Cancel", fn: cancel });
      }
      progress();
      (function step() {
        if (run !== finding) return;
        var n = msgNode(f.msg);
        if (n) { done(); flash(n); return; }
        var sc = scroller();
        if (!sc) { notFound(); return; }
        var before = document.querySelectorAll("[data-message-id]").length, h = sc.scrollHeight;
        toTop(sc);
        var waited = 0;
        (function wait() {
          if (run !== finding) return;
          if (msgNode(f.msg)) { step(); return; }
          var grew = document.querySelectorAll("[data-message-id]").length > before || sc.scrollHeight > h + 4;
          if (grew) { idle = 0; progress(); setTimeout(step, 120); return; }
          if ((waited += 150) < 2500) { setTimeout(wait, 150); return; }
          // Nothing new after a while: nudge once more, then give up.
          if (++idle >= 3) { notFound(); return; }
          sc.scrollTop += /column-reverse/.test(getComputedStyle(sc).flexDirection) ? -40 : 40; setTimeout(step, 200);
        })();
      })();
    }

    // Built-in viewer: images, PDF, text and code, audio and video. Other
    // files show their name with a Download button.
    var viewer = null, viewerUrl = null;
    var TEXT_EXT = /\.(txt|md|markdown|csv|tsv|log|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|js|mjs|cjs|ts|tsx|jsx|py|rb|rs|go|java|kt|c|h|cpp|hpp|cs|php|swift|sh|bash|ps1|bat|sql|html?|css|scss|less|vue|svelte|lua|r|dart|gradle)$/i;
    function kindOf(f) {
      var n = f.name.toLowerCase(), k = (f.kind || "").toLowerCase();
      if (/^image\//.test(k) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(n)) return "image";
      if (/pdf/.test(k) || /\.pdf$/.test(n)) return "pdf";
      if (/^audio\//.test(k) || /\.(mp3|wav|m4a|ogg|flac|aac)$/.test(n)) return "audio";
      if (/^video\//.test(k) || /\.(mp4|webm|mov|m4v)$/.test(n)) return "video";
      if (/^text\//.test(k) || /json|xml|javascript|typescript/.test(k) || TEXT_EXT.test(n)) return "text";
      return "other";
    }
    function closeViewer() {
      if (viewer) { viewer.remove(); viewer = null; }
      if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    }
    function absUrl(f) { return f.url ? new URL(f.url, location.href).href : ""; }
    // Reads a file. First the same plain request Hark's own preview makes;
    // if the page can't (blocked or refused), the app fetches it itself,
    // outside the page, for Hark's own hosts and file storage. Each attempt
    // is noted so a failure can say why.
    function safeAddr(u) { try { var x = new URL(u); return x.host + x.pathname; } catch (e) { return String(u).split("?")[0]; } }
    function b64Blob(b64, type) {
      var bin = atob(b64), n = bin.length, a = new Uint8Array(n);
      for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
      return new Blob([a], { type: type || "application/octet-stream" });
    }
    function fetchFile(u) {
      var tried = [];
      function fail(status) { var e = new Error(tried.join("; ")); e.status = status; e.tried = tried; e.addr = safeAddr(u); throw e; }
      var pageStatus = 0;
      var opts = isStorage(u) ? { cache: "no-store" } : {};
      return realFetch.call(window, u, opts).then(function (r) {
        if (r.ok) return r.blob();
        pageStatus = r.status; tried.push("page: HTTP " + r.status); throw 0;
      }).catch(function (e) {
        if (e !== 0) tried.push("page: " + (e && e.name === "TypeError" ? "blocked by the browser" : (e && e.message) || "error"));
        if (!/^https:/.test(u)) fail(pageStatus);
        return invoke("fetch_file", { url: u }).then(function (r) {
          if (r && r.ok) return b64Blob(r.data, r.type);
          tried.push("app: " + (r && r.status ? "HTTP " + r.status : (r && r.error) || "failed"));
          fail((r && r.status) || pageStatus);
        }, function (x) {
          if (x && x.tried) throw x;
          tried.push("app: " + ((x && x.message) || String(x || "unavailable")));
          fail(pageStatus);
        });
      });
    }
    // Links from Hark expire; read the history again for a fresh one.
    function freshen(f) {
      return new Promise(function (res) {
        loadedFor = null; load(true);
        var t = 0, iv = setInterval(function () {
          if (!loading || ++t > 40) { clearInterval(iv); res(files[f.key] || f); }
        }, 250);
      });
    }
    function preview(f, retried) {
      closeViewer();
      viewer = el("div", "position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center");
      viewer.onclick = function (e) { if (e.target === viewer) closeViewer(); };
      var box = el("div", "width:min(1100px,92vw);height:min(86vh,1000px);display:flex;flex-direction:column;background:" + BG + ";color:" + INK + ";" +
        "border:1px solid " + LINE + ";border-radius:14px;overflow:hidden;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.4);font:13px 'Segoe UI Variable','Segoe UI',sans-serif");
      var head = el("div", "display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid " + LINE);
      head.appendChild(el("div", "flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", f.name));
      var chat = el("button", btnCss(), "⌕"); chat.title = "Show in chat"; chat.onclick = function () { closeViewer(); goTo(f); };
      var info = el("button", btnCss() + ";width:auto;padding:0 10px", "Message"); info.title = "The message this file came in";
      var pane = null;
      info.onclick = function () {
        if (pane) { pane.remove(); pane = null; return; }
        pane = el("div", "position:absolute;top:47px;right:0;bottom:0;width:min(400px,85%);background:" + BG + ";border-left:1px solid " + LINE +
          ";overflow:auto;padding:14px 16px;box-sizing:border-box;box-shadow:-10px 0 30px rgba(0,0,0,.25)");
        var m = msgs[f.msg], req = null;
        if (m && m.role === "user") req = m;
        else if (m) {
          Object.keys(msgs).forEach(function (k) { var x = msgs[k]; if (x.role === "user" && x.when <= m.when && (!req || x.when > req.when)) req = x; });
        }
        function block(title, x) {
          pane.appendChild(el("div", "font-weight:600;margin:4px 0 2px", title));
          pane.appendChild(el("div", "color:" + SUB + ";font-size:11px;margin-bottom:6px", when(x.when)));
          var t = el("div", "white-space:pre-wrap;word-break:break-word;line-height:1.5;margin-bottom:16px;unicode-bidi:plaintext", x.text || "(no text, only files)");
          t.dir = "auto"; pane.appendChild(t);
        }
        if (!m) pane.appendChild(el("div", "color:" + SUB, "This message isn't in the history the panel read."));
        else {
          if (req) block(req === m ? "You" : "Your request", req);
          if (m !== req) block("Hark", m);
        }
        var go = el("button", "border:1px solid " + LINE + ";background:transparent;color:inherit;padding:7px 14px;border-radius:8px;cursor:pointer;font:inherit", "⌕  Go there");
        go.onclick = function () { closeViewer(); goTo(f); };
        pane.appendChild(go);
        box.appendChild(pane);
      };
      var dl = el("button", btnCss(), "⤓"); dl.title = "Download to Downloads"; dl.onclick = function () { download(f); };
      var x = el("button", btnCss(), "✕"); x.title = "Close (Esc)"; x.onclick = closeViewer;
      head.appendChild(info); head.appendChild(chat); head.appendChild(dl); head.appendChild(x);
      var body = el("div", "flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center");
      box.appendChild(head); box.appendChild(body); viewer.appendChild(box); document.body.appendChild(viewer);
      function note(text, withDl, err) {
        body.textContent = "";
        var w = el("div", "text-align:center;color:" + SUB + ";padding:30px");
        w.appendChild(el("div", "font-size:34px;margin-bottom:10px", icon(f)));
        w.appendChild(el("div", "color:" + INK + ";font-weight:600;margin-bottom:4px", f.name));
        w.appendChild(el("div", "margin-bottom:14px", text));
        var bcss = "border:1px solid " + LINE + ";background:transparent;color:inherit;padding:7px 14px;border-radius:8px;cursor:pointer;font:inherit;margin:0 4px";
        if (withDl) { var b = el("button", bcss, "⤓  Download"); b.onclick = function () { download(f); }; w.appendChild(b); }
        if (err) {
          w.insertBefore(el("div", "margin:-8px 0 14px;font-size:12px;opacity:.85", (err.tried || [String(err.message || err)]).join(" · ")), w.lastChild && withDl ? w.lastChild : null);
          var c = el("button", bcss, "⧉  Copy details");
          c.onclick = function () {
            var d = { file: f.name, type: f.kind || "", kind: kindOf(f), from: f.from || "", address: err.addr || safeAddr(absUrl(f)), tried: err.tried || [String(err.message || err)] };
            try { navigator.clipboard.writeText(JSON.stringify(d, null, 2)); c.textContent = "✓  Copied"; } catch (x) {}
          };
          w.appendChild(c);
          var ask = el("button", bcss, "⧉  Ask in chat");
          ask.onclick = function () { askInChat(f); };
          w.appendChild(ask);
        }
        body.appendChild(w);
      }
      var u = absUrl(f), kind = kindOf(f);
      if (!u) { note("No link for this file. Try Show in chat.", false); return; }
      if (kind === "other") { note([size(f.size), "No preview for this type."].filter(Boolean).join(" · "), true); return; }
      note("Loading…", false);
      function failed(e) {
        if (!retried && e && (e.status === 403 || e.status === 400 || e.status === 404)) {
          note("Refreshing the link…", false);
          freshen(f).then(function (g) { if (viewer) preview(g, true); });
        } else note("Couldn't preview this file.", true, e);
      }
      if (kind === "image" || kind === "audio" || kind === "video") {
        var m = el(kind === "image" ? "img" : kind, "max-width:100%;max-height:100%;object-fit:contain");
        if (kind !== "image") m.controls = true;
        m.onload = function () { body.textContent = ""; body.appendChild(m); };
        var viaBlob = false;
        m.onerror = function () {
          if (viaBlob) { note("Couldn't preview this file.", true, { tried: ["the file loaded but couldn't be shown"] }); return; }
          viaBlob = true;
          fetchFile(u).then(function (b) {
            if (!viewer) return;
            viewerUrl = URL.createObjectURL(b);
            m.src = viewerUrl;
            if (kind !== "image") { body.textContent = ""; body.appendChild(m); }
          }, failed);
        };
        m.src = u;
        if (kind !== "image") { body.textContent = ""; body.appendChild(m); }
        return;
      }
      fetchFile(u).then(function (b) {
        if (!viewer) return;
        if (kind === "pdf") {
          viewerUrl = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
          body.textContent = "";
          body.appendChild(el("iframe", "width:100%;height:100%;border:0;background:#fff")).src = viewerUrl;
          return;
        }
        var cut = b.size > 1500000;
        return (cut ? b.slice(0, 1500000) : b).arrayBuffer().then(function (buf) {
          if (!viewer) return;
          var txt = new TextDecoder("utf-8").decode(buf);
          body.textContent = ""; body.style.alignItems = "stretch"; body.style.justifyContent = "stretch";
          var pre = el("pre", "margin:0;padding:14px 16px;width:100%;box-sizing:border-box;white-space:pre-wrap;word-break:break-word;" +
            "font:12.5px/1.55 'Cascadia Code',Consolas,monospace;unicode-bidi:plaintext", txt + (cut ? "\n\n… (preview cut at 1.5 MB; download for the whole file)" : ""));
          pre.dir = "auto";
          body.appendChild(pre);
        });
      }, failed);
    }
    function download(f) {
      function viaPage(u) {
        fetchFile(u)
          .then(function (b) { var o = URL.createObjectURL(b), a = el("a", "display:none"); a.href = o; a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(o); a.remove(); }, 4000); })
          .catch(function (e) { banner("Couldn't download " + f.name + ". " + ((e && e.tried) ? e.tried.join(" · ") : ""), 5000); });
      }
      if (!f.url) { banner("No link for this file.", 2500); return; }
      var abs = new URL(f.url, location.href).href;
      if (/^https:/.test(abs) && new URL(abs).host !== location.host) {
        invoke("download_file", { url: abs }).then(function (ok) { if (!ok) viaPage(abs); }, function () { viaPage(abs); });
      } else viaPage(abs);
    }
    function sync() {
      var id = projectId();
      build();
      if (!panel) return;
      var on = enabled && !!id;
      panel.style.display = on && open ? "flex" : "none";
      tab.style.display = on && !open ? "block" : "none";
      if (on && open && id !== pid) { pid = id; load(true); }
      if (!on || !open) pid = on ? pid : null;
      clearInterval(pollTimer); pollTimer = null;
      if (on && open) pollTimer = setInterval(function () { if (!document.hidden) load(false); }, 20000);
    }
    function toggle(want) {
      open = typeof want === "boolean" ? want : !open;
      try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (e) {}
      if (open && !projectId()) { banner("Open a project to see its files.", 2500); open = false; }
      if (!open) pid = null;
      sync();
      if (open && searchEl) searchEl.focus();
    }
    window.__deskToggleFiles = toggle;
    window.__deskFilesSetting = function (on) { enabled = !!on; sync(); };
    window.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); e.stopPropagation(); toggle(); }
      else if (e.key === "Escape" && viewer) { e.preventDefault(); e.stopPropagation(); closeViewer(); }
      else if (e.key === "Escape" && open && panel && panel.contains(document.activeElement)) toggle(false);
    }, true);
    var lastPath = "";
    setInterval(function () { if (location.pathname !== lastPath) { lastPath = location.pathname; sync(); } }, 800);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync); else sync();
  })();

  // Project groups were removed in 1.3.0; clear what older versions saved.
  try { localStorage.removeItem("deskForHark.projectGroups.v1"); } catch (e) {}
})();
