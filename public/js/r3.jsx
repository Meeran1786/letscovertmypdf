/* Release 2 part 3: translate with layout, smart extract to Excel, contract
   review, the natural-language command bar and flat-form filling. Everything
   runs on this device. Loaded as text/babel after tools.jsx and r2.jsx, and
   shares their globals. */

/* ══════════════ Page layout: items → lines → blocks ══════════════ */
async function openPdfDoc(src) {
  const data = src instanceof Uint8Array ? src.slice() : new Uint8Array(await readFileAsArrayBuffer(src));
  return pdfjsLib.getDocument({ data }).promise;
}

/** Text lines on a page, in PDF user space (origin bottom-left), top to bottom.
 *  Each line keeps its cells: runs of text separated by a wide gap. */
async function pageLines(pdf, p) {
  const page = await pdf.getPage(p);
  const [x0, y0, x1, y1] = page.view;
  const items = (await page.getTextContent()).items
    .filter(it => it.str && it.str.trim() && Math.abs(it.transform[1]) < 0.01)   // horizontal text only
    .map(it => {
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size, bold: /bold|black|heavy/i.test(it.fontName || '') };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find(l => Math.abs(l.y - it.y) < Math.min(l.size, it.size) * 0.5);
    if (line) { line.items.push(it); line.size = Math.max(line.size, it.size); } else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.cells = [];
    for (const it of l.items) {
      const c = l.cells[l.cells.length - 1];
      const gap = c ? it.x - (c.x + c.w) : Infinity;
      if (c && gap < it.size * 1.2) { c.str += (gap > it.size * 0.15 && !/\s$/.test(c.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str; c.w = it.x + it.w - c.x; }
      else l.cells.push({ ...it });
    }
    l.x = l.items[0].x; l.right = Math.max(...l.items.map(i => i.x + i.w));
    l.text = l.cells.map(c => c.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
    l.bold = l.items.every(i => i.bold);
  }
  lines.sort((a, b) => b.y - a.y);
  return { lines, width: x1 - x0, height: y1 - y0, view: page.view, page };
}

/** Group lines into paragraphs so translation sees whole sentences. */
function linesToBlocks(lines) {
  const blocks = [];
  for (const l of lines) {
    const b = blocks[blocks.length - 1];
    const last = b && b.lines[b.lines.length - 1];
    const joins = last && l.cells.length === 1 && last.cells.length === 1
      && Math.abs(l.size - last.size) < 1 && last.y - l.y < l.size * 1.9
      && Math.abs(l.x - b.x) < l.size * 3 && l.bold === last.bold;
    if (joins) { b.lines.push(l); b.x = Math.min(b.x, l.x); b.right = Math.max(b.right, l.right); }
    else blocks.push({ lines: [l], x: l.x, right: l.right, size: l.size, bold: l.bold });
  }
  // Table rows and other multi-cell lines translate cell by cell.
  const out = [];
  for (const b of blocks) {
    if (b.lines.length === 1 && b.lines[0].cells.length > 1) {
      const l = b.lines[0];
      l.cells.forEach(c => out.push({ x: c.x, right: c.x + c.w, top: l.y + l.size * 0.92, bottom: l.y - l.size * 0.28, size: c.size, bold: c.bold, text: c.str.trim(), lineCount: 1 }));
      continue;
    }
    const first = b.lines[0], last = b.lines[b.lines.length - 1];
    const text = b.lines.reduce((s, l) => !s ? l.text : /[-‐]$/.test(s) && /^[a-z]/.test(l.text) ? s.slice(0, -1) + l.text : `${s} ${l.text}`, '');
    out.push({ x: b.x, right: b.right, top: first.y + first.size * 0.92, bottom: last.y - last.size * 0.28, size: b.size, bold: b.bold, text, lineCount: b.lines.length });
  }
  return out.filter(b => /[\p{L}]/u.test(b.text));
}

/* ══════════════ Translate ══════════════ */
const LANGS = [
  ['en','English'],['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['nl','Dutch'],
  ['pl','Polish'],['tr','Turkish'],['sv','Swedish'],['id','Indonesian'],['vi','Vietnamese'],['ru','Russian'],['uk','Ukrainian'],
  ['ar','Arabic'],['ur','Urdu'],['fa','Persian'],['hi','Hindi'],['bn','Bengali'],['zh','Chinese'],['ja','Japanese'],['ko','Korean'],
];
const RTL = ['ar', 'ur', 'fa', 'he'];
const langName = c => (LANGS.find(l => l[0] === c) || [, c])[1];

/** Which on-device translator this browser has. Chrome's built-in Translator
 *  API is fast and needs no model download from us; WebLLM is the fallback. */
async function translatorSupport(src, tgt) {
  if ('Translator' in self && src && src !== 'auto') {
    try { const a = await self.Translator.availability({ sourceLanguage: src, targetLanguage: tgt }); if (a && a !== 'unavailable') return { kind: 'builtin', state: a }; } catch {}
  }
  const ai = await LCP.aiSupport();
  return ai.ok ? { kind: 'llm' } : { kind: 'none', reason: ai.reason };
}

async function detectLanguage(text) {
  if (!('LanguageDetector' in self)) return null;
  try {
    const d = await self.LanguageDetector.create();
    const [top] = await d.detect(text.slice(0, 2000));
    return top && top.confidence > 0.5 ? top.detectedLanguage : null;
  } catch { return null; }
}

async function makeTranslator(src, tgt, onStatus) {
  const sup = await translatorSupport(src, tgt);
  if (sup.kind === 'builtin') {
    const t = await self.Translator.create({ sourceLanguage: src, targetLanguage: tgt,
      monitor: m => m.addEventListener('downloadprogress', e => onStatus && onStatus(`Downloading the ${langName(tgt)} language pack… ${Math.round(e.loaded * 100)}%`)) });
    return { kind: 'builtin', translateAll: async (texts, tick) => { const out = []; for (let i = 0; i < texts.length; i++) { out.push(await t.translate(texts[i])); tick && tick(i + 1); } return out; } };
  }
  if (sup.kind === 'llm') {
    await LCP.loadModel((p, t) => onStatus && onStatus(`Loading on-device AI… ${Math.round(p * 100)}%`));
    return { kind: 'llm', translateAll: async (texts, tick) => {
      const out = new Array(texts.length);
      for (let i = 0; i < texts.length;) {
        // Small numbered batches keep a 1.5B model on track.
        const batch = []; let len = 0;
        while (i + batch.length < texts.length && batch.length < 12 && len < 1200) { len += texts[i + batch.length].length; batch.push(i + batch.length); }
        const prompt = batch.map((k, n) => `${n + 1}. ${texts[k].replace(/\n/g, ' ')}`).join('\n');
        const reply = await LCP.complete([
          { role: 'system', content: `You translate documents into ${langName(tgt)}. Translate every numbered line. Reply with the same numbers, one line each, translation only. Keep numbers, names, codes and amounts unchanged.` },
          { role: 'user', content: prompt }], null, Math.min(1500, len * 2 + 200));
        const got = {};
        reply.split('\n').forEach(l => { const m = l.match(/^\s*(\d+)[.)]\s*(.*)$/); if (m) got[+m[1]] = m[2].trim(); });
        batch.forEach((k, n) => { out[k] = got[n + 1] || texts[k]; });
        i += batch.length; tick && tick(i);
      }
      return out;
    } };
  }
  throw new Error(sup.reason ? `This browser can't translate on-device: ${sup.reason}. Try Chrome 138 or newer on a laptop.` : "This browser can't translate on-device. Try Chrome 138 or newer on a laptop.");
}

/** Characters the standard PDF fonts can draw. Anything else is drawn as an
 *  image by the browser, which knows every script and right-to-left text. */
const winAnsiOk = s => /^[\x20-\x7E -ÿ–—‘’“”•…€]*$/.test(s);

function wrapText(text, maxW, measure) {
  const words = text.split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (measure(t) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return lines;
}

/** Draw `text` inside a block's box, shrinking the font until it fits. */
async function drawFitted(doc, page, block, text, fonts, lang) {
  const w = Math.max(block.right - block.x, block.size * 4), h = Math.max(block.top - block.bottom, block.size * 1.2);
  if (winAnsiOk(text)) {
    const font = block.bold ? fonts.bold : fonts.regular;
    let size = block.size, lines;
    for (; size > 4; size -= 0.5) { lines = wrapText(text, w, t => font.widthOfTextAtSize(t, size)); if (lines.length * size * 1.18 <= h + size * 0.3 && lines.every(l => font.widthOfTextAtSize(l, size) <= w * 1.02)) break; }
    lines = wrapText(text, w, t => font.widthOfTextAtSize(t, size));
    lines.forEach((l, i) => page.drawText(l, { x: block.x, y: block.top - size * 0.92 - i * size * 1.18, size, font, color: PDFLib.rgb(0.07, 0.07, 0.1) }));
    return;
  }
  const S = 4, cw = Math.ceil(w * S), ch = Math.ceil(h * S);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d'); const rtl = RTL.includes(lang);
  ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textBaseline = 'top'; ctx.fillStyle = '#121219';
  let size = block.size * S, lines;
  const set = s => { ctx.font = `${block.bold ? '600 ' : ''}${s}px system-ui, "Noto Sans", "Segoe UI", Arial, sans-serif`; };
  const cjk = /^(zh|ja|ko)$/.test(lang);
  const wrap = s => { set(s); return cjk ? wrapChars(text, cw, t => ctx.measureText(t).width) : wrapText(text, cw, t => ctx.measureText(t).width); };
  for (; size > 4 * S; size -= S / 2) { lines = wrap(size); if (lines.length * size * 1.25 <= ch + size * 0.3) break; }
  lines = wrap(size);
  lines.forEach((l, i) => ctx.fillText(l, rtl ? cw : 0, i * size * 1.25));
  const png = await doc.embedPng(await new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), 'image/png')));
  page.drawImage(png, { x: block.x, y: block.top - h, width: w, height: h });
}
function wrapChars(text, maxW, measure) {
  const lines = []; let cur = '';
  for (const ch of text) { if (measure(cur + ch) > maxW && cur) { lines.push(cur); cur = ch.trim(); } else cur += ch; }
  if (cur) lines.push(cur);
  return lines;
}

/** Translate a PDF in place: cover each paragraph and write the translation
 *  into the same box, so the layout, images and tables stay where they were. */
async function translatePdf(src, { from, to, onProgress, onStatus }) {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(await readFileAsArrayBuffer(src));
  const pdf = await openPdfDoc(bytes);
  onStatus && onStatus('Reading the layout…');
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) { const { lines } = await pageLines(pdf, p); pages.push(linesToBlocks(lines)); }
  const all = pages.flat();
  if (!all.length) throw Object.assign(new Error('No text found. This looks like a scan.'), { scan: true });
  let src_ = from;
  if (!src_ || src_ === 'auto') src_ = (await detectLanguage(all.map(b => b.text).join(' '))) || 'en';
  if (src_ === to) throw new Error(`This document already looks like it's in ${langName(to)}. Pick another language.`);
  onStatus && onStatus('Starting the on-device translator…');
  const tr = await makeTranslator(src_, to, onStatus);
  onStatus && onStatus(`Translating ${all.length} paragraphs into ${langName(to)}…`);
  const out = await tr.translateAll(all.map(b => b.text), n => onProgress && onProgress(Math.round(5 + 85 * n / all.length)));
  onStatus && onStatus('Rebuilding the pages…');
  const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const fonts = { regular: await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold) };
  let k = 0; const texts = [];
  for (let p = 0; p < pages.length; p++) {
    const page = doc.getPage(p); const pageText = [];
    for (const b of pages[p]) {
      const t = (out[k++] || b.text).trim(); pageText.push(t);
      page.drawRectangle({ x: b.x - 1, y: b.bottom - 1, width: b.right - b.x + 2, height: b.top - b.bottom + 2, color: PDFLib.rgb(1, 1, 1) });
      await drawFitted(doc, page, b, t, fonts, to);
    }
    texts.push(pageText.join('\n\n'));
    onProgress && onProgress(90 + Math.round(10 * (p + 1) / pages.length));
  }
  doc.setTitle(`${langName(to)} translation`);
  return { bytes: await doc.save(), texts, from: src_, engine: tr.kind, paragraphs: all.length };
}

