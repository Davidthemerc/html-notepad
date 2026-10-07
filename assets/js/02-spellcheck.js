  const SPELL_HIGHLIGHT_NAME = 'notepad-spelling-errors';
  const SPELL_WORD_RE = /[\p{L}]+(?:['’][\p{L}]+)*/gu;
  const SPELL_APP_WORDS = [
    'notepad','markdown','javascript','indexeddb','localstorage','json','html','css',
    'onedrive','autosave','spellcheck','spellchecker','webpage','website','websites'
  ];
  const SPELL_COMMON_WORDS = `the be to of and a in that have I it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because these give day most us is are was were been being has had did does done should could would may might must very where why while here every each much many more less own same another between through before under again around right left long little great small old young high low next last find tell ask seem feel try leave call receive separate definitely necessary organization government business system office computer document file save open print color word words text note notes name names correct correction spelling spell dictionary`.split(/\s+/);
  const SPELL_COMMON_RANK = new Map(SPELL_COMMON_WORDS.map((word,index)=>[normalizeSpellWord(word),index]));
  let spellDictionary = null;
  let spellBuckets = null;
  let spellErrors = [];
  let spellScanTimer = null;
  let activeSpellTarget = null;

  function normalizeSpellWord(word) {
    return String(word || '').normalize('NFC').replace(/’/g, "'").toLowerCase();
  }

  function ensureSpellDictionary() {
    if (spellDictionary) return spellDictionary;
    const words = [];
    let previous = '';
    for (const row of SPELL_DICTIONARY_FRONT.split('\n')) {
      if (!row) continue;
      const prefixLength = Math.max(0, row.charCodeAt(0) - 33);
      const word = previous.slice(0, prefixLength) + row.slice(1);
      previous = word;
      words.push(normalizeSpellWord(word));
    }
    for (const word of SPELL_APP_WORDS) words.push(normalizeSpellWord(word));
    for (const word of settings.customDictionary || []) words.push(normalizeSpellWord(word));
    spellDictionary = new Set(words);
    spellBuckets = new Map();
    for (const word of spellDictionary) {
      if (!word || !/^[\p{L}]/u.test(word)) continue;
      const key = `${word[0]}:${word.length}`;
      if (!spellBuckets.has(key)) spellBuckets.set(key, []);
      spellBuckets.get(key).push(word);
    }
    return spellDictionary;
  }

  function rebuildSpellDictionary() {
    spellDictionary = null;
    spellBuckets = null;
    ensureSpellDictionary();
  }

  function isSpellcheckableWord(word) {
    const normalized = normalizeSpellWord(word);
    if (!normalized || normalized.length > 64) return false;
    if (/^[A-Z]{2,8}$/.test(word)) return false; // likely acronym
    return !ensureSpellDictionary().has(normalized);
  }

  function currentSpellIgnoreSet() {
    const tab = currentTab();
    if (!tab) return new Set();
    if (!(tab.spellIgnored instanceof Set)) tab.spellIgnored = new Set();
    return tab.spellIgnored;
  }

  function clearSpellHighlights() {
    spellErrors = [];
    activeSpellTarget = null;
    try { CSS.highlights?.delete(SPELL_HIGHLIGHT_NAME); } catch {}
  }

  function scheduleSpellcheck(delay = 280) {
    clearTimeout(spellScanTimer);
    if (!settings.spellcheck || isSourceTab()) {
      clearSpellHighlights();
      return;
    }
    spellScanTimer = setTimeout(runSpellcheck, delay);
  }

  function runSpellcheck() {
    clearTimeout(spellScanTimer);
    if (!settings.spellcheck || isSourceTab() || el.editor.hidden) {
      clearSpellHighlights();
      return;
    }
    ensureSpellDictionary();
    const ignored = currentSpellIgnoreSet();
    const ranges = [];
    const errors = [];
    const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('a,code,pre')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      SPELL_WORD_RE.lastIndex = 0;
      let match;
      while ((match = SPELL_WORD_RE.exec(text))) {
        const word = match[0];
        const normalized = normalizeSpellWord(word);
        if (ignored.has(normalized) || !isSpellcheckableWord(word)) continue;
        const range = new Range();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + word.length);
        ranges.push(range);
        errors.push({ word, normalized, node, start: match.index, end: match.index + word.length, range });
      }
    }
    spellErrors = errors;
    if ('highlights' in CSS && typeof Highlight === 'function') {
      try {
        const highlight = new Highlight(...ranges);
        try { highlight.type = 'spelling-error'; } catch {}
        CSS.highlights.set(SPELL_HIGHLIGHT_NAME, highlight);
      } catch {}
    }
  }

  function caretPointFromEvent(event) {
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (pos) return { node: pos.offsetNode, offset: pos.offset };
    }
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (range) return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }

  function spellErrorAtPoint(event) {
    const point = caretPointFromEvent(event);
    if (!point) return null;
    let node = point.node;
    let offset = point.offset;
    if (node?.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes?.[Math.max(0, Math.min(offset, node.childNodes.length - 1))];
      if (child?.nodeType === Node.TEXT_NODE) { node = child; offset = 0; }
    }
    return spellErrors.find(error => error.node === node && offset >= error.start && offset <= error.end) || null;
  }

  function boundedDamerauLevenshtein(a, b, max = 2) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const prev2 = new Array(b.length + 1).fill(0);
    let prev = Array.from({length:b.length + 1}, (_,i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1); cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i-1] === b[j-1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + cost);
        if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) {
          cur[j] = Math.min(cur[j], prev2[j-2] + 1);
        }
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      for (let j=0;j<prev.length;j++) prev2[j]=prev[j];
      prev = cur;
    }
    return prev[b.length];
  }

  function preserveSuggestionCase(suggestion, original) {
    if (/^[A-Z]+$/.test(original)) return suggestion.toUpperCase();
    if (/^[A-Z]/.test(original)) return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
    return suggestion;
  }

  function spellSuggestions(word, limit = 6) {
    ensureSpellDictionary();
    const target = normalizeSpellWord(word);
    const scored = [];
    const seen = new Set();
    const first = target[0] || '';
    const collect = (candidate, maxDistance) => {
      if (seen.has(candidate) || candidate === target) return;
      seen.add(candidate);
      const distance = boundedDamerauLevenshtein(target, candidate, maxDistance);
      if (distance <= maxDistance) scored.push({candidate, distance});
    };
    // Most spelling errors retain their first letter. This keeps suggestion generation fast.
    for (let len=Math.max(1,target.length-2); len<=target.length+2; len++) {
      for (const candidate of spellBuckets.get(`${first}:${len}`) || []) collect(candidate, 2);
    }
    // If the first letter itself is wrong, broaden the search to nearby lengths.
    if (scored.length < limit) {
      for (const [key, bucket] of spellBuckets) {
        const len = Number(key.slice(key.lastIndexOf(':')+1));
        if (Math.abs(len-target.length) > 1 || key.startsWith(`${first}:`)) continue;
        for (const candidate of bucket) collect(candidate, 1);
      }
    }
    scored.sort((a,b) => a.distance-b.distance ||
      (SPELL_COMMON_RANK.get(a.candidate) ?? 999999) - (SPELL_COMMON_RANK.get(b.candidate) ?? 999999) ||
      Math.abs(a.candidate.length-target.length)-Math.abs(b.candidate.length-target.length) ||
      a.candidate.localeCompare(b.candidate));
    return scored.slice(0,limit).map(item => preserveSuggestionCase(item.candidate, word));
  }

  function renderSpellContext(error) {
    activeSpellTarget = error || null;
    el.spellContextSection.hidden = !error;
    el.spellSuggestionList.innerHTML = '';
    if (!error) return;
    el.spellContextWord.textContent = `Spelling: ${error.word}`;
    const suggestions = spellSuggestions(error.word);
    if (!suggestions.length) {
      const empty = document.createElement('div');
      empty.className = 'spell-no-suggestions';
      empty.textContent = 'No suggestions';
      el.spellSuggestionList.appendChild(empty);
      return;
    }
    for (const suggestion of suggestions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spell-suggestion';
      button.textContent = suggestion;
      button.addEventListener('click', () => applySpellSuggestion(suggestion));
      el.spellSuggestionList.appendChild(button);
    }
  }

  function applySpellSuggestion(suggestion) {
    const target = activeSpellTarget;
    if (!target?.node?.isConnected) return closeEditorContextMenu();
    const current = target.node.nodeValue || '';
    target.node.nodeValue = current.slice(0,target.start) + suggestion + current.slice(target.end);
    markDirtyFromEditor();
    updateCounts();
    closeEditorContextMenu();
    scheduleSpellcheck(0);
  }

  function ignoreSpellTarget() {
    if (!activeSpellTarget) return;
    currentSpellIgnoreSet().add(activeSpellTarget.normalized);
    closeEditorContextMenu();
    scheduleSpellcheck(0);
  }

  function addSpellTargetToDictionary() {
    if (!activeSpellTarget) return;
    const word = activeSpellTarget.word.trim();
    const normalized = normalizeSpellWord(word);
    const existing = new Set((settings.customDictionary || []).map(normalizeSpellWord));
    if (!existing.has(normalized)) settings.customDictionary = [...(settings.customDictionary || []), word];
    saveSettings();
    rebuildSpellDictionary();
    closeEditorContextMenu();
    scheduleSpellcheck(0);
    toast(`Added “${word}” to dictionary.`);
  }
