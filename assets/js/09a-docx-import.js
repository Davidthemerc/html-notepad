  // ===========================================================================
  // WORD (.docx) IMPORT
  // ===========================================================================
  // Deliberately small: no libraries, no full Word compatibility. It reads the zip container,
  // converts body text (paragraphs, bold/italic/underline/strike, links, simple lists, tables,
  // images) to rich-text HTML, carries over the Heading 1-6 styles (font, size, colour, weight)
  // defined in the document's styles.xml, and detects a Table of Contents so the Outline panel
  // can offer the same quick jumping. The static TOC itself (page numbers are meaningless here)
  // is dropped from the imported text.

  const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DOCX_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  async function docxReadZip(buffer) {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
      const method = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const nameLength = view.getUint16(ptr + 28, true), extraLength = view.getUint16(ptr + 30, true), commentLength = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      entries.set(decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLength)), { method, compressedSize, localOffset });
      ptr += 46 + nameLength + extraLength + commentLength;
    }
    const read = async name => {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method !== 8) throw new Error('Unsupported zip compression');
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unzip Word files');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    return { has: name => entries.has(name), read, names: () => [...entries.keys()] };
  }

  function docxParseXml(bytes) {
    if (!bytes) return null;
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }

  const wChildren = (node, name) => node ? [...node.children].filter(c => c.localName === name && c.namespaceURI === DOCX_NS) : [];
  const wFirst = (node, name) => wChildren(node, name)[0] || null;
  const wAttr = (node, name) => node ? (node.getAttributeNS(DOCX_NS, name) ?? node.getAttribute(`w:${name}`)) : null;
  const wOn = node => !!node && !['0', 'false', 'off', 'none'].includes((wAttr(node, 'val') || 'true').toLowerCase());

  // styleId -> { name, basedOn, level, font, size, color, bold, italic }
  function docxReadStyles(doc) {
    const styles = new Map();
    if (!doc) return { styles, defaults: {} };
    const defaultsRpr = wFirst(wFirst(wFirst(doc.documentElement, 'docDefaults'), 'rPrDefault'), 'rPr');
    const defaults = docxRunProps(defaultsRpr);
    for (const node of wChildren(doc.documentElement, 'style')) {
      const id = wAttr(node, 'styleId');
      if (!id) continue;
      const pPr = wFirst(node, 'pPr'), outline = wFirst(pPr, 'outlineLvl');
      styles.set(id, {
        id, type: wAttr(node, 'type'), name: wAttr(wFirst(node, 'name'), 'val') || id,
        basedOn: wAttr(wFirst(node, 'basedOn'), 'val'),
        outline: outline ? Number(wAttr(outline, 'val')) : null,
        spacingBefore: wAttr(wFirst(pPr, 'spacing'), 'before'), spacingAfter: wAttr(wFirst(pPr, 'spacing'), 'after'),
        run: docxRunProps(wFirst(node, 'rPr'))
      });
    }
    return { styles, defaults };
  }

  function docxRunProps(rPr) {
    const props = {};
    if (!rPr) return props;
    const fonts = wFirst(rPr, 'rFonts');
    if (fonts) props.font = wAttr(fonts, 'ascii') || wAttr(fonts, 'hAnsi') || wAttr(fonts, 'cs');
    const size = wFirst(rPr, 'sz');
    if (size) props.size = Number(wAttr(size, 'val')) / 2;           // half-points -> pt
    const color = wFirst(rPr, 'color');
    if (color && wAttr(color, 'val') && wAttr(color, 'val') !== 'auto') props.color = wAttr(color, 'val');
    if (wFirst(rPr, 'b')) props.bold = wOn(wFirst(rPr, 'b'));
    if (wFirst(rPr, 'i')) props.italic = wOn(wFirst(rPr, 'i'));
    if (wFirst(rPr, 'u')) props.underline = wOn(wFirst(rPr, 'u'));
    if (wFirst(rPr, 'strike')) props.strike = wOn(wFirst(rPr, 'strike'));
    const va = wAttr(wFirst(rPr, 'vertAlign'), 'val');
    if (va) props.vertAlign = va;
    const hl = wAttr(wFirst(rPr, 'highlight'), 'val');
    if (hl && hl !== 'none') props.highlight = hl;
    return props;
  }

  // Heading level (1-6) of a paragraph style, following basedOn; null if it is not a heading.
  function docxStyleHeadingLevel(styles, styleId, guard = 0) {
    const style = styles.get(styleId);
    if (!style || guard > 10) return null;
    const byId = /^heading\s*([1-9])$/i.exec(style.id) || /^heading\s*([1-9])$/i.exec(style.name || '');
    if (byId) return Math.min(6, Number(byId[1]));
    if (style.outline !== null && style.outline >= 0 && style.outline <= 5) return style.outline + 1;
    return style.basedOn ? docxStyleHeadingLevel(styles, style.basedOn, guard + 1) : null;
  }

  function docxResolveRun(styles, styleId, guard = 0) {
    const style = styles.get(styleId);
    if (!style || guard > 10) return {};
    return { ...(style.basedOn ? docxResolveRun(styles, style.basedOn, guard + 1) : {}), ...style.run };
  }

  const DOCX_HIGHLIGHTS = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkYellow: '#808000', lightGray: '#d3d3d3', darkGray: '#808080' };

  function docxFontStack(font) {
    const clean = String(font || '').replace(/["'<>;]/g, '').trim();
    return clean ? `"${clean}", sans-serif` : '';
  }

  function docxNumbering(doc) {
    // numId -> ilvl -> 'ol' | 'ul'
    const result = new Map();
    if (!doc) return result;
    const abstracts = new Map();
    for (const abs of wChildren(doc.documentElement, 'abstractNum')) {
      const levels = new Map();
      for (const lvl of wChildren(abs, 'lvl')) {
        const fmt = wAttr(wFirst(lvl, 'numFmt'), 'val');
        levels.set(Number(wAttr(lvl, 'ilvl')), fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol');
      }
      abstracts.set(wAttr(abs, 'abstractNumId'), levels);
    }
    for (const num of wChildren(doc.documentElement, 'num')) {
      const abstract = abstracts.get(wAttr(wFirst(num, 'abstractNumId'), 'val'));
      if (abstract) result.set(wAttr(num, 'numId'), abstract);
    }
    return result;
  }

  async function importDocxFile(file) {
    const zip = await docxReadZip(await file.arrayBuffer());
    const documentXml = docxParseXml(await zip.read('word/document.xml'));
    if (!documentXml) throw new Error('word/document.xml is missing');
    const { styles, defaults } = docxReadStyles(docxParseXml(await zip.read('word/styles.xml')));
    const numbering = docxNumbering(docxParseXml(await zip.read('word/numbering.xml')));

    const rels = new Map();
    const relsXml = docxParseXml(await zip.read('word/_rels/document.xml.rels'));
    if (relsXml) for (const rel of relsXml.getElementsByTagName('Relationship')) {
      rels.set(rel.getAttribute('Id'), { target: rel.getAttribute('Target') || '', external: rel.getAttribute('TargetMode') === 'External' });
    }

    const assets = [];
    const state = { toc: null, headings: 0, images: 0, skippedImages: 0 };
    const imageCache = new Map();

    const imageHtml = async blip => {
      const rid = blip.getAttributeNS(DOCX_REL_NS, 'embed') || blip.getAttribute('r:embed');
      const rel = rels.get(rid);
      if (!rel || rel.external) return null;
      const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`.replace(/\/\.\//g, '/');
      const mime = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : /\.svg$/i.test(path) ? null : null;
      if (!mime || !zip.has(path)) { state.skippedImages++; return null; }
      if (!imageCache.has(path)) {
        const data = await zip.read(path);
        const blob = new Blob([data], { type: mime });
        const id = uid();
        assets.push({ id, dataUrl: await fileToDataUrl(blob), mime, size: blob.size, name: path.split('/').pop(), createdAt: new Date().toISOString() });
        imageCache.set(path, id);
      }
      state.images++;
      return imageCache.get(path);
    };

    const runToNodes = async (run, linkHref) => {
      const nodes = [];
      const rPr = wFirst(run, 'rPr');
      const rStyle = wAttr(wFirst(rPr, 'rStyle'), 'val');
      const direct = docxRunProps(rPr);
      const props = { ...docxResolveRun(styles, rStyle), ...direct };
      let text = '';
      const flush = () => {
        if (!text) return;
        let node = document.createTextNode(text);
        const wrap = tag => { const el2 = document.createElement(tag); el2.appendChild(node); node = el2; };
        if (props.bold) wrap('b');
        if (props.italic) wrap('i');
        if (props.underline && !linkHref) wrap('u');
        if (props.strike) wrap('s');
        if (props.vertAlign === 'superscript') wrap('sup'); else if (props.vertAlign === 'subscript') wrap('sub');
        const css = [];
        if (direct.font) css.push(`font-family:${docxFontStack(direct.font)}`);
        if (direct.size) css.push(`font-size:${direct.size}pt`);
        if (props.color && /^[0-9a-f]{6}$/i.test(props.color)) css.push(`color:#${props.color}`);
        if (props.highlight && DOCX_HIGHLIGHTS[props.highlight]) css.push(`background-color:${DOCX_HIGHLIGHTS[props.highlight]}`);
        if (css.length) { const span = document.createElement('span'); span.style.cssText = css.join(';'); span.appendChild(node); node = span; }
        nodes.push(node);
        text = '';
      };
      for (const child of run.children) {
        const name = child.localName;
        if (name === 't') text += child.textContent;
        else if (name === 'tab') text += '    ';
        else if (name === 'noBreakHyphen') text += '‑';
        else if (name === 'br' || name === 'cr') { flush(); nodes.push(document.createElement('br')); }
        else if (name === 'drawing') {
          flush();
          const blip = child.getElementsByTagNameNS('*', 'blip')[0];
          const id = blip ? await imageHtml(blip) : null;
          if (id) {
            const img = document.createElement('img');
            img.dataset.assetId = id; img.alt = 'Image'; img.dataset.align = 'left';
            const extent = child.getElementsByTagNameNS('*', 'extent')[0];
            const widthPx = extent ? Math.round(Number(extent.getAttribute('cx')) / 9525) : 0;
            img.style.cssText = `width:${widthPx > 0 ? Math.min(widthPx, 640) + 'px' : '50%'};max-width:100%;height:auto`;
            nodes.push(img);
          } else if (child.getElementsByTagNameNS('*', 'blip').length) state.skippedImages++;
        }
      }
      flush();
      return nodes;
    };

    const inlineNodes = async paragraph => {
      const out = [];
      const walk = async (container, href) => {
        for (const child of container.children) {
          if (child.namespaceURI !== DOCX_NS) continue;
          if (child.localName === 'r') {
            const nodes = await runToNodes(child, href);
            if (href) {
              const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
              nodes.forEach(n => a.appendChild(n)); if (a.childNodes.length) out.push(a);
            } else out.push(...nodes);
          } else if (child.localName === 'hyperlink') {
            const rel = rels.get(child.getAttributeNS(DOCX_REL_NS, 'id') || child.getAttribute('r:id'));
            const safe = rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : null;
            await walk(child, safe);
          } else if (['ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(child.localName)) await walk(child, href);
        }
      };
      await walk(paragraph, null);
      return out;
    };

    const paragraphInfo = paragraph => {
      const pPr = wFirst(paragraph, 'pPr');
      const styleId = wAttr(wFirst(pPr, 'pStyle'), 'val');
      const style = styles.get(styleId);
      const direct = wFirst(pPr, 'outlineLvl');
      let level = docxStyleHeadingLevel(styles, styleId);
      if (direct && Number(wAttr(direct, 'val')) <= 5) level = Number(wAttr(direct, 'val')) + 1;
      const numPr = wFirst(pPr, 'numPr');
      const numId = numPr ? wAttr(wFirst(numPr, 'numId'), 'val') : null;
      return {
        styleId, style, level,
        isToc: /^toc(\d+|heading)?$/i.test(styleId || '') || /^toc\s*(\d+|heading)$/i.test(style?.name || ''),
        numId: numId && numId !== '0' ? numId : null,
        ilvl: numPr ? Number(wAttr(wFirst(numPr, 'ilvl'), 'val') || 0) : 0,
        align: wAttr(wFirst(pPr, 'jc'), 'val')
      };
    };

    const noteTocField = paragraph => {
      for (const instr of paragraph.getElementsByTagNameNS(DOCX_NS, 'instrText')) {
        const match = /^\s*TOC\b(.*)$/i.exec(instr.textContent || '');
        if (match) {
          const range = /\\o\s+"?(\d)\s*-\s*(\d)/i.exec(match[1]);
          state.toc = state.toc || { levels: range ? [Number(range[1]), Number(range[2])] : [1, 3] };
          if (range) state.toc.levels = [Number(range[1]), Number(range[2])];
        }
      }
    };

    const headingStyleCss = (level, styleId) => {
      const merged = { ...defaults };
      // Merge the style chain (basedOn first). A custom heading style (e.g. "Chapter Title" based
      // on Heading 1) uses its own chain; otherwise fall back to the built-in Heading N style.
      const chain = [];
      let id = styles.has(styleId) && docxStyleHeadingLevel(styles, styleId) === level
        ? styleId
        : [...styles.values()].find(s => docxStyleHeadingLevel(styles, s.id) === level && /^heading/i.test(s.name || s.id))?.id;
      for (let guard = 0; id && guard < 10; guard++) { chain.unshift(id); id = styles.get(id)?.basedOn; }
      chain.forEach(sid => Object.assign(merged, styles.get(sid)?.run || {}));
      const css = [];
      const stack = docxFontStack(merged.font);
      if (stack) css.push(`font-family:${stack}`);
      if (merged.size) css.push(`font-size:${merged.size}pt`);
      if (merged.color && /^[0-9a-f]{6}$/i.test(merged.color)) css.push(`color:#${merged.color}`);
      css.push(`font-weight:${merged.bold === false ? 'normal' : 'bold'}`);
      if (merged.italic) css.push('font-style:italic');
      return css.join(';');
    };
    const headingCssCache = new Map();
    const headingCss = (level, styleId) => {
      const key = `${level}|${styleId}`;
      if (!headingCssCache.has(key)) headingCssCache.set(key, headingStyleCss(level, styleId));
      return headingCssCache.get(key);
    };

    const root = document.createElement('div');
    let listStack = []; // [{ tag, el }]

    const closeLists = () => { listStack = []; };
    const appendBlock = node => { closeLists(); root.appendChild(node); };

    const paragraphToElement = async (paragraph, info) => {
      const inline = await inlineNodes(paragraph);
      const isHeading = info.level && inline.some(n => (n.textContent || '').trim());
      const block = document.createElement(isHeading ? `h${info.level}` : 'div');
      if (isHeading) { block.style.cssText = headingCss(info.level, info.styleId); state.headings++; }
      if (['center', 'right'].includes(info.align)) block.style.textAlign = info.align;
      else if (info.align === 'both') block.style.textAlign = 'justify';
      inline.forEach(n => block.appendChild(n));
      if (!block.childNodes.length) block.appendChild(document.createElement('br'));
      return block;
    };

    const convertBlock = async (node, target, inTable = false) => {
      if (node.namespaceURI !== DOCX_NS) return;
      if (node.localName === 'sdt') {
        const gallery = node.getElementsByTagNameNS(DOCX_NS, 'docPartGallery')[0];
        const isToc = /table of contents|toc/i.test(wAttr(gallery, 'val') || '');
        if (isToc && !inTable) { state.toc = state.toc || { levels: [1, 3] }; return; }
        const content = wFirst(node, 'sdtContent');
        if (content) for (const child of content.children) await convertBlock(child, target, inTable);
        return;
      }
      if (node.localName === 'p') {
        noteTocField(node);
        const info = paragraphInfo(node);
        if (info.isToc) { state.toc = state.toc || { levels: [1, 3] }; return; }
        const element = await paragraphToElement(node, info);
        if (info.numId && !info.level && !inTable) {
          const kind = numbering.get(info.numId)?.get(info.ilvl) || 'ul';
          while (listStack.length > info.ilvl + 1) listStack.pop();
          while (listStack.length < info.ilvl + 1 || listStack[listStack.length - 1].tag !== kind) {
            if (listStack.length && listStack.length === info.ilvl + 1 && listStack[listStack.length - 1].tag !== kind) listStack.pop();
            const list = document.createElement(kind);
            const parentItem = listStack.length ? listStack[listStack.length - 1].el.lastElementChild : null;
            (parentItem || (listStack.length ? listStack[listStack.length - 1].el : root)).appendChild(list);
            listStack.push({ tag: kind, el: list });
          }
          const item = document.createElement('li');
          while (element.firstChild) item.appendChild(element.firstChild);
          listStack[listStack.length - 1].el.appendChild(item);
          return;
        }
        if (inTable) target.appendChild(element); else appendBlock(element);
        return;
      }
      if (node.localName === 'tbl') {
        const table = document.createElement('table');
        table.style.cssText = 'border-collapse:collapse;max-width:100%';
        for (const row of wChildren(node, 'tr')) {
          const tr = document.createElement('tr');
          for (const cell of wChildren(row, 'tc')) {
            const td = document.createElement('td');
            td.style.cssText = 'border:1px solid #999;padding:4px 8px;vertical-align:top';
            const span = Number(wAttr(wFirst(wFirst(cell, 'tcPr'), 'gridSpan'), 'val') || 1);
            if (span > 1) td.colSpan = span;
            for (const child of cell.children) await convertBlock(child, td, true);
            if (!td.childNodes.length) td.appendChild(document.createElement('br'));
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        if (inTable) target.appendChild(table); else appendBlock(table);
      }
    };

    const body = wFirst(documentXml.documentElement, 'body');
    for (const child of body ? body.children : []) await convertBlock(child, root);

    return { html: root.innerHTML, assets, toc: state.toc, headings: state.headings, images: state.images, skippedImages: state.skippedImages };
  }
