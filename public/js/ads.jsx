/* Ad carousel: a rotating banner for our own promos and sponsor ads.

   Private by design: slides come from /ads.json on our own origin, images
   are served from /ads/ (the CSP only allows our own images), and
   nothing here sets cookies, loads third-party scripts or reports views.

   Slides are edited on the admin page (/admin) and stored in DATA_DIR on the
   server; public/ads.json is only the starting set copied there on first run.
   Each slide:
     id        unique string (required)
     title     headline (required)
     text      one short line under the headline
     cta       button label, e.g. "Learn more"
     href      where a click goes; "/compress-pdf" for our pages, "https://…" for sponsors
     image     optional picture, e.g. "/ads/acme.png" (about 3:1 or wider looks best)
     imageAlt  description of the picture for screen readers (required when image is set)
     bg        optional CSS background, e.g. "linear-gradient(90deg,#2563EB,#7C3AED)"
     sponsored true for ads (our own products count too): shows a small badge and marks the link rel="sponsored"
     label     badge text, default "Sponsored"; e.g. "From our family of products"
     start/end optional dates (YYYY-MM-DD); the slide only shows between them
     hidden    true keeps the slide saved but off the site
   Top-level options: "interval" (ms between slides, default 6000) and "enabled".

   Loaded as text/babel after r4.jsx; the main app renders <AdCarousel/>. */

const ADS_DISMISS_KEY = 'lcpdf-ads-dismissed';

function adsActive(slide, now = new Date()) {
  if (!slide || !slide.id || !slide.title || slide.hidden) return false;
  const day = now.toISOString().slice(0, 10);
  if (slide.start && day < slide.start) return false;
  if (slide.end && day > slide.end) return false;
  if (slide.image && !slide.imageAlt) return false; // no inaccessible picture ads
  return true;
}

function AdCarousel() {
  const { useState, useEffect, useRef, useCallback } = React;
  const [cfg, setCfg] = useState(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(ADS_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const reduceMotion = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (dismissed) return;
    let live = true;
    fetch('/ads.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j && j.enabled !== false) setCfg({ interval: Math.max(3000, j.interval || 6000), slides: (j.slides || []).filter(s => adsActive(s)) }); })
      .catch(() => {});
    return () => { live = false; };
  }, [dismissed]);

  const slides = cfg?.slides || [];
  const n = slides.length;
  const go = useCallback(d => setIdx(i => (i + d + n) % n), [n]);

  useEffect(() => {
    if (n < 2 || paused || reduceMotion.current) return;
    const t = setInterval(() => go(1), cfg.interval);
    return () => clearInterval(t);
  }, [n, paused, go, cfg]);

  if (dismissed || n === 0) return null;
  const s = slides[Math.min(idx, n - 1)];
  const external = /^https?:\/\//i.test(s.href || '');
  const rel = [s.sponsored && 'sponsored', external && 'noopener noreferrer'].filter(Boolean).join(' ') || undefined;
  const close = () => { try { sessionStorage.setItem(ADS_DISMISS_KEY, '1'); } catch {} setDismissed(true); };
  const onKey = e => {
    if (n < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };
  const btn = 'w-8 h-8 rounded-full flex items-center justify-center bg-black/30 hover:bg-black/50 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return (
    <section aria-roledescription="carousel" aria-label="Promotions" className="max-w-7xl mx-auto w-full px-4 my-8"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onKeyDown={onKey}>
      <div className="relative overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border)', background: s.bg || 'linear-gradient(90deg,#1D4ED8,#6D28D9)' }}>
        <div role="group" aria-roledescription="slide" aria-label={`${idx + 1} of ${n}`} key={s.id}
          className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 px-6 sm:px-14 py-6 min-h-[120px]"
          aria-live={paused ? 'polite' : 'off'}>
          {s.image && <img src={s.image} alt={s.imageAlt} loading="lazy" className="h-20 sm:h-24 w-auto max-w-full rounded-lg object-contain"/>}
          <div className="flex-1 text-center sm:text-left text-white">
            {(s.sponsored || s.label) && <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/20 mb-1">{s.label || 'Sponsored'}</span>}
            <p className="font-bold text-lg leading-snug">{s.title}</p>
            {s.text && <p className="text-sm text-white/80 mt-1">{s.text}</p>}
          </div>
          {s.href && (
            <a href={s.href} rel={rel} target={external ? '_blank' : undefined}
              className="shrink-0 px-4 py-2 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white">
              {s.cta || 'Learn more'}{external && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          )}
        </div>

        {n > 1 && <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous slide" className={`${btn} absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex`}>‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Next slide" className={`${btn} absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex`}>›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {slides.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setIdx(i)} aria-label={`Show slide ${i + 1}`} aria-current={i === idx ? 'true' : undefined}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'}`}/>
            ))}
          </div>
        </>}
        <button type="button" onClick={close} aria-label="Hide promotions" className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-black/30 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white">×</button>
      </div>
    </section>
  );
}
