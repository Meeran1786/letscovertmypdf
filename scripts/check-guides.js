/* Validates every guide in ./guides. Exit code 1 if any guide would be skipped. */
const fs = require('fs');
const path = require('path');
const guides = require('../guides');
const { PAGES } = require('../seo');

const files = fs.readdirSync(guides.DIR).filter(f => f.endsWith('.md') && f === f.toLowerCase());
let bad = 0;
for (const f of files) {
  const g = guides.parseFile(path.join(guides.DIR, f));
  const errors = guides.validate(g, Object.keys(PAGES));
  const words = (g.body || '').split(/\s+/).filter(Boolean).length;
  if (errors.length) { bad++; console.log(`✗ ${f}\n    ${errors.join('\n    ')}`); }
  else console.log(`✓ ${f} (${words} words → /${g.tool})`);
}
console.log(`\n${files.length - bad} of ${files.length} guides OK`);
process.exit(bad ? 1 : 0);
