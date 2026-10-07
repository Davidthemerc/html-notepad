  // ===========================================================================
  // EVENT BINDING
  // ===========================================================================

  function bindEvents() {
    // ---- Native app dialogs -------------------------------------------------
    $('appConfirmCancelBtn').addEventListener('click', () => finishAppConfirm(false));
    $('appConfirmOkBtn').addEventListener('click', () => finishAppConfirm(true));
    $('appConfirmDialog').addEventListener('cancel', event => {
      event.preventDefault();
      finishAppConfirm(false);
    });
    $('appConfirmDialog').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        finishAppConfirm(true);
      }
    });

    $('protectionPasswordCancelBtn').addEventListener('click', () => finishProtectionPasswordDialog(null));
    $('protectionPasswordConfirmBtn').addEventListener('click', submitProtectionPasswordDialog);
    $('protectionPasswordDialog').addEventListener('cancel', event => {
      event.preventDefault();
      finishProtectionPasswordDialog(null);
    });
    $('protectionPasswordDialog').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        submitProtectionPasswordDialog();
      }
    });

    $('protectionUnlockCancelBtn').addEventListener('click', () => finishProtectionUnlockDialog(null));
    $('protectionUnlockModeBtn').addEventListener('click', toggleProtectionUnlockMode);
    $('protectionUnlockConfirmBtn').addEventListener('click', submitProtectionUnlockDialog);
    $('protectionUnlockDialog').addEventListener('cancel', event => {
      event.preventDefault();
      finishProtectionUnlockDialog(null);
    });
    $('protectionUnlockDialog').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        submitProtectionUnlockDialog();
      }
    });

    $('recoveryKeyCopyBtn').addEventListener('click', copyRecoveryKeyToClipboard);
    $('recoveryKeySaveBtn').addEventListener('click', saveRecoveryKeyToDisk);
    $('recoveryKeyDoneBtn').addEventListener('click', finishRecoveryKeyDialog);
    $('recoveryKeyDialog').addEventListener('cancel', event => {
      if (recoveryKeyMustAcknowledge) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      finishRecoveryKeyDialog();
    });

    $('splitOverrideCancelBtn').addEventListener('click', () => finishSplitOverride(null));
    $('splitOverrideLeftChoice').addEventListener('click', () => finishSplitOverride('left'));
    $('splitOverrideRightChoice').addEventListener('click', () => finishSplitOverride('right'));
    $('splitOverrideDialog').addEventListener('cancel', event => {
      event.preventDefault();
      finishSplitOverride(null);
    });

    // ---- Top bar and file drawer -------------------------------------------
    el.filesToggleBtn.addEventListener('click', toggleFilesDrawer);
    el.topbarExpandBtn.addEventListener('click', () =>
      toggleMobileBar(el.topbarExpandBtn.parentElement, el.topbarExpandBtn));
    el.toolbarExpandBtn.addEventListener('click', () =>
      toggleMobileBar(el.formatToolbar, el.toolbarExpandBtn));
    el.drawerCloseBtn.addEventListener('click', () => setFilesDrawer(false));
    el.drawerBackdrop.addEventListener('click', () => setFilesDrawer(false));
    el.splitViewBtn.addEventListener('click', toggleSplitView);
    el.leftPaneHeader.addEventListener('click', () => activateSplitSide('left'));
    el.rightPaneHeader.addEventListener('click', () => activateSplitSide('right'));
    el.leftPaneCloseBtn.addEventListener('click', event => {
      event.stopPropagation();
      closeSplitPaneDocument('left');
    });
    el.rightPaneCloseBtn.addEventListener('click', event => {
      event.stopPropagation();
      closeSplitPaneDocument('right');
    });
    [el.leftPane, el.rightPane].forEach(pane => {
      pane.addEventListener('dragover', handleSplitPaneDragOver);
      pane.addEventListener('dragleave', handleSplitPaneDragLeave);
      pane.addEventListener('drop', handleSplitPaneDrop);
    });
    el.leftPaneSnapshot.addEventListener('click', event => {
      event.preventDefault();
      activateSplitSide('left');
    });
    el.rightPaneSnapshot.addEventListener('click', event => {
      event.preventDefault();
      activateSplitSide('right');
    });
    el.leftPaneSnapshot.addEventListener('scroll', () => {
      if (!splitState.enabled || splitState.activeSide === 'left') return;
      const tab=tabs.find(t=>t.tabId===splitState.leftTabId);
      if(tab) tab.scrollTop=el.leftPaneSnapshot.scrollTop;
    });
    el.rightPaneSnapshot.addEventListener('scroll', () => {
      if (!splitState.enabled || splitState.activeSide === 'right') return;
      const tab=tabs.find(t=>t.tabId===splitState.rightTabId);
      if(tab) tab.scrollTop=el.rightPaneSnapshot.scrollTop;
    });
    el.splitDivider.addEventListener('pointerdown', beginSplitResize);
    el.splitDivider.addEventListener('pointermove', resizeSplitFromPointer);
    el.splitDivider.addEventListener('pointerup', endSplitResize);
    el.splitDivider.addEventListener('pointercancel', endSplitResize);
    el.splitDivider.addEventListener('dblclick', event => {
      event.preventDefault();
      resetSplitDivider();
    });
    el.splitDivider.addEventListener('keydown', event => {
      if (!splitState.enabled || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      splitState.ratio=Math.max(20,Math.min(80,splitState.ratio+(event.key==='ArrowRight'?2:-2)));
      updateSplitUi();
      persistSessionSoon();
    });
    el.newBtn.addEventListener('click', newDocument);
    el.newDocumentCancelBtn.addEventListener('click', () => el.newDocumentDialog.close());
    el.newDocumentDialog.querySelectorAll('[data-doc-type]').forEach(button => {
      button.addEventListener('click', () => createNewDocument(button.dataset.docType));
    });
    el.openBtn.addEventListener('click', showOpenFileDialog);
    el.topImportBtn.addEventListener('click', () => el.importDocInput.click());
    el.openFileSearch.addEventListener('input', renderOpenFileDialog);
    el.openFileCancelBtn.addEventListener('click', () => el.openFileDialog.close());
    el.openFileConfirmBtn.addEventListener('click', () => confirmOpenFileDialog());
    el.openFileDialog.addEventListener('cancel', () => { openDialogSelectionId = null; });
    el.openBtn.addEventListener('contextmenu', event => {
      event.preventDefault();
      showRecentMenu();
    });
    el.saveBtn.addEventListener('click', () => saveCurrent(false));
    el.saveAsBtn.addEventListener('click', () => saveCurrent(true));
    el.printBtn.addEventListener('click', printDocument);
    el.trashBtn.addEventListener('click', openTrash);
    el.helpBtn.addEventListener('click', showHelpMenu);
    el.helpMenu.querySelectorAll('[data-help-section]').forEach(button => {
      button.addEventListener('click', () => openManual(button.dataset.helpSection));
    });
    el.manualCloseBtn.addEventListener('click', closeManual);
    el.manualCloseTopBtn.addEventListener('click', closeManual);
    el.manualSearch.addEventListener('input', filterManualSections);
    el.manualSearch.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const first = el.manualNav.querySelector('[data-manual-target]:not([hidden])');
        if (first) { event.preventDefault(); showManualSection(first.dataset.manualTarget, {focusContent:true}); }
      }
    });
    el.manualSectionSelect.addEventListener('change', () => showManualSection(el.manualSectionSelect.value, {focusContent:true}));
    el.manualDialog.addEventListener('close', () => {
      el.manualSearch.value = '';
      el.manualSearchStatus.textContent = '';
    });
    el.trashCloseBtn.addEventListener('click', () => el.trashDialog.close());
    el.emptyTrashBtn.addEventListener('click', emptyTrash);

    // File drag/drop is delegated from the stable list container. Individual rows are
    // rebuilt frequently, so row-level drag listeners would be easy to invalidate.
    el.fileList.addEventListener('dragstart', handleFileDragStart);
    el.fileList.addEventListener('dragenter', handleFileDragEnter);
    el.fileList.addEventListener('dragover', handleFileDragOver);
    el.fileList.addEventListener('drop', handleFileDrop);
    el.fileList.addEventListener('dragend', handleFileDragEnd);

    el.newFolderBtn.addEventListener('click', newFolder);
    el.filesTreeMenuBtn.addEventListener('click', event => {
      event.stopPropagation();
      closeFilesSortMenu();
      const menu = $('filesTreeMenu');
      menu.hidden ? openFilesTreeMenu() : closeFilesTreeMenu();
    });
    el.filesSortMenuBtn.addEventListener('click', event => {
      event.stopPropagation();
      closeFilesTreeMenu();
      const menu = $('filesSortMenu');
      menu.hidden ? openFilesSortMenu() : closeFilesSortMenu();
    });
    $('filesSortMenu').addEventListener('click', event => {
      const button = event.target.closest('[data-sort]');
      if (button) setFilesSortMode(button.dataset.sort);
    });
    $('expandAllFoldersBtn').addEventListener('click', expandAllFolders);
    $('collapseAllFoldersBtn').addEventListener('click', collapseAllFolders);
    el.fileSearch.addEventListener('input', renderFiles);
    el.fileList.addEventListener('keydown', event => {
      if (event.key === 'Delete' && selectedFileIds.size) {
        event.preventDefault();
        deleteSelected();
      }
    });
    el.fileList.addEventListener('click', event => {
      if (event.target === el.fileList) {
        setSingleFileSelection(null);
        renderFiles();
      }
    });
    el.importDocBtn.addEventListener('click', () => el.importDocInput.click());
    el.importDocInput.addEventListener('change', async () => {
      const selectedFiles = el.importDocInput.files;
      if (selectedFiles?.length) await importDocuments(selectedFiles);
      el.importDocInput.value = '';
    });
    el.renameBtn.addEventListener('click', renameSelected);
    el.deleteBtn.addEventListener('click', deleteSelected);

    // ---- File/editor/tab context menus -------------------------------------
    $('contextOpenBtn').addEventListener('click', () => {
      const id = selectedFileId;
      closeFileContextMenu();
      if (id) openFile(id);
    });
    $('contextOpenLeftBtn').addEventListener('click', () => {
      const id = selectedFileId;
      closeFileContextMenu();
      if (id) openFileInSplitSide(id, 'left');
    });
    $('contextOpenRightBtn').addEventListener('click', () => {
      const id = selectedFileId;
      closeFileContextMenu();
      if (id) openFileInSplitSide(id, 'right');
    });
    $('contextNewFolderInsideBtn').addEventListener('click', () => {
      const id = selectedFileId;
      closeFileContextMenu();
      if (id) newFolderInside(id);
    });
    $('contextRenameBtn').addEventListener('click', () => { closeFileContextMenu(); renameSelected(); });
    $('contextDuplicateBtn').addEventListener('click', () => { closeFileContextMenu(); duplicateSelected(); });
    $('contextMoveBtn').addEventListener('click', () => { closeFileContextMenu(); openMoveDialog(); });
    $('contextProtectBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) protectFileById(id);
    });
    $('contextUnlockBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) openFile(id);
    });
    $('contextLockCloseBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) lockAndCloseProtectedFile(id);
    });
    $('contextChangePasswordBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) changeProtectedPassword(id);
    });
    $('contextRecoveryKeyBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) showProtectedRecoveryKey(id);
    });
    $('contextRegenerateRecoveryBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) regenerateProtectedRecoveryKey(id);
    });
    $('contextRemoveProtectionBtn').addEventListener('click', () => {
      const id=selectedFileId; closeFileContextMenu(); if(id) removeProtectedFileProtection(id);
    });
    $('contextExportRtfBtn').addEventListener('click', () => { closeFileContextMenu(); exportSelectedRtf(); });
    $('contextExportTxtBtn').addEventListener('click', () => { closeFileContextMenu(); exportSelectedTxt(); });
    $('contextExportHtmlBtn').addEventListener('click', () => { closeFileContextMenu(); exportSelectedHtml(); });
    $('contextExportMdBtn').addEventListener('click', () => { closeFileContextMenu(); exportSelectedMarkdown(); });
    $('contextDeleteBtn').addEventListener('click', () => { closeFileContextMenu(); deleteSelected(); });

    $('editorUndoCtx').addEventListener('click', () => { restoreEditorSelection(); exec('undo', true); closeEditorContextMenu(); });
    $('editorRedoCtx').addEventListener('click', () => { restoreEditorSelection(); exec('redo', true); closeEditorContextMenu(); });
    $('editorCutCtx').addEventListener('click', editorCut);
    $('editorCopyCtx').addEventListener('click', editorCopy);
    $('editorPasteCtx').addEventListener('click', () => editorPaste(false));
    $('editorPastePlainCtx').addEventListener('click', () => editorPaste(true));
    $('editorSelectAllCtx').addEventListener('click', editorSelectAll);
    $('editorClearFormatCtx').addEventListener('click', () => { restoreEditorSelection(); clearFormatting(); closeEditorContextMenu(); });
    $('editorPrintCtx').addEventListener('click', () => { closeEditorContextMenu(); printDocument(); });
    el.spellIgnoreBtn.addEventListener('click', ignoreSpellTarget);
    el.spellAddDictionaryBtn.addEventListener('click', addSpellTargetToDictionary);

    el.allTabsBtn.addEventListener('click', event => {
      event.stopPropagation();
      toggleAllTabsMenu();
    });
    $('tabCloseCtx').addEventListener('click', () => {
      const id = tabContextId; closeTabContextMenu(); if (id) closeTab(id);
    });
    $('tabCloseOthersCtx').addEventListener('click', () => {
      const id = tabContextId; closeTabContextMenu(); if (id) closeOtherTabs(id);
    });
    $('tabCloseRightCtx').addEventListener('click', () => {
      const id = tabContextId; closeTabContextMenu(); if (id) closeTabsToRight(id);
    });
    $('tabDuplicateCtx').addEventListener('click', () => {
      const id = tabContextId; closeTabContextMenu(); if (id) duplicateTabAsDraft(id);
    });
    $('tabProtectCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) protectFileById(tab.fileId);
    });
    $('tabLockCloseCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) lockAndCloseProtectedFile(tab.fileId);
    });
    $('tabChangePasswordCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) changeProtectedPassword(tab.fileId);
    });
    $('tabRecoveryKeyCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) showProtectedRecoveryKey(tab.fileId);
    });
    $('tabRegenerateRecoveryCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) regenerateProtectedRecoveryKey(tab.fileId);
    });
    $('tabRemoveProtectionCtx').addEventListener('click', () => {
      const tab=tabs.find(item=>item.tabId===tabContextId); closeTabContextMenu();
      if(tab?.fileId) removeProtectedFileProtection(tab.fileId);
    });
    $('tabReopenCtx').addEventListener('click', () => {
      closeTabContextMenu();
      reopenClosedTab();
    });

    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#fileContextMenu')) closeFileContextMenu();
      if (!event.target.closest('#editorContextMenu')) closeEditorContextMenu();
      if (!event.target.closest('#tabContextMenu')) closeTabContextMenu();
      if (!event.target.closest('#allTabsMenu') && event.target !== el.allTabsBtn) $('allTabsMenu').hidden = true;
      if (!event.target.closest('#filesTreeMenu') && event.target !== el.filesTreeMenuBtn) closeFilesTreeMenu();
      if (!event.target.closest('#filesSortMenu') && event.target !== el.filesSortMenuBtn) closeFilesSortMenu();
      if (!event.target.closest('#recentMenu') && event.target !== el.openBtn) $('recentMenu').hidden = true;
      if (!event.target.closest('#helpMenu') && event.target !== el.helpBtn) {
        el.helpMenu.hidden = true;
        el.helpBtn.setAttribute('aria-expanded','false');
      }
    });
    window.addEventListener('blur', () => {
      closeFileContextMenu(); closeEditorContextMenu(); closeFilesTreeMenu(); closeFilesSortMenu(); el.helpMenu.hidden = true; el.helpBtn.setAttribute('aria-expanded','false');
    });
    window.addEventListener('resize', () => {
      closeFileContextMenu(); closeEditorContextMenu(); closeFilesTreeMenu(); closeFilesSortMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeFileContextMenu(); closeEditorContextMenu(); closeFilesTreeMenu(); closeFilesSortMenu();
      }
    });

    // ---- Backup, restore, settings -----------------------------------------
    el.backupRestoreBtn.addEventListener('click', openBackupRestore);
    el.backupRestoreCloseBtn.addEventListener('click', () => el.backupRestoreDialog.close());
    el.createBackupBtn.addEventListener('click', async () => {
      el.backupRestoreDialog.close();
      await exportBackup();
    });
    el.chooseRestoreBtn.addEventListener('click', () => {
      el.backupRestoreDialog.close();
      el.restoreInput.click();
    });
    el.restoreInput.addEventListener('change', async () => {
      const file = el.restoreInput.files?.[0];
      el.restoreInput.value = '';
      if (file) await openRestoreInspector(file);
    });
    el.restoreInspectorCancelBtn.addEventListener('click', () => {
      pendingRestorePayload = null;
      el.restoreInspectorDialog.close();
    });
    el.restoreInspectorConfirmBtn.addEventListener('click', applyRestore);
    el.undoRestoreBtn.addEventListener('click', undoLastRestore);
    el.settingsBtn.addEventListener('click', openSettings);

    // ---- Markdown source / preview -----------------------------------------
    el.markdownEditBtn.addEventListener('click', () => setMarkdownMode('edit'));
    el.markdownPreviewBtn.addEventListener('click', () => {
      captureEditorIntoActive();
      setMarkdownMode('preview');
      updateCounts();
    });
    el.markdownSource.addEventListener('input', () => {
      markDirtyFromEditor();
      updateLineNumbers();
      if (currentTab()?.markdownMode === 'preview') {
        el.markdownPreview.innerHTML = renderMarkdown(el.markdownSource.value);
      }
    });
    el.markdownSource.addEventListener('keyup', updateCounts);
    el.markdownSource.addEventListener('click', updateCounts);
    el.markdownSource.addEventListener('scroll', () => {
      const tab = currentTab();
      if (tab) { tab.scrollTop = el.markdownSource.scrollTop; persistSessionSoon(); }
      if (!el.lineNumberGutter.hidden) el.lineNumberGutter.scrollTop = el.markdownSource.scrollTop;
    });
    el.markdownPreview.addEventListener('scroll', () => {
      const tab = currentTab();
      if (tab && isMarkdownTab(tab) && tab.markdownMode === 'preview') {
        tab.scrollTop = el.markdownPreview.scrollTop;
        persistSessionSoon();
      }
    });
    el.markdownSource.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const start=el.markdownSource.selectionStart,end=el.markdownSource.selectionEnd;
      el.markdownSource.setRangeText('\t',start,end,'end');
      markDirtyFromEditor();
    });

    // ---- Formatting toolbar ------------------------------------------------
    el.fontFamilySelect.addEventListener('pointerdown', rememberEditorSelection);
    el.fontFamilySelect.addEventListener('change', () => applyFontFamily(el.fontFamilySelect.value));
    el.fontSizeSelect.addEventListener('pointerdown', rememberEditorSelection);
    el.fontSizeSelect.addEventListener('change', () => applyFontSizePx(el.fontSizeSelect.value));
    el.undoBtn.addEventListener('click', () => {
      if (isSourceTab()) { el.markdownSource.focus(); document.execCommand('undo'); markDirtyFromEditor(); updateLineNumbers(); }
      else exec('undo', true);
    });
    el.redoBtn.addEventListener('click', () => {
      if (isSourceTab()) { el.markdownSource.focus(); document.execCommand('redo'); markDirtyFromEditor(); updateLineNumbers(); }
      else exec('redo', true);
    });
    el.boldBtn.addEventListener('click', runBold);
    el.italicBtn.addEventListener('click', runItalic);
    el.underlineBtn.addEventListener('click', () => exec('underline', true));
    el.clearFormattingBtn.addEventListener('click', clearFormatting);
    el.justifyLeftBtn.addEventListener('click', () => exec('justifyLeft', true));
    el.justifyCenterBtn.addEventListener('click', () => exec('justifyCenter', true));
    el.justifyRightBtn.addEventListener('click', () => exec('justifyRight', true));
    el.unorderedListBtn.addEventListener('click', runUnorderedList);
    el.orderedListBtn.addEventListener('click', runOrderedList);
    el.outdentBtn.addEventListener('click', runOutdent);
    el.indentBtn.addEventListener('click', runIndent);

    el.markdownToolsBtn.addEventListener('click', () =>
      toggleToolbarPopover(el.markdownToolsBtn, el.markdownToolsMenu));
    el.markdownToolsMenu.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      closeToolbarPopovers();
      if (button.dataset.mdHeading) {
        markdownTransformLines('heading', Number(button.dataset.mdHeading));
        return;
      }
      switch (button.dataset.mdAction) {
        case 'blockquote': markdownTransformLines('blockquote'); break;
        case 'strike': markdownWrapSelection('~~', '~~', 'strikethrough text'); break;
        case 'inline-code': markdownWrapSelection('`', '`', 'code'); break;
        case 'code-block': markdownInsertCodeBlock(); break;
        case 'link': markdownInsertLink(); break;
        case 'horizontal-rule': markdownInsertHorizontalRule(); break;
      }
    });

    // ---- Font colors -------------------------------------------------------
    el.colorPaletteBtn.addEventListener('pointerdown', rememberEditorSelection);
    el.colorPaletteBtn.addEventListener('click', () => toggleToolbarPopover(el.colorPaletteBtn, el.colorPaletteMenu));
    el.colorWheelBtn.addEventListener('pointerdown', rememberEditorSelection);
    el.colorWheelBtn.addEventListener('click', openColorWheel);
    el.colorWheelCanvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      el.colorWheelCanvas.setPointerCapture?.(event.pointerId);
      pickWheelAt(event.clientX, event.clientY);
    });
    el.colorWheelCanvas.addEventListener('pointermove', event => {
      if (event.buttons || event.pressure > 0) {
        event.preventDefault();
        pickWheelAt(event.clientX, event.clientY);
      }
    });
    el.colorBrightness.addEventListener('input', () => {
      wheelState.v = Math.max(0, Math.min(1, Number(el.colorBrightness.value) / 100));
      renderColorWheel();
    });
    el.colorHexInput.addEventListener('change', () => {
      if (/^#[0-9a-f]{6}$/i.test(el.colorHexInput.value.trim())) setWheelFromHex(el.colorHexInput.value.trim());
      else renderColorWheel();
    });
    el.colorWheelCancelBtn.addEventListener('click', closeToolbarPopovers);
    el.colorWheelApplyBtn.addEventListener('click', () => applyFontColor(wheelHex()));
    el.colorHistoryBtn.addEventListener('pointerdown', rememberEditorSelection);
    el.colorHistoryBtn.addEventListener('click', () => {
      renderColorHistory();
      toggleToolbarPopover(el.colorHistoryBtn, el.colorHistoryMenu);
    });

    // ---- Edit tools and document dialogs ----------------------------------
    el.editToolsBtn.addEventListener('pointerdown', rememberEditorSelection);
    el.editToolsBtn.addEventListener('click', () => toggleToolbarPopover(el.editToolsBtn, el.editToolsMenu));
    document.addEventListener('pointerdown', event => {
      if (!el.editToolsMenu.hidden && !el.editToolsMenu.contains(event.target) && !el.editToolsBtn.contains(event.target)) {
        closeToolbarPopovers();
      }
    }, true);
    el.insertImageBtn.addEventListener('click', () => {
      closeToolbarPopovers(); rememberEditorSelection(); el.imageInput.click();
    });
    el.imageInput.addEventListener('change', async () => {
      const file = el.imageInput.files?.[0];
      if (file) await importImageFile(file);
      el.imageInput.value = '';
    });
    el.replaceImageInput.addEventListener('change', async () => {
      const file = el.replaceImageInput.files?.[0];
      if (file && selectedImage) await importImageFile(file, { replace: selectedImage });
      el.replaceImageInput.value = '';
      closeImageMenu();
    });
    el.insertDateTimeBtn.addEventListener('click', () => { closeToolbarPopovers(); openDateTimeDialog(); });
    el.insertSpecialBtn.addEventListener('click', () => { closeToolbarPopovers(); rememberEditorSelection(); el.specialCharDialog.showModal(); });
    el.insertHrBtn.addEventListener('click', () => { closeToolbarPopovers(); insertHorizontalRule(); });
    el.insertNbspBtn.addEventListener('click', () => { closeToolbarPopovers(); insertSimpleText('\u00a0'); });
    el.documentPropertiesBtn.addEventListener('click', () => { closeToolbarPopovers(); openDocumentProperties(); });
    el.documentStatsBtn.addEventListener('click', () => { closeToolbarPopovers(); openDocumentStats(); });
    el.specialCharCloseBtn.addEventListener('click', () => el.specialCharDialog.close());
    el.documentPropertiesCloseBtn.addEventListener('click', () => el.documentPropertiesDialog.close());
    el.documentStatsCloseBtn.addEventListener('click', () => el.documentStatsDialog.close());
    el.changeUpperBtn.addEventListener('click', () => { closeToolbarPopovers(); restoreEditorSelection(); replaceSelectionText(text => text.toUpperCase()); });
    el.changeLowerBtn.addEventListener('click', () => { closeToolbarPopovers(); restoreEditorSelection(); replaceSelectionText(text => text.toLowerCase()); });
    el.changeTitleBtn.addEventListener('click', () => { closeToolbarPopovers(); restoreEditorSelection(); replaceSelectionText(toTitleCase); });
    el.changeSentenceBtn.addEventListener('click', () => { closeToolbarPopovers(); restoreEditorSelection(); replaceSelectionText(toSentenceCase); });
    el.goToLineBtn.addEventListener('click', () => { closeToolbarPopovers(); openGoToLine(); });
    el.dateTimeCancelBtn.addEventListener('click', () => el.dateTimeDialog.close());
    el.dateTimeInsertBtn.addEventListener('click', insertChosenDateTime);
    el.goToLineCancelBtn.addEventListener('click', () => el.goToLineDialog.close());
    el.goToLineConfirmBtn.addEventListener('click', goToLine);
    el.goToLineInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); goToLine(); }
    });

    // ---- Zoom and find/replace --------------------------------------------
    el.zoomOutBtn.addEventListener('click', () => changeZoom(-10));
    el.zoomInBtn.addEventListener('click', () => changeZoom(10));
    el.findInput.addEventListener('input', refreshFindMatches);
    el.findCaseToggle.addEventListener('change', refreshFindMatches);
    el.findPrevBtn.addEventListener('click', () => stepFind(-1));
    el.findNextBtn.addEventListener('click', () => stepFind(1));
    el.replaceOneBtn.addEventListener('click', replaceOne);
    el.replaceAllBtn.addEventListener('click', replaceAll);
    el.findCloseBtn.addEventListener('click', closeFindBar);
    el.findInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        stepFind(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        closeFindBar();
      }
    });

    // ---- Editor and embedded images ---------------------------------------
    el.editor.addEventListener('contextmenu', event => {
      closeFileContextMenu();
      closeEditorContextMenu();

      const image = event.target.closest?.('img[data-asset-id]');
      if (image) {
        event.preventDefault();
        openImageMenu(image, event.clientX, event.clientY);
        return;
      }

      // If this browser cannot draw custom spell highlights, fall back to its native
      // context menu so browser spellcheck remains usable.
      if (settings.spellcheck && !('highlights' in CSS)) return;

      event.preventDefault();
      const spellingError = settings.spellcheck ? spellErrorAtPoint(event) : null;
      renderSpellContext(spellingError);
      openEditorContextMenu(event.clientX, event.clientY);
    });
    el.editor.addEventListener('keydown' , handleEditorTab);
    el.editor.addEventListener('input', handleEditorInput);
    el.editor.addEventListener('keyup', updateFormatState);
    el.editor.addEventListener('mouseup', () => {
      updateFormatState();
      updateCounts();
      rememberActiveTabSelection();
    });
    el.editor.addEventListener('keyup', () => {
      updateCounts();
      rememberActiveTabSelection();
    });
    document.addEventListener('selectionchange', () => {
      if (selectionInsideEditor()) updateCounts();
    });

    $('imageSmallBtn').addEventListener('click', () => setImageWidth('25%'));
    $('imageMediumBtn').addEventListener('click', () => setImageWidth('50%'));
    $('imageLargeBtn').addEventListener('click', () => setImageWidth('75%'));
    $('imageOriginalBtn').addEventListener('click', () => setImageWidth('auto'));
    $('imageCustomBtn').addEventListener('click', () => {
      if (!selectedImage) return;
      const value = prompt(
        'Image width in pixels or percent (example: 420 or 60%):',
        selectedImage.style.width || '50%'
      );
      if (!value) return;
      const clean = /^\d+%$/.test(value.trim())
        ? value.trim()
        : `${Math.max(40, Math.min(4000, parseInt(value, 10) || 400))}px`;
      setImageWidth(clean);
    });
    $('imageLeftBtn').addEventListener('click', () => setImageAlign('left'));
    $('imageCenterBtn').addEventListener('click', () => setImageAlign('center'));
    $('imageRightBtn').addEventListener('click', () => setImageAlign('right'));
    $('imageReplaceBtn').addEventListener('click', () => el.replaceImageInput.click());
    $('imageDeleteBtn').addEventListener('click', deleteSelectedImage);

    // Image context-menu handling is consolidated into the primary editor
    // contextmenu listener above so native text spellcheck can remain available.
    el.editor.addEventListener('click', event => {
      const image = event.target.closest?.('img[data-asset-id]');
      selectImage(image || null);
      if (!image) closeImageMenu();
    });
    el.editor.addEventListener('copy', handleEditorCopy);
    el.editor.addEventListener('cut', handleEditorCut);
    el.editor.addEventListener('paste', handleEditorPaste);
    el.editor.addEventListener('scroll', () => {
      const tab = currentTab();
      if (tab) {
        tab.scrollTop = el.editor.scrollTop;
        persistSessionSoon();
      }
      el.lineNumberGutter.scrollTop = el.editor.scrollTop;
    });
    el.editor.addEventListener('blur', () => {
      if (settings.autoLinks) linkifyEditorPreservingSelection(true);
    });
    el.editor.addEventListener('click', event => {
      const link = event.target.closest?.('a[data-auto-link="1"]');
      if (!link || !settings.autoLinks) return;
      event.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    });

    document.addEventListener('pointerdown', event => {
      if (!event.target.closest?.('.toolbar-menu-wrap')) closeToolbarPopovers();
      if (!event.target.closest?.('#imageContextMenu') && !event.target.closest?.('img[data-asset-id]')) {
        closeImageMenu();
      }
    });

    // ---- Standard dialogs --------------------------------------------------
    el.nameCancelBtn.addEventListener('click', () => finishNameDialog(null));
    el.nameConfirmBtn.addEventListener('click', () => finishNameDialog(el.nameInput.value));
    el.nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finishNameDialog(el.nameInput.value); }
      if (event.key === 'Escape') { event.preventDefault(); finishNameDialog(null); }
    });
    el.nameDialog.addEventListener('cancel', event => {
      event.preventDefault();
      finishNameDialog(null);
    });
    el.moveCancelBtn.addEventListener('click', () => el.moveDialog.close());
    el.moveConfirmBtn.addEventListener('click', moveSelectedConfirmed);
    el.settingsCancelBtn.addEventListener('click', () => el.settingsDialog.close());
    el.settingsSaveBtn.addEventListener('click', saveSettingsFromDialog);

    // ---- Global lifecycle and keyboard shortcuts --------------------------
    document.addEventListener('keydown', handleGlobalShortcut);
    window.addEventListener('beforeunload', () => {
      persistUnsavedDrafts();
      persistSession();
      saveRecoverySnapshot();
    });
    window.addEventListener('resize', () => {
      scheduleRulerBuild();
      positionColorWheelPopover();
    });

    if ('ResizeObserver' in window) {
      const rulerObserver = new ResizeObserver(scheduleRulerBuild);
      rulerObserver.observe(el.ruler);
      rulerObserver.observe(el.verticalRuler);
    }
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (settings.theme === 'system') applySettings();
      });
    }
  }
