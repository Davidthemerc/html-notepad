  // ===========================================================================
  // FONT COLOR TOOLS
  // ===========================================================================

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r=0,g=0,b=0;
    if (h < 60) [r,g,b]=[c,x,0]; else if (h < 120) [r,g,b]=[x,c,0]; else if (h < 180) [r,g,b]=[0,c,x];
    else if (h < 240) [r,g,b]=[0,x,c]; else if (h < 300) [r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
    return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
  }

  function rgbToHsv(r, g, b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;
    if (d) {
      if (max===r) h=60*(((g-b)/d)%6);
      else if (max===g) h=60*((b-r)/d+2);
      else h=60*((r-g)/d+4);
    }
    if (h<0) h+=360;
    return { h, s:max ? d/max : 0, v:max };
  }

  function wheelHex() {
    const [r,g,b] = hsvToRgb(wheelState.h, wheelState.s, wheelState.v);
    return '#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join('');
  }

  function setWheelFromHex(hex) {
    const clean = normalizeHexColor(hex).slice(1);
    const hsv = rgbToHsv(parseInt(clean.slice(0,2),16), parseInt(clean.slice(2,4),16), parseInt(clean.slice(4,6),16));
    wheelState = hsv;
    el.colorBrightness.value = String(Math.round(hsv.v * 100));
    renderColorWheel();
  }

  function renderColorWheel() {
    const canvas = el.colorWheelCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const w=canvas.width, h=canvas.height, cx=w/2, cy=h/2, radius=Math.min(cx,cy)-2;
    const img=ctx.createImageData(w,h);
    const data=img.data;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const dx=x-cx, dy=y-cy, dist=Math.sqrt(dx*dx+dy*dy), idx=(y*w+x)*4;
      if (dist>radius) { data[idx+3]=0; continue; }
      const sat=Math.min(1,dist/radius), hue=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
      const [r,g,b]=hsvToRgb(hue,sat,1);
      data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=255;
    }
    ctx.clearRect(0,0,w,h); ctx.putImageData(img,0,0);
    const angle=wheelState.h*Math.PI/180, rr=wheelState.s*radius;
    const mx=cx+Math.cos(angle)*rr, my=cy+Math.sin(angle)*rr;
    ctx.beginPath(); ctx.arc(mx,my,6,0,Math.PI*2); ctx.lineWidth=2; ctx.strokeStyle=wheelState.v > .55 ? '#111' : '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(mx,my,8,0,Math.PI*2); ctx.lineWidth=1; ctx.strokeStyle=wheelState.v > .55 ? '#fff' : '#111'; ctx.stroke();
    const hex=wheelHex();
    el.colorWheelPreview.style.background=hex;
    el.colorHexInput.value=hex.toUpperCase();
  }

  function pickWheelAt(clientX, clientY) {
    const rect=el.colorWheelCanvas.getBoundingClientRect();
    const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
    let dx=clientX-cx, dy=clientY-cy;
    const radius=Math.min(rect.width,rect.height)/2;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if (dist>radius && dist) { dx*=radius/dist; dy*=radius/dist; }
    wheelState.s=Math.min(1,Math.sqrt(dx*dx+dy*dy)/radius);
    wheelState.h=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
    renderColorWheel();
  }

  function positionColorWheelPopover() {
    if (!el.colorWheelMenu || el.colorWheelMenu.hidden) return;
    const br=el.colorWheelBtn.getBoundingClientRect();
    const mr=el.colorWheelMenu.getBoundingClientRect();
    const pad=8, gap=7;
    let left=Math.min(Math.max(pad,br.left),Math.max(pad,window.innerWidth-mr.width-pad));
    let top=br.bottom+gap;
    if (top+mr.height>window.innerHeight-pad) top=Math.max(pad,br.top-mr.height-gap);
    el.colorWheelMenu.style.left=`${left}px`;
    el.colorWheelMenu.style.top=`${top}px`;
    el.colorWheelMenu.style.right='auto';
    el.colorWheelMenu.style.bottom='auto';
  }

  function openColorWheel() {
    rememberEditorSelection();
    const start=settings.colorHistory?.[0] || '#000000';
    setWheelFromHex(start);
    closeToolbarPopovers(el.colorWheelMenu);
    el.colorWheelMenu.hidden=false;
    el.colorWheelBtn.setAttribute('aria-expanded','true');
    requestAnimationFrame(positionColorWheelPopover);
  }

  function normalizeHexColor(value) {
    if (!value) return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) return ('#' + [...value.slice(1)].map(c => c+c).join('')).toLowerCase();
    const m = String(value).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return '#' + [m[1],m[2],m[3]].map(v => Math.max(0,Math.min(255,Number(v))).toString(16).padStart(2,'0')).join('');
    const probe = document.createElement('span'); probe.style.color = value; probe.style.display = 'none'; document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color; probe.remove();
    return normalizeHexColor(computed);
  }

  function addColorToHistory(color) {
    color = normalizeHexColor(color);
    const history = Array.isArray(settings.colorHistory) ? settings.colorHistory : [];
    settings.colorHistory = [color, ...history.filter(c => normalizeHexColor(c) !== color)].slice(0, 10);
    saveSettings();
  }

  function applyFontColor(color) {
    color = normalizeHexColor(color);
    el.editor.focus();
    restoreEditorSelection();
    try { document.execCommand('styleWithCSS', false, true); } catch {}
    try { document.execCommand('foreColor', false, color); } catch {}
    addColorToHistory(color);
    markDirtyFromEditor();
    updateFormatState();
    closeToolbarPopovers();
  }

  function colorUsagePercent(color) {
    const target = normalizeHexColor(color);
    const walker = document.createTreeWalker(el.editor, NodeFilter.SHOW_TEXT);
    let total = 0, matched = 0, node;
    while ((node = walker.nextNode())) {
      const len = (node.nodeValue || '').length;
      if (!len) continue;
      total += len;
      const parent = node.parentElement || el.editor;
      if (normalizeHexColor(getComputedStyle(parent).color) === target) matched += len;
    }
    return total ? (matched / total) * 100 : 0;
  }

  function renderColorHistory() {
    const history = Array.isArray(settings.colorHistory) ? settings.colorHistory.slice(0,10) : [];
    el.colorHistoryList.innerHTML = '';
    if (!history.length) {
      const empty = document.createElement('div'); empty.className = 'history-empty'; empty.textContent = 'No font colors used yet.'; el.colorHistoryList.appendChild(empty); return;
    }
    for (const color of history) {
      const row = document.createElement('button'); row.className = 'history-color-row'; row.type = 'button'; row.title = `Apply ${color}`;
      const chip = document.createElement('span'); chip.className = 'history-chip'; chip.style.background = color;
      const hex = document.createElement('span'); hex.className = 'history-hex'; hex.textContent = color.toUpperCase();
      const pct = document.createElement('span'); pct.className = 'history-pct'; const n = colorUsagePercent(color); pct.textContent = `${n < 0.1 && n > 0 ? '<0.1' : n.toFixed(1)}%`;
      row.append(chip,hex,pct);
      row.addEventListener('pointerdown', e => e.preventDefault());
      row.addEventListener('click', () => applyFontColor(color));
      el.colorHistoryList.appendChild(row);
    }
  }

  function buildColorPalette() {
    el.colorGrid.innerHTML = '';
    for (const [name,color] of COMMON_COLORS) {
      const b = document.createElement('button'); b.type='button'; b.className='color-swatch'; b.style.background=color; b.title=`${name} ${color}`; b.setAttribute('aria-label', `${name} ${color}`);
      b.addEventListener('pointerdown', e => e.preventDefault());
      b.addEventListener('click', () => applyFontColor(color));
      el.colorGrid.appendChild(b);
    }
  }

  function currentLineColumn() {
    if (isSourceTab()) {
      const before = el.markdownSource.value.slice(0, el.markdownSource.selectionStart);
      const parts = before.split('\n');
      return { line:parts.length, col:(parts.at(-1)?.length || 0) + 1 };
    }
    if(!selectionInsideEditor()) return {line:1,col:1};
    const sel=window.getSelection(),range=sel.getRangeAt(0),pre=document.createRange();
    pre.selectNodeContents(el.editor);pre.setEnd(range.endContainer,range.endOffset);
    const text=richTextLogicalText(pre.cloneContents());
    const parts=text.split('\n'); return {line:parts.length,col:(parts.at(-1)?.length||0)+1};
  }
  function updateCursorPosition(){const p=currentLineColumn();el.cursorPosition.textContent=`Ln ${p.line}, Col ${p.col}`;}

  function safePastedHtml(html) {
    const t=document.createElement('template');t.innerHTML=html||'';
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,svg,canvas').forEach(n=>n.remove());
    const allowed=new Set(['B','STRONG','I','EM','U','S','STRIKE','A','BR','P','DIV','UL','OL','LI','BLOCKQUOTE','SPAN']);
    const walk=[...t.content.querySelectorAll('*')];
    for(const n of walk){
      if(!allowed.has(n.tagName)){n.replaceWith(...n.childNodes);continue;}
      for(const a of [...n.attributes]){
        const k=a.name.toLowerCase();
        if(k.startsWith('on')||!((n.tagName==='A'&&['href','title'].includes(k)))) n.removeAttribute(a.name);
      }
      if(n.tagName==='A'){
        const href=n.getAttribute('href')||'';
        if(!/^(?:https?:\/\/|mailto:)/i.test(href))n.removeAttribute('href');
        else {n.setAttribute('rel','noopener noreferrer');n.setAttribute('target','_blank');}
      }
    }
    return t.innerHTML;
  }

  function replaceSelectionText(transform) {
    if(!requireActiveDocument())return;
    if(!selectionInsideEditor())return toast('Select text first.');
    const sel=window.getSelection();if(sel.isCollapsed)return toast('Select text first.');
    const text=sel.toString(), changed=transform(text);if(changed===text)return;
    // insertText participates in the browser's native contenteditable undo stack.
    document.execCommand('insertText',false,changed);markDirtyFromEditor();updateCounts();updateFormatState();
  }
  function toTitleCase(t){return t.toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase());}
  function toSentenceCase(t){return t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g,(m,p,c)=>p+c.toUpperCase());}

  function openDateTimeDialog(){
    if(!requireActiveDocument())return;
    rememberEditorSelection();const d=new Date();
    const formats=[
      ['Short date',d.toLocaleDateString()],
      ['Long date',d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})],
      ['Time',d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})],
      ['Date and time',`${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`],
      ['Long date and time',`${d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})} ${d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`],
      ['ISO date',`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`]
    ];
    el.dateTimeFormat.innerHTML='';for(const [label,value] of formats){const o=document.createElement('option');o.value=value;o.textContent=`${label} — ${value}`;el.dateTimeFormat.appendChild(o);}
    el.dateTimeDialog.showModal();
  }
  function insertChosenDateTime(){if(!requireActiveDocument()){el.dateTimeDialog.close();return;}const value=el.dateTimeFormat.value;el.dateTimeDialog.close();restoreEditorSelection();el.editor.focus();document.execCommand('insertText',false,value);markDirtyFromEditor();updateCounts();}

  function documentLines(){return el.editor.innerText.replace(/\u00a0/g,' ').split('\n');}
  function openGoToLine(){if(!requireActiveDocument())return;const lines=documentLines();el.goToLineInput.max=Math.max(1,lines.length);el.goToLineInput.value=currentLineColumn().line;el.goToLineNote.textContent=`Document has ${lines.length} line${lines.length===1?'':'s'}.`;el.goToLineDialog.showModal();setTimeout(()=>{el.goToLineInput.focus();el.goToLineInput.select();},0);}
  function goToLine(){
    if(!requireActiveDocument()){el.goToLineDialog.close();return;}
    const target=Math.max(1,Math.min(documentLines().length,parseInt(el.goToLineInput.value,10)||1));
    let remaining=target-1,node=null,offset=0;
    const walker=document.createTreeWalker(el.editor,NodeFilter.SHOW_TEXT);let n;
    while((n=walker.nextNode())){
      const parts=n.nodeValue.split('\n');
      if(remaining<parts.length){node=n;offset=parts.slice(0,remaining).join('\n').length+(remaining?1:0);break;}
      remaining-=parts.length-1;
      // Block boundaries count as visual lines in innerText but not text-node newlines; fallback below handles these.
    }
    if(!node){
      // Map the requested line's character offset through the editor's rendered text.
      const full=el.editor.innerText.replace(/\u00a0/g,' '),idx=full.split('\n').slice(0,target-1).reduce((a,x)=>a+x.length+1,0);
      restoreSelectionFromOffsets({start:idx,end:idx});el.goToLineDialog.close();el.editor.focus();updateCounts();return;
    }
    const r=document.createRange();r.setStart(node,Math.min(offset,node.nodeValue.length));r.collapse(true);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);el.goToLineDialog.close();el.editor.focus();updateCounts();
  }

  function shouldShowLineNumbers() {
    if (!settings.lineNumbers || !currentTab()) return false;
    // Markdown Preview is rendered output, so source line numbers would not align with it.
    if (isMarkdownTab() && currentTab()?.markdownMode === 'preview') return false;
    return true;
  }

  function syncLineNumberVisibility() {
    if (!el.lineNumberGutter) return;
    const show = shouldShowLineNumbers();
    el.lineNumberGutter.hidden = !show;
    document.querySelector('.editor-stage')?.classList.toggle('show-line-numbers', show);
    if (!show) el.lineNumberGutter.textContent = '';
  }

  // Convert Rich Text DOM into logical editor lines without using innerText.
  // innerText inserts extra newlines around rendered block elements (especially <p>),
  // which made one typed line appear as two line numbers and inflated multi-line counts.
  function richTextLogicalText(root = el.editor) {
    const blockTags = new Set([
      'ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DIV','DL','DT','DD','FIGCAPTION',
      'FIGURE','FOOTER','HEADER','H1','H2','H3','H4','H5','H6','HR','LI','MAIN',
      'NAV','OL','P','PRE','SECTION','TR','UL'
    ]);
    let out = '';

    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.nodeValue || '').replace(/\r/g, '');
        // Pretty-printed/imported HTML can contain formatting whitespace between
        // block elements. It is markup whitespace, not an editor line.
        const parent = node.parentElement;
        const insidePre = !!parent?.closest?.('pre');
        if (!insidePre && /\n/.test(text) && /^\s*$/.test(text)) return;
        out += text;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        out += '\n';
        return;
      }

      const isBlock = node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName);
      if (isBlock && out && !out.endsWith('\n')) out += '\n';

      const beforeChildren = out.length;
      for (const child of node.childNodes) walk(child);
      const producedContent = out.length > beforeChildren;

      if (isBlock) {
        // Empty block elements are real blank editor lines. Non-empty blocks need one
        // boundary newline, but never the double newline that innerText can synthesize.
        if (!producedContent) out += '\n';
        else if (!out.endsWith('\n')) out += '\n';
      }
    };

    for (const child of root.childNodes || []) walk(child);

    // A block's closing boundary terminates its current line; it does not by itself
    // create another empty line. Explicit trailing blank blocks/BRs still remain.
    if (out.endsWith('\n')) out = out.slice(0, -1);
    return out.replace(/\u00a0/g, ' ');
  }

  function syncLineNumberMetrics() {
    if (!el.lineNumberGutter || el.lineNumberGutter.hidden) return;
    const surface = isSourceTab() ? el.markdownSource : el.editor;
    const style = getComputedStyle(surface);
    const zoomFactor = isSourceTab() ? 1 : Math.max(0.5, Math.min(2, (Number(settings.zoom) || 100) / 100));
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);

    if (Number.isFinite(lineHeight)) el.lineNumberGutter.style.lineHeight = `${lineHeight * zoomFactor}px`;
    if (Number.isFinite(paddingTop)) el.lineNumberGutter.style.paddingTop = `${paddingTop * zoomFactor}px`;
    if (Number.isFinite(paddingBottom)) el.lineNumberGutter.style.paddingBottom = `${paddingBottom * zoomFactor}px`;
  }

  function updateLineNumbers(){
    if(!el.lineNumberGutter)return;
    syncLineNumberVisibility();
    if(el.lineNumberGutter.hidden)return;
    syncLineNumberMetrics();
    const source = isSourceTab() ? el.markdownSource.value : richTextLogicalText(el.editor);
    const lines=Math.max(1,String(source ?? '').split('\n').length);
    el.lineNumberGutter.textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');
    el.lineNumberGutter.scrollTop=isSourceTab()?el.markdownSource.scrollTop:el.editor.scrollTop;
  }
  const SPECIAL_CHARS=['©','®','™','°','±','×','÷','•','—','–','…','§','¶','€','£','¥','$','¢','→','←','↑','↓','↔','✓','✕','★','☆','♥','♦','♣','♠','µ'];
  function buildSpecialChars(){el.specialCharGrid.innerHTML='';for(const ch of SPECIAL_CHARS){const b=document.createElement('button');b.type='button';b.textContent=ch;b.title=`Insert ${ch}`;b.addEventListener('click',()=>{restoreEditorSelection();el.editor.focus();document.execCommand('insertText',false,ch);markDirtyFromEditor();el.specialCharDialog.close();});el.specialCharGrid.appendChild(b);}}
  function insertSimpleText(text){if(!requireActiveDocument())return;restoreEditorSelection();el.editor.focus();document.execCommand('insertText',false,text);markDirtyFromEditor();}
  function insertHorizontalRule(){if(!requireActiveDocument())return;restoreEditorSelection();el.editor.focus();document.execCommand('insertHorizontalRule',false,null);markDirtyFromEditor();}
  function propRow(label,value){return `<div class="prop-label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div>`;}
