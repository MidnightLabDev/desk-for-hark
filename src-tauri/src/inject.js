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
  function banner(text, ms) {
    if (!document.body) return;
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.setAttribute("role", "status");
      bannerEl.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;" +
        "background:#1e1f24;color:#f5f5f7;border:1px solid rgba(255,255,255,.14);border-radius:12px;" +
        "padding:10px 16px;font:500 13px 'Segoe UI',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none";
      document.body.appendChild(bannerEl);
    }
    bannerEl.textContent = text;
    bannerEl.style.display = "block";
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(function () { bannerEl.style.display = "none"; }, ms);
  }
  window.addEventListener("offline", function () { banner("You're offline. Hark will reconnect automatically."); });
  window.addEventListener("online", function () {
    banner("Back online. Reloading…", 1500);
    setTimeout(function () { location.reload(); }, 800);
  });

  // Project groups were removed in 1.3.0; clear what older versions saved.
  try { localStorage.removeItem("deskForHark.projectGroups.v1"); } catch (e) {}
})();
