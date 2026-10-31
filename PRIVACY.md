# Privacy

Desk for Hark is a desktop window around https://app.hark.com.

**The app itself collects nothing.** No analytics, no telemetry, no crash reporting, no accounts of its own. It never sends your data to MidnightLab or anyone else.

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## What stays on your PC

- Your Hark sign-in and site data, in the app's WebView2 profile: `%LOCALAPPDATA%\dev.midnightlab.deskforhark\webview` (the same way a browser keeps cookies).
- Your settings (`settings.json`) and optional custom CSS (`theme.css`): `%APPDATA%\dev.midnightlab.deskforhark`.
- Project groups (names, colours and which projects are in them): stored in the app window's local storage for app.hark.com on this PC. They are never sent to Hark or anyone else.
- Window size and position.

## When the app touches your clipboard or files

Only when you ask it to:

- **Screenshot to Hark** opens the Windows snipping tool and reads the snip from the clipboard.
- **Send selection** presses Ctrl+C in the app you're using, reads that text, and puts your previous clipboard text back.
- **Send to > Desk for Hark** reads the files you chose.

In each case the content goes only into Hark's message box, inside the app, and nowhere else.

## Network requests the app makes on its own

- Loading Hark and its sign-in providers (Google, Apple) when you use them.
- A check for updates on GitHub Releases (`github.com/MidnightLabDev/desk-for-hark`) at launch or when you click "Check for updates…". This is a normal web request with nothing about you in it.
- While offline, a small request to `app.hark.com` every 5 seconds to see if you're back online.

## Microphone

With "Allow microphone for app.hark.com" on (the default), Hark's voice features can use your microphone without a prompt. No other site gets this. Turn it off in Settings to be asked each time.

## Hark itself

Everything you do inside Hark is handled by Hark under its own privacy policy: https://hark.com/privacy-policy

## Removing everything

Uninstall the app, then delete the two folders above.
