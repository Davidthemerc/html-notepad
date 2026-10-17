  // ===========================================================================
  // OUTLINE PANEL (jump between headings)
  // ===========================================================================
  // Lists the headings of the active document (Heading 1-6 in rich text, # headings in
  // Markdown) like a Word navigation pane / table of contents. Clicking a row jumps there.

  const LS_OUTLINE_LEVELS = 'htmlNotepad.outlineLevels';
  let outlinePanel = null, outlineSignature = '', outlineTimer = null, outlineMaxLevel = 2;

  function outlineHeadings() {
    const tab = currentTab();
    if (!tab) return [];
    if (isSourceTab(tab)) {
      if (!isMarkdownTab(tab)) return [];
      const headings = [];
      let offset = 0, fenced = false;
      for (const line of el.markdownSource.value.split('\n')) {
        if (/^```/.test(line)) fenced = !fenced;
        const match = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (match) headings.push({ level: match[1].length, text: match[2], offset, index: headings.length });
        offset += line.length + 1;
      }
      return headings;
    }
    return [...el.editor.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((node, index) => ({ level: Number(node.tagName[1]), text: (node.textContent || '').replace(/\s+/g, ' ').trim(), node, index }))
      .filter(h => h.text);
  }

  function outlineJump(heading) {
    if (heading.node) {
      heading.node.scrollIntoView({ block: 'start' });
      const range = document.createRange();
      range.setStart(heading.node, 0); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      el.editor.focus({ preventScroll: true });
    } else if (currentTab()?.markdownMode === 'preview') {
      const target = el.markdownPreview.querySelectorAll('h1,h2,h3,h4,h5,h6')[heading.index];
      target?.scrollIntoView({ block: 'start' });
    } else {
      const area = el.markdownSource;
      area.focus({ preventScroll: true });
      area.setSelectionRange(heading.offset, heading.offset);
      area.scrollTop = Math.max(0, textareaOffsetTop(area, heading.offset) - 12);
    }
    if (window.matchMedia?.('(max-width: 760px)').matches) closeOutline();
  }

  function renderOutline(force = false) {
    if (!outlinePanel || outlinePanel.hidden) return;
    const tab = currentTab();
    const headings = outlineHeadings();
    const signature = `${tab?.tabId}|${outlineMaxLevel}|${tab?.markdownMode}|` + headings.map(h => `${h.level}:${h.text}`).join('\n');
    if (!force && signature === outlineSignature) return;
    outlineSignature = signature;
    const list = outlinePanel.querySelector('.outline-list');
    list.textContent = '';
    const shown = headings.filter(h => h.level <= outlineMaxLevel);
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = !tab ? 'No document open.'
        : (headings.length ? 'No headings at the selected levels.' : 'No headings found. Use Heading 1/2 styles (or # in Markdown) to build an outline.');
      list.appendChild(empty);
      return;
    }
    const base = Math.min(...shown.map(h => h.level));
    for (const heading of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `outline-item level-${heading.level}`;
      row.style.paddingLeft = `${10 + (heading.level - base) * 16}px`;
      row.textContent = heading.text;
      row.title = heading.text;
      row.addEventListener('click', () => outlineJump(heading));
      list.appendChild(row);
    }
  }

  function openOutline() {
    outlinePanel.hidden = false;
    el.outlineBtn.setAttribute('aria-pressed', 'true');
    renderOutline(true);
    clearInterval(outlineTimer);
    outlineTimer = setInterval(() => renderOutline(), 700);
  }

  function closeOutline() {
    if (!outlinePanel) return;
    outlinePanel.hidden = true;
    el.outlineBtn.setAttribute('aria-pressed', 'false');
    clearInterval(outlineTimer);
  }

  function toggleOutline() {
    if (outlinePanel.hidden) openOutline(); else closeOutline();
  }

  function setupOutlinePanel() {
    el.outlineBtn = document.getElementById('outlineBtn');
    try { outlineMaxLevel = Math.min(6, Math.max(1, Number(localStorage.getItem(LS_OUTLINE_LEVELS)) || 2)); } catch {}
    outlinePanel = document.createElement('aside');
    outlinePanel.id = 'outlinePanel';
    outlinePanel.className = 'outline-panel';
    outlinePanel.hidden = true;
    outlinePanel.setAttribute('aria-label', 'Document outline');
    outlinePanel.innerHTML = `
      <div class="outline-head">
        <strong>Outline</strong>
        <select class="outline-levels" aria-label="Heading levels shown">
          <option value="1">Heading 1</option>
          <option value="2">Headings 1–2</option>
          <option value="3">Headings 1–3</option>
          <option value="6">All headings</option>
        </select>
        <button type="button" class="outline-close" aria-label="Close outline" title="Close">×</button>
      </div>
      <div class="outline-list" role="list"></div>`;
    document.body.appendChild(outlinePanel);
    const select = outlinePanel.querySelector('.outline-levels');
    select.value = [1, 2, 3, 6].includes(outlineMaxLevel) ? String(outlineMaxLevel) : '2';
    select.addEventListener('change', () => {
      outlineMaxLevel = Number(select.value);
      try { localStorage.setItem(LS_OUTLINE_LEVELS, String(outlineMaxLevel)); } catch {}
      renderOutline(true);
    });
    outlinePanel.querySelector('.outline-close').addEventListener('click', closeOutline);
    el.outlineBtn.addEventListener('click', toggleOutline);
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        toggleOutline();
      }
    });
  }
