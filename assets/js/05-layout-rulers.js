  // ===========================================================================
  // LAYOUT, FILE DRAWER & RULERS
  // ===========================================================================


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
