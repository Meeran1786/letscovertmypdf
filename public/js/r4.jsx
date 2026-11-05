/* Release 3: 25 more on-device tools (organize, convert, clean up, optimize).
   Every one runs in the browser with pdf-lib, PDF.js or qpdf (WASM); nothing
   is uploaded. runTool() falls through to runToolR4() for these ids, and
   ConfigPanel() asks R4_PANELS for their settings UI. Loaded as text/babel
   after tools.jsx and before the main app script. */

/* ══════════════ Helpers ══════════════ */
const r4load = async (file, opts = {}) => PDFLib.PDFDocument.load(await readFileAsArrayBuffer(file), { ignoreEncryption: true, ...opts });
const r4base = name => name.replace(/\.[^.]+$/, '');

/** "1-3, 5, 8-" → zero-based page indexes (in the order typed, no duplicates). */
function parseRange(str, n) {
  const out = [];
  for (const part of String(str || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? parseInt(m[1]) : 1; b = m[2] ? parseInt(m[2]) : n; }
    else if (/^\d+$/.test(part)) { a = b = parseInt(part); }
    else throw new Error(`"${part}" isn't a page number or range. Use something like 1-3, 5, 8-.`);
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(n, b); i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  return out;
}

/** Keeps only characters the standard PDF fonts can draw (Latin text). */
function r4safe(font, s) {
  let out = '';
  for (const ch of String(s)) { try { font.encodeText(ch); out += ch; } catch { out += ch === '\t' ? '    ' : '?'; } }
  return out;
}

async function r4copy(file, indexes) {
  const src = await r4load(file);
  const out = await PDFLib.PDFDocument.create();
  (await out.copyPages(src, indexes)).forEach(p => out.addPage(p));
  return out.save();
}

/* ══════════════ Organize ══════════════ */
async function r4extract(file, range) {
  const src = await r4load(file); const n = src.getPageCount();
  const idx = parseRange(range, n);
  if (!idx.length) throw new Error(`Type the pages to keep, between 1 and ${n}.`);
  return { bytes: await r4copy(file, idx), n: idx.length };
}

async function r4delete(file, range) {
  const src = await r4load(file); const n = src.getPageCount();
  const del = parseRange(range, n);
  if (!del.length) throw new Error(`Type the pages to delete, between 1 and ${n}.`);
  if (del.length >= n) throw new Error('That would delete every page. Leave at least one.');
  const keep = [...Array(n).keys()].filter(i => !del.includes(i));
  return { bytes: await r4copy(file, keep), n: del.length };
}

/** A page is blank when almost every pixel of a small render is near-white. */
async function r4blankPages(file, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const blank = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 0.5 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data; let ink = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] < 235 || d[k + 1] < 235 || d[k + 2] < 235) ink++;
    if (ink / (d.length / 4) < 0.001) blank.push(i - 1);
    onProgress && onProgress(i / pdf.numPages);
  }
  return { blank, n: pdf.numPages };
}

async function r4addBlank(file, after, count) {
  const doc = await r4load(file); const n = doc.getPageCount();
  const pos = Math.min(Math.max(parseInt(after) || 0, 0), n);
  const ref = doc.getPage(Math.max(0, Math.min(pos, n) - 1) || 0).getSize();
  const k = Math.min(Math.max(parseInt(count) || 1, 1), 500);
  for (let i = 0; i < k; i++) doc.insertPage(pos, [ref.width, ref.height]);
  return doc.save();
}

async function r4reverse(file) {
  const n = (await r4load(file)).getPageCount();
  return r4copy(file, [...Array(n).keys()].reverse());
}

/** Places source pages on a grid of cols x rows per sheet, scaled to fit. */
async function r4grid(src, order, sheet, cols, rows, margin = 18) {
  const out = await PDFLib.PDFDocument.create();
  const pages = src.getPages();
  const per = cols * rows; const cw = (sheet[0] - margin * 2) / cols, ch = (sheet[1] - margin * 2) / rows;
  for (let s = 0; s < order.length; s += per) {
    const sh = out.addPage(sheet);
    for (let j = 0; j < per; j++) {
      const i = order[s + j]; if (i === undefined || i === null || !pages[i]) continue;
      if (!pages[i].node.Contents()) continue; // blank page: nothing to draw
      const emb = await out.embedPage(pages[i]);
      const sc = Math.min(cw / emb.width, ch / emb.height);
      const w = emb.width * sc, h = emb.height * sc, col = j % cols, row = Math.floor(j / cols);
      sh.drawPage(emb, { x: margin + col * cw + (cw - w) / 2, y: sheet[1] - margin - (row + 1) * ch + (ch - h) / 2, width: w, height: h });
    }
  }
  return out.save();
}

