# HTML Notepad v3.0.0

HTML Notepad is an offline-first browser notepad with an IndexedDB-backed virtual filesystem. Version 3.0.0 provides both a modular hosted/PWA build and the traditional single-file standalone build.

## Repository layout

- `index.html` — modular app shell for GitHub Pages / Cloudflare Pages
- `assets/styles.css` — application styles
- `assets/js/` — application logic, split into ordered scripts (`00-core.js` … `23-startup.js`)
- `manifest.webmanifest` — install metadata
- `sw.js` — offline application-shell cache
- `icons/` — PWA icons
- `HTML Notepad v2.9.x.html` — single-file standalone editions (files are stored with a literal `%20` in their names)

## GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Deploy from the branch containing `index.html` (normally `main`, root `/`).
4. Open the resulting HTTPS Pages address in Chrome on Android.
5. Use Chrome's **Install app** / **Add to Home screen** option.

The service worker caches the application shell so the installed app can launch without a connection after it has been loaded successfully at least once.

## Local data and privacy

Documents are not uploaded to the host by HTML Notepad. Saved documents, folders, images, drafts, settings, and session data remain in the browser's IndexedDB/localStorage for that origin. The server only hosts the application files.

A local standalone file and a hosted PWA use different browser storage origins, so their Notepad libraries do **not** automatically share data. Use **Backup & Restore** to transfer a library between them.

## Offline behavior

The standalone edition has no hosting requirement and remains a single self-contained HTML file. The modular edition needs HTTPS for PWA installation/service-worker registration, but once its application shell is cached it can launch offline. User-created hyperlinks can still open websites when deliberately activated.
