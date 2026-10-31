// Desk for Hark: an unofficial Windows desktop app for https://app.hark.com
// Not affiliated with, endorsed by, or supported by Hark.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod win;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Theme, Url, UserAttentionType, Webview,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

pub const MAIN: &str = "main";
const RELEASES_URL: &str = "https://github.com/MidnightLabDev/desk-for-hark/releases/latest";
const QUICK: &str = "quick";
const SETTINGS_WIN: &str = "settings";
const TRAY_ID: &str = "desk-tray";
const APP_ID: &str = "dev.midnightlab.deskforhark";
const INJECT_JS: &str = include_str!("inject.js");
const DEFAULT_START: &str = "https://app.hark.com";
const LOCAL_ORIGIN: &str = "http://tauri.localhost";
const MAX_ATTACH_BYTES: u64 = 50 * 1024 * 1024;

const THEMES: &[(&str, &str)] = &[
    ("hark", "Hark (default)"),
    ("midnight", "Midnight (OLED)"),
    ("teal", "Teal"),
    ("christmas", "Christmas"),
    ("newyear", "New Year"),
    ("halloween", "Halloween"),
    ("valentine", "Valentine's Day"),
    ("lunar", "Lunar New Year"),
    ("stpatricks", "St Patrick's Day"),
    ("earthday", "Earth Day"),
    ("aurora", "Aurora"),
    ("ocean", "Ocean"),
    ("contrast", "High contrast"),
    ("windows", "Follow Windows"),
    ("schedule", "Scheduled (dark at night)"),
];

/// Hosts that stay inside the app window (subdomains included). Everything
/// else opens in the default browser. Only https://app.hark.com (and the
/// app's own local pages) can call native commands; see capabilities/.
const INTERNAL_HOSTS: &[&str] = &[
    "hark.com",
    "accounts.google.com",
    "accounts.youtube.com",
    "appleid.apple.com",
    "idmsa.apple.com",
    "appleid.cdn-apple.com",
    "challenges.cloudflare.com",
    "tauri.localhost",
];

// ---------------------------------------------------------------- settings

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    /// Toggles the window.
    hotkey: String,
    /// Used when `hotkey` is taken by another app.
    fallback_hotkey: String,
    quick_ask_hotkey: String,
    screenshot_hotkey: String,
    selection_hotkey: String,
    voice_hotkey: String,
    /// CSS selector for Hark's voice button (empty = auto-detect).
    voice_button_selector: String,
    zoom: f64,
    start_url: String,
    extra_internal_hosts: Vec<String>,
    /// Always start hidden in the tray (login launches always do).
    start_hidden: bool,
    always_on_top: bool,
    /// hark | midnight | teal | christmas | newyear | halloween | valentine | lunar
    /// | stpatricks | earthday | aurora | ocean | contrast | windows | schedule
    theme: String,
    /// "#rrggbb" or empty for the theme's own accent.
    accent: String,
    /// e.g. "Segoe UI Variable", "Inter"; empty keeps Hark's fonts.
    font_family: String,
    /// Text size multiplier (separate from zoom).
    font_scale: f64,
    compact: bool,
    /// Load theme.css (next to settings.json) on top of the theme.
    custom_css: bool,
    /// Scheduled theme: dark from this time…
    schedule_dark: String,
    /// …until this time.
    schedule_light: String,
    /// auto | color | light | dark
    tray_icon: String,
    /// Windows 11 Mica title bar instead of a themed colour.
    mica: bool,
    /// Allow the microphone for app.hark.com without asking.
    auto_grant_mic: bool,
    /// Show a Save dialog for downloads. Off by default: files go straight
    /// to Downloads in one click. (Renamed from askWhereToSave in 1.3.0 so
    /// older installs get the new one-click default.)
    ask_before_saving: bool,
    /// Put your clipboard back after "Send selection".
    restore_clipboard: bool,
    /// Animated effect for event and mood themes (snow, fireworks…).
    /// Kept as "snow" in settings.json for older installs.
    snow: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+Space".into(),
            fallback_hotkey: "Ctrl+Shift+Space".into(),
            quick_ask_hotkey: "Alt+Shift+Space".into(),
            screenshot_hotkey: "Alt+Shift+S".into(),
            selection_hotkey: "Alt+Shift+C".into(),
            voice_hotkey: "Alt+Shift+V".into(),
            voice_button_selector: String::new(),
            zoom: 1.0,
            start_url: DEFAULT_START.into(),
            extra_internal_hosts: vec![],
            start_hidden: false,
            always_on_top: false,
            theme: "hark".into(),
            accent: String::new(),
            font_family: String::new(),
            font_scale: 1.0,
            compact: false,
            custom_css: true,
            schedule_dark: "19:00".into(),
            schedule_light: "07:00".into(),
            tray_icon: "auto".into(),
            mica: false,
            auto_grant_mic: true,
            ask_before_saving: false,
            restore_clipboard: true,
            snow: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Action {
    Toggle,
    QuickAsk,
    Screenshot,
    Selection,
    Voice,
}

struct AppState {
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    theme_css_path: PathBuf,
    hotkeys: Mutex<HashMap<u32, Action>>,
    autostart_item: Mutex<Option<CheckMenuItem<Wry>>>,
    on_top_item: Mutex<Option<CheckMenuItem<Wry>>>,
    compact_item: Mutex<Option<CheckMenuItem<Wry>>>,
    theme_items: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
    compact_restore: Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>>,
    badge: Mutex<bool>,
    busy_capture: Mutex<bool>,
}