async function r4nup(file, perSheet) {
  const src = await r4load(file); const n = src.getPageCount();
  const { width, height } = src.getPage(0).getSize();
  const portrait = height >= width;
  const k = [2, 4, 6, 9].includes(parseInt(perSheet)) ? parseInt(perSheet) : 2;
  const [cols, rows] = { 2: portrait ? [2, 1] : [1, 2], 4: [2, 2], 6: portrait ? [3, 2] : [2, 3], 9: [3, 3] }[k];
  const sheet = k === 2 || k === 6 ? [Math.max(width, height), Math.min(width, height)] : [width, height];
  if (k === 2 && !portrait) sheet.reverse();
  return r4grid(src, [...Array(n).keys()], sheet, cols, rows, k === 2 ? 0 : 18);
}

/** Saddle-stitch booklet: print double-sided (flip on short edge), fold, staple. */
async function r4booklet(file) {
  const src = await r4load(file); const n = src.getPageCount();
  const total = Math.ceil(n / 4) * 4; const order = [];
  for (let i = 0; i < total / 4; i++) order.push(total - 1 - 2 * i, 2 * i, 2 * i + 1, total - 2 - 2 * i);
  const { width, height } = src.getPage(0).getSize();
  return r4grid(src, order.map(i => (i < n ? i : null)), [width * 2, height], 2, 1, 0);
}

async function r4alternate(files, reverseSecond) {
  if (files.length < 2) throw new Error('Add at least two PDFs, for example the front sides and the back sides of a scan.');
  const docs = await Promise.all(files.map(f => r4load(f)));
  const out = await PDFLib.PDFDocument.create();
  const lists = docs.map((d, k) => { const idx = [...Array(d.getPageCount()).keys()]; return k === 1 && reverseSecond ? idx.reverse() : idx; });
  const copied = await Promise.all(docs.map((d, k) => out.copyPages(d, lists[k])));
  const max = Math.max(...copied.map(c => c.length));
  for (let i = 0; i < max; i++) for (const c of copied) if (c[i]) out.addPage(c[i]);
  return out.save();
}

async function r4headerFooter(file, cfg) {
  const doc = await r4load(file);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const size = Math.min(Math.max(parseFloat(cfg.hfSize) || 10, 6), 36);
  const color = hexRgb(cfg.hfColor || '#444444');
  const pages = doc.getPages(); const total = pages.length;
  const date = new Date().toLocaleDateString();
  const fill = (t, i) => r4safe(font, String(t || '').replace(/\{page\}/g, i + 1).replace(/\{total\}/g, total).replace(/\{date\}/g, date).replace(/\{file\}/g, r4base(file.name)));
  const slots = [['hLeft', 'left', 'top'], ['hCenter', 'center', 'top'], ['hRight', 'right', 'top'], ['fLeft', 'left', 'bottom'], ['fCenter', 'center', 'bottom'], ['fRight', 'right', 'bottom']];
  if (!slots.some(([k]) => (cfg[k] || '').trim())) throw new Error('Type a header or footer first.');
  const m = 28;
  pages.forEach((p, i) => {
    const { width, height } = p.getSize();
    for (const [k, align, edge] of slots) {
      const t = fill(cfg[k], i); if (!t.trim()) continue;
      const w = font.widthOfTextAtSize(t, size);
      const x = align === 'left' ? m : align === 'right' ? width - m - w : (width - w) / 2;
      p.drawText(t, { x, y: edge === 'top' ? height - m + 4 - size : m - 4, size, font, color });
    }
  });
  return doc.save();
}

async function r4removeAnnots(file) {
  const doc = await r4load(file); let n = 0;
  for (const p of doc.getPages()) {
    const a = p.node.lookup(PDFLib.PDFName.of('Annots'));
    if (a && a.size) {
      const keep = [];
      for (let i = 0; i < a.size(); i++) {
        const st = a.lookup(i)?.lookup?.(PDFLib.PDFName.of('Subtype'));
        if (st && st.toString() === '/Widget') keep.push(a.get(i)); else n++;
      }
      if (keep.length) p.node.set(PDFLib.PDFName.of('Annots'), doc.context.obj(keep)); else p.node.delete(PDFLib.PDFName.of('Annots'));
    }
  }
  return { bytes: await doc.save(), n };
}

