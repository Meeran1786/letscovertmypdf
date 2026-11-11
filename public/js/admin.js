/* LetsConvertPDF admin page (/admin).
   Only Google accounts listed in the server's ADMIN_EMAILS can use it; the
   server checks every request, this page just shows the result.
   Built with plain DOM calls (no innerHTML with user text). */
(function () {
  'use strict';

  const TOKEN_KEY = 'lcpdf-token';
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  let token = localStorage.getItem(TOKEN_KEY);

  /* ── tiny helpers ── */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); };
  async function api(method, url, body, isForm) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status})`), { status: r.status });
    return d;
  }
  const fmtDate = iso => (iso ? new Date(iso).toLocaleString() : '—');

  /* ── sign-in ── */
  function waitForGis(ms = 8000) {
    return new Promise(res => {
      const t0 = Date.now();
      (function poll() {
        if (window.google?.accounts?.id) return res(window.google.accounts.id);
        if (Date.now() - t0 > ms) return res(null);
        setTimeout(poll, 100);
      })();
    });
  }

  async function showSignIn(message) {
    clear(app); who.textContent = '';
    const err = message ? h('div', { class: 'msg err' }, message) : null;
    const btn = h('div', { style: { display: 'flex', justifyContent: 'center', minHeight: '44px' } });
    app.append(h('div', { class: 'card center' },
      h('h2', {}, 'Sign in with Google'),
      h('p', { class: 'muted' }, 'Only admin accounts can open this page.'),
      err, btn));
    const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
    if (!cfg.googleSignInEnabled) { btn.append(h('p', { class: 'muted' }, 'Google Sign-In is not set up on this server (GOOGLE_CLIENT_ID).')); return; }
    const gis = await waitForGis();
    if (!gis) { btn.append(h('p', { class: 'muted' }, "Google sign-in couldn't load. Allow accounts.google.com in your blocker.")); return; }
    gis.initialize({
      client_id: cfg.googleClientId, ux_mode: 'popup',
      callback: async r => {
        try {
          const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: r.credential }) });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Sign-in failed.');
          token = d.token;
          localStorage.setItem(TOKEN_KEY, d.token);
          localStorage.setItem('lcpdf-user', JSON.stringify(d.user));
          start();
        } catch (e) { showSignIn(e.message); }
      },
    });
    gis.renderButton(btn, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
  }

  function signOut() {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('lcpdf-user');
    token = null; showSignIn();
  }

  /* ── shell with tabs ── */
  const TABS = [
    ['ads', 'Ad banners', renderAds],
    ['users', 'Users', renderUsers],
    ['credits', 'Credits & usage', renderCredits],
  ];
  let current = (location.hash || '#ads').slice(1);

  function renderShell(me) {
    clear(app); clear(who);
    who.append(me.email, ' · ', h('a', { href: '/' }, 'Back to site'), ' · ', h('a', { href: '#', onclick: e => { e.preventDefault(); signOut(); } }, 'Sign out'));
    const body = h('div');
    const nav = h('nav', { class: 'tabs', role: 'tablist' });
    const draw = () => {
      clear(nav);
      for (const [id, label] of TABS) nav.append(h('button', { role: 'tab', 'aria-selected': String(id === current), onclick: () => { current = id; location.hash = id; draw(); } }, label));
      clear(body);
      (TABS.find(t => t[0] === current) || TABS[0])[2](body);
    };
    app.append(nav, body);
    draw();
  }

  /* ── Ad banners ── */
  const PLACEMENTS = [['home', 'Home page carousel'], ['tools', 'Tool pages'], ['all', 'Home page and tool pages']];
  const STATUSES = [['draft', 'Draft'], ['active', 'Active'], ['paused', 'Paused']];
  const today = () => new Date().toISOString().slice(0, 10);
  const inYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
  const statusOf = s => s.status || (s.hidden ? 'paused' : 'active');

  /** Crops any picture from the centre to 4:1 and scales it to at most 2000 × 500, as WebP (or JPEG). */
  async function toBanner(blob) {
    const bmp = await createImageBitmap(blob);
    const want = 4;
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
    if (sw / sh > want) { sw = Math.round(sh * want); sx = Math.round((bmp.width - sw) / 2); }
    else { sh = Math.round(sw / want); sy = Math.round((bmp.height - sh) / 2); }
    const w = Math.min(2000, sw), hgt = Math.round(w / want);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
    const enc = (type, q) => new Promise(r => c.toBlob(r, type, q));
    let out = await enc('image/webp', 0.86);
    if (!out || out.type !== 'image/webp') out = await enc('image/jpeg', 0.86);
    for (let q = 0.75; out.size > 4.5 * 1024 * 1024 && q > 0.4; q -= 0.1) out = await enc(out.type, q);
    return { blob: out, width: w, height: hgt, sourceWidth: bmp.width, cropped: sx > 0 || sy > 0 };
  }

  async function renderAds(root) {
    root.append(h('p', { class: 'muted' }, 'Loading banners…'));
    let cfg;
    try { cfg = await api('GET', '/api/admin/ads'); }
    catch (e) { clear(root); root.append(h('div', { class: 'msg err' }, e.message)); return; }
    const status = h('div');
    const say = (text, ok) => { clear(status); status.append(h('div', { class: `msg ${ok ? 'ok' : 'err'}` }, text)); };
    const save = async next => {
      const body = { enabled: cfg.enabled, interval: cfg.interval, slides: next };
      const r = await api('PUT', '/api/admin/ads', body);
      cfg = r; return r;
    };

    const listBox = h('div');
    const formBox = h('div');

    function drawList() {
      clear(listBox);
      const stats = cfg.stats || {};
      const rows = [...cfg.slides].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
      const settings = h('div', { class: 'row', style: { marginBottom: '14px' } },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cfg.enabled !== false, onchange: async e => {
          try { cfg.enabled = e.target.checked; await save(cfg.slides); say(cfg.enabled ? 'Banners are on.' : 'Banners are off across the site.', true); } catch (err) { say(err.message); }
        } }), 'Show banners on the site'),
        h('span', { class: 'muted', style: { marginLeft: '16px' } }, 'Seconds per banner'),
        h('input', { type: 'number', min: 3, max: 60, value: Math.round((cfg.interval || 6000) / 1000), style: { width: '80px' },
          onchange: async e => { try { cfg.interval = Number(e.target.value) * 1000; await save(cfg.slides); say('Saved.', true); } catch (err) { say(err.message); } } }),
        h('button', { class: 'btn primary', style: { marginLeft: 'auto' }, onclick: () => drawForm(null) }, '+ New banner'));
      const table = h('table', {},
        h('thead', {}, h('tr', {}, ['', 'Title', 'Placement', 'Status', 'Dates', 'Pos.', 'Impressions', 'Clicks', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, rows.length ? rows.map(s => {
          const st = stats[s.id] || { views: 0, clicks: 0 };
          const ctr = st.views ? ` (${((st.clicks / st.views) * 100).toFixed(1)}%)` : '';
          const done = s.targetImpressions && st.views >= s.targetImpressions;
          return h('tr', {},
            h('td', {}, s.image ? h('img', { src: s.image, alt: '', class: 'thumb' }) : h('div', { class: 'thumb', style: { background: s.bg || 'linear-gradient(90deg,#1D4ED8,#6D28D9)' } })),
            h('td', {}, h('strong', {}, s.title), s.advertiser ? h('div', { class: 'muted small' }, s.advertiser) : null, !s.image ? h('div', { class: 'small warn' }, 'Old text banner: add an image') : null),
            h('td', {}, (PLACEMENTS.find(p => p[0] === (s.placement || 'home')) || PLACEMENTS[0])[1]),
            h('td', {}, h('span', { class: `pill ${statusOf(s)}` }, done ? 'Target reached' : (STATUSES.find(x => x[0] === statusOf(s)) || [0, 'Active'])[1])),
            h('td', { class: 'small' }, `${s.start || '…'} → ${s.end || '…'}`),
            h('td', {}, s.position ?? '—'),
            h('td', {}, st.views.toLocaleString(), s.targetImpressions ? ` / ${s.targetImpressions.toLocaleString()}` : ''),
            h('td', {}, st.clicks.toLocaleString(), h('span', { class: 'muted small' }, ctr)),
            h('td', { style: { whiteSpace: 'nowrap' } },
              h('button', { class: 'btn', onclick: () => drawForm(s) }, 'Edit'), ' ',
              h('button', { class: 'btn danger', onclick: async () => {
                if (!confirm(`Delete "${s.title}"?`)) return;
                try { await save(cfg.slides.filter(x => x.id !== s.id)); say('Deleted.', true); drawList(); } catch (err) { say(err.message); }
              } }, 'Delete')));
        }) : h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'No banners yet. Click "New banner".'))));
      listBox.append(h('div', { class: 'card' }, h('h2', {}, 'Banners'), settings, h('div', { style: { overflowX: 'auto' } }, table),
        h('p', { class: 'muted small' }, 'Impressions are counted once per page view, clicks when someone opens the link. No visitor data is kept, only the totals.')));
    }

    function drawForm(existing) {
      clear(formBox);
      const s = existing ? { ...existing } : { placement: 'home', status: 'draft', start: today(), end: inYear(), position: (cfg.slides.length || 0) + 1, targetImpressions: 10000 };
      const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
      const inp = (k, attrs = {}) => h('input', { type: 'text', value: s[k] ?? '', oninput: e => { s[k] = e.target.value; if (k === 'title') drawPreview(); }, ...attrs });
      const sel = (k, opts) => h('select', { onchange: e => { s[k] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: (s[k] || opts[0][0]) === v }, l)));
      const preview = h('div', { class: 'banner-preview' });
      const imgNote = h('p', { class: 'hint' });
      const drawPreview = () => {
        clear(preview);
        preview.append(s.image ? h('img', { src: s.image, alt: s.title || '' }) : h('div', { class: 'muted center', style: { padding: '28px' } }, 'Banner preview appears here'));
      };
      const imgText = h('input', { type: 'text', value: s.image || '', placeholder: 'Upload, or paste https://…' });
      const busy = t => { imgNote.textContent = t; };
      const useBlob = async blob => {
        busy('Resizing and compressing…');
        const out = await toBanner(blob);
        const fd = new FormData(); fd.append('image', out.blob, out.blob.type === 'image/webp' ? 'banner.webp' : 'banner.jpg');
        const d = await api('POST', '/api/admin/ads/images', fd, true);
        s.image = d.image; imgText.value = d.image; drawPreview();
        busy(`Saved as ${out.width} × ${out.height}, ${(out.blob.size / 1024).toFixed(0)} KB${out.cropped ? ', cropped from the centre to 4:1' : ''}.` +
          (out.sourceWidth < 1200 ? ' The original is small, so it may look soft on large screens.' : ''));
      };
      const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden', onchange: async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        if (f.size > 25 * 1024 * 1024) { busy('That file is over 25 MB.'); return; }
        try { await useBlob(f); } catch (err) { busy(err.message || 'Could not read that picture.'); }
      } });
      imgText.addEventListener('change', async () => {
        const v = imgText.value.trim();
        if (/^\/ads\/[\w.-]+$/.test(v)) { s.image = v; drawPreview(); return; }
        if (!/^https:\/\//i.test(v)) { busy('Paste a link that starts with https://, or use Upload.'); return; }
        try {
          busy('Downloading…');
          const r = await fetch('/api/admin/ads/fetch-image', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: v }) });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not download that picture.');
          await useBlob(await r.blob());
        } catch (err) { busy(err.message); }
      });
      const msg = h('div');
      const submit = h('button', { class: 'btn primary big', onclick: async () => {
        clear(msg);
        if (!s.title?.trim()) { msg.append(h('div', { class: 'msg err' }, 'Add a title.')); return; }
        if (!s.image) { msg.append(h('div', { class: 'msg err' }, 'Add a banner image.')); return; }
        const next = existing ? cfg.slides.map(x => (x.id === existing.id ? s : x)) : [...cfg.slides, s];
        submit.disabled = true;
        try { await save(next); say(existing ? 'Banner saved.' : 'Banner created.', true); clear(formBox); drawList(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (err) { msg.append(h('div', { class: 'msg err' }, err.message)); submit.disabled = false; }
      } }, existing ? 'Save banner' : 'Create banner');

      formBox.append(h('div', { class: 'card form' },
        h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, existing ? 'Edit banner' : 'New banner'),
          h('button', { class: 'btn', style: { marginLeft: 'auto' }, onclick: () => clear(formBox) }, 'Cancel')),
        field('Title', inp('title'), 'Also read out by screen readers, so describe the ad, e.g. "Acme Interiors: 20% off modular kitchens".'),
        field('Banner image', h('div', {},
          h('div', { class: 'row nowrap' }, imgText, h('button', { class: 'btn', onclick: () => fileIn.click() }, '⬆ Upload'), fileIn),
          h('p', { class: 'hint' }, 'Wide 4:1 image, ideally 1600 × 400 px or larger (any size up to 25 MB, JPG, PNG or WebP). It is resized and compressed for you; a different shape is cropped from the centre to 4:1. It shows about 90 px tall on a phone, so use large text and few words. Or paste an https image URL.'),
          imgNote, preview)),
        field('Click-through URL', inp('href', { placeholder: 'https://…' })),
        h('div', { class: 'two' }, field('Placement', sel('placement', PLACEMENTS)), field('Status', sel('status', STATUSES))),
        h('div', { class: 'two' }, field('Start date', inp('start', { type: 'date' })), field('End date', inp('end', { type: 'date' }))),
        field('Carousel position', inp('position', { type: 'number', min: 0 }), 'Lower numbers show first. Each placement shows up to 6 active banners.'),
        field('Target impressions', inp('targetImpressions', { type: 'number', min: 0, placeholder: 'No limit' }), 'The banner stops showing once it has been seen this many times. Leave empty for no limit.'),
        h('div', { class: 'two' }, field('Advertiser name', inp('advertiser')), field('Advertiser contact (optional)', inp('advertiserContact'))),
        msg, submit));
      drawPreview();
      formBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    clear(root);
    root.append(status, formBox, listBox);
    drawList();
  }

  /* ── Users ── */
  async function renderUsers(root) {
    root.append(h('p', { class: 'muted' }, 'Loading users…'));
    let d;
    try { d = await api('GET', '/api/admin/users'); }
    catch (e) { clear(root); root.append(h('div', { class: 'msg err' }, e.message)); return; }
    clear(root);
    const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, n), h('span', { class: 'muted small' }, l));
    const bt = d.byType || {};
    root.append(h('div', { class: 'stats' }, stat(d.total, 'accounts'), stat(d.newThisWeek, 'new in 7 days'), stat(d.activeThisWeek, 'signed in in 7 days'),
      stat(bt.student || 0, 'students'), stat(bt.individual || 0, 'individuals'), stat(bt.business || 0, 'business')));
    const q = h('input', { type: 'text', placeholder: 'Search by name, email or company domain' });
    const tbody = h('tbody');
    const draw = () => {
      clear(tbody);
      const term = q.value.trim().toLowerCase();
      d.users.filter(u => !term || [u.email, u.name, u.googleDomain, u.company, u.userType].some(x => (x || '').toLowerCase().includes(term))).slice(0, 500).forEach(u => {
        tbody.append(h('tr', {},
          h('td', {}, u.name, u.isAdmin ? ' (admin)' : ''),
          h('td', {}, u.email),
          h('td', {}, u.userType || '—', u.company ? h('div', { class: 'muted small' }, u.company) : null),
          h('td', {}, u.credits == null ? '—' : u.credits.toLocaleString(), ' ',
            h('button', { class: 'btn', style: { padding: '2px 8px' }, onclick: async () => {
              const v = prompt(`Credits to add for ${u.email} (use a minus sign to take away):`, '500');
              if (v == null || !v.trim()) return;
              const note = prompt('Note (optional, kept in the log):', '') || '';
              try { const r = await api('POST', `/api/admin/users/${encodeURIComponent(u.email)}/credits`, { delta: Number(v), note }); u.credits = r.credits; draw(); }
              catch (e) { alert(e.message); }
            } }, '±')),
          h('td', {}, u.googleDomain || '—'),
          h('td', {}, fmtDate(u.createdAt)),
          h('td', {}, fmtDate(u.lastLoginAt)),
          h('td', {}, u.isAdmin ? '' : h('button', { class: `btn ${u.blocked ? '' : 'danger'}`, onclick: async () => {
            try { const r = await api('POST', `/api/admin/users/${encodeURIComponent(u.email)}/block`, { blocked: !u.blocked }); u.blocked = r.blocked; draw(); }
            catch (e) { alert(e.message); }
          } }, u.blocked ? 'Unblock' : 'Block'))));
      });
    };
    q.addEventListener('input', draw);
    root.append(h('div', { class: 'card' }, q, h('div', { style: { overflowX: 'auto', marginTop: '12px' } },
      h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Email', 'Type', 'Credits', 'Google domain', 'Joined', 'Last sign-in', ''].map(t => h('th', {}, t)))), tbody))));
    draw();
  }

  /* ── Credits settings + usage ── */
  async function renderCredits(root) {
    root.append(h('p', { class: 'muted' }, 'Loading…'));
    let cfg, st;
    try { [cfg, st] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/stats?days=30')]); }
    catch (e) { clear(root); root.append(h('div', { class: 'msg err' }, e.message)); return; }
    clear(root);
    const status = h('div');
    const num = (label, get, set) => h('div', {}, h('label', {}, label),
      h('input', { type: 'number', min: 0, step: 1, value: get(), oninput: e => set(e.target.value === '' ? '' : Number(e.target.value)) }));
    const overrides = h('div', { class: 'grid' });
    const drawOverrides = () => {
      clear(overrides);
      const ids = [...new Set([...Object.keys(cfg.toolCosts || {}), ...st.perTool.map(t => t.toolId)])].sort();
      if (!ids.length) overrides.append(h('p', { class: 'muted small' }, 'Tools appear here once people use them. You can also add one by id below.'));
      ids.forEach(id => overrides.append(num(id, () => cfg.toolCosts?.[id] ?? '', v => { cfg.toolCosts = { ...cfg.toolCosts, [id]: v }; })));
    };
    const newId = h('input', { type: 'text', placeholder: 'tool id, e.g. chat' });
    root.append(
      h('div', { class: 'card' }, h('h2', {}, 'Credit rules'),
        h('div', { class: 'grid' },
          num('Credits for a new account', () => cfg.startingCredits, v => { cfg.startingCredits = v; }),
          num('Credits per use (default)', () => cfg.costPerUse, v => { cfg.costPerUse = v; }),
          num('Monthly top-up: students', () => cfg.monthlyFloor.student, v => { cfg.monthlyFloor.student = v; }),
          num('Monthly top-up: individuals', () => cfg.monthlyFloor.individual, v => { cfg.monthlyFloor.individual = v; }),
          num('Monthly top-up: business', () => cfg.monthlyFloor.business, v => { cfg.monthlyFloor.business = v; })),
        h('p', { class: 'muted small' }, 'The monthly top-up raises a balance back up to that number on the first use each month; it never lowers it.')),
      h('div', { class: 'card' }, h('h2', {}, 'Cost per tool (leave empty to use the default)'), overrides,
        h('div', { class: 'row', style: { marginTop: '12px' } }, newId,
          h('button', { class: 'btn', onclick: () => { const id = newId.value.trim(); if (!id) return; cfg.toolCosts = { ...cfg.toolCosts, [id]: cfg.costPerUse }; newId.value = ''; drawOverrides(); } }, 'Add tool'))),
      h('div', { class: 'sticky' }, status, h('button', { class: 'btn primary', onclick: async () => {
        clear(status);
        try { cfg = await api('PUT', '/api/admin/settings', cfg); status.append(h('div', { class: 'msg ok' }, 'Saved.')); drawOverrides(); }
        catch (e) { status.append(h('div', { class: 'msg err' }, e.message)); }
      } }, 'Save credit rules')));
    drawOverrides();

    const totalUses = st.perTool.reduce((a, t) => a + t.uses, 0);
    const totalCredits = st.perTool.reduce((a, t) => a + t.credits, 0);
    const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, n.toLocaleString()), h('span', { class: 'muted small' }, l));
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Usage, last 30 days'),
      h('div', { class: 'stats' }, stat(totalUses, 'tool uses'), stat(totalCredits, 'credits spent')),
      st.perTool.length
        ? h('table', {}, h('thead', {}, h('tr', {}, ['Tool', 'Uses', 'Credits'].map(t => h('th', {}, t)))),
            h('tbody', {}, st.perTool.map(t => h('tr', {}, h('td', {}, t.toolId), h('td', {}, t.uses.toLocaleString()), h('td', {}, t.credits.toLocaleString())))))
        : h('p', { class: 'muted' }, 'No uses yet.'),
      h('p', { class: 'muted small' }, 'Business licences (seats, company domain, expiry and security policies) come in the next update.')));
  }

  /* ── start ── */
  async function start() {
    if (!token) return showSignIn();
    try { const { user } = await api('GET', '/api/admin/me'); renderShell(user); }
    catch (e) {
      if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); token = null; return showSignIn(); }
      if (e.status === 403) return showSignIn(`${e.message} Ask for it to be added to ADMIN_EMAILS on the server.`);
      clear(app); app.append(h('div', { class: 'msg err' }, e.message));
    }
  }
  start();
})();