fn load_settings(path: &Path) -> Settings {
    let s = fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
        .unwrap_or_default();
    let mut s = s;
    // Paper was removed in 1.2.0.
    if s.theme == "paper" {
        s.theme = "hark".into();
    }
    // Write back so the file always exists with every key visible.
    save_settings_file(path, &s);
    s
}

fn save_settings_file(path: &Path, s: &Settings) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let _ = fs::write(path, t);
    }
}

fn settings(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

fn update_settings(app: &AppHandle, f: impl FnOnce(&mut Settings)) {
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    f(&mut s);
    save_settings_file(&state.settings_path, &s);
}

// ------------------------------------------------------------------ helpers

fn host_matches(host: &str, pattern: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let pattern = pattern.trim().trim_start_matches("*.").to_ascii_lowercase();
    !pattern.is_empty() && (host == pattern || host.ends_with(&format!(".{pattern}")))
}

fn is_internal(app: &AppHandle, url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => {}
        // about:blank, blob:, data:, tauri internals… stay in the window.
        _ => return true,
    }
    let Some(host) = url.host_str() else { return true };
    if INTERNAL_HOSTS.iter().any(|p| host_matches(host, p)) {
        return true;
    }
    let extra = settings(app).extra_internal_hosts;
    extra.iter().any(|p| host_matches(host, p))
}

/// True for the app's own bundled pages (quick ask, settings, offline).
fn is_local(webview: &Webview) -> bool {
    webview
        .url()
        .map(|u| u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost"))
        .unwrap_or(false)
}

fn open_in_browser(app: &AppHandle, url: &str) {
    let _ = app.opener().open_url(url, None::<&str>);
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    set_badge(app, false);
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && !minimized && focused {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

fn reload_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let on_local = w.url().map(|u| u.host_str() == Some("tauri.localhost")).unwrap_or(false);
        if on_local {
            if let Ok(u) = Url::parse(&settings(app).start_url) {
                let _ = w.navigate(u);
            }
        } else {
            let _ = w.eval("location.reload()");
        }
    }
}

fn eval_main(app: &AppHandle, js: &str) {
    if let Some(w) = main_window(app) {
        let _ = w.eval(js);
    }
}

/// Runs `call` once the page has defined our helpers (waits up to ~20 s).
fn eval_when_ready(app: &AppHandle, helper: &str, call: String) {
    let js = format!(
        "(function f(n){{if(window.{helper}){{{call}}}else if(n<100){{setTimeout(function(){{f(n+1)}},200)}}}})(0);"
    );
    eval_main(app, &js);
}

fn apply_zoom(app: &AppHandle, action: &str) {
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    let z = match action {
        "in" => s.zoom + 0.1,
        "out" => s.zoom - 0.1,
        _ => 1.0,
    };
    s.zoom = (z.clamp(0.5, 2.5) * 100.0).round() / 100.0;
    if let Some(w) = main_window(app) {
        let _ = w.set_zoom(s.zoom);
    }
    save_settings_file(&state.settings_path, &s);
}

fn save_state(app: &AppHandle) {
    let _ = app.save_window_state(StateFlags::all() & !StateFlags::VISIBLE);
}

fn quit(app: &AppHandle) {
    save_state(app);
    app.exit(0);
}

fn notify_text(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

// -------------------------------------------------------------- tray/badge

fn tray_variant(s: &Settings) -> &'static str {
    match s.tray_icon.as_str() {
        "color" => "color",
        "light" => "light",
        "dark" => "dark",
        _ => {
            #[cfg(windows)]
            {
                if win::taskbar_is_light() {
                    "dark"
                } else {
                    "light"
                }
            }
            #[cfg(not(windows))]
            {
                "color"
            }
        }
    }
}

fn tray_image(variant: &str, badge: bool) -> Option<Image<'static>> {
    let bytes: &'static [u8] = match (variant, badge) {
        ("light", false) => include_bytes!("../icons/tray/light.png"),
        ("light", true) => include_bytes!("../icons/tray/light-badge.png"),
        ("dark", false) => include_bytes!("../icons/tray/dark.png"),
        ("dark", true) => include_bytes!("../icons/tray/dark-badge.png"),
        (_, false) => include_bytes!("../icons/tray/color.png"),
        (_, true) => include_bytes!("../icons/tray/color-badge.png"),
    };
    Image::from_bytes(bytes).ok()
}

fn refresh_tray_icon(app: &AppHandle) {
    let badge = *app.state::<AppState>().badge.lock().unwrap();
    let variant = tray_variant(&settings(app));
    if let (Some(tray), Some(img)) = (app.tray_by_id(TRAY_ID), tray_image(variant, badge)) {
        let _ = tray.set_icon(Some(img));
    }
}

fn set_badge(app: &AppHandle, on: bool) {
    {
        let state = app.state::<AppState>();
        let mut b = state.badge.lock().unwrap();
        if *b == on {
            return;
        }
        *b = on;
    }
    refresh_tray_icon(app);
    if let Some(w) = main_window(app) {
        let dot = if on {
            Image::from_bytes(include_bytes!("../icons/tray/overlay-dot.png")).ok()
        } else {
            None
        };
        let _ = w.set_overlay_icon(dot);
        if on {
            let _ = w.request_user_attention(Some(UserAttentionType::Informational));
        }
    }
}

