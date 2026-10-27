/* Release 2 part 2: one entry point for every on-device tool (so tools can be
   batched and chained into workflows), plus the new tools: page numbers and
   Bates, flatten, PDF to PNG, smart redact, form filler, compare and the
   visual editor. Loaded as text/babel before the main app script. */

const asFile = (bytes, name) => new File([bytes], name, { type: 'application/pdf' });
const toItems = (outs) => outs.map(o => ({ url: o.url || URL.createObjectURL(new Blob([o.bytes], { type: o.type || 'application/pdf' })), name: o.name, size: o.bytes ? fmtSize(o.bytes.byteLength) : (o.size || '') }));
const hexRgb = (h = '#000000') => PDFLib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Tools that take one PDF in and give one PDF out: these can run in a batch
 *  and be chained in a workflow. */
const CHAINABLE = ['compress','rotate','watermark','pagenumbers','flatten','ocr','protect','unlock','repair','crop','redact'];

/** Runs one on-device tool. Returns { bytes, name, note } for a single PDF,
 *  or { items, note } for several output files. */
async function runTool(id, files, config, ui = {}) {
  const tick = ui.tick || (() => {}), status = ui.setStatus || (() => {});
  const f = files[0];
  const span = (a, b) => v => tick(a + Math.round(v * (b - a)));
  switch (id) {
    case 'merge':
      if (files.length < 2) throw new Error('Add at least two PDFs to merge.');
      return { bytes: await processMerge(files), name: 'merged.pdf' };
    case 'split': {
      status('Splitting pages…');
      const parts = await processSplit(f);
      return { items: parts.map(p => ({ bytes: p.bytes, name: p.name })) };
    }
    case 'compress': {
      status('Shrinking images on your device…');
      const r = await LCP.compressPdf(f, config.level || 'recommended', span(20, 90));
      const saved = f.size - r.bytes.byteLength;
      return { bytes: r.bytes, name: `compressed_${f.name}`,
        note: !r.kept && saved > 1024 ? `Reduced from ${fmtSize(f.size)} to ${fmtSize(r.bytes.byteLength)} (${Math.round(saved / f.size * 100)}% smaller), without uploading it.` : 'This PDF is already well optimised, so we kept the original quality.' };
    }
    case 'protect':
      if (!config.password || config.password.length < 4) throw new Error('Choose a password of at least 4 characters.');
      if (config.confirmPw !== undefined && config.password !== config.confirmPw) throw new Error('Passwords do not match.');
      status('Encrypting on your device…');
      return { bytes: await LCP.protectPdf(f, config.password), name: `protected_${f.name}` };
    case 'unlock':
      status('Unlocking on your device…');
      return { bytes: await LCP.unlockPdf(f, config.password || ''), name: `unlocked_${f.name}` };
    case 'repair': {
      status('Repairing on your device…');
      const r = await LCP.repairPdf(f, span(20, 90));
      return { bytes: r.bytes, name: `repaired_${f.name}`,
        note: r.method === 'rebuilt' ? 'The file was badly damaged, so each page was rebuilt as an image. Run OCR PDF to make the text searchable again.' : 'The file structure was rebuilt. Check it in the preview.' };
    }
    case 'ocr': {
      const r = await LCP.ocrPdf(f, span(20, 95), status);
      return { bytes: r.bytes, name: `searchable_${f.name}`, note: r.words ? `Recognised ${r.words.toLocaleString()} words. The text is now searchable and selectable.` : 'No text was found on these pages.' };
    }
    case 'rotate':    return { bytes: await processRotate(f, parseInt(config.degrees) || 90), name: `rotated_${f.name}` };
    case 'organize': {
      const ord = config.order ? config.order.split(',').map(s => parseInt(s.trim()) - 1).filter(n => !isNaN(n)) : Array.from({ length: 9999 }, (_, i) => i);
      return { bytes: await processOrganize(f, ord), name: `organized_${f.name}` };
    }
    case 'watermark': return { bytes: await processWatermark(f, config.text || 'CONFIDENTIAL', parseFloat(config.opacity) || 0.25, parseInt(config.fontSize) || 48, config.color), name: `watermarked_${f.name}` };
    case 'crop':      return { bytes: await processCrop(f, parseInt(config.margin) || 20), name: `cropped_${f.name}` };
    case 'sign': {
      const bytes = await processSignPlaced(f, config.sigData, config.place || { page: 0, x: 0.58, y: 0.8, w: 0.3 });
      if (config.remember) { try { localStorage.setItem('lcpdf-signature', config.sigData); } catch {} }
      return { bytes, name: `signed_${f.name}` };
    }
    case 'edit':
      if (!(config.objects || []).length) throw new Error('Add something to the page first: text, a box, a highlight or an image.');
      return { bytes: await processEditObjects(f, config.objects), name: `edited_${f.name}` };
    case 'img2pdf':   return { bytes: await processImageToPDF(files), name: 'images_to_pdf.pdf' };
    case 'pdf2jpg':
    case 'pdf2png': {
      status('Converting pages…');
      const png = id === 'pdf2png';
      const pages = await renderPages(f, png ? 'image/png' : 'image/jpeg', parseFloat(config.scale) || 2, span(20, 95));
      return { items: pages.map((b, i) => ({ bytes: b, type: png ? 'image/png' : 'image/jpeg', name: `page_${i + 1}.${png ? 'png' : 'jpg'}` })) };
    }
    case 'pagenumbers': return { bytes: await processPageNumbers(f, config), name: `numbered_${f.name}` };
    case 'flatten': {
      const r = await processFlatten(f);
      return { bytes: r.bytes, name: `flattened_${f.name}`, note: r.fields ? `Flattened ${r.fields} form field${r.fields === 1 ? '' : 's'} into the page.` : 'This PDF had no form fields; it was saved unchanged.' };
    }
    case 'redact': {
      status('Finding sensitive information…');
      const found = config.matches || await findSensitive(f, config.redactTypes || DEFAULT_REDACT, config.terms || '');
      const chosen = found.filter(m => m.on !== false);
      if (!chosen.length) {
        if (config.matches) throw new Error('Nothing selected to redact.');
        return { bytes: new Uint8Array(await readFileAsArrayBuffer(f)), name: `redacted_${f.name}`, note: 'Nothing sensitive was found, so the file is unchanged.' };
      }
      status('Removing the text for good…');
      const r = await applyRedactions(f, chosen, span(30, 95));
      return { bytes: r, name: `redacted_${f.name}`, note: `Redacted ${chosen.length} item${chosen.length === 1 ? '' : 's'}. Affected pages were rebuilt so the hidden text is truly gone.` };
    }
    case 'fillform': {
      const r = await fillForm(f, config.values || {}, !!config.flatten);
      if (config.saveProfile) saveProfileFrom(config.fields || [], config.values || {});
      return { bytes: r, name: `filled_${f.name}` };
    }
    case 'workflow': return runWorkflow(files, config, ui);
    default: throw new Error('This tool is not available yet.');
  }
}

