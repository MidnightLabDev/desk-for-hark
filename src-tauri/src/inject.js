// Injected by Desk for Hark into every page of the main window.
// Native commands only work on https://app.hark.com (see capabilities/).
// - Web notifications -> native Windows toasts, unread badge.
// - Keyboard: Ctrl+R/F5 reload, Ctrl +/-/0 and Ctrl+wheel zoom, Ctrl+P print.
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

  // ---- Keyboard: reload, zoom, print ----------------------------------
  window.addEventListener("keydown", function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var k = e.key;
    if ((ctrl && !e.shiftKey && (k === "r" || k === "R")) || k === "F5") {
      e.preventDefault(); location.reload(); return;
    }
    if (!ctrl || e.altKey) return;
    if (e.shiftKey && (k === "g" || k === "G")) {
      e.preventDefault(); if (window.__deskGroups) window.__deskGroups.toggle(); return;
    }
    if (k === "p" || k === "P") {
      e.preventDefault(); window.print();
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
             accent: o.accent, body: !o.light, vars: v, extra: o.extra || "", snow: !!o.snow };
  }
  var PALETTES = {
    midnight: palette({ bg: "#000000", surface: "#0c0c0e", panel: "#101013", ink: "#e8e8ea", sub: "#8a8f9c", accent: "#7aa2ff" }),
    teal: palette({ bg: "#0b1a24", surface: "#102632", panel: "#12303d", ink: "#eaf6f5", sub: "#8fb3b5", accent: "#19b3a6" }),
    paper: palette({ light: true, bg: "#f4efe4", surface: "#ebe4d6", panel: "#fbf8f2", ink: "#2a2620", sub: "#5f594e",
                     accent: "#b4562a", caption: "#ebe4d6" }),
    christmas: palette({ bg: "#0e2419", surface: "#143222", panel: "#173a28", ink: "#f7f1e3", sub: "#b8c8b4",
                         accent: "#d23a44", snow: true,
                         extra: "a:not([class]){color:#e3bf5a !important}" }),
    contrast: palette({ bg: "#000000", surface: "#111111", panel: "#141414", ink: "#ffffff", sub: "#d6d6d6", accent: "#ffd400",
                        strong: true,
                        extra: "*:focus-visible{outline:2px solid #ffd400 !important;outline-offset:2px !important}" +
                               "a{text-decoration:underline !important}" }),
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
    if (name === "windows") name = p.windowsLight ? "paper" : "hark";
    if (name === "schedule") name = scheduledDark(p) ? "midnight" : "paper";
    var pal = PALETTES[name] || PALETTES.hark;
    var accent = p.accent || (p.theme === "windows" ? p.windowsAccent : "") || pal.accent;
    return { name: name, pal: pal, accent: accent };
  }

  var currentPayload = null;
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
    if (pal.light) document.documentElement.setAttribute("data-theme", "light");
    else if (out.r.name !== "hark" && document.documentElement.getAttribute("data-theme") === "light")
      document.documentElement.setAttribute("data-theme", "dark");
    quiet(invoke("title_bar", { caption: pal.caption || "", text: pal.text || "", dark: !!pal.dark }));
    snow(!!pal.snow && p.snow !== false);
  }
  window.__deskApplyTheme = applyTheme;

  // ---- Snowfall (Christmas theme; can be turned off in Settings) -----------
  // A see-through canvas on top that ignores the mouse, so nothing in Hark
  // moves or stops being clickable.
  var snowCanvas = null, snowRaf = 0, flakes = [];
  function snow(on) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) on = false;
    if (!on) {
      if (snowCanvas) { cancelAnimationFrame(snowRaf); snowCanvas.remove(); snowCanvas = null; }
      return;
    }
    if (snowCanvas || !document.body) return;
    snowCanvas = document.createElement("canvas");
    snowCanvas.setAttribute("aria-hidden", "true");
    snowCanvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;opacity:.55";
    document.body.appendChild(snowCanvas);
    var ctx = snowCanvas.getContext("2d");
    function size() { snowCanvas.width = innerWidth; snowCanvas.height = innerHeight; }
    size(); addEventListener("resize", size);
    flakes = [];
    for (var i = 0; i < 70; i++) flakes.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.2, s: .2 + Math.random() * .6, d: Math.random() * 6 });
    var last = 0;
    (function tick(t) {
      if (!snowCanvas) return;
      snowRaf = requestAnimationFrame(tick);
      if (document.hidden || t - last < 33) return;
      last = t;
      var w = snowCanvas.width, h = snowCanvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      flakes.forEach(function (f) {
        f.y += f.s / h * 2.2; f.d += .01;
        if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
        var x = (f.x * w + Math.sin(f.d) * 12 + w) % w;
        ctx.moveTo(x, f.y * h); ctx.arc(x, f.y * h, f.r, 0, Math.PI * 2);
      });
      ctx.fill();
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

  // ---- Project groups -------------------------------------------------------
  // Hark has no folders for projects, so these live in the app only: saved
  // on this PC (localStorage for app.hark.com), never sent anywhere. Open
  // with Ctrl+Shift+G or the tray menu.
  var GKEY = "deskForHark.projectGroups.v1";
  var GCOLORS = ["#7aa2ff", "#19b3a6", "#e3bf5a", "#d23a44", "#b07cff", "#5ccf7a", "#ff8a3d", "#9aa0aa"];
  function gLoad() {
    try { var d = JSON.parse(localStorage.getItem(GKEY) || "null"); if (d && Array.isArray(d.groups)) return d; } catch (e) {}
    return { groups: [] };
  }
  function gSave(d) { try { localStorage.setItem(GKEY, JSON.stringify(d)); } catch (e) {} decorateSidebar(); }
  function gid() { return Math.random().toString(36).slice(2, 10); }
  function currentProject() {
    var m = /^\/project\/([^\/?#]+)/.exec(location.pathname);
    if (!m) return null;
    var name = (document.title || "").replace(/\s*[|·–-]\s*Hark\s*$/i, "").replace(/^\(\d+\)\s*/, "").trim();
    var link = document.querySelector('a[href$="/project/' + m[1] + '"]');
    if (link && link.textContent.trim()) name = link.textContent.trim();
    return { id: m[1], name: name || "Project" };
  }
  function openProject(id) {
    var link = document.querySelector('a[href$="/project/' + id + '"]');
    if (link) { link.click(); return; }
    location.assign("/project/" + id);
  }

  // A coloured dot next to grouped projects in Hark's own sidebar (best effort).
  var decorating = false;
  function decorateSidebar() {
    if (decorating) return;
    decorating = true;
    try {
      var map = {};
      gLoad().groups.forEach(function (g) { g.items.forEach(function (it) { map[it.id] = g; }); });
      document.querySelectorAll('a[href*="/project/"]').forEach(function (a) {
        var m = /\/project\/([^\/?#]+)$/.exec(a.getAttribute("href") || "");
        var g = m && map[m[1]];
        if (g) { a.setAttribute("data-desk-group", g.name); a.style.setProperty("--desk-dot", g.color); a.title = "Group: " + g.name; }
        else if (a.hasAttribute("data-desk-group")) { a.removeAttribute("data-desk-group"); a.style.removeProperty("--desk-dot"); a.removeAttribute("title"); }
      });
    } catch (e) {}
    decorating = false;
  }
  var dotStyle = document.createElement("style");
  dotStyle.textContent = 'a[data-desk-group]{position:relative}a[data-desk-group]::after{content:"";position:absolute;right:8px;top:50%;' +
    'width:7px;height:7px;margin-top:-3.5px;border-radius:50%;background:var(--desk-dot);pointer-events:none}';
  (document.head || document.documentElement).appendChild(dotStyle);
  var decoTimer = 0;
  new MutationObserver(function () { clearTimeout(decoTimer); decoTimer = setTimeout(decorateSidebar, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });

  var gHost = null, gRoot = null;
  function gEsc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gRender() {
    if (!gRoot) return;
    var d = gLoad(), cur = currentProject();
    var inGroup = cur && d.groups.some(function (g) { return g.items.some(function (i) { return i.id === cur.id; }); });
    var h = '<div class="hd"><b>Project groups</b><button data-a="close" title="Close (Esc)">✕</button></div>';
    if (cur) {
      h += '<div class="cur"><span>' + gEsc(cur.name) + '</span>' + (inGroup ? '<em>grouped</em>' :
        (d.groups.length ? '<select data-a="addcur"><option value="">Add to group…</option>' +
          d.groups.map(function (g) { return '<option value="' + g.id + '">' + gEsc(g.name) + '</option>'; }).join("") + '</select>' : '')) + '</div>';
    } else {
      h += '<p class="hint">Open a project, then add it to a group here.</p>';
    }
    h += '<div class="list">';
    d.groups.forEach(function (g) {
      h += '<div class="g" data-g="' + g.id + '"><div class="gh"><button class="tw" data-a="fold">' + (g.collapsed ? "▸" : "▾") + '</button>' +
        '<button class="dot" data-a="color" style="background:' + g.color + '" title="Change colour"></button>' +
        '<span class="gn" data-a="rename" title="Double-click to rename">' + gEsc(g.name) + '</span><small>' + g.items.length + '</small>' +
        '<button data-a="delg" title="Delete group">🗑</button></div>';
      if (!g.collapsed) {
        h += '<div class="items">' + (g.items.length ? "" : '<p class="hint">Drag projects here.</p>');
        g.items.forEach(function (it) {
          h += '<div class="it" draggable="true" data-i="' + gEsc(it.id) + '"><span data-a="open">' + gEsc(it.name) + '</span>' +
            '<button data-a="deli" title="Remove from group">✕</button></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div><form class="new"><input name="n" placeholder="New group name" maxlength="40"><button>Add</button></form>' +
      '<p class="hint">Saved on this PC only. Hark itself isn\'t changed.</p>';
    gRoot.querySelector(".panel").innerHTML = h;
  }
  function gFind(d, gidv) { return d.groups.filter(function (g) { return g.id === gidv; })[0]; }
  function gBuild() {
    gHost = document.createElement("div");
    gHost.style.cssText = "position:fixed;top:0;right:0;bottom:0;z-index:2147483600;display:none";
    gRoot = gHost.attachShadow({ mode: "open" });
    gRoot.innerHTML = '<style>' +
      ':host{all:initial}.panel{box-sizing:border-box;width:300px;height:100vh;overflow:auto;padding:14px;' +
      'background:var(--regular-solid-bg,rgba(29,29,31,.96));color:var(--text-primary,#f5f5f7);' +
      'border-left:1px solid var(--stroke-primary,rgba(245,245,247,.14));box-shadow:-12px 0 40px rgba(0,0,0,.3);' +
      'font:13px/1.4 "Segoe UI Variable","Segoe UI",sans-serif;backdrop-filter:blur(20px)}' +
      'button,select,input{font:inherit;color:inherit}button{background:none;border:0;cursor:pointer;padding:2px 4px;border-radius:6px}' +
      'button:hover{background:var(--hover-wash,rgba(245,245,247,.08))}' +
      '.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.hd b{font-size:15px}' +
      '.cur{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px;border-radius:10px;margin-bottom:10px;' +
      'background:var(--fill-tertiary,rgba(245,245,247,.05))}.cur span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
      '.cur em{opacity:.6;font-style:normal}select,input{background:var(--fill-tertiary,rgba(245,245,247,.06));border:1px solid var(--stroke-primary,rgba(245,245,247,.14));border-radius:8px;padding:4px 6px}' +
      'select option{color:#111}.g{margin-bottom:6px}.gh{display:flex;align-items:center;gap:6px;padding:4px 2px}' +
      '.gh .gn{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default}.gh small{opacity:.55}' +
      '.dot{width:12px;height:12px;border-radius:50%;padding:0}.tw{width:20px;opacity:.7}' +
      '.items{margin-left:26px;border-radius:8px;min-height:6px}.items.over{outline:1px dashed currentColor}' +
      '.it{display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-radius:8px;cursor:pointer}' +
      '.it:hover{background:var(--hover-wash,rgba(245,245,247,.08))}.it span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.it button{opacity:0}.it:hover button{opacity:.7}.new{display:flex;gap:6px;margin-top:12px}.new input{flex:1}' +
      '.new button{border:1px solid var(--stroke-primary,rgba(245,245,247,.14))}.hint{opacity:.6;font-size:12px;margin:6px 0}' +
      '.gn input{width:100%}</style><div class="panel"></div>';
    var panel = gRoot.querySelector(".panel");
    panel.addEventListener("click", function (e) {
      var t = e.target.closest("[data-a]"); if (!t) return;
      var a = t.getAttribute("data-a"), d = gLoad();
      var gEl = t.closest("[data-g]"), g = gEl && gFind(d, gEl.getAttribute("data-g"));
      var iEl = t.closest("[data-i]");
      if (a === "close") return toggle(false);
      if (a === "fold" && g) { g.collapsed = !g.collapsed; gSave(d); }
      else if (a === "color" && g) { g.color = GCOLORS[(GCOLORS.indexOf(g.color) + 1) % GCOLORS.length]; gSave(d); }
      else if (a === "delg" && g) { if (!g.items.length || confirm('Delete the group "' + g.name + '"? Your projects stay in Hark.')) { d.groups = d.groups.filter(function (x) { return x !== g; }); gSave(d); } }
      else if (a === "deli" && g && iEl) { g.items = g.items.filter(function (i) { return i.id !== iEl.getAttribute("data-i"); }); gSave(d); }
      else if (a === "open" && iEl) { openProject(iEl.getAttribute("data-i")); return; }
      else return;
      gRender();
    });
    panel.addEventListener("dblclick", function (e) {
      var t = e.target.closest('[data-a="rename"]'); if (!t) return;
      var gidv = t.closest("[data-g]").getAttribute("data-g");
      var inp = document.createElement("input"); inp.value = t.textContent; inp.maxLength = 40;
      t.textContent = ""; t.appendChild(inp); inp.focus(); inp.select();
      function done(ok) {
        var d = gLoad(), g = gFind(d, gidv);
        if (ok && g && inp.value.trim()) { g.name = inp.value.trim(); gSave(d); }
        gRender();
      }
      inp.addEventListener("keydown", function (k) { k.stopPropagation(); if (k.key === "Enter") done(true); else if (k.key === "Escape") done(false); });
      inp.addEventListener("blur", function () { done(true); });
    });
    panel.addEventListener("change", function (e) {
      if (e.target.getAttribute("data-a") !== "addcur" || !e.target.value) return;
      var d = gLoad(), g = gFind(d, e.target.value), cur = currentProject();
      if (g && cur) { g.items.push(cur); gSave(d); }
      gRender();
    });
    panel.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = e.target.n.value.trim(); if (!name) return;
      var d = gLoad(), cur = currentProject();
      var g = { id: gid(), name: name, color: GCOLORS[d.groups.length % GCOLORS.length], collapsed: false, items: [] };
      var grouped = cur && d.groups.some(function (x) { return x.items.some(function (i) { return i.id === cur.id; }); });
      if (cur && !grouped) g.items.push(cur);
      d.groups.push(g); gSave(d); gRender();
    });
    // Drag a project between groups.
    var dragId = null, dragFrom = null;
    panel.addEventListener("dragstart", function (e) {
      var it = e.target.closest("[data-i]"); if (!it) return;
      dragId = it.getAttribute("data-i"); dragFrom = it.closest("[data-g]").getAttribute("data-g");
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId);
    });
    panel.addEventListener("dragover", function (e) {
      var gEl = e.target.closest("[data-g]"); if (!gEl || !dragId) return;
      e.preventDefault(); e.stopPropagation();
    });
    panel.addEventListener("drop", function (e) {
      var gEl = e.target.closest("[data-g]"); if (!gEl || !dragId) return;
      e.preventDefault(); e.stopPropagation();
      var d = gLoad(), from = gFind(d, dragFrom), to = gFind(d, gEl.getAttribute("data-g"));
      if (from && to && from !== to) {
        var item = from.items.filter(function (i) { return i.id === dragId; })[0];
        from.items = from.items.filter(function (i) { return i.id !== dragId; });
        if (item) to.items.push(item);
        gSave(d);
      }
      dragId = null; gRender();
    });
    gHost.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); e.stopPropagation(); });
    document.body.appendChild(gHost);
  }
  function toggle(force) {
    if (!document.body) return;
    if (!gHost) gBuild();
    var show = typeof force === "boolean" ? force : gHost.style.display === "none";
    gHost.style.display = show ? "block" : "none";
    if (show) gRender();
  }
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) { lastPath = location.pathname; if (gHost && gHost.style.display !== "none") gRender(); }
  }, 800);
  window.__deskGroups = { toggle: toggle };
})();