fn main_is_focused(app: &AppHandle) -> bool {
    main_window(app)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

// ---------------------------------------------------------------- theming

fn theme_payload(app: &AppHandle) -> serde_json::Value {
    let s = settings(app);
    let state = app.state::<AppState>();
    let custom = if s.custom_css {
        fs::read_to_string(&state.theme_css_path).unwrap_or_default()
    } else {
        String::new()
    };
    #[cfg(windows)]
    let (win_accent, win_light) = (win::accent_color().unwrap_or_default(), win::apps_use_light_theme());
    #[cfg(not(windows))]
    let (win_accent, win_light) = (String::new(), false);
    json!({
        "theme": s.theme,
        "accent": s.accent,
        "windowsAccent": win_accent,
        "windowsLight": win_light,
        "fontFamily": s.font_family,
        "fontScale": s.font_scale,
        "compact": s.compact,
        "customCss": custom,
        "scheduleDark": s.schedule_dark,
        "scheduleLight": s.schedule_light,
        "voiceSelector": s.voice_button_selector,
        "snow": s.snow,
    })
}

fn push_theme(app: &AppHandle) {
    let payload = theme_payload(app).to_string();
    eval_main(app, &format!("window.__deskApplyTheme&&window.__deskApplyTheme({payload});"));
    refresh_theme_checks(app);
}

fn refresh_theme_checks(app: &AppHandle) {
    let current = settings(app).theme;
    for (id, item) in app.state::<AppState>().theme_items.lock().unwrap().iter() {
        let _ = item.set_checked(*id == current);
    }
}

fn set_theme(app: &AppHandle, theme: &str) {
    update_settings(app, |s| s.theme = theme.to_string());
    push_theme(app);
}

fn ensure_theme_css(path: &Path) {
    if !path.exists() {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(
            path,
            "/* Desk for Hark custom CSS.\n   Applied on top of the selected theme and reloaded when you save.\n   Example:\n   :root { --color-surface-primary: #101418 !important; }\n*/\n",
        );
    }
}

/// Reloads theme.css into the page when the file changes.
fn watch_theme_css(app: AppHandle) {
    std::thread::spawn(move || {
        let path = app.state::<AppState>().theme_css_path.clone();
        let mtime = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
        let mut last: Option<SystemTime> = mtime(&path);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = mtime(&path);
            if now != last {
                last = now;
                let a = app.clone();
                let _ = app.run_on_main_thread(move || push_theme(&a));
            }
        }
    });
}

// ------------------------------------------------------------ attachments

#[derive(Serialize)]
struct Attachment {
    name: String,
    #[serde(rename = "type")]
    mime: String,
    b64: String,
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("txt") | Some("log") => "text/plain",
        Some("md") => "text/markdown",
        Some("csv") => "text/csv",
        Some("json") => "application/json",
        Some("html") | Some("htm") => "text/html",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn send_attachments(app: &AppHandle, files: Vec<Attachment>, delay: Duration) {
    if files.is_empty() {
        return;
    }
    let json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".into());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            show_main(&a);
            eval_when_ready(&a, "__deskAttachFiles", format!("window.__deskAttachFiles({json})"));
        });
    });
}

fn attach_paths(app: &AppHandle, paths: &[String], delay: Duration) {
    let mut total = 0u64;
    let mut files = vec![];
    for p in paths {
        let path = PathBuf::from(p);
        let Ok(meta) = fs::metadata(&path) else { continue };
        if !meta.is_file() || total + meta.len() > MAX_ATTACH_BYTES {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            total += bytes.len() as u64;
            files.push(Attachment {
                name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()),
                mime: mime_for(&path).into(),
                b64: B64.encode(&bytes),
            });
        }
    }
    if files.is_empty() {
        notify_text(app, "Desk for Hark", "Those files couldn't be attached (limit 50 MB in total).");
    }
    send_attachments(app, files, delay);
}

fn encode_png(w: usize, h: usize, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(buf)
}

fn with_capture_lock(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let mut busy = state.busy_capture.lock().unwrap();
    if *busy {
        return false;
    }
    *busy = true;
    true
}

fn release_capture_lock(app: &AppHandle) {
    *app.state::<AppState>().busy_capture.lock().unwrap() = false;
}