/* ══════════════ Simple processors ══════════════ */
async function renderPages(file, type, scale, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d'); if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), type, 0.92)));
    onProgress && onProgress(i / pdf.numPages);
  }
  return out;
}

async function processPageNumbers(file, o = {}) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const d = await PDFDocument.load(await readFileAsArrayBuffer(file));
  const font = await d.embedFont(o.bates ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const pages = d.getPages(); const total = pages.length;
  const start = parseInt(o.start) || 1, size = parseInt(o.fontSize) || (o.bates ? 10 : 11), pos = o.position || (o.bates ? 'bottom-right' : 'bottom-center');
  const color = hexRgb(o.color || '#1F2937');
  pages.forEach((pg, i) => {
    if (o.skipFirst && i === 0) return;
    const n = start + i - (o.skipFirst ? 1 : 0);
    const text = o.bates
      ? `${o.prefix || ''}${String(n).padStart(parseInt(o.digits) || 6, '0')}${o.suffix || ''}`
      : ({ n: `${n}`, nN: `${n} of ${total + start - 1 - (o.skipFirst ? 1 : 0)}`, page: `Page ${n}`, pageN: `Page ${n} of ${total + start - 1 - (o.skipFirst ? 1 : 0)}` })[o.format || 'pageN'];
    const { x: bx, y: by, width, height } = pg.getCropBox();
    const w = font.widthOfTextAtSize(text, size), m = 28;
    const x = pos.endsWith('left') ? bx + m : pos.endsWith('right') ? bx + width - w - m : bx + (width - w) / 2;
    const y = pos.startsWith('top') ? by + height - m - size : by + m;
    pg.drawText(text, { x, y, size, font, color });
  });
  return d.save();
}

async function processFlatten(file) {
  const d = await PDFLib.PDFDocument.load(await readFileAsArrayBuffer(file));
  let fields = 0;
  try { const form = d.getForm(); fields = form.getFields().length; if (fields) form.flatten(); } catch {}
  return { bytes: await d.save(), fields };
}

/* ══════════════ Smart redact ══════════════
   Finds sensitive text with patterns plus the user's own words, then rebuilds
   only the affected pages as images with black boxes. Covering text with a
   box (what many tools do) leaves it copyable underneath; this doesn't. */
const REDACT_TYPES = {
  email:  { label: 'Email addresses', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  phone:  { label: 'Phone numbers',   re: /\+?\(?\d[\d\s().-]{5,}\d/g },
  card:   { label: 'Card numbers',    re: /\b(?:\d[ -]?){13,19}\b/g },
  iban:   { label: 'IBAN / account numbers', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g },
  id:     { label: 'ID numbers (SSN, CNIC, NI…)', re: /\b(\d{3}-\d{2}-\d{4}|\d{5}-\d{7}-\d|[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])\b/g },
  date:   { label: 'Dates', re: /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi },
  money:  { label: 'Amounts of money', re: /([$€£₹¥]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|PKR|INR|AED|SAR)\b)/g },
};
const DEFAULT_REDACT = ['email', 'phone', 'card', 'iban', 'id'];

let measureCtx;
const measureText = str => {
  if (!measureCtx) { measureCtx = document.createElement('canvas').getContext('2d'); measureCtx.font = '100px Helvetica, Arial, sans-serif'; }
  return measureCtx.measureText(str).width;
};

async function findSensitive(file, types, terms) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(file)) }).promise;
  const patterns = types.filter(t => REDACT_TYPES[t]).map(t => ({ type: t, re: REDACT_TYPES[t].re }));
  String(terms || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean).forEach(t =>
    patterns.push({ type: 'custom', re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }));
  const found = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const items = (await page.getTextContent()).items.filter(it => it.str);
    // One string per page, remembering which item every character came from.
    let text = ''; const map = [];
    items.forEach((it, idx) => { for (let k = 0; k < it.str.length; k++) map.push([idx, k]); text += it.str; map.push([idx, it.str.length]); text += ' '; });
    for (const { type, re } of patterns) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) {
        if (type === 'card' && m[0].replace(/\D/g, '').length < 13) continue;
        if (type === 'phone') { const d = m[0].replace(/\D/g, '').length; if (d < 7 || d > 15) continue; }
        const rects = [];
        const byItem = new Map();
        for (let c = m.index; c < m.index + m[0].length; c++) { const [idx, k] = map[c]; const r = byItem.get(idx) || [k, k]; byItem.set(idx, [Math.min(r[0], k), Math.max(r[1], k + 1)]); }
        byItem.forEach(([a, b], idx) => {
          const it = items[idx]; const len = Math.max(1, it.str.length);
          const h = Math.hypot(it.transform[2], it.transform[3]) || 10;
          // Proportional fonts: place the box by measured glyph widths, scaled to the item's real width.
          const full = measureText(it.str) || len, scale = it.width / full;
          const x = it.transform[4] + measureText(it.str.slice(0, a)) * scale, w = measureText(it.str.slice(a, Math.min(b, len))) * scale;
          rects.push({ x: x - h * 0.3, y: it.transform[5] - h * 0.3, w: w + h * 0.6, h: h * 1.35 });
        });
        if (rects.length) found.push({ page: p, type, text: m[0].trim(), rects, on: true });
      }
    }
  }
  return found.filter((f, i, all) => all.findIndex(g => g.page === f.page && g.text === f.text && g.rects[0].x === f.rects[0].x) === i);
}