function TranslateWorkspace({ file, initialTo, onQuota, onError }) {
  const [to, setTo] = useState(() => { if (initialTo) return initialTo; const l = (navigator.language || 'en').slice(0, 2); return l === 'en' ? 'es' : (LANGS.some(x => x[0] === l) ? l : 'es'); });
  const [from, setFrom] = useState('auto');
  const [state, setState] = useState('idle');   // idle | working | done | scan
  const [status, setStatus] = useState(''); const [pct, setPct] = useState(0);
  const [res, setRes] = useState(null); const [src, setSrc] = useState(null);
  const [page, setPage] = useState(1); const [imgs, setImgs] = useState({});
  const [hasBuiltin] = useState(() => 'Translator' in self);

  const run = async (input) => {
    setState('working'); setPct(0); setStatus('Starting…');
    try {
      if (!input) await onQuota();
      const bytes = input || new Uint8Array(await readFileAsArrayBuffer(file)); setSrc(bytes);
      const r = await translatePdf(bytes, { from, to, onProgress: setPct, onStatus: setStatus });
      setRes(r); setPage(1); setImgs({}); setState('done');
    } catch (e) { if (e.scan) setState('scan'); else { setState('idle'); onError(e); } }
  };
  const ocrThen = async () => {
    setState('working'); setStatus('Recognising text in your scan…');
    try { const bytes = new Uint8Array(await readFileAsArrayBuffer(file)); const r = await LCP.ocrPdf(bytes, setPct, setStatus); await run(r.bytes); }
    catch (e) { setState('idle'); onError(e); }
  };
  useEffect(() => {
    if (state !== 'done') return; let live = true;
    Promise.all([renderPdfPage(src, page, 1.2), renderPdfPage(res.bytes, page, 1.2)]).then(([a, b]) => live && setImgs({ a: a.dataUrl, b: b.dataUrl, n: a.numPages }));
    return () => { live = false; };
  }, [state, page]);
  const dl = (data, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); };
  const base = file.name.replace(/\.pdf$/i, '');

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>From</label>
            <select className="inp" value={from} onChange={e => setFrom(e.target.value)} disabled={state === 'working'} aria-label="From language">
              <option value="auto">Detect automatically</option>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
          <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Translate into</label>
            <select className="inp" value={to} onChange={e => setTo(e.target.value)} disabled={state === 'working'} aria-label="Target language">
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></div>
        </div>
        <p className="text-xs" style={{color:'var(--muted)'}}>
          {hasBuiltin ? "Uses your browser's built-in translator, which runs on this device." : 'Uses the on-device AI (needs a recent laptop and a one-time download).'} Your text never leaves your device. Machine translation can make mistakes, so check anything important.
        </p>
        {state === 'scan'
          ? <div className="rounded-xl p-3 text-sm space-y-2" style={{background:'var(--bg-input)',color:'var(--text)'}}><p>This PDF is a scan, so there's no text to translate yet.</p>
              <button onClick={ocrThen} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{background:'#2563EB'}}>Recognise text, then translate</button></div>
          : <button onClick={() => run()} disabled={state === 'working'} className="w-full py-3.5 rounded-xl font-bold text-white disabled:opacity-60" style={{background:'#2563EB'}}>
              {state === 'working' ? 'Translating…' : state === 'done' ? `Translate again into ${langName(to)}` : `Translate into ${langName(to)}`}</button>}
        {state === 'working' && <div><div className="h-2 rounded-full overflow-hidden" style={{background:'var(--bg-input)'}}><div className="h-full bg-blue-500 transition-all" style={{width:`${pct}%`}}/></div><p className="text-xs mt-2" style={{color:'var(--muted)'}}>{status}</p></div>}
      </div>
      {state === 'done' && res && (
        <div className="card p-4 space-y-3 anim-up">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm flex-1" style={{color:'var(--text)'}}>Translated {res.paragraphs} paragraphs from {langName(res.from)} into {langName(to)}.</p>
            <button onClick={() => dl(res.bytes, `${base}_${to}.pdf`, 'application/pdf')} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{background:'#2563EB'}}>Download PDF</button>
            <button onClick={() => dl(res.texts.map((t, i) => `--- Page ${i + 1} ---\n\n${t}`).join('\n\n'), `${base}_${to}.txt`, 'text/plain;charset=utf-8')} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>Text only</button>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Previous page"><Ic n="left" sz={15}/></button>
            <span className="text-xs" style={{color:'var(--muted)'}}>Page {page} of {imgs.n || '…'}</span>
            <button disabled={page >= (imgs.n || 1)} onClick={() => setPage(p => p + 1)} className="p-1.5 disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Next page"><Ic n="right" sz={15}/></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[['a', 'Original'], ['b', langName(to)]].map(([k, l]) => (
              <figure key={k} className="rounded-xl p-2" style={{background:'rgba(0,0,0,0.2)'}}>
                <figcaption className="text-xs mb-1" style={{color:'var(--muted)'}}>{l}</figcaption>
                {imgs[k] ? <img src={imgs[k]} alt={`${l}, page ${page}`} className="w-full shadow"/> : <div className="aspect-[3/4]"/>}
              </figure>))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════ Smart extract to Excel ══════════════ */
const NUM_RE = /^[-(]?\s*(?:[A-Z]{3}\s?|[$€£₹¥]\s?)?-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\)?%?$|^[-(]?(?:[$€£₹¥]\s?)?-?\d+(?:\.\d+)?\)?%?$/;
const toNumber = s => {
  const t = String(s).trim(); if (!NUM_RE.test(t)) return null;
  if (/^0\d/.test(t.replace(/^[^\d]+/, '')) && !t.includes('.')) return null;   // codes like 00123 stay text
  const neg = /^\(|^-|^[^\d]*-\d/.test(t);
  const n = parseFloat(t.replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : (neg ? -n : n) / (/%$/.test(t) ? 100 : 1);
};

/** Find tables: runs of lines with 2+ cells whose columns line up. */
function findTables(lines, page) {
  const tables = []; let run = [];
  const flush = () => {
    if (run.length >= 2) {
      // Columns: merge overlapping cell spans across all rows.
      const spans = run.flatMap(l => l.cells.map(c => [c.x, c.x + c.w])).sort((a, b) => a[0] - b[0]);
      const cols = [];
      for (const s of spans) { const c = cols[cols.length - 1]; if (c && s[0] <= c[1] + 2) c[1] = Math.max(c[1], s[1]); else cols.push([...s]); }
      const maxCells = Math.max(...run.map(l => l.cells.length));
      if (cols.length >= 2 && cols.length <= maxCells * 1.5 + 1) {
        const rows = run.map(l => {
          const row = cols.map(() => '');
          for (const c of l.cells) {
            let best = 0, bestOv = -Infinity;
            cols.forEach((col, k) => { const ov = Math.min(col[1], c.x + c.w) - Math.max(col[0], c.x); if (ov > bestOv) { bestOv = ov; best = k; } });
            row[best] = row[best] ? `${row[best]} ${c.str.trim()}` : c.str.trim();
          }
          return row;
        });
        tables.push({ page, rows });
      }
    }
    run = [];
  };
  for (const l of lines) {
    const prev = run[run.length - 1];
    if (l.cells.length >= 2 && (!prev || prev.y - l.y < l.size * 3)) run.push(l);
    else { flush(); if (l.cells.length >= 2) run.push(l); }
  }
  flush();
  return tables;
}

const DATE_PAT = String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})`;
const AMOUNT_PAT = String.raw`([A-Z]{3}\s?|[$€£₹¥]\s?)?(-?\d[\d,]*(?:\.\d{1,2})?)`;
const FIELD_RULES = [
  ['Invoice no.', new RegExp(String.raw`\b(?:invoice|inv|receipt|bill|order)\s*(?:no\.?|number|num|#|id)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/]{1,24})`, 'i')],
  ['Due date', new RegExp(String.raw`\b(?:due date|payment due|due by|due)\s*[:.]?\s*` + DATE_PAT, 'i')],
  ['Date', new RegExp(String.raw`\b(?:invoice date|date of issue|issue date|issued|receipt date|date)\s*[:.]?\s*` + DATE_PAT, 'i')],
  ['Subtotal', new RegExp(String.raw`\bsub-?\s?total\s*[:.]?\s*` + AMOUNT_PAT, 'i')],
  ['Tax', new RegExp(String.raw`\b(?:vat|gst|sales tax|tax)(?:\s*\(?\d{1,2}(?:\.\d+)?\s?%\)?)?\s*[:.]?\s*` + AMOUNT_PAT, 'i')],
  ['Total', new RegExp(String.raw`\b(?:grand total|total due|amount due|balance due|total amount|amount payable|total)\s*(?:\([A-Z]{3}\))?\s*[:.]?\s*` + AMOUNT_PAT, 'i')],
];

/** Invoice/receipt fields plus every "Label: value" pair. */
function findFields(pagesLines) {
  const lines = pagesLines.flatMap((ls, i) => ls.map(l => ({ ...l, page: i + 1 })));
  const fields = {}; const pairs = [];
  for (const [name, re] of FIELD_RULES) {
    // Totals: the last match wins (the grand total sits at the bottom).
    const hits = lines.filter(l => !(name === 'Total' && /sub-?\s?total/i.test(l.text))).map(l => ({ l, m: l.text.match(re) })).filter(h => h.m);
    const h = name === 'Total' ? hits[hits.length - 1] : hits[0];
    if (!h) continue;
    const m = h.m; const val = m[m.length - 1];
    fields[name] = { value: val, page: h.l.page };
    if (m.length > 2 && m[m.length - 2] && /Total|Tax|Subtotal/.test(name)) fields.Currency = fields.Currency || { value: m[m.length - 2].trim(), page: h.l.page };
  }
  const first = lines.find(l => l.page === 1 && /\p{L}{2}/u.test(l.text) && !/^(tax\s+)?(invoice|receipt|bill|statement|quotation|quote)\b/i.test(l.text));
  if (first) fields.Vendor = { value: first.cells[0].str.trim().slice(0, 80), page: 1 };
  for (const l of lines) {
    for (const seg of l.cells.length > 1 ? l.cells.map(c => c.str) : [l.text]) {
      const m = seg.match(/^\s*([A-Za-z][A-Za-z0-9 .#/&()'-]{1,40}?)\s*:\s*(.{1,120})$/);
      if (m && m[1].split(/\s+/).length <= 5) pairs.push({ label: m[1].trim(), value: m[2].trim(), page: l.page });
    }
  }
  return { fields, pairs: pairs.slice(0, 80) };
}

async function extractFromPdf(file, onStatus) {
  let bytes = new Uint8Array(await readFileAsArrayBuffer(file));
  let pdf = await openPdfDoc(bytes), ocred = false;
  const read = async () => { const out = []; for (let p = 1; p <= pdf.numPages; p++) out.push((await pageLines(pdf, p)).lines); return out; };
  let pagesLines = await read();
  if (pagesLines.flat().length < 3) {
    onStatus && onStatus(`${file.name}: recognising text in the scan…`);
    const r = await LCP.ocrPdf(bytes, null, s => onStatus && onStatus(`${file.name}: ${s}`));
    bytes = r.bytes; pdf = await openPdfDoc(bytes); pagesLines = await read(); ocred = true;
  }
  const tables = pagesLines.flatMap((ls, i) => findTables(ls, i + 1));
  const { fields, pairs } = findFields(pagesLines);
  const text = pagesLines.map((ls, i) => `[p. ${i + 1}]\n` + ls.map(l => l.text).join('\n')).join('\n\n');
  return { name: file.name, tables, fields, pairs, text, ocred };
}

/** Smart mode: let the on-device model read the invoice and fill gaps. */
async function aiFields(doc) {
  const reply = await LCP.complete([
    { role: 'system', content: 'You extract data from invoices, receipts and statements. Reply with JSON only, no prose.' },
    { role: 'user', content: `Document:\n${doc.text.slice(0, 6000)}\n\nReturn JSON with these keys (use null when absent): vendor, invoice_number, date, due_date, currency, subtotal, tax, total, line_items (array of {description, quantity, unit_price, amount}).` }], null, 900);
  const json = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  const j = JSON.parse(json);
  const map = { Vendor: j.vendor, 'Invoice no.': j.invoice_number, Date: j.date, 'Due date': j.due_date, Currency: j.currency, Subtotal: j.subtotal, Tax: j.tax, Total: j.total };
  for (const [k, v] of Object.entries(map)) if (v != null && v !== '' && !doc.fields[k]) doc.fields[k] = { value: String(v), page: null, ai: true };
  if (Array.isArray(j.line_items) && j.line_items.length && !doc.tables.length)
    doc.tables.push({ page: null, ai: true, rows: [['Description', 'Quantity', 'Unit price', 'Amount'], ...j.line_items.map(r => [r.description, r.quantity, r.unit_price, r.amount].map(v => v == null ? '' : String(v)))] });
  return doc;
}

/* Minimal .xlsx writer (JSZip is already loaded for downloads). */
const xmlEsc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function sheetXml(rows, headerRows = 1) {
  const widths = []; rows.forEach(r => r.forEach((v, c) => { widths[c] = Math.min(60, Math.max(widths[c] || 8, String(v ?? '').length + 2)); }));
  const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`; const st = ri < headerRows ? ' s="1"' : '';
    if (v === '' || v == null) return '';
    const n = typeof v === 'number' ? v : (ri >= headerRows ? toNumber(v) : null);
    return n != null ? `<c r="${ref}"${st}><v>${n}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}
async function buildXlsx(sheets) {
  const zip = new JSZip(); const names = new Set();
  const safe = n => { let s = n.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'; let k = 2; const b = s; while (names.has(s)) s = `${b.slice(0, 28)} ${k++}`; names.add(s); return s; };
  const list = sheets.map((s, i) => ({ ...s, name: safe(s.name), id: i + 1 }));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map(s => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map(s => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(s => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  list.forEach(s => zip.file(`xl/worksheets/sheet${s.id}.xml`, sheetXml(s.rows, s.headerRows ?? 1)));
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const SUMMARY_COLS = ['Vendor', 'Invoice no.', 'Date', 'Due date', 'Currency', 'Subtotal', 'Tax', 'Total'];
function workbookSheets(docs) {
  const sheets = [{ name: 'Summary', rows: [['File', ...SUMMARY_COLS], ...docs.map(d => [d.name, ...SUMMARY_COLS.map(k => d.fields[k]?.value ?? '')])] }];
  const pairs = docs.flatMap(d => d.pairs.map(p => [d.name, p.label, p.value, p.page]));
  if (pairs.length) sheets.push({ name: 'Fields', rows: [['File', 'Field', 'Value', 'Page'], ...pairs] });
  docs.forEach(d => d.tables.slice(0, 30).forEach((t, i) => sheets.push({ name: `${docs.length > 1 ? d.name.replace(/\.pdf$/i, '').slice(0, 18) + ' ' : ''}Table ${i + 1}${t.page ? ` p${t.page}` : ''}`, rows: t.rows })));
  return sheets;
}

function ExtractWorkspace({ files, onQuota, onError }) {
  const [state, setState] = useState('working');
  const [status, setStatus] = useState('Reading your files on this device…');
  const [docs, setDocs] = useState([]);
  const [ai, setAi] = useState(null); const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await onQuota();
        const out = [];
        for (let i = 0; i < files.length; i++) { if (!live) return; setStatus(`Reading ${files[i].name} (${i + 1} of ${files.length})…`); out.push(await extractFromPdf(files[i], s => live && setStatus(s))); }
        if (live) { setDocs(out); setState('done'); }
      } catch (e) { if (live) { setState('done'); onError(e); } }
    })();
    LCP.aiSupport().then(s => live && setAi(s));
    return () => { live = false; };
  }, [files]);
  const improve = async () => {
    setAiBusy(true);
    try { await LCP.loadModel((p) => setStatus(`Loading on-device AI… ${Math.round(p * 100)}%`)); const next = []; for (const d of docs) { setStatus(`Reading ${d.name} with AI…`); next.push(await aiFields({ ...d, fields: { ...d.fields }, tables: [...d.tables] }).catch(() => d)); } setDocs(next); }
    catch (e) { onError(new Error(`The on-device AI could not start: ${e.message}`)); }
    setAiBusy(false); setStatus('');
  };
  const download = async () => {
    const bytes = await buildXlsx(workbookSheets(docs));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = files.length === 1 ? files[0].name.replace(/\.pdf$/i, '') + '.xlsx' : 'extracted.xlsx'; a.click();
  };
  if (state === 'working') return <div className="card p-10 text-center"><div className="w-8 h-8 mx-auto border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"/><p style={{color:'var(--text)'}}>{status}</p></div>;
  const tables = docs.reduce((s, d) => s + d.tables.length, 0);
  const shown = SUMMARY_COLS.filter(k => docs.some(d => d.fields[k]));
  return (
    <div className="space-y-4 anim-up">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm flex-1" style={{color:'var(--text)'}}>Found <strong>{tables} table{tables === 1 ? '' : 's'}</strong> and <strong>{docs.reduce((s, d) => s + Object.keys(d.fields).length + d.pairs.length, 0)} fields</strong> in {docs.length} file{docs.length === 1 ? '' : 's'}.</p>
        {ai?.ok && <button onClick={improve} disabled={aiBusy} className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}><Ic n="sparkle" sz={13}/>{aiBusy ? status || 'Working…' : 'Improve with Smart AI'}</button>}
        <button onClick={download} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{background:'#2563EB'}}>Download Excel</button>
      </div>
      {shown.length > 0 && (
        <div className="card p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-2" style={{color:'var(--text)'}}>Summary</h3>
          <table className="text-xs w-full"><thead><tr>{['File', ...shown].map(h => <th key={h} className="text-left p-1.5 font-semibold" style={{color:'var(--muted)'}}>{h}</th>)}</tr></thead>
            <tbody>{docs.map(d => <tr key={d.name}>{[d.name, ...shown.map(k => d.fields[k]?.value || '')].map((v, i) => <td key={i} className="p-1.5 align-top" style={{color:'var(--text)'}}>{v}</td>)}</tr>)}</tbody></table>
        </div>)}
      {docs.flatMap(d => d.tables.slice(0, 6).map((t, i) => (
        <div key={`${d.name}-${i}`} className="card p-4 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-2" style={{color:'var(--text)'}}>{docs.length > 1 ? `${d.name} · ` : ''}Table {i + 1}{t.page ? ` · page ${t.page}` : ' · read by AI'}</h3>
          <table className="text-xs w-full"><tbody>{t.rows.slice(0, 10).map((r, ri) => <tr key={ri} style={{borderTop: ri ? '1px solid var(--border-s)' : 'none'}}>{r.map((v, ci) => <td key={ci} className={`p-1.5 align-top ${ri === 0 ? 'font-semibold' : ''} ${toNumber(v) != null ? 'text-right tabular-nums' : ''}`} style={{color:'var(--text)'}}>{v}</td>)}</tr>)}</tbody></table>
          {t.rows.length > 10 && <p className="text-xs mt-2" style={{color:'var(--muted)'}}>+ {t.rows.length - 10} more rows in the download</p>}
        </div>)))}
      {!tables && !shown.length && <div className="card p-4 text-sm" style={{color:'var(--muted)'}}>No tables or invoice fields found. {ai?.ok ? 'Try Improve with Smart AI.' : ''} The download still includes any "Label: value" pairs found.</div>}
    </div>
  );
}

/* ══════════════ Contract / document review ══════════════ */
const KEY_TERMS = [
  ['parties', 'Parties', /\b(?:between|by and between)\b.{3,160}?\band\b/i],
  ['start', 'Start date', /\b(?:effective (?:date|as of|from)|commenc\w+|starts? on|start date|dated)\b/i],
  ['term', 'Length of agreement', /\b(?:term of|for a (?:period|term) of|initial term|shall (?:remain|continue) in (?:full )?(?:force|effect)|runs? for)\b/i],
  ['payment', 'Payment', /\b(?:fees?|payment|pay|price|compensation|salary|rent)\b.*\d/i],
  ['notice', 'Notice period', /\b(?:\d+|seven|fourteen|thirty|sixty|ninety)\s*(?:\(\d+\)\s*)?(?:calendar |business |working )?days?['’]?\s*(?:prior\s+)?(?:written\s+)?notice\b/i],
  ['termination', 'Termination', /\bterminat\w*/i],
  ['liability', 'Liability', /\bliabilit(?:y|ies)\b/i],
  ['confidentiality', 'Confidentiality', /\bconfidential\w*/i],
  ['law', 'Governing law', /\b(?:governing law|governed by|construed in accordance with|laws of)\b/i],
];
const RISKS = [
  ['high', 'Unlimited liability', 'One side could owe any amount, with no cap.', /\bunlimited liability|without (?:any )?limit(?:ation)? (?:of|on|to) (?:its |their )?liability|liability shall not be limited/i],
  ['high', 'Terms can change without you', 'The other side can change the deal on its own.', /\b(?:may|can|reserves? the right to)\s+(?:amend|modify|change|update|vary)\b[^.]{0,120}\b(?:at any time|sole discretion|without (?:prior )?notice)|\bsole and absolute discretion\b/i],
  ['high', 'Non-compete', 'Limits the work you can do after this ends.', /\bnon-?compete|\bshall not[^.]{0,40}\b(?:compete|engage in any (?:business|activity))\b/i],
  ['high', 'Rights waived', 'You give up a right to sue, a jury, or class actions.', /\bwaives?\b[^.]{0,40}\b(?:right|claim)s?\b|\bjury trial\b|\bclass action\b/i],
  ['medium', 'Automatic renewal', 'Renews by itself unless someone cancels in time.', /\bautomatic(?:ally)?\s+renew|\bauto-?renew|\brenew(?:s|ed)? automatically|\bsuccessive (?:renewal )?(?:terms|periods)\b/i],
  ['medium', 'Indemnity', 'You may have to cover the other side’s losses.', /\bindemnif(?:y|ies|ication)\b|\bhold harmless\b/i],
  ['medium', 'Penalties or late fees', 'Extra charges if something is late or breached.', /\blate (?:payment )?(?:fee|charge|interest)|\bpenalt(?:y|ies)\b|\bliquidated damages\b|\binterest (?:at|of) (?:the rate of )?\d/i],
  ['medium', 'One-sided termination', 'One side can walk away whenever it likes.', /\bmay terminate[^.]{0,60}\b(?:at any time|for any reason|for convenience|without cause)\b/i],
  ['medium', 'Exclusivity', 'You may not be able to work with others.', /\bexclusiv(?:e|ely|ity)\b/i],
  ['medium', 'You hand over IP', 'Ownership of your work or ideas moves to the other side.', /\b(?:assigns?|transfers?)\s+(?:to [^.]{1,40} )?(?:all\s+)?(?:right,?\s+title|intellectual property)|\bwork(?:s)? made for hire\b/i],
  ['medium', 'Non-solicitation', 'Limits hiring or approaching their staff or clients.', /\bnon-?solicit/i],
];
const BLANK_RE = /_{4,}|\[\s*(?:insert|date|name|amount|address|tbd|tbc|x+|●|•|…|\.\.\.)[^\]]{0,24}\]|\bTBD\b|\bTBC\b|\b(?:XX+|xx+)\b/;
const SIGN_RE = /\b(?:signature|signed(?: by)?|sign here|authori[sz]ed signatory|witness)\b|^\s*by\s*:/i;
const WORD_NUM = { seven: 7, fourteen: 14, thirty: 30, sixty: 60, ninety: 90 };

function toSentences(pagesLines) {
  const out = [];
  pagesLines.forEach((ls, i) => {
    // Lines wrap mid-sentence, so join them; break only after end punctuation,
    // before a numbered clause, or after a short heading line.
    const heading = (l, next) => next && l.text.length < 60 && !/[,;]$/.test(l.text) && (l.bold || l.size > next.size + 0.5);
    const text = ls.map((l, k) => l.text + (heading(l, ls[k + 1]) || l.cells.length > 1 ? '\n\n' : ' ')).join('');
    let carry = '';
    text.split(/\n\n|(?<=[.;!?])\s+(?=[A-Z(“"])|\s+(?=\d{1,2}\.\s+[A-Z])/).forEach(s => {
      const t = s.replace(/\s+/g, ' ').trim(); if (!t) return;
      // Clause titles like "5. Non-compete." belong with the sentence after them.
      if (t.length < 28 && /[.:]$/.test(t)) { carry = carry ? `${carry} ${t}` : t; return; }
      out.push({ text: carry ? `${carry} ${t}` : t, page: i + 1 }); carry = '';
    });
    if (carry.length > 3) out.push({ text: carry, page: i + 1 });
  });
  return out;
}

async function reviewDoc(src, onStatus) {
  let bytes = src instanceof Uint8Array ? src : new Uint8Array(await readFileAsArrayBuffer(src));
  let pdf = await openPdfDoc(bytes);
  const read = async () => { const out = []; for (let p = 1; p <= pdf.numPages; p++) out.push((await pageLines(pdf, p)).lines); return out; };
  let pagesLines = await read();
  if (pagesLines.flat().length < 3) {
    onStatus && onStatus('Recognising text in the scan…');
    const r = await LCP.ocrPdf(bytes, null, onStatus); bytes = r.bytes; pdf = await openPdfDoc(bytes); pagesLines = await read();
  }
  const sents = toSentences(pagesLines);
  if (sents.length < 3) throw new Error('There is too little text in this PDF to review.');
  const terms = KEY_TERMS.map(([id, label, re]) => { const s = sents.find(x => re.test(x.text)); return { id, label, text: s && s.text.slice(0, 260), page: s && s.page }; });
  const findings = [];
  for (const [level, title, why, re] of RISKS) {
    const hits = sents.filter(s => re.test(s.text));
    if (hits.length) findings.push({ level, title, why, text: hits[0].text.slice(0, 300), pages: [...new Set(hits.map(h => h.page))] });
  }
  const notice = sents.map(s => ({ s, m: s.text.match(/\b(\d+|seven|fourteen|thirty|sixty|ninety)\s*(?:\(\d+\)\s*)?(?:calendar |business |working )?days?['’]?\s*(?:prior\s+)?(?:written\s+)?notice/i) })).find(x => x.m);
  if (notice) { const d = WORD_NUM[notice.m[1].toLowerCase()] || parseInt(notice.m[1]); if (d > 60) findings.push({ level: 'medium', title: `Long notice period (${d} days)`, why: 'You need to give a lot of warning to leave or cancel.', text: notice.s.text.slice(0, 300), pages: [notice.s.page] }); }
  const has = id => terms.find(t => t.id === id).text;
  const missing = [];
  if (!has('law')) missing.push('No governing law: it is unclear which country’s courts and rules apply.');
  if (!has('termination')) missing.push('No termination clause: there is no stated way to end the agreement.');
  if (!has('liability')) missing.push('No liability clause: there is no cap on what either side could owe.');
  if (!has('start') && !sents.some(s => new RegExp(DATE_PAT).test(s.text))) missing.push('No dates found: the start date and length are not stated.');
  if (!has('confidentiality')) missing.push('No confidentiality clause.');
  const blanks = sents.filter(s => BLANK_RE.test(s.text) && !SIGN_RE.test(s.text)).slice(0, 15).map(s => ({ text: s.text.slice(0, 160), page: s.page }));
  // Signature lines: a page that asks for a signature but carries no image or signed field.
  const signatures = [];
  const signPages = [...new Set(pagesLines.flatMap((ls, i) => ls.some(l => SIGN_RE.test(l.text)) ? [i + 1] : []))];
  for (const p of signPages) {
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    const O = pdfjsLib.OPS;
    const images = ops.fnArray.filter(f => f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject || f === O.paintImageMaskXObject).length;
    const annots = await page.getAnnotations();
    const signedField = annots.some(a => a.fieldType === 'Sig' && a.fieldValue);
    const ink = annots.some(a => a.subtype === 'Ink' || a.subtype === 'Stamp');
    signatures.push({ page: p, signed: images > 0 || signedField || ink, how: signedField ? 'digital signature' : ink ? 'ink annotation' : images ? 'image on the page' : null });
  }
  return { terms, findings: findings.sort((a, b) => (a.level === 'high' ? 0 : 1) - (b.level === 'high' ? 0 : 1)), missing, blanks, signatures, sents, pages: pagesLines.length, bytes };
}

function reviewReport(name, r, ai) {
  const L = [`Document review: ${name}`, `Made on your device with LetsConvertPDF (letsconvertpdf.com). This is not legal advice.`, ''];
  if (ai) L.push('AI summary', ai, '');
  L.push(`Needs attention (${r.findings.length})`); r.findings.forEach(f => L.push(`- [${f.level}] ${f.title} (p. ${f.pages.join(', ')}): ${f.why}`, `  "${f.text}"`));
  L.push('', 'Missing'); (r.missing.length ? r.missing : ['Nothing obvious missing.']).forEach(m => L.push(`- ${m}`));
  L.push('', 'Unfilled blanks'); (r.blanks.length ? r.blanks.map(b => `- p. ${b.page}: ${b.text}`) : ['- None found.']).forEach(x => L.push(x));
  L.push('', 'Signatures'); (r.signatures.length ? r.signatures.map(s => `- p. ${s.page}: ${s.signed ? `looks signed (${s.how})` : 'signature line looks unsigned'}`) : ['- No signature lines found.']).forEach(x => L.push(x));
  L.push('', 'Key terms'); r.terms.forEach(t => L.push(`- ${t.label}: ${t.text ? `${t.text} (p. ${t.page})` : 'not found'}`));
  return L.join('\n');
}

function ReviewWorkspace({ file, onQuota, onError }) {
  const [state, setState] = useState('working'); const [status, setStatus] = useState('Reading your document on this device…');
  const [r, setR] = useState(null); const [preview, setPreview] = useState(null);
  const [ai, setAi] = useState(null); const [aiText, setAiText] = useState(''); const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => { try { await onQuota(); const res = await reviewDoc(file, s => live && setStatus(s)); if (live) { setR(res); setState('done'); } } catch (e) { if (live) { setState('error'); onError(e); } } })();
    LCP.aiSupport().then(s => live && setAi(s));
    return () => { live = false; };
  }, [file]);
  const explain = async () => {
    setAiBusy(true); setAiText('');
    try {
      await LCP.loadModel(p => setAiText(`Loading on-device AI… ${Math.round(p * 100)}%`)); setAiText('');
      const ctx = [...r.findings.map(f => `[p. ${f.pages[0]}] ${f.title}: ${f.text}`), ...r.terms.filter(t => t.text).map(t => `[p. ${t.page}] ${t.label}: ${t.text}`)].join('\n').slice(0, 5000);
      await LCP.complete([{ role: 'system', content: 'You help people understand contracts before they sign. Use only the excerpts given. Write 4-6 short bullet points in plain English: what the deal is, then the biggest risks for the person signing. Cite pages like [p. 3]. You are not a lawyer; do not give legal advice.' }, { role: 'user', content: ctx }], setAiText, 600);
    } catch (e) { onError(new Error(`The on-device AI could not start: ${e.message}`)); setAiText(''); }
    setAiBusy(false);
  };
  if (state === 'working') return <div className="card p-10 text-center"><div className="w-8 h-8 mx-auto border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"/><p style={{color:'var(--text)'}}>{status}</p></div>;
  if (!r) return null;
  const high = r.findings.filter(f => f.level === 'high').length, med = r.findings.length - high;
  const unsigned = r.signatures.filter(s => !s.signed);
  const Pages = ({ pages }) => <span className="inline-flex gap-1">{pages.map(p => <button key={p} onClick={() => setPreview(p)} className="px-1.5 rounded text-[11px] font-semibold text-blue-400 hover:bg-blue-500/10" style={{border:'1px solid rgba(59,130,246,0.35)'}}>p. {p}</button>)}</span>;
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([reviewReport(file.name, r, aiText)], { type: 'text/plain;charset=utf-8' })); a.download = file.name.replace(/\.pdf$/i, '') + '_review.txt'; a.click(); };
  const chip = (n, l, c) => <div className="rounded-xl p-3 text-center" style={{background:'var(--bg-input)'}}><p className={`text-2xl font-bold ${c}`}>{n}</p><p className="text-xs" style={{color:'var(--muted)'}}>{l}</p></div>;
  return (
    <div className="space-y-4 anim-up">
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{chip(high, 'High risk', high ? 'text-red-400' : 'text-emerald-400')}{chip(med, 'Worth a look', med ? 'text-amber-400' : 'text-emerald-400')}{chip(r.missing.length + r.blanks.length, 'Missing or blank', r.missing.length + r.blanks.length ? 'text-amber-400' : 'text-emerald-400')}{chip(unsigned.length, 'Unsigned pages', unsigned.length ? 'text-amber-400' : 'text-emerald-400')}</div>
        <div className="flex flex-wrap gap-2 items-center">
          <p className="text-xs flex-1" style={{color:'var(--muted)'}}>Checked {r.pages} page{r.pages === 1 ? '' : 's'} on your device. This is a checklist, not legal advice.</p>
          {ai?.ok && <button onClick={explain} disabled={aiBusy} className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}><Ic n="sparkle" sz={13}/>{aiBusy ? 'Explaining…' : 'Explain in plain English'}</button>}
          <button onClick={dl} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{background:'#2563EB'}}>Download report</button>
        </div>
        {aiText && <div className="rounded-xl p-3 text-sm whitespace-pre-wrap" style={{background:'var(--bg-input)',color:'var(--text)'}}><CitedText text={aiText} onPage={setPreview}/></div>}
      </div>
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold" style={{color:'var(--text)'}}>Needs attention</h3>
        {r.findings.length ? r.findings.map((f, i) => (
          <div key={i} className="rounded-xl p-3 space-y-1" style={{background:'var(--bg-input)',borderLeft:`3px solid ${f.level === 'high' ? '#F87171' : '#FBBF24'}`}}>
            <div className="flex flex-wrap items-center gap-2"><span className={`text-[10px] font-bold uppercase ${f.level === 'high' ? 'text-red-400' : 'text-amber-400'}`}>{f.level === 'high' ? 'High' : 'Medium'}</span><span className="text-sm font-semibold" style={{color:'var(--text)'}}>{f.title}</span><Pages pages={f.pages}/></div>
            <p className="text-xs" style={{color:'var(--muted)'}}>{f.why}</p>
            <p className="text-xs italic" style={{color:'var(--text)'}}>“{f.text}”</p>
          </div>)) : <p className="text-sm" style={{color:'var(--muted)'}}>No common risky clauses found.</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-semibold" style={{color:'var(--text)'}}>Missing or left blank</h3>
          {!r.missing.length && !r.blanks.length && <p className="text-sm" style={{color:'var(--muted)'}}>Nothing obvious.</p>}
          {r.missing.map((m, i) => <p key={i} className="text-xs" style={{color:'var(--text)'}}>• {m}</p>)}
          {r.blanks.map((b, i) => <p key={`b${i}`} className="text-xs" style={{color:'var(--text)'}}>• Blank to fill <Pages pages={[b.page]}/> <span style={{color:'var(--muted)'}}>{b.text}</span></p>)}
        </div>
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-semibold" style={{color:'var(--text)'}}>Signatures</h3>
          {r.signatures.length ? r.signatures.map(s => <p key={s.page} className="text-xs flex items-center gap-2" style={{color:'var(--text)'}}><span className={s.signed ? 'text-emerald-400' : 'text-amber-400'}>{s.signed ? '✓' : '!'}</span><Pages pages={[s.page]}/>{s.signed ? `Looks signed (${s.how})` : 'Signature line looks unsigned'}</p>)
            : <p className="text-sm" style={{color:'var(--muted)'}}>No signature lines found.</p>}
        </div>
      </div>
      <div className="card p-4 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-2" style={{color:'var(--text)'}}>Key terms</h3>
        <table className="text-xs w-full"><tbody>{r.terms.map(t => <tr key={t.id} style={{borderTop:'1px solid var(--border-s)'}}><td className="p-1.5 font-semibold align-top w-36" style={{color:'var(--muted)'}}>{t.label}</td><td className="p-1.5 align-top" style={{color: t.text ? 'var(--text)' : 'var(--subtle)'}}>{t.text || 'Not found'} {t.page && <Pages pages={[t.page]}/>}</td></tr>)}</tbody></table>
      </div>
      {preview && <PreviewModal pdfBytes={r.bytes} initialPage={preview} onClose={() => setPreview(null)}/>}
    </div>
  );
}

/* ══════════════ Natural-language command bar ══════════════ */
/* Rule-based on purpose: it is instant, works offline and needs no model. */
const STEP_WORDS = [
  ['compress', /\b(compress|shrink|smaller|reduce (?:the )?(?:file )?size|make (?:it|them) (?:small|light))/],
  ['ocr', /\b(ocr|searchable|recogni[sz]e text|scan(?:ned)? to text)/],
  ['rotate', /\b(rotate|turn (?:the )?pages?|upside down|landscape)/],
  ['watermark', /\b(watermark|stamp)/],
  ['pagenumbers', /\b(page numbers?|number (?:the |all )?pages|paginate|bates)/],
  ['flatten', /\bflatten/],
  ['redact', /\b(redact|black ?out|anonymi[sz]e|hide (?:personal|private|sensitive)|remove (?:personal|private|sensitive))/],
  ['crop', /\b(crop|trim (?:the )?margins?)/],
  ['repair', /\b(repair|fix (?:a |the )?(?:broken|corrupt|damaged))/],
  ['protect', /\b(password|protect|encrypt|lock)\b(?!\s*ed\b)/],
];
const TOOL_WORDS = [
  ['translate', /\b(translat\w*)/],
  ['review', /\b(review|risky|risks?|red flags?|check (?:the |this |my )?(?:contract|agreement|lease|nda))/],
  ['extract', /\b(extract|pull out|invoices?|receipts?|statements?)\b.*\b(excel|xlsx|spreadsheet|csv|rows|table|data)|\b(table|data)s? (?:to|into) (?:excel|a spreadsheet)/],
  ['summarize', /\b(summar\w*|tl;?dr|key points|gist)/],
  ['chat', /\b(ask|question|chat|what does|explain)/],
  ['compare', /\b(compare|diff(?:erence)?s?|what changed|changes between)/],
  ['fillform', /\b(fill (?:in |out )?(?:the |this |a |my )?form|autofill)/],
  ['sign', /\b(sign|signature)\b/],
  ['edit', /\b(edit|add text|white ?out|highlight)/],
  ['unlock', /\b(unlock|remove (?:the )?password|decrypt)/],
  ['split', /\b(split|separate (?:the )?pages|extract pages?)/],
  ['organize', /\b(reorder|re-?arrange|organi[sz]e|delete pages?|remove pages?)/],
  ['pdfa', /\b(pdf\/?a|archiv(?:e|al)|long-?term)/],
  ['pdf2word', /\bto (?:ms )?(?:word|docx?)\b/],
  ['pdf2ppt', /\bto (?:powerpoint|pptx?|slides)\b/],
  ['pdf2excel', /\bto (?:excel|xlsx|spreadsheet)\b/],
  ['pdf2png', /\bto png\b/],
  ['pdf2jpg', /\bto (?:jpe?g|images?|pictures?|photos?)\b/],
  ['img2pdf', /\b(?:images?|photos?|pictures?|jpe?gs?|pngs?) (?:to|into) (?:a )?pdf/],
  ['word2pdf', /\b(?:word|docx?) (?:to|into) pdf/],
  ['excel2pdf', /\b(?:excel|xlsx|spreadsheet) (?:to|into) pdf/],
  ['ppt2pdf', /\b(?:powerpoint|pptx?|slides) (?:to|into) pdf/],
  ['html2pdf', /\b(?:html|web ?page) (?:to|into) pdf/],
];

function parseCommand(raw) {
  const text = (raw || '').trim(); const t = text.toLowerCase();
  if (t.length < 3) return null;
  const merge = /\b(merge|combine|join|put (?:them|these) together|one (?:pdf|file))\b/.test(t);
  // A conversion or AI job names a single tool; it wins over step words it contains.
  const tool = TOOL_WORDS.find(([id, re]) => re.test(t) && !(id === 'sign' && /\bdesign/.test(t)) && !(id === 'chat' && STEP_WORDS.some(([, r]) => r.test(t))));
  const steps = STEP_WORDS.map(([op, re]) => { const m = t.match(re); return m && { op, at: m.index }; }).filter(Boolean)
    .filter(s => !(s.op === 'protect' && tool && tool[0] === 'unlock')).sort((a, b) => a.at - b.at).map(s => ({ op: s.op }));
  const pw = text.match(/\bpassword(?!-?\s*protect)\s*(?:is|=|:|of|as|to)?\s*["'“]?([^\s"'”,;-][^\s"'”,;]{3,})/i);
  for (const s of steps) {
    if (s.op === 'compress') s.level = /\b(max\w*|extreme\w*|strong\w*|smallest|a lot|heav\w*)/.test(t) ? 'extreme' : /\b(light\w*|slight\w*|a (?:bit|little))/.test(t) ? 'low' : 'recommended';
    if (s.op === 'rotate') { const d = t.match(/\b(90|180|270)\b/); s.degrees = d ? d[1] : /left|anti-?clockwise|counter-?clockwise/.test(t) ? '270' : /upside down/.test(t) ? '180' : '90'; }
    if (s.op === 'watermark') { const q = text.match(/["“']([^"”']{2,40})["”']/) || text.match(/\b(?:watermark|stamp)(?:\s+(?:it|them|each page|every page|all pages))?(?:\s+(?:with|as|saying|reading))?\s+([A-Za-z][\w-]{1,24})/i); s.text = q && !/^(then|and|it|the|with|them|all|each|every|pages?)$/i.test(q[1]) ? q[1].toUpperCase() : 'CONFIDENTIAL'; }
    if (s.op === 'pagenumbers' && /\bbates\b/.test(t)) { s.bates = true; const p = text.match(/\bbates\s+(?:numbers?\s+)?(?:with\s+)?(?:prefix\s+)?([A-Z][A-Z0-9_-]{1,11})\b/); s.prefix = p ? p[1] : ''; }
    if (s.op === 'protect') s.password = pw && !/^(protect\w*|lock\w*|then|and)$/i.test(pw[1]) ? pw[1] : '';
  }
  const lang = LANGS.find(([c, n]) => new RegExp(`\\b(?:to|into|in)\\s+${n.toLowerCase()}\\b`).test(t)) || LANGS.find(([c, n]) => c !== 'en' && new RegExp(`\\b${n.toLowerCase()}\\b`).test(t));
  if (tool && !(steps.length && ['chat', 'edit', 'split', 'organize'].includes(tool[0]))) {
    const id = tool[0]; const preset = {};
    if (id === 'translate') preset.to = lang ? lang[0] : undefined;
    if (id === 'unlock' && pw) preset.password = pw[1];
    return { tool: id, preset, label: [TOOLS.find(x => x.id === id)?.label + (id === 'translate' && lang ? ` into ${lang[1]}` : '')] };
  }
  const label = s => s.op === 'compress' ? `Compress (${{ low: 'light', recommended: 'recommended', extreme: 'strong' }[s.level]})`
    : s.op === 'rotate' ? `Rotate ${s.degrees}°` : s.op === 'watermark' ? `Watermark “${s.text}”` : s.op === 'pagenumbers' ? (s.bates ? `Bates numbers${s.prefix ? ` (${s.prefix})` : ''}` : 'Page numbers')
    : s.op === 'protect' ? `Password-protect${s.password ? '' : ' (you’ll set the password)'}` : STEP_LABELS[s.op];
  if (steps.length + (merge ? 1 : 0) >= 2) return { tool: 'workflow', preset: { steps, merge }, label: [...(merge ? ['Merge'] : []), ...steps.map(label)] };
  if (merge) return { tool: 'merge', preset: {}, label: ['Merge'] };
  if (steps.length === 1) {
    const s = steps[0]; const { op, ...rest } = s;
    if (op === 'protect' && s.password) rest.confirmPw = s.password;
    return { tool: op, preset: rest, label: [label(s)] };
  }
  return null;
}

const CMD_EXAMPLES = ['merge these, compress, then password-protect', 'translate this into Spanish', 'pull the invoice totals into Excel', 'check this contract for risky clauses', 'add Bates numbers ACME and flatten'];

function CommandBar({ onRun, autoFocus, compact }) {
  const [q, setQ] = useState('');
  const plan = useMemo(() => parseCommand(q), [q]);
  const submit = e => { e && e.preventDefault(); if (plan) onRun(plan); };
  return (
    <form onSubmit={submit} className="text-left">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400"><Ic n="sparkle" sz={16}/></span>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus} aria-label="Tell us what to do with your PDF"
          placeholder="Tell me what to do… e.g. merge, compress, then password-protect" className="inp w-full" style={{borderRadius:'1rem',padding:'0.875rem 6.5rem 0.875rem 2.75rem'}}/>
        <button type="submit" disabled={!plan} className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{background:'#2563EB'}}>Go</button>
      </div>
      <div className="mt-2 min-h-6 text-xs" style={{color:'var(--muted)'}}>
        {plan ? <span className="flex flex-wrap items-center gap-1.5">I’ll {plan.label.map((l, i) => <React.Fragment key={i}>{i > 0 && <span>→</span>}<span className="px-2 py-0.5 rounded-full" style={{background:'rgba(37,99,235,0.15)',color:'#93C5FD'}}>{l}</span></React.Fragment>)}</span>
          : q.trim().length > 2 ? <span>Not sure what to do yet. Try naming a tool, like “compress” or “translate”.</span>
          : !compact && <span className="flex flex-wrap gap-1.5">{CMD_EXAMPLES.slice(0, 3).map(x => <button type="button" key={x} onClick={() => setQ(x)} className="px-2 py-0.5 rounded-full hover:text-blue-300" style={{border:'1px solid var(--border-s)'}}>{x}</button>)}</span>}
      </div>
    </form>
  );
}

function CommandPalette({ onRun, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4" style={{background:'rgba(0,0,0,0.55)'}} onMouseDown={onClose}>
      <div className="card w-full max-w-xl p-4" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Command bar">
        <CommandBar autoFocus onRun={p => { onClose(); onRun(p); }}/>
        <p className="text-[11px] mt-1" style={{color:'var(--subtle)'}}>Runs on your device. Press Esc to close.</p>
      </div>
    </div>
  );
}