/* ══════════════ Metadata & cleanup ══════════════ */
const META_FIELDS = [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator (app that made it)'], ['producer', 'Producer']];

async function r4readMeta(file) {
  const d = await r4load(file, { updateMetadata: false });
  return { title: d.getTitle() || '', author: d.getAuthor() || '', subject: d.getSubject() || '', keywords: d.getKeywords() || '',
    creator: d.getCreator() || '', producer: d.getProducer() || '', created: d.getCreationDate()?.toISOString() || '', modified: d.getModificationDate()?.toISOString() || '', pages: d.getPageCount() };
}

async function r4writeMeta(file, m) {
  const d = await r4load(file, { updateMetadata: false });
  d.setTitle(m.title || ''); d.setAuthor(m.author || ''); d.setSubject(m.subject || '');
  d.setKeywords((m.keywords || '').split(/[,;]/).map(s => s.trim()).filter(Boolean));
  d.setCreator(m.creator || ''); d.setProducer(m.producer || ''); d.setModificationDate(new Date());
  return d.save();
}

function r4stripInfo(d) {
  const { PDFName } = PDFLib; let n = 0;
  const info = d.getInfoDict();
  for (const k of [...info.keys()]) { info.delete(k); n++; }
  if (d.catalog.has(PDFName.of('Metadata'))) { d.catalog.delete(PDFName.of('Metadata')); n++; }
  return n;
}

async function r4removeMeta(file) {
  const d = await r4load(file, { updateMetadata: false });
  const n = r4stripInfo(d);
  return { bytes: await d.save(), n };
}

/** Removes things that can run or hide inside a PDF: JavaScript, auto-run
 *  actions, launch actions, embedded files, and identifying metadata. */
async function r4sanitize(file) {
  const { PDFName, PDFDict } = PDFLib;
  const d = await r4load(file, { updateMetadata: false });
  const found = [];
  const cat = d.catalog;
  for (const k of ['OpenAction', 'AA']) if (cat.has(PDFName.of(k))) { cat.delete(PDFName.of(k)); found.push(k === 'AA' ? 'document actions' : 'auto-open action'); }
  const names = cat.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    if (names.has(PDFName.of('JavaScript'))) { names.delete(PDFName.of('JavaScript')); found.push('JavaScript'); }
    if (names.has(PDFName.of('EmbeddedFiles'))) { names.delete(PDFName.of('EmbeddedFiles')); found.push('embedded files'); }
  }
  const form = cat.lookup(PDFName.of('AcroForm'));
  if (form instanceof PDFDict && form.has(PDFName.of('XFA'))) { form.delete(PDFName.of('XFA')); found.push('XFA form scripts'); }
  let actions = 0;
  for (const p of d.getPages()) {
    if (p.node.has(PDFName.of('AA'))) { p.node.delete(PDFName.of('AA')); actions++; }
    const a = p.node.lookup(PDFName.of('Annots'));
    if (!a || !a.size) continue;
    const keep = [];
    for (let i = 0; i < a.size(); i++) {
      const an = a.lookup(i); if (!(an instanceof PDFDict)) { keep.push(a.get(i)); continue; }
      const st = an.lookup(PDFName.of('Subtype'))?.toString();
      if (st === '/FileAttachment') { actions++; continue; }
      if (an.has(PDFName.of('AA'))) { an.delete(PDFName.of('AA')); actions++; }
      const act = an.lookup(PDFName.of('A'));
      const s = act instanceof PDFDict ? act.lookup(PDFName.of('S'))?.toString() : '';
      if (['/JavaScript', '/Launch', '/SubmitForm', '/ImportData'].includes(s)) { an.delete(PDFName.of('A')); actions++; }
      keep.push(a.get(i));
    }
    p.node.set(PDFName.of('Annots'), d.context.obj(keep));
  }
  if (actions) found.push(`${actions} page or link action${actions === 1 ? '' : 's'}`);
  if (r4stripInfo(d)) found.push('metadata');
  return { bytes: await d.save(), found };
}

/* ══════════════ Convert from PDF ══════════════ */
async function r4pdfToText(file, onProgress) {
  const { pages } = await LCP.extractText(file, onProgress);
  const text = pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n');
  return { text, empty: !pages.some(p => p.trim()) };
}

