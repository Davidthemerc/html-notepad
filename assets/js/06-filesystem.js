  // ===========================================================================
  // VIRTUAL FILESYSTEM
  // ===========================================================================

  async function refreshFiles() {
    files = (await idbGetAll()).map(f => ({type:'file', parentId:null, ...f})).sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return ao - bo || b.updatedAt.localeCompare(a.updatedAt);
    });
    const existingIds = new Set(files.map(file => file.id));
    selectedFileIds = new Set([...selectedFileIds].filter(id => existingIds.has(id)));
    if (selectedFileId && !existingIds.has(selectedFileId)) selectedFileId = null;
    if (fileSelectionAnchorId && !existingIds.has(fileSelectionAnchorId)) fileSelectionAnchorId = null;
    if (!selectedFileIds.size && selectedFileId) selectedFileIds.add(selectedFileId);
    expandedFolders=new Set([...expandedFolders].filter(id=>files.some(f=>f.id===id&&f.type==='folder'))); persistExpandedFolders();
    renderFiles();
  }

  function persistExpandedFolders() {
    writeJsonStorage(LS_EXPANDED_FOLDERS, [...expandedFolders]);
  }

  function directChildCount(folderId) {
    return files.filter(file => file.parentId === folderId).length;
  }

  function folderDepth(folder) {
    let depth = 0;
    let parentId = folder?.parentId;
    let guard = 0;

    // The guard protects the UI if imported/corrupt data accidentally forms a parent cycle.
    while (parentId && guard++ < 50) {
      const parent = files.find(file => file.id === parentId && file.type === 'folder');
      if (!parent) break;
      depth += 1;
      parentId = parent.parentId;
    }
    return depth;
  }

  function folderLabel(folder) {
    const depth = folderDepth(folder);
    return `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${folder.name}`;
  }
  let filesSortMode=localStorage.getItem(LS_FILE_SORT) || 'custom';

  function sortFileItems(items) {
    const result = [...items];
    if (filesSortMode === 'custom') return result;

    // Keep folders grouped before documents for every automatic sort mode.
    const folderFirst = (a, b) =>
      (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1);

    if (filesSortMode === 'name-asc') {
      return result.sort((a, b) =>
        folderFirst(a, b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
    }
    if (filesSortMode === 'name-desc') {
      return result.sort((a, b) =>
        folderFirst(a, b) || b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' })
      );
    }
    if (filesSortMode === 'newest') {
      return result.sort((a, b) =>
        folderFirst(a, b) || (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      );
    }
    if (filesSortMode === 'oldest') {
      return result.sort((a, b) =>
        folderFirst(a, b) || (new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
      );
    }
    return result;
  }

  function selectedFilesystemItems() {
    return files.filter(file => selectedFileIds.has(file.id));
  }

  function setSingleFileSelection(id) {
    selectedFileIds = id ? new Set([id]) : new Set();
    selectedFileId = id || null;
    fileSelectionAnchorId = id || null;
  }

  function visibleFileRowIds() {
    return [...el.fileList.querySelectorAll('.file-row[data-id]')].map(row => row.dataset.id);
  }

  function selectFileRow(itemId, event) {
    const shift = !!event.shiftKey;
    const additive = !!(event.ctrlKey || event.metaKey);

    if (shift && fileSelectionAnchorId) {
      const order = visibleFileRowIds();
      const anchorIndex = order.indexOf(fileSelectionAnchorId);
      const itemIndex = order.indexOf(itemId);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const [start, end] = anchorIndex <= itemIndex
          ? [anchorIndex, itemIndex]
          : [itemIndex, anchorIndex];
        const range = order.slice(start, end + 1);
        selectedFileIds = additive
          ? new Set([...selectedFileIds, ...range])
          : new Set(range);
        selectedFileId = itemId;
        return;
      }
    }

    if (additive) {
      if (selectedFileIds.has(itemId)) selectedFileIds.delete(itemId);
      else selectedFileIds.add(itemId);
      selectedFileId = selectedFileIds.has(itemId)
        ? itemId
        : ([...selectedFileIds].at(-1) || null);
      fileSelectionAnchorId = itemId;
      return;
    }

    setSingleFileSelection(itemId);
  }

  function requireSingleFilesystemSelection(actionLabel = 'use this command') {
    const selected = selectedFilesystemItems();
    if (selected.length === 1) return selected[0];
    if (!selected.length) toast('Select a file or folder first.');
    else toast(`Select one item to ${actionLabel}.`);
    return null;
  }

  function renderFiles() {
    const query = el.fileSearch.value.trim().toLowerCase();
    const visibleItems = files.filter(file => {
      if (!query) return true;
      if (file.name.toLowerCase().includes(query)) return true;
      if (file.type === 'folder') return false;
      const effective = effectiveFileDocument(file);
      if (isProtectedRecord(file) && !unlockedProtectedTab(file.id)) return false;
      return (effective.docType==='plain'||effective.docType==='markdown'?effective.content||'':htmlToPlainText(effective.content||'')).toLowerCase().includes(query);
    });

    const savedFileCount = files.filter(file => file.type !== 'folder').length;
    el.fileCount.textContent = selectedFileIds.size > 1
      ? `${selectedFileIds.size} selected · ${savedFileCount} files`
      : String(savedFileCount);
    el.fileList.innerHTML = '';

    // This temporary target appears only while dragging a nested item. It is created on
    // each render because the file tree itself is rebuilt from the IndexedDB-backed model.
    const rootDropZone = document.createElement('div');
    rootDropZone.id = 'rootDropZone';
    rootDropZone.className = 'root-drop-zone';
    rootDropZone.hidden = true;
    rootDropZone.textContent = '↰ Move to Files root';
    el.fileList.appendChild(rootDropZone);

    if (!visibleItems.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = query ? 'No matching files or folders.' : 'No saved files yet.';
      el.fileList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    const renderRow = (item, depth = 0) => {
      const row = document.createElement('div');
      row.className =
        'file-row' +
        (item.type === 'folder' ? ' folder' : '') +
        (depth ? ' file-child' : '') +
        (selectedFileIds.has(item.id) ? ' selected' : '') +
        (item.id === fileSelectionAnchorId ? ' selection-anchor' : '');
      row.dataset.id = item.id;
      row.tabIndex = -1;
      row.draggable = !query;
      row.style.paddingLeft = `${10 + depth * 18}px`;

      const name = document.createElement('div');
      name.className = 'name';
      if (item.type === 'folder') {
        name.textContent = `${expandedFolders.has(item.id) ? '▾ ' : '▸ '}${item.name}`;
        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = `(${directChildCount(item.id)})`;
        name.appendChild(count);
      } else {
        const glyph=protectionGlyphForFile(item);
        name.textContent = `${glyph}${glyph ? ' ' : ''}${item.name}`;
        if(glyph) name.title = glyph === '🔓' ? 'Password protected — unlocked until closed' : 'Password protected — locked';
        const badge=document.createElement('span');badge.className='doc-type-badge';badge.textContent=fileTypeBadgeLabel(item);name.appendChild(badge);
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = item.type === 'folder' ? 'Folder' : `Modified ${formatDate(item.updatedAt)}`;
      row.append(name, meta);

      if (query && item.type !== 'folder' && !item.name.toLowerCase().includes(query)) {
        const effective = effectiveFileDocument(item);
        const plainText = isProtectedRecord(item) && !unlockedProtectedTab(item.id)
          ? ''
          : ((effective.docType==='plain'||effective.docType==='markdown') ? (effective.content||'') : htmlToPlainText(effective.content||''));
        const matchAt = plainText.toLowerCase().indexOf(query);
        if (matchAt >= 0) {
          const snippet = document.createElement('div');
          snippet.className = 'snippet';
          snippet.textContent =
            '…' +
            plainText
              .slice(Math.max(0, matchAt - 28), matchAt + query.length + 48)
              .replace(/\s+/g, ' ') +
            '…';
          row.appendChild(snippet);
        }
      }

      row.addEventListener('click', event => {
        const modifiedSelection = event.shiftKey || event.ctrlKey || event.metaKey;
        selectFileRow(item.id, event);

        // Preserve the familiar folder click-to-expand behavior only for an ordinary
        // single click. Modified clicks are selection gestures and must not move rows.
        if (item.type === 'folder' && !modifiedSelection) {
          if (expandedFolders.has(item.id)) expandedFolders.delete(item.id);
          else expandedFolders.add(item.id);
          persistExpandedFolders();
        }
        renderFiles();
        el.fileList.focus({preventScroll:true});
      });

      row.addEventListener('dblclick', event => {
        // A double-click is an explicit open/expand action and collapses any range selection.
        setSingleFileSelection(item.id);
        if (item.type === 'folder') {
          expandedFolders.add(item.id);
          persistExpandedFolders();
          renderFiles();
        } else {
          openFileFromFilesDoubleClick(item.id);
        }
      });

      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        // Right-clicking inside an existing multi-selection keeps the selection intact so
        // Delete can operate on the group. Right-clicking elsewhere selects only that item.
        if (!selectedFileIds.has(item.id)) setSingleFileSelection(item.id);
        else selectedFileId = item.id;
        renderFiles();
        openFileContextMenu(event.clientX, event.clientY);
      });

      fragment.appendChild(row);

      if (item.type === 'folder' && (expandedFolders.has(item.id) || query)) {
        sortFileItems(files.filter(file => file.parentId === item.id))
          .forEach(child => renderRow(child, depth + 1));
      }
    };

    const roots = query ? visibleItems : files.filter(file => !file.parentId);
    sortFileItems(roots).forEach(item => renderRow(item));
    el.fileList.appendChild(fragment);
  }

  let draggedFileId = null;
  let latchedDropKey = null;

  function openFileContextMenu(x, y) {
    const menu = document.getElementById('fileContextMenu');
    const item=files.find(f=>f.id===selectedFileId), isFolder=item?.type==='folder';
    const multi = selectedFileIds.size > 1;
    const protectedFile = isProtectedRecord(item);
    const unlocked = protectedFile && isProtectedFileUnlocked(item.id);
    const effective = effectiveFileDocument(item);
    const effectiveType = protectedFile && !unlocked ? 'protected' : (effective?.docType || 'rich');

    document.getElementById('contextOpenBtn').hidden=multi || isFolder;
    const splitOpenHidden = multi || isFolder || window.innerWidth <= 900;
    document.getElementById('contextOpenLeftBtn').hidden = splitOpenHidden;
    document.getElementById('contextOpenRightBtn').hidden = splitOpenHidden;
    document.getElementById('contextSplitOpenSep').hidden = splitOpenHidden;
    document.getElementById('contextNewFolderInsideBtn').hidden=multi || !isFolder;
    document.getElementById('contextRenameBtn').hidden=multi;
    document.getElementById('contextDuplicateBtn').hidden=multi || isFolder || protectedFile;
    document.getElementById('contextMoveBtn').hidden=multi;

    document.getElementById('contextProtectionSep').hidden = multi || isFolder;
    document.getElementById('contextProtectBtn').hidden = multi || isFolder || protectedFile;
    document.getElementById('contextUnlockBtn').hidden = multi || isFolder || !protectedFile || unlocked;
    document.getElementById('contextLockCloseBtn').hidden = multi || isFolder || !unlocked;
    document.getElementById('contextChangePasswordBtn').hidden = multi || isFolder || !unlocked;
    document.getElementById('contextRecoveryKeyBtn').hidden = multi || isFolder || !unlocked;
    document.getElementById('contextRegenerateRecoveryBtn').hidden = multi || isFolder || !unlocked;
    document.getElementById('contextRemoveProtectionBtn').hidden = multi || isFolder || !unlocked;

    const locked = protectedFile && !unlocked;
    document.getElementById('contextProtectionExportSep').hidden = multi || isFolder || locked;
    document.getElementById('contextExportRtfBtn').hidden=multi || isFolder || locked || effectiveType!=='rich';
    document.getElementById('contextExportTxtBtn').hidden=multi || isFolder || locked;
    document.getElementById('contextExportHtmlBtn').hidden=multi || isFolder || locked || effectiveType==='plain';
    document.getElementById('contextExportMdBtn').hidden=multi || isFolder || locked || effectiveType!=='markdown';

    menu.hidden = false;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
    });
  }

  function positionFilesDrawerPopupAbove(menu, button) {
    const buttonRect = button.getBoundingClientRect();
    menu.hidden = false;
    const menuRect = menu.getBoundingClientRect();
    const gap = 4;
    const left = Math.max(6, Math.min(buttonRect.left, innerWidth - menuRect.width - 6));
    const preferredTop = buttonRect.top - menuRect.height - gap;
    const top = Math.max(6, Math.min(preferredTop, innerHeight - menuRect.height - 6));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openFilesTreeMenu() {
    positionFilesDrawerPopupAbove($('filesTreeMenu'), el.filesTreeMenuBtn);
  }

  function closeFilesTreeMenu() {
    $('filesTreeMenu').hidden = true;
  }

  function renderFilesSortMenu() {
    const menu = $('filesSortMenu');
    menu.querySelectorAll('[data-sort]').forEach(button => {
      const label = button.textContent.replace(/^✓\s*/, '');
      button.textContent = (button.dataset.sort === filesSortMode ? '✓ ' : '') + label;
    });
  }

  function openFilesSortMenu() {
    const menu = $('filesSortMenu');
    renderFilesSortMenu();
    positionFilesDrawerPopupAbove(menu, el.filesSortMenuBtn);
  }

  function closeFilesSortMenu() {
    $('filesSortMenu').hidden = true;
  }

  function setFilesSortMode(mode) {
    filesSortMode = mode;
    localStorage.setItem(LS_FILE_SORT, mode);
    renderFiles();
    closeFilesSortMenu();
    status(mode === 'custom' ? 'Files use custom drag order.' : 'Files sorted for display.');
  }

  function expandAllFolders() {
    files.filter(file => file.type === 'folder').forEach(folder => expandedFolders.add(folder.id));
    persistExpandedFolders();
    renderFiles();
    closeFilesTreeMenu();
  }

  function collapseAllFolders() {
    expandedFolders.clear();
    persistExpandedFolders();
    renderFiles();
    closeFilesTreeMenu();
  }

  function closeFileContextMenu() {
    document.getElementById('fileContextMenu').hidden = true;
  }

  async function reorderFiles(sourceId, targetId, placeAfter) {
    const source = files.find(file => file.id === sourceId);
    const target = files.find(file => file.id === targetId);
    if (!source || !target) return;

    source.parentId = target.parentId || null;
    const siblings = files.filter(file =>
      (file.parentId || null) === (source.parentId || null) && file.id !== source.id
    );
    const targetIndex = siblings.findIndex(file => file.id === target.id);
    siblings.splice(Math.max(0, targetIndex + (placeAfter ? 1 : 0)), 0, source);

    // Re-number siblings in one batch. The caller refreshes the tree once after the drop.
    await Promise.all(siblings.map((file, index) => idbPut({ ...file, order: index })));
    status('File order updated.');
  }

  function getDraggedFileId(event) {
    return draggedFileId ||
      event.dataTransfer?.getData('application/x-notepad-item') ||
      event.dataTransfer?.getData('text/plain') ||
      null;
  }

  function clearFileDragUi() {
    document.querySelectorAll('.file-row').forEach(row => {
      row.classList.remove('dragging', 'drag-over-before', 'drag-over-after', 'drag-folder-target');
    });
    const rootDropZone = document.getElementById('rootDropZone');
    if (rootDropZone) {
      rootDropZone.hidden = true;
      rootDropZone.classList.remove('root-drop-active');
    }
    el.fileList.classList.remove('root-drop-active');
  }

  function isDescendantFolder(sourceId, targetId) {
    let parentId = targetId;
    let guard = 0;
    while (parentId && guard++ < 100) {
      if (parentId === sourceId) return true;
      parentId = files.find(file => file.id === parentId)?.parentId || null;
    }
    return false;
  }

  async function moveItemIntoFolder(source, targetFolder) {
    if (!source || !targetFolder || targetFolder.type !== 'folder' || source.id === targetFolder.id) {
      return false;
    }
    if (source.type === 'folder' && isDescendantFolder(source.id, targetFolder.id)) {
      toast('A folder cannot be moved inside itself or one of its subfolders.');
      return false;
    }

    source.parentId = targetFolder.id;
    const siblingOrders = files
      .filter(file => file.parentId === targetFolder.id && file.id !== source.id)
      .map(file => Number(file.order) || 0);
    source.order = (siblingOrders.length ? Math.max(...siblingOrders) : 0) + 1;
    await idbPut(source);

    expandedFolders.add(targetFolder.id);
    persistExpandedFolders();
    return true;
  }

  async function moveItemToRoot(source) {
    if (!source || !source.parentId) return false;
    source.parentId = null;
    const rootOrders = files
      .filter(file => !file.parentId && file.id !== source.id)
      .map(file => Number(file.order) || 0);
    source.order = (rootOrders.length ? Math.max(...rootOrders) : 0) + 1;
    await idbPut(source);
    return true;
  }

  function paintFileDropTarget(key, row = null, kind = null) {
    if (latchedDropKey === key) return;
    latchedDropKey = key;

    document.querySelectorAll('.file-row').forEach(item => {
      item.classList.remove('drag-over-before', 'drag-over-after', 'drag-folder-target');
    });
    document.getElementById('rootDropZone')?.classList.remove('root-drop-active');
    el.fileList.classList.remove('root-drop-active');

    if (kind === 'folder' && row) row.classList.add('drag-folder-target');
    else if (kind === 'before' && row) row.classList.add('drag-over-before');
    else if (kind === 'after' && row) row.classList.add('drag-over-after');
    else if (kind === 'root') {
      document.getElementById('rootDropZone')?.classList.add('root-drop-active');
      el.fileList.classList.add('root-drop-active');
    }
  }

  function endFileDrag() {
    latchedDropKey = null;
    draggedFileId = null;
    document.body.classList.remove('files-dragging');
    clearFileDragUi();
  }

  function handleFileDragStart(event) {
    const row = event.target.closest?.('.file-row');
    if (!row || el.fileSearch.value.trim()) {
      event.preventDefault();
      return;
    }

    draggedFileId = row.dataset.id;
    if (selectedFileIds.size > 1) {
      setSingleFileSelection(draggedFileId);
      renderFiles();
    }
    latchedDropKey = null;
    row.classList.add('dragging');
    document.body.classList.add('files-dragging');
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-notepad-item', draggedFileId);
    event.dataTransfer.setData('text/plain', draggedFileId);

    // Reveal the root target on the next frame. Doing this during dragstart can move the
    // source row before Chromium captures its drag image, which may cancel the drag.
    const source = files.find(file => file.id === draggedFileId);
    requestAnimationFrame(() => {
      const rootDropZone = document.getElementById('rootDropZone');
      if (rootDropZone && draggedFileId) rootDropZone.hidden = !source?.parentId;
    });
  }

  function handleFileDragEnter(event) {
    if (draggedFileId) event.preventDefault();
  }

  function handleFileDragOver(event) {
    const sourceId = getDraggedFileId(event);
    const source = files.find(file => file.id === sourceId);
    if (!source) return;

    const row = event.target.closest?.('.file-row');
    const target = row ? files.find(file => file.id === row.dataset.id) : null;

    if (target && target.id !== source.id) {
      if (target.type === 'folder') {
        if (source.type === 'folder' && isDescendantFolder(source.id, target.id)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        paintFileDropTarget(`folder:${target.id}`, row, 'folder');
        return;
      }

      if (filesSortMode === 'custom') {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const placeAfter = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        paintFileDropTarget(`${placeAfter ? 'after' : 'before'}:${target.id}`, row, placeAfter ? 'after' : 'before');
        return;
      }
    }

    const overRootTarget = event.target.closest?.('#rootDropZone') || (!row && el.fileList.contains(event.target));
    if (overRootTarget && source.parentId) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      paintFileDropTarget('root', null, 'root');
    }
    // Do not clear the indicator for transient child-element dragover events. Browser drag
    // events can bounce between descendants for a frame even when the pointer did not leave.
  }

  async function handleFileDrop(event) {
    const sourceId = getDraggedFileId(event);
    const source = files.find(file => file.id === sourceId);
    if (!source) return;

    const row = event.target.closest?.('.file-row');
    const target = row ? files.find(file => file.id === row.dataset.id) : null;
    event.preventDefault();
    event.stopPropagation();

    try {
      if (target && target.id !== source.id) {
        if (target.type === 'folder') {
          if (await moveItemIntoFolder(source, target)) status(`Moved into ${target.name}.`);
        } else if (filesSortMode === 'custom') {
          const placeAfter = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
          await reorderFiles(source.id, target.id, placeAfter);
        }
      } else if (source.parentId) {
        if (await moveItemToRoot(source)) status('Moved to Files root.');
      }

      // One refresh after persistence is enough; row listeners are delegated from fileList.
      await refreshFiles();
    } finally {
      endFileDrag();
    }
  }

  function handleFileDragEnd() {
    requestAnimationFrame(endFileDrag);
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
