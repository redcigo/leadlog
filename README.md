# LeadLog

A small web app for exhibitions and career fairs: capture leads, scan badge QR codes, and export the results to Excel. It installs to the iPhone Home Screen and works with no signal.

## Privacy

- All data stays on the device, in the browser's IndexedDB storage. There is no server, account or sync.
- The app makes no requests to other websites. A Content Security Policy in `index.html` blocks connections to anything except the app's own files.
- No analytics, tracking, fonts or scripts are loaded from third parties.
- Data leaves the device only when you export or back it up yourself.

## Features

- Shows of two types: trade show and career fair, each with its own form fields.
- Badge and business-card QR scanning (vCard, MeCard, BIZCARD and common delimited formats). Badges that only carry an ID keep the code with the lead for matching against the organiser's export.
- Optional photo per lead (business card, CV).
- Report with leads by hour, interests and countries or schools.
- Export to Excel (.xlsx) or CSV through the share sheet.
- Full backup and restore as a JSON file.
- English and Czech. Light and dark mode follow the system setting.

## Install on iPhone

1. Open the site in Safari.
2. Tap Share, then Add to Home Screen.
3. Open LeadLog from the Home Screen once while online, so it saves itself for offline use.

## Publishing with GitHub Pages

1. Create a repository and upload the contents of this folder (keep the folder structure).
2. In the repository, open Settings, then Pages. Under "Build and deployment", choose "Deploy from a branch", select `main` and `/ (root)`, and save.
3. The app is served at `https://<username>.github.io/<repository>/`.

## Updating

Change the files, then increase `VERSION` in `sw.js` and `APP_VERSION` in `js/app.js`. Installed copies show an "Update" prompt the next time they open online. Saved leads are not affected by updates.

## Project structure

```
index.html              App shell and security policy
manifest.webmanifest    Install settings (name, icons, colours)
sw.js                   Offline cache for the app's own files
css/app.css             Styles
js/app.js               Screens and app logic
js/db.js                Local storage (IndexedDB)
js/i18n.js              English and Czech text
js/contact-parser.js    Reads contact details from QR codes
js/scanner.js           Camera scanning and photo handling
js/qr-worker.js         QR decoding in a background thread
js/export.js            Excel and CSV files, sharing
js/icons.js             Interface icons
vendor/jsqr.js          jsQR 1.4.0 (QR decoding)
icons/                  App icons
```

No build step is needed; the files run as they are.

## Third-party code

- [jsQR](https://github.com/cozmo/jsQR) 1.4.0, Apache License 2.0. See `vendor/jsqr-LICENSE.txt`.
