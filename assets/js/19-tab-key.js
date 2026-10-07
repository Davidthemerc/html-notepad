  // ===========================================================================
  // TAB KEY BEHAVIOR
  // ===========================================================================

  function handleEditorTab(e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (selectionInsideList()) {
      exec(e.shiftKey ? 'outdent' : 'indent', true);
      return;
    }
    if (e.shiftKey) {
      // Outside a list, Shift+Tab outdents an indented block when possible.
      exec('outdent', true);
      return;
    }
    insertTabAtSelection();
  }
