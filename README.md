# LeadLog

A small web app for exhibitions and career fairs: capture leads, scan badge QR codes, and export the results to Excel. It installs to the iPhone Home Screen and works with no signal.

## Privacy

- All data stays on the device, in the browser's IndexedDB storage. There is no server, account or cloud sync.
- The app makes no requests to other websites. A Content Security Policy in `index.html` blocks connections to anything except the app's own files.
- No analytics, tracking, fonts or scripts are loaded from third parties.
- Data leaves the device only when you choose to: an export, a backup, a show file sent to a colleague, or a lead shown as a QR code.
- The camera is used only to read QR codes. Frames are decoded on the device and never stored.

## Features

- Shows of two types: trade show and career fair, each with its own form fields and an optional logo.
- Badge and business-card QR scanning (vCard, MeCard, BIZCARD and common delimited formats), with a short confirmation when a code is read.
- Badges that only carry an ID: the lead can be saved with just the code, a business card photo is offered straight away, and the organiser's lead export (Excel or CSV) can be imported to fill in names and companies.
- Each lead records who captured it.
- Colleagues: send a show's leads as a file (AirDrop, Quick Share, email) and merge it on the other phone, skipping duplicates; or hand over a single lead as a QR code, offline.
- Business card reading: photograph a card and the form fills itself in (name, company, job title, email, phone, country). Text recognition runs on the phone, offline; nothing is sent anywhere.
- Optional photo per lead (business card, CV).
- Report with leads by hour, interests, countries or schools, and who captured them.
- Export to Excel (.xlsx) or CSV through the share sheet, plus a Mailchimp CSV (first name, last name, company, email; only leads who agreed to be contacted).
- Full backup and restore as a JSON file.
- Option lists (interests, follow-up actions) can be reordered by dragging.
- English and Czech. Light and dark mode follow the system setting. Motion follows the Reduce Motion setting.

## Install on iPhone

1. Open the site in Safari.
2. Tap Share, then Add to Home Screen.
3. Open LeadLog from the Home Screen once while online, so it saves itself for offline use.

On Android, open the site in Chrome, tap ⋮, then Add to Home screen (or Install app).

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
js/ui.js                Shared interface parts: sheets, pages, motion, lists
js/db.js                Local storage (IndexedDB)
js/i18n.js              English and Czech text
js/contact-parser.js    Reads contact details from QR codes
js/scanner.js           Camera scanning and photo handling
js/qr-worker.js         QR decoding in a background thread
js/qr-code.js           Draws QR codes (lead hand-over)
js/sharing.js           Show files and lead QR codes for colleagues
js/roster.js            Reads the organiser's lead list (CSV, .xlsx)
js/card-reader.js       Business card text recognition (starts ocr-worker.js)
js/ocr-worker.js        PaddleOCR detection and recognition, run with ONNX Runtime
js/card-parser.js       Sorts business card text into lead fields
js/export.js            Excel and CSV files, sharing
js/icons.js             Interface icons
js/illustrations.js     Line illustrations
vendor/jsqr.js          jsQR 1.4.0 (QR decoding)
vendor/qrcode.mjs       qrcode-generator 2.0.4 (QR encoding)
vendor/onnxruntime/     ONNX Runtime Web 1.23.2, WebAssembly build (runs the text recognition models)
vendor/paddleocr/       PaddleOCR PP-OCRv6 small detection and recognition models
icons/                  App icons
```

No build step is needed; the files run as they are.

## Third-party code

- [jsQR](https://github.com/cozmo/jsQR) 1.4.0, Apache License 2.0. See `vendor/jsqr-LICENSE.txt`.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4, MIT License. See `vendor/qrcode-LICENSE.txt`.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.23.2, MIT License. See `vendor/onnxruntime/`.
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv6 small models, Apache License 2.0. See `vendor/paddleocr/`.
