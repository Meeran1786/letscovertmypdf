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
    ['soon', 'Credits & licences', renderSoon],
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
  const FIELDS = [
    ['title', 'Headline (required)', 'text'],
    ['text', 'One line under the headline', 'text'],
    ['cta', 'Button label', 'text', 'Learn more'],
    ['href', 'Link: /our-page or https://…', 'text'],
    ['bg', 'Background colour or gradient', 'text', 'linear-gradient(90deg,#1D4ED8,#6D28D9)'],
    ['label', 'Badge text (when sponsored)', 'text', 'Sponsored'],
    ['start', 'Show from', 'date'],
    ['end', 'Show until', 'date'],
  ];

  async function renderAds(root) {
    root.append(h('p', { class: 'muted' }, 'Loading banners…'));
    let cfg, images;
    try { [cfg, { images }] = await Promise.all([api('GET', '/api/admin/ads'), api('GET', '/api/admin/ads/images')]); }
    catch (e) { clear(root); root.append(h('div', { class: 'msg err' }, e.message)); return; }
    let dirty = false;
    const status = h('div');
    const list = h('div');
    const say = (text, ok) => { clear(status); status.append(h('div', { class: `msg ${ok ? 'ok' : 'err'}` }, text)); };
    const touch = () => { dirty = true; saveBtn.disabled = false; clear(status); };

    const settings = h('div', { class: 'card' },
      h('h2', {}, 'Carousel'),
      h('div', { class: 'row' },
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: 0, color: 'var(--text)', fontSize: '14px' } },
          h('input', { type: 'checkbox', checked: cfg.enabled !== false, onchange: e => { cfg.enabled = e.target.checked; touch(); } }), 'Show banners on the site'),
        h('span', { style: { marginLeft: '16px' }, class: 'muted' }, 'Seconds per slide'),
        h('input', { type: 'number', min: 3, max: 60, value: Math.round((cfg.interval || 6000) / 1000), style: { width: '80px' },
          oninput: e => { cfg.interval = Number(e.target.value) * 1000; touch(); } })));

    function slideCard(s, i) {
      const pv = h('div');
      const drawPreview = () => {
        clear(pv);
        const external = /^https?:\/\//i.test(s.href || '');
        pv.append(h('div', { class: 'preview', style: { background: s.bg || 'linear-gradient(90deg,#1D4ED8,#6D28D9)' } },
          s.image ? h('img', { src: s.image, alt: s.imageAlt || '' }) : null,
          h('div', {},
            (s.sponsored || s.label) ? h('span', { class: 'badge' }, s.label || 'Sponsored') : null,
            h('div', { style: { fontWeight: 700, fontSize: '16px' } }, s.title || 'Headline'),
            s.text ? h('div', { style: { opacity: .8, fontSize: '13px' } }, s.text) : null),
          s.href ? h('span', { class: 'cta' }, (s.cta || 'Learn more') + (external ? ' ↗' : '')) : null));
      };
      const field = ([k, label, type, ph]) => h('div', {},
        h('label', {}, label),
        h('input', { type, value: s[k] || '', placeholder: ph || '', oninput: e => { s[k] = e.target.value; touch(); drawPreview(); } }));

      const imgSelect = h('select', { onchange: e => { s.image = e.target.value || undefined; touch(); drawPreview(); } },
        h('option', { value: '' }, 'No picture'),
        images.map(src => h('option', { value: src, selected: s.image === src }, src.replace('/ads/', ''))));
      const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden',
        onchange: async e => {
          const f = e.target.files[0]; if (!f) return;
          const fd = new FormData(); fd.append('image', f);
          try {
            const d = await api('POST', '/api/admin/ads/images', fd, true);
            images.push(d.image); s.image = d.image; touch(); redraw();
          } catch (err) { say(err.message); }
        } });

      const move = d => { const j = i + d; if (j < 0 || j >= cfg.slides.length) return; [cfg.slides[i], cfg.slides[j]] = [cfg.slides[j], cfg.slides[i]]; touch(); redraw(); };
      const card = h('div', { class: 'card', style: s.hidden ? { opacity: .6 } : null },
        h('div', { class: 'slide-head' },
          h('strong', {}, `${i + 1}. ${s.title || 'New slide'}`, s.hidden ? ' (hidden)' : ''),
          h('button', { class: 'btn', onclick: () => move(-1), disabled: i === 0, 'aria-label': 'Move up' }, '↑'),
          h('button', { class: 'btn', onclick: () => move(1), disabled: i === cfg.slides.length - 1, 'aria-label': 'Move down' }, '↓'),
          h('button', { class: 'btn', onclick: () => { s.hidden = !s.hidden; touch(); redraw(); } }, s.hidden ? 'Show' : 'Hide'),
          h('button', { class: 'btn danger', onclick: () => { if (confirm(`Delete "${s.title || 'this slide'}"?`)) { cfg.slides.splice(i, 1); touch(); redraw(); } } }, 'Delete')),
        h('div', { class: 'grid' }, FIELDS.slice(0, 6).map(field)),
        h('div', { class: 'grid', style: { marginTop: '12px' } },
          h('div', {}, h('label', {}, 'Picture (PNG, JPG, WebP or GIF, up to 2 MB)'),
            h('div', { class: 'row' }, imgSelect, h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Upload…'), fileIn)),
          h('div', {}, h('label', {}, 'Describe the picture (for screen readers)'),
            h('input', { type: 'text', value: s.imageAlt || '', oninput: e => { s.imageAlt = e.target.value; touch(); } })),
          field(FIELDS[6]), field(FIELDS[7])),
        h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '12px', color: 'var(--text)', fontSize: '14px' } },
          h('input', { type: 'checkbox', checked: !!s.sponsored, onchange: e => { s.sponsored = e.target.checked; touch(); drawPreview(); } }),
          'Sponsored (shows a badge; links to other sites open in a new tab)'),
        pv);
      drawPreview();
      return card;
    }

    const redraw = () => { clear(list); cfg.slides.forEach((s, i) => list.append(slideCard(s, i))); if (!cfg.slides.length) list.append(h('p', { class: 'muted' }, 'No slides yet.')); };

    const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
      saveBtn.disabled = true;
      try { cfg = await api('PUT', '/api/admin/ads', cfg); dirty = false; say('Saved. The site shows the new banners on the next page load.', true); redraw(); }
      catch (e) { saveBtn.disabled = false; say(e.message); }
    } }, 'Save changes');
    const addBtn = h('button', { class: 'btn', onclick: () => { cfg.slides.push({ title: '', cta: 'Learn more' }); touch(); redraw(); } }, '+ Add slide');

    window.onbeforeunload = () => (dirty ? 'You have unsaved changes.' : undefined);
    clear(root);
    root.append(settings, list, h('div', { class: 'sticky' }, status, h('div', { class: 'row' }, addBtn, saveBtn)));
    redraw();
  }

  /* ── Users ── */
  async function renderUsers(root) {
    root.append(h('p', { class: 'muted' }, 'Loading users…'));
    let d;
    try { d = await api('GET', '/api/admin/users'); }
    catch (e) { clear(root); root.append(h('div', { class: 'msg err' }, e.message)); return; }
    clear(root);
    const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, n), h('span', { class: 'muted small' }, l));
    root.append(h('div', { class: 'stats' }, stat(d.total, 'accounts'), stat(d.newThisWeek, 'new in 7 days'), stat(d.activeThisWeek, 'signed in in 7 days')));
    const q = h('input', { type: 'text', placeholder: 'Search by name, email or company domain' });
    const tbody = h('tbody');
    const draw = () => {
      clear(tbody);
      const term = q.value.trim().toLowerCase();
      d.users.filter(u => !term || [u.email, u.name, u.googleDomain].some(x => (x || '').toLowerCase().includes(term))).slice(0, 500).forEach(u => {
        tbody.append(h('tr', {},
          h('td', {}, u.name, u.isAdmin ? ' (admin)' : ''),
          h('td', {}, u.email),
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
      h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Email', 'Company domain', 'Joined', 'Last sign-in', ''].map(t => h('th', {}, t)))), tbody))));
    draw();
  }

  function renderSoon(root) {
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Coming next'),
      h('p', { class: 'muted' }, 'Credit balances and grants, student / individual / business types, business licences (seats, domain, expiry, security policies), usage per tool and licence requests will appear here.')));
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
