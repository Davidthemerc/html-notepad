  // ===========================================================================
  // LAYOUT, FILE DRAWER & RULERS
  // ===========================================================================


  // On-screen keyboard handling (phones/tablets). Browsers that overlay the keyboard instead of
  // resizing the page would leave the bottom of the editor - and the caret - underneath it.
  // The app height follows the VISUAL viewport, so the editor always ends above the keyboard
  // and the browser's own caret scrolling keeps the typing position visible.
  function setupViewportSync() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let lastHeight = vv.height, frame = 0;
    const apply = () => {
      frame = 0;
      if (vv.scale > 1.01) return;                      // pinch-zoomed: leave layout alone
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvtop', `${Math.round(vv.offsetTop)}px`);
      const shrunk = vv.height < lastHeight - 80;       // keyboard just opened
      lastHeight = vv.height;
      if (shrunk) setTimeout(revealCaret, 60);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    apply();
  }

  // Scrolls the caret into the visible part of the editor (used when the keyboard opens).
  function revealCaret() {
    const active = document.activeElement;
    if (active === el.markdownSource) {
      const area = el.markdownSource, pos = area.selectionEnd, line = parseFloat(getComputedStyle(area).lineHeight) || 24;
      const top = textareaOffsetTop(area, pos);
      if (top < area.scrollTop || top + line > area.scrollTop + area.clientHeight) {
        area.scrollTop = Math.max(0, top - area.clientHeight + line * 3);
      }
    } else if (active === el.editor) {
      const sel = getSelection();
      if (!sel?.rangeCount) return;
      const node = sel.getRangeAt(0).startContainer;
      (node.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function setFilesDrawer(open) {
    el.workspace.classList.toggle('files-open', !!open);
    el.filesToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && window.matchMedia?.('(max-width: 760px)').matches) {
      setTimeout(() => el.fileSearch.focus(), 0);
    }
    setTimeout(scheduleRulerBuild, 190);
  }

  function toggleFilesDrawer() {
    setFilesDrawer(!el.workspace.classList.contains('files-open'));
  }

  function buildRulers() {
    if (window.matchMedia?.('(max-width: 760px), (hover: none) and (pointer: coarse)').matches) {
      el.ruler.innerHTML = '';
      const tab=currentTab();
    if(tab){
      tab.layout=tab.layout||{left:0,first:0,right:0,tabs:[48]};
      const max=Math.max(96,el.ruler.clientWidth);
      const addMarker=(cls,x,onmove)=>{
        const m=document.createElement('span');m.className=`ruler-marker ${cls}`;m.style.left=`${x}px`;
        m.addEventListener('pointerdown',e=>{e.preventDefault();const move=ev=>{const r=el.ruler.getBoundingClientRect();onmove(Math.max(0,Math.min(max,ev.clientX-r.left)));applyDocumentLayout();buildRulers();};const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);captureEditorIntoActive();persistUnsavedDraftsSoon();};addEventListener('pointermove',move);addEventListener('pointerup',up);});
        el.ruler.appendChild(m);
      };
      addMarker('left',tab.layout.left||0,v=>tab.layout.left=v);
      addMarker('first',(tab.layout.left||0)+(tab.layout.first||0),v=>tab.layout.first=v-(tab.layout.left||0));
      addMarker('right',max-(tab.layout.right||0),v=>tab.layout.right=max-v);
      for(const x of (tab.layout.tabs||[])){const t=document.createElement('span');t.className='tab-stop-marker';t.style.left=`${x}px`;t.title='Tab stop — click to remove';t.addEventListener('click',e=>{e.stopPropagation();tab.layout.tabs=tab.layout.tabs.filter(v=>v!==x);buildRulers();});el.ruler.appendChild(t);}
      el.ruler.onclick=e=>{if(e.target!==el.ruler)return;const r=el.ruler.getBoundingClientRect(),x=Math.round((e.clientX-r.left)/12)*12;tab.layout.tabs=[...(tab.layout.tabs||[]),x].sort((a,b)=>a-b);buildRulers();};
    }

    el.verticalRuler.innerHTML = '';
      return;
    }

    const horizontalInches = Math.max(1, Math.ceil(el.ruler.clientWidth / 96));
    const verticalInches = Math.max(1, Math.ceil(el.verticalRuler.clientHeight / 96));

    el.ruler.innerHTML = '';
    for (let i = 0; i <= horizontalInches * 8; i++) {
      const tick = document.createElement('span');
      tick.className = 'ruler-tick';
      tick.style.left = `${i / 8}in`;
      const mod = i % 8;
      tick.style.height = mod === 0 ? '13px' : mod === 4 ? '10px' : mod % 2 === 0 ? '7px' : '4px';
      el.ruler.appendChild(tick);
      if (mod === 0) {
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.style.left = `${i / 8}in`;
        label.textContent = String(i / 8);
        el.ruler.appendChild(label);
      }
    }

    el.verticalRuler.innerHTML = '';
    for (let i = 0; i <= verticalInches * 8; i++) {
      const tick = document.createElement('span');
      tick.className = 'vertical-ruler-tick';
      tick.style.top = `${i / 8}in`;
      const mod = i % 8;
      tick.style.width = mod === 0 ? '13px' : mod === 4 ? '10px' : mod % 2 === 0 ? '7px' : '4px';
      el.verticalRuler.appendChild(tick);
      if (mod === 0) {
        const label = document.createElement('span');
        label.className = 'vertical-ruler-label';
        label.style.top = `${i / 8}in`;
        label.textContent = String(i / 8);
        el.verticalRuler.appendChild(label);
      }
    }
  }

  let rulerResizeFrame = 0;
  function scheduleRulerBuild() {
    cancelAnimationFrame(rulerResizeFrame);
    rulerResizeFrame = requestAnimationFrame(buildRulers);
  }
