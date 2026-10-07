  // ===========================================================================
  // BACKUP, RESTORE & SAFETY SNAPSHOTS
  // ===========================================================================

  async function collectPortableState() {
    // Synchronize the live editor before taking a snapshot so the backup cannot lag behind
    // the visible document by one edit.
    captureEditorIntoActive();
    persistUnsavedDrafts();
    persistSession();
    await saveRecoverySnapshot();

    return {
      format: 'Notepad Backup',
      formatVersion: 4,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      files: await idbGetAll(),
      assets: await storeGetAll(ASSET_STORE),
      trash: await storeGetAll(TRASH_STORE),
      localStorage: {
        settings,
        unsavedDrafts: readJsonStorage(LS_DRAFTS, []),
        session: readJsonStorage(LS_SESSION, null),
        expandedFolders: readJsonStorage(LS_EXPANDED_FOLDERS, []),
        recentFiles: readJsonStorage(LS_RECENT_FILES, []),
        closedTabs: readJsonStorage(LS_CLOSED_TABS, []),
        recovery: readJsonStorage(LS_RECOVERY, [])
      }
    };
  }

  function backupStats(payload) {
    const entries = Array.isArray(payload.files) ? payload.files : [];
    const folders = entries.filter(item => item?.type === 'folder').length;
    const filesN = entries.length - folders;
    const drafts = Array.isArray(payload.localStorage?.unsavedDrafts)
      ? payload.localStorage.unsavedDrafts.length
      : 0;
    const assets = Array.isArray(payload.assets) ? payload.assets.length : 0;
    return { filesN, folders, drafts, assets, total: entries.length };
  }

  function validateBackup(payload) {
    const warnings = [];
    const errors = [];

    if (!payload || !['Notepad Backup', 'HTML Notepad Backup'].includes(payload.format)) {
      errors.push('Unrecognized backup format.');
    }
    if (!Array.isArray(payload?.files)) {
      errors.push('Backup has no valid files array.');
    }
    if (errors.length) return { errors, warnings };

    const ids = new Set();
    const duplicateIds = new Set();
    for (const entry of payload.files) {
      if (!entry || typeof entry !== 'object') {
        warnings.push('One invalid filesystem entry will be skipped.');
        continue;
      }
      if (typeof entry.id === 'string') {
        if (ids.has(entry.id)) duplicateIds.add(entry.id);
        ids.add(entry.id);
      }
    }

    if (duplicateIds.size) {
      warnings.push(`${duplicateIds.size} duplicate ID${duplicateIds.size === 1 ? '' : 's'} found; conflicting entries will receive new IDs.`);
    }

    const brokenParents = payload.files.filter(entry => entry?.parentId && !ids.has(entry.parentId)).length;
    if (brokenParents) {
      warnings.push(`${brokenParents} item${brokenParents === 1 ? ' has' : 's have'} a missing parent folder and will be restored to Files root.`);
    }
    if (payload.assets !== undefined && !Array.isArray(payload.assets)) {
      warnings.push('The image asset section is invalid and will be skipped.');
    }
    return { errors, warnings };
  }
  async function refreshRestoreSafetyUi() {
    if (!db) {
      el.undoRestoreBtn.disabled = true;
      el.restoreSafetyStatus.textContent = 'Restore safety is unavailable until local storage is ready.';
      return false;
    }
    const record = await storeGet(SAFETY_STORE, 'preRestore');
    const snapshot = record?.payload;
    const available = !!snapshot;
    el.undoRestoreBtn.disabled = !available;
    if (!available) {
      el.restoreSafetyStatus.textContent = 'No restore safety snapshot is currently available.';
    } else {
      const when = snapshot.exportedAt ? new Date(snapshot.exportedAt) : null;
      const readable = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : null;
      el.restoreSafetyStatus.textContent = readable
        ? `Safety snapshot available from ${readable}.`
        : 'A safety snapshot from the most recent restore is available.';
    }
    return available;
  }

  async function openBackupRestore() {
    await refreshRestoreSafetyUi();
    el.backupRestoreDialog.showModal();
  }

  async function exportBackup(){
    const payload=await collectPortableState(),st=backupStats(payload);
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=`Notepad-Backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    status(`Backup exported: ${st.filesN} file${st.filesN===1?'':'s'} · ${st.folders} folder${st.folders===1?'':'s'} · ${st.drafts} draft${st.drafts===1?'':'s'} · ${st.assets} image asset${st.assets===1?'':'s'} · settings/workspace.`);
  }

  function sanitizeBackupItem(entry, index, usedIds) {
    const id = typeof entry?.id === 'string' && !usedIds.has(entry.id) ? entry.id : uid();
    usedIds.add(id);
    const now = new Date().toISOString();

    if (isProtectedRecord(entry)) {
      return {
        id,
        name: normalizeName(String(entry?.name || 'Recovered File')) || 'Recovered File',
        type:'file',
        parentId: typeof entry?.parentId === 'string' ? entry.parentId : null,
        content:'',
        docType:'protected',
        layout:null,
        protected:true,
        protection:entry.protection,
        encrypted:entry.encrypted,
        createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : now,
        updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : now,
        order: Number.isFinite(entry?.order) ? entry.order : index
      };
    }

    return {
      id,
      name: normalizeName(String(entry?.name || 'Recovered File')) || 'Recovered File',
      type: entry?.type === 'folder' ? 'folder' : 'file',
      parentId: typeof entry?.parentId === 'string' ? entry.parentId : null,
      layout: entry?.layout || { left: 0, first: 0, right: 0, tabs: [48] },
      content: typeof entry?.content === 'string' ? entry.content : '',
      docType: entry?.type === 'folder' ? 'rich' : (entry?.docType || 'rich'),
      createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : now,
      updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : now,
      order: Number.isFinite(entry?.order) ? entry.order : index
    };
  }

  async function openRestoreInspector(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON.');
      return;
    }

    const validation = validateBackup(payload);
    if (validation.errors.length) {
      toast(validation.errors[0]);
      return;
    }

    pendingRestorePayload = payload;
    const stats = backupStats(payload);
    const exportedAt = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : 'Unknown';
    el.restoreSummary.innerHTML =
      `<strong>Backup:</strong> ${escapeHtml(exportedAt)}<br>` +
      `<strong>Created by:</strong> Notepad ${escapeHtml(payload.appVersion || 'legacy')}<br>` +
      `<strong>Contents:</strong> ${stats.filesN} file${stats.filesN === 1 ? '' : 's'}, ` +
      `${stats.folders} folder${stats.folders === 1 ? '' : 's'}, ` +
      `${stats.drafts} unsaved draft${stats.drafts === 1 ? '' : 's'}, ` +
      `${stats.assets} image asset${stats.assets === 1 ? '' : 's'}`;

    el.restoreWarnings.hidden = !validation.warnings.length;
    el.restoreWarnings.textContent = validation.warnings.join(' ');
    el.restoreItemList.innerHTML = '';

    const fragment = document.createDocumentFragment();
    payload.files.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.restoreIndex = String(index);
      label.append(checkbox, document.createTextNode(`${entry.type === 'folder' ? '📁' : (isProtectedRecord(entry) ? '🔒' : '📄')} ${entry.name || 'Recovered File'}`));
      fragment.appendChild(label);
    });
    el.restoreItemList.appendChild(fragment);

    el.restoreFilesToggle.checked = true;
    el.restoreDraftsToggle.checked = true;
    el.restoreSettingsToggle.checked = true;
    el.restoreInspectorDialog.showModal();
  }

  async function createPreRestoreSnapshot() {
    // The safety copy lives in IndexedDB rather than localStorage because image-heavy
    // backups can exceed localStorage's much smaller quota.
    await storePut(SAFETY_STORE, { id: 'preRestore', payload: await collectPortableState() });
    await refreshRestoreSafetyUi();
  }

  async function applyRestore() {
    const payload = pendingRestorePayload;
    if (!payload) return;

    const mode = document.querySelector('input[name="restoreMode"]:checked')?.value || 'merge';
    const restoreFileData = el.restoreFilesToggle.checked;
    const restoreDraftData = el.restoreDraftsToggle.checked;
    const restoreSettingsData = el.restoreSettingsToggle.checked;
    if (!restoreFileData && !restoreDraftData && !restoreSettingsData) {
      toast('Choose something to restore.');
      return;
    }

    await createPreRestoreSnapshot();
    el.restoreInspectorDialog.close();

    if (restoreFileData) {
      const chosenIndexes = new Set(
        [...el.restoreItemList.querySelectorAll('input[data-restore-index]:checked')]
          .map(input => Number(input.dataset.restoreIndex))
      );
      const chosenEntries = payload.files.filter((_, index) => chosenIndexes.has(index));
      if (mode === 'replace') await idbClear();

      const existing = mode === 'merge' ? await idbGetAll() : [];
      const usedIds = new Set(existing.map(item => item.id));
      const idMap = new Map();
      const sanitized = [];

      chosenEntries.forEach((entry, index) => {
        const safeEntry = sanitizeBackupItem(entry, index, usedIds);
        if (entry?.id) idMap.set(entry.id, safeEntry.id);
        sanitized.push(safeEntry);
      });

      for (const entry of sanitized) {
        if (entry.parentId) {
          if (idMap.has(entry.parentId)) entry.parentId = idMap.get(entry.parentId);
          else if (mode === 'replace' || !existing.some(item => item.id === entry.parentId)) entry.parentId = null;
        }
        await idbPut(entry);
      }
    }

    if (restoreFileData && Array.isArray(payload.assets)) {
      if (mode === 'replace') await storeClear(ASSET_STORE);
      const existingAssetIds = new Set((await storeGetAll(ASSET_STORE)).map(asset => asset.id));
      for (const asset of payload.assets) {
        if (!asset?.id || !asset?.dataUrl) continue;
        if (mode === 'merge' && existingAssetIds.has(asset.id)) continue;
        await storePut(ASSET_STORE, asset);
      }
    }

    if (restoreDraftData) {
      const incoming = Array.isArray(payload.localStorage?.unsavedDrafts)
        ? payload.localStorage.unsavedDrafts
        : [];
      if (mode === 'merge') {
        const current = readJsonStorage(LS_DRAFTS, []);
        const ids = new Set(current.map(draft => draft.draftId));
        const added = incoming.map(draft => ({
          ...draft,
          draftId: ids.has(draft.draftId) ? uid() : (draft.draftId || uid())
        }));
        writeJsonStorage(LS_DRAFTS, [...current, ...added]);
      } else {
        writeJsonStorage(LS_DRAFTS, incoming);
      }
    }

    if (restoreSettingsData) {
      if (payload.localStorage?.settings) {
        settings = { ...defaultSettings, ...payload.localStorage.settings };
        settings.customDictionary = Array.isArray(settings.customDictionary) ? settings.customDictionary : [];
        rebuildSpellDictionary();
        saveSettings();
        applySettings();
      }
      writeJsonStorage(LS_EXPANDED_FOLDERS, payload.localStorage?.expandedFolders || []);
      writeJsonStorage(LS_RECENT_FILES, payload.localStorage?.recentFiles || []);
      writeJsonStorage(LS_CLOSED_TABS, payload.localStorage?.closedTabs || []);
      if (mode === 'replace') writeJsonStorage(LS_SESSION, payload.localStorage?.session || null);
    }

    // Rebuild all in-memory state from the restored stores so the UI and persistence agree.
    // A restore closes every document, so all protected-file keys and decrypted image
    // caches must be discarded before any restored file can be opened again.
    protectedSessions.clear();
    protectedAssetCaches.clear();
    tabs = [];
    activeTabId = null;
    selectedFileId = null;
    expandedFolders = new Set(readJsonStorage(LS_EXPANDED_FOLDERS, []));
    recentFileIds = readJsonStorage(LS_RECENT_FILES, []);
    closedTabs = readJsonStorage(LS_CLOSED_TABS, []);

    await refreshFiles();
    if (!(await restoreSession())) {
      if (!restoreDrafts()) newTab();
    }
    pendingRestorePayload = null;
    status(`Backup restored (${mode}).`);
    toast('Restore complete. Undo Last Restore is available.');
  }

  async function undoLastRestore() {
    const record = await storeGet(SAFETY_STORE, 'preRestore');
    const snapshot = record?.payload;
    if (!snapshot) {
      toast('No restore safety snapshot is available.');
      return;
    }

    if (el.backupRestoreDialog.open) el.backupRestoreDialog.close();

    const confirmed = await appConfirm(
      'Undo the last restore and return Notepad to its pre-restore state?',
      { title: 'Undo Last Restore?', confirmText: 'Undo Restore', danger: true }
    );
    if (!confirmed) return;

    await idbClear();
    for (const file of snapshot.files || []) await idbPut(file);
    await storeClear(ASSET_STORE);
    for (const asset of snapshot.assets || []) await storePut(ASSET_STORE, asset);

    settings = { ...defaultSettings, ...(snapshot.localStorage?.settings || {}) };
    settings.customDictionary = Array.isArray(settings.customDictionary) ? settings.customDictionary : [];
    rebuildSpellDictionary();
    saveSettings();
    applySettings();
    writeJsonStorage(LS_DRAFTS, snapshot.localStorage?.unsavedDrafts || []);
    writeJsonStorage(LS_SESSION, snapshot.localStorage?.session || null);
    writeJsonStorage(LS_EXPANDED_FOLDERS, snapshot.localStorage?.expandedFolders || []);
    writeJsonStorage(LS_RECENT_FILES, snapshot.localStorage?.recentFiles || []);
    writeJsonStorage(LS_CLOSED_TABS, snapshot.localStorage?.closedTabs || []);
    writeJsonStorage(LS_RECOVERY, snapshot.localStorage?.recovery || []);

    await storeDelete(SAFETY_STORE, 'preRestore');
    await refreshRestoreSafetyUi();
    protectedSessions.clear();
    protectedAssetCaches.clear();
    tabs = [];
    activeTabId = null;
    selectedFileId = null;
    expandedFolders = new Set(readJsonStorage(LS_EXPANDED_FOLDERS, []));
    recentFileIds = readJsonStorage(LS_RECENT_FILES, []);
    closedTabs = readJsonStorage(LS_CLOSED_TABS, []);

    await refreshFiles();
    if (!(await restoreSession())) {
      if (!restoreDrafts()) newTab();
    }
    status('Last restore undone.');
    toast('Returned to the pre-restore snapshot.');
  }
