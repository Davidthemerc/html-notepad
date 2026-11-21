  // ===========================================================================
  // EDITOR CONTEXT MENU, CLIPBOARD & PRINTING
  // ===========================================================================

  function openEditorContextMenu(x,y) {
    rememberEditorSelection();
    const menu=document.getElementById('editorContextMenu');
    const sel=getSelection(), hasSelection=!!(sel&&!sel.isCollapsed&&selectionInsideEditor());
    document.getElementById('editorCutCtx').disabled=!hasSelection;
    document.getElementById('editorCopyCtx').disabled=!hasSelection;
    document.getElementById('editorClearFormatCtx').disabled=!hasSelection;
    menu.hidden=false; menu.style.left=`${x}px`; menu.style.top=`${y}px`;
    requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();menu.style.left=`${Math.max(6,Math.min(x,innerWidth-r.width-6))}px`;menu.style.top=`${Math.max(6,Math.min(y,innerHeight-r.height-6))}px`;});
  }
  function closeEditorContextMenu(){
    document.getElementById('editorContextMenu').hidden=true;
    activeSpellTarget=null;
    if (el.spellContextSection) el.spellContextSection.hidden=true;
  }

  const NOTEPAD_RICH_CLIPBOARD_MARKER = '<!--HTML-NOTEPAD-RICH-CLIPBOARD-->';
  let lastNotepadRichClipboard = null;

  function selectionCoversEntireRichEditor(range) {
    if(!range || !el.editor) return false;
    const whole=document.createRange();
    whole.selectNodeContents(el.editor);
    try {
      return range.compareBoundaryPoints(Range.START_TO_START,whole)===0 &&
        range.compareBoundaryPoints(Range.END_TO_END,whole)===0;
    } catch {
      return false;
    }
  }

  function richSelectionClipboardPayload() {
    const sel=getSelection();
    if(!sel || sel.isCollapsed || !selectionInsideEditor()) return null;
    const range=sel.getRangeAt(0);

    // Select All is special: cloning a Range that spans a contenteditable root can
    // make Chromium synthesize boundary wrappers. Serialize the editor itself so
    // its first and last lines are neither invented nor lost.
    if(selectionCoversEntireRichEditor(range)) {
      return {
        text:richTextLogicalText(el.editor),
        html:el.editor.innerHTML,
        wholeDocument:true
      };
    }

    const fragment=range.cloneContents();
    const holder=document.createElement('div');
    holder.appendChild(fragment);
    return {
      text:richTextLogicalText(holder),
      html:holder.innerHTML,
      wholeDocument:false
    };
  }

  function writeRichClipboard(event,payload) {
    event.clipboardData.setData('text/plain',payload.text);
    if(payload.html){
      event.clipboardData.setData(
        'text/html',
        NOTEPAD_RICH_CLIPBOARD_MARKER + payload.html
      );
    }
    // Keep an in-memory fingerprint as the authoritative same-app signal.
    // Windows/Chromium may rewrite or discard clipboard metadata, but this
    // survives Copy/Cut -> Paste while this Notepad instance remains open.
    lastNotepadRichClipboard={
      text:payload.text,
      html:payload.html||'',
      wholeDocument:!!payload.wholeDocument,
      writtenAt:Date.now()
    };
  }

  function handleEditorCopy(event) {
    const payload=richSelectionClipboardPayload();
    if(!payload || !event.clipboardData) return;
    event.preventDefault();
    writeRichClipboard(event,payload);
  }

  function handleEditorCut(event) {
    const payload=richSelectionClipboardPayload();
    if(!payload || !event.clipboardData) return;
    event.preventDefault();
    writeRichClipboard(event,payload);

    if(payload.wholeDocument){
      // Chromium may turn an emptied contenteditable into <br>, <div><br></div>,
      // or multiple empty blocks after deleting a Select All range. Those nodes
      // later become visible blank lines when content is pasted back in.
      el.editor.replaceChildren();
      const sel=getSelection();
      const caret=document.createRange();
      caret.selectNodeContents(el.editor);
      caret.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(caret);
    }else{
      document.execCommand('delete');
    }

    markDirtyFromEditor();
    updateCounts();
  }

  async function clipboardWriteSelection() {
    const sel=getSelection(); if(!sel||sel.isCollapsed)return;
    try{await navigator.clipboard.writeText(sel.toString().replace(/\r\n?/g,'\n'));}
    catch{try{document.execCommand('copy');}catch{}}
  }
  // Toolbar Select All / Copy (easy on phones, where long-press selection is fiddly).
  function toolbarSelectAll() {
    if (!requireActiveDocument()) return;
    if (isMarkdownTab() && !isMarkdownEditing()) { getSelection().selectAllChildren(el.markdownPreview); return; }
    if (isSourceTab()) {
      el.markdownSource.focus({ preventScroll: true });
      el.markdownSource.setSelectionRange(0, el.markdownSource.value.length);
    } else {
      el.editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(el.editor);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    updateCounts();
  }

  // Copies the current selection; with nothing selected it copies the whole document and puts the
  // caret back where it was.
  async function toolbarCopy() {
    if (!requireActiveDocument()) return;
    const previewing = isMarkdownTab() && !isMarkdownEditing();
    const source = isSourceTab() && !previewing;
    let restore = null, copiedAll = false;
    const hasSelection = source
      ? el.markdownSource.selectionStart !== el.markdownSource.selectionEnd
      : (() => { const sel = getSelection(); return !!sel && !sel.isCollapsed && (previewing ? el.markdownPreview.contains(sel.anchorNode) : selectionInsideEditor()); })();
    if (!hasSelection) {
      copiedAll = true;
      if (source) restore = [el.markdownSource.selectionStart, el.markdownSource.selectionEnd];
      else if (!previewing && selectionInsideEditor()) restore = getSelection().getRangeAt(0).cloneRange();
      toolbarSelectAll();
    } else if (source) el.markdownSource.focus({ preventScroll: true });
    else if (!previewing) el.editor.focus({ preventScroll: true });
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    if (!ok) {
      try {
        const text = source ? el.markdownSource.value.slice(el.markdownSource.selectionStart, el.markdownSource.selectionEnd) : getSelection().toString();
        await navigator.clipboard.writeText(text.replace(/\r\n?/g, '\n')); ok = true;
      } catch {}
    }
    if (copiedAll) {
      if (source && restore) el.markdownSource.setSelectionRange(restore[0], restore[1]);
      else if (restore) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(restore); }
    }
    toast(ok ? (copiedAll ? 'Copied the whole document.' : 'Copied.') : 'Could not copy. Select the text and use the browser menu.');
  }

  async function editorCopy(){restoreEditorSelection();await clipboardWriteSelection();closeEditorContextMenu();}
  async function editorCut(){
    restoreEditorSelection(); const sel=getSelection(); if(!sel||sel.isCollapsed)return;
    try{await navigator.clipboard.writeText(sel.toString());document.execCommand('delete');}
    catch{try{document.execCommand('cut');}catch{}}
    markDirtyFromEditor();closeEditorContextMenu();
  }
  async function editorPaste(plain=false){
    restoreEditorSelection();el.editor.focus();
    try{
      const text=await navigator.clipboard.readText();
      document.execCommand('insertText',false,text);
      markDirtyFromEditor();
      if(!plain && settings.autoLinks) linkifyEditorPreservingSelection(true);
    }catch{
      toast('Browser clipboard permission blocked Paste. Use Ctrl+V'+(plain?' or Ctrl+Shift+V':'')+'.');
    }
    closeEditorContextMenu();
  }
  function editorSelectAll(){
    el.editor.focus();const range=document.createRange();range.selectNodeContents(el.editor);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);rememberEditorSelection();updateCounts();closeEditorContextMenu();
  }

  // Printing uses a dedicated surface outside #app. This prevents browser print CSS from
  // accidentally re-enabling toolbars, rulers, or the file drawer in the print preview.
  function printDocument() {
    if(!requireActiveDocument())return;
    captureEditorIntoActive();
    const surface=document.getElementById('printSurface');
    surface.innerHTML='';
    const doc=document.createElement('div');
    doc.className='print-document';
    // Markdown prints its rendered preview; rich-text documents print the live editor HTML.
    doc.innerHTML = isMarkdownTab() ? renderMarkdown(currentTab()?.content || el.markdownSource.value)
      : isPlainTab() ? `<pre style="white-space:pre-wrap;font:inherit">${escapeHtmlText(el.markdownSource.value)}</pre>`
      : el.editor.innerHTML;
    const cs=getComputedStyle(isSourceTab() ? el.markdownSource : el.editor);
    doc.style.fontFamily=cs.fontFamily;
    doc.style.fontSize=cs.fontSize;
    doc.style.lineHeight=cs.lineHeight;
    doc.style.textAlign=cs.textAlign;
    doc.style.tabSize=cs.tabSize;
    const tab=currentTab();
    if(tab?.layout){
      doc.style.paddingLeft=Math.max(0,tab.layout.left||0)+'px';
      doc.style.paddingRight=Math.max(0,tab.layout.right||0)+'px';
      doc.style.textIndent=(tab.layout.first||0)+'px';
    }
    surface.appendChild(doc);
    const cleanup=()=>{ surface.innerHTML=''; window.removeEventListener('afterprint',cleanup); };
    window.addEventListener('afterprint',cleanup);
    window.print();
  }

  function exec(command, markChange = false) {
    if (!requireActiveDocument()) return;
    el.editor.focus();
    try { document.execCommand(command, false, null); } catch {}
    if (markChange) markDirtyFromEditor();
    updateFormatState();
  }

  function updateFormatState() {
    if (isSourceTab()) return;
    const stateButtons = [
      [el.boldBtn, 'bold'], [el.italicBtn, 'italic'], [el.underlineBtn, 'underline'],
      [el.justifyLeftBtn, 'justifyLeft'], [el.justifyCenterBtn, 'justifyCenter'],
      [el.justifyRightBtn, 'justifyRight'],
      [el.unorderedListBtn, 'insertUnorderedList'], [el.orderedListBtn, 'insertOrderedList']
    ];
    try {
      for (const [button, command] of stateButtons) button.classList.toggle('active', document.queryCommandState(command));
    } catch {
      for (const [button] of stateButtons) button.classList.remove('active');
    }
    updateTypographyControls();
  }
