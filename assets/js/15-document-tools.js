  // ===========================================================================
  // DOCUMENT TOOLS & STATISTICS
  // ===========================================================================

  function documentTextStats() {
    if(!currentTab()) return {
      text:'', words:0, lines:0, paras:0, chars:0, noSpaces:0,
      selected:'', selectedWords:0
    };
    const text = (isSourceTab() ? el.markdownSource.value : richTextLogicalText(el.editor)).replace(/\u00a0/g, ' ');
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const lines = Math.max(1, text.split('\n').length);
    const paragraphs = trimmed
      ? text.split(/\n\s*\n/).filter(part => part.trim()).length
      : 0;
    const noSpaces = text.replace(/\s/g, '').length;

    const selection = getSelection();
    const selected = isSourceTab()
      ? el.markdownSource.value.slice(el.markdownSource.selectionStart, el.markdownSource.selectionEnd)
      : (selection && !selection.isCollapsed && selectionInsideEditor() ? selection.toString() : '');

    return {
      text,
      words,
      lines,
      paras: paragraphs,
      chars: text.length,
      noSpaces,
      selected,
      selectedWords: selected.trim() ? selected.trim().split(/\s+/).length : 0
    };
  }

  async function openDocumentProperties() {
    if(!requireActiveDocument())return;
    captureEditorIntoActive();
    const tab = currentTab();
    const file = tab?.fileId ? files.find(item => item.id === tab.fileId) : null;
    const stats = documentTextStats();

    let location = 'Unsaved';
    if (file) {
      const path = [];
      let parentId = file.parentId;
      while (parentId) {
        const folder = files.find(item => item.id === parentId);
        if (!folder) break;
        path.unshift(folder.name);
        parentId = folder.parentId;
      }
      location = path.length ? `Files / ${path.join(' / ')}` : 'Files root';
    }

    const assetIds = [...el.editor.querySelectorAll('img[data-asset-id]')]
      .map(image => image.dataset.assetId);
    let assetBytes = 0;
    const protectedCache = tab?.protected ? protectedAssetCaches.get(tab.fileId) : null;
    for (const id of assetIds) {
      const asset = protectedCache?.get(id) || await storeGet(ASSET_STORE, id);
      assetBytes += Number(asset?.size) || 0;
    }

    const documentBytes = new Blob([tab?.content || '']).size;
    const documentSize = documentBytes < 1024
      ? `${documentBytes} bytes`
      : `${(documentBytes / 1024).toFixed(1)} KB`;
    const imageSize = assetBytes < 1048576
      ? `${(assetBytes / 1024).toFixed(1)} KB`
      : `${(assetBytes / 1048576).toFixed(1)} MB`;

    el.documentPropertiesBody.innerHTML =
      propRow('Name', tab?.name || 'Untitled') +
      propRow('Type', isMarkdownTab(tab) ? 'Markdown' : isPlainTab(tab) ? 'Plain text' : 'Rich text') +
      propRow('Location', location) +
      propRow('State', tab?.fileId ? (tab.dirty ? 'Saved file — modified' : 'Saved') : 'Unsaved draft') +
      propRow('Protection', tab?.protected ? '🔓 Password protected — unlocked until closed' : 'None') +
      propRow('Created', tab?.createdAt ? new Date(tab.createdAt).toLocaleString() : '—') +
      propRow('Modified', tab?.updatedAt ? new Date(tab.updatedAt).toLocaleString() : '—') +
      propRow('Words', String(stats.words)) +
      propRow('Characters', String(stats.chars)) +
      propRow('Lines', String(stats.lines)) +
      propRow('Text/document size', documentSize) +
      propRow('Embedded images', `${assetIds.length} · ${imageSize}`);

    el.documentPropertiesDialog.showModal();
  }

  function openDocumentStats() {
    if(!requireActiveDocument())return;
    const stats = documentTextStats();
    let html =
      propRow('Words', String(stats.words)) +
      propRow('Characters (with spaces)', String(stats.chars)) +
      propRow('Characters (without spaces)', String(stats.noSpaces)) +
      propRow('Lines', String(stats.lines)) +
      propRow('Paragraphs', String(stats.paras));

    if (stats.selected) {
      html +=
        propRow('Selected words', String(stats.selectedWords)) +
        propRow('Selected characters', String(stats.selected.length)) +
        propRow('Selected lines', String(stats.selected.split('\n').length));
    }

    el.documentStatsBody.innerHTML = html;
    el.documentStatsDialog.showModal();
  }
 function updateCounts() {
    const text = (isSourceTab() ? el.markdownSource.value : el.editor.innerText).replace(/\u00a0/g, ' ');
    const chars = text.length, words = text.trim() ? text.trim().split(/\s+/).length : 0;
    let selectedWords=0,selectedChars=0,selectedLines=0;
    if (isSourceTab()) {
      const raw = el.markdownSource.value.slice(el.markdownSource.selectionStart, el.markdownSource.selectionEnd);
      const st = raw.trim(); selectedChars=raw.length; selectedWords=st?st.split(/\s+/).length:0; selectedLines=raw?raw.split('\n').length:0;
    } else {
      const sel=window.getSelection();
      if(sel && !sel.isCollapsed && selectionInsideEditor()){
        const raw=sel.toString(),st=raw.trim();selectedChars=raw.length;selectedWords=st?st.split(/\s+/).length:0;selectedLines=raw?raw.split('\n').length:0;
      }
    }
    el.wordCount.textContent = selectedWords ? `${selectedWords} of ${words} words selected` : `${words} word${words === 1 ? '' : 's'}`;
    el.charCount.textContent = selectedChars ? `${selectedChars} chars · ${selectedLines} line${selectedLines===1?'':'s'} selected` : `${chars} char${chars === 1 ? '' : 's'}`;
    updateCursorPosition();
    updateLineNumbers();
  }

  function applyFontFamily(family) {
    restoreEditorSelection();
    el.editor.focus();
    try { document.execCommand('styleWithCSS', false, true); document.execCommand('fontName', false, family); } catch {}
    markDirtyFromEditor(); updateFormatState();
  }

  function applyFontSizePx(px) {
    restoreEditorSelection();
    el.editor.focus();
    const size=Math.max(8,Math.min(96,Number(px)||16));
    try {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('fontSize', false, '7');
      el.editor.querySelectorAll('font[size="7"]').forEach(node => {
        node.removeAttribute('size');
        node.style.fontSize=size+'px';
      });
    } catch {}
    markDirtyFromEditor(); updateFormatState();
  }

  function normalizedFontName(value) {
    return String(value||'').replace(/["']/g,'').split(',')[0].trim().toLowerCase();
  }

  function updateTypographyControls() {
    let family='', size=16;
    try {
      family=document.queryCommandValue('fontName')||'';
      const sel=getSelection();
      const node=sel&&sel.anchorNode ? (sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement) : el.editor;
      if(node && el.editor.contains(node)) size=Math.round(parseFloat(getComputedStyle(node).fontSize)||16);
    } catch {}
    const nf=normalizedFontName(family);
    const option=[...el.fontFamilySelect.options].find(o=>normalizedFontName(o.value)===nf || nf.includes(normalizedFontName(o.value)));
    if(option) el.fontFamilySelect.value=option.value;
    const sizes=[...el.fontSizeSelect.options].map(o=>Number(o.value));
    const nearest=sizes.reduce((a,b)=>Math.abs(b-size)<Math.abs(a-size)?b:a,16);
    el.fontSizeSelect.value=String(nearest);
  }
