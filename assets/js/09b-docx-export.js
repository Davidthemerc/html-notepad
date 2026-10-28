  // ===========================================================================
  // WORD (.docx) EXPORT
  // ===========================================================================
  // Basic export, not a full Word writer: headings become real Word Heading 1-6 styles (so Word's
  // Navigation pane and "Insert Table of Contents" work), plus text formatting, links, nested
  // lists, tables, images and alignment. Markdown documents are rendered first; plain text becomes
  // one paragraph per line.

  const DOCX_W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const docxXml = text => String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let docxCrcTable = null;
  function docxCrc32(bytes) {
    if (!docxCrcTable) {
      docxCrcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        docxCrcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = docxCrcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function docxDeflate(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // entries: [{ name, data: Uint8Array }] -> Blob (zip, deflated where the browser supports it)
  async function docxZip(entries) {
    const encoder = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name), crc = docxCrc32(entry.data);
      const packed = entry.data.length > 64 ? await docxDeflate(entry.data) : null;
      const useDeflate = packed && packed.length < entry.data.length;
      const data = useDeflate ? packed : entry.data, method = useDeflate ? 8 : 0;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, method, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, entry.data.length, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, method, true); dir.setUint16(12, 0, true); dir.setUint16(14, 0x21, true);
      dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, entry.data.length, true);
      dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function docxDataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function docxImageSize(dataUrl) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth || 300, image.naturalHeight || 200]);
      image.onerror = () => resolve([300, 200]);
      image.src = dataUrl;
    });
  }

  const docxCssColor = value => {
    const probe = document.createElement('span');
    probe.style.color = value;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(probe.style.color || '');
    return m ? [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
  };

  async function htmlToDocx(html) {
    const root = document.createElement('div');
    root.innerHTML = html || '';

    const rels = [];          // { id, type, target, external }
    const media = [];         // { name, data }
    const mediaByAsset = new Map();
    const numbering = [];     // numId -> { ordered }
    let nextRel = 1, nextDrawing = 1, usedBulletNum = false;
    const addRel = (type, target, external = false) => { const id = `rId${100 + nextRel++}`; rels.push({ id, type, target, external }); return id; };

    const assetIds = [...new Set([...root.querySelectorAll('img[data-asset-id]')].map(img => img.dataset.assetId))];
    const assets = new Map(await Promise.all(assetIds.map(async id => [id, await storeGet(ASSET_STORE, id)])));

    const runXml = (text, props) => {
      if (!text) return '';
      const pr = [];
      if (props.font) pr.push(`<w:rFonts w:ascii="${docxXml(props.font)}" w:hAnsi="${docxXml(props.font)}" w:cs="${docxXml(props.font)}"/>`);
      if (props.bold) pr.push('<w:b/>');
      if (props.italic) pr.push('<w:i/>');
      if (props.strike) pr.push('<w:strike/>');
      if (props.color) pr.push(`<w:color w:val="${props.color}"/>`);
      if (props.size) pr.push(`<w:sz w:val="${props.size}"/>`);
      if (props.highlight) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${props.highlight}"/>`);
      if (props.underline) pr.push('<w:u w:val="single"/>');
      if (props.vert) pr.push(`<w:vertAlign w:val="${props.vert}"/>`);
      if (props.link) pr.push('<w:rStyle w:val="Hyperlink"/>');
      const rPr = pr.length ? `<w:rPr>${pr.join('')}</w:rPr>` : '';
      return String(text).split('\n').map((line, i) => `${i ? `<w:r>${rPr}<w:br/></w:r>` : ''}<w:r>${rPr}<w:t xml:space="preserve">${docxXml(line)}</w:t></w:r>`).join('');
    };

    const propsFor = (node, props) => {
      const next = { ...props }, tag = node.tagName, st = node.style || {};
      if (['B', 'STRONG'].includes(tag) || /bold|^[6-9]00$/.test(st.fontWeight || '')) next.bold = true;
      if (['I', 'EM', 'CITE'].includes(tag) || st.fontStyle === 'italic') next.italic = true;
      if (tag === 'U' || (st.textDecoration || '').includes('underline')) next.underline = true;
      if (['S', 'STRIKE', 'DEL'].includes(tag) || (st.textDecoration || '').includes('line-through')) next.strike = true;
      if (tag === 'SUP') next.vert = 'superscript'; else if (tag === 'SUB') next.vert = 'subscript';
      if (['CODE', 'KBD', 'SAMP'].includes(tag)) next.font = 'Courier New';
      const family = tag === 'FONT' ? node.getAttribute('face') : st.fontFamily;
      if (family) next.font = family.split(',')[0].replace(/["']/g, '').trim();
      const color = docxCssColor((tag === 'FONT' ? node.getAttribute('color') : st.color) || '');
      if (color) next.color = color;
      const bg = docxCssColor(st.backgroundColor || '');
      if (bg) next.highlight = bg;
      const px = /^([\d.]+)px$/.exec(st.fontSize || ''), pt = /^([\d.]+)pt$/.exec(st.fontSize || '');
      if (pt) next.size = Math.round(Number(pt[1]) * 2); else if (px) next.size = Math.round(Number(px[1]) * 1.5);
      return next;
    };

    const imageXml = async img => {
      const asset = assets.get(img.dataset.assetId);
      if (!asset?.dataUrl) return '';
      if (!mediaByAsset.has(asset.id)) {
        const ext = /png/.test(asset.mime) ? 'png' : /gif/.test(asset.mime) ? 'gif' : /webp/.test(asset.mime) ? 'webp' : 'jpeg';
        const name = `image${media.length + 1}.${ext}`;
        media.push({ name: `word/media/${name}`, data: docxDataUrlBytes(asset.dataUrl) });
        mediaByAsset.set(asset.id, addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`));
      }
      const [natW, natH] = await docxImageSize(asset.dataUrl);
      const width = img.style.width || '';
      let px = /px$/.test(width) ? parseFloat(width) : /%$/.test(width) ? parseFloat(width) * 6.24 : Math.min(natW, 480);
      px = Math.max(16, Math.min(px || natW, 624));
      const cx = Math.round(px * 9525), cy = Math.round(px * natH / Math.max(1, natW) * 9525), id = nextDrawing++;
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${docxXml(img.alt || '')}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${mediaByAsset.get(asset.id)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    };

    const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'HR', 'LI', 'SECTION', 'ARTICLE', 'FIGURE']);

    const inlineXml = async (node, props, pre = false) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = pre ? node.nodeValue : (node.nodeValue || '').replace(/[ \t\r\n ]+/g, ' ');
        return runXml(text, props);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'BR') return '<w:r><w:br/></w:r>';
      if (node.tagName === 'IMG') return imageXml(node);
      const next = propsFor(node, props);
      if (node.tagName === 'A' && /^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) {
        const id = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', node.getAttribute('href'), true);
        let inner = '';
        for (const child of node.childNodes) inner += await inlineXml(child, { ...next, link: true, underline: true, color: next.color || '0563C1' }, pre);
        return `<w:hyperlink r:id="${id}">${inner}</w:hyperlink>`;
      }
      let out = '';
      for (const child of node.childNodes) out += await inlineXml(child, next, pre);
      return out;
    };

    const paragraph = (runs, { style = '', align = '', num = null, indent = 0, shade = false } = {}) => {
      const ppr = [];
      if (style) ppr.push(`<w:pStyle w:val="${style}"/>`);
      if (num) ppr.push(`<w:numPr><w:ilvl w:val="${num.level}"/><w:numId w:val="${num.id}"/></w:numPr>`);
      if (shade) ppr.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
      if (indent) ppr.push(`<w:ind w:left="${indent}"/>`);
      if (align) ppr.push(`<w:jc w:val="${align}"/>`);
      return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
    };
    const alignOf = node => { const a = (node.style?.textAlign || node.getAttribute?.('align') || '').toLowerCase(); return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'justify' ? 'both' : ''; };

    const blocksXml = async (parent, ctx) => {
      let out = '', pending = '';
      const flush = () => { if (pending.replace(/<[^>]+>/g, '').trim() || /<w:(br|drawing)/.test(pending)) out += paragraph(pending, ctx.para); pending = ''; };
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName)) { flush(); out += await blockXml(child, ctx); }
        else pending += await inlineXml(child, ctx.props, ctx.pre);
      }
      flush();
      return out;
    };

    const listXml = async (list, ctx, level) => {
      const ordered = list.tagName === 'OL';
      let id;
      if (ordered) { numbering.push({ ordered: true }); id = numbering.length + 1; } else { id = 1; usedBulletNum = true; }
      let out = '';
      for (const item of list.children) {
        if (item.tagName !== 'LI') continue;
        let runs = '', nested = '';
        for (const child of item.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'UL' || child.tagName === 'OL')) nested += await listXml(child, ctx, level + 1);
          else if (child.nodeType === Node.ELEMENT_NODE && ['P', 'DIV'].includes(child.tagName)) { for (const c of child.childNodes) runs += await inlineXml(c, ctx.props, false); runs += '<w:r><w:br/></w:r>'; }
          else runs += await inlineXml(child, ctx.props, false);
        }
        runs = runs.replace(/(<w:r><w:br\/><\/w:r>)+$/, '');
        out += paragraph(runs, { style: 'ListParagraph', num: { id, level: Math.min(level, 8) }, align: alignOf(item) }) + nested;
      }
      return out;
    };

    const tableXml = async (table, ctx) => {
      const rows = [...table.querySelectorAll('tr')].filter(tr => tr.closest('table') === table);
      const cols = Math.max(1, ...rows.map(tr => [...tr.children].reduce((n, c) => n + (Number(c.getAttribute('colspan')) || 1), 0)));
      let out = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(cols)}</w:tblGrid>`;
      for (const tr of rows) {
        out += '<w:tr>';
        for (const cell of tr.children) {
          if (!['TD', 'TH'].includes(cell.tagName)) continue;
          const span = Number(cell.getAttribute('colspan')) || 1;
          let content = await blocksXml(cell, { ...ctx, props: cell.tagName === 'TH' ? { ...ctx.props, bold: true } : ctx.props });
          if (!content) content = '<w:p/>';
          out += `<w:tc><w:tcPr><w:tcW w:w="${2400 * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${content}</w:tc>`;
        }
        out += '</w:tr>';
      }
      return out + '</w:tbl><w:p/>';
    };

    const blockXml = async (node, ctx) => {
      const tag = node.tagName;
      if (tag === 'UL' || tag === 'OL') return listXml(node, ctx, 0);
      if (tag === 'TABLE') return tableXml(node, ctx);
      if (tag === 'HR') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
      if (tag === 'LI') return paragraph(await inlineXml(node, ctx.props), { style: 'ListParagraph', num: { id: 1, level: 0 } });
      const heading = /^H([1-6])$/.exec(tag);
      const props = propsFor(node, ctx.props);
      if (heading) {
        // Keep the heading's own font/size/colour as direct formatting so imported Word headings round-trip.
        let runs = '';
        for (const child of node.childNodes) runs += await inlineXml(child, { ...props, bold: undefined }, false);
        return paragraph(runs, { style: `Heading${heading[1]}`, align: alignOf(node) });
      }
      if (tag === 'BLOCKQUOTE') return (await blocksXml(node, { ...ctx, props, para: { indent: 720 } }));
      if (tag === 'PRE') {
        let runs = '';
        for (const child of node.childNodes) runs += await inlineXml(child, { ...props, font: props.font || 'Courier New' }, true);
        return paragraph(runs, { shade: true });
      }
      return blocksXml(node, { ...ctx, props, para: { ...ctx.para, align: alignOf(node) || ctx.para?.align || '' } });
    };

    const body = await blocksXml(root, { props: {}, para: {}, pre: false }) || '<w:p/>';

    const headingStyle = (n, size, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${DOCX_W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[[1, 32, '2F5496'], [2, 26, '2F5496'], [3, 24, '1F3763'], [4, 22, '2F5496'], [5, 22, '2F5496'], [6, 22, '1F3763']].map(h => headingStyle(...h)).join('')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

    const level = (i, ordered) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i % 3 === 0 ? 'decimal' : i % 3 === 1 ? 'lowerLetter' : 'lowerRoman') : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : (i % 2 ? 'o' : '•')}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
    const levels = ordered => Array.from({ length: 9 }, (_, i) => level(i, ordered)).join('');
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${DOCX_W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${numbering.map((_, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${DOCX_W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const relXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${docxXml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="webp" ContentType="image/webp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;

    const enc = new TextEncoder();
    return docxZip([
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/styles.xml', data: enc.encode(styles) },
      { name: 'word/numbering.xml', data: enc.encode(numberingXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(relXml) },
      ...media
    ]);
  }

  async function exportSelectedDocx() {
    const f = selectedRealFile();
    if (!f) return toast('Select a file first.');
    if (f.protected && !protectedSessions.has(f.fileId || f.id)) return toast('Unlock the protected file before exporting it.');
    try {
      const type = f.docType || 'rich', content = f.content || '';
      const html = type === 'markdown' ? renderMarkdown(content)
        : type === 'plain' ? `<pre style="font-family:Calibri">${escapeHtmlText(content)}</pre>`
        : content;
      const blob = await htmlToDocx(type === 'plain' ? html.replace(/^<pre[^>]*>|<\/pre>$/g, '').split('\n').map(l => `<p>${l || '<br>'}</p>`).join('') : html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = safeDiskName(f.name, '.docx'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(`Exported ${f.name} as Word (.docx).`);
    } catch (error) {
      console.error(error);
      toast('Word export failed.');
    }
  }
