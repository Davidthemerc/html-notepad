  const APP_VERSION = '2.9.4';
  const DB_NAME = 'HTMLNotepadDB';
  const DB_VERSION = 3;
  const FILE_STORE = 'files';
  const ASSET_STORE = 'assets';
  const SAFETY_STORE = 'safety';
  const TRASH_STORE = 'trash';
  const LS_SETTINGS = 'htmlNotepad.settings';
  const LS_DRAFTS = 'htmlNotepad.unsavedDrafts';
  const LS_SESSION = 'htmlNotepad.session';
  const LS_CLOSED_TABS = 'htmlNotepad.closedTabs';
  const LS_EXPANDED_FOLDERS = 'htmlNotepad.expandedFolders';
  const LS_RECENT_FILES = 'htmlNotepad.recentFiles';
  const LS_RECOVERY = 'htmlNotepad.recovery';
  const LS_FILE_SORT = 'htmlNotepad.filesSortMode';

  /*
   * Architecture at a glance
   * ------------------------
   * IndexedDB is the source of truth for saved virtual files and embedded images.
   * localStorage holds lightweight preferences, unsaved drafts, and workspace/session state.
   * The contenteditable editor is the live working copy for the active tab; edits are copied
   * back into that tab object before persistence, tab switches, backups, or page unload.
   * Split View still uses one live editor: it is mounted into the active side while the other
   * side renders a synchronized in-memory view of its assigned tab.
   *
   * The application is intentionally self-contained: no external libraries, network calls,
   * or remote assets are required at runtime.
   */

  function $(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing required Notepad element: #${id}`);
    return node;
  }
  // Cache stable DOM references once during startup.
  const el = {
    filesToggleBtn: $('filesToggleBtn'),
    topbarExpandBtn: $('topbarExpandBtn'),
    formatToolbar: $('formatToolbar'),
    toolbarExpandBtn: $('toolbarExpandBtn'),
    workspace: $('workspace'),
    sidebar: $('sidebar'),
    drawerCloseBtn: $('drawerCloseBtn'),
    drawerBackdrop: $('drawerBackdrop'),
    newBtn: $('newBtn'),
    newDocumentDialog: $('newDocumentDialog'),
    newDocumentCancelBtn: $('newDocumentCancelBtn'),
    openBtn: $('openBtn'),
    topImportBtn: $('topImportBtn'),
    openFileDialog: $('openFileDialog'),
    openFileSearch: $('openFileSearch'),
    openFileList: $('openFileList'),
    openFileCancelBtn: $('openFileCancelBtn'),
    openFileConfirmBtn: $('openFileConfirmBtn'),
    saveBtn: $('saveBtn'),
    saveAsBtn: $('saveAsBtn'),
    backupRestoreBtn: $('backupRestoreBtn'),
    backupRestoreDialog: $('backupRestoreDialog'),
    createBackupBtn: $('createBackupBtn'),
    chooseRestoreBtn: $('chooseRestoreBtn'),
    backupRestoreCloseBtn: $('backupRestoreCloseBtn'),
    restoreSafetyStatus: $('restoreSafetyStatus'),
    settingsBtn: $('settingsBtn'),
    helpBtn: $('helpBtn'),
    helpMenu: $('helpMenu'),
    manualDialog: $('manualDialog'),
    manualSearch: $('manualSearch'),
    manualSearchStatus: $('manualSearchStatus'),
    manualNav: $('manualNav'),
    manualSectionSelect: $('manualSectionSelect'),
    manualContent: $('manualContent'),
    manualCloseBtn: $('manualCloseBtn'),
    manualCloseTopBtn: $('manualCloseTopBtn'),
    printBtn: $('printBtn'),
    trashBtn: $('trashBtn'),
    trashDialog: $('trashDialog'),
    trashList: $('trashList'),
    trashSummary: $('trashSummary'),
    emptyTrashBtn: $('emptyTrashBtn'),
    trashCloseBtn: $('trashCloseBtn'),
    undoBtn: $('undoBtn'),
    redoBtn: $('redoBtn'),
    boldBtn: $('boldBtn'),
    italicBtn: $('italicBtn'),
    underlineBtn: $('underlineBtn'),
    clearFormattingBtn: $('clearFormattingBtn'),
    fontFamilySelect: $('fontFamilySelect'),
    fontSizeSelect: $('fontSizeSelect'),
    justifyLeftBtn: $('justifyLeftBtn'),
    justifyCenterBtn: $('justifyCenterBtn'),
    justifyRightBtn: $('justifyRightBtn'),
    unorderedListBtn: $('unorderedListBtn'),
    orderedListBtn: $('orderedListBtn'),
    outdentBtn: $('outdentBtn'),
    indentBtn: $('indentBtn'),
    colorPaletteBtn: $('colorPaletteBtn'),
    colorPaletteMenu: $('colorPaletteMenu'),
    colorGrid: $('colorGrid'),
    colorWheelBtn: $('colorWheelBtn'),
    colorWheelMenu: $('colorWheelMenu'),
    colorWheelCanvas: $('colorWheelCanvas'),
    colorBrightness: $('colorBrightness'),
    colorWheelPreview: $('colorWheelPreview'),
    colorHexInput: $('colorHexInput'),
    colorWheelCancelBtn: $('colorWheelCancelBtn'),
    colorWheelApplyBtn: $('colorWheelApplyBtn'),
    colorHistoryBtn: $('colorHistoryBtn'),
    colorHistoryMenu: $('colorHistoryMenu'),
    colorHistoryList: $('colorHistoryList'),
    tabsbar: $('tabsbar'),
    allTabsBtn: $('allTabsBtn'),
    splitViewBtn: $('splitViewBtn'),
    splitWorkspace: $('splitWorkspace'),
    leftPane: $('leftPane'),
    rightPane: $('rightPane'),
    leftPaneHeader: $('leftPaneHeader'),
    rightPaneHeader: $('rightPaneHeader'),
    leftPaneName: $('leftPaneName'),
    rightPaneName: $('rightPaneName'),
    leftPaneCloseBtn: $('leftPaneCloseBtn'),
    rightPaneCloseBtn: $('rightPaneCloseBtn'),
    leftPaneMount: $('leftPaneMount'),
    rightPaneMount: $('rightPaneMount'),
    leftPaneSnapshot: $('leftPaneSnapshot'),
    rightPaneSnapshot: $('rightPaneSnapshot'),
    leftSnapshotContent: $('leftSnapshotContent'),
    rightSnapshotContent: $('rightSnapshotContent'),
    splitDivider: $('splitDivider'),
    editorShell: $('editorShell'),
    editor: $('editor'),
    markdownSource: $('markdownSource'),
    markdownPreview: $('markdownPreview'),
    markdownModeToggle: $('markdownModeToggle'),
    markdownEditBtn: $('markdownEditBtn'),
    markdownPreviewBtn: $('markdownPreviewBtn'),
    markdownToolsWrap: $('markdownToolsWrap'),
    markdownToolsBtn: $('markdownToolsBtn'),
    markdownToolsMenu: $('markdownToolsMenu'),
    ruler: $('ruler'),
    verticalRuler: $('verticalRuler'),
    fileList: $('fileList'),
    fileCount: $('fileCount'),
    fileSearch: $('fileSearch'),
    newFolderBtn: $('newFolderBtn'),
    filesTreeMenuBtn: $('filesTreeMenuBtn'),
    filesSortMenuBtn: $('filesSortMenuBtn'),
    importDocBtn: $('importDocBtn'),
    importDocInput: $('importDocInput'),
    renameBtn: $('renameBtn'),
    deleteBtn: $('deleteBtn'),
    statusMessage: $('statusMessage'),
    wordCount: $('wordCount'),
    charCount: $('charCount'),
    cursorPosition: $('cursorPosition'),
    editToolsBtn: $('editToolsBtn'),
    editToolsMenu: $('editToolsMenu'),
    insertImageBtn: $('insertImageBtn'),
    imageInput: $('imageInput'),
    replaceImageInput: $('replaceImageInput'),
    insertDateTimeBtn: $('insertDateTimeBtn'),
    insertSpecialBtn: $('insertSpecialBtn'),
    insertHrBtn: $('insertHrBtn'),
    insertNbspBtn: $('insertNbspBtn'),
    documentPropertiesBtn: $('documentPropertiesBtn'),
    documentStatsBtn: $('documentStatsBtn'),
    specialCharDialog: $('specialCharDialog'),
    specialCharGrid: $('specialCharGrid'),
    specialCharCloseBtn: $('specialCharCloseBtn'),
    documentPropertiesDialog: $('documentPropertiesDialog'),
    documentPropertiesBody: $('documentPropertiesBody'),
    documentPropertiesCloseBtn: $('documentPropertiesCloseBtn'),
    documentStatsDialog: $('documentStatsDialog'),
    documentStatsBody: $('documentStatsBody'),
    documentStatsCloseBtn: $('documentStatsCloseBtn'),
    changeUpperBtn: $('changeUpperBtn'),
    changeLowerBtn: $('changeLowerBtn'),
    changeTitleBtn: $('changeTitleBtn'),
    changeSentenceBtn: $('changeSentenceBtn'),
    goToLineBtn: $('goToLineBtn'),
    dateTimeDialog: $('dateTimeDialog'),
    dateTimeFormat: $('dateTimeFormat'),
    dateTimeCancelBtn: $('dateTimeCancelBtn'),
    dateTimeInsertBtn: $('dateTimeInsertBtn'),
    goToLineDialog: $('goToLineDialog'),
    goToLineInput: $('goToLineInput'),
    goToLineNote: $('goToLineNote'),
    goToLineCancelBtn: $('goToLineCancelBtn'),
    goToLineConfirmBtn: $('goToLineConfirmBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomInBtn: $('zoomInBtn'),
    zoomLabel: $('zoomLabel'),
    nameDialog: $('nameDialog'),
    nameDialogTitle: $('nameDialogTitle'),
    nameInput: $('nameInput'),
    nameDialogNote: $('nameDialogNote'),
    nameCancelBtn: $('nameCancelBtn'),
    nameConfirmBtn: $('nameConfirmBtn'),
    moveDialog: $('moveDialog'),
    moveFolderSelect: $('moveFolderSelect'),
    moveCancelBtn: $('moveCancelBtn'),
    moveConfirmBtn: $('moveConfirmBtn'),
    settingsDialog: $('settingsDialog'),
    themeSelect: $('themeSelect'),
    wrapToggle: $('wrapToggle'),
    spellcheckToggle: $('spellcheckToggle'),
    autoLinksToggle: $('autoLinksToggle'),
    autosaveToggle: $('autosaveToggle'),
    lineNumbersToggle: $('lineNumbersToggle'),
    lineNumberGutter: $('lineNumberGutter'),
    spellContextSection: $('spellContextSection'),
    spellContextWord: $('spellContextWord'),
    spellSuggestionList: $('spellSuggestionList'),
    spellIgnoreBtn: $('spellIgnoreBtn'),
    spellAddDictionaryBtn: $('spellAddDictionaryBtn'),
    settingsCancelBtn: $('settingsCancelBtn'),
    settingsSaveBtn: $('settingsSaveBtn'),
    undoRestoreBtn: $('undoRestoreBtn'),
    restoreInspectorDialog: $('restoreInspectorDialog'),
    restoreSummary: $('restoreSummary'),
    restoreWarnings: $('restoreWarnings'),
    restoreFilesToggle: $('restoreFilesToggle'),
    restoreDraftsToggle: $('restoreDraftsToggle'),
    restoreSettingsToggle: $('restoreSettingsToggle'),
    restoreItemList: $('restoreItemList'),
    restoreInspectorCancelBtn: $('restoreInspectorCancelBtn'),
    restoreInspectorConfirmBtn: $('restoreInspectorConfirmBtn'),
    restoreInput: $('restoreInput'),
    toast: $('toast'),
    findBar: $('findBar'),
    findInput: $('findInput'),
    replaceInput: $('replaceInput'),
    findMatchCount: $('findMatchCount'),
    findPrevBtn: $('findPrevBtn'),
    findNextBtn: $('findNextBtn'),
    replaceOneBtn: $('replaceOneBtn'),
    replaceAllBtn: $('replaceAllBtn'),
    findCaseToggle: $('findCaseToggle'),
    findCloseBtn: $('findCloseBtn')
  };

  function readJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    if (value === undefined || value === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  }

  let db = null;
  let files = [];
  let tabs = [];
  let activeTabId = null;
  let splitState = {
    enabled: false,
    activeSide: 'left',
    leftTabId: null,
    rightTabId: null,
    ratio: 50
  };
  let splitDragPointerId = null;
  let selectedFileId = null;
  let selectedFileIds = new Set();
  let fileSelectionAnchorId = null;
  let nameDialogResolver = null;
  let draftSaveTimer = null;
  let savedEditorSelection = null;
  let linkifyTimer = null;
  let wheelState = { h: 0, s: 0, v: 0 };
  let autosaveTimer = null;
  let findMatches = [], findIndex = -1;
  let expandedFolders = new Set(readJsonStorage(LS_EXPANDED_FOLDERS, []));
  let recentFileIds = readJsonStorage(LS_RECENT_FILES, []);
  let closedTabs = readJsonStorage(LS_CLOSED_TABS, []);
  let tabContextId = null;
  let pendingRestorePayload = null;

  // Protected-document secrets live only in memory while a protected file is open.
  // No password, recovery key, or decrypted AES key is written to localStorage/IndexedDB.
  const protectedSessions = new Map();       // fileId -> { dekKey, recoveryKey }
  const protectedAssetCaches = new Map();    // fileId -> Map(assetId, decrypted asset)
  let protectionPasswordResolver = null;
  let protectionPasswordMode = 'protect';
  let protectionUnlockResolver = null;
  let protectionUnlockMode = 'password';
  let recoveryKeyResolver = null;
  let recoveryKeyMustAcknowledge = false;
  let recoveryKeyFileName = '';

  const COMMON_COLORS = [
    ['Black','#000000'], ['Dark Gray','#444444'], ['Gray','#808080'], ['Silver','#b7b7b7'], ['Light Gray','#d9d9d9'], ['White','#ffffff'], ['Dark Red','#8b0000'], ['Red','#ff0000'],
    ['Orange Red','#ff4500'], ['Orange','#ff8c00'], ['Gold','#ffd700'], ['Yellow','#ffff00'], ['Olive','#808000'], ['Dark Green','#006400'], ['Green','#008000'], ['Lime','#00ff00'],
    ['Teal','#008080'], ['Turquoise','#40e0d0'], ['Cyan','#00ffff'], ['Steel Blue','#4682b4'], ['Blue','#0000ff'], ['Navy','#000080'], ['Indigo','#4b0082'], ['Purple','#800080'],
    ['Violet','#8a2be2'], ['Magenta','#ff00ff'], ['Deep Pink','#ff1493'], ['Brown','#8b4513'], ['Chocolate','#d2691e'], ['Tan','#d2b48c'], ['Beige','#f5f5dc'], ['Crimson','#dc143c']
  ];

  const defaultSettings = {
    theme: 'system',
    wrap: true,
    spellcheck: true,
    autoLinks: true,
    autosave: true,
    lineNumbers: false,
    zoom: 100,
    colorHistory: [],
    customDictionary: []
  };
  let settings = null; // Initialized by startup after all runtime scripts have loaded.
