//! Windows-only helpers: title bar colours, taskbar jump list, clipboard
//! sequence, simulated Ctrl+C, registry reads, and WebView2 event hooks
//! (microphone permission, crash recovery, offline detection, Save dialogs).

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    take_pwstr, DownloadStartingEventHandler, NavigationCompletedEventHandler,
    PermissionRequestedEventHandler, ProcessFailedEventHandler,
};
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Foundation::{ERROR_SUCCESS, HWND};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_TEXT_COLOR,
    DWMWA_USE_IMMERSIVE_DARK_MODE,
};
use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
};

// ------------------------------------------------------------- title bar

fn hwnd_of(w: &WebviewWindow) -> Option<HWND> {
    w.hwnd().ok()
}

/// `0x00BBGGRR` from "#rrggbb".
pub fn colorref(hex: &str) -> Option<u32> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    let (r, g, b) = ((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    Some(r | (g << 8) | (b << 16))
}

/// Sets the title bar: dark mode flag, caption/text colours, or Mica.
pub fn style_title_bar(w: &WebviewWindow, dark: bool, caption: Option<&str>, text: Option<&str>, mica: bool) {
    let Some(hwnd) = hwnd_of(w) else { return };
    unsafe {
        let dark_flag: i32 = dark as i32;
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_flag as *const _ as _, 4);
        // DWMSBT_MAINWINDOW = 2 (Mica), DWMSBT_AUTO = 0
        let backdrop: i32 = if mica { 2 } else { 0 };
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop as *const _ as _, 4);
        // 0xFFFFFFFF = DWMWA_COLOR_DEFAULT
        let cap = if mica { 0xFFFF_FFFFu32 } else { caption.and_then(colorref).unwrap_or(0xFFFF_FFFF) };
        let txt = if mica { 0xFFFF_FFFFu32 } else { text.and_then(colorref).unwrap_or(0xFFFF_FFFF) };
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &cap as *const _ as _, 4);
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &txt as *const _ as _, 4);
    }
}

// --------------------------------------------------------------- registry

fn reg_dword(subkey: &str, value: &str) -> Option<u32> {
    let mut data: u32 = 0;
    let mut size: u32 = 4;
    let sk = HSTRING::from(subkey);
    let vn = HSTRING::from(value);
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &sk,
            &vn,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    if rc == ERROR_SUCCESS {
        Some(data)
    } else {
        None
    }
}

