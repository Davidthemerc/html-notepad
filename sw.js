const CACHE_NAME = 'html-notepad-v2.9.2';
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/styles.css",
  "./assets/js/00-core.js",
  "./assets/js/01-spell-dictionary.js",
  "./assets/js/02-spellcheck.js",
  "./assets/js/03-app-settings.js",
  "./assets/js/04-storage.js",
  "./assets/js/05-layout-rulers.js",
  "./assets/js/06-filesystem.js",
  "./assets/js/07-tabs-session-split.js",
  "./assets/js/08-markdown.js",
  "./assets/js/09-import-export.js",
  "./assets/js/10-protection.js",
  "./assets/js/11-trash.js",
  "./assets/js/12-backup-restore.js",
  "./assets/js/13-editor-selection-links.js",
  "./assets/js/14-font-color.js",
  "./assets/js/15-document-tools.js",
  "./assets/js/16-context-clipboard-print.js",
  "./assets/js/17-dirty-recovery-settings.js",
  "./assets/js/18-find-replace.js",
  "./assets/js/19-tab-key.js",
  "./assets/js/20-editor-events.js",
  "./assets/js/21-help-manual.js",
  "./assets/js/22-event-binding.js",
  "./assets/js/23-startup.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
