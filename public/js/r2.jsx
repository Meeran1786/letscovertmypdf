/* Release 2 UI: privacy badges, the trust page, Sign anywhere and the
   on-device AI workspace. Loaded as text/babel before the main app script,
   so it shares its globals (React hooks, Ic, useAuth, TOOLS, PreviewModal…),
   which are only touched at render time. */

/* ══════════════════════════════════════
   PRIVACY BADGE
══════════════════════════════════════ */
function PrivacyBadge({ tool, compact }) {
  const local = tool.engine === 'client';
  const style = local
    ? { background:'rgba(16,185,129,0.1)', color:'#34D399', border:'1px solid rgba(16,185,129,0.3)' }
    : { background:'rgba(245,158,11,0.1)', color:'#FBBF24', border:'1px solid rgba(245,158,11,0.3)' };
  const text = local
    ? (compact ? 'On your device' : 'Processed on your device. Your file is never uploaded.')
    : (compact ? 'Secure server' : 'Converted on our server over HTTPS, then deleted within 60 seconds.');
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${compact?'text-[10px] px-2 py-0.5':'text-xs px-3 py-1.5'}`} style={style}
      title={local ? 'This tool runs entirely in your browser.' : 'Office formats need a server converter. Files are deleted right after.'}>
      <Ic n={local ? 'lock' : 'protect'} sz={compact ? 10 : 13}/>{text}
    </span>
  );
}

/* ══════════════════════════════════════
   SIGN: signature sources + drag-to-place
══════════════════════════════════════ */
const SIG_KEY = 'lcpdf-signature';
const loadSavedSig = () => { try { return localStorage.getItem(SIG_KEY); } catch { return null; } };

function TypedSignature({ onSign }) {
  const [name, setName] = useState('');
  const [font, setFont] = useState('Dancing Script');
  useEffect(() => {
    let live = true;
    if (!name.trim()) { onSign(null); return; }
    (async () => {
      try { await document.fonts.load(`64px "${font}"`); } catch {}
      if (!live) return;
      const c = document.createElement('canvas'); const ctx = c.getContext('2d');
      ctx.font = `64px "${font}"`; const w = Math.ceil(ctx.measureText(name).width) + 40;
      c.width = Math.max(120, w); c.height = 110;
      ctx.font = `64px "${font}"`; ctx.fillStyle = '#0F172A'; ctx.textBaseline = 'middle'; ctx.fillText(name, 20, 58);
      onSign(c.toDataURL('image/png'));
    })();
    return () => { live = false; };
  }, [name, font]);
  return (
    <div className="space-y-2">
      <input className="inp" placeholder="Type your full name" value={name} onChange={e=>setName(e.target.value)} aria-label="Your name"/>
      <div className="grid grid-cols-3 gap-2">
        {['Dancing Script','Great Vibes','Caveat'].map(f=>(
          <button key={f} onClick={()=>setFont(f)} className="py-2 rounded-xl text-lg truncate px-2"
            style={{fontFamily:`"${f}", cursive`, background:font===f?'#DBEAFE':'#fff', color:'#0F172A', border:`2px solid ${font===f?'#2563EB':'transparent'}`}} aria-pressed={font===f}>
            {name || 'Signature'}
          </button>
        ))}
      </div>
    </div>
  );
}

function UploadSignature({ onSign }) {
  const [err, setErr] = useState('');
  const pick = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    setErr('');
    try {
      const bmp = await createImageBitmap(f);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      // Turn a white background transparent so a photo of a signature sits cleanly on the page.
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i]+d.data[i+1]+d.data[i+2])/3; if (l > 200) d.data[i+3] = 0; }
      ctx.putImageData(d, 0, 0);
      onSign(c.toDataURL('image/png'));
    } catch { setErr('Could not read that image. Try a PNG or JPG.'); }
  };
  return (
    <label className="block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer drop-zone" style={{borderColor:'var(--border-s)'}}>
      <input type="file" accept="image/*" className="hidden" onChange={pick}/>
      <Ic n="upload" sz={20} cls="mx-auto mb-2 text-blue-400"/>
      <p className="text-sm" style={{color:'var(--text)'}}>Upload a photo or scan of your signature</p>
      <p className="text-xs" style={{color:'var(--muted)'}}>White backgrounds are removed automatically</p>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
    </label>
  );
}

/** Lets the user pick a page and drag/resize their signature on it. The
 *  placement is stored as fractions of the page so it is resolution-free. */
function SignPlacer({ file, sig, place, setPlace }) {
  const [thumb, setThumb] = useState(null);
  const [numPages, setNumPages] = useState(1);
  const box = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    let live = true;
    readFileAsArrayBuffer(file).then(b => renderPdfPage(new Uint8Array(b), place.page + 1, 1.2)).then(({ dataUrl, numPages }) => {
      if (!live) return; setThumb(dataUrl); setNumPages(numPages);
    }).catch(() => {});
    return () => { live = false; };
  }, [file, place.page]);

  const onDown = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = box.current.getBoundingClientRect();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...place }, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / d.w, dy = (e.clientY - d.sy) / d.h;
    if (d.mode === 'move') setPlace(p => ({ ...p, x: Math.min(1 - p.w, Math.max(0, d.start.x + dx)), y: Math.min(0.98, Math.max(0, d.start.y + dy)) }));
    else setPlace(p => ({ ...p, w: Math.min(1 - p.x, Math.max(0.06, d.start.w + dx)) }));
  };
  const onUp = () => { drag.current = null; };
  const nudge = (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const k = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[e.key];
    if (!k) return; e.preventDefault();
    setPlace(p => ({ ...p, x: Math.min(1 - p.w, Math.max(0, p.x + k[0])), y: Math.min(0.98, Math.max(0, p.y + k[1])) }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button disabled={place.page<=0} onClick={()=>setPlace(p=>({...p,page:p.page-1}))} className="p-1.5 rounded-lg disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Previous page"><Ic n="left" sz={15}/></button>
          <span className="text-xs" style={{color:'var(--muted)'}}>Page {place.page+1} of {numPages}</span>
          <button disabled={place.page>=numPages-1} onClick={()=>setPlace(p=>({...p,page:p.page+1}))} className="p-1.5 rounded-lg disabled:opacity-30" style={{color:'var(--muted)'}} aria-label="Next page"><Ic n="right" sz={15}/></button>
        </div>
        <p className="text-xs" style={{color:'var(--muted)'}}>Drag to move · corner to resize · arrow keys to nudge</p>
      </div>
      <div className="flex justify-center rounded-xl p-3" style={{background:'rgba(0,0,0,0.2)'}}>
        <div ref={box} className="relative select-none touch-none" style={{maxWidth:'100%'}} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {thumb ? <img src={thumb} alt={`Page ${place.page+1}`} className="block max-w-full shadow-xl" style={{maxHeight:'60vh'}} draggable={false}/> : <div className="w-64 h-80 flex items-center justify-center"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>}
          {thumb && sig && (
            <div role="button" tabIndex={0} aria-label="Signature position" onKeyDown={nudge} onPointerDown={onDown('move')}
              className="absolute cursor-move" style={{left:`${place.x*100}%`, top:`${place.y*100}%`, width:`${place.w*100}%`, outline:'2px dashed #2563EB', background:'rgba(37,99,235,0.06)'}}>
              <img src={sig} alt="Your signature" className="block w-full pointer-events-none" draggable={false}/>
              {place.date && <p className="pointer-events-none text-[10px]" style={{color:'#0F172A'}}>{new Date().toLocaleDateString()}</p>}
              <span onPointerDown={onDown('resize')} className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full cursor-nwse-resize" style={{background:'#2563EB',border:'2px solid #fff'}} aria-hidden="true"/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignStudio({ file, config, set }) {
  const saved = loadSavedSig();
  const [tab, setTab] = useState(saved ? 'saved' : 'draw');
  const place = config.place || { page: 0, x: 0.58, y: 0.8, w: 0.3, date: false, all: false };
  const setPlace = (fn) => set(c => ({ ...c, place: typeof fn === 'function' ? fn(c.place || place) : fn }));
  const setSig = (d) => set(c => ({ ...c, sigData: d }));
  useEffect(() => { if (tab === 'saved' && saved) setSig(saved); }, [tab]);
  useEffect(() => { if (!config.place) setPlace(place); }, []);
  useEffect(() => {
    // The placer needs the page count to start on the last page, where most signatures go.
    readFileAsArrayBuffer(file).then(b => pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise).then(pdf => {
      if (!config.place) setPlace(p => ({ ...p, page: pdf.numPages - 1 }));
    }).catch(() => {});
  }, [file]);

  const tabs = [...(saved ? [['saved','Saved']] : []), ['draw','Draw'], ['type','Type'], ['upload','Upload']];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{background:'var(--bg-input)'}} role="tablist">
        {tabs.map(([k,l]) => (
          <button key={k} role="tab" aria-selected={tab===k} onClick={()=>{ setTab(k); if (k!=='saved') setSig(null); }}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold" style={{background:tab===k?'#2563EB':'transparent', color:tab===k?'#fff':'var(--muted)'}}>{l}</button>
        ))}
      </div>
      {tab==='saved' && saved && (
        <div className="flex items-center gap-3">
          <img src={saved} alt="Saved signature" className="h-14 rounded-lg p-1" style={{background:'#fff'}}/>
          <button onClick={()=>{ try{localStorage.removeItem(SIG_KEY);}catch{} setTab('draw'); setSig(null); }} className="text-xs text-red-400 hover:text-red-300">Forget saved signature</button>
        </div>
      )}
      {tab==='draw' && <SignaturePad onSign={setSig}/>}
      {tab==='type' && <TypedSignature onSign={setSig}/>}
      {tab==='upload' && <UploadSignature onSign={setSig}/>}

      {config.sigData && <SignPlacer file={file} sig={config.sigData} place={place} setPlace={setPlace}/>}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs" style={{color:'var(--text)'}}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!place.date} onChange={e=>setPlace(p=>({...p,date:e.target.checked}))}/> Add today's date</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!place.all} onChange={e=>setPlace(p=>({...p,all:e.target.checked}))}/> Same spot on every page</label>
        {tab!=='saved' && <label className="flex items-center gap-2"><input type="checkbox" checked={!!config.remember} onChange={e=>set(c=>({...c,remember:e.target.checked}))}/> Remember my signature on this device</label>}
      </div>
    </div>
  );
}

async function processSignPlaced(file, sigData, place) {
  if (!sigData) throw new Error('Add your signature first.');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const d = await PDFDocument.load(await readFileAsArrayBuffer(file));
  const img = await d.embedPng(Uint8Array.from(atob(sigData.split(',')[1]), c => c.charCodeAt(0)));
  const font = place.date ? await d.embedFont(StandardFonts.Helvetica) : null;
  const pages = d.getPages();
  const targets = place.all ? pages : [pages[Math.min(Math.max(0, place.page), pages.length - 1)]];
  for (const pg of targets) {
    const { x: bx, y: by, width, height } = pg.getCropBox();
    const w = place.w * width, h = w * img.height / img.width;
    const x = bx + place.x * width, y = by + height - place.y * height - h;
    pg.drawImage(img, { x, y, width: w, height: h });
    if (font) pg.drawText(new Date().toLocaleDateString(), { x, y: y - 11, size: 9, font, color: rgb(0.06, 0.09, 0.16) });
  }
  return d.save();
}

/* ══════════════════════════════════════
   AI WORKSPACE: Chat with PDF + Summarize
══════════════════════════════════════ */
function CitedText({ text, onPage }) {
  const parts = String(text || '').split(/(\[p\.?\s*\d+\])/gi);
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{color:'var(--text)'}}>
      {parts.map((p, i) => {
        const m = /^\[p\.?\s*(\d+)\]$/i.exec(p);
        if (!m) return <span key={i}>{p.replace(/\*\*/g,'')}</span>;
        const n = parseInt(m[1], 10);
        return <button key={i} onClick={() => onPage(n)} className="inline-flex items-center mx-0.5 px-1.5 rounded text-[11px] font-semibold align-baseline hover:bg-blue-600 hover:text-white transition-colors"
          style={{background:'rgba(37,99,235,0.15)', color:'#60A5FA'}} title={`Open page ${n}`}>p.{n}</button>;
      })}
    </div>
  );
}

function AiModeSwitch({ mode, setMode, support, cached, loading, progress, progressText, onLoad }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[['quick','Instant','Pulls the exact sentences from your document. Works on any device, offline.'],
          ['smart','Smart AI','Writes answers with an AI model that runs on this device. One-time ~1 GB download.']].map(([k,l,d]) => {
          const disabled = k === 'smart' && support && !support.ok;
          const on = mode === k;
          return (
            <button key={k} disabled={disabled} onClick={() => { setMode(k); if (k === 'smart') onLoad(); }}
              className="p-3 rounded-xl text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{background:on?'rgba(37,99,235,0.15)':'var(--bg-input)', border:`1px solid ${on?'#2563EB':'var(--border-s)'}`}}>
              <p className="text-sm font-semibold flex items-center gap-1.5" style={{color:'var(--text)'}}>{k==='smart' && <Ic n="sparkle" sz={13} cls="text-blue-400"/>}{l}{k==='smart' && cached && <span className="text-[10px] text-emerald-400 font-medium">ready</span>}</p>
              <p className="text-xs" style={{color:'var(--muted)'}}>{disabled ? support.reason : d}</p>
            </button>
          );
        })}
      </div>
      {loading && (
        <div>
          <div className="w-full rounded-full h-1.5 overflow-hidden" style={{background:'var(--bg-input)'}}>
            <div className="progress-bar h-full rounded-full transition-all" style={{width:`${Math.round(progress*100)}%`}}/>
          </div>
          <p className="text-[11px] mt-1 truncate" style={{color:'var(--muted)'}}>{progressText || 'Preparing the on-device model…'} The model is saved in your browser, so this only happens once.</p>
        </div>
      )}
    </div>
  );
}

function AiWorkspace({ tool, file, onQuota, onError }) {
  const [phase, setPhase] = useState('reading');   // reading | scan | ready
  const [status, setStatus] = useState('Reading your document…');
  const [pct, setPct] = useState(0);
  const [pages, setPages] = useState([]);
  const [docBytes, setDocBytes] = useState(null);
  const index = useMemo(() => pages.length ? LCP.buildIndex(pages) : null, [pages]);
  const [mode, setMode] = useState('quick');
  const [support, setSupport] = useState(null);
  const [cached, setCached] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [mp, setMp] = useState(0); const [mpText, setMpText] = useState('');
  const [previewPage, setPreviewPage] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await onQuota();
        const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
        if (!live) return; setDocBytes(bytes);
        const { pages } = await LCP.extractText(bytes, v => live && setPct(v));
        if (!live) return;
        const chars = pages.join('').replace(/\s/g, '').length;
        if (chars < 40 * Math.max(1, Math.min(pages.length, 3))) { setPages(pages); setPhase('scan'); return; }
        setPages(pages); setPhase('ready');
      } catch (e) { if (live) onError(e); }
    })();
    LCP.aiSupport().then(s => live && setSupport(s));
    LCP.modelCached().then(c => live && setCached(c));
    return () => { live = false; };
  }, [file]);

  const runOcr = async () => {
    setPhase('reading'); setPct(0); setStatus('Recognising text in your scan…');
    try {
      const r = await LCP.ocrPdf(docBytes, v => setPct(v), s => setStatus(s));
      setPages(r.texts); setDocBytes(r.bytes); setPhase('ready');
    } catch (e) { onError(e); }
  };

  const loadModel = async () => {
    if (modelReady || modelLoading) return;
    setModelLoading(true);
    try { await LCP.loadModel((p, t) => { setMp(p); setMpText(t); }); setModelReady(true); setCached(true); }
    catch (e) { setMode('quick'); onError(new Error(`The on-device AI could not start: ${e.message}`)); }
    setModelLoading(false);
  };

  const summarise = async () => {
    setBusy(true); setSummary({ text: '' });
    try {
      if (mode === 'smart') {
        await loadModel();
        const r = await LCP.aiSummary(pages, t => setSummary({ text: t }), s => setBusyText(s));
        setSummary(r);
      } else setSummary(LCP.quickSummary(pages, Math.min(10, 4 + Math.ceil(pages.length / 3))));
    } catch (e) { onError(e); setSummary(null); }
    setBusy(false); setBusyText('');
  };

  useEffect(() => { if (phase === 'ready' && tool.id === 'summarize' && !summary) summarise(); }, [phase]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs]);

  const ask = async (question) => {
    const text = (question ?? q).trim(); if (!text || busy) return;
    setQ(''); setBusy(true);
    const history = msgs.filter(m => m.text).map(m => ({ role: m.role, content: m.text }));
    setMsgs(m => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    const put = (t) => setMsgs(m => { const n = [...m]; n[n.length - 1] = { role: 'assistant', text: t }; return n; });
    try {
      if (mode === 'smart') { await loadModel(); const r = await LCP.aiAnswer(index, text, history, put); put(r.text); }
      else put(LCP.quickAnswer(index, text).text);
    } catch (e) { put(`Sorry, something went wrong: ${e.message}`); }
    setBusy(false);
  };

  // Shared summaries carry a small credit line back to the site.
  const forSharing = (t) => `${t.replace(/\[p\.?\s*(\d+)\]/gi, '(page $1)')}\n\nSummary made privately on-device with LetsConvertPDF: https://letsconvertpdf.com/summarize-pdf`;
  const copy = (t) => navigator.clipboard?.writeText(forSharing(t));
  const saveTxt = (t) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([forSharing(t)], { type: 'text/plain' }));
    a.download = `${file.name.replace(/\.pdf$/i, '')}_summary.txt`; a.click();
  };

  if (phase === 'reading') return (
    <div className="card p-10 text-center space-y-4 anim-fade">
      <div className="w-10 h-10 mx-auto border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
      <p className="font-semibold" style={{color:'var(--text)'}}>{status}</p>
      <div className="w-full rounded-full h-2 overflow-hidden" style={{background:'var(--bg-input)'}}><div className="progress-bar h-full rounded-full transition-all" style={{width:`${Math.round(pct*100)}%`}}/></div>
      <p className="text-xs" style={{color:'var(--muted)'}}>All of this happens on your device.</p>
    </div>
  );

  if (phase === 'scan') return (
    <div className="card p-6 space-y-4 anim-up text-center">
      <p className="font-semibold" style={{color:'var(--text)'}}>This looks like a scanned document</p>
      <p className="text-sm" style={{color:'var(--muted)'}}>There is no readable text yet. Run text recognition (OCR) on your device first; it takes a few seconds per page.</p>
      <button onClick={runOcr} className="px-6 py-2.5 rounded-xl font-bold text-sm text-white" style={{background:'#2563EB'}}>Recognise text and continue</button>
    </div>
  );

  const suggestions = ['What is this document about?', 'List the key dates and deadlines', 'Who are the people or organisations involved?', 'What are the amounts or prices mentioned?'];
  return (
    <div className="space-y-4 anim-up">
      <AiModeSwitch mode={mode} setMode={setMode} support={support} cached={cached} loading={modelLoading} progress={mp} progressText={mpText} onLoad={loadModel}/>

      {tool.id === 'summarize' && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm" style={{color:'var(--text)'}}>Summary of {file.name}</h3>
            <button onClick={summarise} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg text-blue-400 disabled:opacity-50" style={{border:'1px solid rgba(37,99,235,0.4)'}}>{busy ? 'Working…' : mode==='smart' ? 'Summarise with Smart AI' : 'Summarise again'}</button>
          </div>
          {busyText && <p className="text-xs" style={{color:'var(--muted)'}}>{busyText}</p>}
          {summary && summary.text ? <CitedText text={summary.text} onPage={setPreviewPage}/> : busy && <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>}
          {summary && summary.text && !busy && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => copy(summary.text)} className="text-xs px-3 py-1.5 rounded-lg" style={{background:'var(--bg-input)',color:'var(--text)',border:'1px solid var(--border-s)'}}>Copy</button>
              <button onClick={() => saveTxt(summary.text)} className="text-xs px-3 py-1.5 rounded-lg" style={{background:'var(--bg-input)',color:'var(--text)',border:'1px solid var(--border-s)'}}>Download .txt</button>
            </div>
          )}
          <p className="text-[11px]" style={{color:'var(--subtle)'}}>{mode==='smart' ? 'AI can make mistakes. Click a page number to check the source.' : 'Instant mode quotes the most important sentences directly from your document.'}</p>
        </div>
      )}

      {(tool.id === 'chat' || tool.id === 'summarize') && (
        <div className="card p-4 space-y-3">
          {tool.id === 'summarize' && <h3 className="font-semibold text-sm" style={{color:'var(--text)'}}>Ask a follow-up question</h3>}
          {msgs.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => <button key={s} onClick={() => ask(s)} className="text-xs px-3 py-1.5 rounded-full" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>{s}</button>)}
            </div>
          )}
          <div className="space-y-3 max-h-[50vh] overflow-y-auto" aria-live="polite">
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="ml-auto max-w-[85%] px-3 py-2 text-sm chat-bubble-in w-fit">{m.text}</div>
              : <div key={i} className="max-w-[95%] px-3 py-2 chat-bubble-out">{m.text ? <CitedText text={m.text} onPage={setPreviewPage}/> : <span className="text-xs" style={{color:'var(--muted)'}}>Thinking…</span>}</div>)}
            <div ref={endRef}/>
          </div>
          <form onSubmit={e => { e.preventDefault(); ask(); }} className="flex gap-2">
            <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask anything about this document…" aria-label="Your question"/>
            <button disabled={busy || !q.trim()} className="px-4 rounded-xl text-white disabled:opacity-50" style={{background:'#2563EB'}} aria-label="Ask"><Ic n="send" sz={16}/></button>
          </form>
          <p className="text-[11px]" style={{color:'var(--subtle)'}}>Your document and questions never leave this device.</p>
        </div>
      )}
      {previewPage && docBytes && <PreviewModal pdfBytes={docBytes} initialPage={previewPage} onClose={() => setPreviewPage(null)} downloadName={`${file.name} · page ${previewPage}`}/>}
    </div>
  );
}

