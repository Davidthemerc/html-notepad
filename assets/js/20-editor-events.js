  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  function handleEditorInput(event) {
    markDirtyFromEditor();
    updateLineNumbers();
    scheduleSpellcheck();
    if (!settings.autoLinks) return;

    // Auto-link only after a word boundary so typing a URL does not constantly rebuild DOM.
    const reachedBoundary =
      event.inputType === 'insertParagraph' ||
      event.inputType === 'insertLineBreak' ||
      (event.inputType === 'insertText' && /\s/.test(event.data || ''));
    if (reachedBoundary) {
      clearTimeout(linkifyTimer);
      linkifyTimer = setTimeout(() => linkifyEditorPreservingSelection(true), 0);
    }
  }

  function rememberActiveTabSelection() {
    const tab = currentTab();
    if (!tab) return;
    tab.selection = selectionTextOffsets();
    persistSessionSoon();
  }

  function normalizedClipboardHtmlForCompare(html) {
    const t=document.createElement('template');
    t.innerHTML=String(html||'').split(NOTEPAD_RICH_CLIPBOARD_MARKER).join('');
    // Clipboard implementations may add StartFragment/EndFragment comments.
    const walker=document.createTreeWalker(t.content,NodeFilter.SHOW_COMMENT);
    const comments=[];
    while(walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(node=>node.remove());
    return t.innerHTML.trim();
  }

  function isEmptyRichBoundaryNode(node) {
    if(!node) return false;
    if(node.nodeType===Node.TEXT_NODE) return !node.nodeValue?.replace(/\u00a0/g,' ').trim();
    if(node.nodeType!==Node.ELEMENT_NODE) return true;
    if(node.matches('img,hr')) return false;
    if(node.querySelector?.('img,hr')) return false;
    return !richTextLogicalText(node).replace(/\u00a0/g,' ').trim();
  }

  function boundaryBlankLineCounts(text) {
    const normalized=String(text||'').replace(/\r\n?/g,'\n');
    const leading=(normalized.match(/^\n+/)?.[0].length)||0;
    const trailing=(normalized.match(/\n+$/)?.[0].length)||0;
    return {leading,trailing};
  }

  function normalizeInternalRichBoundaries(html,plainText) {
    const t=document.createElement('template');
    t.innerHTML=html||'';
    const wanted=boundaryBlankLineCounts(plainText);

    // The clipboard's plain-text form is authoritative for the exact number of
    // boundary blank lines. Remove every empty HTML boundary node first; those
    // nodes are an alternate representation of the same newlines and retaining
    // both representations doubles intentional blank lines.
    while(t.content.firstChild && isEmptyRichBoundaryNode(t.content.firstChild)){
      t.content.firstChild.remove();
    }
    while(t.content.lastChild && isEmptyRichBoundaryNode(t.content.lastChild)){
      t.content.lastChild.remove();
    }

    // Recreate the requested boundary lines in one canonical representation.
    // A top-level DIV containing BR is one intentional blank editor line.
    const makeBlankLine=()=>{
      const div=document.createElement('div');
      div.appendChild(document.createElement('br'));
      return div;
    };
    for(let i=0;i<wanted.leading;i++){
      t.content.insertBefore(makeBlankLine(),t.content.firstChild);
    }
    for(let i=0;i<wanted.trailing;i++){
      t.content.appendChild(makeBlankLine());
    }
    return t.innerHTML;
  }

  function insertInternalRichClipboardHtml(html) {
    const sel=getSelection();
    if(!sel || !sel.rangeCount || !selectionInsideEditor()) return false;

    const template=document.createElement('template');
    template.innerHTML=html||'';
    const fragment=template.content;
    const inserted=[...fragment.childNodes];

    // Treat a visually empty Rich Text editor as truly empty. contenteditable
    // engines commonly retain <br> or empty DIV/P nodes after Cut/Delete; keeping
    // even one of them while inserting block HTML creates phantom lines.
    if(isVisuallyEmptyHtml(el.editor.innerHTML)){
      el.editor.replaceChildren();
      el.editor.appendChild(fragment);

      if(inserted.length){
        const after=document.createRange();
        after.setStartAfter(inserted[inserted.length-1]);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      }
      return true;
    }

    const range=sel.getRangeAt(0);

    // For a non-empty document, still replace an empty top-level host block when
    // the caret is inside one.
    if(range.collapsed){
      let node=range.startContainer.nodeType===Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      while(node && node.parentElement!==el.editor) node=node.parentElement;
      if(node && node.parentElement===el.editor){
        const logical=richTextLogicalText(node);
        const hasMeaningfulMedia=!!node.querySelector?.('img,hr');
        if(!logical && !hasMeaningfulMedia) range.selectNode(node);
      }
    }

    range.deleteContents();
    range.insertNode(fragment);

    if(inserted.length){
      const last=inserted[inserted.length-1];
      const after=document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    return true;
  }

  function handleEditorPaste(event) {
    const imageItem = [...(event.clipboardData?.items || [])]
      .find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItem) {
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (file) importImageFile(file);
      return;
    }

    const plainText = event.clipboardData?.getData('text/plain') ?? '';
    if (event.shiftKey) {
      event.preventDefault();
      document.execCommand('insertText', false, plainText);
      markDirtyFromEditor();
      updateCounts();
      return;
    }

    const richHtml = event.clipboardData?.getData('text/html');
    if (richHtml) {
      event.preventDefault();

      const markerInternal=richHtml.includes(NOTEPAD_RICH_CLIPBOARD_MARKER);
      const recent=lastNotepadRichClipboard &&
        (Date.now()-lastNotepadRichClipboard.writtenAt)<10*60*1000;
      const textMatches=recent &&
        String(plainText||'').replace(/\r\n?/g,'\n')===lastNotepadRichClipboard.text;
      const htmlMatches=recent &&
        normalizedClipboardHtmlForCompare(richHtml)===
          normalizedClipboardHtmlForCompare(lastNotepadRichClipboard.html);
      // Text equality is sufficient for the same live Notepad instance; HTML
      // equality strengthens the match when the OS has not rewritten markup.
      const internalRich=markerInternal || (textMatches && (htmlMatches || lastNotepadRichClipboard.wholeDocument));

      if(internalRich){
        const sourceHtml=markerInternal
          ? richHtml.split(NOTEPAD_RICH_CLIPBOARD_MARKER).join('')
          : (lastNotepadRichClipboard?.html || richHtml);
        const exactInternalHtml=normalizeInternalRichBoundaries(sourceHtml,plainText);

        if(!insertInternalRichClipboardHtml(exactInternalHtml)){
          el.editor.focus();
          const sel=getSelection();
          const caret=document.createRange();
          caret.selectNodeContents(el.editor);
          caret.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(caret);
          insertInternalRichClipboardHtml(exactInternalHtml);
        }
      }else{
        const cleanHtml=safePastedHtml(richHtml);
        document.execCommand('insertHTML',false,cleanHtml||plainText);
      }

      markDirtyFromEditor();
      if (settings.autoLinks) linkifyEditorPreservingSelection(true);
      updateCounts();
      return;
    }

    // Plain browser paste happens after this event. Defer synchronization until the DOM
    // contains the pasted text.
    setTimeout(() => {
      markDirtyFromEditor();
      if (settings.autoLinks) linkifyEditorPreservingSelection(true);
      updateCounts();
    }, 0);
  }
