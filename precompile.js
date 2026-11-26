/* Compiles the app's JSX once on the server, instead of in every visitor's
   browser. Before this, each page load downloaded the 3 MB Babel compiler from
   unpkg and compiled ~300 KB of JSX before anything showed (1-2 s of spinner).

   - /js/<name>.jsx.js serves public/js/<name>.jsx compiled to plain JS.
   - html(page) rewrites a page: <script type="text/babel" src="/js/x.jsx"> becomes
     <script src="/js/x.jsx.js?v=hash">, inline text/babel blocks are compiled in
     place, and the Babel <script> tag is removed.
   Output is cached in memory and rebuilt when a source file changes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Babel = require('@babel/standalone');

const JS_DIR = path.join(__dirname, 'public', 'js');
const OPTS = { presets: ['react'], compact: false, comments: false, sourceType: 'script' };
const cache = new Map(); // key: source text → { code, hash }

function compile(source, filename) {
  let hit = cache.get(source);
  if (!hit) {
    const code = Babel.transform(source, { ...OPTS, filename }).code;
    hit = { code, hash: crypto.createHash('sha1').update(code).digest('hex').slice(0, 10) };
    cache.set(source, hit);
  }
  return hit;
}

/** Compiled public/js/<name>.jsx, or null if there is no such file. */
function file(name) {
  if (!/^[a-z0-9_-]+$/i.test(name)) return null;
  const src = path.join(JS_DIR, `${name}.jsx`);
  let source; try { source = fs.readFileSync(src, 'utf8'); } catch { return null; }
  return compile(source, `${name}.jsx`);
}

function html(page) {
  try { return transform(page); }
  catch (e) { console.error('[precompile] serving the uncompiled page:', e.message); return page; } // browser Babel still works
}

function transform(page) {
  return page
    .replace(/[ \t]*<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]*"><\/script>\n?/, '')
    .replace(/<script type="text\/babel" src="\/js\/([a-z0-9_-]+)\.jsx"><\/script>/gi, (m, name) => {
      const f = file(name);
      return f ? `<script src="/js/${name}.jsx.js?v=${f.hash}"></script>` : m;
    })
    .replace(/<script type="text\/babel">([\s\S]*?)<\/script>/g, (m, body) =>
      `<script>${compile(body, 'index.html').code.replace(/<\/script/gi, '<\\/script')}</script>`);
}

/** Compiles everything once so the first visitor doesn't wait. */
function warm(page) {
  try { transform(page); return true; } catch (e) { console.error('[precompile]', e.message); return false; }
}

module.exports = { html, file, warm };
