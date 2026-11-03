/* LetsConvertPDF on-device engine (Release 2).
   Everything in this file runs in the visitor's browser. Files are read into
   memory, processed locally and handed back as a download; nothing here talks
   to our server except to fetch the static WASM/model files it needs.
   Exposes window.LCP for the React UI in index.html. */
(function () {
  'use strict';

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error(`Could not load ${src}. Check your connection and try again.`)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  const toBytes = async (input) => {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(await input.arrayBuffer());
  };

  /* ───────────── qpdf (WASM): AES-256 protect / unlock ─────────────
     qpdf.js is an Emscripten build that declares a global `Module` factory.
     We grab it once and remove the global so it can't clash with anything. */
  let qpdfFactory = null;
  async function getQpdf() {
    if (!qpdfFactory) {
      await loadScript('/vendor/qpdf/qpdf.js');
      qpdfFactory = window.Module;
      try { delete window.Module; } catch { window.Module = undefined; }
    }
    return qpdfFactory;
  }

  /** Runs one qpdf command on `input`. A fresh instance per call keeps the
   *  in-memory file system clean; the compiled WASM is cached by the browser. */
  async function runQpdf(args, input) {
    const factory = await getQpdf();
    const m = await factory({ noInitialRun: true, locateFile: (p) => `/vendor/qpdf/${p}`, print: () => {}, printErr: () => {} });
    m.FS.writeFile('/in.pdf', input);
    let code = 0;
    try { code = m.callMain(args); } catch (e) { code = typeof e?.status === 'number' ? e.status : 2; }
    let out = null;
    try { out = m.FS.readFile('/out.pdf'); } catch {}
    return { code, out };
  }

  async function protectPdf(file, password) {
    if (!password || password.length < 4) throw new Error('Choose a password of at least 4 characters.');
    const bytes = await toBytes(file);
    const r = await runQpdf(['--encrypt', password, password, '256', '--', '/in.pdf', '/out.pdf'], bytes);
    if (!r.out) throw new Error((await checkPassword(bytes)) !== 'ok' ? 'This PDF is already password-protected. Unlock it first.' : 'Could not encrypt this PDF. It may be damaged; try Repair PDF first.');
    return r.out;
  }

  /** Asks PDF.js whether `password` opens the file, so we can tell the user
   *  exactly what went wrong: 'ok' | 'need' | 'wrong' | 'damaged'. */
  async function checkPassword(bytes, password) {
    try { const d = await pdfjsLib.getDocument({ data: bytes.slice(), password: password || undefined }).promise; d.destroy(); return 'ok'; }
    catch (e) { return e?.name === 'PasswordException' ? (e.code === 2 ? 'wrong' : 'need') : 'damaged'; }
  }

  async function unlockPdf(file, password) {
    const bytes = await toBytes(file);
    const r = await runQpdf([`--password=${password || ''}`, '--decrypt', '/in.pdf', '/out.pdf'], bytes);
    if (!r.out) {
      const why = await checkPassword(bytes, password);
      if (why === 'wrong') throw new Error('That password is incorrect. Enter the password used to open this PDF.');
      if (why === 'need') throw new Error('This PDF needs its open password. Enter it above and try again.');
      throw new Error('Could not unlock this PDF. It may be damaged; try Repair PDF first.');
    }
    return r.out;
  }

  /* ───────────── Repair ─────────────
     1. pdf-lib re-parses every object without trusting the xref table.
     2. If the end of the file is gone, cut it after the last complete object,
        rebuild a trailer from the Catalog object and retry.
     3. Last resort: let PDF.js (very forgiving) render each page and rebuild
        the file from those images; text is no longer selectable then. */
  async function repairPdf(file, onProgress) {
    const bytes = await toBytes(file);
    const { PDFDocument } = PDFLib;
    const tryPdfLib = async (b) => {
      const d = await PDFDocument.load(b, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
      if (!d.getPageCount()) throw new Error('no pages');
      return d.save({ useObjectStreams: false });
    };
    try { return { bytes: await tryPdfLib(bytes), method: 'structure' }; } catch {}
    try {
      const text = new TextDecoder('latin1').decode(bytes);
      const m = /(\d+)\s+(\d+)\s+obj\s*<<(?:(?!endobj)[\s\S]){0,400}?\/Type\s*\/Catalog/.exec(text);
      const end = text.lastIndexOf('endobj');
      if (m && end > 0) {
        const body = bytes.subarray(0, end + 6);
        const tail = new TextEncoder().encode(`\ntrailer\n<< /Root ${m[1]} ${m[2]} R >>\nstartxref\n0\n%%EOF\n`);
        const patched = new Uint8Array(body.length + tail.length); patched.set(body); patched.set(tail, body.length);
        return { bytes: await tryPdfLib(patched), method: 'trailer' };
      }
    } catch {}
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), stopAtErrors: false }).promise;
    const out = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress && onProgress(i / pdf.numPages);
      try {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const jpg = await out.embedJpg(await canvasToBytes(c, 'image/jpeg', 0.9));
        out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
      } catch {}
    }
    if (!out.getPageCount()) throw new Error('This file is too badly damaged to recover.');
    return { bytes: await out.save(), method: 'rebuilt' };
  }

  /* ───────────── Compress ─────────────
     Re-encodes the images inside the PDF (the part that makes files big),
     downscaling anything larger than the chosen level allows. Fonts, text
     and vector graphics are untouched, so text stays sharp and searchable. */
  const LEVELS = {
    low:         { maxDim: 3000, quality: 0.85 },
    recommended: { maxDim: 2000, quality: 0.72 },
    extreme:     { maxDim: 1300, quality: 0.5 },
  };

  function canvasToBytes(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality }).then(b => b.arrayBuffer()).then(b => new Uint8Array(b));
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a))) : reject(new Error('encode failed')), type, quality));
  }
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  /** Undo PNG row predictors (DecodeParms /Predictor >= 10). */
  function unpredictPng(data, width, colors, bpc) {
    const bpp = Math.max(1, Math.ceil(colors * bpc / 8));
    const rowLen = Math.ceil(width * colors * bpc / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLen + 1)];
      const src = r * (rowLen + 1) + 1, dst = r * rowLen, prev = dst - rowLen;
      for (let i = 0; i < rowLen; i++) {
        const raw = data[src + i];
        const a = i >= bpp ? out[dst + i - bpp] : 0;
        const b = r > 0 ? out[prev + i] : 0;
        const c = r > 0 && i >= bpp ? out[prev + i - bpp] : 0;
        let v;
        switch (type) {
          case 1: v = raw + a; break;
          case 2: v = raw + b; break;
          case 3: v = raw + ((a + b) >> 1); break;
          case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = raw;
        }
        out[dst + i] = v & 0xff;
      }
    }
    return out;
  }

  async function compressPdf(file, level = 'recommended', onProgress) {
    const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict } = PDFLib;
    const original = await toBytes(file);
    const doc = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
    const ctx = doc.context;
    const { maxDim, quality } = LEVELS[level] || LEVELS.recommended;
    const name = (v) => (v instanceof PDFName ? v.asString() : null);
    const lookup = (v) => ctx.lookup(v);
    const num = (v) => { const x = lookup(v); return x instanceof PDFNumber ? x.asNumber() : null; };

    const images = ctx.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFRawStream && name(obj.dict.get(PDFName.of('Subtype'))) === '/Image');
    let done = 0, changed = 0;
    for (const [ref, obj] of images) {
      onProgress && onProgress(++done / Math.max(1, images.length));
      try {
        const d = obj.dict;
        if (d.get(PDFName.of('ImageMask')) || d.get(PDFName.of('Decode')) || d.get(PDFName.of('Mask'))) continue;
        let filter = lookup(d.get(PDFName.of('Filter')));
        if (filter instanceof PDFArray) { if (filter.size() !== 1) continue; filter = lookup(filter.get(0)); }
        const f = name(filter);
        const w = num(d.get(PDFName.of('Width'))), h = num(d.get(PDFName.of('Height')));
        const bpc = num(d.get(PDFName.of('BitsPerComponent'))) || 8;
        if (!w || !h || w * h < 200 * 200) continue;            // icons/logos: not worth it
        let cs = lookup(d.get(PDFName.of('ColorSpace')));
        let comps = null;
        if (name(cs) === '/DeviceRGB') comps = 3;
        else if (name(cs) === '/DeviceGray') comps = 1;
        else if (cs instanceof PDFArray && name(lookup(cs.get(0))) === '/ICCBased') {
          const icc = lookup(cs.get(1)); const n = icc && icc.dict ? num(icc.dict.get(PDFName.of('N'))) : null;
          if (n === 1 || n === 3) comps = n;
        }
        if (!comps) continue;                                     // CMYK, Indexed, Lab…: leave as is

        let bitmapSource;
        if (f === '/DCTDecode') {
          bitmapSource = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        } else if (f === '/FlateDecode' && bpc === 8) {
          let data = await inflate(obj.contents);
          const parms = lookup(d.get(PDFName.of('DecodeParms')));
          const pred = parms instanceof PDFDict ? num(parms.get(PDFName.of('Predictor'))) : null;
          if (pred && pred >= 10) data = unpredictPng(data, w, comps, bpc);
          else if (pred && pred > 1) continue;                    // TIFF predictor: rare, skip
          if (data.length < w * h * comps) continue;
          const rgba = new Uint8ClampedArray(w * h * 4);
          for (let i = 0, j = 0; i < w * h; i++, j += comps) {
            rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[comps === 3 ? j + 1 : j]; rgba[i * 4 + 2] = data[comps === 3 ? j + 2 : j]; rgba[i * 4 + 3] = 255;
          }
          bitmapSource = new ImageData(rgba, w, h);
        } else continue;

        const scale = Math.min(1, maxDim / Math.max(w, h));
        const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
        const canvas = makeCanvas(nw, nh);
        const c2d = canvas.getContext('2d');
        c2d.fillStyle = '#fff'; c2d.fillRect(0, 0, nw, nh);
        if (bitmapSource instanceof ImageData) {
          const tmp = makeCanvas(w, h); tmp.getContext('2d').putImageData(bitmapSource, 0, 0);
          c2d.drawImage(tmp, 0, 0, nw, nh);
        } else {
          c2d.drawImage(bitmapSource, 0, 0, nw, nh);
          bitmapSource.close && bitmapSource.close();
        }
        const jpg = await canvasToBytes(canvas, 'image/jpeg', quality);
        if (jpg.length >= obj.contents.length * 0.9) continue;    // not meaningfully smaller

        const nd = d.clone(ctx);
        nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        nd.set(PDFName.of('Width'), PDFNumber.of(nw));
        nd.set(PDFName.of('Height'), PDFNumber.of(nh));
        nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        nd.delete(PDFName.of('DecodeParms'));
        nd.delete(PDFName.of('Length'));
        ctx.assign(ref, PDFRawStream.of(nd, jpg));
        changed++;
      } catch (e) { /* leave this image unchanged */ }
    }
    doc.setProducer('LetsConvertPDF');
    const out = await doc.save({ useObjectStreams: true });
    if (out.length >= original.length) return { bytes: original, changed: 0, kept: true };
    return { bytes: out, changed, kept: false };
  }

  /* ───────────── Text extraction (PDF.js) ───────────── */
  async function openPdf(file) {
    const bytes = await toBytes(file);
    return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }

  async function extractText(file, onProgress) {
    const pdf = await openPdf(file);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : ''); }
      pages.push(s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim());
      onProgress && onProgress(i / pdf.numPages);
    }
    return { pages, numPages: pdf.numPages };
  }

  /* ───────────── OCR (Tesseract.js, self-hosted) ─────────────
     Adds an invisible, selectable text layer over each page, keeping the
     original page exactly as it was. */
  let ocrWorker = null;
  async function getOcrWorker(onStatus) {
    if (ocrWorker) return ocrWorker;
    await loadScript('/vendor/tesseract/tesseract.min.js');
    onStatus && onStatus('Loading the text-recognition engine (one-time, ~6 MB)…');
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tessdata',
    });
    return ocrWorker;
  }

  async function ocrPdf(file, onProgress, onStatus) {
    const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setTextRenderingMode, TextRenderingMode, setCharacterSqueeze } = PDFLib;
    const bytes = await toBytes(file);
    const pdf = await openPdf(bytes);
    const out = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await out.embedFont(StandardFonts.Helvetica);
    const fontKey = out.getPages()[0].node.newFontDictionary('LcpOcr', font.ref);
    const worker = await getOcrWorker(onStatus);
    const pages = out.getPages();
    const texts = [];
    let words = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      onStatus && onStatus(`Reading page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 300 / 72 > 4 ? 4 : 300 / 72 });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const c2d = canvas.getContext('2d'); c2d.fillStyle = '#fff'; c2d.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: c2d, viewport: vp }).promise;
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      texts.push(data.text || '');
      const target = pages[i - 1];
      const fk = i === 1 ? fontKey : target.node.newFontDictionary('LcpOcr', font.ref);
      const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
      for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) for (const word of line.words || []) {
        const t = (word.text || '').replace(/[^\x20-\x7E -ÿ]/g, '');
        if (!t.trim() || word.confidence < 30) continue;
        const { x0, y0, x1, y1 } = word.bbox;
        const [px0, py0] = vp.convertToPdfPoint(x0, y1);
        const [px1, py1] = vp.convertToPdfPoint(x1, y0);
        const hgt = Math.abs(py1 - py0), wid = Math.abs(px1 - px0);
        if (hgt < 1 || wid < 1) continue;
        const size = hgt * 0.9;
        let natural; try { natural = font.widthOfTextAtSize(t, size); } catch { continue; }
        ops.push(setFontAndSize(fk, size), setCharacterSqueeze(Math.max(10, Math.min(500, (wid / natural) * 100))),
          setTextMatrix(1, 0, 0, 1, Math.min(px0, px1), Math.min(py0, py1)), showText(font.encodeText(t)));
        words++;
      }
      ops.push(endText(), popGraphicsState());
      target.pushOperators(...ops);
      onProgress && onProgress(i / pdf.numPages);
    }
    return { bytes: await out.save(), words, texts };
  }

  /* ───────────── Retrieval + extractive AI (works on every device) ───────────── */
  const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may me more most my no not of on or our she should so such than that the their them then there these they this those to too under up us was we were what when where which while who why will with would you your'.split(' '));
  // A light stemmer so "fee" matches "fees" and "pay" matches "paying".
  const stem = (w) => w.length > 4 ? w.replace(/(ations?|ing|ly|ed|es|e|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w;
  const tokenize = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);

  /** Short lines without end punctuation followed by a capitalised line are
   *  headings; keep them out of sentences so a summary doesn't read
   *  "Fees and Payment Northwind will pay…". */
  function splitSentences(text) {
    const lines = text.split(/\n+/);
    const kept = lines.filter((l, i) => {
      const t = l.trim();
      const heading = t && t.split(/\s+/).length <= 8 && !/[.!?:;,]$/.test(t) && /^[A-Z0-9]/.test((lines[i + 1] || '').trim());
      return !heading;
    });
    return kept.join(' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map(s => s.trim()).filter(s => s.length > 25 && s.length < 600);
  }

  /** Splits pages into ~700-character chunks that never cross a page, so every
   *  answer can say exactly which page it came from. */
  function buildIndex(pages) {
    const chunks = [];
    pages.forEach((text, p) => {
      const paras = text.split(/\n{2,}|\n(?=[A-Z•\-\d])/);
      let cur = '';
      const flush = () => { if (cur.trim().length > 30) chunks.push({ page: p + 1, text: cur.trim() }); cur = ''; };
      for (const para of paras) { if ((cur + ' ' + para).length > 700) flush(); cur += (cur ? '\n' : '') + para; }
      flush();
    });
    const df = new Map();
    const toks = chunks.map(c => { const t = tokenize(c.text); new Set(t).forEach(w => df.set(w, (df.get(w) || 0) + 1)); return t; });
    const avg = toks.reduce((a, t) => a + t.length, 0) / Math.max(1, toks.length);
    return { chunks, toks, df, avg, N: chunks.length };
  }

  function search(index, query, k = 4) {
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const k1 = 1.4, b = 0.75;
    return index.chunks.map((c, i) => {
      const t = index.toks[i]; const tf = new Map(); t.forEach(w => tf.set(w, (tf.get(w) || 0) + 1));
      let s = 0;
      for (const w of q) {
        const f = tf.get(w); if (!f) continue;
        const idf = Math.log(1 + (index.N - (index.df.get(w) || 0) + 0.5) / ((index.df.get(w) || 0) + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * t.length / (index.avg || 1)));
      }
      return { ...c, score: s };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Answers from the document itself: the best-matching sentences, each with
   *  its page number. No model needed, so it works offline on any device. */
  /* Questions that keyword search can't answer ("list the key dates") are
     answered by pattern: sentences that contain dates, amounts or names. */
  const MONTHS = 'jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?';
  const INTENTS = [
    { ask: /\b(dates?|deadlines?|when|due|timeline|schedule)\b/i,
      match: new RegExp(`\\b(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|(${MONTHS})\\.?\\s+\\d{1,2}|\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS})|(19|20)\\d{2}|\\d+\\s+(business\\s+)?(days?|weeks?|months?|years?)|deadline|due)\\b`, 'i') },
    { ask: /\b(amounts?|prices?|costs?|fees?|money|totals?|how much|paid|pay)\b/i,
      match: /([$€£₹¥]\s?\d|\d[\d,.]*\s?(usd|eur|gbp|pkr|inr|aed|sar|dollars?|euros?|pounds?|rupees?)\b|\b\d+(\.\d+)?\s?%|\bpercent\b)/i },
    { ask: /\b(who|people|persons?|parties|party|organi[sz]ations?|compan(y|ies)|names?)\b/i,
      match: /(\b(Ltd|Limited|Inc|LLC|LLP|GmbH|PLC|Corp|Corporation|Company|University|Bank)\b|\b(Mr|Mrs|Ms|Dr)\.?\s+[A-Z]|\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+)/ },
  ];

  function quickAnswer(index, question) {
    if (/\b(about|summar|overview|main points?|gist)\b/i.test(question)) {
      const pages = []; index.chunks.forEach(c => { pages[c.page - 1] = (pages[c.page - 1] || '') + '\n' + c.text; });
      return quickSummary(pages.map(p => p || ''), 4);
    }
    const intent = INTENTS.find(i => i.ask.test(question));
    if (intent) {
      const found = [];
      for (const c of index.chunks) for (const s of splitSentences(c.text)) if (intent.match.test(s) && !found.some(f => f.s === s)) found.push({ s, page: c.page });
      if (found.length) {
        const picks = found.slice(0, 6);
        return { text: picks.map(p => `• ${p.s} [p. ${p.page}]`).join('\n'), cites: [...new Set(picks.map(p => p.page))] };
      }
    }
    const hits = search(index, question, 4);
    if (!hits.length) return { text: "I couldn't find anything about that in this document. Try different words.", cites: [] };
    const q = [...new Set(tokenize(question))];
    const idf = (w) => Math.log(1 + index.N / (1 + (index.df.get(w) || 0)));
    const scored = [];
    for (const h of hits) {
      const sents = splitSentences(h.text);
      for (const s of (sents.length ? sents : [h.text])) {
        const t = new Set(tokenize(s));
        const score = q.reduce((a, w) => a + (t.has(w) ? idf(w) : 0), 0);
        if (score > 0) scored.push({ s, page: h.page, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]?.score || 0;
    const picks = scored.filter(x => x.score >= best * 0.6).slice(0, 3);
    return { text: picks.map(p => `${p.s} [p. ${p.page}]`).join('\n\n'), cites: [...new Set(picks.map(p => p.page))] };
  }

  /** Extractive summary: picks the sentences most central to the document,
   *  spread across its pages, and keeps them in reading order. */
  function quickSummary(pages, count = 7) {
    const sents = [];
    pages.forEach((t, p) => splitSentences(t).forEach(s => sents.push({ s, page: p + 1, t: tokenize(s) })));
    // Forms, invoices and slides are short lines, not sentences: use the lines.
    if (sents.length < 3) {
      sents.length = 0;
      pages.forEach((t, p) => t.split(/\n+/).map(l => l.trim()).filter(l => l.length > 3).forEach(s => sents.push({ s, page: p + 1, t: tokenize(s) })));
    }
    if (!sents.length) return { text: 'This document has no readable text. If it is a scan, run OCR PDF first.', cites: [] };
    const df = new Map(); sents.forEach(x => new Set(x.t).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const N = sents.length;
    const score = sents.map((x, i) => {
      if (!x.t.length) return 0;
      const sum = x.t.reduce((a, w) => a + Math.log(N / (df.get(w) || 1)) * Math.min(df.get(w) || 0, 8), 0);
      const pos = i < 5 ? 1.2 : 1;
      return (sum / Math.sqrt(x.t.length)) * pos;
    });
    const order = score.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const chosen = []; const perPage = new Map(); const maxPerPage = Math.max(2, Math.ceil(count / Math.max(1, pages.length)) + 1);
    for (const [, i] of order) {
      if (chosen.length >= count) break;
      const pg = sents[i].page;
      if ((perPage.get(pg) || 0) >= maxPerPage) continue;
      const tooSimilar = chosen.some(j => { const a = new Set(sents[j].t); const inter = sents[i].t.filter(w => a.has(w)).length; return inter / Math.max(1, Math.min(a.size, sents[i].t.length)) > 0.6; });
      if (tooSimilar) continue;
      chosen.push(i); perPage.set(pg, (perPage.get(pg) || 0) + 1);
    }
    chosen.sort((a, b) => a - b);
    return { text: chosen.map(i => `• ${sents[i].s} [p. ${sents[i].page}]`).join('\n'), cites: [...new Set(chosen.map(i => sents[i].page))] };
  }

  /* ───────────── On-device language model (WebLLM + WebGPU) ───────────── */
  const MODELS = {
    f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  };
  let engine = null, enginePromise = null;

  async function aiSupport() {
    if (!navigator.gpu) return { ok: false, reason: 'Your browser does not support WebGPU. Use a recent Chrome or Edge on a laptop or desktop.' };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { ok: false, reason: 'No compatible graphics adapter was found on this device.' };
      return { ok: true, f16: adapter.features.has('shader-f16') };
    } catch { return { ok: false, reason: 'WebGPU is turned off in this browser.' }; }
  }

  async function modelCached() {
    try {
      const webllm = await import('/vendor/web-llm/index.js');
      const sup = await aiSupport();
      return await webllm.hasModelInCache(sup.f16 ? MODELS.f16 : MODELS.f32);
    } catch { return false; }
  }

  async function loadModel(onProgress) {
    if (engine) return engine;
    if (!enginePromise) {
      enginePromise = (async () => {
        const sup = await aiSupport();
        if (!sup.ok) throw new Error(sup.reason);
        const webllm = await import('/vendor/web-llm/index.js');
        engine = await webllm.CreateMLCEngine(sup.f16 ? MODELS.f16 : MODELS.f32, {
          initProgressCallback: (r) => onProgress && onProgress(r.progress || 0, r.text || ''),
        });
        return engine;
      })().catch((e) => { enginePromise = null; throw e; });
    }
    return enginePromise;
  }

  const SYSTEM = 'You are a careful document assistant inside LetsConvertPDF. Use only the document excerpts you are given. After each fact, cite its page like [p. 3]. If the excerpts do not contain the answer, say so plainly. Be concise.';

  async function stream(messages, onToken, maxTokens = 512) {
    const eng = await loadModel();
    const chunks = await eng.chat.completions.create({ messages, stream: true, temperature: 0.2, max_tokens: maxTokens });
    let text = '';
    for await (const c of chunks) { const d = c.choices[0]?.delta?.content || ''; text += d; onToken && onToken(text); }
    return text;
  }

  const excerpt = (hits) => hits.map(h => `[p. ${h.page}]\n${h.text}`).join('\n\n---\n\n');

  async function aiAnswer(index, question, history, onToken) {
    const hits = search(index, question, 4);
    const ctx = hits.length ? excerpt(hits) : index.chunks.slice(0, 3).map(c => `[p. ${c.page}]\n${c.text}`).join('\n\n---\n\n');
    const msgs = [{ role: 'system', content: SYSTEM }, ...history.slice(-4),
      { role: 'user', content: `Document excerpts:\n\n${ctx}\n\nQuestion: ${question}` }];
    const text = await stream(msgs, onToken);
    return { text, cites: pagesIn(text) };
  }

  /** Map-reduce summary so long documents fit the small model's context. */
  async function aiSummary(pages, onToken, onStatus) {
    const sections = [];
    let cur = { from: 1, to: 1, text: '' };
    pages.forEach((t, i) => {
      if ((cur.text + t).length > 5000 && cur.text) { sections.push(cur); cur = { from: i + 1, to: i + 1, text: '' }; }
      cur.text += `\n[p. ${i + 1}]\n${t}`; cur.to = i + 1;
    });
    if (cur.text.trim()) sections.push(cur);
    const picked = sections.length > 8 ? Array.from({ length: 8 }, (_, k) => sections[Math.round(k * (sections.length - 1) / 7)]) : sections;
    if (picked.length === 1) {
      const text = await stream([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Summarise this document in 5–8 bullet points, then list any action items or deadlines.\n\n${picked[0].text.slice(0, 6000)}` }], onToken, 600);
      return { text, cites: pagesIn(text) };
    }
    const notes = [];
    for (let i = 0; i < picked.length; i++) {
      onStatus && onStatus(`Reading pages ${picked[i].from}–${picked[i].to}…`);
      notes.push(await stream([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Write 2–4 short bullet points with the key facts from these pages.\n\n${picked[i].text.slice(0, 6000)}` }], null, 220));
    }
    onStatus && onStatus('Writing the summary…');
    const text = await stream([{ role: 'system', content: SYSTEM }, { role: 'user', content: `These are notes from each part of one document, with page citations. Combine them into a summary of 5–8 bullet points followed by any action items or deadlines. Keep the page citations.\n\n${notes.join('\n\n')}` }], onToken, 700);
    return { text, cites: pagesIn(text) };
  }

  function pagesIn(text) {
    const s = new Set(); (text.match(/\[p\.?\s*(\d+)\]/gi) || []).forEach(m => s.add(parseInt(m.replace(/\D/g, ''), 10))); return [...s];
  }

  window.LCP = {
    loadScript, protectPdf, unlockPdf, repairPdf, compressPdf,
    extractText, ocrPdf, buildIndex, search, quickAnswer, quickSummary,
    aiSupport, modelCached, loadModel, aiAnswer, aiSummary, pagesIn,
    complete: stream,
  };
})();
