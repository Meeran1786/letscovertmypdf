/* Interface translations. English lives in the app itself; each other
   language is one JSON file with { ui: {key: text}, tools: {id: [label, desc]} }.
   The server injects the requested language into the page, so visitors only
   download their own language. */
const fs = require('fs');
const path = require('path');

const NAMES = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', hi: 'हिन्दी', ur: 'اردو', ar: 'العربية' };
const LANGS = Object.keys(NAMES);           // 'en' first
const RTL = new Set(['ar', 'ur']);
const DICT = {};
for (const l of LANGS.slice(1)) DICT[l] = JSON.parse(fs.readFileSync(path.join(__dirname, `${l}.json`), 'utf8'));

const has = l => l !== 'en' && !!DICT[l];
const ui = (l, key, fallback) => (has(l) && DICT[l].ui[key]) || fallback;
const tool = (l, id) => (has(l) && DICT[l].tools[id]) || null;

module.exports = { NAMES, LANGS, RTL, DICT, has, ui, tool };
