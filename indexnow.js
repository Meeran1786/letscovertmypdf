/* IndexNow: tells Bing (and the other engines that share IndexNow) about new
   or updated pages right away, instead of waiting for a crawl. ChatGPT search
   and Copilot answer from Bing's index, so this helps AI answers find new
   guides sooner. Free, no account needed.

   The key is made once and kept in DATA_DIR. It is public by design: it is
   served at /<key>.txt so Bing can check the pings really come from us.
   Only pages that are new, or whose lastmod changed, are sent. A failed ping
   is retried an hour later, and the last result shows on /api/health. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.indexnow.org/indexnow';

module.exports = function indexNow(dataDir, site) {
  const keyFile = path.join(dataDir, 'indexnow-key.txt');
  const sentFile = path.join(dataDir, 'indexnow-sent.json');
  let key = process.env.INDEXNOW_KEY;
  if (!key) {
    try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch {}
    if (!/^[a-f0-9]{32}$/.test(key || '')) { key = crypto.randomBytes(16).toString('hex'); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(keyFile, key); }
  }

  const status = { last: null };

  /** entries: [{ loc, lastmod }]. A page is re-sent when its lastmod changes. */
  async function ping(entries) {
    try {
      const r = await send(entries);
      status.last = { at: new Date().toISOString(), ok: true, sent: r.sent };
      return r;
    } catch (e) {
      status.last = { at: new Date().toISOString(), ok: false, error: e.message };
      throw e;
    }
  }

  async function send(entries) {
    let sent = {};
    try { sent = JSON.parse(fs.readFileSync(sentFile, 'utf8')); } catch {}
    const stamp = e => e.lastmod || '';
    const fresh = entries.filter(e => sent[e.loc] !== stamp(e));
    if (!fresh.length) return { sent: 0 };
    const host = new URL(site).host;
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `${site}/${key}.txt`, urlList: fresh.slice(0, 10000).map(e => e.loc) }),
    });
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered ${res.status}${res.status === 403 ? ' (key file not reachable at /' + key + '.txt)' : ''}`);
    for (const e of fresh) sent[e.loc] = stamp(e);
    fs.writeFileSync(sentFile, JSON.stringify(sent));
    return { sent: fresh.length };
  }

  return { key, ping, status };
};