/** Rebuilds lines from PDF.js text items, then marks larger lines as headings. */
async function r4pdfToMarkdown(file, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const all = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const lines = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]), h = Math.abs(it.transform[3]) || it.height || 10;
      let ln = lines.find(l => Math.abs(l.y - y) <= h * 0.4);
      if (!ln) { ln = { y, h, parts: [] }; lines.push(ln); }
      ln.parts.push({ x: it.transform[4], s: it.str }); ln.h = Math.max(ln.h, h);
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) { l.text = l.parts.sort((a, b) => a.x - b.x).map(x => x.s).join(' ').replace(/\s+/g, ' ').trim(); l.page = p; }
    all.push(...lines.filter(l => l.text));
    onProgress && onProgress(p / pdf.numPages);
  }
  if (!all.length) return { md: '', empty: true };
  const sizes = all.map(l => l.h).sort((a, b) => a - b); const body = sizes[Math.floor(sizes.length / 2)];
  const out = []; let para = []; let lastY = null, lastPage = 0, inList = false;
  const flush = () => { if (para.length) { out.push(para.join(' ')); out.push(''); para = []; } };
  for (const l of all) {
    const gap = lastPage === l.page && lastY !== null ? lastY - l.y : 0;
    if (l.page !== lastPage || gap > l.h * 1.8) flush();
    lastY = l.y; lastPage = l.page;
    const t = l.text;
    if (l.h >= body * 1.6 && t.length < 120) { flush(); out.push(`# ${t}`, ''); continue; }
    if (l.h >= body * 1.25 && t.length < 140) { flush(); out.push(`## ${t}`, ''); continue; }
    const bullet = t.match(/^[•▪◦●·\-–*]\s*(.*)$/); const num = t.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (bullet) { flush(); out.push(`- ${bullet[1]}`); inList = true; continue; }
    if (num) { flush(); out.push(`${num[1]}. ${num[2]}`); inList = true; continue; }
    if (inList) { out.push(''); inList = false; }
    if (para.length && /-$/.test(para[para.length - 1])) para[para.length - 1] = para[para.length - 1].slice(0, -1) + t; else para.push(t);
  }
  flush();
  return { md: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', empty: false };
}

/** Pulls the embedded pictures out of a PDF at their stored resolution. */
async function r4extractImages(file, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const OPS = pdfjsLib.OPS; const out = []; const seen = new Set();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    let k = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.paintImageXObject && ops.fnArray[i] !== OPS.paintJpegXObject) continue;
      const name = ops.argsArray[i][0]; if (seen.has(name)) continue; seen.add(name);
      const img = await new Promise(res => { const store = name.startsWith('g_') ? page.commonObjs : page.objs; try { store.get(name, res); } catch { res(null); } });
      if (!img || !img.width || img.width * img.height < 64 * 64) continue;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d');
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const id = ctx.createImageData(img.width, img.height); const src = img.data, px = img.width * img.height;
        if (src.length === px * 4) id.data.set(src);
        else if (src.length === px * 3) for (let j = 0, q = 0; j < px; j++) { id.data[q++] = src[j * 3]; id.data[q++] = src[j * 3 + 1]; id.data[q++] = src[j * 3 + 2]; id.data[q++] = 255; }
        else if (src.length === px) for (let j = 0, q = 0; j < px; j++) { const v = src[j]; id.data[q++] = v; id.data[q++] = v; id.data[q++] = v; id.data[q++] = 255; }
        else continue;
        ctx.putImageData(id, 0, 0);
      } else continue;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/png', name: `page${p}_image${++k}.png` });
    }
    onProgress && onProgress(p / pdf.numPages);
  }
  return out;
}

/** Re-renders each page in shades of grey (pages become images). */
async function r4greyscale(file, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const out = await PDFLib.PDFDocument.create();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p); const base = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const id = ctx.getImageData(0, 0, c.width, c.height); const d = id.data;
    for (let k = 0; k < d.length; k += 4) { const v = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; d[k] = d[k + 1] = d[k + 2] = v; }
    ctx.putImageData(id, 0, 0);
    const jpg = await out.embedJpg(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
    out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    onProgress && onProgress(p / pdf.numPages);
  }
  return out.save();
}

/* ══════════════ Convert to PDF ══════════════ */
/** Lays out blocks of text on A4 pages with word wrap. Blocks: {text, size, bold, mono, indent, gap}. */
async function r4layout(blocks, title) {
  const doc = await PDFLib.PDFDocument.create(); doc.setTitle(title || '');
  const F = { r: await doc.embedFont(PDFLib.StandardFonts.Helvetica), b: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold), m: await doc.embedFont(PDFLib.StandardFonts.Courier) };
  const W = 595.28, H = 841.89, M = 56; let page = doc.addPage([W, H]); let y = H - M; let replaced = 0;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  for (const b of blocks) {
    const font = b.mono ? F.m : b.bold ? F.b : F.r; const size = b.size || 11; const lh = size * 1.4;
    const x = M + (b.indent || 0); const maxW = W - M - x;
    y -= b.gap || 0;
    const clean = r4safe(font, b.text); replaced += (clean.match(/\?/g) || []).length - (String(b.text).match(/\?/g) || []).length;
    const paras = clean.split('\n');
    for (const para of paras) {
      const words = para.split(/(\s+)/); let line = '';
      const emit = l => { if (y - lh < M) newPage(); page.drawText(l, { x, y: y - size, size, font }); y -= lh; };
      if (!para.trim()) { if (y - lh < M) newPage(); y -= lh; continue; }
      for (const w of words) {
        const t = line + w;
        if (font.widthOfTextAtSize(t.trimEnd(), size) <= maxW) { line = t; continue; }
        if (line.trim()) emit(line.trimEnd());
        let rest = w.trimStart();
        while (font.widthOfTextAtSize(rest, size) > maxW) { let k = rest.length; while (k > 1 && font.widthOfTextAtSize(rest.slice(0, k), size) > maxW) k--; emit(rest.slice(0, k)); rest = rest.slice(k); }
        line = rest;
      }
      if (line.trim()) emit(line.trimEnd());
    }
  }
  return { bytes: await doc.save(), replaced };
}

