# HTML Notepad v3.2.0

HTML Notepad is an offline-first browser notepad with an IndexedDB-backed virtual filesystem. Version 3.2.0 provides both a modular hosted/PWA build and the traditional single-file standalone build.

## Repository layout

- `index.html` — modular app shell for GitHub Pages / Cloudflare Pages
- `assets/styles.css` — application styles
- `assets/js/` — application logic, split into ordered scripts (`00-core.js` … `23-startup.js`)
- `manifest.webmanifest` — install metadata
- `sw.js` — offline application-shell cache
- `icons/` — PWA icons
- `tools/build_standalone.py` — regenerates the standalone file from the modular source
- `tests/smoke.js` — headless Chromium smoke tests (`cd tests && npm test`)
- `HTML%20Notepad v<version>.html` — generated single-file standalone edition (the file name contains a literal `%20`)

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

## Build and test

```bash
python3 tools/build_standalone.py          # regenerate the standalone edition (version from assets/js/00-core.js)
python3 tools/build_standalone.py --check  # fail if the committed standalone is stale
(cd tests && npm install && npm test)     # smoke tests (set CHROMIUM_PATH to reuse an installed Chromium)
```

Edit the modular source, bump `APP_VERSION` and the `sw.js` cache name together, then rebuild the standalone.

## Offline behavior

The standalone edition has no hosting requirement and remains a single self-contained HTML file. The modular edition needs HTTPS for PWA installation/service-worker registration, but once its application shell is cached it can launch offline. User-created hyperlinks can still open websites when deliberately activated.

## Cloudflare Pages / Workers deployment

Keep `package.json` out of the repository root: Cloudflare then runs `bun install` and `wrangler deploy` uploads
`node_modules` (Workers assets are limited to 25 MiB per file). Test dependencies live in `tests/`, and
`.assetsignore` keeps tooling files out of the deployed site. `wrangler.jsonc` serves the repository root as static assets.

## Word (.docx) import and Outline

Import reads `.docx` in the browser with no libraries (`assets/js/09a-docx-import.js`): text formatting,
links, simple lists, tables, images, Heading 1–6 styles (font/size/colour), and Table of Contents detection.
The Outline panel (`assets/js/18a-outline.js`, Ctrl+Alt+O) lists headings for jumping around a document.
Settings → *Large-document mode* (off by default) keeps documents over about 2 MB out of localStorage/IndexedDB
recovery copies and autosave; save them manually.
