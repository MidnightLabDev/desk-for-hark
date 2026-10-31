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
  var PALETTES = {
    midnight: { dark: true, caption: "#000000", text: "#e8e8ea", accent: "#7aa2ff", vars: {
      "--color-surface-primary": "#000000", "--color-surface-secondary": "#0c0c0e",
      "--color-neutral-black": "#000000", "--color-neutral-extra-dark-gray": "#0c0c0e",
      "--color-text-primary": "#e8e8ea", "--color-text-secondary": "#8a8f9c", "--color-text-small": "#a3a8b4" } },
    teal: { dark: true, caption: "#0b1a24", text: "#eaf6f5", accent: "#19b3a6", vars: {
      "--color-surface-primary": "#0b1a24", "--color-surface-secondary": "#102632",
      "--color-neutral-black": "#0b1a24", "--color-neutral-extra-dark-gray": "#102632",
      "--color-text-primary": "#eaf6f5", "--color-text-secondary": "#8fb3b5", "--color-text-small": "#a9c8c9" } },
    paper: { dark: false, caption: "#f7f3ea", text: "#1f1d1a", accent: "#b4562a", light: true, vars: {
      "--color-surface-primary": "#f7f3ea", "--color-surface-secondary": "#efe9dc",
      "--color-neutral-black": "#f7f3ea", "--color-neutral-extra-dark-gray": "#efe9dc",
      "--color-text-primary": "#1f1d1a", "--color-text-secondary": "#6b665c", "--color-text-small": "#57534a",
      "--color-utility-white-scrim-8": "rgba(0,0,0,.06)", "--color-utility-white-scrim-12": "rgba(0,0,0,.10)",
      "--color-border-color": "rgba(0,0,0,.10)", "--color-border-color-2": "rgba(0,0,0,.14)",
      "--text": "#1f1d1a" } },
    contrast: { dark: true, caption: "#000000", text: "#ffffff", accent: "#ffd400", vars: {
      "--color-surface-primary": "#000000", "--color-surface-secondary": "#111111",
      "--color-neutral-black": "#000000", "--color-neutral-extra-dark-gray": "#111111",
      "--color-text-primary": "#ffffff", "--color-text-secondary": "#d6d6d6", "--color-text-small": "#e6e6e6",
      "--color-border-color": "rgba(255,255,255,.45)", "--color-border-color-2": "rgba(255,255,255,.6)" },
      extra: "*:focus-visible{outline:2px solid #ffd400 !important;outline-offset:2px !important}" +
             "a{text-decoration:underline !important}" },
    hark: { dark: true, caption: "", text: "", accent: "", vars: {} }
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
    if (vars.length) css += ":root,:root[data-theme]{" + vars.join(";") + "}";
    if (pal.vars["--color-surface-primary"]) {
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
  }
  window.__deskApplyTheme = applyTheme;

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
})();