async function r4textToPdf(file) {
  const text = await file.text();
  return r4layout([{ text, size: 11, mono: /\.(log|csv|json|xml|ya?ml|js|py|java|c|cpp|ts|sh)$/i.test(file.name) }], r4base(file.name));
}

async function r4markdownToPdf(file) {
  const strip = s => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1');
  const lines = (await file.text()).replace(/\r/g, '').split('\n'); const blocks = []; let para = []; let code = null;
  const flush = () => { if (para.length) { blocks.push({ text: strip(para.join(' ')), size: 11, gap: 4 }); para = []; } };
  for (const ln of lines) {
    if (/^```/.test(ln)) { if (code) { blocks.push({ text: code.join('\n'), size: 9.5, mono: true, indent: 12, gap: 4 }); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(ln); continue; }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); blocks.push({ text: strip(h[2]), size: [22, 18, 15, 13, 12, 11][h[1].length - 1], bold: true, gap: h[1].length <= 2 ? 14 : 10 }); continue; }
    const li = ln.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) { flush(); blocks.push({ text: `${/\d/.test(li[2]) ? li[2] : '•'} ${strip(li[3])}`, size: 11, indent: 12 + Math.min(li[1].length, 8) * 6, gap: 2 }); continue; }
    if (/^>\s?/.test(ln)) { flush(); blocks.push({ text: strip(ln.replace(/^>\s?/, '')), size: 11, indent: 18, gap: 2 }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); blocks.push({ text: ' ', size: 6, gap: 6 }); continue; }
    if (!ln.trim()) { flush(); continue; }
    para.push(ln.trim());
  }
  if (code) blocks.push({ text: code.join('\n'), size: 9.5, mono: true, indent: 12 });
  flush();
  return r4layout(blocks, r4base(file.name));
}

/** SVG is drawn at 4x so lines and text stay sharp when zoomed in. */
async function r4svgToPdf(files) {
  const out = await PDFLib.PDFDocument.create();
  for (const f of files) {
    const url = URL.createObjectURL(f.type ? f : new Blob([await f.arrayBuffer()], { type: 'image/svg+xml' }));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Couldn't read ${f.name}. Is it a valid SVG?`)); i.src = url; });
    const w = img.naturalWidth || 800, h = img.naturalHeight || 600; const s = Math.min(4, 8000 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const png = await out.embedPng(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
    const pw = w * 0.75, ph = h * 0.75;
    out.addPage([pw, ph]).drawImage(png, { x: 0, y: 0, width: pw, height: ph });
  }
  return out.save();
}

/* ══════════════ Optimize ══════════════ */
const PAPER = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A3: [841.89, 1190.55], A5: [419.53, 595.28] };

async function r4resize(file, size) {
  const src = await r4load(file); const [pw, ph] = PAPER[size] || PAPER.A4;
  const out = await PDFLib.PDFDocument.create();
  for (const p of src.getPages()) {
    if (!p.node.Contents()) { const { width, height } = p.getSize(); const l = width > height; out.addPage(l ? [ph, pw] : [pw, ph]); continue; }
    const emb = await out.embedPage(p); const land = emb.width > emb.height;
    const [W, H] = land ? [ph, pw] : [pw, ph];
    const sc = Math.min(W / emb.width, H / emb.height);
    out.addPage([W, H]).drawPage(emb, { x: (W - emb.width * sc) / 2, y: (H - emb.height * sc) / 2, width: emb.width * sc, height: emb.height * sc });
  }
  return out.save();
}

async function r4linearize(file) {
  const r = await LCP.runQpdf(['--linearize', '/in.pdf', '/out.pdf'], new Uint8Array(await readFileAsArrayBuffer(file)));
  if (!r.out) throw new Error('Could not optimise this PDF. If it has a password, unlock it first; if it is damaged, try Repair PDF.');
  return r.out;
}

/* ══════════════ Entry point ══════════════ */
const textItem = (text, name, type = 'text/plain') => ({ bytes: new TextEncoder().encode(text), type: `${type};charset=utf-8`, name });

