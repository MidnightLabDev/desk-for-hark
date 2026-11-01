# Changelog

## 1.6.3

**Fixed**
- **Files panel**: clicking a file did nothing. It now scrolls to the message the file came in and highlights it, or, when that message isn't loaded, opens it in Hark's own message view.
- Notifications for the main chat now open Hark's chat page (`/chat`).

## 1.6.2

**Fixed**
- **Files panel** stopped at the newest messages with "HTTP 400". It now pages back through older messages the way Hark does, and a problem with an older page no longer hides the files already found.

## 1.6.1

**Fixed**
- **Files panel** showed "Couldn't read this project's files (list.filter is not a function)". It now understands both ways Hark sends a project's history.

## 1.6.0

**New**
- **Project files panel.** Press **Ctrl+Shift+F** in a project (or use the **FILES** tab on the right edge, or **Tray > Project files**) to see every file in that project's chat: **Sent by Hark** and **Uploaded by you**, newest first, with a search box.
- Click a file to jump to the message it came in, where Hark's preview is. **⤓** saves it straight to Downloads; **⧉** copies its name.
- It stays up to date while open and remembers whether you left it open. Turn it off in **Settings > Files panel**.
- Files are read from your own signed-in Hark session and nothing is stored or sent anywhere. Files Hark made but never sent in chat aren't listed, since Hark's web app has no list of them.

## 1.5.1

**Improved**
- **Clicking a notification is instant**: it switches to that chat or project inside Hark, like clicking it in the sidebar, instead of reloading the whole app. If that ever doesn't work, it falls back to loading the page as before.

## 1.5.0

**Changed**
- **Notifications rebuilt on Hark's own unread status.** Every few seconds the app asks Hark which conversations are unread or waiting for you, the same check Hark's web app makes, so replies in any chat or project notify reliably: **New reply in <project>**, and clicking opens it.
- The open chat is no longer marked as read while the window is hidden or minimised, so its replies notify too; it's marked read when you come back.
- The tray and taskbar dot clears once nothing is unread.
- **Tray > Notification status…** now shows the last check, what's waiting for you and any error.

**Removed**
- The 1.4.2 guess based on sidebar order. Reading the page text is kept only as a backup when Hark's status check isn't answering.

## 1.4.4

**Fixed**
- **Download opens no extra window**: Hark's Download used to open an empty black window. Windows the app opens for Hark now stay hidden; a download is saved straight to Downloads (with a "Saved to Downloads" notification) and the hidden window closes itself. A window only appears if it turns out to be a real page.

## 1.4.3

**Fixed**
- **File previews and Download, take two**: clicking a file in a chat shows Hark's preview again (the app always fetches Hark's files fresh, so an earlier cached copy can't break the preview), and **Download** no longer opens an empty black window; the file is saved straight to Downloads.

## 1.4.2

**New**
- **Notifications for other chats and projects**: while the window is hidden or minimised, a reply in a chat or project that isn't the one open now also gives you a notification (when Hark moves it to the top of its sidebar). Click it to go straight there.

## 1.4.1

**Fixed**
- **Opening big files in Hark no longer crashes the app**: clicking a large file (like a long code file) shows Hark's normal preview again, and it only saves when you click Download. The page used to inspect every change Hark made to it, which froze on previews with thousands of lines; the app's own background check does that job now.

## 1.4.0

**New**
- **Click a new-message notification to open that chat**: the window comes back and goes straight to the chat or project the reply arrived in.

## 1.3.9

**Fixed**
- **New-message notifications now show the reply itself**: 1.3.8's pop-up could show chat titles from the sidebar instead of the message. The app now only uses text that's genuinely new in the chat, and skips changes that are just chats moving around in the sidebar.

## 1.3.8

**Fixed**
- **New-message notifications while hidden or minimised, take three**: the app now checks Hark's open chat itself every few seconds while the window is away, instead of relying on the page to tell it, and notifies when a new reply has arrived.

**New**
- **Tray > Notification status…** shows how many background checks have run and how many notifications were shown, to help track down problems.

## 1.3.7

**Fixed**
- **No notifications while minimised or hidden with Alt+Space**: Windows told Hark's page it was hidden, so Hark stopped updating it until you came back, and there was nothing to notify about. The page now stays awake in the background (minimised or in the tray), so replies arrive and you get the notification and the unread dot.

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
