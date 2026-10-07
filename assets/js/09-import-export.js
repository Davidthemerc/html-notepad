  // ===========================================================================
  // IMPORT / EXPORT & FILE OPERATIONS
  // ===========================================================================

  function htmlToPlainText(source) {
    const d=document.createElement('div'); d.innerHTML=source||'';
    d.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));
    d.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach(n=>{ if(!n.textContent.endsWith('\n')) n.append('\n'); });
    return (d.textContent||'').replace(/\n{3,}/g,'\n\n').replace(/\u00a0/g,' ');
  }

  function safeDiskName(name, ext) {
    let base=String(name||'Untitled').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').trim()||'Untitled';
    base=base.replace(/\.(txt|html?|rtf|md|markdown|json)$/i,'');
    return base+ext;
  }

  function downloadBlob(name, content, type) {
    const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function selectedRealFile() {
    if (selectedFileIds.size !== 1) return null;
    const f=files.find(x=>x.id===selectedFileId && selectedFileIds.has(x.id));
    if (!f || f.type==='folder') return null;
    if (isProtectedRecord(f)) return unlockedProtectedTab(f.id) || f;
    return f;
  }

  function rtfEscapeText(value) {
    let out = '';
    const text = String(value ?? '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const char = text[i];
      if (char === '\\' || char === '{' || char === '}') out += '\\' + char;
      else if (char === '\n') out += '\\line ';
      else if (code >= 0x20 && code <= 0x7e) out += char;
      else {
        const signed = code > 32767 ? code - 65536 : code;
        out += `\\u${signed}?`;
      }
    }
    return out;
  }

  function rtfCssColor(value) {
    const color = String(value || '').trim().toLowerCase();
    let m = color.match(/^#([0-9a-f]{6})$/i);
    if (m) return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];
    m = color.match(/^#([0-9a-f]{3})$/i);
    if (m) return [...m[1]].map(ch => parseInt(ch + ch, 16));
    m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [Number(m[1]),Number(m[2]),Number(m[3])].map(n=>Math.max(0,Math.min(255,n)));
    const named = {
      black:[0,0,0],white:[255,255,255],red:[255,0,0],green:[0,128,0],blue:[0,0,255],
      yellow:[255,255,0],orange:[255,165,0],purple:[128,0,128],gray:[128,128,128],grey:[128,128,128],
      maroon:[128,0,0],navy:[0,0,128],teal:[0,128,128],olive:[128,128,0],silver:[192,192,192]
    };
    return named[color] || null;
  }

  function rtfFontName(value) {
    return String(value || '').split(',')[0].trim().replace(/^['"]|['"]$/g,'') || 'Arial';
  }

  function rtfPointSize(value, tagName = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (/^\d+(?:\.\d+)?pt$/.test(raw)) return Math.max(6, Math.min(144, parseFloat(raw)));
    if (/^\d+(?:\.\d+)?px$/.test(raw)) return Math.max(6, Math.min(144, parseFloat(raw) * .75));
    if (tagName === 'FONT' && /^\d$/.test(raw)) {
      return ({1:8,2:10,3:12,4:14,5:18,6:24,7:36})[Number(raw)] || 12;
    }
    return null;
  }

  function rtfImageDimensions(bytes, mime) {
    if (mime === 'image/png' && bytes.length >= 24) {
      const width = ((bytes[16]<<24)>>>0) + (bytes[17]<<16) + (bytes[18]<<8) + bytes[19];
      const height = ((bytes[20]<<24)>>>0) + (bytes[21]<<16) + (bytes[22]<<8) + bytes[23];
      return {width,height};
    }
    if ((mime === 'image/jpeg' || mime === 'image/jpg') && bytes.length > 4) {
      let i = 2;
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i+1];
        i += 2;
        if (marker === 0xd8 || marker === 0xd9) continue;
        if (i + 1 >= bytes.length) break;
        const len = (bytes[i] << 8) + bytes[i+1];
        if (len < 2 || i + len > bytes.length) break;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return {height:(bytes[i+3]<<8)+bytes[i+4],width:(bytes[i+5]<<8)+bytes[i+6]};
        }
        i += len;
      }
    }
    return {width:640,height:480};
  }

  function rtfImage(asset, imageNode) {
    const match = String(asset?.dataUrl || '').match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);
    if (!match) return rtfEscapeText(`[Image: ${imageNode.getAttribute('alt') || asset?.name || 'image'}]`);
    const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    let binary;
    try { binary = atob(match[2]); } catch { return rtfEscapeText('[Image]'); }
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const {width,height} = rtfImageDimensions(bytes,mime);
    const pageWidthTwips = 9360; // approximately 6.5 inches of usable Letter-page width
    const styleWidth = String(imageNode.style.width || '').trim();
    let goalWidth = Math.min(pageWidthTwips, Math.max(300, width * 15));
    if (/^\d+(?:\.\d+)?%$/.test(styleWidth)) goalWidth = pageWidthTwips * parseFloat(styleWidth) / 100;
    else if (/^\d+(?:\.\d+)?px$/.test(styleWidth)) goalWidth = Math.min(pageWidthTwips, parseFloat(styleWidth) * 15);
    const goalHeight = Math.max(1, Math.round(goalWidth * height / Math.max(1,width)));
    let hex = '';
    for (let i=0;i<bytes.length;i++) {
      hex += bytes[i].toString(16).padStart(2,'0');
      if ((i+1)%64===0) hex += '\n';
    }
    const kind = mime === 'image/png' ? '\\pngblip' : '\\jpegblip';
    return `{\\pict${kind}\\picw${width}\\pich${height}\\picwgoal${Math.round(goalWidth)}\\pichgoal${goalHeight}\n${hex}\n}`;
  }

  async function htmlToRtf(source) {
    const root = document.createElement('div');
    root.innerHTML = source || '';

    const assetIds = [...new Set([...root.querySelectorAll('img[data-asset-id]')].map(img=>img.dataset.assetId).filter(Boolean))];
    const assetPairs = await Promise.all(assetIds.map(async id => [id, await storeGet(ASSET_STORE,id)]));
    const assets = new Map(assetPairs);

    const fonts = ['Arial'];
    const colors = [];
    const addFont = name => {
      name = rtfFontName(name);
      if (!fonts.some(existing => existing.toLowerCase() === name.toLowerCase())) fonts.push(name);
      return fonts.findIndex(existing => existing.toLowerCase() === name.toLowerCase());
    };
    const addColor = value => {
      const rgb = rtfCssColor(value);
      if (!rgb) return 0;
      let index = colors.findIndex(c => c[0]===rgb[0] && c[1]===rgb[1] && c[2]===rgb[2]);
      if (index < 0) { colors.push(rgb); index=colors.length-1; }
      return index + 1;
    };

    root.querySelectorAll('*').forEach(node => {
      if (node.tagName === 'FONT') {
        if (node.getAttribute('face')) addFont(node.getAttribute('face'));
        if (node.getAttribute('color')) addColor(node.getAttribute('color'));
      }
      if (node.style?.fontFamily) addFont(node.style.fontFamily);
      if (node.style?.color) addColor(node.style.color);
    });

    const inlineWrap = (node, content) => {
      const tag = node.tagName;
      const controls = [];
      if (tag === 'B' || tag === 'STRONG' || /bold|[6-9]00/.test(node.style?.fontWeight || '')) controls.push('\\b');
      if (tag === 'I' || tag === 'EM' || node.style?.fontStyle === 'italic') controls.push('\\i');
      if (tag === 'U' || (node.style?.textDecoration || '').includes('underline')) controls.push('\\ul');
      if (tag === 'S' || tag === 'STRIKE' || (node.style?.textDecoration || '').includes('line-through')) controls.push('\\strike');

      const family = tag === 'FONT' ? node.getAttribute('face') : node.style?.fontFamily;
      if (family) controls.push(`\\f${addFont(family)}`);

      const sizeValue = tag === 'FONT' ? node.getAttribute('size') : node.style?.fontSize;
      const points = rtfPointSize(sizeValue, tag);
      if (points) controls.push(`\\fs${Math.round(points*2)}`);

      const colorValue = tag === 'FONT' ? node.getAttribute('color') : node.style?.color;
      if (colorValue) {
        const ci = addColor(colorValue);
        if (ci) controls.push(`\\cf${ci}`);
      }
      return controls.length ? `{${controls.join(' ')} ${content}}` : content;
    };

    const alignmentControl = node => {
      const align = String(node.style?.textAlign || node.getAttribute?.('align') || '').toLowerCase();
      return align === 'center' ? '\\qc' : align === 'right' ? '\\qr' : align === 'justify' ? '\\qj' : '\\ql';
    };

    const renderChildren = (node, listDepth=0) => [...node.childNodes].map(child => renderNode(child,listDepth)).join('');

    const renderList = (node, ordered, depth) => {
      let out = '';
      let number = 1;
      for (const child of [...node.children]) {
        if (child.tagName !== 'LI') continue;
        const nested = [...child.children].filter(el => el.tagName === 'UL' || el.tagName === 'OL');
        const bodyNodes = [...child.childNodes].filter(n => !(n.nodeType===Node.ELEMENT_NODE && (n.tagName==='UL'||n.tagName==='OL')));
        const body = bodyNodes.map(n => renderNode(n,depth+1)).join('');
        const left = 720 + depth * 360;
        const prefix = ordered ? `${number++}.` : '\\bullet';
        out += `\\pard\\li${left}\\fi-360 ${prefix}\\tab ${body}\\par\n`;
        for (const sub of nested) out += renderList(sub, sub.tagName === 'OL', depth+1);
      }
      return out;
    };

    const renderNode = (node, listDepth=0) => {
      if (node.nodeType === Node.TEXT_NODE) return rtfEscapeText(node.nodeValue || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;

      if (tag === 'BR') return '\\line ';
      if (tag === 'IMG') {
        const asset = assets.get(node.dataset.assetId);
        const pict = asset ? rtfImage(asset,node) : rtfEscapeText(`[Image: ${node.getAttribute('alt') || 'image'}]`);
        const align = node.dataset.align === 'center' ? '\\qc' : node.dataset.align === 'right' ? '\\qr' : '\\ql';
        return `\\pard${align} ${pict}\\par\n`;
      }
      if (tag === 'UL') return renderList(node,false,listDepth);
      if (tag === 'OL') return renderList(node,true,listDepth);
      if (tag === 'LI') return inlineWrap(node,renderChildren(node,listDepth));
      if (tag === 'HR') return '\\pard\\qc ' + rtfEscapeText('────────────') + '\\par\n';

      const block = ['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE'].includes(tag);
      let content = renderChildren(node,listDepth);
      content = inlineWrap(node,content);

      if (tag === 'H1') content = `{\\b\\fs36 ${content}}`;
      else if (tag === 'H2') content = `{\\b\\fs30 ${content}}`;
      else if (tag === 'H3') content = `{\\b\\fs26 ${content}}`;
      else if (tag === 'H4') content = `{\\b\\fs24 ${content}}`;
      else if (tag === 'H5') content = `{\\b\\fs22 ${content}}`;
      else if (tag === 'H6') content = `{\\b\\fs20 ${content}}`;
      else if (tag === 'PRE') content = `{\\f${addFont('Courier New')} ${content}}`;

      if (block) {
        const indent = tag === 'BLOCKQUOTE' ? '\\li720' : '';
        return `\\pard${alignmentControl(node)}${indent} ${content}\\par\n`;
      }
      return content;
    };

    const body = [...root.childNodes].map(node => renderNode(node,0)).join('');
    const fontTable = fonts.map((font,index)=>`{\\f${index}\\fnil ${rtfEscapeText(font)};}`).join('');
    const colorTable = ';' + colors.map(([r,g,b])=>`\\red${r}\\green${g}\\blue${b};`).join('');
    return `{\\rtf1\\ansi\\deff0\\uc1\n{\\fonttbl${fontTable}}\n{\\colortbl${colorTable}}\n\\viewkind4\\pard\\f0\\fs24\n${body}\n}`;
  }

  async function exportSelectedRtf() {
    const f=selectedRealFile();
    if(!f)return toast('Select a file first.');
    if(f.protected && !protectedSessions.has(f.fileId || f.id))return toast('Unlock the protected file before exporting it.');
    if(f.docType!=='rich')return toast('RTF export is available for Rich Text documents.');
    try {
      const rtf=await htmlToRtf(f.content||'');
      downloadBlob(safeDiskName(f.name,'.rtf'),rtf,'application/rtf');
      status(`Exported ${f.name} as RTF.`);
    } catch (error) {
      console.error(error);
      toast('RTF export failed.');
    }
  }

  function exportSelectedTxt() {
    const f=selectedRealFile(); if(!f)return toast('Select a file first.');
    if(f.protected && !protectedSessions.has(f.fileId || f.id))return toast('Unlock the protected file before exporting it.');
    downloadBlob(safeDiskName(f.name,'.txt'),(f.docType==='plain'||f.docType==='markdown')?(f.content||''):htmlToPlainText(f.content||''),'text/plain;charset=utf-8');
  }

  function exportSelectedHtml() {
    const f=selectedRealFile(); if(!f)return toast('Select a file first.');
    if(f.protected && !protectedSessions.has(f.fileId || f.id))return toast('Unlock the protected file before exporting it.');
    const body=f.docType==='markdown'?renderMarkdown(f.content||''):(f.docType==='plain'?`<pre>${escapeHtmlText(f.content||'')}</pre>`:(f.content||''));
    const title=String(f.name||'Notepad Document').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const doc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title></head><body>'+body+'</body></html>';
    downloadBlob(safeDiskName(f.name,'.html'),doc,'text/html;charset=utf-8');
  }

  async function importDocuments(fileList) {
    const importedIds = [];
    for (const disk of [...fileList]) {
      try {
        const raw = await disk.text();
        const isHtml = /\.html?$/i.test(disk.name) || disk.type === 'text/html';
        const isMarkdown = /\.(md|markdown)$/i.test(disk.name) || disk.type === 'text/markdown';
        const content = isMarkdown ? raw : (isHtml ? sanitizeImportedHtml(raw) : escapePlainTextToHtml(raw));
        let name = disk.name.replace(/\.(txt|html?|md|markdown)$/i, '') || 'Imported';
        let candidate = name, n = 2;
        while (files.some(file => file.name.toLowerCase() === candidate.toLowerCase())) candidate = `${name} ${n++}`;

        const now = new Date().toISOString();
        const imported = {
          id:uid(), type:'file', docType:isMarkdown ? 'markdown' : (isHtml ? 'rich' : 'plain'),
          parentId:null, name:candidate, content,
          createdAt:now, updatedAt:now, order:files.length + importedIds.length
        };
        await idbPut(imported);
        importedIds.push(imported.id);
      } catch {
        toast(`Could not import ${disk.name}.`);
      }
    }

    await refreshFiles();

    // Import is also an open action: each successfully imported document gets a tab.
    // Opening in selection order leaves the final imported document active.
    for (const id of importedIds) await openFile(id);

    if (importedIds.length) {
      status(`Imported and opened ${importedIds.length} file${importedIds.length === 1 ? '' : 's'}.`);
    }
  }

  function escapePlainTextToHtml(text) {
    return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r\n?/g,'\n').replace(/\n/g,'<br>');
  }

  function sanitizeImportedHtml(raw) {
    const parser=new DOMParser(), d=parser.parseFromString(raw,'text/html');
    d.querySelectorAll('script,iframe,object,embed,link,meta,base,style').forEach(n=>n.remove());
    d.querySelectorAll('*').forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||/^(src|srcset)$/i.test(a.name)||(a.name==='href'&&/^\s*javascript:/i.test(a.value)))n.removeAttribute(a.name);}));
    return d.body.innerHTML;
  }

  function addRecent(fileId) {
    recentFileIds=[fileId,...recentFileIds.filter(id=>id!==fileId)].slice(0,5);
    localStorage.setItem(LS_RECENT_FILES,JSON.stringify(recentFileIds));
  }

  function showRecentMenu() {
    const menu=document.getElementById('recentMenu'); menu.innerHTML='';
    const recent=recentFileIds.map(id=>files.find(f=>f.id===id&&f.type!=='folder')).filter(Boolean);
    if(!recent.length){const e=document.createElement('div');e.className='empty-recent';e.textContent='No recent files';menu.appendChild(e);}
    else recent.forEach(f=>{const b=document.createElement('button');b.type='button';b.textContent=`${protectionGlyphForFile(f)}${protectionGlyphForFile(f)?' ':''}${f.name}`;b.onclick=()=>{menu.hidden=true;openFile(f.id)};menu.appendChild(b);});
    const r=el.openBtn.getBoundingClientRect(); menu.hidden=false; menu.style.left=`${Math.min(r.left,innerWidth-250)}px`;menu.style.top=`${r.bottom+4}px`;
  }

  function clearFormatting() {
    if (!requireActiveDocument()) return;
    restoreEditorSelection(); el.editor.focus();
    try { document.execCommand('removeFormat',false,null); } catch {}
    markDirtyFromEditor(); updateFormatState();
  }


  function openMoveDialog() {
    const item=requireSingleFilesystemSelection('move it'); if(!item)return;
    selectedFileId=item.id;
    el.moveFolderSelect.innerHTML='<option value="">Files root</option>';
    const descendants=new Set([item.id]); let changed=true;
    while(changed){changed=false;for(const f of files){if(f.parentId&&descendants.has(f.parentId)&&!descendants.has(f.id)){descendants.add(f.id);changed=true;}}}
    files.filter(f=>f.type==='folder'&&!descendants.has(f.id)).forEach(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=folderLabel(f);el.moveFolderSelect.appendChild(o);});
    el.moveFolderSelect.value=item.parentId||''; el.moveDialog.showModal();
  }

  async function moveSelectedConfirmed() {
    const item=files.find(f=>f.id===selectedFileId); if(!item)return;
    item.parentId=el.moveFolderSelect.value||null; await idbPut(item); el.moveDialog.close(); await refreshFiles(); status('Moved.');
  }

  async function newFolderInside(parentId) {
    const parent=files.find(f=>f.id===parentId&&f.type==='folder'); if(!parent)return;
    const raw=await askForName({title:'New Folder',initial:'',confirmText:'Create',note:`Create inside “${parent.name}”.`});
    if(raw===null)return; const name=normalizeName(raw); if(!name)return toast('Enter a folder name.');
    if(files.some(f=>f.parentId===parent.id&&f.name.toLowerCase()===name.toLowerCase()))return toast('That name is already in this folder.');
    const now=new Date().toISOString();
    await idbPut({id:uid(),type:'folder',name,content:'',parentId:parent.id,createdAt:now,updatedAt:now,order:files.length});
    expandedFolders.add(parent.id);persistExpandedFolders();await refreshFiles();
  }

  async function newFolder() {
    const raw=await askForName({title:'New Folder',initial:'',confirmText:'Create',note:'Folders organize files inside Notepad.'});
    if(raw===null)return;
    const name=normalizeName(raw); if(!name)return toast('Enter a folder name.');
    if(files.some(f=>f.name.toLowerCase()===name.toLowerCase())) return toast('That name is already in use.');
    const now=new Date().toISOString();
    await idbPut({id:uid(),type:'folder',name,content:'',parentId:null,createdAt:now,updatedAt:now,order:files.length});
    await refreshFiles();
  }

  async function duplicateSelected() {
    const item=requireSingleFilesystemSelection('duplicate it'); if(!item)return;
    selectedFileId=item.id; if(item.type==='folder') return toast('Select a file to duplicate.');
    if(isProtectedRecord(item)) return toast('Open the protected document and use Save As to create a new protected copy.');
    let base=item.name.replace(/\s+copy(?: \d+)?$/i,''); let n=1, name=`${base} copy`;
    while(files.some(f=>f.name.toLowerCase()===name.toLowerCase())) name=`${base} copy ${++n}`;
    const now=new Date().toISOString();
    await idbPut({...item,id:uid(),name,createdAt:now,updatedAt:now,order:files.length});
    await refreshFiles(); toast('File duplicated.');
  }

  function normalizeName(name) {
    return name.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 160);
  }

  function uniqueUntitledName() {
    let n = 1;
    while (tabs.some(t => t.name === (n === 1 ? 'Untitled' : `Untitled ${n}`))) n++;
    return n === 1 ? 'Untitled' : `Untitled ${n}`;
  }

  function askForName({ title = 'Save As', initial = '', confirmText = 'Save', note = '' } = {}) {
    if (nameDialogResolver) return Promise.resolve(null);
    el.nameDialogTitle.textContent = title;
    el.nameInput.value = initial;
    el.nameConfirmBtn.textContent = confirmText;
    el.nameDialogNote.textContent = note || 'This file is stored inside IndexedDB, not as a normal disk file.';
    el.nameDialog.showModal();
    setTimeout(() => { el.nameInput.focus(); el.nameInput.select(); }, 0);
    return new Promise(resolve => { nameDialogResolver = resolve; });
  }

  function finishNameDialog(value) {
    if (!nameDialogResolver) return;
    const resolve = nameDialogResolver;
    nameDialogResolver = null;
    el.nameDialog.close();
    resolve(value);
  }

  let appConfirmResolver=null,appConfirmPreviousFocus=null;

  function appConfirm(message, {
    title = 'Confirm',
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = false
  } = {}) {
    // Only one app confirmation can be active at a time. Returning false for a second
    // request is safer than leaving two promises fighting over the same dialog controls.
    if (appConfirmResolver) return Promise.resolve(false);

    const dialog = $('appConfirmDialog');
    const okButton = $('appConfirmOkBtn');
    const cancelButton = $('appConfirmCancelBtn');
    appConfirmPreviousFocus = document.activeElement;

    $('appConfirmTitle').textContent = title;
    $('appConfirmMessage').textContent = message;
    okButton.textContent = confirmText;
    cancelButton.textContent = cancelText;
    okButton.classList.toggle('danger', danger);
    okButton.classList.toggle('primary', !danger);

    dialog.showModal();
    setTimeout(() => cancelButton.focus(), 0);
    return new Promise(resolve => { appConfirmResolver = resolve; });
  }

  function finishAppConfirm(value) {
    if (!appConfirmResolver) return;

    const resolve = appConfirmResolver;
    appConfirmResolver = null;
    const dialog = $('appConfirmDialog');
    if (dialog.open) dialog.close();

    // Restore keyboard focus to the control that opened the dialog when possible.
    const previousFocus = appConfirmPreviousFocus;
    appConfirmPreviousFocus = null;
    if (previousFocus?.isConnected) setTimeout(() => previousFocus.focus(), 0);
    resolve(!!value);
  }

  let splitOverrideResolver = null;
  let splitOverridePreviousFocus = null;

  function chooseSplitOverride(fileName, leftName, rightName) {
    if (splitOverrideResolver) return Promise.resolve(null);

    const dialog = $('splitOverrideDialog');
    splitOverridePreviousFocus = document.activeElement;
    $('splitOverrideMessage').textContent =
      `Both sides are occupied. Choose the side where “${fileName}” should open. The document currently shown there will remain open as a tab.`;
    $('splitOverrideLeftName').textContent = leftName || 'Empty';
    $('splitOverrideRightName').textContent = rightName || 'Empty';

    dialog.showModal();
    setTimeout(() => $('splitOverrideCancelBtn').focus(), 0);
    return new Promise(resolve => { splitOverrideResolver = resolve; });
  }

  function finishSplitOverride(side) {
    if (!splitOverrideResolver) return;
    const resolve = splitOverrideResolver;
    splitOverrideResolver = null;

    const dialog = $('splitOverrideDialog');
    if (dialog.open) dialog.close();

    const previousFocus = splitOverridePreviousFocus;
    splitOverridePreviousFocus = null;
    if (previousFocus?.isConnected) setTimeout(() => previousFocus.focus(), 0);
    resolve(side === 'left' || side === 'right' ? side : null);
  }
