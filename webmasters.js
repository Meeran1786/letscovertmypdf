/* Google Search Console + Bing Webmaster Tools, run by the server itself.

   After every deploy it submits the sitemap to both, and once a week it
   collects search clicks, top queries, index status of the main pages and
   sitemap errors, saves them in DATA_DIR/seo-report.json and emails them to
   ADMIN_EMAILS. Nobody has to open either dashboard.

   One-time setup (both optional, each works alone):
   - Google: put a service-account key at DATA_DIR/gsc-service-account.json
     (or set GSC_SERVICE_ACCOUNT_FILE) and add that service account's email as
     an Owner of the property in Search Console. No npm package needed: the
     token is signed here with Node's crypto.
   - Bing: put the API key from Bing Webmaster Tools (Settings → API access)
     in BING_WEBMASTER_API_KEY or DATA_DIR/bing-webmaster-key.txt.
   WEBMASTERS=off turns all of it off. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WEEK = 7 * 24 * 3600 * 1000;
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const day = d => d.toISOString().slice(0, 10);

module.exports = function webmasters({ dataDir, site, sitemapUrl, keyPages = [], sendReport = async () => false, log = console }) {
  const host = new URL(site).host;
  const reportFile = path.join(dataDir, 'seo-report.json');
  const read = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };

  const gKeyFile = process.env.GSC_SERVICE_ACCOUNT_FILE || path.join(dataDir, 'gsc-service-account.json');
  let gKey = null;
  try { const k = JSON.parse(read(gKeyFile)); if (k.client_email && k.private_key) gKey = k; } catch {}
  const bingKey = process.env.BING_WEBMASTER_API_KEY || read(path.join(dataDir, 'bing-webmaster-key.txt'));

  const status = { google: gKey ? { configured: true, serviceAccount: gKey.client_email } : { configured: false },
    bing: { configured: !!bingKey }, lastReport: null };

  /* ── Google ── */
  let token = null, tokenExp = 0, gSite = null;
  async function gToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: gKey.client_email, scope: 'https://www.googleapis.com/auth/webmasters',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(gKey.private_key));
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
    const j = await res.json();
    if (!res.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
    token = j.access_token; tokenExp = Date.now() + j.expires_in * 1000;
    return token;
  }
  async function g(method, url, body) {
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${await gToken()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`Google ${res.status}: ${(JSON.parse(text || '{}').error || {}).message || text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }
  const W = 'https://www.googleapis.com/webmasters/v3';
  /** The property as Search Console names it: a domain property or the URL-prefix one. */
  async function googleSite() {
    if (gSite) return gSite;
    const { siteEntry = [] } = await g('GET', `${W}/sites`);
    const ok = siteEntry.filter(s => s.permissionLevel !== 'siteUnverifiedUser').map(s => s.siteUrl);
    gSite = ok.find(s => s === `sc-domain:${host}`) || ok.find(s => s.replace(/\/$/, '') === site);
    if (!gSite) throw new Error(`the service account ${gKey.client_email} has no access to ${host} in Search Console yet (add it as an Owner)`);
    return gSite;
  }
  const enc = encodeURIComponent;

  /* ── Bing ── */
  const B = 'https://ssl.bing.com/webmaster/api.svc/json';
  async function bing(method, name, params = {}, body) {
    const q = new URLSearchParams({ ...params, apikey: bingKey });
    const res = await fetch(`${B}/${name}?${q}`, { method, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`Bing ${name} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text).d : null;
  }
  // Bing returns dates as "/Date(1700000000000)/".
  const bingDate = s => new Date(Number(/\d+/.exec(String(s))?.[0] || 0));

  /** Submits the sitemap to both. Called after each deploy. */
  async function submitSitemaps() {
    const out = {};
    if (gKey) {
      try { await g('PUT', `${W}/sites/${enc(await googleSite())}/sitemaps/${enc(sitemapUrl)}`); out.google = 'submitted'; }
      catch (e) { out.google = e.message; }
    }
    if (bingKey) {
      try { await bing('POST', 'SubmitFeed', {}, { siteUrl: `${site}/`, feedUrl: sitemapUrl }); out.bing = 'submitted'; }
      catch (e) { out.bing = e.message; }
    }
    status.lastSubmit = { at: new Date().toISOString(), ...out };
    return out;
  }

  async function googleReport() {
    const s = await googleSite();
    const end = new Date(Date.now() - 2 * 86400000), start = new Date(end - 27 * 86400000);
    const q = dims => g('POST', `${W}/sites/${enc(s)}/searchAnalytics/query`, { startDate: day(start), endDate: day(end), dimensions: dims, rowLimit: 10 });
    const [total, queries, pages, maps] = await Promise.all([q([]), q(['query']), q(['page']), g('GET', `${W}/sites/${enc(s)}/sitemaps`)]);
    const t = (total.rows || [])[0] || {};
    const index = [];
    for (const url of keyPages.slice(0, 15)) {
      try {
        const r = await g('POST', 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: s });
        const x = r.inspectionResult?.indexStatusResult || {};
        index.push({ url, state: x.coverageState || x.verdict || 'unknown', lastCrawl: x.lastCrawlTime || null });
      } catch (e) { index.push({ url, state: `error: ${e.message}` }); }
    }
    return {
      period: `${day(start)} to ${day(end)}`, clicks: t.clicks || 0, impressions: t.impressions || 0, position: t.position ? +t.position.toFixed(1) : null,
      topQueries: (queries.rows || []).map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(1) })),
      topPages: (pages.rows || []).map(r => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      sitemaps: (maps.sitemap || []).map(m => ({ path: m.path, lastDownloaded: m.lastDownloaded || null, errors: +m.errors || 0, warnings: +m.warnings || 0,
        submitted: (m.contents || []).reduce((n, c) => n + (+c.submitted || 0), 0) })),
      index,
    };
  }

  async function bingReport() {
    const siteUrl = `${site}/`;
    const since = Date.now() - 28 * 86400000;
    const [traffic, queries, crawl] = await Promise.all([
      bing('GET', 'GetRankAndTrafficStats', { siteUrl }), bing('GET', 'GetQueryStats', { siteUrl }), bing('GET', 'GetCrawlStats', { siteUrl })]);
    const recent = (traffic || []).filter(r => bingDate(r.Date) >= since);
    const lastCrawl = (crawl || []).slice(-1)[0] || {};
    return {
      clicks: recent.reduce((n, r) => n + (r.Clicks || 0), 0), impressions: recent.reduce((n, r) => n + (r.Impressions || 0), 0),
      topQueries: (queries || []).sort((a, b) => (b.Impressions || 0) - (a.Impressions || 0)).slice(0, 10)
        .map(r => ({ query: r.Query, clicks: r.Clicks, impressions: r.Impressions, position: r.AvgImpressionPosition })),
      crawl: { pagesIndexed: lastCrawl.InIndex ?? null, crawledPages: lastCrawl.CrawledPages ?? null, crawlErrors: lastCrawl.CrawlErrors ?? null,
        blockedByRobots: lastCrawl.BlockedByRobotsTxt ?? null },
    };
  }

  function format(r) {
    const lines = [`LetsConvertPDF search report, ${r.at.slice(0, 10)}`, ''];
    const g = r.google, b = r.bing;
    if (g?.error) lines.push(`Google: ${g.error}`, '');
    else if (g) {
      lines.push(`GOOGLE (${g.period}): ${g.clicks} clicks, ${g.impressions} impressions${g.position ? `, average position ${g.position}` : ''}`);
      if (g.topQueries.length) lines.push('Top searches:', ...g.topQueries.map(q => `  ${q.query}: ${q.clicks} clicks, ${q.impressions} impressions, position ${q.position}`));
      if (g.topPages.length) lines.push('Top pages:', ...g.topPages.map(p => `  ${p.page}: ${p.clicks} clicks, ${p.impressions} impressions`));
      if (g.sitemaps.length) lines.push('Sitemaps:', ...g.sitemaps.map(m => `  ${m.path}: ${m.submitted} URLs, ${m.errors} errors, ${m.warnings} warnings, last read ${m.lastDownloaded || 'never'}`));
      if (g.index.length) lines.push('Main pages in Google:', ...g.index.map(i => `  ${i.url}: ${i.state}`));
      lines.push('');
    } else lines.push('Google: not set up (no service-account key).', '');
    if (b?.error) lines.push(`Bing: ${b.error}`);
    else if (b) {
      lines.push(`BING (last 28 days): ${b.clicks} clicks, ${b.impressions} impressions; pages in index: ${b.crawl.pagesIndexed ?? 'n/a'}, crawl errors: ${b.crawl.crawlErrors ?? 'n/a'}`);
      if (b.topQueries.length) lines.push('Top searches:', ...b.topQueries.map(q => `  ${q.query}: ${q.clicks} clicks, ${q.impressions} impressions`));
    } else lines.push('Bing: not set up (no API key).');
    return lines.join('\n');
  }

  async function report() {
    const r = { at: new Date().toISOString() };
    if (gKey) { try { r.google = await googleReport(); } catch (e) { r.google = { error: e.message }; } }
    if (bingKey) { try { r.bing = await bingReport(); } catch (e) { r.bing = { error: e.message }; } }
    r.text = format(r);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(r, null, 1));
    r.emailed = await sendReport(`LetsConvertPDF search report ${r.at.slice(0, 10)}`, r.text).catch(() => false);
    status.lastReport = { at: r.at, emailed: r.emailed, google: r.google ? (r.google.error || 'ok') : 'off', bing: r.bing ? (r.bing.error || 'ok') : 'off' };
    return r;
  }

  /** Submit now, then report once a week (checked hourly; survives restarts via the saved report's date). */
  function start() {
    if (process.env.WEBMASTERS === 'off' || (!gKey && !bingKey)) return;
    const due = () => { let last = 0; try { last = Date.parse(JSON.parse(read(reportFile)).at) || 0; } catch {} return Date.now() - last >= WEEK; };
    setTimeout(() => submitSitemaps().then(o => log.log('[webmasters] sitemap', JSON.stringify(o))).catch(() => {}), 45000);
    const tick = () => { if (due()) report().then(r => log.log(`[webmasters] weekly report saved${r.emailed ? ' and emailed' : ''}`)).catch(e => log.warn('[webmasters]', e.message)); };
    setTimeout(tick, 120000);
    setInterval(tick, 3600000).unref();
  }

  return { status, start, submitSitemaps, report, format };
};
