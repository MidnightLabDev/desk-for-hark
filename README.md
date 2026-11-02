<p align="center"><img src="assets/icon-source.png" width="96" alt="Desk for Hark icon"></p>

<h1 align="center">Desk for Hark</h1>

<p align="center">An unofficial Windows desktop app for <a href="https://hark.com">Hark</a>, with hotkeys, screenshots, themes and a proper tray icon.</p>

> **Unofficial.** Desk for Hark is an independent open-source project. It is not affiliated with, endorsed by, or supported by Hark. "Hark" is a trademark of its owner. The app simply loads https://app.hark.com in its own window.

## Download

Grab the latest installer from [Releases](https://github.com/MidnightLabDev/desk-for-hark/releases/latest):

- **`Desk.for.Hark_x.y.z_x64-setup.exe`** (recommended)
- `Desk.for.Hark_x.y.z_x64_en-US.msi` (for managed installs)

Windows 10 (1809+) or Windows 11, 64-bit. It installs to `C:\Program Files\Desk for Hark`.

**Updates are manual for now.** **Tray > Check for updates (manual)…** opens the [latest release](https://github.com/MidnightLabDev/desk-for-hark/releases/latest); download the new installer and run it over your current version. Your settings and sign-in are kept.

> The installers aren't code-signed yet, so Windows SmartScreen may warn you. Click **More info**, then **Run anyway**.

## Features

**Faster ways in**
- **Show/hide hotkey**: `Alt+Space` (fallback `Ctrl+Shift+Space`).
- **Quick Ask**: `Alt+Shift+Space` opens a small floating box. Type, press Enter, and it goes straight to Hark.
- **Screenshot to Hark**: `Alt+Shift+S` lets you snip any part of the screen and attaches it to your message.
- **Send selection**: select text in any app, press `Alt+Shift+C`, and it lands in Hark's message box. Your clipboard is put back afterwards.
- **Voice**: `Alt+Shift+V` presses Hark's voice button, and the microphone is allowed for app.hark.com so there's no prompt.
- **Send to**: right-click any file in Explorer, then **Send to > Desk for Hark** to attach it (turn this on from the tray or Settings).
- **Jump list**: right-click the taskbar icon for Quick Ask, Screenshot, Open Hark and Settings.

**Feels native**
- Tray icon (white, black or colour, matching your taskbar) with an **unread dot** when Hark replies while the app is hidden, plus a taskbar badge.
- **Always on top** and **Compact mode** (a slim window pinned to the right edge of the screen).
- Native Windows notifications for every chat and project. The app checks Hark's own unread status every few seconds (inside your signed-in session, nothing leaves your PC), so when a reply lands anywhere you get **New reply in <project>**, with the start of the reply for the chat you have open. Click it to switch straight there, without reloading Hark. While the window is hidden or minimised, the open chat isn't marked as read until you're back, and the tray and taskbar dot stays until then. **Tray > Notification status…** shows the last check, what's waiting for you and any error. **Tray > Send a test notification** checks that Windows is showing them; if not, turn off **Do not disturb** and allow **Desk for Hark** in **Windows Settings > System > Notifications**.
- Starts hidden in the tray when launched at login.
- Themed or **Mica** title bar, and Windows snap layouts.
- Single instance, remembers its size and position, closes to the tray.
- **Settings** (tray > Settings…): **Save**, **Save and restart**, or **Close** to leave without saving.

**Themes**
- **Everyday**: **Hark** (default), **Midnight** (true black), **Teal** and **High contrast**.
- **Global events**, each with its own animated effect:
  - **Christmas**: pine green, cranberry and gold, with snow.
  - **New Year**: black and champagne gold, with fireworks.
  - **Halloween**: charcoal and pumpkin orange, with bats.
  - **Valentine's Day**: wine and blush pink, with floating hearts.
  - **Lunar New Year**: red and gold, with lanterns.
  - **St Patrick's Day**: emerald and gold, with falling clovers.
  - **Earth Day**: forest and sky blue, with drifting leaves.
- **Moods**: **Aurora** (night sky with moving green and violet light) and **Ocean** (navy and aqua, with bubbles).
- Effects sit on top of the page, never block clicks, and can be turned off in **Settings > Theme effects**. They switch off when Windows is set to reduce motion. Only colours change; Hark's layout stays the same. On every Desk dark theme (the Hark theme is left exactly as Hark designed it), text stays white and readable: anything too faint against its background is brightened automatically.
- **Follow Windows** (Hark's light or dark mode plus your accent colour) and **Scheduled** (dark at night, Hark's light mode by day, at times you choose).
- Accent colour, font, text size and compact spacing.
- `theme.css` for your own CSS, reloaded live when you save it.

**Reliability**
- A clean offline screen that reconnects by itself.
- Automatic recovery if the page crashes or freezes.
- **One-click downloads**: files you save from Hark go straight to your Downloads folder, with a notification when they're done. Prefer to choose the place each time? Turn on **Settings > Ask where to save downloads**. **Open Downloads folder** is in the tray. Files Hark gives you (code, text, documents, archives) are saved exactly as they are, so Arabic and other non-Latin text stays intact; images, PDFs, audio and video still open to view. Clicking a file in a chat shows Hark's usual preview; it only saves when you click **Download**, straight to Downloads with no extra window.
- **Project files panel**: `Ctrl+Shift+F` in a project (or the **FILES** tab on the right edge, or **Tray > Project files**) lists every file in that project's chat, sent by Hark or uploaded by you, with search. Click one to preview it (images, PDFs, code and text, audio and video); **⌕** scrolls back to the message it came in (as far as needed, with Cancel); **Message** in the viewer shows that message and your request without scrolling; download it straight to Downloads, or **⧉ Ask in chat** to have Hark send it again (fills the message box; you press Enter). If a file can't be shown, the viewer says why and offers **Copy details** (no private tokens). It only lists files that appeared in the chat (up to the last 10 pages of history). Turn it off in **Settings > Files panel**.
- Drag files from Explorer straight onto the window to attach them.
- `Ctrl+R`/`F5` reload, `Ctrl` `+`/`-`/`0` and `Ctrl`+wheel zoom.

Everything is configurable from **Tray > Settings…**.

> Quick Ask, Send selection, screenshots, Send to and the voice hotkey work by typing into, pasting into or clicking Hark's page. If Hark changes its layout, some of them may need an update.

## What's new

See [CHANGELOG.md](CHANGELOG.md).

## Privacy

The app collects nothing itself. See [PRIVACY.md](PRIVACY.md).

## Security

- Only `https://app.hark.com` and the app's own bundled pages can call the app's native functions. Google and Apple sign-in pages load inside the window but get no native access.
- Settings and Quick Ask commands only work from the app's own pages.
- Every other link opens in your default browser.
- Updates are verified against the updater public key in `tauri.conf.json` before installing.

## Build from source

Requirements: Windows, [Rust](https://rustup.rs), Node.js LTS, and the WebView2 runtime (built into Windows 11).

```powershell
npm ci
npx tauri dev      # run
npx tauri build    # installers in src-tauri\target\release\bundle
```

Icons are generated from `assets/`: `python assets/make_icon.py`, `python assets/make_tray_icons.py`, `python assets/make_installer_art.py`, then `npx tauri icon assets/icon-source.png`.

## Releases (maintainers)

Every push to `main` builds the installers on GitHub Actions and publishes a release tagged `v<version>` (bump `version` in `src-tauri/tauri.conf.json`). The release notes come from that version's section in [CHANGELOG.md](CHANGELOG.md), so add one with every change.

| Name | Kind | Purpose |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | secret | Updater signing key. Without it the build still works but ships no update files. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | Only if the key has a password. |
| `WINDOWS_SIGN_COMMAND` | variable | Optional Authenticode sign command, `%1` = file to sign. |
| `SIGN_SECRET_1..3` | secrets | Optional credentials the sign command needs, exposed as env vars. |

## Licence

[MIT](LICENSE). The licence covers this code only and grants no rights to Hark's name, logo or service.