/* ══════════════════════════════════════
   PRIVACY / TRUST PAGE
══════════════════════════════════════ */
function PrivacyPage({ onTool }) {
  const local = TOOLS.filter(t => t.engine === 'client');
  const server = TOOLS.filter(t => t.engine !== 'client');
  const Row = ({ t }) => (
    <button onClick={() => onTool(t)} className="flex items-center justify-between gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-blue-600/10 transition-colors">
      <span className="text-sm" style={{color:'var(--text)'}}>{t.label}</span><PrivacyBadge tool={t} compact/>
    </button>
  );
  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <div className="inline-flex mb-4"><PrivacyBadge tool={{engine:'client'}} /></div>
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-3" style={{color:'var(--text)'}}>Private by design</h1>
          <p className="text-lg" style={{color:'var(--muted)'}}>{local.length} of our {TOOLS.length} tools, including every AI feature, run entirely inside your browser. Your files never reach our servers, so there is nothing for us to store, leak or read.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {[['upload','You choose a file','It is read into your browser\'s memory, not uploaded.'],['sparkle','Your device does the work','PDF engines and the AI model run locally using WebAssembly and WebGPU.'],['download','You download the result','The file goes straight from memory to your Downloads folder.']].map(([i,t,d]) => (
            <div key={t} className="card p-5"><Ic n={i} sz={20} cls="text-blue-400 mb-3"/><p className="font-semibold text-sm mb-1" style={{color:'var(--text)'}}>{t}</p><p className="text-xs" style={{color:'var(--muted)'}}>{d}</p></div>
          ))}
        </div>
        <div className="card p-5 space-y-2">
          <h2 className="font-bold" style={{color:'var(--text)'}}>Check it yourself</h2>
          <p className="text-sm" style={{color:'var(--muted)'}}>Open your browser's developer tools, go to the Network tab, and use any green-badged tool. You will see no upload. Or install LetsConvertPDF as an app, switch on airplane mode, and the on-device tools keep working.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4"><h2 className="font-bold text-sm mb-2 px-3" style={{color:'var(--text)'}}>Runs on your device ({local.length})</h2>{local.map(t => <Row key={t.id} t={t}/>)}</div>
          <div className="card p-4 h-fit"><h2 className="font-bold text-sm mb-2 px-3" style={{color:'var(--text)'}}>Needs our server ({server.length})</h2>{server.map(t => <Row key={t.id} t={t}/>)}
            <p className="text-xs px-3 pt-3" style={{color:'var(--muted)'}}>Converting Word, Excel and PowerPoint files needs a full office suite, which can't run in a browser yet. These files travel over HTTPS, are converted in an isolated folder, and are deleted within 60 seconds. We never keep copies or look at their contents.</p></div>
        </div>
        <div className="card p-5 space-y-2">
          <h2 className="font-bold" style={{color:'var(--text)'}}>What we do store</h2>
          <ul className="text-sm list-disc pl-5 space-y-1" style={{color:'var(--muted)'}}>
            <li>If you create an account: your name, email and a hashed password.</li>
            <li>A daily count of how many times each tool was used, so free limits work. Counts are deleted after a day.</li>
            <li>Your saved signature and theme choice stay in your own browser's storage, never on our servers.</li>
          </ul>
          <p className="text-sm" style={{color:'var(--muted)'}}>The Smart AI model is downloaded once from Hugging Face's public model library and cached in your browser. Your document text is never sent anywhere.</p>
        </div>
      </div>
    </div>
  );
}
