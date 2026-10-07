  // ===========================================================================
  // MARKDOWN DOCUMENTS
  // ===========================================================================

  function isMarkdownTab(tab = currentTab()) {
    return tab?.docType === 'markdown';
  }
  function isPlainTab(tab = currentTab()) {
    return tab?.docType === 'plain';
  }
  function isSourceTab(tab = currentTab()) {
    return isMarkdownTab(tab) || isPlainTab(tab);
  }
  function documentTypeLabel(docType) {
    return docType === 'markdown' ? 'MD' : docType === 'plain' ? 'TXT' : 'RICH';
  }

  function escapeHtmlText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }

  function markdownInline(source) {
    let text = escapeHtmlText(source);
    const codeSpans = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `@@MD_CODE_${codeSpans.length}@@`;
      codeSpans.push(`<code>${code}</code>`);
      return token;
    });
    text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img alt="$1" src="$2">');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
               .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
               .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
               .replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
               .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    return text.replace(/@@MD_CODE_(\d+)@@/g, (_, index) => codeSpans[Number(index)] || '');
  }

  /*
   * Small built-in Markdown renderer. It deliberately covers common note/document syntax
   * rather than attempting the full CommonMark specification. Raw HTML is escaped, so a
   * Markdown file cannot inject script or page markup into Notepad's preview.
   */
  function renderMarkdown(source) {
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    let html = '', paragraph = [], listType = null, inCode = false, code = [], quote = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${markdownInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`;
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html += `</${listType}>`;
      listType = null;
    };
    const flushQuote = () => {
      if (!quote.length) return;
      html += `<blockquote>${quote.map(markdownInline).join('<br>')}</blockquote>`;
      quote = [];
    };

    for (const line of lines) {
      if (/^```/.test(line)) {
        flushParagraph(); closeList(); flushQuote();
        if (inCode) {
          html += `<pre><code>${escapeHtmlText(code.join('\n'))}</code></pre>`;
          code = []; inCode = false;
        } else inCode = true;
        continue;
      }
      if (inCode) { code.push(line); continue; }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList(); flushQuote();
        const level = heading[1].length;
        html += `<h${level}>${markdownInline(heading[2])}</h${level}>`;
        continue;
      }
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        flushParagraph(); closeList(); flushQuote(); html += '<hr>'; continue;
      }
      const quoteLine = line.match(/^\s*>\s?(.*)$/);
      if (quoteLine) {
        flushParagraph(); closeList(); quote.push(quoteLine[1]); continue;
      } else flushQuote();

      const ul = line.match(/^\s*[-+*]\s+(.+)$/), ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ul || ol) {
        flushParagraph();
        const wanted = ul ? 'ul' : 'ol';
        if (listType !== wanted) { closeList(); listType = wanted; html += `<${wanted}>`; }
        html += `<li>${markdownInline((ul || ol)[1])}</li>`;
        continue;
      }
      closeList();

      if (!line.trim()) { flushParagraph(); continue; }
      paragraph.push(line);
    }
    if (inCode) html += `<pre><code>${escapeHtmlText(code.join('\n'))}</code></pre>`;
    flushParagraph(); closeList(); flushQuote();
    return html || '<p></p>';
  }

  function isMarkdownEditing(tab = currentTab()) {
    return isMarkdownTab(tab) && (tab?.markdownMode || 'edit') === 'edit';
  }

  function finishMarkdownFormatting(selectionStart, selectionEnd) {
    el.markdownSource.focus();
    el.markdownSource.setSelectionRange(selectionStart, selectionEnd);
    markDirtyFromEditor();
    updateLineNumbers();
  }

  function markdownWrapSelection(prefix, suffix = prefix, placeholder = 'text') {
    if (!isMarkdownEditing()) return;
    const source = el.markdownSource;
    const value = source.value;
    let start = source.selectionStart;
    let end = source.selectionEnd;
    let selected = value.slice(start, end);

    // If the selected text is already surrounded by this exact Markdown marker,
    // clicking the same command removes the marker.
    if (selected && start >= prefix.length &&
        value.slice(start - prefix.length, start) === prefix &&
        value.slice(end, end + suffix.length) === suffix) {
      source.setRangeText(selected, start - prefix.length, end + suffix.length, 'select');
      finishMarkdownFormatting(start - prefix.length, end - prefix.length);
      return;
    }

    // Also unwrap when the markers themselves are part of the selection.
    if (selected.startsWith(prefix) && selected.endsWith(suffix) &&
        selected.length >= prefix.length + suffix.length) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length);
      source.setRangeText(inner, start, end, 'select');
      finishMarkdownFormatting(start, start + inner.length);
      return;
    }

    const inner = selected || placeholder;
    const replacement = prefix + inner + suffix;
    source.setRangeText(replacement, start, end, 'select');
    const innerStart = start + prefix.length;
    finishMarkdownFormatting(innerStart, innerStart + inner.length);
  }

  function markdownSelectedLineRange() {
    const source = el.markdownSource;
    const value = source.value;
    const selectionStart = source.selectionStart;
    const selectionEnd = source.selectionEnd;
    const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    let effectiveEnd = selectionEnd;
    if (effectiveEnd > start && value[effectiveEnd - 1] === '\n') effectiveEnd--;
    const nextBreak = value.indexOf('\n', effectiveEnd);
    const end = nextBreak === -1 ? value.length : nextBreak;
    return { start, end, text: value.slice(start, end) };
  }

  function markdownTransformLines(kind, headingLevel = 1) {
    if (!isMarkdownEditing()) return;
    const source = el.markdownSource;
    const range = markdownSelectedLineRange();
    let lines = range.text.split('\n');
    const meaningful = lines.filter(line => line.trim());

    if (kind === 'heading') {
      const marker = '#'.repeat(Math.max(1, Math.min(6, headingLevel))) + ' ';
      lines = lines.map(line => {
        if (!line.trim()) return marker;
        return marker + line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s+/, '');
      });
    } else if (kind === 'blockquote') {
      const allQuoted = meaningful.length > 0 && meaningful.every(line => /^\s*>\s?/.test(line));
      lines = lines.map(line => {
        if (!line.trim()) return line;
        return allQuoted ? line.replace(/^(\s*)>\s?/, '$1') : line.replace(/^(\s*)/, '$1> ');
      });
    } else if (kind === 'unordered') {
      const allListed = meaningful.length > 0 && meaningful.every(line => /^\s*[-+*]\s+/.test(line));
      lines = lines.map(line => {
        if (!line.trim()) return line;
        if (allListed) return line.replace(/^(\s*)[-+*]\s+/, '$1');
        return line.replace(/^(\s*)(?:[-+*]|\d+[.)])\s+/, '$1').replace(/^(\s*)/, '$1- ');
      });
    } else if (kind === 'ordered') {
      const allListed = meaningful.length > 0 && meaningful.every(line => /^\s*\d+[.)]\s+/.test(line));
      let number = 1;
      lines = lines.map(line => {
        if (!line.trim()) return line;
        if (allListed) return line.replace(/^(\s*)\d+[.)]\s+/, '$1');
        const match = line.match(/^(\s*)(?:[-+*]|\d+[.)])?\s*(.*)$/);
        return `${match?.[1] || ''}${number++}. ${match?.[2] || line.trim()}`;
      });
    } else if (kind === 'indent') {
      lines = lines.map(line => line ? '    ' + line : line);
    } else if (kind === 'outdent') {
      lines = lines.map(line => line.replace(/^(?:\t| {1,4})/, ''));
    }

    const replacement = lines.join('\n');
    source.setRangeText(replacement, range.start, range.end, 'select');
    finishMarkdownFormatting(range.start, range.start + replacement.length);
  }

  function markdownInsertLink() {
    if (!isMarkdownEditing()) return;
    const source = el.markdownSource;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const selected = source.value.slice(start, end);
    const label = selected || 'link text';
    const replacement = `[${label}](https://)`;
    source.setRangeText(replacement, start, end, 'select');
    if (selected) {
      const urlStart = start + label.length + 3;
      finishMarkdownFormatting(urlStart, urlStart + 8);
    } else {
      finishMarkdownFormatting(start + 1, start + 1 + label.length);
    }
  }

  function markdownInsertCodeBlock() {
    if (!isMarkdownEditing()) return;
    const source = el.markdownSource;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const selected = source.value.slice(start, end);
    const inner = selected || 'code';
    const replacement = `\`\`\`\n${inner}\n\`\`\``;
    source.setRangeText(replacement, start, end, 'select');
    finishMarkdownFormatting(start + 4, start + 4 + inner.length);
  }

  function markdownInsertHorizontalRule() {
    if (!isMarkdownEditing()) return;
    const source = el.markdownSource;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const before = source.value.slice(0, start);
    const after = source.value.slice(end);
    const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const suffix = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
    const replacement = `${prefix}---${suffix}`;
    source.setRangeText(replacement, start, end, 'end');
    const caret = start + replacement.length;
    finishMarkdownFormatting(caret, caret);
  }

  function runBold() {
    if (isMarkdownEditing()) markdownWrapSelection('**', '**', 'bold text');
    else if (!isMarkdownTab()) exec('bold', true);
  }

  function runItalic() {
    if (isMarkdownEditing()) markdownWrapSelection('*', '*', 'italic text');
    else if (!isMarkdownTab()) exec('italic', true);
  }

  function runUnorderedList() {
    if (isMarkdownEditing()) markdownTransformLines('unordered');
    else if (!isMarkdownTab()) exec('insertUnorderedList', true);
  }

  function runOrderedList() {
    if (isMarkdownEditing()) markdownTransformLines('ordered');
    else if (!isMarkdownTab()) exec('insertOrderedList', true);
  }

  function runIndent() {
    if (isMarkdownEditing()) markdownTransformLines('indent');
    else if (!isMarkdownTab()) exec('indent', true);
  }

  function runOutdent() {
    if (isMarkdownEditing()) markdownTransformLines('outdent');
    else if (!isMarkdownTab()) exec('outdent', true);
  }

  function syncMarkdownFormattingUi() {
    const editing = isMarkdownEditing();
    el.markdownToolsWrap.hidden = !editing;
    document.body.classList.toggle('markdown-preview-active', isMarkdownTab() && !editing);
    if (isMarkdownTab()) {
      el.boldBtn.title = 'Markdown Bold — **text** (Ctrl+B)';
      el.italicBtn.title = 'Markdown Italic — *text* (Ctrl+I)';
      el.unorderedListBtn.title = 'Markdown bulleted list';
      el.orderedListBtn.title = 'Markdown numbered list';
      el.indentBtn.title = 'Indent Markdown line(s)';
      el.outdentBtn.title = 'Outdent Markdown line(s)';
    } else {
      el.boldBtn.title = 'Bold (Ctrl+B)';
      el.italicBtn.title = 'Italic (Ctrl+I)';
      el.unorderedListBtn.title = 'Bulleted list (Ctrl+Shift+8)';
      el.orderedListBtn.title = 'Numbered list (Ctrl+Shift+7)';
      el.indentBtn.title = 'Indent (Tab in editor)';
      el.outdentBtn.title = 'Outdent (Shift+Tab in editor)';
    }
  }

  function setMarkdownMode(mode, { focus = true } = {}) {
    const tab = currentTab();
    if (!isMarkdownTab(tab)) return;
    tab.markdownMode = mode === 'preview' ? 'preview' : 'edit';
    const previewing = tab.markdownMode === 'preview';
    el.markdownSource.hidden = previewing;
    el.markdownPreview.hidden = !previewing;
    el.markdownEditBtn.classList.toggle('active', !previewing);
    el.markdownPreviewBtn.classList.toggle('active', previewing);
    syncMarkdownFormattingUi();
    if (previewing) {
      el.markdownPreview.innerHTML = renderMarkdown(el.markdownSource.value);
      el.markdownPreview.scrollTop = 0;
    } else if (focus) setTimeout(() => el.markdownSource.focus(), 0);
    syncLineNumberVisibility();
    persistSessionSoon();
  }

  function syncDocumentSurface(tab = currentTab()) {
    const markdown = isMarkdownTab(tab);
    const plain = isPlainTab(tab);
    const sourceDocument = markdown || plain;
    document.body.classList.toggle('markdown-active', markdown);
    document.body.classList.toggle('plain-active', plain);
    if (!markdown) document.body.classList.remove('markdown-preview-active');
    el.markdownModeToggle.hidden = !markdown;
    el.editor.hidden = sourceDocument;
    el.ruler.closest('.top-ruler-row').hidden = sourceDocument;
    el.verticalRuler.closest('.vertical-ruler-wrap').hidden = sourceDocument;

    if (sourceDocument) {
      el.markdownSource.value = tab?.content || '';
      el.markdownSource.spellcheck = settings.spellcheck;
      if (markdown) {
        setMarkdownMode(tab?.markdownMode || 'edit', { focus:false });
      } else {
        el.markdownSource.hidden = false;
        el.markdownPreview.hidden = true;
      }
    } else {
      el.markdownSource.hidden = true;
      el.markdownPreview.hidden = true;
    }
    syncMarkdownFormattingUi();
    syncLineNumberVisibility();
    updateLineNumbers();
  }

  function exportSelectedMarkdown() {
    const file = selectedRealFile();
    if (!file) return toast('Select a file first.');
    if (file.protected && !protectedSessions.has(file.fileId || file.id)) return toast('Unlock the protected file before exporting it.');
    if (file.docType !== 'markdown') return toast('The selected file is not a Markdown document.');
    downloadBlob(safeDiskName(file.name, '.md'), file.content || '', 'text/markdown;charset=utf-8');
  }

 function captureEditorIntoActive() {
    const tab = currentTab();
    if (!tab) return;
    if (isSourceTab(tab)) {
      tab.content = el.markdownSource.value;
      tab.scrollTop = isMarkdownTab(tab) && tab.markdownMode === 'preview'
        ? el.markdownPreview.scrollTop
        : el.markdownSource.scrollTop;
      tab.selection = { start: el.markdownSource.selectionStart, end: el.markdownSource.selectionEnd };
      return;
    }
    if(settings.autoLinks)linkifyEditorPreservingSelection(false);else unlinkAutoLinks(false);
    tab.content=serializedEditorHtml();tab.scrollTop=el.editor.scrollTop;tab.selection=selectionTextOffsets();
  }

  let sessionTimer=null;
  function persistSessionSoon(){clearTimeout(sessionTimer);sessionTimer=setTimeout(persistSession,180);}
  function persistSession(){
    captureEditorIntoActive();
    const payload={
      activeTabId,
      split:{
        enabled:!!splitState.enabled,
        activeSide:splitState.activeSide,
        leftTabId:splitState.leftTabId,
        rightTabId:splitState.rightTabId,
        ratio:splitState.ratio
      },
      tabs:tabs.map(t=>({tabId:t.tabId,fileId:t.fileId||null,name:t.name,dirty:!!t.dirty,scrollTop:t.scrollTop||0,selection:t.selection||null,docType:t.protected?'protected':(t.docType||'rich'),markdownMode:t.markdownMode||'edit',protected:!!t.protected}))
    };
    localStorage.setItem(LS_SESSION,JSON.stringify(payload));
  }

  function restoreTabView(tab){
    syncDocumentSurface(tab);
    if (isSourceTab(tab)) {
      renderTabs(); updateCounts(); updateFormatState();
      requestAnimationFrame(() => {
        if (isMarkdownTab(tab) && tab.markdownMode === 'preview') {
          el.markdownPreview.scrollTop = tab?.scrollTop || 0;
        } else {
          el.markdownSource.scrollTop = tab?.scrollTop || 0;
          if (tab?.selection && Number.isInteger(tab.selection.start)) {
            el.markdownSource.setSelectionRange(tab.selection.start, tab.selection.end ?? tab.selection.start);
          }
        }
      });
      return;
    }
    el.editor.innerHTML=tab?.content||'';hydrateAssetImages(el.editor, tab);if(settings.autoLinks)linkifyEditorPreservingSelection(false);else unlinkAutoLinks(false);
    applyDocumentLayout();renderTabs();updateCounts();updateFormatState();
    scheduleSpellcheck(0);
    requestAnimationFrame(()=>{el.editor.scrollTop=tab?.scrollTop||0;if(tab?.selection)restoreSelectionFromOffsets(tab.selection);});
  }

  function switchTab(tabId) {
    if (!tabs.some(tab => tab.tabId === tabId)) return;

    if (splitState.enabled) {
      const otherSide = otherSplitSide(splitState.activeSide);
      if (splitPaneTabId(otherSide) === tabId) {
        activateSplitSide(otherSide);
        return;
      }

      if (activeTabId === tabId) {
        const same = currentTab();
        if (same) {
          restoreTabView(same);
          saveRecoverySnapshot();
          focusActiveDocumentSurface();
        }
        return;
      }

      captureEditorIntoActive();
      setSplitPaneTabId(splitState.activeSide, tabId);
      activeTabId = tabId;
      restoreTabView(currentTab());
      if (!el.findBar.hidden) refreshFindMatches();
      saveRecoverySnapshot();
      persistSessionSoon();
      focusActiveDocumentSurface();
      return;
    }

    if (activeTabId === tabId) {
      const same = currentTab();
      if (same) {
        restoreTabView(same);
        saveRecoverySnapshot();
      }
      return;
    }

    captureEditorIntoActive();
    activeTabId = tabId;
    const tab = currentTab();
    restoreTabView(tab);
    saveRecoverySnapshot();
    persistSessionSoon();
    focusActiveDocumentSurface();
  }

  function openTabContextMenu(tabId,x,y){
    tabContextId=tabId;const menu=document.getElementById('tabContextMenu'),idx=tabs.findIndex(t=>t.tabId===tabId),tab=tabs[idx];
    document.getElementById('tabCloseOthersCtx').disabled=tabs.length<2;
    document.getElementById('tabCloseRightCtx').disabled=idx<0||idx===tabs.length-1;
    document.getElementById('tabReopenCtx').disabled=!closedTabs.length;
    const saved=!!tab?.fileId, protectedTab=!!tab?.protected;
    document.getElementById('tabDuplicateCtx').hidden=protectedTab;
    document.getElementById('tabProtectionSep').hidden=!saved;
    document.getElementById('tabProtectCtx').hidden=!saved || protectedTab;
    document.getElementById('tabLockCloseCtx').hidden=!protectedTab;
    document.getElementById('tabChangePasswordCtx').hidden=!protectedTab;
    document.getElementById('tabRecoveryKeyCtx').hidden=!protectedTab;
    document.getElementById('tabRegenerateRecoveryCtx').hidden=!protectedTab;
    document.getElementById('tabRemoveProtectionCtx').hidden=!protectedTab;
    menu.hidden=false;menu.style.left=`${x}px`;menu.style.top=`${y}px`;
    requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();menu.style.left=`${Math.max(6,Math.min(x,innerWidth-r.width-6))}px`;menu.style.top=`${Math.max(6,Math.min(y,innerHeight-r.height-6))}px`;});
  }
  function closeTabContextMenu(){document.getElementById('tabContextMenu').hidden=true;tabContextId=null;}

  function renderAllTabsMenu() {
    const menu = $('allTabsMenu');
    menu.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = tab.tabId === activeTabId ? 'active' : '';
      const paneSide = splitTabSide(tab.tabId);
      button.textContent = `${tab.dirty ? '● ' : ''}${tab.protected ? '🔓 ' : ''}${tab.name}${paneSide ? `  [${paneSide === 'left' ? 'L' : 'R'}]` : ''}`;
      button.addEventListener('click', () => {
        menu.hidden = true;
        handleSplitTabClick(tab.tabId);
      });
      fragment.appendChild(button);
    }

    if (closedTabs.length) {
      const separator = document.createElement('div');
      separator.className = 'context-sep';
      fragment.appendChild(separator);

      const reopenButton = document.createElement('button');
      reopenButton.textContent = 'Reopen Closed Tab';
      reopenButton.addEventListener('click', () => {
        menu.hidden = true;
        reopenClosedTab();
      });
      fragment.appendChild(reopenButton);
    }

    menu.appendChild(fragment);
  }
  function toggleAllTabsMenu(){
    const menu=document.getElementById('allTabsMenu');if(!menu.hidden){menu.hidden=true;return;}renderAllTabsMenu();
    const r=el.allTabsBtn.getBoundingClientRect();menu.hidden=false;const mr=menu.getBoundingClientRect();menu.style.left=`${Math.max(6,r.right-mr.width)}px`;menu.style.top=`${r.bottom+3}px`;
  }

  function renderTabs() {
    el.tabsbar.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const tab of tabs) {
      const node = document.createElement('div');
      node.className =
        'tab' +
        (tab.tabId === activeTabId ? ' active' : '') +
        (tab.dirty ? ' dirty' : '');
      node.title = tab.fileId ? tab.name : `${tab.name} (unsaved)`;
      node.dataset.tabId = tab.tabId;
      node.draggable = true;
      node.addEventListener('dragstart', event => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-notepad-tab', tab.tabId);
        event.dataTransfer.setData('text/plain', tab.name);
        node.classList.add('dragging');
      });
      node.addEventListener('dragend', () => {
        node.classList.remove('dragging');
        clearSplitTabDropUi();
      });

      const dirtyDot = document.createElement('span');
      dirtyDot.className = 'dirty-dot';

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = `${tab.protected ? '🔓 ' : ''}${tab.name}`;
      const badge=document.createElement('span');badge.className='doc-type-badge';badge.textContent=documentTypeLabel(tab.docType||'rich');title.appendChild(badge);

      const closeButton = document.createElement('button');
      closeButton.className = 'tab-close';
      closeButton.textContent = '×';
      closeButton.title = 'Close tab';
      closeButton.addEventListener('click', event => {
        event.stopPropagation();
        closeTab(tab.tabId);
      });

      const paneSide = splitTabSide(tab.tabId);
      const sideBadge = document.createElement('span');
      sideBadge.className = 'split-tab-side';
      sideBadge.textContent = paneSide === 'left' ? 'L' : paneSide === 'right' ? 'R' : '';
      sideBadge.hidden = !paneSide;

      node.append(dirtyDot, title, sideBadge, closeButton);
      node.addEventListener('click', () => handleSplitTabClick(tab.tabId));
      node.addEventListener('auxclick', event => {
        if (event.button === 1) {
          event.preventDefault();
          closeTab(tab.tabId);
        }
      });
      node.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        openTabContextMenu(tab.tabId, event.clientX, event.clientY);
      });
      fragment.appendChild(node);
    }

    el.tabsbar.appendChild(fragment);
    el.tabsbar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateSplitUi();
  }

  function rememberClosedTab(tab) {
    captureEditorIntoActive();
    if (tab.protected) {
      closedTabs.unshift({
        fileId: tab.fileId || null,
        name: tab.name,
        content: '',
        dirty: false,
        createdAt: tab.createdAt,
        updatedAt: tab.updatedAt,
        parentId: tab.parentId || null,
        layout: null,
        scrollTop: 0,
        selection: null,
        docType:'protected',
        markdownMode:'edit',
        protected:true
      });
    } else {
      closedTabs.unshift({
        fileId: tab.fileId || null,
        name: tab.name,
        content: tab.content || '',
        dirty: !!tab.dirty,
        createdAt: tab.createdAt,
        updatedAt: tab.updatedAt,
        parentId: tab.parentId || null,
        layout: tab.layout,
        scrollTop: tab.scrollTop || 0,
        selection: tab.selection || null,
        docType:tab.docType||'rich',
        markdownMode:tab.markdownMode||'edit'
      });
    }
    closedTabs = closedTabs.slice(0, 10);
    writeJsonStorage(LS_CLOSED_TABS, closedTabs);
  }
  async function closeTab(tabId,{skipPrompt=false,remember=true}={}) {
    const tab = tabs.find(t => t.tabId === tabId);
    if (!tab) return false;
    if (tab.dirty && !skipPrompt &&
        !(await appConfirm(`Close “${tab.name}” without saving the latest changes?`,
          {title:'Unsaved Changes',confirmText:'Close Without Saving',danger:true}))) return false;

    if (remember) rememberClosedTab(tab);
    const idx = tabs.findIndex(t => t.tabId === tabId);

    if (splitState.enabled) {
      const closedSide = splitTabSide(tabId);
      const wasActive = activeTabId === tabId;
      if (wasActive) captureEditorIntoActive();

      tabs.splice(idx, 1);
      if (closedSide) setSplitPaneTabId(closedSide, null);

      if (wasActive) {
        const otherSide = closedSide ? otherSplitSide(closedSide) : splitState.activeSide;
        const otherId = splitPaneTabId(otherSide);
        if (otherId && tabs.some(t => t.tabId === otherId)) {
          splitState.activeSide = otherSide;
          activeTabId = otherId;
          updateSplitUi();
          restoreTabView(currentTab());
          focusActiveDocumentSurface();
        } else {
          // Both panes are allowed to remain empty even when other, unassigned
          // tabs still exist in the tab bar.
          activeTabId = null;
          if (closedSide) splitState.activeSide = closedSide;
          renderTabs();
        }
      } else {
        renderTabs();
      }

      if (tab.protected && tab.fileId) {
        clearProtectedSession(tab.fileId);
        renderFiles();
      }
      persistUnsavedDrafts();
      persistSessionSoon();
      await saveRecoverySnapshot();
      return true;
    }

    tabs.splice(idx,1);
    if(activeTabId===tabId){
      const next=tabs[Math.min(idx,tabs.length-1)]||tabs[tabs.length-1];
      activeTabId=next?.tabId||null;
      if(next) restoreTabView(next);
      else newTab();
    } else renderTabs();
    if (tab.protected && tab.fileId) {
      clearProtectedSession(tab.fileId);
      renderFiles();
    }
    persistUnsavedDrafts();
    persistSessionSoon();
    await saveRecoverySnapshot();
    return true;
  }
  async function closeOtherTabs(keepId){
    const others=tabs.filter(t=>t.tabId!==keepId);
    if(others.some(t=>t.dirty)&&!(await appConfirm(`Close ${others.length} other tab${others.length===1?'':'s'}? Unsaved changes in those tabs will be discarded.`,{title:'Unsaved Changes',confirmText:'Close Tabs',danger:true})))return;
    others.forEach(t=>rememberClosedTab(t));
    others.filter(t=>t.protected&&t.fileId).forEach(t=>clearProtectedSession(t.fileId));
    if(others.some(t=>t.protected))renderFiles();
    const closedIds=new Set(others.map(t=>t.tabId));
    tabs=tabs.filter(t=>t.tabId===keepId);

    if(splitState.enabled){
      if(closedIds.has(splitState.leftTabId)) splitState.leftTabId=null;
      if(closedIds.has(splitState.rightTabId)) splitState.rightTabId=null;
      if(splitTabSide(keepId)){
        activeTabId=keepId;
        splitState.activeSide=splitTabSide(keepId);
        restoreTabView(currentTab());
      }else{
        activeTabId=null;
        renderTabs();
      }
    }else{
      activeTabId=keepId;
      restoreTabView(currentTab());
    }
    persistUnsavedDrafts();persistSessionSoon();
    await saveRecoverySnapshot();
  }

  async function closeTabsToRight(id){
    const idx=tabs.findIndex(t=>t.tabId===id),targets=tabs.slice(idx+1);if(!targets.length)return;
    if(targets.some(t=>t.dirty)&&!(await appConfirm(`Close ${targets.length} tab${targets.length===1?'':'s'} to the right? Unsaved changes will be discarded.`,{title:'Unsaved Changes',confirmText:'Close Tabs',danger:true})))return;
    targets.forEach(t=>rememberClosedTab(t));
    targets.filter(t=>t.protected&&t.fileId).forEach(t=>clearProtectedSession(t.fileId));
    if(targets.some(t=>t.protected))renderFiles();
    const closedIds=new Set(targets.map(t=>t.tabId));
    tabs=tabs.slice(0,idx+1);

    if(splitState.enabled){
      if(closedIds.has(splitState.leftTabId)) splitState.leftTabId=null;
      if(closedIds.has(splitState.rightTabId)) splitState.rightTabId=null;
      reconcileSplitState();
      if(currentTab()) restoreTabView(currentTab()); else renderTabs();
    }else if(!tabs.some(t=>t.tabId===activeTabId)){
      activeTabId=id;restoreTabView(currentTab());
    }else renderTabs();
    persistUnsavedDrafts();persistSessionSoon();
    await saveRecoverySnapshot();
  }
  function duplicateTabAsDraft(id){
    captureEditorIntoActive();const src=tabs.find(t=>t.tabId===id);if(!src)return;
    if(src.protected)return toast('Use Save As to create another protected copy.');
    const base=src.name.replace(/\s+—\s+Copy(?: \d+)?$/,'');let name=`${base} — Copy`,n=2;while(tabs.some(t=>t.name===name))name=`${base} — Copy ${n++}`;
    newTab(src.content,{name,dirty:true,layout:typeof structuredClone==='function'?structuredClone(src.layout):JSON.parse(JSON.stringify(src.layout)),scrollTop:src.scrollTop||0,selection:src.selection,docType:src.docType||'rich',markdownMode:src.markdownMode||'edit'});
    status('Created independent unsaved copy.');
  }
  async function reopenClosedTab(){
    const c=closedTabs.shift();if(!c)return toast('No recently closed tab.');
    localStorage.setItem(LS_CLOSED_TABS,JSON.stringify(closedTabs));
    if(c.fileId){
      const f=await idbGet(c.fileId);
      if(f && isProtectedRecord(f)){
        await openFile(f.id);
        return;
      }
      if(f&&!c.dirty){const type=f.docType||c.docType||'rich';newTab(f.content||'',{fileId:f.id,name:f.name,dirty:false,createdAt:f.createdAt,updatedAt:f.updatedAt,parentId:f.parentId||null,layout:f.layout||c.layout,scrollTop:c.scrollTop,selection:c.selection,docType:type,markdownMode:type==='markdown'?'preview':'edit'});return;}
    }
    newTab(c.content||'',{name:c.fileId?`${c.name} — Recovered`:c.name,dirty:true,layout:c.layout,scrollTop:c.scrollTop,selection:c.selection,docType:c.docType||'rich',markdownMode:c.markdownMode||'edit'});
  }

  function isVisuallyEmptyHtml(html = '') {
    const probe = document.createElement('div');
    probe.innerHTML = html;
    const text = (probe.textContent || '').replace(/\u00a0/g, ' ').trim();
    const hasMeaningfulEmbeddedContent = !!probe.querySelector('img,table,hr,iframe,video,audio,canvas,svg,input,textarea,select');
    return !text && !hasMeaningfulEmbeddedContent;
  }

  function closeEmptyDefaultUntitledBeforeOpen() {
    captureEditorIntoActive();
    const tab = currentTab();
    if (!tab) return;
    if (tab.fileId || tab.name !== 'Untitled' || tab.dirty || !isVisuallyEmptyHtml(tab.content)) return;

    tabs = tabs.filter(t => t.tabId !== tab.tabId);
    activeTabId = null;
    persistUnsavedDrafts();
  }

  async function getOrCreateTabForSavedFile(fileId) {
    const candidate = files.find(file => file.id === fileId);
    if (!candidate || candidate.type === 'folder') return null;

    addRecent(fileId);
    const already = tabs.find(tab => tab.fileId === fileId);
    if (already) return already;

    const file = await idbGet(fileId);
    if (!file) {
      toast('File not found.');
      await refreshFiles();
      return null;
    }

    let content=file.content||'', docType=file.docType||'rich',
      layout=file.layout||{left:0,first:0,right:0,tabs:[48]}, protectedTab=false;

    if (isProtectedRecord(file)) {
      const unlocked = await unlockProtectedFileRecord(file);
      if (!unlocked) return null;
      content = unlocked.payload.content || '';
      docType = unlocked.payload.docType || 'rich';
      layout = unlocked.payload.layout || {left:0,first:0,right:0,tabs:[48]};
      protectedTab = true;
    }

    const tab = {
      tabId: uid(),
      fileId: file.id,
      name: file.name,
      content,
      dirty: false,
      isNew: false,
      createdAt: file.createdAt || new Date().toISOString(),
      updatedAt: file.updatedAt || new Date().toISOString(),
      parentId: file.parentId || null,
      layout,
      scrollTop: 0,
      selection: null,
      docType,
      markdownMode: docType === 'markdown' ? 'preview' : 'edit',
      protected: protectedTab
    };
    tabs.push(tab);
    await refreshFiles();
    return tab;
  }

  async function openFileFromFilesDoubleClick(fileId) {
    const file = files.find(item => item.id === fileId);
    if (!file || file.type === 'folder') return;

    if (!splitState.enabled) {
      await openFile(fileId);
      return;
    }

    // If this file is already displayed, double-click simply brings that pane
    // to the foreground rather than asking the user to replace anything.
    const existingTab = tabs.find(tab => tab.fileId === fileId);
    const existingSide = existingTab ? splitTabSide(existingTab.tabId) : '';
    if (existingSide) {
      activateSplitSide(existingSide);
      status(`${file.name} is already open in ${existingSide === 'left' ? 'Left' : 'Right'} View.`);
      return;
    }

    const leftTab = tabs.find(tab => tab.tabId === splitState.leftTabId) || null;
    const rightTab = tabs.find(tab => tab.tabId === splitState.rightTabId) || null;

    // Files double-click always prefers Left, then Right.
    if (!leftTab) {
      await openFileInSplitSide(fileId, 'left');
      return;
    }
    if (!rightTab) {
      await openFileInSplitSide(fileId, 'right');
      return;
    }

    const side = await chooseSplitOverride(file.name, leftTab.name, rightTab.name);
    if (!side) return;
    await openFileInSplitSide(fileId, side);
  }

  async function openFileInSplitSide(fileId, side) {
    if (side !== 'left' && side !== 'right') return;
    if (!splitState.enabled && window.matchMedia?.('(max-width: 900px)').matches) {
      toast('Split View is available on wider desktop windows.');
      return;
    }

    const tab = await getOrCreateTabForSavedFile(fileId);
    if (!tab) return;

    if (!splitState.enabled) {
      // Match normal Split View startup: the current active document starts on
      // the left, the right starts empty, then the requested file is assigned
      // to the side chosen from the Files context menu.
      enableSplitView();
      if (!splitState.enabled) return;
    }

    assignTabToSplitSide(tab.tabId, side);
    renderTabs();
    persistSessionSoon();
  }

  async function openFile(fileId) {
    const candidate=files.find(f=>f.id===fileId); if(candidate?.type==='folder') return;
    addRecent(fileId);

    const already = tabs.find(t => t.fileId === fileId);
    if (already) {
      switchTab(already.tabId);
      return;
    }

    const file = await idbGet(fileId);
    if (!file) {
      toast('File not found.');
      await refreshFiles();
      if (!tabs.length) newTab('', { name: 'Untitled', dirty: false });
      return;
    }

    let content=file.content||'', docType=file.docType||'rich',
      layout=file.layout||{left:0,first:0,right:0,tabs:[48]}, protectedTab=false;

    if (isProtectedRecord(file)) {
      const unlocked = await unlockProtectedFileRecord(file);
      if (!unlocked) return;
      content = unlocked.payload.content || '';
      docType = unlocked.payload.docType || 'rich';
      layout = unlocked.payload.layout || {left:0,first:0,right:0,tabs:[48]};
      protectedTab = true;
    }

    closeEmptyDefaultUntitledBeforeOpen();
    newTab(content, {
      fileId: file.id,
      name: file.name,
      dirty: false,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      parentId:file.parentId||null,
      docType,
      protected:protectedTab,
      markdownMode:docType==='markdown' ? 'preview' : 'edit',
      layout
    });
    await refreshFiles();
    status(`${protectedTab ? 'Unlocked and opened' : 'Opened'} ${file.name}.`);
    if (window.matchMedia?.('(max-width: 760px)').matches) setFilesDrawer(false);
  }