async function applyRedactions(file, matches, onProgress) {
  const { PDFDocument } = PDFLib;
  const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
  const doc = await PDFDocument.load(bytes);
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const pages = [...new Set(matches.map(m => m.page))].sort((a, b) => a - b);
  let i = 0;
  for (const p of pages) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 200 / 72 });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.fillStyle = '#000';
    for (const m of matches.filter(m => m.page === p)) for (const r of m.rects) {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    const jpg = await doc.embedJpg(await new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/jpeg', 0.9)));
    const base = page.getViewport({ scale: 1 });
    const fresh = doc.insertPage(p - 1, [base.width, base.height]);
    fresh.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    doc.removePage(p);
    onProgress && onProgress(++i / pages.length);
  }
  // Hidden copies of the text can also live in metadata.
  doc.setTitle(''); doc.setSubject(''); doc.setKeywords([]); doc.setAuthor('');
  return doc.save();
}

function RedactPanel({ file, config, set }) {
  const types = config.redactTypes || DEFAULT_REDACT;
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    setBusy(true);
    try { set(c => ({ ...c, matches: null })); const m = await findSensitive(file, types, config.terms || ''); set(c => ({ ...c, matches: m })); }
    catch (e) { set(c => ({ ...c, matches: [] })); }
    setBusy(false);
  };
  useEffect(() => { scan(); }, [file, types.join(), config.terms]);
  const toggle = i => set(c => ({ ...c, matches: c.matches.map((m, k) => k === i ? { ...m, on: !m.on } : m) }));
  const matches = config.matches || [];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium mb-2" style={{color:'var(--muted)'}}>Look for</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(REDACT_TYPES).map(([k, t]) => (
            <label key={k} className="flex items-center gap-2 text-sm" style={{color:'var(--text)'}}>
              <input type="checkbox" checked={types.includes(k)} onChange={e => set(c => ({ ...c, redactTypes: e.target.checked ? [...types, k] : types.filter(x => x !== k) }))}/>{t.label}
            </label>
          ))}
        </div>
      </div>
      <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Also redact these words or names (comma-separated)</label>
        <input className="inp" defaultValue={config.terms || ''} onBlur={e => set(c => ({ ...c, terms: e.target.value }))} placeholder="e.g. Jane Doe, Project Falcon"/></div>
      <div className="rounded-xl p-3" style={{background:'var(--bg-input)'}}>
        {busy ? <p className="text-sm" style={{color:'var(--muted)'}}>Scanning your document on this device…</p>
          : matches.length ? <>
            <p className="text-xs mb-2" style={{color:'var(--muted)'}}>Found {matches.length}. Untick anything you want to keep.</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {matches.map((m, i) => (
                <label key={i} className="flex items-center gap-2 text-sm" style={{color:'var(--text)'}}>
                  <input type="checkbox" checked={m.on !== false} onChange={() => toggle(i)}/>
                  <span className="font-mono truncate" style={{background: m.on !== false ? '#000' : 'transparent', color: m.on !== false ? '#fff' : 'var(--text)', padding:'0 4px', borderRadius:3}}>{m.text}</span>
                  <span className="text-xs ml-auto shrink-0" style={{color:'var(--muted)'}}>p.{m.page} · {m.type === 'custom' ? 'your word' : REDACT_TYPES[m.type].label.toLowerCase()}</span>
                </label>
              ))}
            </div></>
          : <p className="text-sm" style={{color:'var(--muted)'}}>Nothing sensitive found with these settings. Add words above, or tick more types. Scanned pages need OCR PDF first.</p>}
      </div>
    </div>
  );
}

/* ══════════════ Form filler ══════════════
   Reads the PDF's fillable fields and pre-fills them from a profile the user
   keeps in this browser, matching field names like "First Name", "fname" or
   "applicant_email". Nothing about the profile leaves the device. */
const PROFILE_KEY = 'lcpdf-profile';
const PROFILE_FIELDS = [
  ['fullName', 'Full name', /^(full.?name|name|applicant.?name|your.?name|signatory|print.?name)$/],
  ['firstName', 'First name', /(first|given|fore).?name|fname/],
  ['lastName', 'Last name', /(last|family|sur).?name|lname/],
  ['email', 'Email', /e.?mail/],
  ['phone', 'Phone', /phone|mobile|tel|cell/],
  ['address', 'Street address', /address|street|addr/],
  ['city', 'City', /city|town/],
  ['postcode', 'Postcode / ZIP', /post.?code|zip/],
  ['country', 'Country', /country|nation/],
  ['dob', 'Date of birth', /birth|dob/],
  ['company', 'Company', /company|organi[sz]ation|employer|business/],
];
const loadProfile = () => { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; } };
const normName = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '');
function profileKeyFor(fieldName) {
  const n = normName(fieldName);
  if (/date|signed.?on|today/.test(n) && !/birth|dob/.test(n)) return 'today';
  for (const [k, , re] of PROFILE_FIELDS) if (re.test(n)) return k;
  return null;
}
function saveProfileFrom(fields, values) {
  const p = loadProfile();
  for (const f of fields) { const k = profileKeyFor(f.name); if (k && k !== 'today' && values[f.name]) p[k] = values[f.name]; }
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
}

// pdf-lib's minified build renames classes, so match on instanceof rather than constructor.name
const fieldType = f => ['TextField', 'CheckBox', 'Dropdown', 'OptionList', 'RadioGroup'].find(t => f instanceof PDFLib['PDF' + t]) || 'Other';

async function readFormFields(file) {
  const d = await PDFLib.PDFDocument.load(await readFileAsArrayBuffer(file));
  let fields = [];
  try { fields = d.getForm().getFields(); } catch {}
  return fields.map(f => {
    const type = fieldType(f);
    const out = { name: f.getName(), type };
    try {
      if (type === 'TextField') out.value = f.getText() || '';
      if (type === 'CheckBox') out.value = f.isChecked();
      if (type === 'Dropdown' || type === 'OptionList') { out.options = f.getOptions(); out.value = (f.getSelected() || [])[0] || ''; }
      if (type === 'RadioGroup') { out.options = f.getOptions(); out.value = f.getSelected() || ''; }
    } catch {}
    return out;
  }).filter(f => ['TextField', 'CheckBox', 'Dropdown', 'OptionList', 'RadioGroup'].includes(f.type));
}

