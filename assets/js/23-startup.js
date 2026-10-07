  // ===========================================================================
  // STARTUP
  // ===========================================================================

  async function init() {
    // Cross-file initialization must happen here, after all ordered runtime
    // scripts have executed. This preserves the old single-script hoisting behavior.
    settings = loadSettings();
    setupManifest();
    setupPwaRuntime();
    buildColorPalette();
    buildSpecialChars();
    applySettings();
    setFilesDrawer(false);
    scheduleRulerBuild();
    bindEvents();
    try {
      db = await openDb();
      await purgeExpiredTrash();
      await refreshRestoreSafetyUi();
      await refreshFiles();
      if (!(await restoreSession())) { if (!restoreDrafts()) newTab('', { name: uniqueUntitledName(), dirty: false }); }
      status('');
    } catch (err) {
      console.error(err);
      status('IndexedDB could not be opened. Your browser may be blocking local storage for this file.');
      toast('Storage initialization failed.');
      newTab('', { name: 'Untitled', dirty: false });
    }
  }


  init();
