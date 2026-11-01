# Changelog

## 1.3.6

**Fixed**
- **Downloading files from Hark** (for example a .tsx or .txt file) opened a page showing the file instead of saving it. They're now saved straight to Downloads (or where you choose, with **Ask where to save downloads** on), with a notification.
- **Arabic and other non-Latin text in those files looked garbled**: the page guessed the wrong text encoding. Files are now saved byte for byte, so they open correctly in your editor.
- Other windows Hark opens now close themselves when they hand off to a download or to your browser.

## 1.3.5

**Fixed**
- **Notifications and the tray dot for new replies while minimised**: the page couldn't reliably tell the window was minimised, so it never asked for a notification. The app now decides that itself, also checks how much text the chat holds every few seconds as a backup, and keeps the tray and taskbar dot lit until you bring the window back.

## 1.3.4

**Fixed**
- **Settings > Close** left an empty white window open. It now closes the Settings window properly.

## 1.3.3

**Fixed**
- **Notifications for new messages**: Hark's web app doesn't always send a browser notification inside the app, so new replies could arrive silently. The app now watches for new messages itself while the window is hidden, minimised or in the background, and shows a Windows notification (at most one every 15 seconds).

**New**
- **Tray > Send a test notification**, to check that Windows is showing the app's notifications.

## 1.3.2

**Fixed**
- **Show / Hide** in the tray, and clicking the tray icon, now hide the window when it's open. Before, they could only show it.

**Removed**
- **Print or save as PDF**: the tray item is gone and `Ctrl+P` no longer opens the print dialog.

## 1.3.1

**Changed**
- **Check for updates (manual)…** in the tray now opens the latest release on GitHub. Download the new installer and run it over your current version; your settings and sign-in are kept. Automatic updates will come back once signed update files are published.

## 1.3.0

**Improved**
- **One-click downloads**: saving a file from Hark now puts it straight in your Downloads folder, with no extra dialog or download bubble. A notification tells you when it's saved. If a file with that name exists, the new one gets a number, like "report (1).pdf". You can still turn on **Ask where to save downloads** in Settings.

**Removed**
- **Project groups**, along with its tray item and `Ctrl+Shift+G`. Groups saved by 1.1.0 or 1.2.0 are cleared from this PC.

## 1.2.0

**New**
- **Global event themes**: New Year (fireworks), Halloween (bats), Valentine's Day (hearts), Lunar New Year (lanterns), St Patrick's Day (clovers) and Earth Day (leaves), alongside Christmas (snow).
- **Mood themes**: Aurora (moving green and violet light) and Ocean (rising bubbles).
- **Theme effects** setting replaces Snowfall and covers every animated theme. Effects never block clicks and stop when Windows is set to reduce motion.

**Removed**
- The **Paper** theme. If you were using it, the app switches to the Hark theme. Follow Windows and Scheduled now use Hark's own light mode in the daytime.

## 1.1.0

**New**
- **Project groups**: sort your Hark projects into named, coloured groups (`Ctrl+Shift+G` or Tray > Project groups…). Drag projects between groups, collapse groups, click to open. Grouped projects get a coloured dot in Hark's sidebar. Saved on this PC only.
- **Christmas theme**: pine green, cranberry and gold. Optional light snowfall (Settings > Snowfall) that sits on top and never blocks clicks. Only colours change; Hark's layout stays the same.

**Fixed**
- **Paper** was too bright and hid the projects in the sidebar. It now builds on Hark's own light mode with a warm off-white tint, so text keeps its contrast.
- Midnight, Teal and High contrast now also recolour the parts of Hark that use its newer colour tokens (sidebar, panels, message box), so no area is left in the default colours.

## 1.0.1

**Fixed**
- Dragging files from Explorer onto the window now attaches them in Hark. Before, the app caught the drop and Hark never saw it.

## 1.0.0

First public release: Quick Ask, Screenshot to Hark, Send selection, voice hotkey, configurable hotkeys, themes (Hark, Midnight, Teal, Paper, High contrast, Follow Windows, Scheduled), accent/font/text size/compact/custom CSS, Mica title bar, tray icon variants with unread dot, always on top, compact mode, Explorer Send to, taskbar jump list, Save dialog for downloads, print to PDF, offline screen and crash recovery.
