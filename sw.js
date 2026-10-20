const CACHE = 'vault-v1';   // bump this (e.g. 'vault-v2') on every release

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon.svg'
];

// Optional OCR files. Edit this list to match the exact file names you copied into vendor/.
const OPTIONAL = [
  'vendor/tesseract.min.js',
  'vendor/worker.min.js',
  'vendor/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    for (const url of OPTIONAL) {
      try { await cache.add(url); } catch { /* missing optional file: skip */ }
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request))
  );
});