/** Returns a result for the Release 3 tools, or null if `id` isn't one. */
async function runToolR4(id, files, config, ui = {}) {
  const tick = ui.tick || (() => {}), status = ui.setStatus || (() => {});
  const span = (a, b) => v => tick(a + Math.round(v * (b - a)));
  const f = files[0]; const pl = n => `${n} page${n === 1 ? '' : 's'}`;
  switch (id) {
    case 'extractpages': { const r = await r4extract(f, config.pages); return { bytes: r.bytes, name: `extracted_${f.name}`, note: `Kept ${pl(r.n)}.` }; }
    case 'delete': { const r = await r4delete(f, config.pages); return { bytes: r.bytes, name: `edited_${f.name}`, note: `Deleted ${pl(r.n)}.` }; }
    case 'removeblank': {
      status('Looking for blank pages…');
      const { blank, n } = await r4blankPages(f, span(20, 80));
      if (!blank.length) return { bytes: new Uint8Array(await readFileAsArrayBuffer(f)), name: f.name, note: 'No blank pages found, so the file is unchanged.' };
      if (blank.length === n) throw new Error('Every page looks blank, so nothing was removed.');
      return { bytes: await r4copy(f, [...Array(n).keys()].filter(i => !blank.includes(i))), name: `no_blanks_${f.name}`, note: `Removed ${pl(blank.length)}: ${blank.map(i => i + 1).join(', ')}.` };
    }
    case 'addblank': return { bytes: await r4addBlank(f, config.after, config.count), name: `with_blank_${f.name}` };
    case 'reverse': return { bytes: await r4reverse(f), name: `reversed_${f.name}` };
    case 'nup': return { bytes: await r4nup(f, config.perSheet || 2), name: `${config.perSheet || 2}-up_${f.name}` };
    case 'booklet': return { bytes: await r4booklet(f), name: `booklet_${f.name}`, note: 'Print double-sided, flipping on the short edge, then fold the stack in half.' };
    case 'alternate': return { bytes: await r4alternate(files, !!config.reverseSecond), name: 'mixed.pdf' };
    case 'headerfooter': return { bytes: await r4headerFooter(f, config), name: `header_footer_${f.name}` };
    case 'removeannots': { const r = await r4removeAnnots(f); return { bytes: r.bytes, name: `clean_${f.name}`, note: r.n ? `Removed ${r.n} annotation${r.n === 1 ? '' : 's'} (comments, highlights and markups). Form fields were kept.` : 'This PDF had no annotations, so it is unchanged.' }; }
    case 'metadata': return { bytes: await r4writeMeta(f, config.meta || {}), name: f.name, note: 'Saved the new document properties.' };
    case 'removemeta': { const r = await r4removeMeta(f); return { bytes: r.bytes, name: `no_metadata_${f.name}`, note: r.n ? 'Removed the author, title, dates, app names and XMP metadata.' : 'This PDF had no metadata to remove.' }; }
    case 'sanitize': { const r = await r4sanitize(f); return { bytes: r.bytes, name: `sanitized_${f.name}`, note: r.found.length ? `Removed: ${r.found.join(', ')}.` : 'Nothing risky was found. Metadata was cleared.' }; }
    case 'pdf2text': {
      status('Reading the text…'); const r = await r4pdfToText(f, span(20, 95));
      return { items: [textItem(r.text, `${r4base(f.name)}.txt`)], note: r.empty ? 'No text was found. If this is a scan, run OCR PDF first.' : 'Your text file is ready.' };
    }
    case 'pdf2md': {
      status('Rebuilding headings, lists and paragraphs…'); const r = await r4pdfToMarkdown(f, span(20, 95));
      return { items: [textItem(r.md, `${r4base(f.name)}.md`, 'text/markdown')], note: r.empty ? 'No text was found. If this is a scan, run OCR PDF first.' : 'Headings, lists and paragraphs were rebuilt as Markdown.' };
    }
    case 'extractimages': {
      status('Finding images…'); const items = await r4extractImages(f, span(20, 95));
      if (!items.length) throw new Error('No images were found in this PDF. To save whole pages as pictures, use PDF to JPG.');
      return { items, note: `Found ${items.length} image${items.length === 1 ? '' : 's'}.` };
    }
    case 'pdf2webp': {
      status('Converting pages…'); const pages = await renderPages(f, 'image/webp', parseFloat(config.scale) || 2, span(20, 95));
      return { items: pages.map((b, i) => ({ bytes: b, type: 'image/webp', name: `page_${i + 1}.webp` })) };
    }
    case 'greyscale': { status('Converting to greyscale…'); return { bytes: await r4greyscale(f, span(20, 95)), name: `greyscale_${f.name}`, note: 'Pages are now greyscale images. Run OCR PDF if you need to search the text.' }; }
    case 'txt2pdf': case 'md2pdf': {
      const r = id === 'md2pdf' ? await r4markdownToPdf(f) : await r4textToPdf(f);
      return { bytes: r.bytes, name: `${r4base(f.name)}.pdf`, note: r.replaced > 0 ? `${r.replaced} character${r.replaced === 1 ? '' : 's'} outside the Latin alphabet couldn't be drawn and show as "?".` : '' };
    }
    case 'png2pdf': case 'webp2pdf': return { bytes: await processImageToPDF(files), name: `${files.length === 1 ? r4base(f.name) : 'images'}.pdf` };
    case 'svg2pdf': return { bytes: await r4svgToPdf(files), name: `${files.length === 1 ? r4base(f.name) : 'drawings'}.pdf` };
    case 'resize': return { bytes: await r4resize(f, config.paper || 'A4'), name: `${config.paper || 'A4'}_${f.name}` };
    case 'linearize': { status('Optimising for fast web view…'); return { bytes: await r4linearize(f), name: `web_${f.name}`, note: 'The first page now shows while the rest is still downloading.' }; }
    default: return null;
  }
}

