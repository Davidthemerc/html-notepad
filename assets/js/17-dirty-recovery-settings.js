  // ===========================================================================
  // DIRTY STATE, RECOVERY & SETTINGS
  // ===========================================================================

  function markDirtyFromEditor() {
    const tab = currentTab();
    if (!tab) return;

    tab.content = isSourceTab(tab) ? el.markdownSource.value : serializedEditorHtml();
    tab.dirty = true;
    tab.updatedAt = new Date().toISOString();
    renderTabs();
    updateCounts();

    if (!tab.fileId) persistUnsavedDraftsSoon();
    persistSessionSoon();
    scheduleAutosave();
  }

  async function saveRecoverySnapshot() {
    const sequence = (saveRecoverySnapshot._sequence || 0) + 1;
    saveRecoverySnapshot._sequence = sequence;

    captureEditorIntoActive();
    const tab = currentTab();
    if (!tab) {
      localStorage.removeItem(LS_RECOVERY);
      return;
    }

    const snapshot = {
      tabId: tab.tabId,
      fileId: tab.fileId || null,
      name: tab.name,
      content: tab.content || '',
      dirty: !!tab.dirty,
      scrollTop: tab.scrollTop || 0,
      selection: tab.selection || null,
      layout: tab.layout || null,
      docType:tab.docType||'rich',
      markdownMode:tab.markdownMode||'edit',
      capturedAt: new Date().toISOString()
    };

    if (tab.protected && tab.fileId) {
      const session = protectedSessions.get(tab.fileId);
      const record = await idbGet(tab.fileId);
      if (!session || !isProtectedRecord(record)) {
        localStorage.removeItem(LS_RECOVERY);
        return;
      }
      try {
        const envelope = await encryptJsonWithKey(
          session.dekKey, snapshot, protectionAad(record, 'recovery-snapshot')
        );
        if (sequence !== saveRecoverySnapshot._sequence) return;
        writeJsonStorage(LS_RECOVERY, [{
          protected:true,
          tabId:tab.tabId,
          fileId:tab.fileId,
          name:tab.name,
          protectionId:record.protection.protectionId,
          iv:envelope.iv,
          data:envelope.data,
          capturedAt:snapshot.capturedAt
        }]);
      } catch (error) {
        console.warn('Could not write encrypted recovery snapshot:', error);
      }
      return;
    }

    if (sequence !== saveRecoverySnapshot._sequence) return;
    writeJsonStorage(LS_RECOVERY, [snapshot]);
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const tab = currentTab();
      if (!tab) return;

      // Recovery always tracks the active editor. Autosave is a separate decision and only
      // writes a dirty, already-saved document back to IndexedDB.
      saveRecoverySnapshot();
      if (tab.dirty && settings.autosave && tab.fileId) await saveCurrent(false);
    }, 1500);
  }

  function openSettings() {
    el.themeSelect.value = settings.theme;
    el.wrapToggle.checked = settings.wrap;
    el.spellcheckToggle.checked = settings.spellcheck;
    el.autoLinksToggle.checked = settings.autoLinks;
    el.autosaveToggle.checked = settings.autosave;
    el.lineNumbersToggle.checked = settings.lineNumbers;
    el.settingsDialog.showModal();
  }

  function saveSettingsFromDialog() {
    const oldAutoLinks = settings.autoLinks;
    settings = {
      ...settings,
      theme: el.themeSelect.value,
      wrap: el.wrapToggle.checked,
      spellcheck: el.spellcheckToggle.checked,
      autoLinks: el.autoLinksToggle.checked,
      autosave: el.autosaveToggle.checked,
      lineNumbers: el.lineNumbersToggle.checked,
      colorHistory: Array.isArray(settings.colorHistory) ? settings.colorHistory.slice(0, 10) : [],
      customDictionary: Array.isArray(settings.customDictionary) ? settings.customDictionary : []
    };

    saveSettings();
    applySettings();
    if (settings.autoLinks !== oldAutoLinks) {
      if (settings.autoLinks) linkifyEditorPreservingSelection(true);
      else unlinkAutoLinks(true);
    }
    el.settingsDialog.close();
    toast('Settings saved.');
  }

  let openDialogSelectionId = null;

  function filePathLabel(file) {
    const parts = [];
    let parentId = file?.parentId || null;
    let guard = 0;
    while (parentId && guard++ < 50) {
      const folder = files.find(item => item.id === parentId && item.type === 'folder');
      if (!folder) break;
      parts.unshift(folder.name);
      parentId = folder.parentId || null;
    }
    return parts.length ? parts.join(' / ') : 'Files';
  }

  function renderOpenFileDialog() {
    const query = el.openFileSearch.value.trim().toLowerCase();
    const candidates = files
      .filter(file => file.type !== 'folder')
      .filter(file => {
        if (!query) return true;
        const searchable = `${file.name} ${filePathLabel(file)}`.toLowerCase();
        return searchable.includes(query);
      })
      .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true,sensitivity:'base'}));

    if (openDialogSelectionId && !candidates.some(file => file.id === openDialogSelectionId)) {
      openDialogSelectionId = null;
    }
    el.openFileConfirmBtn.disabled = !openDialogSelectionId;
    el.openFileList.innerHTML = '';

    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'open-file-empty';
      empty.textContent = query ? 'No matching files.' : 'No saved files yet.';
      el.openFileList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const file of candidates) {
      const row = document.createElement('div');
      row.className = `open-file-row${file.id === openDialogSelectionId ? ' selected' : ''}`;
      row.dataset.id = file.id;
      row.setAttribute('role','option');
      row.setAttribute('aria-selected', file.id === openDialogSelectionId ? 'true' : 'false');
      row.tabIndex = 0;

      const name = document.createElement('div');
      name.className = 'open-name';
      const glyph=protectionGlyphForFile(file);
      name.textContent = `${glyph}${glyph ? ' ' : ''}${file.name}`;
      const badge=document.createElement('span');badge.className='doc-type-badge';badge.textContent=fileTypeBadgeLabel(file);name.appendChild(badge);
      const location = document.createElement('div');
      location.className = 'open-location';
      location.textContent = filePathLabel(file);
      row.append(name, location);

      const select = () => {
        openDialogSelectionId = file.id;
        renderOpenFileDialog();
        el.openFileList.querySelector(`[data-id="${CSS.escape(file.id)}"]`)?.focus();
      };
      row.addEventListener('click', select);
      row.addEventListener('dblclick', () => confirmOpenFileDialog(file.id));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); confirmOpenFileDialog(file.id); }
      });
      fragment.appendChild(row);
    }
    el.openFileList.appendChild(fragment);
  }

  function showOpenFileDialog() {
    openDialogSelectionId = null;
    el.openFileSearch.value = '';
    renderOpenFileDialog();
    el.openFileDialog.showModal();
    setTimeout(() => el.openFileSearch.focus(), 0);
  }

  function confirmOpenFileDialog(fileId = openDialogSelectionId) {
    if (!fileId) return;
    el.openFileDialog.close();
    openDialogSelectionId = null;
    openFile(fileId);
  }

  function showNewDocumentDialog() {
    el.newDocumentDialog.showModal();
  }

  function createNewDocument(docType = 'rich') {
    el.newDocumentDialog.close();
    const tab = newTab('', { name: uniqueUntitledName(), dirty:false, docType, markdownMode:docType==='markdown'?'edit':'edit' });
    tab.dirty = false;
    renderTabs();
    persistUnsavedDraftsSoon();
    status(`New ${docType === 'markdown' ? 'Markdown' : docType === 'plain' ? 'plain text' : 'rich text'} document.`);
  }

  function newDocument() {
    showNewDocumentDialog();
  }

  function applyZoom(){
    const z=Math.max(50,Math.min(200,Number(settings.zoom)||100));
    settings.zoom=z;
    el.editor.style.zoom=`${z}%`;
    el.zoomLabel.textContent=`${z}%`;
    updateLineNumbers();
    scheduleRulerBuild();
    if(splitState.enabled) void renderSplitSnapshot(otherSplitSide());
  }
  function changeZoom(delta){ settings.zoom=Math.max(50,Math.min(200,(Number(settings.zoom)||100)+delta)); saveSettings(); applyZoom(); }
