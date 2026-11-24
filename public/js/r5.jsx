/* Audience pages, the trust centre and the "How it works" panel.
   Page text comes from /js/audiences.js (window.LCP_AUDIENCES, LCP_GROUPS,
   LCP_TRUST), which the server also uses to render the same pages for search. */

const AUDIENCES = window.LCP_AUDIENCES || [];
const AUDIENCE_GROUPS = window.LCP_GROUPS || [];
const TRUST = window.LCP_TRUST || null;
const openChat = () => window.dispatchEvent(new Event('lcp-open-chat'));
const toolBySlug = s => TOOLS.find(t => t.slug === s);
/** A same-site link that navigates inside the app. */
const AppLink = ({ href, onGo, className, style, children }) => (
  <a href={href} onClick={e => { e.preventDefault(); onGo(); }} className={className} style={style}>{children}</a>
);

/* ── How it works (every tool) ─────────────────────────────── */
let howtoCache = null;
const loadHowto = () => (howtoCache ||= fetch(`/howto.json?lang=${encodeURIComponent(LANG)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})));

function HowItWorks({ tool }) {
  const [data, setData] = useState(null);
  useEffect(() => { let on = true; loadHowto().then(d => on && setData(d)); return () => { on = false; }; }, []);
  const entry = data && data[tool.slug];
  if (!entry || !entry.steps || !entry.steps.filter(Boolean).length) return null;
  const local = tool.engine === 'client';
  const steps = [tr('how.signin', 'Sign in with Google. It takes one tap.'), ...entry.steps.filter(Boolean)];
  return (
    <section aria-labelledby="how-title" className="max-w-3xl mx-auto px-4 sm:px-6 pb-10">
      <h2 id="how-title" className="text-xl font-bold mb-4" style={{color:'var(--text)'}}>{tr('how.title', 'How it works')}</h2>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <li key={i} className="card p-4 flex gap-3 items-start">
            <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
            <span className="text-sm leading-relaxed" style={{color:'var(--muted)'}}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs mt-3 flex items-center gap-1.5" style={{color: local ? '#34D399' : '#FBBF24'}}>
        <Ic n={local ? 'lock' : 'protect'} sz={13}/>
        {local ? tr('badge.local', 'Processed on your device. Your file is never uploaded.') : tr('badge.server', 'Converted on our server over HTTPS, then deleted within 60 seconds.')}
      </p>
    </section>
  );
}

/* ── Home: who it is for ───────────────────────────────────── */
function AudienceSection({ onAudience }) {
  if (!AUDIENCES.length) return null;
  return (
    <section className="px-4 pb-24 max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2" style={{color:'var(--text)'}}>Built for the way you work</h2>
        <p className="text-sm" style={{color:'var(--muted)'}}>From a student's reading list to a bank's KYC files, your documents stay on your device.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        {AUDIENCE_GROUPS.map(g => (
          <div key={g.id} className="card p-6">
            <h3 className="font-semibold mb-1" style={{color:'var(--text)'}}>{g.label}</h3>
            <p className="text-sm mb-4" style={{color:'var(--muted)'}}>{g.blurb}</p>
            <div className="space-y-1">
              {AUDIENCES.filter(a => a.group === g.id).map(a => (
                <AppLink key={a.slug} href={`${LP}/${a.slug}`} onGo={() => onAudience(a)}
                  className="flex items-center gap-3 px-3 py-2 -mx-3 rounded-lg hover:bg-blue-600/10 transition-colors">
                  <Ic n={a.icon} sz={16} cls="text-blue-400 shrink-0"/>
                  <span className="text-sm font-medium flex-1" style={{color:'var(--text)'}}>{a.label}</span>
                  <Ic n="right" sz={13} cls="text-blue-400"/>
                </AppLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Home: trust strip ─────────────────────────────────────── */
function TrustSection({ onTrust }) {
  if (!TRUST) return null;
  return (
    <section className="px-4 pb-24 max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2" style={{color:'var(--text)'}}>Trust you can check</h2>
        <p className="text-sm" style={{color:'var(--muted)'}}>No borrowed badges. Here is what protects your files today. <AppLink href={`${LP}/trust`} onGo={onTrust} className="text-blue-400 hover:text-blue-300">See our trust page →</AppLink></p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TRUST.today.map(([icon, t, d]) => (
          <div key={t} className="card p-5">
            <Ic n={icon} sz={20} cls="text-emerald-400 mb-3"/>
            <p className="font-semibold text-sm mb-1" style={{color:'var(--text)'}}>{t}</p>
            <p className="text-xs leading-relaxed" style={{color:'var(--muted)'}}>{d}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-center mt-5" style={{color:'var(--subtle)'}}>SOC 2 Type II and ISO/IEC 27001 are on our roadmap. We are not certified yet and will only show those badges once an auditor certifies us.</p>
    </section>
  );
}

const StatusPill = ({ status }) => {
  const s = status === 'planned'
    ? { label: 'On roadmap', bg: 'rgba(148,163,184,0.12)', fg: '#94A3B8', bd: 'rgba(148,163,184,0.3)' }
    : { label: 'Aligned, not certified', bg: 'rgba(59,130,246,0.12)', fg: '#60A5FA', bd: 'rgba(59,130,246,0.3)' };
  return <span className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{background:s.bg,color:s.fg,border:`1px solid ${s.bd}`}}>{s.label}</span>;
};

const Faq = ({ items }) => items && items.length ? (
  <div className="card p-5 space-y-4">
    <h2 className="font-bold" style={{color:'var(--text)'}}>Questions</h2>
    {items.map(([q, a]) => <div key={q}><h3 className="font-semibold text-sm mb-1" style={{color:'var(--text)'}}>{q}</h3><p className="text-sm" style={{color:'var(--muted)'}}>{a}</p></div>)}
  </div>
) : null;

/* ── /trust ────────────────────────────────────────────────── */
function TrustPage({ onAudience, onPrivacy }) {
  if (!TRUST) return null;
  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-3" style={{color:'var(--text)'}}>{TRUST.h1}</h1>
          <p className="text-lg" style={{color:'var(--muted)'}}>{TRUST.intro}</p>
        </div>
        <div>
          <h2 className="font-bold text-lg mb-3" style={{color:'var(--text)'}}>What protects your files today</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {TRUST.today.map(([icon, t, d]) => (
              <div key={t} className="card p-5"><Ic n={icon} sz={20} cls="text-emerald-400 mb-3"/><p className="font-semibold text-sm mb-1" style={{color:'var(--text)'}}>{t}</p><p className="text-xs leading-relaxed" style={{color:'var(--muted)'}}>{d}</p></div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="font-bold mb-1" style={{color:'var(--text)'}}>Certifications and compliance</h2>
          <p className="text-sm mb-4" style={{color:'var(--muted)'}}>LetsConvertPDF does not hold any security certification today. This is where each one stands.</p>
          <div>
            {TRUST.roadmap.map(([n, st, d], i) => (
              <div key={n} style={i ? {borderTop:'1px solid var(--border)'} : undefined} className="py-3 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                <div className="sm:w-48 shrink-0 flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm" style={{color:'var(--text)'}}>{n}</span><StatusPill status={st}/></div>
                <p className="text-sm" style={{color:'var(--muted)'}}>{d}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5 space-y-2">
          <h2 className="font-bold" style={{color:'var(--text)'}}>Check it yourself</h2>
          <p className="text-sm" style={{color:'var(--muted)'}}>{TRUST.verify} <AppLink href={`${LP}/privacy`} onGo={onPrivacy} className="text-blue-400 hover:text-blue-300">See which tools run on your device →</AppLink></p>
        </div>
        <Faq items={TRUST.faq}/>
        <div className="card p-5 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <p className="text-sm" style={{color:'var(--muted)'}}>Security review or vendor questionnaire? Send it to us and we will answer it.</p>
          <button onClick={openChat} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shrink-0">Contact us</button>
        </div>
        <AudienceLinks onAudience={onAudience}/>
      </div>
    </div>
  );
}

function AudienceLinks({ onAudience, skip }) {
  return (
    <div>
      <h2 className="font-bold text-sm mb-2" style={{color:'var(--text)'}}>Who LetsConvertPDF is for</h2>
      <div className="flex flex-wrap gap-2">
        {AUDIENCES.filter(a => a.slug !== skip).map(a => (
          <AppLink key={a.slug} href={`${LP}/${a.slug}`} onGo={() => onAudience(a)} className="text-xs px-3 py-1.5 rounded-full hover:text-blue-300" style={{background:'var(--bg-card)',border:'1px solid var(--border-s)',color:'var(--muted)'}}>{a.label}</AppLink>
        ))}
      </div>
    </div>
  );
}

/* ── /pdf-tools-for-… ──────────────────────────────────────── */
function AudiencePage({ audience: a, onTool, onAudience, onTrust }) {
  const group = AUDIENCE_GROUPS.find(g => g.id === a.group);
  const business = a.group !== 'everyday' || a.slug === 'pdf-tools-for-small-business';
  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          {group && <p className="text-xs font-semibold uppercase tracking-wider mb-3 text-blue-400">{group.label}</p>}
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-3" style={{color:'var(--text)'}}>{a.h1}</h1>
          <p className="text-lg max-w-3xl mx-auto" style={{color:'var(--muted)'}}>{a.intro}</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {a.needs.map(([t, d]) => (
            <div key={t} className="card p-5"><p className="font-semibold text-sm mb-1" style={{color:'var(--text)'}}>{t}</p><p className="text-sm leading-relaxed" style={{color:'var(--muted)'}}>{d}</p></div>
          ))}
        </div>
        <div>
          <h2 className="font-bold text-lg mb-3" style={{color:'var(--text)'}}>Recommended tools</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {a.tools.map(toolBySlug).filter(Boolean).map(t => (
              <AppLink key={t.id} href={`${LP}/${t.slug}`} onGo={() => onTool(t)} className="card p-4 flex items-start gap-3 hover:border-blue-500 transition-colors">
                <Ic n={t.icon} sz={18} cls="text-blue-400 shrink-0 mt-0.5"/>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm" style={{color:'var(--text)'}}>{t.label}</span><PrivacyBadge tool={t} compact/></span>
                  <span className="block text-xs mt-1" style={{color:'var(--muted)'}}>{t.desc}</span>
                </span>
              </AppLink>
            ))}
          </div>
        </div>
        {a.flows && (
          <div className="card p-5">
            <h2 className="font-bold mb-2" style={{color:'var(--text)'}}>Ready-made workflows</h2>
            <ul className="text-sm list-disc pl-5 space-y-1" style={{color:'var(--muted)'}}>{a.flows.map(f => <li key={f}>{f}</li>)}</ul>
            {toolBySlug('pdf-workflows') && <button onClick={() => onTool(toolBySlug('pdf-workflows'))} className="mt-3 text-sm text-blue-400 hover:text-blue-300">Open PDF workflows →</button>}
          </div>
        )}
        <Faq items={a.faq}/>
        <div className="card p-5 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <p className="text-sm" style={{color:'var(--muted)'}}>
            {business ? 'Need seats for your team or firm? Ask us about a business licence.' : 'See exactly what protects your files.'}{' '}
            <AppLink href={`${LP}/trust`} onGo={onTrust} className="text-blue-400 hover:text-blue-300">Trust and security →</AppLink>
          </p>
          {business && <button onClick={openChat} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shrink-0">Ask about a licence</button>}
        </div>
        <AudienceLinks onAudience={onAudience} skip={a.slug}/>
      </div>
    </div>
  );
}

/* ── /pricing ─────────────────────────────────────────────── */
const PRICING = window.LCP_PRICING || null;

function PricingPage({ onTrust }) {
  const { user, token, openAuth, isAuthenticated } = useAuth();
  const [asking, setAsking] = useState(null); // 'pro' | 'business'
  const [form, setForm] = useState({ company: '', seats: '', phone: '', message: '' });
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!PRICING) return null;
  const current = user ? (user.plan || 'free') : null;
  const ask = plan => {
    setSent(''); setError('');
    if (!isAuthenticated) return openAuth('login', 'Sign in with Google first, so we know which account to upgrade.');
    setAsking(plan);
  };
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/api/upgrade-request', { method: 'POST', headers: authHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ plan: asking, ...form }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send your request.');
      setSent(asking); setAsking(null);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-5xl mx-auto space-y-10">
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-3" style={{color:'var(--text)'}}>{PRICING.h1}</h1>
          <p className="text-lg" style={{color:'var(--muted)'}}>{PRICING.intro}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PRICING.plans.map(p => {
            const mine = current === p.id;
            return (
              <div key={p.id} className="card p-6 flex flex-col" style={p.highlight ? {border:'2px solid #2563EB'} : undefined}>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold" style={{color:'var(--text)'}}>{p.name}</h2>
                  {p.highlight && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{background:'#2563EB'}}>Most popular</span>}
                  {mine && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{background:'rgba(16,185,129,0.15)',color:'var(--ok-text)'}}>Your plan</span>}
                </div>
                <p className="text-sm mb-4" style={{color:'var(--muted)'}}>{p.tagline}</p>
                <p className="text-3xl font-extrabold mb-5" style={{color:'var(--text)'}}>{p.price}</p>
                <ul className="space-y-2 mb-6 flex-1">
                  {p.features.map(f => <li key={f} className="text-sm flex gap-2" style={{color:'var(--text)'}}><span style={{color:'var(--ok-text)'}}>✓</span>{f}</li>)}
                </ul>
                {p.id === 'free'
                  ? (isAuthenticated
                      ? <a href={`${LP}/#tools`} className="text-center py-2.5 rounded-xl text-sm font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>{mine ? 'Use the tools' : 'Included'}</a>
                      : <button onClick={() => openAuth('login')} className="py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:'#2563EB'}}>Start free with Google</button>)
                  : mine
                    ? <p className="text-center text-sm py-2.5" style={{color:'var(--muted)'}}>You're on this plan{user?.planUntil ? ` until ${user.planUntil}` : ''}.</p>
                    : sent === p.id
                      ? <p className="text-center text-sm py-2.5" role="status" style={{color:'var(--ok-text)'}}>Thanks! We'll email {user?.email} soon.</p>
                      : <button onClick={() => ask(p.id)} className="py-2.5 rounded-xl text-sm font-semibold text-white" style={{background: p.highlight ? '#2563EB' : '#0F172A'}}>
                          {p.id === 'pro' ? 'Request Pro' : 'Talk to us'}
                        </button>}
              </div>
            );
          })}
        </div>

        {asking && (
          <form onSubmit={submit} className="card p-6 max-w-xl mx-auto space-y-3" aria-labelledby="ask-title">
            <h2 id="ask-title" className="font-bold text-lg" style={{color:'var(--text)'}}>{asking === 'pro' ? 'Request Pro' : 'Business plan'}</h2>
            <p className="text-sm" style={{color:'var(--muted)'}}>We'll reply to {user?.email} with a quote and an invoice, then switch the plan on for you.</p>
            <input className="inp" placeholder={asking === 'business' ? 'Company name' : 'Company (optional)'} value={form.company} onChange={set('company')} maxLength={120} required={asking === 'business'}/>
            {asking === 'business' && <input className="inp" type="number" min="1" placeholder="How many people?" value={form.seats} onChange={set('seats')}/>}
            <input className="inp" placeholder="Phone or WhatsApp (optional)" value={form.phone} onChange={set('phone')} maxLength={40}/>
            <textarea className="inp" rows={3} placeholder="Anything we should know? (optional)" value={form.message} onChange={set('message')} maxLength={1000}/>
            {error && <div className="text-sm rounded-xl p-3" role="alert" style={{background:'rgba(239,68,68,0.1)',color:'var(--err-text)'}}>{error}</div>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{background:'#2563EB'}}>{busy ? 'Sending…' : 'Send request'}</button>
              <button type="button" onClick={() => setAsking(null)} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{background:'var(--bg-input)',border:'1px solid var(--border-s)',color:'var(--text)'}}>Cancel</button>
            </div>
          </form>
        )}

        <div className="card p-5">
          <h2 className="font-bold mb-3" style={{color:'var(--text)'}}>What a use costs</h2>
          <div>
            {PRICING.costs.map(([n, c, d], i) => (
              <div key={n} style={i ? {borderTop:'1px solid var(--border)'} : undefined} className="py-3 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                <div className="sm:w-48 shrink-0"><span className="font-semibold text-sm" style={{color:'var(--text)'}}>{n}</span> <span className="text-sm" style={{color:'var(--accent-text)'}}>{c}</span></div>
                <p className="text-sm" style={{color:'var(--muted)'}}>{d}</p>
              </div>
            ))}
          </div>
        </div>
        <Faq items={PRICING.faq}/>
        <p className="text-center text-sm" style={{color:'var(--muted)'}}>
          Handling confidential files? <AppLink href={`${LP}/trust`} onGo={onTrust} className="text-blue-500 hover:text-blue-400">See how we protect them →</AppLink>
        </p>
      </div>
    </div>
  );
}