/// Windows accent colour as "#rrggbb".
pub fn accent_color() -> Option<String> {
    // AccentColor is stored as 0xAABBGGRR.
    let v = reg_dword(r"Software\Microsoft\Windows\DWM", "AccentColor")?;
    let (r, g, b) = (v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

/// True when apps are set to light mode.
pub fn apps_use_light_theme() -> bool {
    reg_dword(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        "AppsUseLightTheme",
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

/// True when the taskbar is light.
pub fn taskbar_is_light() -> bool {
    reg_dword(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        "SystemUsesLightTheme",
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

// -------------------------------------------------------------- clipboard

pub fn clipboard_seq() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Releases held modifiers, then presses Ctrl+C in the foreground app.
pub fn send_ctrl_c() {
    let c = VIRTUAL_KEY(0x43);
    let inputs = [
        key(VK_MENU, true),
        key(VK_SHIFT, true),
        key(VK_LWIN, true),
        key(VK_RWIN, true),
        key(VK_CONTROL, true),
        key(VK_CONTROL, false),
        key(c, false),
        key(c, true),
        key(VK_CONTROL, true),
    ];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

// --------------------------------------------------------------- jump list

/// Taskbar right-click tasks. Each runs the exe with an argument that the
/// running instance receives through the single-instance plugin.
pub fn set_jump_list(app_id: &str) {
    let Ok(exe) = std::env::current_exe() else { return };
    let exe = exe.to_string_lossy().to_string();
    let tasks = [
        ("Quick Ask", "--quick"),
        ("Screenshot to Hark", "--screenshot"),
        ("Open Hark", "--show"),
        ("Settings", "--settings"),
    ];
    std::thread::spawn({
        let app_id = app_id.to_string();
        move || unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result: windows::core::Result<()> = (|| {
                let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
                list.SetAppID(&HSTRING::from(app_id.as_str()))?;
                let mut slots = 0u32;
                let _removed: IObjectArray = list.BeginList(&mut slots)?;
                let coll: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                for (title, arg) in tasks {
                    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                    link.SetPath(&HSTRING::from(exe.as_str()))?;
                    link.SetArguments(&HSTRING::from(arg))?;
                    link.SetIconLocation(&HSTRING::from(exe.as_str()), 0)?;
                    link.SetDescription(&HSTRING::from(title))?;
                    let store: IPropertyStore = link.cast()?;
                    let pv = lpwstr_variant(title);
                    store.SetValue(&PKEY_Title, &pv)?;
                    store.Commit()?;
                    coll.AddObject(&link)?;
                }
                let arr: IObjectArray = coll.cast()?;
                list.AddUserTasks(&arr)?;
                list.CommitList()?;
                Ok(())
            })();
            if let Err(e) = result {
                eprintln!("jump list: {e}");
            }
        }
    });
}

/// A VT_LPWSTR PROPVARIANT (freed by PropVariantClear on drop).
unsafe fn lpwstr_variant(s: &str) -> PROPVARIANT {
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    let mem = CoTaskMemAlloc(wide.len() * 2) as *mut u16;
    if !mem.is_null() {
        std::ptr::copy_nonoverlapping(wide.as_ptr(), mem, wide.len());
    }
    PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_LPWSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 { pwszVal: PWSTR(mem) },
            }),
        },
    }
}

// ---------------------------------------------------------- WebView2 hooks

struct SendBox<T>(T);
unsafe impl<T> Send for SendBox<T> {}

fn is_hark(uri: &str) -> bool {
    uri.starts_with("https://app.hark.com/") || uri == "https://app.hark.com"
}

pub struct HookOptions {
    pub auto_grant_mic: bool,
    pub ask_where_to_save: bool,
    pub offline_url: String,
}

/// Registers WebView2 event handlers on the main window.
pub fn install_webview_hooks(window: &WebviewWindow, opts: HookOptions) {
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let mut token: i64 = 0;

        // Microphone: allow for app.hark.com only, so voice works without a prompt.
        if opts.auto_grant_mic {
            let h = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if is_hark(&uri) && kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            }));
            let _ = core.add_PermissionRequested(&h, &mut token);
        }

        // Crash recovery: reload on renderer crash/hang, restart if the browser process died.
        let app_pf = app.clone();
        let h = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            args.ProcessFailedKind(&mut kind)?;
            if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                let a = app_pf.clone();
                tauri::async_runtime::spawn(async move {
                    a.restart();
                });
            } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
            {
                if let Some(s) = sender {
                    let _ = s.Reload();
                }
            }
            Ok(())
        }));
        let _ = core.add_ProcessFailed(&h, &mut token);

        // Offline: a failed page load shows our retry page instead of an error.
        let offline_url = opts.offline_url.clone();
        let app_nav = app.clone();
        let h = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut ok = windows::core::BOOL::default();
            args.IsSuccess(&mut ok)?;
            if ok.as_bool() {
                return Ok(());
            }
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            args.WebErrorStatus(&mut status)?;
            let offline = [
                COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
                COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
            ];
            if offline.contains(&status) {
                let mut src = PWSTR::null();
                if let Some(s) = &sender {
                    let _ = s.Source(&mut src);
                }
                let src = take_pwstr(src);
                if src.starts_with("https://") {
                    let target = format!("{}?return={}", offline_url, urlencode(&src));
                    let a = app_nav.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(w) = a.get_webview_window(crate::MAIN) {
                            if let Ok(u) = tauri::Url::parse(&target) {
                                let _ = w.navigate(u);
                            }
                        }
                    });
                }
            }
            Ok(())
        }));
        let _ = core.add_NavigationCompleted(&h, &mut token);

        // Downloads: ask where to save with a normal Save dialog.
        if opts.ask_where_to_save {
            if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
                let app_dl = app.clone();
                let h = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut p = PWSTR::null();
                    args.ResultFilePath(&mut p)?;
                    let path = std::path::PathBuf::from(take_pwstr(p));
                    let deferral = args.GetDeferral()?;
                    let args_box = SendBox(args.clone());
                    let def_box = SendBox(deferral);
                    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    let mut dlg = app_dl.dialog().file().set_file_name(&name);
                    if let Some(dir) = path.parent() {
                        dlg = dlg.set_directory(dir);
                    }
                    let app_cb = app_dl.clone();
                    dlg.save_file(move |chosen| {
                        let chosen = chosen.and_then(|fp| fp.into_path().ok());
                        let _ = app_cb.run_on_main_thread(move || {
                            let args = args_box;
                            let def = def_box;
                            match chosen {
                                Some(pb) => {
                                    let hs = HSTRING::from(pb.to_string_lossy().as_ref());
                                    let _ = args.0.SetResultFilePath(&hs);
                                }
                                None => {
                                    let _ = args.0.SetCancel(true);
                                }
                            }
                            let _ = def.0.Complete();
                        });
                    });
                    Ok(())
                }));
                let _ = core4.add_DownloadStarting(&h, &mut token);
            }
        }
    });
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
