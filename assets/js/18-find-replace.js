  // ===========================================================================
  // FIND / REPLACE
  // ===========================================================================

  // Logical text offset of the caret/selection start, so a new search begins at the cursor
  // instead of always jumping back to the top of the document.
  let findAnchor=0;
  function currentLogicalOffset(){
    if(isSourceTab())return el.markdownSource.selectionStart||0;
    const sel=getSelection();
    if(!sel||!sel.rangeCount||!el.editor.contains(sel.anchorNode))return 0;
    const range=sel.getRangeAt(0),map=richSearchMap();
    const index=map.points.findIndex(point=>point&&point.node===range.startContainer&&point.offset>=range.startOffset);
    return index<0?0:index;
  }
  function openFindBar(replace=false){
    if (!requireActiveDocument()) return;
    if(el.findBar.hidden)findAnchor=currentLogicalOffset();
    el.findBar.hidden=false; el.replaceInput.style.display=replace?'':'none'; el.replaceOneBtn.style.display=replace?'':'none'; el.replaceAllBtn.style.display=replace?'':'none';
    setTimeout(()=>{el.findInput.focus();el.findInput.select();},0); refreshFindMatches();
  }
  function closeFindBar(){
    // Leave the current match selected in the document so editing can continue from it.
    const match=findIndex>=0?findMatches[findIndex]:null;
    el.findBar.hidden=true;clearFindHighlight();findMatches=[];findIndex=-1;
    if(match&&selectFindMatch(...match))return;
    if(isSourceTab())el.markdownSource.focus();else el.editor.focus();
  }
    function richSearchMap(root=el.editor){
    const blockTags=new Set([
      'ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DIV','DL','DT','DD','FIGCAPTION',
      'FIGURE','FOOTER','HEADER','H1','H2','H3','H4','H5','H6','HR','LI','MAIN',
      'NAV','OL','P','PRE','SECTION','TR','UL'
    ]);
    let text='';
    const points=[];
    const boundary=()=>{
      if(text && !text.endsWith('\n')){text+='\n';points.push(null);}
    };
    const walk=node=>{
      if(node.nodeType===Node.TEXT_NODE){
        const value=(node.nodeValue||'').replace(/\r/g,'');
        const insidePre=!!node.parentElement?.closest?.('pre');
        if(!insidePre && /\n/.test(value) && /^\s*$/.test(value))return;
        for(let i=0;i<value.length;i++){text+=value[i];points.push({node,offset:i});}
        return;
      }
      if(node.nodeType!==Node.ELEMENT_NODE && node.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return;
      if(node.nodeType===Node.ELEMENT_NODE && node.tagName==='BR'){text+='\n';points.push(null);return;}
      if(node.nodeType===Node.ELEMENT_NODE &&
         ['IMG','VIDEO','AUDIO','IFRAME','CANVAS','SVG','INPUT','TEXTAREA','SELECT'].includes(node.tagName)){
        text+='\uFFFC';points.push(null);return;
      }
      const isBlock=node.nodeType===Node.ELEMENT_NODE && blockTags.has(node.tagName);
      if(isBlock)boundary();
      const before=text.length;
      for(const child of node.childNodes)walk(child);
      if(isBlock){
        if(text.length===before){text+='\n';points.push(null);}
        else boundary();
      }
    };
    for(const child of root.childNodes)walk(child);
    if(text.endsWith('\n')){text=text.slice(0,-1);points.pop();}
    return {text:text.replace(/\u00a0/g,' '),points};
  }

  function richRangeForLogicalOffsets(start,end,map=richSearchMap()){
    if(start<0||end<=start||end>map.text.length)return null;
    for(let i=start;i<end;i++) if(!map.points[i]) return null;
    const first=start,last=end-1;
    const a=map.points[first],b=map.points[last];
    if(!a||!b)return null;
    const range=document.createRange();
    range.setStart(a.node,a.offset);
    range.setEnd(b.node,b.offset+1);
    return range;
  }

  // Pixel offset of a character position inside the textarea (accounts for wrapping), measured
  // with a hidden mirror element that copies the textarea's text metrics.
  function buildTextareaMirror(area,position,end=null){
    const style=getComputedStyle(area),mirror=document.createElement('div');
    ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','tabSize','textTransform','whiteSpace','wordBreak','overflowWrap','paddingTop','paddingRight','paddingBottom','paddingLeft','borderLeftWidth','borderRightWidth','boxSizing']
      .forEach(prop=>{mirror.style[prop]=style[prop];});
    mirror.style.position='absolute';mirror.style.visibility='hidden';mirror.style.top='0';mirror.style.left='-9999px';
    mirror.style.width=area.clientWidth+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)+'px';
    mirror.style.whiteSpace=style.whiteSpace==='pre'?'pre':'pre-wrap';
    mirror.appendChild(document.createTextNode(area.value.slice(0,position)));
    const marker=document.createElement('span');
    marker.textContent=end===null?'\u200b':area.value.slice(position,end)||'\u200b';
    mirror.appendChild(marker);
    if(end!==null)mirror.appendChild(document.createTextNode(area.value.slice(end)));
    document.body.appendChild(mirror);
    return {mirror,marker};
  }

  function textareaOffsetTop(area,position){
    const {mirror,marker}=buildTextareaMirror(area,position);
    const top=marker.offsetTop;mirror.remove();
    return top;
  }

  // A textarea does not paint its selection while it is not focused, so the current match is
  // painted by fixed-position boxes laid over the matching text.
  let findOverlayMatch=null;
  function drawTextareaHighlight(){
    document.querySelectorAll('.find-hit').forEach(node=>node.remove());
    if(!findOverlayMatch||!isSourceTab()||el.markdownSource.hidden)return;
    const area=el.markdownSource,box=area.getBoundingClientRect(),style=getComputedStyle(area);
    const {mirror,marker}=buildTextareaMirror(area,...findOverlayMatch);
    const base=mirror.getBoundingClientRect();
    const minX=box.left+parseFloat(style.borderLeftWidth),minY=box.top+parseFloat(style.borderTopWidth);
    const maxX=minX+area.clientWidth,maxY=minY+area.clientHeight;
    for(const rect of marker.getClientRects()){
      const left=minX+(rect.left-base.left-parseFloat(style.borderLeftWidth))-area.scrollLeft;
      const top=minY+(rect.top-base.top)-area.scrollTop;
      const x1=Math.max(left,minX),x2=Math.min(left+rect.width,maxX),y1=Math.max(top,minY),y2=Math.min(top+rect.height,maxY);
      if(x2<=x1||y2<=y1)continue;
      const hit=document.createElement('div');hit.className='find-hit';
      hit.style.cssText=`left:${x1}px;top:${y1}px;width:${x2-x1}px;height:${y2-y1}px`;
      document.body.appendChild(hit);
    }
    mirror.remove();
  }
  el.markdownSource.addEventListener('scroll',()=>{if(findOverlayMatch)drawTextareaHighlight();});
  window.addEventListener('resize',()=>{if(findOverlayMatch)drawTextareaHighlight();});

  // Selects a match and scrolls it into view. keepFocusIn leaves keyboard focus where the user
  // is typing (the Find box) instead of moving it into the document.
  function selectFindMatch(start,end,{keepFocusIn=null}={}){
    if(isSourceTab()){
      if(isMarkdownTab())setMarkdownMode('edit',{focus:false});
      const area=el.markdownSource;
      area.focus({preventScroll:true});
      area.setSelectionRange(start,end);
      const top=textareaOffsetTop(area,start),line=parseFloat(getComputedStyle(area).lineHeight)||24;
      if(top<area.scrollTop||top+line>area.scrollTop+area.clientHeight)area.scrollTop=Math.max(0,top-area.clientHeight/3);
      if(keepFocusIn){
        const caret=[keepFocusIn.selectionStart,keepFocusIn.selectionEnd];keepFocusIn.focus({preventScroll:true});keepFocusIn.setSelectionRange(...caret);
        findOverlayMatch=[start,end];drawTextareaHighlight();
      }else{findOverlayMatch=null;drawTextareaHighlight();}
      return true;
    }
    const range=richRangeForLogicalOffsets(start,end);
    if(!range)return false;
    const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
    if(!keepFocusIn)el.editor.focus({preventScroll:true});
    const anchor=range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer.parentElement:range.startContainer;
    anchor?.scrollIntoView?.({block:'center',inline:'nearest'});
    if(keepFocusIn){
      const caret=[keepFocusIn.selectionStart,keepFocusIn.selectionEnd];
      keepFocusIn.focus({preventScroll:true});keepFocusIn.setSelectionRange(...caret);
      // Focusing the input drops the page selection in some browsers; repaint the match with the
      // CSS Highlight API (falls back to the plain selection where unsupported).
      if(window.CSS?.highlights&&typeof Highlight==='function')CSS.highlights.set('notepad-find-match',new Highlight(range));
    }
    return true;
  }

  function clearFindHighlight(){try{CSS.highlights?.delete('notepad-find-match');}catch{}findOverlayMatch=null;document.querySelectorAll('.find-hit').forEach(node=>node.remove());}

  function refreshFindMatches({fromTyping=false}={}){
    const needle=el.findInput.value;findMatches=[];findIndex=-1;
    clearFindHighlight();
    if(!needle){el.findMatchCount.textContent='0/0';return;}
    const sourceMode=isSourceTab();
    const richMap=sourceMode?null:richSearchMap();
    const text=sourceMode?el.markdownSource.value:richMap.text;
    const hay=el.findCaseToggle.checked?text:text.toLowerCase();
    const nd=el.findCaseToggle.checked?needle:needle.toLowerCase();
    let pos=0;
    while((pos=hay.indexOf(nd,pos))>=0){
      if(sourceMode || richRangeForLogicalOffsets(pos,pos+needle.length,richMap)){
        findMatches.push([pos,pos+needle.length]);
      }
      pos+=Math.max(1,needle.length);
    }
    el.findMatchCount.textContent=findMatches.length?`${Math.max(0,findMatches.findIndex(m=>m[0]>=findAnchor))+1}/${findMatches.length}`:'0/0';
    if(findMatches.length){
      // Start at the first match at/after where the cursor was when Find opened (wrapping to the
      // top), and keep focus in the Find box while typing.
      findIndex=Math.max(0,findMatches.findIndex(m=>m[0]>=findAnchor));
      selectFindMatch(...findMatches[findIndex],{keepFocusIn:fromTyping&&!el.findBar.hidden?el.findInput:null});
    }
  }

  function selectTextOffsets(start,end){
    if(isSourceTab()){
      if(isMarkdownTab())setMarkdownMode('edit',{focus:false});
      el.markdownSource.focus();el.markdownSource.setSelectionRange(start,end);return;
    }
    selectFindMatch(start,end);
  }

  function stepFind(dir,{keepFocusIn=null}={}){
    if(!findMatches.length)return;
    findIndex=(findIndex+dir+findMatches.length)%findMatches.length;
    selectFindMatch(...findMatches[findIndex],{keepFocusIn});
    el.findMatchCount.textContent=`${findIndex+1}/${findMatches.length}`;
  }

  function richInlineFormattingAncestors(node){
    const allowed=new Set(['A','B','STRONG','I','EM','U','S','STRIKE','SPAN','FONT','CODE','SUB','SUP','SMALL','BIG']);
    const result=[];
    let element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    while(element && element!==el.editor){
      if(!allowed.has(element.tagName))break;
      result.push(element);
      element=element.parentElement;
    }
    return result;
  }

  function cleanupEmptyRichInlineFormatting(){
    el.editor.querySelectorAll('a,b,strong,i,em,u,s,strike,span,font,code,sub,sup,small,big').forEach(node=>{
      if(node.querySelector('img,br,hr'))return;
      if(!(node.textContent||''))node.remove();
    });
  }

  function replaceRichRange(range,replacement,{cleanup=true}={}){
    if(!range)return false;
    const formatting=richInlineFormattingAncestors(range.startContainer);
    const inner=formatting[0]||null;

    range.deleteContents();

    if(replacement){
      const text=document.createTextNode(replacement);
      const rangeStillInsideInner=!!inner && inner.isConnected &&
        (range.startContainer===inner ||
         (range.startContainer.nodeType===Node.TEXT_NODE
           ? inner.contains(range.startContainer.parentNode)
           : inner.contains(range.startContainer)));

      if(rangeStillInsideInner || !formatting.length){
        range.insertNode(text);
      }else{
        let payload=text;
        for(const source of formatting){
          const wrapper=source.cloneNode(false);
          wrapper.removeAttribute('id');
          wrapper.appendChild(payload);
          payload=wrapper;
        }
        range.insertNode(payload);
      }
    }

    if(cleanup){
      cleanupEmptyRichInlineFormatting();
      el.editor.normalize();
    }
    return true;
  }

  function replaceOne(){
    if(findIndex<0||!findMatches.length)return;
    const match=findMatches[findIndex];
    if(isSourceTab()){
      el.markdownSource.setRangeText(el.replaceInput.value,match[0],match[1],'end');
    }else{
      const map=richSearchMap();
      if(!replaceRichRange(richRangeForLogicalOffsets(match[0],match[1],map),el.replaceInput.value))return;
    }
    markDirtyFromEditor();updateLineNumbers();scheduleSpellcheck();refreshFindMatches();
  }

  function replaceAll(){
    const needle=el.findInput.value;
    if(!needle)return;
    const replacement=el.replaceInput.value;

    if(isSourceTab()){
      const flags=el.findCaseToggle.checked?'g':'gi';
      const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      el.markdownSource.value=el.markdownSource.value.replace(new RegExp(escaped,flags),()=>replacement);
    }else{
      const map=richSearchMap();
      const hay=el.findCaseToggle.checked?map.text:map.text.toLowerCase();
      const nd=el.findCaseToggle.checked?needle:needle.toLowerCase();
      const matches=[];
      let pos=0;
      while((pos=hay.indexOf(nd,pos))>=0){
        matches.push([pos,pos+needle.length]);
        pos+=Math.max(1,needle.length);
      }
      for(let i=matches.length-1;i>=0;i--){
        replaceRichRange(
          richRangeForLogicalOffsets(matches[i][0],matches[i][1],map),
          replacement,
          {cleanup:false}
        );
      }
      cleanupEmptyRichInlineFormatting();
      el.editor.normalize();
    }
    markDirtyFromEditor();updateLineNumbers();scheduleSpellcheck();refreshFindMatches();
  }

  function selectionInsideList() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.anchorNode;
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return !!node?.closest?.('li');
  }

  function insertTabAtSelection() {
    const sel=getSelection(); if(!sel||!sel.rangeCount)return;
    const range=sel.getRangeAt(0); if(!el.editor.contains(range.commonAncestorContainer))return;
    const rect=range.getBoundingClientRect(), er=el.editor.getBoundingClientRect();
    const current=Math.max(0,rect.left-er.left), stops=(currentTab()?.layout?.tabs||[48]).filter(x=>x>current+3);
    const next=stops.length?stops[0]:Math.ceil((current+1)/48)*48;
    const span=document.createElement('span');span.dataset.tab='1';span.style.display='inline-block';span.style.width=`${Math.max(12,next-current)}px`;span.innerHTML='&nbsp;';
    range.deleteContents();range.insertNode(span);range.setStartAfter(span);range.collapse(true);sel.removeAllRanges();sel.addRange(range);markDirtyFromEditor();
  }
