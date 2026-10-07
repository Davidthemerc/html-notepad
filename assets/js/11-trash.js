  // ===========================================================================
  // TRASH
  // ===========================================================================

  const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  async function purgeExpiredTrash() {
    const now = Date.now();
    const items = await storeGetAll(TRASH_STORE);
    const expired = items.filter(item => now - new Date(item.deletedAt || 0).getTime() >= TRASH_RETENTION_MS);
    for (const item of expired) await storeDelete(TRASH_STORE, item.id);
    if (expired.length) await cleanupOrphanAssets();
    return expired.length;
  }

  function trashTreeIds(rootId) {
    const ids = [rootId];
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of files) {
        if (item.parentId && ids.includes(item.parentId) && !ids.includes(item.id)) {
          ids.push(item.id); changed = true;
        }
      }
    }
    return ids;
  }

  async function closeTabsForDeletedFiles(fileIds) {
    const idSet = new Set(fileIds);
    const doomed = tabs.filter(tab => tab.fileId && idSet.has(tab.fileId));
    if (!doomed.length) return;

    captureEditorIntoActive();
    const doomedTabIds = new Set(doomed.map(tab => tab.tabId));
    const activeWasDeleted = doomedTabIds.has(activeTabId);
    doomed.filter(tab=>tab.protected&&tab.fileId).forEach(tab=>clearProtectedSession(tab.fileId));
    tabs = tabs.filter(tab => !doomedTabIds.has(tab.tabId));

    if (splitState.enabled) {
      if (doomedTabIds.has(splitState.leftTabId)) splitState.leftTabId = null;
      if (doomedTabIds.has(splitState.rightTabId)) splitState.rightTabId = null;
      if (activeWasDeleted) activeTabId = null;
      reconcileSplitState();
      updateSplitUi();
      if (currentTab()) restoreTabView(currentTab());
      else renderTabs();
    } else if (!tabs.length) {
      activeTabId = null;
      newTab('', { name: uniqueUntitledName(), dirty:false });
    } else if (activeWasDeleted) {
      activeTabId = tabs[0].tabId;
      restoreTabView(tabs[0]);
    } else {
      renderTabs();
    }
    persistUnsavedDrafts();
    persistSessionSoon();
    saveRecoverySnapshot();
  }

  function hasSelectedAncestor(item, selectedIds) {
    let parentId = item?.parentId || null;
    let guard = 0;
    while (parentId && guard++ < 50) {
      if (selectedIds.has(parentId)) return true;
      const parent = files.find(file => file.id === parentId);
      if (!parent) break;
      parentId = parent.parentId || null;
    }
    return false;
  }

  async function moveSelectionToTrash() {
    const selected = selectedFilesystemItems();
    if (!selected.length) { toast('Select a file or folder first.'); return; }

    // If a folder and one of its descendants are both selected, the folder already owns
    // that descendant for Trash/restore purposes. Keep only independent selection roots.
    const selectedIds = new Set(selected.map(item => item.id));
    const roots = selected.filter(item => !hasSelectedAncestor(item, selectedIds));

    const deleteIds = new Set();
    for (const root of roots) {
      const ids = root.type === 'folder' ? trashTreeIds(root.id) : [root.id];
      ids.forEach(id => deleteIds.add(id));
    }

    const selectedFiles = selected.filter(item => item.type !== 'folder').length;
    const selectedFolders = selected.filter(item => item.type === 'folder').length;
    const additionalContents = Math.max(0, deleteIds.size - selected.length);
    const totalFiles = [...deleteIds].filter(id => files.find(item => item.id === id)?.type !== 'folder').length;
    const totalFolders = deleteIds.size - totalFiles;

    const selectedSummary = `${selected.length} selected item${selected.length === 1 ? '' : 's'} — ` +
      `${selectedFiles} file${selectedFiles === 1 ? '' : 's'}, ${selectedFolders} folder${selectedFolders === 1 ? '' : 's'}`;
    const containedSummary = additionalContents
      ? `\nSelected folders contain ${additionalContents} additional item${additionalContents === 1 ? '' : 's'}.`
      : '';
    const totalSummary = `\nTotal moving to Trash: ${deleteIds.size} item${deleteIds.size === 1 ? '' : 's'} — ` +
      `${totalFiles} file${totalFiles === 1 ? '' : 's'}, ${totalFolders} folder${totalFolders === 1 ? '' : 's'}.`;
    const tabCount = tabs.filter(tab => tab.fileId && deleteIds.has(tab.fileId)).length;
    const tabSummary = tabCount
      ? `\n${tabCount} open tab${tabCount === 1 ? '' : 's'} for these files will close automatically.`
      : '';

    if (!(await appConfirm(
      `${selectedSummary}${containedSummary}${totalSummary}${tabSummary}\n\nItems remain in Trash for 7 days.`,
      { title:selected.length === 1 ? 'Move to Trash?' : 'Move Selected Items to Trash?', confirmText:'Move to Trash', danger:true }
    ))) return;

    // Capture live editor state. Protected documents are persisted to their encrypted
    // records before the Trash snapshot so decrypted working content never enters Trash.
    captureEditorIntoActive();
    for (const tab of tabs.filter(tab => tab.fileId && deleteIds.has(tab.fileId) && tab.protected && tab.dirty)) {
      if (!(await persistProtectedTab(tab))) return;
    }
    await refreshFiles();
    const openByFile = new Map(tabs.filter(tab => tab.fileId).map(tab => [tab.fileId, tab]));
    const deletedAt = new Date().toISOString();

    for (const root of roots) {
      const ids = root.type === 'folder' ? trashTreeIds(root.id) : [root.id];
      const snapshot = ids.map(id => {
        const stored = files.find(file => file.id === id);
        const open = openByFile.get(id);
        if (isProtectedRecord(stored)) return { ...stored };
        return open
          ? { ...stored, content:open.content, updatedAt:open.updatedAt || stored.updatedAt, docType:open.docType || stored.docType }
          : { ...stored };
      }).filter(Boolean);

      await storePut(TRASH_STORE, {
        id:uid(),
        rootId:root.id,
        rootName:root.name,
        rootType:root.type,
        originalParentId:root.parentId || null,
        deletedAt,
        items:snapshot
      });
    }

    for (const id of deleteIds) await idbDelete(id);
    await closeTabsForDeletedFiles([...deleteIds]);

    selectedFileIds.clear();
    selectedFileId = null;
    fileSelectionAnchorId = null;
    await refreshFiles();

    const rootCount = roots.length;
    status(`Moved ${deleteIds.size} item${deleteIds.size === 1 ? '' : 's'} to Trash.`);
    toast(`${rootCount} Trash entr${rootCount === 1 ? 'y' : 'ies'} created. Kept for 7 days.`);
  }

  function trashRemainingText(deletedAt) {
    const expires = new Date(deletedAt).getTime() + TRASH_RETENTION_MS;
    const ms = Math.max(0, expires - Date.now());
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return `${days} day${days === 1 ? '' : 's'} remaining`;
  }

  async function renderTrash() {
    await purgeExpiredTrash();
    const items = (await storeGetAll(TRASH_STORE)).sort((a,b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    el.trashList.innerHTML = '';
    el.trashSummary.textContent = items.length
      ? `${items.length} item${items.length === 1 ? '' : 's'} · automatically deleted after 7 days`
      : 'Items are permanently deleted after 7 days.';
    el.emptyTrashBtn.disabled = !items.length;

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'trash-empty';
      empty.textContent = 'Trash is empty.';
      el.trashList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'trash-row';
      const info = document.createElement('div');
      const name = document.createElement('div'); name.className='trash-name';
      const containsProtected=(item.items||[]).some(entry=>isProtectedRecord(entry));
      name.textContent=`${containsProtected ? '🔒 ' : ''}${item.rootName}`;
      const meta = document.createElement('div'); meta.className='trash-meta';
      const count = item.items?.length || 1;
      meta.textContent = `${item.rootType === 'folder' ? `Folder · ${Math.max(0,count-1)} contained item${count-1===1?'':'s'} · ` : ''}Deleted ${formatDate(item.deletedAt)} · ${trashRemainingText(item.deletedAt)}`;
      info.append(name,meta);

      const actions=document.createElement('div');actions.className='trash-actions';
      const restore=document.createElement('button');restore.type='button';restore.textContent='Restore';
      restore.addEventListener('click',()=>restoreTrashItem(item.id));
      const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Delete Permanently';
      remove.addEventListener('click',()=>permanentlyDeleteTrashItem(item.id));
      actions.append(restore,remove);row.append(info,actions);fragment.appendChild(row);
    }
    el.trashList.appendChild(fragment);
  }

  async function openTrash() {
    await renderTrash();
    el.trashDialog.showModal();
  }

  async function restoreTrashItem(trashId) {
    const record = await storeGet(TRASH_STORE, trashId);
    if (!record) return;
    const existingIds = new Set(files.map(file => file.id));
    const incomingIds = new Set((record.items || []).map(item => item.id));
    const idMap = new Map();
    for (const item of record.items || []) idMap.set(item.id, existingIds.has(item.id) ? uid() : item.id);

    for (const item of record.items || []) {
      const copy = { ...item, id:idMap.get(item.id) };
      if (incomingIds.has(item.parentId)) copy.parentId = idMap.get(item.parentId);
      else copy.parentId = files.some(file => file.id === item.parentId && file.type === 'folder') ? item.parentId : null;
      copy.updatedAt = new Date().toISOString();
      await idbPut(copy);
    }
    await storeDelete(TRASH_STORE, trashId);
    await refreshFiles();
    await renderTrash();
    status(`Restored ${record.rootName}.`);
    toast('Restored from Trash.');
  }

  async function permanentlyDeleteTrashItem(trashId) {
    const record = await storeGet(TRASH_STORE, trashId);
    if (!record) return;
    if (!(await appConfirm(`Permanently delete “${record.rootName}”? This cannot be undone.`, {
      title:'Delete Permanently?', confirmText:'Delete Permanently', danger:true
    }))) return;
    await storeDelete(TRASH_STORE, trashId);
    await cleanupOrphanAssets();
    await renderTrash();
    status(`Permanently deleted ${record.rootName}.`);
  }

  async function emptyTrash() {
    const items = await storeGetAll(TRASH_STORE);
    if (!items.length) return;
    if (!(await appConfirm(`Permanently delete all ${items.length} item${items.length===1?'':'s'} in Trash? This cannot be undone.`, {
      title:'Clear Trash?', confirmText:'Clear Trash', danger:true
    }))) return;
    await storeClear(TRASH_STORE);
    await cleanupOrphanAssets();
    await renderTrash();
    status('Trash cleared.');
  }

  async function restoreSession(){
    let session;try{session=JSON.parse(localStorage.getItem(LS_SESSION)||'null');}catch{return false;}
    if(!session||!Array.isArray(session.tabs))return false;
    let drafts=[];try{drafts=JSON.parse(localStorage.getItem(LS_DRAFTS)||'[]');}catch{}
    const draftMap=new Map((Array.isArray(drafts)?drafts:[]).map(d=>[d.draftId,d]));
    let protectedSkipped=0;

    for(const st of session.tabs){
      if(st.fileId){
        const f=await idbGet(st.fileId);if(!f)continue;
        if(isProtectedRecord(f)){protectedSkipped++;continue;}
        tabs.push({tabId:st.tabId||uid(),fileId:f.id,name:f.name,content:f.content||'',dirty:false,isNew:false,createdAt:f.createdAt,updatedAt:f.updatedAt,parentId:f.parentId||null,layout:f.layout||{left:0,first:0,right:0,tabs:[48]},scrollTop:st.scrollTop||0,selection:st.selection||null,docType:f.docType||st.docType||'rich',markdownMode:(f.docType||st.docType)==='markdown'?'preview':'edit',protected:false});
      } else {
        const d=draftMap.get(st.tabId);if(!d)continue;
        tabs.push({tabId:st.tabId||uid(),fileId:null,name:d.name||st.name||'Untitled',content:d.content||'',dirty:true,isNew:true,createdAt:d.createdAt||new Date().toISOString(),updatedAt:d.updatedAt||new Date().toISOString(),parentId:null,layout:d.layout||{left:0,first:0,right:0,tabs:[48]},scrollTop:st.scrollTop||0,selection:st.selection||null,docType:d.docType||st.docType||'rich',markdownMode:d.markdownMode||st.markdownMode||'edit',protected:false});
      }
    }

    const restoredSplit=session.split;
    const splitRequested=!!restoredSplit?.enabled;
    if(!tabs.length && !splitRequested) return false;

    activeTabId=tabs.some(t=>t.tabId===session.activeTabId)?session.activeTabId:(tabs[0]?.tabId||null);

    if(splitRequested){
      splitState.enabled=true;
      splitState.leftTabId=tabs.some(t=>t.tabId===restoredSplit?.leftTabId)?restoredSplit.leftTabId:null;
      splitState.rightTabId=tabs.some(t=>t.tabId===restoredSplit?.rightTabId)?restoredSplit.rightTabId:null;
      splitState.ratio=Math.max(20,Math.min(80,Number(restoredSplit?.ratio)||50));
      splitState.activeSide=restoredSplit?.activeSide==='right'?'right':'left';
      reconcileSplitState();
    }else{
      splitState.enabled=false;
      splitState.activeSide='left';
      splitState.leftTabId=activeTabId;
      splitState.rightTabId=null;
    }

    updateSplitUi();
    if(currentTab()) restoreTabView(currentTab());
    else renderTabs();
    status(`Restored ${tabs.length} tab${tabs.length===1?'':'s'} from your last session.${protectedSkipped ? ` ${protectedSkipped} protected document${protectedSkipped===1?' remains':'s remain'} locked.` : ''}`);
    return true;
  }

 function persistUnsavedDraftsSoon() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(persistUnsavedDrafts, 250);
  }

  function persistUnsavedDrafts() {
    captureEditorIntoActive();
    const drafts = tabs
      .filter(t => !t.fileId)
      .map(t => ({
        draftId: t.tabId,
        name: t.name,
        content: t.content,
        createdAt: t.createdAt,
        updatedAt: new Date().toISOString(),
        layout:t.layout,
        docType:t.docType||'rich',
        markdownMode:t.markdownMode||'edit'
      }));
    if (drafts.length) localStorage.setItem(LS_DRAFTS, JSON.stringify(drafts));
    else localStorage.removeItem(LS_DRAFTS);
  }

  function restoreDrafts() {
    try {
      const drafts = JSON.parse(localStorage.getItem(LS_DRAFTS) || '[]');
      if (!Array.isArray(drafts) || !drafts.length) return false;
      for (const d of drafts) {
        tabs.push({
          tabId: d.draftId || uid(),
          fileId: null,
          name: d.name || 'Untitled',
          content: d.content || '',
          dirty: true,
          isNew: true,
          createdAt: d.createdAt || new Date().toISOString(),
          updatedAt: d.updatedAt || new Date().toISOString(),
          layout:d.layout||{left:0,first:0,right:0,tabs:[48]},
          docType:d.docType||'rich',
          markdownMode:d.markdownMode||'edit'
        });
      }
      activeTabId = tabs[0].tabId;
      restoreTabView(tabs[0]);
      status(`Recovered ${tabs.length} unsaved draft${tabs.length === 1 ? '' : 's'} from localStorage.`);
      return true;
    } catch {
      return false;
    }
  }

  function escapeHtml(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML;}