/// Opens the Windows snipping overlay, then attaches the snip to Hark.
fn screenshot_to_hark(app: &AppHandle) {
    #[cfg(windows)]
    {
        if !with_capture_lock(app) {
            return;
        }
        let seq0 = win::clipboard_seq();
        let _ = std::process::Command::new("explorer").arg("ms-screenclip:").spawn();
        let app = app.clone();
        std::thread::spawn(move || {
            let start = Instant::now();
            let mut result: Option<Vec<u8>> = None;
            while start.elapsed() < Duration::from_secs(90) {
                std::thread::sleep(Duration::from_millis(300));
                if win::clipboard_seq() == seq0 {
                    continue;
                }
                for _ in 0..10 {
                    if let Ok(mut cb) = arboard::Clipboard::new() {
                        if let Ok(img) = cb.get_image() {
                            result = encode_png(img.width, img.height, &img.bytes);
                            break;
                        }
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                break;
            }
            release_capture_lock(&app);
            if let Some(png) = result {
                let stamp = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                send_attachments(
                    &app,
                    vec![Attachment {
                        name: format!("screenshot-{stamp}.png"),
                        mime: "image/png".into(),
                        b64: B64.encode(png),
                    }],
                    Duration::from_millis(0),
                );
            }
        });
    }
}

/// Copies the selection in the foreground app and puts it in Hark's box.
fn send_selection(app: &AppHandle) {
    #[cfg(windows)]
    {
        if !with_capture_lock(app) {
            return;
        }
        let restore = settings(app).restore_clipboard;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            let previous = arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok());
            let seq0 = win::clipboard_seq();
            win::send_ctrl_c();
            let start = Instant::now();
            let mut text: Option<String> = None;
            while start.elapsed() < Duration::from_millis(900) {
                std::thread::sleep(Duration::from_millis(40));
                if win::clipboard_seq() != seq0 {
                    std::thread::sleep(Duration::from_millis(40));
                    text = arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok());
                    break;
                }
            }
            if restore {
                if let (Some(prev), Some(_)) = (&previous, &text) {
                    if let Ok(mut c) = arboard::Clipboard::new() {
                        let _ = c.set_text(prev.clone());
                    }
                }
            }
            release_capture_lock(&app);
            let a = app.clone();
            let _ = app.run_on_main_thread(move || match text.filter(|t| !t.trim().is_empty()) {
                Some(t) => {
                    show_main(&a);
                    let js = serde_json::to_string(&t).unwrap_or_default();
                    eval_when_ready(&a, "__deskInsertText", format!("window.__deskInsertText({js},false)"));
                }
                None => notify_text(&a, "Desk for Hark", "Select some text first, then press the hotkey."),
            });
        });
    }
}

fn voice(app: &AppHandle) {
    show_main(app);
    let sel = serde_json::to_string(&settings(app).voice_button_selector).unwrap_or_default();
    eval_when_ready(app, "__deskVoice", format!("window.__deskVoice({sel})"));
}

// --------------------------------------------------------- quick ask window

fn show_quick(app: &AppHandle) {
    if let Some(q) = app.get_webview_window(QUICK) {
        if let Ok(Some(m)) = q.current_monitor().or_else(|_| q.primary_monitor()) {
            let scale = m.scale_factor();
            let size = m.size();
            let pos = m.position();
            let w = (680.0 * scale) as i32;
            let x = pos.x + (size.width as i32 - w) / 2;
            let y = pos.y + (size.height as f64 * 0.22) as i32;
            let _ = q.set_position(PhysicalPosition::new(x, y));
        }
        let _ = q.show();
        let _ = q.set_focus();
        let _ = q.eval("window.__quickFocus&&window.__quickFocus()");
    }
}

fn build_quick(app: &AppHandle) -> tauri::Result<()> {
    let q = WebviewWindowBuilder::new(app, QUICK, WebviewUrl::App("quick.html".into()))
        .title("Quick Ask")
        .inner_size(680.0, 66.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .theme(Some(Theme::Dark))
        .build()?;
    let qq = q.clone();
    q.on_window_event(move |e| match e {
        WindowEvent::Focused(false) => {
            let _ = qq.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = qq.hide();
        }
        _ => {}
    });
    Ok(())
}

// ---------------------------------------------------------- settings window

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS_WIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SETTINGS_WIN, WebviewUrl::App("settings.html".into()))
        .title("Desk for Hark settings")
        .inner_size(600.0, 760.0)
        .min_inner_size(480.0, 520.0)
        .center()
        .theme(Some(Theme::Dark))
        .build();
}

// -------------------------------------------------------- compact / on top

fn set_always_on_top(app: &AppHandle, on: bool) {
    update_settings(app, |s| s.always_on_top = on);
    if let Some(w) = main_window(app) {
        let _ = w.set_always_on_top(on);
    }
    if let Some(item) = app.state::<AppState>().on_top_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(on);
    }
}

fn toggle_compact(app: &AppHandle) {
    let Some(w) = main_window(app) else { return };
    let state = app.state::<AppState>();
    let saved = state.compact_restore.lock().unwrap().take();
    let now_compact = match saved {
        Some((pos, size)) => {
            let _ = w.set_size(size);
            let _ = w.set_position(pos);
            let _ = w.set_always_on_top(settings(app).always_on_top);
            false
        }
        None => {
            if let (Ok(pos), Ok(size), Ok(Some(m))) = (w.outer_position(), w.outer_size(), w.current_monitor()) {
                *state.compact_restore.lock().unwrap() = Some((pos, size));
                let area = m.work_area();
                let scale = m.scale_factor();
                let width = (440.0 * scale) as u32;
                let margin = (12.0 * scale) as i32;
                let height = area.size.height.saturating_sub((margin * 2) as u32);
                let _ = w.set_size(PhysicalSize::new(width, height));
                let _ = w.set_position(PhysicalPosition::new(
                    area.position.x + area.size.width as i32 - width as i32 - margin,
                    area.position.y + margin,
                ));
                let _ = w.set_always_on_top(true);
                show_main(app);
                true
            } else {
                false
            }
        }
    };
    if let Some(item) = state.compact_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(now_compact);
    };
}

// ----------------------------------------------------------- Send To menu

fn sendto_link(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .data_dir()
        .ok()
        .map(|d| d.join("Microsoft").join("Windows").join("SendTo").join("Desk for Hark.lnk"))
}

