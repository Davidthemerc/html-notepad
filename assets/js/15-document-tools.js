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
 // Counting words/characters walks the whole document, so on very large documents the
  // status-bar update is coalesced instead of running on every keystroke.
  let countsTimer = null, lastCountChars = 0;
  function updateCounts() {
    if (lastCountChars > 150000) {
      if (countsTimer) return;
      countsTimer = setTimeout(() => { countsTimer = null; updateCountsNow(); }, 250);
      return;
    }
    updateCountsNow();
  }

  function updateCountsNow() {
    const text = (isSourceTab() ? el.markdownSource.value : el.editor.innerText).replace(/\u00a0/g, ' ');
    const chars = text.length; lastCountChars = chars;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
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

  // Plain-text and Markdown documents have no per-selection formatting, so the size applies to the
  // whole text area and is remembered in settings.
  function applySourceFontSize() {
    const px = Math.max(10, Math.min(48, Number(settings?.sourceFontSize) || 16));
    el.markdownSource.style.fontSize = `${px}px`;
    el.markdownPreview.style.fontSize = `${px}px`;
    updateLineNumbers();
  }

  function applyFontSizePx(px) {
    const size=Math.max(8,Math.min(96,Number(px)||16));
    if (isSourceTab()) {
      settings.sourceFontSize = Math.min(48, size);
      saveSettings(); applySourceFontSize();
      return;
    }
    restoreEditorSelection();
    el.editor.focus();
    const sel = getSelection();
    try {
      document.execCommand('styleWithCSS', false, true);
      if (sel && sel.isCollapsed) {
        // Nothing selected: size the text typed next (a zero-width marker holds the caret).
        const span = document.createElement('span');
        span.style.fontSize = size + 'px';
        span.textContent = '\u200b';
        const range = sel.getRangeAt(0);
        range.insertNode(span);
        range.setStart(span.firstChild, 1); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
        toast(`Font size ${size} applies to what you type next. Select text first to resize it.`);
      } else {
        document.execCommand('fontSize', false, '7');
        // Chrome writes "-webkit-xxx-large" (or <font size=7>) for size 7; swap in the real size.
        el.editor.querySelectorAll('font[size="7"], [style*="xxx-large"]').forEach(node => {
          node.removeAttribute('size');
          node.style.fontSize = size + 'px';
        });
      }
    } catch {}
    markDirtyFromEditor(); updateFormatState();
  }

  function normalizedFontName(value) {
    return String(value||'').replace(/["']/g,'').split(',')[0].trim().toLowerCase();
  }

  function updateTypographyControls() {
    if (isSourceTab()) {
      el.fontSizeSelect.value = String([...el.fontSizeSelect.options].map(o => Number(o.value)).reduce((a, b) => Math.abs(b - (settings.sourceFontSize || 16)) < Math.abs(a - (settings.sourceFontSize || 16)) ? b : a, 16));
      return;
    }
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

  // ---------------------------------------------------------------------------
  // "=" underline: fills the current empty line (or adds a new line under a text line) with
  // as many "=" characters as the line above it, for plain-text style titles/dividers.
  // ---------------------------------------------------------------------------
  const equalsLineLength = text => String(text || '').replace(/ /g, ' ').replace(/\s+$/, '').length;
  const isEqualsOnly = text => /^\s*=+\s*$/.test(String(text || '').replace(/ /g, ' '));

  // Tapping a toolbar button can blur the editor and, on some mobile browsers, reset the caret
  // (often to the end). Remember where the caret was when the button was pressed and restore it.
  let equalsCaret = null;
  function rememberEqualsCaret() {
    if (isSourceTab()) equalsCaret = { source: true, start: el.markdownSource.selectionStart, end: el.markdownSource.selectionEnd };
    else if (selectionInsideEditor()) equalsCaret = { source: false, range: getSelection().getRangeAt(0).cloneRange() };
    else equalsCaret = null;
  }

  function insertEqualsLineSource() {
    const area = el.markdownSource, value = area.value;
    area.focus({ preventScroll: true });
    if (equalsCaret?.source) area.setSelectionRange(equalsCaret.start, equalsCaret.end);
    const pos = area.selectionStart;
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = value.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = value.length;
    const current = value.slice(lineStart, lineEnd);
    const above = value.slice(0, Math.max(0, lineStart - 1)).split('\n');
    const lineAbove = lineStart === 0 ? '' : above.reverse().find(line => line.trim() && !isEqualsOnly(line)) || '';
    const replaceCurrent = !current.trim() || isEqualsOnly(current);
    const count = equalsLineLength(replaceCurrent ? lineAbove : current);
    if (!count) return toast('Type a line of text first, then tap = to underline it.');
    const bar = '='.repeat(count);
    if (replaceCurrent) area.setSelectionRange(lineStart, lineEnd);
    else area.setSelectionRange(lineEnd, lineEnd);
    const text = replaceCurrent ? bar : `\n${bar}`;
    if (!document.execCommand('insertText', false, text)) {
      area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  const EQUALS_BLOCKS = 'li,p,div,h1,h2,h3,h4,h5,h6,blockquote,pre';
  function lastLineText(node) {
    const kids = [...node.children].filter(c => c.matches?.(EQUALS_BLOCKS + ',ul,ol'));
    return kids.length ? lastLineText(kids[kids.length - 1]) : (node.textContent || '');
  }

  // Text of the nearest non-empty line above `start`, whether lines are blocks (div/p/li) or
  // runs of text separated by <br> (the first line of a contenteditable is often a bare text node).
  function lineAboveText(start) {
    const blocks = EQUALS_BLOCKS + ',ul,ol';
    const usable = text => text.trim() && !isEqualsOnly(text);
    for (let node = start; node && node !== el.editor; node = node.parentNode) {
      let prev = node.previousSibling;
      while (prev) {
        if (prev.nodeType === Node.ELEMENT_NODE && prev.matches(blocks)) {
          const text = lastLineText(prev);
          if (usable(text)) return text;
          prev = prev.previousSibling;
        } else if (prev.nodeName === 'BR') {
          prev = prev.previousSibling;
        } else {
          let text = '', run = prev;
          while (run && run.nodeName !== 'BR' && !(run.nodeType === Node.ELEMENT_NODE && run.matches(blocks))) {
            text = (run.textContent || '') + text; run = run.previousSibling;
          }
          if (usable(text)) return text;
          prev = run;
        }
      }
    }
    return '';
  }

  function insertEqualsLineRich() {
    el.editor.focus({ preventScroll: true });
    const sel = getSelection();
    if (equalsCaret && !equalsCaret.source && el.editor.contains(equalsCaret.range.startContainer)) {
      sel.removeAllRanges(); sel.addRange(equalsCaret.range);
    }
    if (!sel?.rangeCount || !el.editor.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const block = start === el.editor ? null : start.closest(EQUALS_BLOCKS);
    let current, lineAbove = '';

    if (block && el.editor.contains(block) && block !== el.editor) {
      current = block.textContent || '';
      lineAbove = lineAboveText(block);
    } else {
      // Lines separated by <br> directly inside the editor.
      let top = range.startContainer;
      if (top === el.editor) top = el.editor.childNodes[range.startOffset] || el.editor.lastChild;
      while (top && top.parentNode !== el.editor) top = top.parentNode;
      const isBlockNode = n => n.nodeType === Node.ELEMENT_NODE && n.matches(EQUALS_BLOCKS + ',ul,ol');
      const collect = (from, step) => {
        let text = '', node = from;
        while (node && node.nodeName !== 'BR' && !isBlockNode(node)) { text = step < 0 ? (node.textContent || '') + text : text + (node.textContent || ''); node = step < 0 ? node.previousSibling : node.nextSibling; }
        return { text, boundary: node };
      };
      const before = top ? collect(top.nodeName === 'BR' ? top.previousSibling : top, -1) : { text: '', boundary: null };
      const after = top && top.nodeName !== 'BR' ? collect(top.nextSibling, 1) : { text: '', boundary: top };
      current = before.text + after.text;
      if (before.boundary) lineAbove = lineAboveText(before.boundary);
      if (current.trim() && !isEqualsOnly(current)) {
        const next = after.boundary && after.boundary.nodeName !== 'BR' ? after.boundary : null;
        if (next && isEqualsOnly(next.textContent)) {
          const barRange = document.createRange();
          barRange.selectNodeContents(next);
          sel.removeAllRanges(); sel.addRange(barRange);
          document.execCommand('insertText', false, '='.repeat(equalsLineLength(current)));
          return;
        }
        const caret = document.createRange();
        if (after.boundary) caret.setStartBefore(after.boundary); else caret.selectNodeContents(el.editor), caret.collapse(false);
        caret.collapse(true); sel.removeAllRanges(); sel.addRange(caret);
        const count = equalsLineLength(current);
        document.execCommand('insertLineBreak');
        document.execCommand('insertText', false, '='.repeat(count));
        return;
      }
      if (isEqualsOnly(current) && (before.boundary || after.boundary)) {
        // Replace the existing === line.
        const lineRange = document.createRange();
        lineRange.setStartAfter(before.boundary || el.editor.firstChild);
        if (!before.boundary) lineRange.setStartBefore(el.editor.firstChild);
        if (after.boundary) lineRange.setEndBefore(after.boundary); else lineRange.setEndAfter(el.editor.lastChild);
        sel.removeAllRanges(); sel.addRange(lineRange);
      }
    }

    const replaceCurrent = !current.trim() || isEqualsOnly(current);
    const count = equalsLineLength(replaceCurrent ? lineAbove : current);
    if (!count) return toast('Type a line of text first, then tap = to underline it.');
    const bar = '='.repeat(count);
    if (block && block !== el.editor) {
      // Tapping on a text line that already has an === line under it resizes that line.
      const existing = !replaceCurrent && block.nextElementSibling && isEqualsOnly(block.nextElementSibling.textContent) ? block.nextElementSibling : null;
      const lineRange = document.createRange();
      lineRange.selectNodeContents(existing || block);
      if (!replaceCurrent && !existing) lineRange.collapse(false);
      sel.removeAllRanges(); sel.addRange(lineRange);
      if (!replaceCurrent && !existing) document.execCommand('insertParagraph');
    }
    document.execCommand('insertText', false, bar);
  }

  function insertEqualsLine() {
    if (!requireActiveDocument()) return;
    if (isMarkdownTab() && !isMarkdownEditing()) return toast('Switch to Edit to add an = line.');
    if (isSourceTab()) insertEqualsLineSource(); else insertEqualsLineRich();
    equalsCaret = null;
    updateCounts();
  }
