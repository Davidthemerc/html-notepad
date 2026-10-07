  // ===========================================================================
  // TABS & SESSION STATE
  // ===========================================================================


  function splitPaneTabId(side) {
    return side === 'right' ? splitState.rightTabId : splitState.leftTabId;
  }

  function setSplitPaneTabId(side, tabId) {
    if (side === 'right') splitState.rightTabId = tabId || null;
    else splitState.leftTabId = tabId || null;
  }

  function otherSplitSide(side = splitState.activeSide) {
    return side === 'right' ? 'left' : 'right';
  }

  function splitPaneElements(side) {
    return side === 'right'
      ? { pane:el.rightPane, header:el.rightPaneHeader, name:el.rightPaneName, mount:el.rightPaneMount, snapshot:el.rightPaneSnapshot, content:el.rightSnapshotContent }
      : { pane:el.leftPane, header:el.leftPaneHeader, name:el.leftPaneName, mount:el.leftPaneMount, snapshot:el.leftPaneSnapshot, content:el.leftSnapshotContent };
  }

  function splitTabSide(tabId) {
    if (!splitState.enabled) return '';
    if (splitState.leftTabId === tabId) return 'left';
    if (splitState.rightTabId === tabId) return 'right';
    return '';
  }

  function reconcileSplitState() {
    if (!splitState.enabled) return;

    const valid = new Set(tabs.map(tab => tab.tabId));
    if (!valid.has(splitState.leftTabId)) splitState.leftTabId = null;
    if (!valid.has(splitState.rightTabId)) splitState.rightTabId = null;

    if (splitState.leftTabId && splitState.leftTabId === splitState.rightTabId) {
      if (splitState.activeSide === 'right') splitState.leftTabId = null;
      else splitState.rightTabId = null;
    }

    if (activeTabId === splitState.leftTabId && splitState.leftTabId) {
      splitState.activeSide = 'left';
      return;
    }
    if (activeTabId === splitState.rightTabId && splitState.rightTabId) {
      splitState.activeSide = 'right';
      return;
    }

    const activePaneId = splitPaneTabId(splitState.activeSide);
    if (activePaneId && valid.has(activePaneId)) {
      activeTabId = activePaneId;
      return;
    }

    const otherSide = otherSplitSide(splitState.activeSide);
    const otherPaneId = splitPaneTabId(otherSide);
    if (otherPaneId && valid.has(otherPaneId)) {
      splitState.activeSide = otherSide;
      activeTabId = otherPaneId;
      return;
    }

    // An empty Split View is valid. Open tabs that are not assigned to a pane
    // stay unassigned until the user drags/opens one into Left or Right View.
    activeTabId = null;
  }

  async function renderSplitSnapshot(side) {
    const parts = splitPaneElements(side);
    if (!splitState.enabled) {
      parts.snapshot.hidden = true;
      return;
    }

    const tab = tabs.find(item => item.tabId === splitPaneTabId(side));
    if (side === splitState.activeSide && tab) {
      parts.snapshot.hidden = true;
      return;
    }
    if (!tab) {
      parts.content.className = 'split-snapshot-content source';
      parts.content.textContent = 'Drag an open tab here.';
      parts.snapshot.hidden = false;
      return;
    }

    parts.content.removeAttribute('style');
    parts.content.style.zoom = `${Math.max(50, Math.min(200, Number(settings.zoom) || 100))}%`;

    if (isMarkdownTab(tab) && tab.markdownMode === 'preview') {
      parts.content.className = 'split-snapshot-content markdown-preview';
      parts.content.innerHTML = renderMarkdown(tab.content || '');
    } else if (isSourceTab(tab)) {
      parts.content.className = 'split-snapshot-content source';
      parts.content.textContent = tab.content || '';
    } else {
      parts.content.className = 'split-snapshot-content rich';
      parts.content.innerHTML = tab.content || '';
      const layout = tab.layout || {left:0,first:0,right:0,tabs:[48]};
      parts.content.style.paddingLeft = `calc(var(--editor-padding) + ${Math.max(0, layout.left || 0)}px)`;
      parts.content.style.paddingRight = `calc(var(--editor-padding) + ${Math.max(0, layout.right || 0)}px)`;
      parts.content.style.textIndent = `${layout.first || 0}px`;
      await hydrateAssetImages(parts.content, tab);
    }

    parts.snapshot.hidden = false;
    requestAnimationFrame(() => {
      if (!parts.snapshot.hidden) parts.snapshot.scrollTop = Number(tab.scrollTop) || 0;
    });
  }

  function updateSplitUi() {
    reconcileSplitState();

    const enabled = !!splitState.enabled;
    const ratio = Math.max(20, Math.min(80, Number(splitState.ratio) || 50));
    splitState.ratio = ratio;
    el.splitWorkspace.style.setProperty('--split-left', `${ratio}fr`);
    el.splitWorkspace.style.setProperty('--split-right', `${100 - ratio}fr`);
    el.splitWorkspace.classList.toggle('split-enabled', enabled);

    el.rightPane.hidden = !enabled;
    el.splitDivider.hidden = !enabled;
    el.leftPaneHeader.hidden = !enabled;
    el.splitViewBtn.classList.toggle('active', enabled);
    el.splitViewBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    el.splitViewBtn.textContent = enabled ? 'Single View' : 'Split View';
    el.splitViewBtn.title = enabled ? 'Return to one document view' : 'Show two documents side by side';

    if (!enabled) {
      el.editorShell.hidden = false;
      el.leftPane.classList.add('active');
      el.rightPane.classList.remove('active');
      el.leftPaneSnapshot.hidden = true;
      el.rightPaneSnapshot.hidden = true;
      if (el.editorShell.parentElement !== el.leftPaneMount) el.leftPaneMount.appendChild(el.editorShell);
      return;
    }

    const activeSide = splitState.activeSide === 'right' ? 'right' : 'left';
    const activeParts = splitPaneElements(activeSide);
    const inactiveSide = otherSplitSide(activeSide);
    const inactiveParts = splitPaneElements(inactiveSide);

    el.leftPane.classList.toggle('active', activeSide === 'left');
    el.rightPane.classList.toggle('active', activeSide === 'right');

    const leftTab = tabs.find(tab => tab.tabId === splitState.leftTabId);
    const rightTab = tabs.find(tab => tab.tabId === splitState.rightTabId);
    el.leftPane.classList.toggle('empty', !leftTab);
    el.rightPane.classList.toggle('empty', !rightTab);
    el.leftPaneName.textContent = leftTab ? `${leftTab.dirty ? '● ' : ''}${leftTab.protected ? '🔓 ' : ''}${leftTab.name} · ${documentTypeLabel(leftTab.docType || 'rich')}` : 'Drop a tab here';
    el.rightPaneName.textContent = rightTab ? `${rightTab.dirty ? '● ' : ''}${rightTab.protected ? '🔓 ' : ''}${rightTab.name} · ${documentTypeLabel(rightTab.docType || 'rich')}` : 'Drop a tab here';

    const activeTab = tabs.find(tab => tab.tabId === splitPaneTabId(activeSide));
    if (activeTab) {
      el.editorShell.hidden = false;
      if (el.editorShell.parentElement !== activeParts.mount) activeParts.mount.appendChild(el.editorShell);
      activeParts.snapshot.hidden = true;
      void renderSplitSnapshot(inactiveSide);
    } else {
      // Both panes may intentionally be empty. Clear document-mode UI state as
      // well as hiding the live editor; otherwise controls can retain stale
      // Markdown/Plain/Rich state from the document that was just closed.
      syncDocumentSurface(null);
      clearSpellHighlights();
      el.editorShell.hidden = true;
      void renderSplitSnapshot('left');
      void renderSplitSnapshot('right');
      el.wordCount.textContent = '0 words';
      el.charCount.textContent = '0 chars';
      el.cursorPosition.textContent = 'Ln —, Col —';
    }
  }

  function focusActiveDocumentSurface() {
    const tab = currentTab();
    if (!tab) return;
    setTimeout(() => {
      if (isSourceTab(tab)) {
        if (isMarkdownTab(tab) && tab.markdownMode === 'preview') {
          splitPaneElements(splitState.enabled ? splitState.activeSide : 'left').pane.focus?.({preventScroll:true});
        } else {
          el.markdownSource.focus({preventScroll:true});
        }
      } else {
        el.editor.focus({preventScroll:true});
      }
    }, 0);
  }

  function enableSplitView() {
    if (splitState.enabled) return;
    if (window.matchMedia?.('(max-width: 900px)').matches) {
      toast('Split View is available on wider desktop windows.');
      return;
    }

    captureEditorIntoActive();
    const currentId = tabs.some(tab => tab.tabId === activeTabId) ? activeTabId : null;

    splitState.enabled = true;
    splitState.activeSide = 'left';
    splitState.leftTabId = currentId;
    splitState.rightTabId = null;
    splitState.ratio = 50;
    activeTabId = currentId;
    updateSplitUi();
    renderTabs();
    persistSessionSoon();
    status(currentId ? 'Split View on. Drag an open tab to the right side.' : 'Split View on.');
    focusActiveDocumentSurface();
  }

  function disableSplitView({silent=false} = {}) {
    if (!splitState.enabled) return;
    captureEditorIntoActive();

    let singleId = activeTabId;
    if (!singleId || !tabs.some(tab => tab.tabId === singleId)) {
      singleId = splitPaneTabId(splitState.activeSide) ||
        splitPaneTabId(otherSplitSide(splitState.activeSide)) ||
        tabs[0]?.tabId ||
        null;
    }

    splitState.enabled = false;
    splitState.activeSide = 'left';
    splitState.leftTabId = singleId;
    splitState.rightTabId = null;
    activeTabId = singleId;

    if (!singleId && !tabs.length) {
      const tab = {
        tabId: uid(), fileId: null, name: uniqueUntitledName(), content: '',
        dirty: false, isNew: true, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), parentId: null,
        layout: {left:0,first:0,right:0,tabs:[48]}, scrollTop:0,
        selection:null, docType:'rich', markdownMode:'edit'
      };
      tabs.push(tab);
      activeTabId = tab.tabId;
      splitState.leftTabId = tab.tabId;
    }

    updateSplitUi();
    renderTabs();
    if (currentTab()) restoreTabView(currentTab());
    persistUnsavedDraftsSoon();
    persistSessionSoon();
    if (!silent) status('Single document view.');
    focusActiveDocumentSurface();
  }

  function toggleSplitView() {
    if (splitState.enabled) disableSplitView();
    else enableSplitView();
  }

  function activateSplitSide(side) {
    if (!splitState.enabled || side === splitState.activeSide) return;
    const targetId = splitPaneTabId(side);
    if (!targetId || !tabs.some(tab => tab.tabId === targetId)) return;

    captureEditorIntoActive();
    // Pane assignments are authoritative. activeTabId can briefly be null after
    // close/delete/session reconciliation, so never write it back into a pane.
    splitState.activeSide = side;
    activeTabId = targetId;
    updateSplitUi();
    restoreTabView(currentTab());
    if (!el.findBar.hidden) refreshFindMatches();
    saveRecoverySnapshot();
    persistSessionSoon();
    focusActiveDocumentSurface();
  }

  async function closeSplitPaneDocument(side) {
    if (!splitState.enabled || (side !== 'left' && side !== 'right')) return;
    const tabId = splitPaneTabId(side);
    if (!tabId) return;
    await closeTab(tabId);
  }

  function assignTabToSplitSide(tabId, side) {
    if (!splitState.enabled || (side !== 'left' && side !== 'right')) return;
    const tab = tabs.find(item => item.tabId === tabId);
    if (!tab) return;

    captureEditorIntoActive();

    // A tab may occupy only one split pane. Dragging a visible tab across moves
    // that view; the pane it came from becomes empty.
    const sourceSide = splitTabSide(tabId);
    if (sourceSide && sourceSide !== side) setSplitPaneTabId(sourceSide, null);

    // The tab displaced from the target pane remains open and unassigned.
    setSplitPaneTabId(side, tabId);
    reconcileSplitState();
    splitState.activeSide = side;
    activeTabId = tabId;

    clearSplitTabDropUi();
    updateSplitUi();
    restoreTabView(tab);
    if (!el.findBar.hidden) refreshFindMatches();
    saveRecoverySnapshot();
    persistSessionSoon();
    status(`${tab.name} shown on the ${side} side.`);
    focusActiveDocumentSurface();
  }

  function handleSplitTabClick(tabId) {
    if (!splitState.enabled) {
      switchTab(tabId);
      return;
    }
    const side = splitTabSide(tabId);
    if (side) {
      activateSplitSide(side);
      return;
    }
    status('Drag this tab onto the left or right side to display it in Split View.');
  }

  function clearSplitTabDropUi() {
    el.leftPane.classList.remove('tab-drop-target');
    el.rightPane.classList.remove('tab-drop-target');
  }

  function handleSplitPaneDragOver(event) {
    if (!splitState.enabled) return;

    // Browsers may protect DataTransfer values until drop, so authorize by MIME
    // type during dragover. Saved Files rows use x-notepad-item; open tabs use
    // x-notepad-tab. Folders are deliberately not valid Split View documents.
    const types = Array.from(event.dataTransfer?.types || []);
    const draggingTab = types.includes('application/x-notepad-tab');
    const draggingFile = types.includes('application/x-notepad-item');
    if (!draggingTab && !draggingFile) return;

    if (draggingFile) {
      const sourceId = draggedFileId || event.dataTransfer?.getData('application/x-notepad-item');
      const source = files.find(file => file.id === sourceId);
      if (source?.type === 'folder') return;
    }

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = draggingFile ? 'copy' : 'move';
    clearSplitTabDropUi();
    event.currentTarget.classList.add('tab-drop-target');
  }

  function handleSplitPaneDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    event.currentTarget.classList.remove('tab-drop-target');
  }

  async function handleSplitPaneDrop(event) {
    if (!splitState.enabled) return;

    const side = event.currentTarget.dataset.side;
    const tabId = event.dataTransfer?.getData('application/x-notepad-tab');
    const fileId = event.dataTransfer?.getData('application/x-notepad-item') || draggedFileId;
    clearSplitTabDropUi();

    if (tabId && tabs.some(tab => tab.tabId === tabId)) {
      event.preventDefault();
      event.stopPropagation();
      assignTabToSplitSide(tabId, side);
      return;
    }

    const file = files.find(item => item.id === fileId);
    if (!file || file.type === 'folder') return;

    event.preventDefault();
    event.stopPropagation();
    // Dropping a saved file opens it in the requested pane. It does not move
    // the file in the virtual filesystem and does not close the displaced tab.
    try {
      await openFileInSplitSide(file.id, side);
    } finally {
      draggedFileId = null;
      latchedDropKey = null;
      document.body.classList.remove('files-dragging');
    }
  }

  function resetSplitDivider() {
    if (!splitState.enabled) return;
    splitState.ratio = 50;
    updateSplitUi();
    persistSessionSoon();
    status('Split View reset to 50/50.');
  }

  function beginSplitResize(event) {
    if (!splitState.enabled || event.button !== 0) return;
    splitDragPointerId = event.pointerId;
    el.splitDivider.classList.add('dragging');
    el.splitDivider.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function resizeSplitFromPointer(event) {
    if (splitDragPointerId === null || event.pointerId !== splitDragPointerId) return;
    const rect = el.splitWorkspace.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = ((event.clientX - rect.left) / rect.width) * 100;
    splitState.ratio = Math.max(20, Math.min(80, ratio));
    el.splitWorkspace.style.setProperty('--split-left', `${splitState.ratio}fr`);
    el.splitWorkspace.style.setProperty('--split-right', `${100 - splitState.ratio}fr`);
  }

  function endSplitResize(event) {
    if (splitDragPointerId === null) return;
    if (event && event.pointerId !== undefined && event.pointerId !== splitDragPointerId) return;
    try { el.splitDivider.releasePointerCapture?.(splitDragPointerId); } catch {}
    splitDragPointerId = null;
    el.splitDivider.classList.remove('dragging');
    persistSessionSoon();
  }

  function newTab(content = '', opts = {}) {
    const tab = {
      tabId: opts.tabId || uid(), fileId: opts.fileId || null, name: opts.name || 'Untitled', content,
      dirty: !!opts.dirty, isNew: !opts.fileId, createdAt: opts.createdAt || new Date().toISOString(),
      updatedAt: opts.updatedAt || new Date().toISOString(), parentId: opts.parentId || null,
      layout: opts.layout || {left:0,first:0,right:0,tabs:[48]}, scrollTop:Number(opts.scrollTop)||0,
      selection: opts.selection || null,
      docType: opts.docType || 'rich', markdownMode: opts.markdownMode || 'edit',
      protected: !!opts.protected
    };
    tabs.push(tab); switchTab(tab.tabId); persistUnsavedDraftsSoon(); persistSessionSoon(); return tab;
  }

  function currentTab() { return tabs.find(t => t.tabId === activeTabId) || null; }

  function requireActiveDocument() {
    if (currentTab()) return true;
    toast('No document is open in this view.');
    return false;
  }

  function applyDocumentLayout(){
    const tab=currentTab(); const l=tab?.layout||{left:0,first:0,right:0,tabs:[48]};
    el.editor.style.paddingLeft=`calc(var(--editor-padding) + ${Math.max(0,l.left||0)}px)`;
    el.editor.style.paddingRight=`calc(var(--editor-padding) + ${Math.max(0,l.right||0)}px)`;
    el.editor.style.textIndent=`${l.first||0}px`;
  }

  // Saved document HTML stores image asset IDs, not duplicate base64 payloads. The live editor
  // receives src data URLs only while rendering, keeping document records much smaller.
  function serializedEditorHtml(){
    const clone=el.editor.cloneNode(true);
    clone.querySelectorAll('img[data-asset-id]').forEach(img=>{img.removeAttribute('src');img.classList.remove('image-selected');});
    return clone.innerHTML;
  }
  // Resolve stored image IDs into data URLs whenever document HTML enters the live editor.
  async function hydrateAssetImages(root=el.editor, tab=currentTab()){
    const imgs=[...root.querySelectorAll('img[data-asset-id]')];
    const protectedCache = tab?.protected ? protectedAssetCaches.get(tab.fileId) : null;
    await Promise.all(imgs.map(async img=>{
      if(img.getAttribute('src'))return;
      const id=img.dataset.assetId;
      const a=protectedCache?.get(id) || await storeGet(ASSET_STORE,id);
      if(a?.dataUrl)img.src=a.dataUrl;
    }));
  }
  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}

  async function optimizeImageFile(file) {
    const twoMegabytes = 2 * 1024 * 1024;
    if (file.size <= twoMegabytes) {
      return { dataUrl: await fileToDataUrl(file), mime: file.type, size: file.size, name: file.name };
    }

    const optimize = await appConfirm(
      `This image is ${(file.size / 1048576).toFixed(1)} MB.\n\nOptimize it to reduce Notepad storage use?`,
      { title: 'Large Image', confirmText: 'Optimize', cancelText: 'Keep Original' }
    );
    if (!optimize) {
      return { dataUrl: await fileToDataUrl(file), mime: file.type, size: file.size, name: file.name };
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = reject;
        element.src = objectUrl;
      });

      const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.86 : undefined);
      return {
        dataUrl,
        mime,
        // Base64 length is approximate; exact byte count is not required for UI statistics.
        size: Math.round((dataUrl.length * 3) / 4),
        name: file.name
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  async function importImageFile(file,{replace=null}={}){
    if(!requireActiveDocument())return;
    if(!file?.type?.startsWith('image/'))return toast('Choose an image file.');
    const data=await optimizeImageFile(file),id=replace?.dataset.assetId||uid(),asset={id,...data,createdAt:new Date().toISOString()};
    const tab=currentTab();

    if(tab?.protected && tab.fileId){
      let cache=protectedAssetCaches.get(tab.fileId);
      if(!cache){cache=new Map();protectedAssetCaches.set(tab.fileId,cache);}
      cache.set(id,asset);
    }else{
      await storePut(ASSET_STORE,asset);
    }

    if(replace){replace.src=asset.dataUrl;replace.alt=file.name||'Image';markDirtyFromEditor();return;}
    restoreEditorSelection();el.editor.focus();const img=document.createElement('img');img.dataset.assetId=id;img.src=asset.dataUrl;img.alt=file.name||'Image';img.dataset.align='left';img.style.width='50%';img.style.height='auto';
    const sel=getSelection();if(sel?.rangeCount&&selectionInsideEditor()){const r=sel.getRangeAt(0);r.deleteContents();r.insertNode(img);r.setStartAfter(img);r.collapse(true);sel.removeAllRanges();sel.addRange(r);}else el.editor.appendChild(img);
    markDirtyFromEditor();toast('Image inserted.');
  }
  let selectedImage=null;

  function selectImage(image) {
    el.editor.querySelectorAll('img.image-selected')
      .forEach(item => item.classList.remove('image-selected'));
    selectedImage = image || null;
    if (selectedImage) selectedImage.classList.add('image-selected');
  }
  function closeImageMenu(){document.getElementById('imageContextMenu').hidden=true;}

  function openImageMenu(image, x, y) {
    selectImage(image);
    const menu = $('imageContextMenu');
    menu.hidden = false;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(6, Math.min(x, innerWidth - rect.width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, innerHeight - rect.height - 6))}px`;
    });
  }

  function setImageWidth(value) {
    if (!selectedImage) return;
    selectedImage.style.width = value;
    selectedImage.style.height = 'auto';
    markDirtyFromEditor();
    closeImageMenu();
  }

  function setImageAlign(value) {
    if (!selectedImage) return;
    selectedImage.dataset.align = value;
    markDirtyFromEditor();
    closeImageMenu();
  }

  async function deleteSelectedImage() {
    if (!selectedImage) return;
    selectedImage.remove();
    selectedImage = null;
    markDirtyFromEditor();
    closeImageMenu();
    await cleanupOrphanAssets();
  }

  async function cleanupOrphanAssets() {
    const assets = await storeGetAll(ASSET_STORE);
    if (!assets.length) return;

    // An asset may be referenced by more than a currently open document. Include all
    // recoverable states before deleting anything so Undo/Reopen/Recovery cannot lose images.
    const drafts = readJsonStorage(LS_DRAFTS, []);
    const recovery = readJsonStorage(LS_RECOVERY, []);
    const safetySnapshot = (await storeGet(SAFETY_STORE, 'preRestore'))?.payload;
    const safetyFiles = safetySnapshot?.files || [];
    const safetyDrafts = safetySnapshot?.localStorage?.unsavedDrafts || [];
    const safetyClosedTabs = safetySnapshot?.localStorage?.closedTabs || [];
    const safetyRecovery = safetySnapshot?.localStorage?.recovery || [];
    const trashRecords = await storeGetAll(TRASH_STORE);
    const trashContents = trashRecords.flatMap(record => record.items || []).filter(item => item.type !== 'folder').map(item => item.content || '');

    const contents = [
      ...files.filter(file => file.type !== 'folder').map(file => file.content || ''),
      ...tabs.map(tab => tab.content || ''),
      serializedEditorHtml(),
      ...drafts.map(draft => draft.content || ''),
      ...closedTabs.map(tab => tab.content || ''),
      ...recovery.map(item => item.content || ''),
      ...safetyFiles.map(file => file.content || ''),
      ...safetyDrafts.map(draft => draft.content || ''),
      ...safetyClosedTabs.map(tab => tab.content || ''),
      ...safetyRecovery.map(item => item.content || ''),
      ...trashContents
    ].join('\n');

    for (const asset of assets) {
      const doubleQuoted = `data-asset-id="${asset.id}"`;
      const singleQuoted = `data-asset-id='${asset.id}'`;
      if (!contents.includes(doubleQuoted) && !contents.includes(singleQuoted)) {
        await storeDelete(ASSET_STORE, asset.id);
      }
    }
  }