fn set_sendto(app: &AppHandle, on: bool) -> bool {
    let Some(link) = sendto_link(app) else { return false };
    if !on {
        let _ = fs::remove_file(&link);
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let Ok(exe) = std::env::current_exe() else { return false };
        let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Arguments='--attach';$s.IconLocation='{},0';$s.Description='Attach to a new Hark message';$s.Save()",
            q(&link),
            q(&exe),
            q(&exe)
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status();
    }
    link.exists()
}

// ---------------------------------------------------------- argument router

fn handle_args(app: &AppHandle, args: &[String], first_launch: bool) {
    let delay = if first_launch { Duration::from_secs(5) } else { Duration::from_millis(0) };
    if let Some(i) = args.iter().position(|a| a == "--attach") {
        let files: Vec<String> = args[i + 1..].iter().filter(|a| !a.starts_with("--")).cloned().collect();
        attach_paths(app, &files, delay);
        return;
    }
    for a in args {
        match a.as_str() {
            "--quick" => show_quick(app),
            "--screenshot" => screenshot_to_hark(app),
            "--settings" => show_settings(app),
            "--show" => show_main(app),
            _ => {}
        }
    }
}

// ------------------------------------------------------------ updates/about

fn info_dialog(app: &AppHandle, title: &str, text: String, kind: MessageDialogKind) {
    app.dialog().message(text).title(title).kind(kind).show(|_| {});
}

/// Checks GitHub Releases for a newer signed build. `manual` = user clicked
/// "Check for updates…" (then we also report "up to date" and errors).
fn check_for_updates(app: AppHandle, manual: bool) {
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                if manual {
                    info_dialog(&app, "Desk for Hark", format!("Updates aren't available: {e}"), MessageDialogKind::Warning);
                }
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let notes = update.body.clone().unwrap_or_default();
                let app2 = app.clone();
                app.dialog()
                    .message(format!("Desk for Hark {version} is available.\n\n{notes}"))
                    .title("Update available")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Install and restart".to_string(),
                        "Later".to_string(),
                    ))
                    .show(move |install| {
                        if install {
                            tauri::async_runtime::spawn(async move {
                                if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                                    app2.restart();
                                }
                            });
                        }
                    });
            }
            Ok(None) => {
                if manual {
                    let v = app.package_info().version.to_string();
                    info_dialog(&app, "Desk for Hark", format!("You're on the latest version ({v})."), MessageDialogKind::Info);
                }
            }
            Err(e) => {
                if manual {
                    info_dialog(&app, "Desk for Hark", format!("Couldn't check for updates.\n\n{e}"), MessageDialogKind::Warning);
                }
            }
        }
    });
}

fn show_about(app: &AppHandle) {
    let v = app.package_info().version.to_string();
    info_dialog(
        app,
        "About Desk for Hark",
        format!(
            "Desk for Hark {v}\n\n\
             An unofficial Windows app for Hark (app.hark.com).\n\
             Not affiliated with, endorsed by, or supported by Hark.\n\n\
             The app itself collects no data. Your Hark account and data are \
             handled by Hark under its own privacy policy.\n\n\
             Open source under the MIT licence.\n\
             github.com/MidnightLabDev/desk-for-hark"
        ),
        MessageDialogKind::Info,
    );
}

// ----------------------------------------------------------------- commands

#[tauri::command]
fn notify(app: AppHandle, title: String, body: Option<String>) {
    let title: String = title.chars().take(120).collect();
    let mut b = app.notification().builder().title(title);
    if let Some(body) = body.filter(|s| !s.is_empty()) {
        b = b.body(body.chars().take(500).collect::<String>());
    }
    let _ = b.show();
    if !main_is_focused(&app) {
        set_badge(&app, true);
    }
}

#[tauri::command]
fn badge(app: AppHandle, on: bool) {
    if on && main_is_focused(&app) {
        return;
    }
    set_badge(&app, on);
}

#[tauri::command]
fn zoom(app: AppHandle, action: String) {
    apply_zoom(&app, &action);
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) {
    if let Ok(u) = Url::parse(&url) {
        if matches!(u.scheme(), "http" | "https" | "mailto") {
            open_in_browser(&app, u.as_str());
        }
    }
}

#[tauri::command]
fn get_theme(app: AppHandle) -> serde_json::Value {
    theme_payload(&app)
}

/// The page reports the theme's colours so the title bar can match.
#[tauri::command]
fn title_bar(app: AppHandle, caption: String, text: String, dark: bool) {
    let Some(w) = main_window(&app) else { return };
    let _ = w.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    #[cfg(windows)]
    {
        let mica = settings(&app).mica;
        let cap = if caption.is_empty() { None } else { Some(caption.as_str()) };
        let txt = if text.is_empty() { None } else { Some(text.as_str()) };
        win::style_title_bar(&w, dark, cap, txt, mica);
    }
    #[cfg(not(windows))]
    let _ = (caption, text);
}

#[tauri::command]
fn print_page(app: AppHandle) {
    eval_main(&app, "window.print()");
}

#[tauri::command]
fn quick_submit(app: AppHandle, webview: Webview, text: String) {
    if !is_local(&webview) {
        return;
    }
    if let Some(q) = app.get_webview_window(QUICK) {
        let _ = q.hide();
    }
    let text: String = text.chars().take(20_000).collect();
    if text.trim().is_empty() {
        return;
    }
    show_main(&app);
    let js = serde_json::to_string(&text).unwrap_or_default();
    eval_when_ready(&app, "__deskInsertText", format!("window.__deskInsertText({js},true)"));
}

