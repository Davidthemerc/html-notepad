  // ===========================================================================
  // EDITOR SELECTION & AUTO-LINKING
  // ===========================================================================

  function selectionInsideEditor() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    return !!node && (node === el.editor || el.editor.contains(node));
  }

  function rememberEditorSelection() {
    if (!selectionInsideEditor()) return;
    const sel = window.getSelection();
    savedEditorSelection = sel.getRangeAt(0).cloneRange();
  }

  function restoreEditorSelection() {
    if (!savedEditorSelection) return false;
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedEditorSelection);
      return true;
    } catch { return false; }
  }

  function selectionTextOffsets() {
    if (!selectionInsideEditor()) return null;
    const range = window.getSelection().getRangeAt(0);
    const a = document.createRange();
    a.selectNodeContents(el.editor);
    a.setEnd(range.startContainer, range.startOffset);
    const b = document.createRange();
    b.selectNodeContents(el.editor);
    b.setEnd(range.endContainer, range.endOffset);
    return { start: a.toString().length, end: b.toString().length };
  }

  function restoreSelectionFromOffsets(offsets) {
    if (!offsets) return;
    const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT);
    let node, count = 0, startNode = null, endNode = null, startOffset = 0, endOffset = 0;
    while ((node = walker.nextNode())) {
      const next = count + node.nodeValue.length;
      if (!startNode && offsets.start <= next) { startNode = node; startOffset = Math.max(0, offsets.start - count); }
      if (!endNode && offsets.end <= next) { endNode = node; endOffset = Math.max(0, offsets.end - count); break; }
      count = next;
    }
    if (!startNode) { startNode = el.editor; startOffset = el.editor.childNodes.length; }
    if (!endNode) { endNode = startNode; endOffset = startOffset; }
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } catch {}
  }

  function isClearWebUrl(token) {
    const trimmed = token.replace(/[.,;:!?]+$/g, '').replace(/[)\]}]+$/g, '');
    if (!/^(?:https?:\/\/|www\.)/i.test(trimmed)) return null;
    const href = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
    try {
      const u = new URL(href);
      if (!['http:','https:'].includes(u.protocol)) return null;
      const hostLooksValid = u.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.includes('.');
      return hostLooksValid ? { text: trimmed, href: u.href } : null;
    } catch { return null; }
  }

  function linkifyEditorPreservingSelection(markChange = true) {
    if (!settings.autoLinks) return false;
    const offsets = selectionTextOffsets();
    const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement?.closest('a')) continue;
      if (/(?:https?:\/\/|www\.)/i.test(n.nodeValue || '')) nodes.push(n);
    }
    let changed = false;
    const tokenRe = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    for (const textNode of nodes) {
      const text = textNode.nodeValue;
      let match, last = 0;
      const frag = document.createDocumentFragment();
      let localChanged = false;
      tokenRe.lastIndex = 0;
      while ((match = tokenRe.exec(text))) {
        const valid = isClearWebUrl(match[0]);
        if (!valid) continue;
        const prefix = text.slice(last, match.index);
        if (prefix) frag.appendChild(document.createTextNode(prefix));
        const a = document.createElement('a');
        a.href = valid.href; a.textContent = valid.text; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.autoLink = '1';
        a.title = `Open ${valid.href}`;
        frag.appendChild(a);
        const consumed = valid.text.length;
        const trailing = match[0].slice(consumed);
        if (trailing) frag.appendChild(document.createTextNode(trailing));
        last = match.index + match[0].length;
        localChanged = changed = true;
      }
      if (localChanged) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.replaceWith(frag);
      }
    }
    if (changed) {
      restoreSelectionFromOffsets(offsets);
      if (markChange) markDirtyFromEditor();
    }
    return changed;
  }

  function unlinkAutoLinks(markChange = true) {
    const links = [...el.editor.querySelectorAll('a[data-auto-link="1"]')];
    if (!links.length) return false;
    const offsets = selectionTextOffsets();
    for (const a of links) a.replaceWith(document.createTextNode(a.textContent || ''));
    el.editor.normalize();
    restoreSelectionFromOffsets(offsets);
    if (markChange) markDirtyFromEditor();
    return true;
  }

  function closeToolbarPopovers(except = null) {
    for (const [btn, menu] of [[el.colorPaletteBtn, el.colorPaletteMenu], [el.colorWheelBtn, el.colorWheelMenu], [el.colorHistoryBtn, el.colorHistoryMenu], [el.editToolsBtn, el.editToolsMenu]]) {
      if (menu === except) continue;
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleToolbarPopover(button, menu) {
    const opening = menu.hidden;
    closeToolbarPopovers(menu);
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function toggleMobileBar(bar, button) {
    const expanded = !bar.classList.contains('mobile-expanded');
    bar.classList.toggle('mobile-expanded', expanded);
    closeToolbarPopovers();
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.textContent = expanded ? '⌃' : '⌄';
    button.title = expanded ? 'Show fewer controls' : 'Show more controls';
    scheduleRulerBuild();
  }