/* ══════════════ Settings panels ══════════════ */
const r4muted = { color: 'var(--muted)' };
function R4Field({ label, value, onChange, ph, type = 'text', hint }) {
  return <div><label className="block text-xs font-medium mb-1" style={r4muted}>{label}</label>
    <input className="inp" type={type} placeholder={ph} value={value || ''} onChange={e => onChange(e.target.value)}/>
    {hint && <p className="text-xs mt-1" style={r4muted}>{hint}</p>}</div>;
}
function R4Choice({ options, value, onChange }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{options.map(([v, l]) => {
    const on = String(value) === String(v);
    return <button key={v} onClick={() => onChange(v)} className="py-2 rounded-xl text-sm font-semibold transition-all"
      style={{ background: on ? '#2563EB' : 'var(--bg-input)', border: `1px solid ${on ? '#2563EB' : 'var(--border-s)'}`, color: on ? '#fff' : 'var(--text)' }}>{l}</button>;
  })}</div>;
}
function R4PageCount({ file }) {
  const [n, setN] = useState(null);
  useEffect(() => { let on = true; file && r4load(file).then(d => on && setN(d.getPageCount())).catch(() => {}); return () => { on = false; }; }, [file]);
  return n ? <p className="text-xs" style={r4muted}>This PDF has {n} page{n === 1 ? '' : 's'}.</p> : null;
}
function R4MetaPanel({ file, config, set }) {
  const [cur, setCur] = useState(null);
  useEffect(() => { file && r4readMeta(file).then(m => { setCur(m); set(c => ({ ...c, meta: { ...m } })); }).catch(() => setCur({})); }, [file]);
  if (!cur) return <p className="text-sm" style={r4muted}>Reading the document properties…</p>;
  const m = config.meta || {};
  return <div className="space-y-3">
    {META_FIELDS.map(([k, l]) => <R4Field key={k} label={l} value={m[k]} onChange={v => set(c => ({ ...c, meta: { ...(c.meta || {}), [k]: v } }))}/>)}
    {(cur.created || cur.modified) && <p className="text-xs" style={r4muted}>{cur.created && `Created ${new Date(cur.created).toLocaleString()}. `}{cur.modified && `Last modified ${new Date(cur.modified).toLocaleString()}.`}</p>}
  </div>;
}
const r4note = t => <p className="text-sm" style={r4muted}>{t}</p>;
const R4_PANELS = {
  extractpages: ({ config, set, file }) => <div className="space-y-2"><R4Field label="Pages to keep" ph="e.g. 1-3, 5, 8-" value={config.pages} onChange={v => set(c => ({ ...c, pages: v }))} hint="Pages come out in the order you type them."/><R4PageCount file={file}/></div>,
  delete: ({ config, set, file }) => <div className="space-y-2"><R4Field label="Pages to delete" ph="e.g. 2, 4-6" value={config.pages} onChange={v => set(c => ({ ...c, pages: v }))}/><R4PageCount file={file}/></div>,
  removeblank: () => r4note('We check every page on your device and remove the ones with no visible content. Pages with only a faint mark are kept.'),
  addblank: ({ config, set, file }) => <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><R4Field label="Insert after page (0 = at the start)" type="number" ph="0" value={config.after} onChange={v => set(c => ({ ...c, after: v }))}/><R4Field label="How many blank pages" type="number" ph="1" value={config.count} onChange={v => set(c => ({ ...c, count: v }))}/></div><R4PageCount file={file}/></div>,
  reverse: () => r4note('The last page becomes the first. Handy for documents scanned back to front.'),
  nup: ({ config, set }) => <div><label className="block text-xs font-medium mb-2" style={r4muted}>Pages per sheet</label><R4Choice options={[[2, '2'], [4, '4'], [6, '6'], [9, '9']]} value={config.perSheet || 2} onChange={v => set(c => ({ ...c, perSheet: v }))}/></div>,
  booklet: () => r4note('Pages are reordered and placed two per sheet so you can print double-sided (flip on the short edge), fold, and staple a booklet. Blank pages are added to make a multiple of four.'),
  alternate: ({ config, set }) => <div className="space-y-2">{r4note('Pages are mixed one at a time: page 1 of the first file, page 1 of the second, then page 2 of each, and so on.')}<label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}><input type="checkbox" checked={!!config.reverseSecond} onChange={e => set(c => ({ ...c, reverseSecond: e.target.checked }))}/> Reverse the second file (for back sides scanned last-to-first)</label></div>,
  headerfooter: ({ config, set }) => {
    const f = (k, l) => <R4Field label={l} value={config[k]} onChange={v => set(c => ({ ...c, [k]: v }))}/>;
    return <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">{f('hLeft', 'Header left')}{f('hCenter', 'Header centre')}{f('hRight', 'Header right')}</div>
      <div className="grid grid-cols-3 gap-2">{f('fLeft', 'Footer left')}{f('fCenter', 'Footer centre')}{f('fRight', 'Footer right')}</div>
      <div className="grid grid-cols-2 gap-3"><R4Field label="Font size" type="number" ph="10" value={config.hfSize} onChange={v => set(c => ({ ...c, hfSize: v }))}/>
        <div><label className="block text-xs font-medium mb-1" style={r4muted}>Colour</label><input type="color" value={config.hfColor || '#444444'} onChange={e => set(c => ({ ...c, hfColor: e.target.value }))} className="h-10 w-full rounded-xl"/></div></div>
      <p className="text-xs" style={r4muted}>Use {'{page}'}, {'{total}'}, {'{date}'} and {'{file}'}. For example: Page {'{page}'} of {'{total}'}.</p>
    </div>;
  },
  removeannots: () => r4note('Removes comments, highlights, sticky notes, drawings and stamps. Fillable form fields are kept.'),
  metadata: ({ file, config, set }) => file ? <R4MetaPanel file={file} config={config} set={set}/> : null,
  removemeta: () => r4note('Removes the author, title, subject, keywords, the app that made the file, the dates, and hidden XMP metadata. The pages are not changed.'),
  sanitize: () => r4note('Removes anything that can run or hide inside a PDF: JavaScript, auto-open actions, launch and submit actions, embedded files, XFA scripts and metadata. Use it before you share a file or open one you don\'t trust.'),
  pdf2text: () => r4note('Saves all the text as a plain .txt file, page by page. For scans, run OCR PDF first.'),
  pdf2md: () => r4note('Converts the text to Markdown with headings, lists and paragraphs. Good for notes apps, docs sites and AI tools.'),
  extractimages: () => r4note('Saves every photo and picture inside the PDF as a PNG, at the resolution it was stored. Tiny icons are skipped.'),
  pdf2webp: ({ config, set }) => <div><label className="block text-xs font-medium mb-2" style={r4muted}>Quality</label><R4Choice options={[[1, 'Small'], [2, 'Standard'], [3, 'High']]} value={config.scale || 2} onChange={v => set(c => ({ ...c, scale: v }))}/></div>,
  greyscale: () => r4note('Every page is turned into shades of grey, which is good for printing and smaller scans. Pages become images, so run OCR PDF afterwards if you need to search the text.'),
  txt2pdf: () => r4note('Your text is laid out on A4 pages with word wrap. Code and log files use a fixed-width font.'),
  md2pdf: () => r4note('Headings, lists, quotes and code blocks are laid out on A4 pages.'),
  svg2pdf: () => r4note('Each SVG becomes one page at its own size, drawn at high resolution.'),
  resize: ({ config, set }) => <div className="space-y-2"><label className="block text-xs font-medium mb-1" style={r4muted}>New page size</label><R4Choice options={Object.keys(PAPER).map(k => [k, k])} value={config.paper || 'A4'} onChange={v => set(c => ({ ...c, paper: v }))}/>{r4note('Each page is scaled to fit and centred. Landscape pages stay landscape.')}</div>,
  linearize: () => r4note('Reorganises the file so a browser can show the first page while the rest downloads. Also called "fast web view".'),
};
