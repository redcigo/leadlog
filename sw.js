/*
 * Service worker: makes the app work offline by keeping its own files in a cache.
 * It never handles requests to other sites and never touches lead data.
 * Bump VERSION whenever any app file changes so phones pick up the update.
 */
'use strict';

const VERSION = '1.4.0';
const CACHE = `leadlog-${VERSION}`;
// Business card reading (about 43 MB) is kept in its own cache, filled the first
// time it is used, so app updates don't download it again.
const OCR_CACHE = 'leadlog-ocr-paddle-v6-ort-1.23.2';
const OCR_PATHS = ['/vendor/onnxruntime/', '/vendor/paddleocr/'];
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/i18n.js',
  './js/icons.js',
  './js/contact-parser.js',
  './js/scanner.js',
  './js/qr-worker.js',
  './js/export.js',
  './js/ui.js',
  './js/illustrations.js',
  './js/sharing.js',
  './js/roster.js',
  './js/qr-code.js',
  './js/card-reader.js',
  './js/ocr-worker.js',
  './js/card-parser.js',
  './vendor/jsqr.js',
  './vendor/qrcode.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  // The new version waits until the app asks it to take over, so nothing
  // changes under someone mid-way through entering a lead.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('leadlog-') && k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Always open the cached app shell, so it starts with no signal.
    event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(request)));
    return;
  }
  if (OCR_PATHS.some((path) => url.pathname.includes(path))) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
