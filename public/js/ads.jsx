/* Banner carousel: image banners for our own products and sponsors, shown
   right under the menu.

   Banners are managed on /admin and served from /ads.json, already filtered
   to the ones that are active, in their date range and under their
   impression target, in position order. Each banner is one wide 4:1 picture
   (the whole picture is the ad, like a printed banner) with a click-through
   link. Older text-only slides still render, as a slim gradient strip.

   Private by design: pictures come from our own site (the CSP blocks others),
   nothing sets cookies or loads third-party scripts. To count impressions and
   clicks the browser sends only the banner id; no user, IP or cookie is kept.

   Loaded as text/babel after r4.jsx; the app renders <AdCarousel placement="home"/>. */

const ADS_DISMISS_KEY = 'lcpdf-ads-dismissed';
const adsSeen = new Set(); // one impression per banner per page load

function adBeacon(id, kind) {
  try {
    const url = `/api/ads/${encodeURIComponent(id)}/${kind}`;
    if (!(navigator.sendBeacon && navigator.sendBeacon(url))) fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
  } catch {}
}

function AdCarousel({ placement = 'home' }) {
  const { useState, useEffect, useRef, useCallback } = React;
  const [cfg, setCfg] = useState(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(`${ADS_DISMISS_KEY}-${placement}`) === '1'; } catch { return false; }
  });
  const reduceMotion = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (dismissed) return;
    let live = true;
    fetch('/ads.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!live || !j || j.enabled === false) return;
        const slides = (j.slides || []).filter(s => (s.placement || 'home') === placement || s.placement === 'all');
        setCfg({ interval: Math.max(3000, j.interval || 6000), slides });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [dismissed, placement]);

  const slides = cfg?.slides || [];
  const n = slides.length;
  const go = useCallback(d => setIdx(i => (i + d + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused || reduceMotion.current) return;
    const t = setInterval(() => go(1), cfg.interval);
    return () => clearInterval(t);
  }, [n, paused, go, cfg]);

  const s = n ? slides[Math.min(idx, n - 1)] : null;
  useEffect(() => {
    if (!s || adsSeen.has(s.id) || document.visibilityState === 'hidden') return;
    adsSeen.add(s.id); adBeacon(s.id, 'view');
  }, [s && s.id]);

  if (dismissed || !s) return null;
  const external = /^https?:\/\//i.test(s.href || '');
  const rel = ['sponsored', external && 'noopener noreferrer'].filter(Boolean).join(' ');
  const close = () => { try { sessionStorage.setItem(`${ADS_DISMISS_KEY}-${placement}`, '1'); } catch {} setDismissed(true); };
  const onKey = e => {
    if (n < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };
  // Arrows and close only appear on hover or keyboard focus, so they never cover the advertiser's own artwork.
  const btn = 'w-8 h-8 rounded-full flex items-center justify-center bg-black/45 hover:bg-black/65 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-white';
  const label = s.label || (s.advertiser ? 'Sponsored' : 'Ad');

  const inner = s.image
    ? <img src={s.image} alt={s.title} className="block w-full h-full object-cover" loading="eager" decoding="async"/>
    : (
      <div className="w-full h-full flex items-center gap-4 px-6 sm:px-14 text-white" style={{ background: s.bg || 'linear-gradient(90deg,#1D4ED8,#6D28D9)' }}>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base sm:text-xl leading-snug truncate">{s.title}</p>
          {s.text && <p className="hidden sm:block text-sm text-white/80 mt-1 truncate">{s.text}</p>}
        </div>
        {s.href && <span className="shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-white text-slate-900 text-xs sm:text-sm font-semibold">{s.cta || 'Learn more'}</span>}
      </div>
    );

  return (
    <section aria-roledescription="carousel" aria-label="Promotions" className="max-w-7xl mx-auto w-full px-4"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onKeyDown={onKey}>
      <div className="group relative overflow-hidden rounded-2xl shadow-lg" style={{ aspectRatio: s.image ? '4 / 1' : undefined, height: s.image ? undefined : 'clamp(72px, 12vw, 120px)', border: '1px solid var(--border)' }}>
        <div role="group" aria-roledescription="slide" aria-label={`${idx + 1} of ${n}: ${s.title}`} key={s.id} className="w-full h-full anim-fade">
          {s.href
            ? <a href={s.href} rel={rel} target={external ? '_blank' : undefined} onClick={() => adBeacon(s.id, 'click')}
                className="block w-full h-full focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400">
                {inner}{external && <span className="sr-only"> (opens in a new tab)</span>}
              </a>
            : inner}
        </div>

        <span className="absolute bottom-1.5 right-2 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/40 text-white/90 pointer-events-none">{label}</span>
        {n > 1 && <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous banner" className={`${btn} absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex`}>‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Next banner" className={`${btn} absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex`}>›</button>
          <div className="absolute bottom-1.5 sm:bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 px-2 py-1 rounded-full bg-black/25">
            {slides.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setIdx(i)} aria-label={`Show banner ${i + 1}`} aria-current={i === idx ? 'true' : undefined}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white'}`}/>
            ))}
          </div>
        </>}
        <button type="button" onClick={close} aria-label="Hide banners" className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center bg-black/45 text-white hover:bg-black/65 text-sm opacity-60 group-hover:opacity-100 focus:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-white">×</button>
      </div>
    </section>
  );
}
