  // ===========================================================================
  // FIND / REPLACE
  // ===========================================================================

  function openFindBar(replace=false){
    if (!requireActiveDocument()) return;
    el.findBar.hidden=false; el.replaceInput.style.display=replace?'':'none'; el.replaceOneBtn.style.display=replace?'':'none'; el.replaceAllBtn.style.display=replace?'':'none';
    setTimeout(()=>{el.findInput.focus();el.findInput.select();},0); refreshFindMatches();
  }
  function closeFindBar(){el.findBar.hidden=true;findMatches=[];findIndex=-1;el.editor.focus();}
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

  function selectFindMatch(start,end){
    if(isSourceTab()){
      if(isMarkdownTab())setMarkdownMode('edit',{focus:false});
      el.markdownSource.focus();
      el.markdownSource.setSelectionRange(start,end);
      return true;
    }
    const range=richRangeForLogicalOffsets(start,end);
    if(!range)return false;
    const sel=getSelection();sel.removeAllRanges();sel.addRange(range);el.editor.focus();
    return true;
  }

  function refreshFindMatches(){
    const needle=el.findInput.value;findMatches=[];findIndex=-1;
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
    el.findMatchCount.textContent=findMatches.length?`1/${findMatches.length}`:'0/0';
    if(findMatches.length){findIndex=0;selectFindMatch(...findMatches[0]);}
  }

  function selectTextOffsets(start,end){
    if(isSourceTab()){
      if(isMarkdownTab())setMarkdownMode('edit',{focus:false});
      el.markdownSource.focus();el.markdownSource.setSelectionRange(start,end);return;
    }
    selectFindMatch(start,end);
  }

  function stepFind(dir){
    if(!findMatches.length)return;
    findIndex=(findIndex+dir+findMatches.length)%findMatches.length;
    selectFindMatch(...findMatches[findIndex]);
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
