/* Guides: how-to articles served at /guides/<slug> for search traffic.
   Each guide is a Markdown file in ./guides with a small front matter block:

     ---
     title: How to redact a PDF without uploading it     (60 chars max)
     description: One or two sentences for Google.        (160 chars max)
     tool: redact-pdf                                      (a slug from seo.js)
     date: 2026-10-29
     updated: 2026-11-05                                   (optional)
     ---

   Pages are plain server-rendered HTML (no React), so they load fast and
   index well. A weekly scheduled task drafts new guides as pull requests;
   run `npm run check:guides` before merging one. See guides/STYLE.md. */

const fs = require('fs');
const path = require('path');

const SITE = 'https://letsconvertpdf.com';
const DIR = path.join(__dirname, 'guides');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { file, errors: ['missing front matter'] };
  const meta = {};
  for (const line of m[1].split('\n')) { const kv = line.match(/^(\w+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); }
  return { file, slug: path.basename(file, '.md'), ...meta, body: m[2].trim() };
}

/** Problems that would make a guide look broken or hurt rankings. */
function validate(g, toolSlugs) {
  const errors = [...(g.errors || [])];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.slug || '')) errors.push('file name must be lowercase-words-with-dashes.md');
  if (!g.title) errors.push('title is missing'); else if (g.title.length > 60) errors.push(`title is ${g.title.length} chars (max 60)`);
  if (!g.description) errors.push('description is missing'); else if (g.description.length > 160) errors.push(`description is ${g.description.length} chars (max 160)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date || '')) errors.push('date must be YYYY-MM-DD');
  if (g.updated && !/^\d{4}-\d{2}-\d{2}$/.test(g.updated)) errors.push('updated must be YYYY-MM-DD');
  if (!g.tool || (toolSlugs && !toolSlugs.includes(g.tool))) errors.push(`tool "${g.tool || ''}" is not a tool slug in seo.js`);
  const words = (g.body || '').split(/\s+/).filter(Boolean).length;
  if (words < 300) errors.push(`only ${words} words (min 300)`);
  if (/<\s*script|<\s*iframe|javascript:/i.test(g.body || '')) errors.push('raw HTML/script is not allowed');
  return errors;
}

let cache = null;
function load(toolSlugs) {
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.md') && f === f.toLowerCase() && !/^[A-Z]/.test(f)) : [];
  const all = files.map(f => parseFile(path.join(DIR, f)));
  const ok = [];
  for (const g of all) {
    const errors = validate(g, toolSlugs);
    if (errors.length) console.warn(`[guides] skipping ${path.basename(g.file)}: ${errors.join('; ')}`);
    else ok.push(g);
  }
  ok.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  cache = ok;
  return ok;
}

/* A small Markdown subset: ## and ### headings, paragraphs, - and 1. lists,
   > tips, **bold**, *italic*, `code` and [links](/path or https://…). */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^)\s]*)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('http') ? ' rel="noopener"' : ''}>${t}</a>`);
}
function markdown(md) {
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const line of md.split('\n')) {
    const t = line.trim(); let m;
    if (!t) { flushPara(); flushList(); continue; }
    if ((m = t.match(/^(#{2,3})\s+(.*)$/))) { flushPara(); flushList(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<aside class="tip">${inline(m[1])}</aside>`); continue; }
    const ul = t.match(/^[-*]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara(); const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]); continue;
    }
    if (list) { list.items[list.items.length - 1] += ' ' + t; continue; }
    para.push(t);
  }
  flushPara(); flushList();
  return out.join('\n');
}

const STYLE = `:root{--bg:#F8FAFC;--card:#FFFFFF;--text:#0F172A;--muted:#475569;--line:#E2E8F0;--accent:#2563EB;--tip:#EFF6FF}
@media (prefers-color-scheme:dark){:root{--bg:#0B1220;--card:#111A2E;--text:#E2E8F0;--muted:#94A3B8;--line:#1E293B;--accent:#60A5FA;--tip:#13213D}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}header,footer{max-width:760px;margin:0 auto;padding:20px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header a.brand{font-weight:800;color:var(--text);text-decoration:none}main{max-width:760px;margin:0 auto;padding:8px 16px 48px}
.crumbs{font-size:14px;color:var(--muted)}h1{font-size:clamp(28px,5vw,40px);line-height:1.2;margin:8px 0 8px}.meta{color:var(--muted);font-size:14px;margin-bottom:24px}
h2{margin-top:36px;font-size:24px}h3{margin-top:24px;font-size:19px}code{background:var(--line);padding:1px 5px;border-radius:4px;font-size:.92em}
.tip{background:var(--tip);border-left:4px solid var(--accent);padding:12px 16px;border-radius:8px;margin:16px 0}
.cta{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:32px 0;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cta p{margin:0}.btn{background:#2563EB;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px;white-space:nowrap}
ul.cards{list-style:none;padding:0;display:grid;gap:12px}ul.cards li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
ul.cards p{margin:4px 0 0;color:var(--muted);font-size:15px}footer{color:var(--muted);font-size:14px;border-top:1px solid var(--line)}`;

function shell({ title, desc, url, body, schema }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:url" content="${url}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#2563EB"><link rel="icon" href="/icon-192.png">
${schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}
<style>${STYLE}</style></head><body>
<header><a class="brand" href="/">LetsConvertPDF</a><nav><a href="/guides">Guides</a> · <a href="/privacy">Privacy</a></nav></header>
${body}
<footer><span>Free PDF tools that never upload your files.</span><a href="/">All tools</a></footer></body></html>`;
}

const fmtDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function renderGuide(slug, pages) {
  const guides = load(Object.keys(pages));
  const g = guides.find(x => x.slug === slug);
  if (!g) return null;
  const tool = pages[g.tool];
  const url = `${SITE}/guides/${slug}`;
  const related = guides.filter(x => x.slug !== slug).sort((a, b) => (b.tool === g.tool) - (a.tool === g.tool)).slice(0, 4);
  const body = `<main><p class="crumbs"><a href="/guides">Guides</a> › ${esc(tool.h1)}</p>
<article><h1>${esc(g.title)}</h1><p class="meta">${g.updated ? `Updated ${fmtDate(g.updated)}` : fmtDate(g.date)} · LetsConvertPDF team</p>
${markdown(g.body)}</article>
<div class="cta"><p><strong>${esc(tool.h1)}</strong><br><span style="color:var(--muted)">Free, and your file never leaves your device.</span></p><a class="btn" href="/${g.tool}">Open the tool</a></div>
${related.length ? `<h2>More guides</h2><ul class="cards">${related.map(r => `<li><a href="/guides/${r.slug}">${esc(r.title)}</a><p>${esc(r.description)}</p></li>`).join('')}</ul>` : ''}</main>`;
  const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.description, datePublished: g.date, dateModified: g.updated || g.date,
    mainEntityOfPage: url, author: { '@type': 'Organization', name: 'LetsConvertPDF' }, publisher: { '@type': 'Organization', name: 'LetsConvertPDF', logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` } } };
  return shell({ title: `${g.title} | LetsConvertPDF`, desc: g.description, url, body, schema });
}

function renderIndex(pages) {
  const guides = load(Object.keys(pages));
  const body = `<main><h1>PDF guides</h1><p class="meta">Short, practical how-tos. Every tool we link to runs in your browser, so your files stay private.</p>
${guides.length ? `<ul class="cards">${guides.map(g => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a><p>${esc(g.description)}</p></li>`).join('')}</ul>` : '<p>New guides are on the way.</p>'}</main>`;
  return shell({ title: 'PDF Guides: How-Tos for Private, Free PDF Tools | LetsConvertPDF', desc: 'Step-by-step guides to merging, compressing, signing, redacting, translating and chatting with PDFs, privately and for free.', url: `${SITE}/guides`, body });
}

function sitemapEntries(pages) {
  const guides = load(Object.keys(pages));
  const latest = guides.reduce((m, g) => ((g.updated || g.date) > m ? (g.updated || g.date) : m), '');
  return [{ loc: `${SITE}/guides`, lastmod: latest || null, priority: '0.7' },
    ...guides.map(g => ({ loc: `${SITE}/guides/${g.slug}`, lastmod: g.updated || g.date, priority: '0.6' }))];
}

module.exports = { load, validate, parseFile, renderGuide, renderIndex, sitemapEntries, markdown, DIR };