#[tauri::command]
fn quick_hide(app: AppHandle, webview: Webview) {
    if !is_local(&webview) {
        return;
    }
    if let Some(q) = app.get_webview_window(QUICK) {
        let _ = q.hide();
    }
}

#[tauri::command]
fn get_settings(app: AppHandle, webview: Webview) -> Option<serde_json::Value> {
    if !is_local(&webview) {
        return None;
    }
    let s = settings(&app);
    let sendto = sendto_link(&app).map(|p| p.exists()).unwrap_or(false);
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let mut v = serde_json::to_value(&s).ok()?;
    v["sendTo"] = json!(sendto);
    v["autostart"] = json!(autostart);
    v["version"] = json!(app.package_info().version.to_string());
    Some(v)
}

#[tauri::command]
fn save_settings(app: AppHandle, webview: Webview, settings: serde_json::Value, restart: bool) -> bool {
    if !is_local(&webview) {
        return false;
    }
    let sendto = settings.get("sendTo").and_then(|v| v.as_bool());
    let autostart = settings.get("autostart").and_then(|v| v.as_bool());
    let Ok(new) = serde_json::from_value::<Settings>(settings) else { return false };
    let on_top = new.always_on_top;
    update_settings(&app, |s| *s = new);
    if let Some(on) = sendto {
        let has = sendto_link(&app).map(|p| p.exists()).unwrap_or(false);
        if on != has {
            set_sendto(&app, on);
        }
    }
    if let Some(on) = autostart {
        let al = app.autolaunch();
        let _ = if on { al.enable() } else { al.disable() };
        if let Some(item) = app.state::<AppState>().autostart_item.lock().unwrap().as_ref() {
            let _ = item.set_checked(al.is_enabled().unwrap_or(on));
        };
    }
    set_always_on_top(&app, on_top);
    if let Some(w) = main_window(&app) {
        let _ = w.set_zoom(crate::settings(&app).zoom);
    }
    push_theme(&app);
    refresh_tray_icon(&app);
    if restart {
        save_state(&app);
        app.restart();
    }
    true
}

#[tauri::command]
fn open_theme_css(app: AppHandle, webview: Webview) {
    if !is_local(&webview) {
        return;
    }
    let path = app.state::<AppState>().theme_css_path.clone();
    ensure_theme_css(&path);
    let _ = app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>);
}

// ------------------------------------------------------------------ hotkeys

