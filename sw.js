// Keep this name unique to Secure Vault. Bump it when releasing an update.
const CACHE = 'secure-vault-v4';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'picker.js',
  'vault2.js',
  'vault2-ui.js',
  'smart.js',
  'ui.js',
  'issuer.js',
  'issuer2.js',
  'docs2.js',
  'backup.js',
  'profile-click.js',
  'manifest.json',
  'icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Do not delete caches belonging to other sites on the same origin.
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('secure-vault-') && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

// Prefer fresh app files online; use the saved version offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(req);
    if (response.ok) cache.put(req, response.clone()).catch(() => {});
    return response;
  } catch {
    const saved = await cache.match(req);
    if (saved) return saved;
    if (req.mode === 'navigate') return cache.match('index.html');
    return Response.error();
  }
}

// Reuse downloaded third-party libraries when offline.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  if (saved) return saved;
  try {
    const response = await fetch(req);
    if (response.ok || response.type === 'opaque') {
      cache.put(req, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return Response.error();
  }
}
