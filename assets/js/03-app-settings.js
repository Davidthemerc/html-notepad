  // ===========================================================================
  // APP METADATA & SETTINGS
  // ===========================================================================

  function setupManifest() {
    // The modular build has a normal manifest.webmanifest. The standalone build creates
    // the same manifest as a Blob so it can remain a single self-contained HTML file.
    if (document.documentElement.dataset.build === 'modular') return;
    const icon192 = document.querySelector('link[rel~="icon"][sizes="192x192"]')?.href || '';
    const icon512 = document.querySelector('link[rel~="icon"][sizes="512x512"]')?.href || icon192;
    const manifest = {
      name: 'Notepad', short_name: 'Notepad', description: 'Offline IndexedDB-backed HTML notepad',
      id: './', start_url: './', scope: './', display: 'standalone', orientation: 'any',
      background_color: '#f4f6f8', theme_color: '#2d5f86',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ].filter(icon => icon.src)
    };
    try {
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      $('appManifest').href = URL.createObjectURL(blob);
    } catch {}
  }

  let pwaWaitingWorker = null;
  let pwaReloadForUpdate = false;

  function showPwaUpdateNotice(worker) {
    if (!worker) return;
    pwaWaitingWorker = worker;
    const notice = $('pwaUpdateNotice');
    if (notice) notice.hidden = false;
  }

  function hidePwaUpdateNotice() {
    const notice = $('pwaUpdateNotice');
    if (notice) notice.hidden = true;
  }

  async function restartIntoPwaUpdate() {
    const worker = pwaWaitingWorker;
    if (!worker) return;
    const restartBtn = $('pwaUpdateRestartBtn');
    if (restartBtn) restartBtn.disabled = true;
    try {
      // Capture the live editor first. Draft/session storage is synchronous;
      // recovery may include encrypted protected-document state, so await it.
      captureEditorIntoActive();
      persistUnsavedDrafts();
      persistSession();
      await saveRecoverySnapshot();
      pwaReloadForUpdate = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      console.error('Notepad could not prepare the update restart.', error);
      pwaReloadForUpdate = false;
      if (restartBtn) restartBtn.disabled = false;
      toast('Could not prepare the update. Keep working and try again.');
    }
  }

  function setupPwaRuntime() {
    if (document.documentElement.dataset.build !== 'modular') return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!pwaReloadForUpdate) return;
      pwaReloadForUpdate = false;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js').then(registration => {
      // A waiting worker can already exist when the app is reopened.
      if (registration.waiting && navigator.serviceWorker.controller) {
        showPwaUpdateNotice(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showPwaUpdateNotice(registration.waiting || installing);
          }
        });
      });

      // Ask the browser to check promptly when Notepad opens.
      registration.update().catch(() => {});
    }).catch(error => {
      console.warn('Notepad service worker registration failed.', error);
    });

    $('pwaUpdateRestartBtn')?.addEventListener('click', restartIntoPwaUpdate);
    $('pwaUpdateLaterBtn')?.addEventListener('click', hidePwaUpdateNotice);
  }

  function uid() {
    return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() :
      'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function loadSettings() {
    const loaded = {
      ...defaultSettings,
      ...readJsonStorage(LS_SETTINGS, {})
    };
    loaded.customDictionary = Array.isArray(loaded.customDictionary)
      ? [...new Set(loaded.customDictionary.map(word => String(word || '').trim()).filter(Boolean))]
      : [];
    return loaded;
  }

  function saveSettings() {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  }

  function applySettings() {
    const darkBySystem = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && darkBySystem);
    document.body.classList.toggle('dark', isDark);
    document.body.classList.toggle('purple', settings.theme === 'purple');
    document.body.classList.toggle('emerald', settings.theme === 'emerald');
    document.documentElement.dataset.theme = settings.theme === 'system'
      ? (darkBySystem ? 'dark' : 'light')
      : settings.theme;
    el.editor.classList.toggle('no-wrap', !settings.wrap);
    el.editor.spellcheck = !!settings.spellcheck && !('highlights' in CSS); // Native fallback only when Custom Highlight API is unavailable.
    syncLineNumberVisibility();
    updateLineNumbers();
    applyZoom();
    scheduleSpellcheck(0);
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove('show'), 2300);
  }

  function status(message) {
    el.statusMessage.textContent = message;
  }