async function fillForm(file, values, flatten) {
  const d = await PDFLib.PDFDocument.load(await readFileAsArrayBuffer(file));
  const form = d.getForm();
  for (const f of form.getFields()) {
    const v = values[f.getName()]; if (v === undefined) continue;
    const type = fieldType(f);
    try {
      if (type === 'TextField') f.setText(String(v));
      else if (type === 'CheckBox') v ? f.check() : f.uncheck();
      else if ((type === 'Dropdown' || type === 'OptionList') && v) f.select(v);
      else if (type === 'RadioGroup' && v) f.select(v);
    } catch {}
  }
  if (flatten) form.flatten();
  return d.save();
}

function FormFiller({ file, config, set }) {
  const [state, setState] = useState('loading');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(loadProfile);
  const fields = config.fields || [];
  const values = config.values || {};
  useEffect(() => {
    let live = true;
    readFormFields(file).then(fs => {
      if (!live) return;
      const v = {}; fs.forEach(f => { v[f.name] = f.value; });
      set(c => ({ ...c, fields: fs, values: v })); setState(fs.length ? 'ready' : 'none');
    }).catch(() => live && setState('none'));
    return () => { live = false; };
  }, [file]);
  const setVal = (n, v) => set(c => ({ ...c, values: { ...c.values, [n]: v } }));
  const autofill = () => {
    const p = loadProfile(); let n = 0;
    const v = { ...values };
    for (const f of fields) {
      if (f.type !== 'TextField') continue;
      const k = profileKeyFor(f.name);
      const val = k === 'today' ? new Date().toLocaleDateString() : k === 'fullName' && !p.fullName && p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : p[k];
      if (k && val && !v[f.name]) { v[f.name] = val; n++; }
    }
    set(c => ({ ...c, values: v, autofilled: n }));
  };
  const saveProfile = () => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} setProfileOpen(false); };
  const hasProfile = Object.values(loadProfile()).some(Boolean);

  if (state === 'loading') return <p className="text-sm" style={{color:'var(--muted)'}}>Reading the form…</p>;
  if (state === 'none') return <p className="text-sm" style={{color:'var(--muted)'}}>This PDF has no fillable fields. Use <a href="/edit-pdf" className="text-blue-400">Edit PDF</a> to type straight onto the page instead.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={autofill} disabled={!hasProfile} className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 flex items-center gap-1.5" style={{background:'#2563EB'}}><Ic n="sparkle" sz={13}/>Autofill from my profile</button>
        <button onClick={() => setProfileOpen(o => !o)} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>{hasProfile ? 'Edit my profile' : 'Set up my profile'}</button>
        {config.autofilled !== undefined && <span className="text-xs text-emerald-400">Filled {config.autofilled} field{config.autofilled === 1 ? '' : 's'}</span>}
      </div>
      {profileOpen && (
        <div className="rounded-xl p-4 space-y-2" style={{background:'var(--bg-input)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>Saved only in this browser. Used to fill forms in one click.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PROFILE_FIELDS.map(([k, label]) => <input key={k} className="inp" placeholder={label} aria-label={label} value={profile[k] || ''} onChange={e => setProfile(p => ({ ...p, [k]: e.target.value }))}/>)}
          </div>
          <button onClick={saveProfile} className="px-4 py-2 rounded-xl text-xs font-bold text-white" style={{background:'#2563EB'}}>Save profile</button>
        </div>
      )}
      <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
        {fields.map(f => (
          <div key={f.name}>
            <label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>{f.name}</label>
            {f.type === 'TextField' && <input className="inp" value={values[f.name] || ''} onChange={e => setVal(f.name, e.target.value)}/>}
            {f.type === 'CheckBox' && <input type="checkbox" checked={!!values[f.name]} onChange={e => setVal(f.name, e.target.checked)} aria-label={f.name}/>}
            {(f.type === 'Dropdown' || f.type === 'OptionList' || f.type === 'RadioGroup') && (
              <select className="inp" value={values[f.name] || ''} onChange={e => setVal(f.name, e.target.value)}>
                <option value="">Choose…</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs" style={{color:'var(--text)'}}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!config.flatten} onChange={e => set(c => ({ ...c, flatten: e.target.checked }))}/> Lock the answers (flatten)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!config.saveProfile} onChange={e => set(c => ({ ...c, saveProfile: e.target.checked }))}/> Save my answers to my profile</label>
      </div>
    </div>
  );
}

/* ══════════════ Visual editor ══════════════
   Objects are stored per page as fractions of the page size:
   { type: 'text'|'whiteout'|'box'|'highlight'|'image', page, x, y, w, h, text, size, color, src } */
const PALETTE = [['text','Text'],['whiteout','White-out'],['highlight','Highlight'],['box','Box'],['image','Image']];

function EditorStudio({ file, config, set }) {
  const [page, setPage] = useState(0);
  const [num, setNum] = useState(1);
  const [img, setImg] = useState(null);
  const [sel, setSel] = useState(null);
  const box = useRef(null); const drag = useRef(null); const imgInput = useRef(null);
  const objects = config.objects || [];
  const setObjects = fn => set(c => ({ ...c, objects: fn(c.objects || []) }));
  useEffect(() => {
    let live = true;
    readFileAsArrayBuffer(file).then(b => renderPdfPage(new Uint8Array(b), page + 1, 1.4)).then(r => { if (live) { setImg(r.dataUrl); setNum(r.numPages); } }).catch(() => {});
    return () => { live = false; };
  }, [file, page]);

  const add = (type, extra = {}) => {
    const o = { id: Date.now() + Math.random(), type, page, x: 0.3, y: 0.3, w: type === 'text' ? 0.4 : 0.3, h: type === 'text' ? 0.04 : 0.06,
      text: type === 'text' ? 'Your text' : '', size: 14, color: type === 'highlight' ? '#FDE047' : type === 'box' ? '#2563EB' : '#111827', ...extra };
    setObjects(os => [...os, o]); setSel(o.id);
  };
  const pickImage = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => add('image', { src: r.result, w: 0.3, h: 0.3 * (im.height / im.width) * (box.current ? box.current.clientWidth / box.current.clientHeight : 0.7) }); im.src = r.result; };
    r.readAsDataURL(f);
  };
  const update = (id, patch) => setObjects(os => os.map(o => o.id === id ? { ...o, ...patch } : o));
  const remove = id => { setObjects(os => os.filter(o => o.id !== id)); setSel(null); };
  const down = (o, mode) => e => {
    e.stopPropagation(); setSel(o.id);
    if (e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const r = box.current.getBoundingClientRect();
    drag.current = { id: o.id, mode, sx: e.clientX, sy: e.clientY, o: { ...o }, w: r.width, h: r.height };
  };
  const move = e => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / d.w, dy = (e.clientY - d.sy) / d.h;
    if (d.mode === 'move') update(d.id, { x: Math.max(0, Math.min(1 - d.o.w, d.o.x + dx)), y: Math.max(0, Math.min(1 - d.o.h, d.o.y + dy)) });
    else update(d.id, { w: Math.max(0.02, Math.min(1 - d.o.x, d.o.w + dx)), h: Math.max(0.015, Math.min(1 - d.o.y, d.o.h + dy)) });
  };
  const selected = objects.find(o => o.id === sel);
  const onPage = objects.filter(o => o.page === page);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PALETTE.map(([t, l]) => <button key={t} onClick={() => t === 'image' ? imgInput.current.click() : add(t)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>+ {l}</button>)}
        <input ref={imgInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pickImage}/>
      </div>
      {selected && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={{background:'var(--bg-input)'}}>
          {selected.type === 'text' && <>
            <input className="inp flex-1 min-w-40" value={selected.text} onChange={e => update(selected.id, { text: e.target.value })} aria-label="Text"/>
            <input className="inp w-20" type="number" min="6" max="96" value={selected.size} onChange={e => update(selected.id, { size: parseInt(e.target.value) || 12 })} aria-label="Font size"/>
          </>}
          {selected.type !== 'whiteout' && selected.type !== 'image' && <input type="color" value={selected.color} onChange={e => update(selected.id, { color: e.target.value })} className="w-9 h-9 rounded cursor-pointer bg-transparent border-0" aria-label="Colour"/>}
          <button onClick={() => remove(selected.id)} className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10">Delete</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button disabled={page <= 0} onClick={() => { setPage(p => p - 1); setSel(null); }} className="p-1.5 rounded-lg disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Previous page"><Ic n="left" sz={15}/></button>
          <span className="text-xs" style={{color:'var(--muted)'}}>Page {page + 1} of {num}</span>
          <button disabled={page >= num - 1} onClick={() => { setPage(p => p + 1); setSel(null); }} className="p-1.5 rounded-lg disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Next page"><Ic n="right" sz={15}/></button>
        </div>
        <span className="text-xs" style={{color:'var(--muted)'}}>{objects.length} edit{objects.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex justify-center rounded-xl p-3" style={{background:'rgba(0,0,0,0.2)'}}>
        <div ref={box} className="relative select-none touch-none" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerDown={() => setSel(null)}>
          {img ? <img src={img} alt={`Page ${page + 1}`} className="block max-w-full shadow-xl" style={{maxHeight:'65vh'}} draggable={false}/> : <div className="w-64 h-80"/>}
          {img && onPage.map(o => (
            <div key={o.id} onPointerDown={down(o, 'move')} className="absolute cursor-move"
              style={{ left:`${o.x*100}%`, top:`${o.y*100}%`, width:`${o.w*100}%`, height:`${o.h*100}%`,
                outline: sel === o.id ? '2px solid #2563EB' : '1px dashed rgba(37,99,235,0.5)',
                background: o.type === 'whiteout' ? '#fff' : o.type === 'highlight' ? `${o.color}66` : 'transparent',
                border: o.type === 'box' ? `2px solid ${o.color}` : 'none' }}>
              {o.type === 'text' && <span className="block whitespace-nowrap overflow-visible pointer-events-none" style={{ color:o.color, fontFamily:'Helvetica, Arial, sans-serif', fontSize:`${o.size * (box.current ? box.current.clientWidth / 595 : 1)}px`, lineHeight:1 }}>{o.text}</span>}
              {o.type === 'image' && <img src={o.src} alt="" className="w-full h-full pointer-events-none" draggable={false}/>}
              {sel === o.id && <span onPointerDown={down(o, 'resize')} className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full cursor-nwse-resize" style={{background:'#2563EB',border:'2px solid #fff'}}/>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

async function processEditObjects(file, objects) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const d = await PDFDocument.load(await readFileAsArrayBuffer(file));
  const font = await d.embedFont(StandardFonts.Helvetica);
  const pages = d.getPages();
  for (const o of objects) {
    const pg = pages[o.page]; if (!pg) continue;
    const { x: bx, y: by, width, height } = pg.getCropBox();
    const x = bx + o.x * width, w = o.w * width, h = o.h * height, y = by + height - o.y * height - h;
    if (o.type === 'whiteout') pg.drawRectangle({ x, y, width: w, height: h, color: PDFLib.rgb(1, 1, 1) });
    else if (o.type === 'highlight') pg.drawRectangle({ x, y, width: w, height: h, color: hexRgb(o.color), opacity: 0.4 });
    else if (o.type === 'box') pg.drawRectangle({ x, y, width: w, height: h, borderColor: hexRgb(o.color), borderWidth: 1.5 });
    else if (o.type === 'text' && o.text) {
      // The on-screen size is relative to a 595pt-wide page, so scale it to this page.
      const size = o.size * (width / 595);
      pg.drawText(o.text.replace(/[^\x20-\x7E -ÿ]/g, '?'), { x, y: by + height - o.y * height - size * 0.8, size, font, color: hexRgb(o.color) });
    } else if (o.type === 'image' && o.src) {
      const raw = Uint8Array.from(atob(o.src.split(',')[1]), c => c.charCodeAt(0));
      const im = o.src.startsWith('data:image/png') ? await d.embedPng(raw) : await d.embedJpg(raw);
      pg.drawImage(im, { x, y, width: w, height: h });
    }
  }
  return d.save();
}

/* ══════════════ Page numbers panel ══════════════ */
function PageNumbersPanel({ config, set }) {
  const v = (k, d) => config[k] ?? d;
  const ch = k => e => set(c => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{background:'var(--bg-input)'}}>
        {[[false,'Page numbers'],[true,'Bates numbering']].map(([b,l]) => (
          <button key={l} onClick={() => set(c => ({ ...c, bates: b }))} className="px-4 py-1.5 rounded-lg text-xs font-semibold" style={{background:!!config.bates===b?'#2563EB':'transparent',color:!!config.bates===b?'#fff':'var(--muted)'}}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Position</label>
          <select className="inp" value={v('position', config.bates ? 'bottom-right' : 'bottom-center')} onChange={ch('position')}>
            {[['bottom-center','Bottom centre'],['bottom-right','Bottom right'],['bottom-left','Bottom left'],['top-center','Top centre'],['top-right','Top right'],['top-left','Top left']].map(([a,b]) => <option key={a} value={a}>{b}</option>)}
          </select></div>
        {config.bates ? <>
          <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Prefix</label><input className="inp" value={v('prefix','')} onChange={ch('prefix')} placeholder="ACME"/></div>
          <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Digits</label><input className="inp" type="number" min="1" max="12" value={v('digits',6)} onChange={ch('digits')}/></div>
        </> : <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Format</label>
          <select className="inp" value={v('format','pageN')} onChange={ch('format')}>
            {[['pageN','Page 1 of 9'],['page','Page 1'],['nN','1 of 9'],['n','1']].map(([a,b]) => <option key={a} value={a}>{b}</option>)}
          </select></div>}
        <div><label className="block text-xs font-medium mb-1" style={{color:'var(--muted)'}}>Start at</label><input className="inp" type="number" min="0" value={v('start',1)} onChange={ch('start')}/></div>
      </div>
      <label className="flex items-center gap-2 text-xs" style={{color:'var(--text)'}}><input type="checkbox" checked={!!config.skipFirst} onChange={ch('skipFirst')}/> Don't number the first page (cover)</label>
      {config.bates && <p className="text-xs" style={{color:'var(--muted)'}}>Example: {(config.prefix||'')}{String(parseInt(v('start',1))||1).padStart(parseInt(v('digits',6))||6,'0')}. Batch several files and numbering continues across them.</p>}
    </div>
  );
}

/* ══════════════ Workflows ══════════════ */
const STEP_LABELS = { compress:'Compress', rotate:'Rotate', watermark:'Watermark', pagenumbers:'Page numbers', flatten:'Flatten forms', ocr:'OCR (make searchable)', protect:'Password-protect', repair:'Repair', crop:'Crop margins', redact:'Smart redact' };
const BUILTIN_FLOWS = [
  { name: 'Prepare for email', steps: [{ op:'compress', level:'recommended' }] },
  { name: 'Share confidentially', steps: [{ op:'watermark', text:'CONFIDENTIAL' }, { op:'redact' }, { op:'protect', password:'' }] },
  { name: 'Archive scans', steps: [{ op:'ocr' }, { op:'compress', level:'low' }] },
  { name: 'Court bundle', merge: true, steps: [{ op:'pagenumbers', bates:true, prefix:'BUNDLE-' }, { op:'compress', level:'low' }] },
];
const FLOWS_KEY = 'lcpdf-workflows';
const loadFlows = () => { try { return JSON.parse(localStorage.getItem(FLOWS_KEY)) || []; } catch { return []; } };

async function runWorkflow(files, config, ui = {}) {
  const steps = config.steps || [];
  if (!steps.length) throw new Error('Add at least one step.');
  for (const s of steps) if (s.op === 'protect' && (!s.password || s.password.length < 4)) throw new Error('Enter a password (4+ characters) for the Password-protect step.');
  let inputs = files;
  if (config.merge && files.length > 1) { ui.setStatus && ui.setStatus('Merging files…'); inputs = [asFile(await processMerge(files), 'merged.pdf')]; }
  const outs = []; let batesNext = null;
  for (let fi = 0; fi < inputs.length; fi++) {
    let cur = inputs[fi]; const baseName = cur.name;
    for (let si = 0; si < steps.length; si++) {
      const s = { ...steps[si] };
      ui.setStatus && ui.setStatus(`${inputs.length > 1 ? `File ${fi + 1} of ${inputs.length}: ` : ''}${STEP_LABELS[s.op]} (step ${si + 1} of ${steps.length})…`);
      ui.tick && ui.tick(10 + Math.round(85 * (fi * steps.length + si) / (inputs.length * steps.length)));
      if (s.op === 'pagenumbers' && s.bates && batesNext !== null) s.start = batesNext;
      const r = await runTool(s.op, [cur], s, {});
      if (s.op === 'pagenumbers' && s.bates) batesNext = (parseInt(s.start) || 1) + (await PDFLib.PDFDocument.load(r.bytes, { ignoreEncryption: true })).getPageCount();
      cur = asFile(r.bytes, baseName);
    }
    outs.push({ bytes: new Uint8Array(await cur.arrayBuffer()), name: `${baseName.replace(/\.pdf$/i, '')}_done.pdf` });
  }
  const note = `Ran ${steps.length} step${steps.length === 1 ? '' : 's'} on ${inputs.length} file${inputs.length === 1 ? '' : 's'}, all on your device.`;
  return outs.length === 1 ? { bytes: outs[0].bytes, name: outs[0].name, note } : { items: outs, note };
}

function StepOptions({ step, onChange }) {
  const ch = k => e => onChange({ ...step, [k]: e.target.value });
  if (step.op === 'compress') return <select className="inp" value={step.level || 'recommended'} onChange={ch('level')}><option value="low">Light</option><option value="recommended">Recommended</option><option value="extreme">Strong</option></select>;
  if (step.op === 'rotate') return <select className="inp" value={step.degrees || 90} onChange={ch('degrees')}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select>;
  if (step.op === 'watermark') return <input className="inp" value={step.text || ''} onChange={ch('text')} placeholder="Watermark text"/>;
  if (step.op === 'protect') return <input className="inp" type="password" autoComplete="new-password" value={step.password || ''} onChange={ch('password')} placeholder="Password"/>;
  if (step.op === 'pagenumbers') return <div className="flex gap-2"><select className="inp" value={step.bates ? 'bates' : 'pages'} onChange={e => onChange({ ...step, bates: e.target.value === 'bates' })}><option value="pages">Page 1 of 9</option><option value="bates">Bates</option></select>{step.bates && <input className="inp" value={step.prefix || ''} onChange={ch('prefix')} placeholder="Prefix"/>}</div>;
  if (step.op === 'crop') return <input className="inp" type="number" value={step.margin || 20} onChange={ch('margin')} aria-label="Margin (pt)"/>;
  if (step.op === 'redact') return <span className="text-xs" style={{color:'var(--muted)'}}>Emails, phones, card, IBAN and ID numbers</span>;
  return null;
}

function WorkflowBuilder({ config, set }) {
  const [saved, setSaved] = useState(loadFlows);
  const [name, setName] = useState('');
  const steps = config.steps || [];
  const setSteps = fn => set(c => ({ ...c, steps: fn(c.steps || []) }));
  const use = f => set(c => ({ ...c, steps: f.steps.map(s => ({ ...s })), merge: !!f.merge }));
  useEffect(() => { if (!config.steps) use(BUILTIN_FLOWS[0]); }, []);
  const save = () => {
    if (!name.trim() || !steps.length) return;
    const next = [...saved.filter(f => f.name !== name.trim()), { name: name.trim(), merge: !!config.merge, steps: steps.map(s => s.op === 'protect' ? { ...s, password: '' } : s) }];
    setSaved(next); try { localStorage.setItem(FLOWS_KEY, JSON.stringify(next)); } catch {} setName('');
  };
  const del = n => { const next = saved.filter(f => f.name !== n); setSaved(next); try { localStorage.setItem(FLOWS_KEY, JSON.stringify(next)); } catch {} };
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium mb-2" style={{color:'var(--muted)'}}>Start from a preset</p>
        <div className="flex flex-wrap gap-2">
          {[...BUILTIN_FLOWS, ...saved].map(f => (
            <span key={f.name} className="inline-flex items-center rounded-full text-xs" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>
              <button onClick={() => use(f)} className="px-3 py-1.5">{f.name}</button>
              {saved.includes(f) && <button onClick={() => del(f.name)} className="pr-2 text-red-400" aria-label={`Delete ${f.name}`}>×</button>}
            </span>
          ))}
        </div>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={{background:'var(--bg-input)'}}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{background:'#2563EB'}}>{i + 1}</span>
            <span className="text-sm font-medium w-40 shrink-0" style={{color:'var(--text)'}}>{STEP_LABELS[s.op]}</span>
            <div className="flex-1 min-w-40"><StepOptions step={s} onChange={n => setSteps(ss => ss.map((x, k) => k === i ? n : x))}/></div>
            <button disabled={i === 0} onClick={() => setSteps(ss => { const n = [...ss]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} className="p-1 disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Move step up">↑</button>
            <button onClick={() => setSteps(ss => ss.filter((_, k) => k !== i))} className="p-1 text-red-400" aria-label="Remove step">✕</button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <select className="inp w-auto" value="" onChange={e => { if (e.target.value) setSteps(ss => [...ss, { op: e.target.value }]); }} aria-label="Add a step">
          <option value="">+ Add a step…</option>{Object.entries(STEP_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs" style={{color:'var(--text)'}}><input type="checkbox" checked={!!config.merge} onChange={e => set(c => ({ ...c, merge: e.target.checked }))}/> Merge all files first</label>
      </div>
      <div className="flex gap-2"><input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="Name this workflow to reuse it"/><button onClick={save} disabled={!name.trim()} className="px-4 rounded-xl text-xs font-semibold text-white disabled:opacity-50" style={{background:'#2563EB'}}>Save</button></div>
    </div>
  );
}

/* ══════════════ Compare ══════════════ */
function diffWords(a, b) {
  const A = a.split(/\s+/).filter(Boolean).slice(0, 4000), B = b.split(/\s+/).filter(Boolean).slice(0, 4000);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, w) => { const last = out[out.length - 1]; if (last && last.t === t) last.w.push(w); else out.push({ t, w: [w] }); };
  while (i < n && j < m) { if (A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', A[i++]); else push('+', B[j++]); }
  while (i < n) push('-', A[i++]); while (j < m) push('+', B[j++]);
  return out;
}

async function visualDiff(fa, fb, p) {
  const render = async f => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readFileAsArrayBuffer(f)) }).promise;
    if (p > pdf.numPages) return null;
    const pg = await pdf.getPage(p); const vp = pg.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise; return c;
  };
  const [ca, cb] = await Promise.all([render(fa), render(fb)]);
  const base = cb || ca; if (!base) return null;
  const w = base.width, h = base.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const o = out.getContext('2d'); o.drawImage(base, 0, 0); o.fillStyle = 'rgba(255,255,255,0.6)'; o.fillRect(0, 0, w, h);
  const da = ca ? ca.getContext('2d').getImageData(0, 0, w, h).data : null, db = cb ? cb.getContext('2d').getImageData(0, 0, w, h).data : null;
  const img = o.getImageData(0, 0, w, h); let changed = 0;
  for (let k = 0; k < w * h * 4; k += 4) {
    const va = da ? da[k] + da[k + 1] + da[k + 2] : 765, vb = db ? db[k] + db[k + 1] + db[k + 2] : 765;
    if (Math.abs(va - vb) > 60) { changed++; const added = vb < va; img.data[k] = added ? 22 : 239; img.data[k + 1] = added ? 163 : 68; img.data[k + 2] = added ? 74 : 68; img.data[k + 3] = 255; }
  }
  o.putImageData(img, 0, 0);
  return { url: out.toDataURL('image/png'), changed: changed / (w * h) };
}

function CompareWorkspace({ files, onQuota, onError }) {
  const [state, setState] = useState('working');
  const [pages, setPages] = useState([]);
  const [view, setView] = useState('text');
  const [visual, setVisual] = useState({});
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await onQuota();
        const [a, b] = await Promise.all(files.slice(0, 2).map(f => LCP.extractText(f)));
        const n = Math.max(a.pages.length, b.pages.length);
        const res = [];
        for (let p = 0; p < n; p++) { const d = diffWords(a.pages[p] || '', b.pages[p] || ''); res.push({ page: p + 1, diff: d, changes: d.filter(x => x.t !== '=').reduce((s, x) => s + x.w.length, 0) }); }
        if (live) { setPages(res); setState('done'); }
      } catch (e) { if (live) { setState('done'); onError(e); } }
    })();
    return () => { live = false; };
  }, [files]);
  useEffect(() => {
    if (view !== 'visual' || !pages.length) return;
    let live = true;
    (async () => { for (const p of pages) { if (!live) return; const r = await visualDiff(files[0], files[1], p.page).catch(() => null); if (live) setVisual(v => ({ ...v, [p.page]: r })); } })();
    return () => { live = false; };
  }, [view, pages]);
  if (state === 'working') return <div className="card p-10 text-center"><div className="w-8 h-8 mx-auto border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"/><p style={{color:'var(--text)'}}>Comparing on your device…</p></div>;
  const total = pages.reduce((s, p) => s + p.changes, 0);
  return (
    <div className="space-y-4 anim-up">
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{color:'var(--text)'}}><strong>{total ? `${total} word${total === 1 ? '' : 's'} changed` : 'No text differences'}</strong> across {pages.filter(p => p.changes).length} of {pages.length} pages. <span className="text-red-400 line-through">Removed</span> · <span className="text-emerald-400">Added</span></p>
        <div className="flex gap-1 p-1 rounded-xl" style={{background:'var(--bg-input)'}}>
          {[['text','Text changes'],['visual','Visual changes']].map(([k,l]) => <button key={k} onClick={() => setView(k)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{background:view===k?'#2563EB':'transparent',color:view===k?'#fff':'var(--muted)'}}>{l}</button>)}
        </div>
      </div>
      {pages.map(p => (view === 'text' ? p.changes > 0 : true) && (
        <div key={p.page} className="card p-4">
          <p className="text-xs font-semibold mb-2" style={{color:'var(--muted)'}}>Page {p.page}{view === 'text' ? ` · ${p.changes} change${p.changes === 1 ? '' : 's'}` : visual[p.page] ? ` · ${(visual[p.page].changed * 100).toFixed(1)}% of the page differs` : ''}</p>
          {view === 'text'
            ? <p className="text-sm leading-relaxed" style={{color:'var(--text)'}}>{p.diff.map((s, i) => s.t === '=' ? (s.w.length > 24 ? <span key={i} style={{color:'var(--muted)'}}> {s.w.slice(0, 8).join(' ')} … {s.w.slice(-8).join(' ')} </span> : <span key={i}> {s.w.join(' ')} </span>)
                : <span key={i} className={s.t === '-' ? 'line-through' : ''} style={{background: s.t === '-' ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)', color: s.t === '-' ? '#F87171' : '#34D399', borderRadius: 3, padding: '0 2px'}}>{s.w.join(' ')}</span>)}</p>
            : visual[p.page] ? <img src={visual[p.page].url} alt={`Differences on page ${p.page}`} className="max-w-full mx-auto rounded shadow"/> : <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>}
        </div>
      ))}
    </div>
  );
}

/* ══════════════ Cloud import (Google Drive / Dropbox) ══════════════
   Files come straight from the cloud provider into the browser; they never
   pass through our server. Buttons appear only when the keys are configured. */
let cloudConfig = null;
const getCloudConfig = () => cloudConfig || (cloudConfig = fetch('/api/config').then(r => r.json()).catch(() => ({})));

async function pickFromDropbox(accept, multi) {
  const cfg = await getCloudConfig();
  if (!window.Dropbox) {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://www.dropbox.com/static/api/2/dropins.js'; s.id = 'dropboxjs'; s.dataset.appKey = cfg.dropboxAppKey; s.onload = res; s.onerror = () => rej(new Error('Could not reach Dropbox.')); document.head.appendChild(s); });
  }
  const exts = accept === 'image/*' ? ['images'] : accept.split(',').map(s => s.trim());
  const picked = await new Promise(res => Dropbox.choose({ linkType: 'direct', multiselect: !!multi, extensions: exts, success: res, cancel: () => res([]) }));
  return Promise.all(picked.map(async p => new File([await (await fetch(p.link)).blob()], p.name)));
}

async function pickFromDrive(accept, multi) {
  const cfg = await getCloudConfig();
  await LCP.loadScript('https://apis.google.com/js/api.js');
  await new Promise(res => gapi.load('picker', res));
  const token = await new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({ client_id: cfg.googleClientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: r => r.error ? rej(new Error(r.error)) : res(r.access_token) });
    client.requestAccessToken();
  });
  const mimes = accept === 'image/*' ? 'image/png,image/jpeg,image/webp,image/gif' : accept.split(',').map(e => ({ '.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc':'application/msword', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls':'application/vnd.ms-excel', '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt':'application/vnd.ms-powerpoint', '.html':'text/html' })[e.trim()]).filter(Boolean).join(',');
  const docs = await new Promise(res => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(mimes);
    const b = new google.picker.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(cfg.googlePickerApiKey)
      .setCallback(d => { if (d.action === google.picker.Action.PICKED) res(d.docs); if (d.action === google.picker.Action.CANCEL) res([]); });
    if (multi) b.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    b.build().setVisible(true);
  });
  return Promise.all(docs.map(async d => {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${d.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Could not download ${d.name} from Google Drive.`);
    return new File([await r.blob()], d.name, { type: d.mimeType });
  }));
}

function CloudImport({ tool, onFiles }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { getCloudConfig().then(setCfg); }, []);
  if (!cfg || (!cfg.dropboxAppKey && !cfg.googlePickerApiKey)) return null;
  const go = pick => async e => {
    e.stopPropagation(); setErr('');
    try { const fs = await pick(tool.accept, tool.multi || tool.batch); if (fs.length) onFiles(fs); } catch (x) { setErr(x.message || 'Import failed.'); }
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
      <span className="text-xs" style={{color:'var(--muted)'}}>or import from</span>
      {cfg.googlePickerApiKey && cfg.googleClientId && <button onClick={go(pickFromDrive)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>Google Drive</button>}
      {cfg.dropboxAppKey && <button onClick={go(pickFromDropbox)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>Dropbox</button>}
      {err && <span className="text-xs text-red-400 w-full text-center">{err}</span>}
    </div>
  );
}