fn register_hotkeys(app: &AppHandle, s: &Settings) -> Vec<(Action, Option<String>)> {
    let gs = app.global_shortcut();
    let mut map = HashMap::new();
    let mut out = vec![];
    let try_reg = |key: &str, map: &mut HashMap<u32, Action>, action: Action| -> bool {
        if key.trim().is_empty() {
            return false;
        }
        match key.parse::<Shortcut>() {
            Ok(sc) => {
                let id = sc.id();
                if gs.register(sc).is_ok() {
                    map.insert(id, action);
                    true
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    };
    let toggle = [s.hotkey.clone(), s.fallback_hotkey.clone()]
        .into_iter()
        .find(|k| try_reg(k, &mut map, Action::Toggle));
    out.push((Action::Toggle, toggle));
    for (key, action) in [
        (&s.quick_ask_hotkey, Action::QuickAsk),
        (&s.screenshot_hotkey, Action::Screenshot),
        (&s.selection_hotkey, Action::Selection),
        (&s.voice_hotkey, Action::Voice),
    ] {
        let ok = try_reg(key, &mut map, action);
        out.push((action, if ok { Some(key.clone()) } else { None }));
    }
    *app.state::<AppState>().hotkeys.lock().unwrap() = map;
    out
}

fn on_hotkey(app: &AppHandle, id: u32, state: ShortcutState) {
    let action = app.state::<AppState>().hotkeys.lock().unwrap().get(&id).copied();
    let Some(action) = action else { return };
    match (action, state) {
        // Selection fires on release, so the hotkey's modifiers are up before Ctrl+C.
        (Action::Selection, ShortcutState::Released) => send_selection(app),
        (Action::Selection, _) => {}
        (_, ShortcutState::Pressed) => match action {
            Action::Toggle => toggle_main(app),
            Action::QuickAsk => show_quick(app),
            Action::Screenshot => screenshot_to_hark(app),
            Action::Voice => voice(app),
            Action::Selection => {}
        },
        _ => {}
    }
}

// --------------------------------------------------------------------- main

fn main() {
    let state_flags = StateFlags::all() & !StateFlags::VISIBLE;

    tauri::Builder::default()
        // Must be first: a second launch hands its arguments to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let rest: Vec<String> = args.into_iter().skip(1).collect();
            if rest.iter().any(|a| a.starts_with("--") && a != "--hidden") {
                handle_args(app, &rest, false);
            } else {
                show_main(app);
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(state_flags)
                .with_denylist(&[QUICK, SETTINGS_WIN])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_hotkey(app, shortcut.id(), event.state()))
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            notify,
            badge,
            zoom,
            open_external,
            get_theme,
            title_bar,
            print_page,
            quick_submit,
            quick_hide,
            get_settings,
            save_settings,
            open_theme_css
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Settings live in %APPDATA%\dev.midnightlab.deskforhark\
            let config_dir = app.path().app_config_dir()?;
            let settings_path = config_dir.join("settings.json");
            let theme_css_path = config_dir.join("theme.css");
            let s = load_settings(&settings_path);
            ensure_theme_css(&theme_css_path);
            app.manage(AppState {
                settings: Mutex::new(s.clone()),
                settings_path,
                theme_css_path,
                hotkeys: Mutex::new(HashMap::new()),
                autostart_item: Mutex::new(None),
                on_top_item: Mutex::new(None),
                compact_item: Mutex::new(None),
                theme_items: Mutex::new(vec![]),
                compact_restore: Mutex::new(None),
                badge: Mutex::new(false),
                busy_capture: Mutex::new(false),
            });

            // ---- main window -------------------------------------------
            let start_url = Url::parse(&s.start_url).unwrap_or_else(|_| Url::parse(DEFAULT_START).unwrap());

            // Persistent WebView2 profile: cookies and sign-in survive restarts.
            let data_dir = app.path().app_local_data_dir()?.join("webview");
            let _ = fs::create_dir_all(&data_dir);

            let nav_handle = handle.clone();
            let popup_handle = handle.clone();
            let initial_theme = match s.theme.as_str() {
                "windows" | "schedule" => None,
                _ => Some(Theme::Dark),
            };

            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(start_url))
                .title("Desk for Hark")
                .inner_size(1100.0, 800.0)
                .min_inner_size(380.0, 480.0)
                .center()
                .visible(false)
                .theme(initial_theme)
                .always_on_top(s.always_on_top)
                .data_directory(data_dir)
                // Let file drops reach Hark's page (Tauri would otherwise swallow them).
                .disable_drag_drop_handler()
                .initialization_script(INJECT_JS)
                .on_navigation(move |url| {
                    if is_internal(&nav_handle, url) {
                        true
                    } else {
                        open_in_browser(&nav_handle, url.as_str());
                        false
                    }
                })
                .on_new_window(move |url, _features| {
                    if is_internal(&popup_handle, &url) {
                        // Sign-in popups keep window.opener so OAuth can finish.
                        NewWindowResponse::Allow
                    } else {
                        open_in_browser(&popup_handle, url.as_str());
                        NewWindowResponse::Deny
                    }
                })
                .build()?;

            let _ = window.restore_state(state_flags);
            if (s.zoom - 1.0).abs() > f64::EPSILON {
                let _ = window.set_zoom(s.zoom);
            }

            #[cfg(windows)]
            {
                win::install_webview_hooks(
                    &window,
                    win::HookOptions {
                        auto_grant_mic: s.auto_grant_mic,
                        ask_before_saving: s.ask_before_saving,
                        offline_url: format!("{LOCAL_ORIGIN}/offline.html"),
                    },
                );
                win::set_jump_list(APP_ID);
                if s.mica {
                    win::style_title_bar(&window, true, None, None, true);
                }
            }

            // Closing hides to the tray; focusing clears the unread badge.
            let w = window.clone();
            let focus_handle = handle.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = w.hide();
                }
                WindowEvent::Focused(true) => set_badge(&focus_handle, false),
                _ => {}
            });

            let args: Vec<String> = std::env::args().skip(1).collect();
            let start_hidden = s.start_hidden || args.iter().any(|a| a == "--hidden");
            if !start_hidden {
                let _ = window.show();
                let _ = window.set_focus();
            }

            build_quick(&handle)?;

            // ---- global hotkeys ----------------------------------------
            let hotkeys = register_hotkeys(&handle, &s);
            let label = |a: Action| -> String {
                let name = match a {
                    Action::Toggle => "Show/hide",
                    Action::QuickAsk => "Quick Ask",
                    Action::Screenshot => "Screenshot",
                    Action::Selection => "Send selection",
                    Action::Voice => "Voice",
                };
                let k = hotkeys
                    .iter()
                    .find(|(x, _)| *x == a)
                    .and_then(|(_, k)| k.clone())
                    .unwrap_or_else(|| "unavailable".to_string());
                format!("{name}: {k}")
            };

            // ---- tray ---------------------------------------------------
            let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
            let sendto_on = sendto_link(&handle).map(|p| p.exists()).unwrap_or(false);

            let show_hide = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "Quick Ask…", true, None::<&str>)?;
            let shot = MenuItem::with_id(app, "screenshot", "Screenshot to Hark", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let print = MenuItem::with_id(app, "print", "Print or save as PDF…", true, None::<&str>)?;

            let zoom_in = MenuItem::with_id(app, "zoom_in", "Zoom in", true, None::<&str>)?;
            let zoom_out = MenuItem::with_id(app, "zoom_out", "Zoom out", true, None::<&str>)?;
            let zoom_reset = MenuItem::with_id(app, "zoom_reset", "Actual size", true, None::<&str>)?;
            let view_menu = Submenu::with_items(app, "Zoom", true, &[&zoom_in, &zoom_out, &zoom_reset])?;

            let mut theme_items = vec![];
            for (id, name) in THEMES {
                let item = CheckMenuItem::with_id(app, format!("theme:{id}"), *name, true, s.theme == *id, None::<&str>)?;
                theme_items.push((id.to_string(), item));
            }
            let edit_css = MenuItem::with_id(app, "edit_css", "Edit custom CSS…", true, None::<&str>)?;
            let theme_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = theme_items
                .iter()
                .map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>)
                .collect();
            let theme_menu = Submenu::with_items(app, "Theme", true, &theme_refs)?;
            theme_menu.append(&PredefinedMenuItem::separator(app)?)?;
            theme_menu.append(&edit_css)?;

            let on_top = CheckMenuItem::with_id(app, "on_top", "Always on top", true, s.always_on_top, None::<&str>)?;
            let compact = CheckMenuItem::with_id(app, "compact", "Compact mode", true, false, None::<&str>)?;
            let autostart = CheckMenuItem::with_id(app, "autostart", "Start at login", true, autostart_on, None::<&str>)?;
            let sendto = CheckMenuItem::with_id(app, "sendto", "Add to \"Send to\" menu", true, sendto_on, None::<&str>)?;
            let downloads = MenuItem::with_id(app, "downloads", "Open Downloads folder", true, None::<&str>)?;

            let hk_toggle = MenuItem::with_id(app, "hk1", label(Action::Toggle), false, None::<&str>)?;
            let hk_quick = MenuItem::with_id(app, "hk2", label(Action::QuickAsk), false, None::<&str>)?;
            let hk_shot = MenuItem::with_id(app, "hk3", label(Action::Screenshot), false, None::<&str>)?;
            let hk_sel = MenuItem::with_id(app, "hk4", label(Action::Selection), false, None::<&str>)?;
            let hk_voice = MenuItem::with_id(app, "hk5", label(Action::Voice), false, None::<&str>)?;
            let hotkey_menu = Submenu::with_items(app, "Hotkeys", true, &[&hk_toggle, &hk_quick, &hk_shot, &hk_sel, &hk_voice])?;

            let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", "Restart", true, None::<&str>)?;
            let updates = MenuItem::with_id(app, "updates", "Check for updates (manual)…", true, None::<&str>)?;
            let about = MenuItem::with_id(app, "about", "About Desk for Hark", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Desk for Hark", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_hide,
                    &quick,
                    &shot,
                    &reload,
                    &print,
                    &PredefinedMenuItem::separator(app)?,
                    &theme_menu,
                    &view_menu,
                    &on_top,
                    &compact,
                    &PredefinedMenuItem::separator(app)?,
                    &autostart,
                    &sendto,
                    &downloads,
                    &hotkey_menu,
                    &settings_item,
                    &PredefinedMenuItem::separator(app)?,
                    &updates,
                    &about,
                    &restart,
                    &quit_item,
                ],
            )?;

            {
                let st = app.state::<AppState>();
                *st.autostart_item.lock().unwrap() = Some(autostart.clone());
                *st.on_top_item.lock().unwrap() = Some(on_top.clone());
                *st.compact_item.lock().unwrap() = Some(compact.clone());
                *st.theme_items.lock().unwrap() = theme_items.clone();
            }
            let sendto_item = sendto.clone();

            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("Desk for Hark")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref().to_string();
                    if let Some(theme) = id.strip_prefix("theme:") {
                        set_theme(app, theme);
                        return;
                    }
                    match id.as_str() {
                        "toggle" => toggle_main(app),
                        "quick" => show_quick(app),
                        "screenshot" => screenshot_to_hark(app),
                        "reload" => reload_main(app),
                        "print" => {
                            show_main(app);
                            eval_main(app, "window.print()");
                        }
                        "zoom_in" => apply_zoom(app, "in"),
                        "zoom_out" => apply_zoom(app, "out"),
                        "zoom_reset" => apply_zoom(app, "reset"),
                        "edit_css" => {
                            let path = app.state::<AppState>().theme_css_path.clone();
                            ensure_theme_css(&path);
                            let _ = app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>);
                        }
                        "on_top" => {
                            let on = !settings(app).always_on_top;
                            set_always_on_top(app, on);
                        }
                        "compact" => toggle_compact(app),
                        "autostart" => {
                            let al = app.autolaunch();
                            let enable = !al.is_enabled().unwrap_or(false);
                            let _ = if enable { al.enable() } else { al.disable() };
                            let now = al.is_enabled().unwrap_or(enable);
                            if let Some(item) = app.state::<AppState>().autostart_item.lock().unwrap().as_ref() {
                                let _ = item.set_checked(now);
                            }
                        }
                        "sendto" => {
                            let has = sendto_link(app).map(|p| p.exists()).unwrap_or(false);
                            let now = set_sendto(app, !has);
                            let _ = sendto_item.set_checked(now);
                        }
                        "downloads" => {
                            if let Ok(d) = app.path().download_dir() {
                                let _ = app.opener().open_path(d.to_string_lossy().to_string(), None::<&str>);
                            }
                        }
                        "settings" => show_settings(app),
                        "restart" => {
                            save_state(app);
                            app.restart();
                        }
                        // Manual for now: self-update needs signed update files,
                        // which aren't published yet, so open the releases page.
                        "updates" => open_in_browser(app, RELEASES_URL),
                        "about" => show_about(app),
                        "quit" => quit(app),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                });
            if let Some(icon) = tray_image(tray_variant(&s), false) {
                tray = tray.icon(icon);
            } else if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            watch_theme_css(handle.clone());

            // Arguments from the jump list / Send To on a cold start.
            if args.iter().any(|a| a.starts_with("--") && a != "--hidden") {
                handle_args(&handle, &args, true);
            }

            // Quiet update check on launch (release builds only).
            if !cfg!(debug_assertions) {
                check_for_updates(handle.clone(), false);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Desk for Hark")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                save_state(app);
            }
        });
}
