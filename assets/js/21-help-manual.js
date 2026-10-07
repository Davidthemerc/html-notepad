  // ===========================================================================
  // INTEGRATED HELP / USER MANUAL
  // ===========================================================================

  let manualInitialized = false;
  let manualCurrentSectionId = 'overview';

  function manualSections() {
    return [...document.querySelectorAll('#manualSectionStore > section')];
  }

  function initializeManual() {
    if (manualInitialized) return;
    manualInitialized = true;
    const fragment = document.createDocumentFragment();

    for (const section of manualSections()) {
      const id = section.dataset.manualId;
      const title = section.dataset.manualTitle;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.manualTarget = id;
      button.textContent = title;
      button.addEventListener('click', () => showManualSection(id, { focusContent:true }));
      fragment.appendChild(button);

      const option = document.createElement('option');
      option.value = id;
      option.textContent = title;
      el.manualSectionSelect.appendChild(option);
    }
    el.manualNav.appendChild(fragment);
  }

  function showManualSection(sectionId = 'overview', { focusContent=false } = {}) {
    initializeManual();
    const section = manualSections().find(item => item.dataset.manualId === sectionId) || manualSections()[0];
    if (!section) return;
    manualCurrentSectionId = section.dataset.manualId;
    el.manualContent.innerHTML = section.innerHTML;
    el.manualContent.scrollTop = 0;
    el.manualSectionSelect.value = manualCurrentSectionId;
    el.manualNav.querySelectorAll('[data-manual-target]').forEach(button => {
      button.classList.toggle('active', button.dataset.manualTarget === manualCurrentSectionId);
      button.setAttribute('aria-current', button.dataset.manualTarget === manualCurrentSectionId ? 'page' : 'false');
    });
    if (focusContent) el.manualContent.focus({preventScroll:true});
  }

  function filterManualSections() {
    initializeManual();
    const query = el.manualSearch.value.trim().toLowerCase();
    let matches = 0;
    let firstMatch = null;
    for (const button of el.manualNav.querySelectorAll('[data-manual-target]')) {
      const section = manualSections().find(item => item.dataset.manualId === button.dataset.manualTarget);
      const haystack = `${section?.dataset.manualTitle || ''} ${section?.textContent || ''}`.toLowerCase();
      const visible = !query || haystack.includes(query);
      button.hidden = !visible;
      if (visible) {
        matches++;
        if (!firstMatch) firstMatch = button.dataset.manualTarget;
      }
    }
    el.manualSearchStatus.textContent = query
      ? `${matches} section${matches === 1 ? '' : 's'}`
      : '';
    if (query && firstMatch) showManualSection(firstMatch);
  }

  function openManual(sectionId = 'overview') {
    initializeManual();
    el.helpMenu.hidden = true;
    el.helpBtn.setAttribute('aria-expanded','false');
    el.manualSearch.value = '';
    el.manualSearchStatus.textContent = '';
    el.manualNav.querySelectorAll('[data-manual-target]').forEach(button => button.hidden = false);
    showManualSection(sectionId);
    if (!el.manualDialog.open) el.manualDialog.showModal();
    setTimeout(() => el.manualContent.focus({preventScroll:true}), 0);
  }

  function closeManual() {
    if (el.manualDialog.open) el.manualDialog.close();
  }

  function stepManualSection(direction) {
    initializeManual();
    const visible = [...el.manualNav.querySelectorAll('[data-manual-target]')].filter(button => !button.hidden);
    if (!visible.length) return;
    let index = visible.findIndex(button => button.dataset.manualTarget === manualCurrentSectionId);
    if (index < 0) index = 0;
    index = Math.max(0, Math.min(visible.length - 1, index + direction));
    showManualSection(visible[index].dataset.manualTarget, { focusContent:true });
  }

  function showHelpMenu() {
    const menu = el.helpMenu;
    if (!menu.hidden) {
      menu.hidden = true;
      el.helpBtn.setAttribute('aria-expanded','false');
      return;
    }
    const rect = el.helpBtn.getBoundingClientRect();
    menu.hidden = false;
    const width = Math.max(210, menu.offsetWidth || 210);
    menu.style.left = `${Math.max(6, Math.min(rect.right - width, innerWidth - width - 6))}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, innerHeight - menu.offsetHeight - 6)}px`;
    el.helpBtn.setAttribute('aria-expanded','true');
  }

  function handleGlobalShortcut(event) {
    if (event.key === 'F1') {
      event.preventDefault();
      openManual(manualCurrentSectionId || 'overview');
      return;
    }

    if (el.manualDialog.open) {
      const mod = event.ctrlKey || event.metaKey;
      if ((mod && event.key.toLowerCase() === 'f') ||
          (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
           !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))) {
        event.preventDefault();
        el.manualSearch.focus();
        el.manualSearch.select();
      } else if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        stepManualSection(-1);
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        stepManualSection(1);
      }
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = event.key.toLowerCase();
    if (key === 't' && event.shiftKey) { event.preventDefault(); reopenClosedTab(); }
    else if (key === 'g') { event.preventDefault(); openGoToLine(); }
    else if (key === 'p') { event.preventDefault(); printDocument(); }
    else if (key === 'f') { event.preventDefault(); openFindBar(false); }
    else if (key === 'h') { event.preventDefault(); openFindBar(true); }
    else if (key === '=' || key === '+') { event.preventDefault(); changeZoom(10); }
    else if (key === '-') { event.preventDefault(); changeZoom(-10); }
    else if (key === '0') {
      event.preventDefault();
      settings.zoom = 100;
      saveSettings();
      applyZoom();
    }
    else if (key === 'n') { event.preventDefault(); newDocument(); }
    else if (key === 'o' && event.altKey) { event.preventDefault(); showRecentMenu(); }
    else if (key === 'o') { event.preventDefault(); showOpenFileDialog(); }
    else if (key === 's' && event.shiftKey) { event.preventDefault(); saveCurrent(true); }
    else if (key === 's') { event.preventDefault(); saveCurrent(false); }
    else if (key === 'b' && isMarkdownEditing()) { event.preventDefault(); runBold(); }
    else if (key === 'i' && isMarkdownEditing()) { event.preventDefault(); runItalic(); }
    else if (key === '\\' && !isMarkdownTab()) { event.preventDefault(); clearFormatting(); }
    else if (key === 'u' && !isMarkdownTab()) { event.preventDefault(); exec('underline', true); }
    else if (key === '7' && event.shiftKey && isMarkdownEditing()) { event.preventDefault(); runOrderedList(); }
    else if (key === '8' && event.shiftKey && isMarkdownEditing()) { event.preventDefault(); runUnorderedList(); }
    else if (key === '7' && event.shiftKey && !isMarkdownTab()) { event.preventDefault(); exec('insertOrderedList', true); }
    else if (key === '8' && event.shiftKey && !isMarkdownTab()) { event.preventDefault(); exec('insertUnorderedList', true); }
    // Ctrl/Cmd+B and Ctrl/Cmd+I remain native contenteditable shortcuts for Rich Text.
  }
