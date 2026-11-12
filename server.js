/**
 * LetsConvertPDF — Server v2.3
 * Maqsusi Digital Industries Software
 *
 * Handles:
 *  - Static SPA serving
 *  - File uploads (multer)
 *  - Server-side conversions via LibreOffice
 *  - Auth: Google Sign-In only (no passwords stored)
 *  - Admin page (/admin): ad banners, users
 *  - Credits: every tool needs a Google sign-in; each use costs credits
 *  - Rate limiting (abuse / brute-force protection)
 *  - Chat: offline message via email (nodemailer / Gmail)
 *  - Temp file cleanup (node-cron)
 */

'use strict';

const express      = require('express');
const multer       = require('multer');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const morgan       = require('morgan');
const fs           = require('fs-extra');
const path         = require('path');
const os           = require('os');
const crypto       = require('crypto');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cron         = require('node-cron');
const seo          = require('./seo');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { console.warn('[Email] nodemailer not installed — run: npm install nodemailer'); }

let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch { console.warn('[Security] express-rate-limit not installed — run: npm install express-rate-limit'); }

let OAuth2Client;
try { ({ OAuth2Client } = require('google-auth-library')); } catch { console.warn('[Google Sign-In] google-auth-library not installed — run: npm install google-auth-library'); }

const app  = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(os.tmpdir(), 'letsconvertpdf', 'uploads');
const OUTPUTS_DIR = path.join(os.tmpdir(), 'letsconvertpdf', 'outputs');
/* Accounts, sessions and usage counters live in DATA_DIR. It must be a
   persistent location (a Docker volume in production): the old OS-temp-dir
   location was wiped on every container rebuild, silently deleting every
   account and logging everyone out. */
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const PYTHON      = process.env.PYTHON_BIN || 'python3';
const PDF_CONVERT = path.join(__dirname, 'converters', 'pdf_convert.py');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(OUTPUTS_DIR);
fs.ensureDirSync(DATA_DIR);

const ADS_FILE    = path.join(DATA_DIR, 'ads.json');
const ADS_IMG_DIR = path.join(DATA_DIR, 'ads-images');
fs.ensureDirSync(ADS_IMG_DIR);
// First start after this change: carry over the slides that were in the repo.
if (!fs.existsSync(ADS_FILE)) {
  try { fs.copyFileSync(path.join(__dirname, 'public', 'ads.json'), ADS_FILE); }
  catch { try { fs.writeFileSync(ADS_FILE, JSON.stringify({ enabled: true, interval: 6000, slides: [] }, null, 2)); } catch {} }
}
const readAds = () => { try { return JSON.parse(fs.readFileSync(ADS_FILE, 'utf8')); } catch { return { enabled: false, interval: 6000, slides: [] }; } };
const writeAds = cfg => { const tmp = `${ADS_FILE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, ADS_FILE); };
/* Impressions and clicks per banner id. Only counts: no user, IP or cookie. */
const AD_STATS_FILE = path.join(DATA_DIR, 'ad-stats.json');
let adStats = {};
try { adStats = JSON.parse(fs.readFileSync(AD_STATS_FILE, 'utf8')); } catch {}
let adStatsDirty = false;
setInterval(() => { if (adStatsDirty) { adStatsDirty = false; try { fs.writeFileSync(AD_STATS_FILE, JSON.stringify(adStats)); } catch {} } }, 10_000).unref();
const AD_PLACEMENTS = ['home', 'tools', 'all'];
const AD_STATUSES = ['draft', 'active', 'paused'];
/** The banners the public site may show right now, in position order (max 6 per placement). */
function liveAds() {
  const cfg = readAds();
  const day = new Date().toISOString().slice(0, 10);
  const perPlacement = {};
  const slides = (cfg.slides || [])
    .filter(s => (s.status || 'active') === 'active' && !s.hidden)
    .filter(s => !(s.start && day < s.start) && !(s.end && day > s.end))
    .filter(s => !(s.targetImpressions > 0 && (adStats[s.id]?.views || 0) >= s.targetImpressions))
    // position first; on a tie, picture banners before old text-only ones
    .sort((a, b) => ((a.position ?? 999) - (b.position ?? 999)) || ((a.image ? 0 : 1) - (b.image ? 0 : 1)))
    .filter(s => { const p = s.placement || 'home'; perPlacement[p] = (perPlacement[p] || 0) + 1; return perPlacement[p] <= 6; })
    .map(({ id, title, text, cta, href, image, bg, label, placement, advertiser }) =>
      ({ id, title, text, cta, href, image, bg, label, placement: placement || 'home', advertiser: advertiser ? true : undefined }));
  return { enabled: cfg.enabled !== false, interval: cfg.interval || 6000, slides };
}


/* Trust the first hop of a reverse proxy (Nginx/Caddy) so req.ip reflects the
   real client address rather than the proxy's. Configurable via TRUST_PROXY
   for deployments behind more than one proxy hop (e.g. a CDN + LB). */
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

/* ─── Auth state (in-memory + file persistence) ─── */
let users  = {};  // { email: { name, verified, authProvider, createdAt, lastLoginAt, userType, credits, refilledMonth, blocked } }
let tokens = {};  // { token: { email, expires } }

try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch {}
try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch {}
/* Google is the only way to sign in, so no password is kept. Old email +
   password accounts keep their record (and anything tied to it): signing in
   with Google using the same email opens the same account. */
{
  let stripped = 0;
  for (const u of Object.values(users)) {
    if (u && (u.passwordHash || u.salt)) { delete u.passwordHash; delete u.salt; stripped++; }
  }
  if (stripped) {
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch {}
    console.log(`[Auth] Removed stored passwords from ${stripped} old account(s); they sign in with Google now.`);
  }
}

const saveUsers = () => {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) { console.error('[Data] Could not save users:', e.message); }
};
// Sessions are persisted too, so a server restart or redeploy doesn't sign everyone out.
const saveTokens = () => {
  try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens)); } catch (e) { console.error('[Data] Could not save sessions:', e.message); }
};

function createToken(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  tokens[token] = { email, expires };
  saveTokens();
  return token;
}
function getEmailFromToken(req) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (!token) return null;
  const entry = tokens[token];
  if (!entry || Date.now() > entry.expires) return null;
  if (users[entry.email]?.blocked) return null;
  return entry.email;
}

/* ═══════════════════════════════════════════
   CREDITS
   Every tool needs a Google sign-in, and every use costs credits (5 by
   default). New accounts start with 1000. Students and individuals get a
   monthly top-up back up to a floor. All numbers are editable on /admin.
   Files are never sent for this: only the tool id and the number of files.
   Node runs one request handler at a time, so a check-and-deduct below can't
   be interleaved with another one (no double spending across tabs).
═══════════════════════════════════════════ */
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LEDGER_FILE   = path.join(DATA_DIR, 'credits-log.jsonl');
const STATS_FILE    = path.join(DATA_DIR, 'stats.json');
const USER_TYPES    = ['student', 'individual', 'business'];
const DEFAULT_SETTINGS = {
  startingCredits: 1000,
  costPerUse: 5,
  monthlyFloor: { student: 500, individual: 250, business: 250 },
  toolCosts: {},   // { toolId: credits } overrides costPerUse for that tool
};
let settings = { ...DEFAULT_SETTINGS };
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
const saveSettings = () => { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { console.error('[Data] Could not save settings:', e.message); } };

let stats = {}; // { "2026-11-11": { toolId: { uses, credits } } }
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch {}
let statsDirty = false;
setInterval(() => { if (statsDirty) { statsDirty = false; try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch {} } }, 10_000).unref();

const todayStr = () => new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
const monthStr = () => new Date().toISOString().slice(0, 7);
const toolCost = toolId => {
  const c = settings.toolCosts?.[toolId];
  return Number.isFinite(c) && c >= 0 ? c : settings.costPerUse;
};

/** Gives a user their starting credits the first time, and the monthly
 *  top-up when a new month starts. Returns true if the record changed. */
function topUp(u) {
  let changed = false;
  if (!Number.isFinite(u.credits)) { u.credits = settings.startingCredits; u.refilledMonth = monthStr(); changed = true; }
  const floor = settings.monthlyFloor?.[u.userType];
  if (u.userType && u.refilledMonth !== monthStr()) {
    if (Number.isFinite(floor) && u.credits < floor) u.credits = floor;
    u.refilledMonth = monthStr();
    changed = true;
  }
  return changed;
}

function logCredits(email, delta, balance, reason, extra = {}) {
  const row = JSON.stringify({ t: new Date().toISOString(), email, delta, balance, reason, ...extra });
  fs.appendFile(LEDGER_FILE, row + '\n').catch(e => console.error('[Data] Could not write credits log:', e.message));
}

/** Checks that the user can pay `units` uses of `toolId`. */
function creditQuote(email, toolId, units = 1) {
  const u = users[email];
  if (topUp(u)) saveUsers();
  const cost = toolCost(toolId) * units;
  return { ok: u.credits >= cost, cost, balance: u.credits };
}
/** Deducts credits (call after creditQuote said ok, in the same tick, or after the work succeeded). */
function chargeCredits(email, toolId, units = 1) {
  const u = users[email];
  const cost = toolCost(toolId) * units;
  u.credits = Math.max(0, u.credits - cost);
  saveUsers();
  logCredits(email, -cost, u.credits, 'use', { toolId, units });
  const day = (stats[todayStr()] ||= {});
  const row = (day[toolId] ||= { uses: 0, credits: 0 });
  row.uses += units; row.credits += cost; statsDirty = true;
  return { cost, balance: u.credits };
}

const outOfCredits = (q, toolId) => ({
  error: `This needs ${q.cost} credits and you have ${q.balance}. Your credits top up at the start of each month.`,
  code: 'out_of_credits', cost: q.cost, balance: q.balance, toolId,
});

/** Middleware: signed-in (not blocked) user, or 401. */
function requireUser(req, res, next) {
  const email = getEmailFromToken(req);
  if (!email || !users[email]) {
    if (req.file) fs.remove(req.file.path).catch(() => {});
    return res.status(401).json({ error: 'Please sign in with Google to use this tool.', code: 'signin_required' });
  }
  req.userEmail = email;
  next();
}

/* ─── Email transporter (nodemailer + Gmail) ─── */
let transporter = null;
if (nodemailer && process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
  });
  transporter.verify()
    .then(() => console.log('[Email] Gmail SMTP ready'))
    .catch(e => console.warn('[Email] SMTP error:', e.message));
}

/** Sends an email and reports whether it was actually delivered.
 *  Returns false (never throws) when SMTP isn't configured — that's stub
 *  mode, not a failure, and callers use the return value to tell the user
 *  when a code genuinely didn't go out. Throws only on a real SMTP error,
 *  which callers should catch and treat the same as "not delivered". */
async function sendEmail(to, subject, textBody, htmlBody) {
  if (!transporter) {
    console.log(`\n[Email stub] ─────────────────────────\nTo: ${to}\nSubject: ${subject}\n${textBody}\n──────────────────────────────────────\n`);
    console.warn('[Email] SMTP is not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing) — the code above was NOT emailed, only logged.');
    return false;
  }
  await transporter.sendMail({
    from: `"LetsConvertPDF" <${process.env.EMAIL_USER}>`,
    to, subject, text: textBody, html: htmlBody,
  });
  return true;
}

/* ─── Google Sign-In (ID-token verification — no client secret needed) ─── */
const googleClient = (OAuth2Client && process.env.GOOGLE_CLIENT_ID)
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;
if (process.env.GOOGLE_CLIENT_ID && !OAuth2Client) {
  console.warn('[Google Sign-In] GOOGLE_CLIENT_ID is set but google-auth-library is missing — run: npm install google-auth-library');
} else if (googleClient) {
  console.log('[Google Sign-In] Ready (Client ID configured)');
}

/* ─── Middleware ─── */
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","'unsafe-inline'","'unsafe-eval'",'cdn.tailwindcss.com','unpkg.com','cdnjs.cloudflare.com','fonts.googleapis.com','https://accounts.google.com/gsi/client',
        'https://apis.google.com','https://www.dropbox.com'],
      // Google's sign-in button loads its own stylesheet; blocking it left the button unstyled/broken.
      styleSrc:   ["'self'","'unsafe-inline'",'fonts.googleapis.com','cdn.tailwindcss.com','https://accounts.google.com/gsi/style'],
      fontSrc:    ["'self'",'fonts.gstatic.com','data:'],
      imgSrc:     ["'self'",'data:','blob:','https://*.googleusercontent.com'],
      // The on-device AI downloads its open model weights from Hugging Face and
      // the matching WebGPU kernels from GitHub. Only model files travel this
      // way; document text never leaves the browser.
      // The CDN hosts are also listed so the service worker can cache the app
      // shell for offline use.
      connectSrc: ["'self'",'https://accounts.google.com','cdnjs.cloudflare.com','unpkg.com','cdn.tailwindcss.com','fonts.googleapis.com','fonts.gstatic.com',
        'https://huggingface.co','https://*.huggingface.co','https://*.hf.co','https://raw.githubusercontent.com',
        // Cloud import downloads the picked file directly into the browser.
        'https://www.googleapis.com','https://*.dropboxusercontent.com'],
      frameSrc:   ["'self'",'https://accounts.google.com','https://docs.google.com','https://www.dropbox.com'],
      workerSrc:  ["'self'",'blob:','cdnjs.cloudflare.com'],
    },
  },
  // Helmet's defaults (COOP same-origin + no-referrer) break Google Sign-In:
  // the sign-in popup can't hand the credential back to this window, and
  // Google can't verify which origin the button was rendered on.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(express.json({ limit: '10mb' }));

/* Rate limiting — abuse & brute-force protection (NFR: security) */
if (rateLimit) {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_API_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_AUTH_MAX) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes before trying again.' },
  });
  app.use('/api/', apiLimiter);
  app.use('/api/auth/', authLimiter);
} else {
  console.warn('[Security] Rate limiting is DISABLED (express-rate-limit missing). Not recommended for production.');
}

/* On-device engines, self-hosted so the privacy promise doesn't depend on a
   third-party CDN: qpdf (encrypt/decrypt), Tesseract (OCR) and WebLLM (AI). */
const VENDOR = {
  qpdf:             '@neslinesli93/qpdf-wasm/dist',
  tesseract:        'tesseract.js/dist',
  'tesseract-core': 'tesseract.js-core',
  'web-llm':        '@mlc-ai/web-llm/lib',
};
// OCR language files: /vendor/tessdata/spa.traineddata.gz → @tesseract.js-data/spa/4.0.0_best_int/
const OCR_LANGS = ['eng', 'spa', 'fra', 'deu', 'por', 'ita', 'nld', 'ind', 'tur', 'pol'];
app.get('/vendor/tessdata/:file', (req, res, next) => {
  const m = /^([a-z]{3})\.traineddata\.gz$/.exec(req.params.file);
  if (!m || !OCR_LANGS.includes(m[1])) return next();
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.sendFile(path.join(__dirname, 'node_modules', '@tesseract.js-data', m[1], '4.0.0_best_int', req.params.file), err => err && next());
});
for (const [route, dir] of Object.entries(VENDOR)) {
  app.use(`/vendor/${route}`, express.static(path.join(__dirname, 'node_modules', dir), { maxAge: '30d', immutable: true, index: false }));
}

/* SEO: robots, sitemap and a server-rendered landing page per tool. */
app.get('/robots.txt', (req, res) => res.type('text/plain').send(seo.robots()));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(seo.sitemap()));
app.get('/llms.txt', (req, res) => res.type('text/plain; charset=utf-8').send(seo.llmsTxt()));
const indexNow = require('./indexnow')(DATA_DIR, seo.SITE);
app.get(`/${indexNow.key}.txt`, (req, res) => res.type('text/plain').send(indexNow.key));
let indexHtml = null;
const readIndex = () => {
  if (!indexHtml || process.env.NODE_ENV !== 'production') indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  return indexHtml;
};
// One URL per page: /merge-pdf/ and /index.html redirect to the canonical URL,
// so Google doesn't list them as duplicates ("Alternate page with canonical").
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get(/^\/.+\/$/, (req, res) => {
  const q = req.originalUrl.indexOf('?');
  res.redirect(301, '/' + req.path.replace(/^\/+|\/+$/g, '') + (q >= 0 ? req.originalUrl.slice(q) : ''));
});
const guides = require('./guides');
app.get('/guides', (req, res) => res.type('html').send(guides.renderIndex(seo.PAGES)));
app.get('/guides/:slug', (req, res) => {
  const html = guides.renderGuide(req.params.slug, seo.PAGES);
  // A real 404 (not the app shell), so search engines drop removed guides.
  if (!html) return res.status(404).type('html').send(guides.renderIndex(seo.PAGES));
  res.type('html').send(html);
});
// Translated interface: /es, /es/merge-pdf, … (English stays at the root).
const LANG_RE = require('./i18n').LANGS.slice(1).join('|');
app.get('/', (req, res) => res.type('html').send(seo.renderHome(readIndex())));
app.get(`/:lang(${LANG_RE})`, (req, res) => res.type('html').send(seo.renderHome(readIndex(), req.params.lang)));
app.get(`/:lang(${LANG_RE})/:slug`, (req, res, next) => {
  const page = seo.renderPage(readIndex(), req.params.slug, req.params.lang);
  if (!page) return next();
  res.type('html').send(page);
});
app.get('/:slug', (req, res, next) => {
  const page = seo.renderPage(readIndex(), req.params.slug);
  if (!page) return next();
  res.type('html').send(page);
});

// Ad banners are edited on /admin and kept in DATA_DIR, not in the code.
app.get('/ads.json', (req, res) => { res.set('Cache-Control', 'no-cache'); res.json(liveAds()); });
app.post('/api/ads/:id/:kind(view|click)', (req, res) => {
  const id = String(req.params.id).slice(0, 40);
  if (!readAds().slides?.some(s => s.id === id)) return res.status(204).end();
  const row = (adStats[id] ||= { views: 0, clicks: 0 });
  row[req.params.kind === 'view' ? 'views' : 'clicks'] += 1; adStatsDirty = true;
  res.status(204).end();
});
app.use('/ads', express.static(ADS_IMG_DIR, { maxAge: '7d', index: false }));
app.get('/admin', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// The service worker must never be cached long, or app updates get stuck.
app.get('/sw.js', (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

/* ─── Multer ─── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 256) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg','image/png','image/gif','image/webp','image/tiff','image/bmp','text/html',
    ];
    // Browsers often send Office files as application/octet-stream (or an
    // empty type), so fall back to the file extension before rejecting.
    const allowedExt = ['.html','.htm','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.rtf','.jpg','.jpeg','.png','.gif','.webp','.tif','.tiff','.bmp'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    (allowed.includes(file.mimetype) || allowedExt.includes(ext))
      ? cb(null, true)
      : cb(Object.assign(new Error(`Unsupported file type (${ext || file.mimetype}).`), { status: 415 }));
  },
});

/* ─── Conversion helpers ─── */
function run(cmd, args, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const notFound = err.code === 'ENOENT';
        return reject(Object.assign(new Error(notFound ? `${cmd} is not installed on the server.` : (String(stderr || '').trim().split('\n').slice(-3).join(' ') || err.message)), { tool: cmd, notFound }));
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Converts with LibreOffice and returns the path of the produced file.
 *  Each call gets its own LibreOffice profile: concurrent conversions sharing
 *  the default profile lock each other out and fail silently. `infilter`
 *  is needed for PDF input, which LibreOffice otherwise opens in Draw and
 *  can't export to Word/PowerPoint at all. */
async function libreOfficeConvert(inputPath, outputDir, targetFormat, infilter) {
  const profileDir = path.join(os.tmpdir(), 'letsconvertpdf', `lo-${uuidv4()}`);
  const args = [`-env:UserInstallation=file://${profileDir}`, '--headless', '--norestore'];
  if (infilter) args.push(`--infilter=${infilter}`);
  args.push('--convert-to', targetFormat, '--outdir', outputDir, inputPath);
  try {
    await run(process.env.LIBREOFFICE_BIN || 'soffice', args);
  } finally {
    fs.remove(profileDir).catch(() => {});
  }
  const ext = targetFormat.split(':')[0];
  const out = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.${ext}`);
  if (!(await fs.pathExists(out))) throw new Error('The converter could not read this file. It may be damaged, password-protected or in an unsupported format.');
  return out;
}

async function pythonConvert(mode, inputPath, outPath) {
  await run(PYTHON, [PDF_CONVERT, mode, inputPath, outPath]);
  if (!(await fs.pathExists(outPath))) throw new Error('Conversion produced no output.');
  return outPath;
}

function baseName(file) {
  return path.basename(file.originalname, path.extname(file.originalname)) || 'document';
}

async function sendFileAndCleanup(res, filePath, downloadName) {
  if (!(await fs.pathExists(filePath))) return res.status(500).json({ error: 'Conversion produced no output.' });
  res.download(filePath, downloadName, err => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
    setTimeout(() => fs.remove(filePath).catch(() => {}), 30_000);
  });
}

/* ═══════════════════════════════════════════
   CREDIT ROUTES
═══════════════════════════════════════════ */

/* Spend credits for an on-device tool, before it runs on the user's device.
   Only the tool id and the number of files are sent, never the files. */
app.post('/api/credits/spend', requireUser, (req, res) => {
  const toolId = String(req.body?.toolId || '').trim().slice(0, 40);
  if (!/^[\w-]+$/.test(toolId)) return res.status(400).json({ error: 'toolId is required.' });
  const units = Math.min(100, Math.max(1, parseInt(req.body?.units, 10) || 1));
  const q = creditQuote(req.userEmail, toolId, units);
  if (!q.ok) return res.status(402).json(outOfCredits(q, toolId));
  res.json(chargeCredits(req.userEmail, toolId, units));
});

/* How much a tool costs, and the user's balance (shown before running). */
app.get('/api/credits/quote', requireUser, (req, res) => {
  const toolId = String(req.query.toolId || '').trim().slice(0, 40);
  const q = creditQuote(req.userEmail, toolId, 1);
  res.json({ toolId, cost: q.cost, balance: q.balance });
});

/* First sign-in: the user says whether they are a student, an individual or a business. */
app.post('/api/me/profile', requireUser, (req, res) => {
  const type = String(req.body?.userType || '');
  if (!USER_TYPES.includes(type)) return res.status(400).json({ error: 'Choose student, individual or business.' });
  const u = users[req.userEmail];
  u.userType = type;
  if (type === 'business' && req.body?.company) u.company = String(req.body.company).trim().slice(0, 120);
  topUp(u);
  saveUsers();
  res.json({ user: publicUser(req.userEmail) });
});

/* ═══════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════ */

app.get('/api/auth/me', (req, res) => {
  const email = getEmailFromToken(req);
  if (!email || !users[email]) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: publicUser(email) });
});

/* Logout */
app.post('/api/auth/logout', (req, res) => {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  delete tokens[token];
  saveTokens();
  res.json({ message: 'Logged out' });
});

/* Public runtime config — safe to expose (a Google Client ID is meant to be
 * embedded client-side; it is not a secret). Lets the frontend render the
 * real Google button only when sign-in is actually configured. */
app.get('/api/config', (req, res) => {
  res.json({
    googleSignInEnabled: !!googleClient,
    googleClientId: googleClient ? process.env.GOOGLE_CLIENT_ID : null,
    // Optional cloud import. Files go from Drive/Dropbox straight to the browser.
    googlePickerApiKey: googleClient ? (process.env.GOOGLE_PICKER_API_KEY || null) : null,
    dropboxAppKey: process.env.DROPBOX_APP_KEY || null,
  });
});

/* Google Sign-In — verifies the ID token Google's client-side library hands
 * back after the user picks their Google account. No redirect, no client
 * secret: Google already proved the user owns that email, so we skip OTP
 * and issue our own session token directly. */
app.post('/api/auth/google', async (req, res) => {
  if (!googleClient) {
    return res.status(501).json({
      error: 'Google Sign-In is not configured on this server yet.',
      hint: 'Set GOOGLE_CLIENT_ID in .env (from Google Cloud Console → APIs & Services → Credentials) and restart the server. No client secret is needed for this flow.',
    });
  }

  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Missing Google credential.' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (e) {
    console.error('[Google Sign-In] Token verification failed:', e.message);
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }

  if (!payload?.email) return res.status(400).json({ error: 'Your Google account has no email on file.' });
  if (!payload.email_verified) return res.status(400).json({ error: 'Your Google email address is not verified.' });

  const key = payload.email.toLowerCase();
  const now = new Date().toISOString();
  if (!users[key]) {
    users[key] = {
      name: payload.name || key.split('@')[0],
      verified: true,     // Google already verified this email
      authProvider: 'google',
      createdAt: now,
    };
  }
  const u = users[key];
  u.verified = true;
  u.authProvider = 'google';  // old email + password accounts move over here
  if (!u.name && payload.name) u.name = payload.name;
  if (payload.hd) u.googleDomain = payload.hd; // Google Workspace domain, for business licences later
  u.lastLoginAt = now;
  if (u.blocked) return res.status(403).json({ error: 'This account has been suspended. Contact support@letsconvertpdf.com.' });
  saveUsers();

  const token = createToken(key);
  res.json({ token, user: publicUser(key) });
});

/* ═══════════════════════════════════════════
   ADMIN (/admin)
   Only the Google accounts listed in ADMIN_EMAILS (comma separated) can use
   these routes. Ad banners live in DATA_DIR so they can be changed without a
   code push or redeploy.
═══════════════════════════════════════════ */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
if (!ADMIN_EMAILS.length) console.warn('[Admin] ADMIN_EMAILS is not set, so nobody can open /admin.');
const isAdmin = email => !!email && ADMIN_EMAILS.includes(email);

function publicUser(email) {
  const u = users[email] || {};
  if (users[email] && topUp(u)) saveUsers();
  return {
    email, name: u.name || '', isAdmin: isAdmin(email),
    userType: u.userType || null, company: u.company || null,
    credits: Number.isFinite(u.credits) ? u.credits : 0,
    costPerUse: settings.costPerUse,
  };
}

function requireAdmin(req, res, next) {
  const email = getEmailFromToken(req);
  if (!email || !users[email]) return res.status(401).json({ error: 'Please sign in with Google.' });
  if (!isAdmin(email)) return res.status(403).json({ error: 'This Google account is not an admin.' });
  req.adminEmail = email;
  next();
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Checks and cleans an ads config from the admin page. Throws a readable error. */
function cleanAds(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.slides)) throw new Error('Expected { enabled, interval, slides: [] }.');
  if (body.slides.length > 50) throw new Error('At most 50 banners.');
  const seen = new Set();
  const slides = body.slides.map((s, i) => {
    const n = `Banner ${i + 1}`;
    const slide = {
      id: str(s.id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || `ad-${crypto.randomBytes(4).toString('hex')}`,
      title: str(s.title, 160),
    };
    if (!slide.title) throw new Error(`${n}: a title is required (screen readers read it out).`);
    if (seen.has(slide.id)) throw new Error(`${n}: the id "${slide.id}" is used twice.`);
    seen.add(slide.id);
    const href = str(s.href, 500);
    if (href) {
      if (!(/^\/(?!\/)/.test(href) || /^https?:\/\/[^\s]+$/i.test(href))) throw new Error(`${n}: the click-through URL must start with https:// (or / for our own pages).`);
      slide.href = href;
    }
    const image = str(s.image, 200);
    if (image) {
      if (!/^\/ads\/[\w.-]+$/.test(image)) throw new Error(`${n}: upload the banner image here; outside image links are blocked.`);
      slide.image = image;
    }
    for (const [k, max] of [['text', 240], ['cta', 40], ['label', 40], ['advertiser', 120], ['advertiserContact', 200]]) {
      const v = str(s[k], max); if (v) slide[k] = v;
    }
    const bg = str(s.bg, 200);
    if (bg) {
      if (!/^[#(),.%\w\s-]+$/.test(bg) || /url\s*\(/i.test(bg)) throw new Error(`${n}: the background must be a colour or gradient.`);
      slide.bg = bg;
    }
    slide.placement = AD_PLACEMENTS.includes(s.placement) ? s.placement : 'home';
    slide.status = AD_STATUSES.includes(s.status) ? s.status : (s.hidden ? 'paused' : 'active');
    const pos = parseInt(s.position, 10); slide.position = Number.isFinite(pos) ? Math.max(0, Math.min(999, pos)) : i + 1;
    const target = parseInt(s.targetImpressions, 10); if (Number.isFinite(target) && target > 0) slide.targetImpressions = Math.min(1e9, target);
    for (const k of ['start', 'end']) {
      const d = str(s[k], 10);
      if (d) { if (!DAY_RE.test(d)) throw new Error(`${n}: ${k} date must be YYYY-MM-DD.`); slide[k] = d; }
    }
    if (slide.start && slide.end && slide.end < slide.start) throw new Error(`${n}: the end date is before the start date.`);
    if (!slide.image && slide.status === 'active' && !slide.text && !slide.bg && !slide.href) {
      // a bare title with nothing else is almost certainly unfinished
      throw new Error(`${n}: add a banner image before making it active.`);
    }
    return slide;
  });
  const interval = Math.min(60000, Math.max(3000, Number(body.interval) || 6000));
  return { enabled: body.enabled !== false, interval, slides };
}

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ user: publicUser(req.adminEmail) }));
app.get('/api/admin/ads', requireAdmin, (req, res) => res.json({ ...readAds(), stats: adStats }));
app.put('/api/admin/ads', requireAdmin, (req, res) => {
  let cfg;
  try { cfg = cleanAds(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  try { writeAds(cfg); } catch (e) { console.error('[Admin] Could not save ads:', e.message); return res.status(500).json({ error: 'Could not save. Check the server has space on disk.' }); }
  console.log(`[Admin] ${req.adminEmail} saved ${cfg.slides.length} ad slide(s)`);
  res.json({ ...cfg, stats: adStats });
});

/* Pictures for slides: PNG, JPEG, WebP or GIF up to 2 MB, checked by their
   first bytes (not just the name), saved under a random name. No SVG, which
   can carry scripts. */
const IMG_TYPES = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], webp: [0x52, 0x49, 0x46, 0x46] };
const sniffImage = buf => {
  for (const [ext, sig] of Object.entries(IMG_TYPES)) {
    if (sig.every((b, i) => buf[i] === b) && (ext !== 'webp' || buf.slice(8, 12).toString('ascii') === 'WEBP')) return ext;
  }
  return null;
};
const adImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
app.post('/api/admin/ads/images', requireAdmin, (req, res) => {
  adImageUpload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Pictures can be at most 5 MB after resizing.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a picture to upload.' });
    const ext = sniffImage(req.file.buffer);
    if (!ext) return res.status(415).json({ error: 'Use a PNG, JPG, WebP or GIF picture.' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try { fs.writeFileSync(path.join(ADS_IMG_DIR, name), req.file.buffer); }
    catch (e) { return res.status(500).json({ error: 'Could not save the picture.' }); }
    res.json({ image: `/ads/${name}` });
  });
});
/* "Paste an https link" in the banner form: the server downloads the picture
   once so the admin page can crop it and upload our own copy. Visitors never
   load pictures from the advertiser's site (no tracking through images). */
const dnsLookup = require('dns').promises.lookup;
const privateIp = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80)/i.test(ip);
app.post('/api/admin/ads/fetch-image', requireAdmin, async (req, res) => {
  let url;
  try { url = new URL(String(req.body?.url || '')); } catch { return res.status(400).json({ error: 'Paste a full https:// link to the picture.' }); }
  if (url.protocol !== 'https:') return res.status(400).json({ error: 'Only https:// links are allowed.' });
  try {
    const { address } = await dnsLookup(url.hostname);
    if (privateIp(address)) return res.status(400).json({ error: 'That address is not allowed.' });
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(400).json({ error: `That link answered ${r.status}.` });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return res.status(400).json({ error: 'That picture is bigger than 25 MB.' });
    const ext = sniffImage(buf);
    if (!ext) return res.status(415).json({ error: 'That link is not a PNG, JPG, WebP or GIF picture.' });
    res.type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`).send(buf);
  } catch (e) { res.status(400).json({ error: 'Could not download that picture. Try uploading the file instead.' }); }
});
app.get('/api/admin/ads/images', requireAdmin, (req, res) => {
  const list = d => { try { return fs.readdirSync(d).filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f)); } catch { return []; } };
  const names = [...new Set([...list(ADS_IMG_DIR), ...list(path.join(__dirname, 'public', 'ads'))])].sort();
  res.json({ images: names.map(n => `/ads/${n}`) });
});
app.delete('/api/admin/ads/images/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(ADS_IMG_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Only pictures uploaded here can be deleted.' });
  if (readAds().slides.some(s => s.image === `/ads/${name}`)) return res.status(409).json({ error: 'A slide still uses this picture.' });
  fs.removeSync(file);
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const list = Object.entries(users).map(([email, u]) => ({
    email, name: u.name || '', createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
    googleDomain: u.googleDomain || null, blocked: !!u.blocked, isAdmin: isAdmin(email),
    userType: u.userType || null, company: u.company || null, credits: Number.isFinite(u.credits) ? u.credits : null,
  })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({
    total: list.length,
    activeThisWeek: list.filter(u => u.lastLoginAt && u.lastLoginAt >= weekAgo).length,
    newThisWeek: list.filter(u => u.createdAt && u.createdAt >= weekAgo).length,
    byType: USER_TYPES.concat('unset').reduce((o, t) => ({ ...o, [t]: list.filter(u => (u.userType || 'unset') === t).length }), {}),
    users: list,
  });
});
/* Give or take credits, e.g. for a refund or a promotion. */
app.post('/api/admin/users/:email/credits', requireAdmin, (req, res) => {
  const key = String(req.params.email || '').toLowerCase();
  const u = users[key];
  if (!u) return res.status(404).json({ error: 'No such user.' });
  const delta = parseInt(req.body?.delta, 10);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000) return res.status(400).json({ error: 'Enter a whole number of credits, e.g. 500 or -100.' });
  topUp(u);
  u.credits = Math.max(0, u.credits + delta);
  saveUsers();
  logCredits(key, delta, u.credits, 'admin', { by: req.adminEmail, note: String(req.body?.note || '').slice(0, 200) });
  res.json({ ok: true, credits: u.credits });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(settings));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const num = (v, name, max = 1_000_000) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${name} must be a whole number from 0 to ${max}.`);
    return n;
  };
  try {
    const next = {
      startingCredits: num(b.startingCredits, 'Starting credits'),
      costPerUse: num(b.costPerUse, 'Credits per use', 10_000),
      monthlyFloor: Object.fromEntries(USER_TYPES.map(t => [t, num(b.monthlyFloor?.[t] ?? 0, `Monthly top-up for ${t}`)])),
      toolCosts: {},
    };
    for (const [id, c] of Object.entries(b.toolCosts || {})) {
      if (!/^[\w-]{1,40}$/.test(id)) continue;
      if (c === '' || c == null) continue;
      next.toolCosts[id] = num(c, `Cost of ${id}`, 10_000);
    }
    settings = next;
    saveSettings();
    console.log(`[Admin] ${req.adminEmail} changed credit settings`);
    res.json(settings);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* Uses and credits spent per tool, for the last N days. */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const perTool = {}; const perDay = [];
  for (const [day, tools] of Object.entries(stats).sort()) {
    if (day < since) continue;
    let uses = 0, credits = 0;
    for (const [id, r] of Object.entries(tools)) {
      const t = (perTool[id] ||= { toolId: id, uses: 0, credits: 0 });
      t.uses += r.uses; t.credits += r.credits; uses += r.uses; credits += r.credits;
    }
    perDay.push({ day, uses, credits });
  }
  res.json({ days, perDay, perTool: Object.values(perTool).sort((a, b) => b.uses - a.uses) });
});

app.post('/api/admin/users/:email/block', requireAdmin, (req, res) => {
  const key = String(req.params.email || '').toLowerCase();
  if (!users[key]) return res.status(404).json({ error: 'No such user.' });
  if (isAdmin(key)) return res.status(400).json({ error: 'Admins cannot be blocked here.' });
  users[key].blocked = req.body?.blocked !== false;
  if (users[key].blocked) for (const [t, v] of Object.entries(tokens)) if (v.email === key) delete tokens[t];
  saveUsers(); saveTokens();
  res.json({ ok: true, blocked: users[key].blocked });
});

/* ═══════════════════════════════════════════
   CHAT ROUTE
═══════════════════════════════════════════ */

app.post('/api/chat/message', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message are required.' });

  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  // Visitor-supplied text goes into an HTML email, so escape it.
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0A1628;padding:40px"><div style="max-width:560px;margin:0 auto;background:#162C56;border-radius:16px;padding:32px;color:#E2E8F0"><h2 style="color:#60A5FA;margin-top:0">💬 New Chat Message</h2><p><strong>From:</strong> ${esc(name)}</p><p><strong>Reply to:</strong> <a href="mailto:${esc(email)}" style="color:#60A5FA">${esc(email)}</a></p><hr style="border-color:rgba(255,255,255,0.1)"/><div style="background:#0A1628;border-radius:8px;padding:16px;margin-top:16px">${esc(message).replace(/\n/g,'<br>')}</div><hr style="border-color:rgba(255,255,255,0.1);margin-top:24px"/><p style="color:#475569;font-size:12px">Via LetsConvertPDF Chat</p></div></body></html>`;

  try {
    const delivered = adminEmail
      ? await sendEmail(adminEmail, `[LetsConvertPDF Chat] Message from ${name}`, `From: ${name} <${email}>\n\n${message}`, html)
      : false;
    if (!delivered) {
      console.log(`[Chat — NOT delivered, email not configured] From: ${name} <${email}>\n${message}`);
      return res.status(503).json({ error: 'Our messaging is temporarily unavailable. Please try again later.' });
    }
    res.json({ message: "Message sent. We'll reply to you at " + email + " shortly." });
  } catch (e) {
    console.error('[Chat error]', e.message);
    res.status(500).json({ error: 'Could not send message. Please try again.' });
  }
});

/* ═══════════════════════════════════════════
   HEALTH + CONVERSION ROUTES
═══════════════════════════════════════════ */

/* Which conversion engines are installed — checked once at startup so
   /api/health can show at a glance why a server-side tool would fail. */
const engines = {};
for (const [name, cmd, args] of [
  ['libreoffice', process.env.LIBREOFFICE_BIN || 'soffice', ['--version']],
  ['ghostscript', 'gs', ['--version']],
  ['qpdf', 'qpdf', ['--version']],
  ['pdfConverters', PYTHON, ['-c', 'import pdf2docx, pdfplumber, openpyxl']],
]) {
  run(cmd, args, 60_000).then(() => { engines[name] = true; }, () => { engines[name] = false; console.warn(`[Engines] ${name} is not available — related tools will fail.`); });
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LetsConvertPDF API',
    version: '2.4.0',
    timestamp: new Date().toISOString(),
    // Booleans only — never exposes credentials — so ops can confirm config
    // via a plain curl instead of grepping server logs or SSHing in.
    emailConfigured: !!transporter,
    googleSignInConfigured: !!googleClient,
    engines,
  });
});

/** Wraps a server-side tool: requires sign-in and credits (charged on success), gives the job its own output
 *  folder, refunds the use and reports a readable error if the job fails,
 *  and always cleans up the upload. `job` returns { file, name }. */
function conversionRoute(defaultToolId, job, { acceptBodyToolId = false } = {}) {
  return async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const toolId = (acceptBodyToolId && /^[\w-]{1,40}$/.test(req.body.toolId || '') && req.body.toolId) || defaultToolId;
    const email = getEmailFromToken(req);
    if (!email || !users[email]) {
      fs.remove(req.file.path).catch(() => {});
      return res.status(401).json({ error: 'Please sign in with Google to use this tool.', code: 'signin_required' });
    }
    const quote = creditQuote(email, toolId);
    if (!quote.ok) { fs.remove(req.file.path).catch(() => {}); return res.status(402).json(outOfCredits(quote, toolId)); }
    const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
    try {
      await fs.ensureDir(sessionDir);
      const { file, name } = await job(req, sessionDir);
      // Charged only once the conversion worked, so a failure costs nothing.
      if (!(await fs.pathExists(file))) throw new Error('Conversion produced no output.');
      const { balance } = chargeCredits(email, toolId);
      res.set('X-Credits-Balance', String(balance));
      await sendFileAndCleanup(res, file, name);
    } catch (e) {
      console.error(`[Convert:${toolId}]`, e.message);
      const status = e.status || (e.notFound ? 503 : 500);
      if (!res.headersSent) res.status(status).json({ error: e.publicMessage || e.message });
    } finally {
      fs.remove(req.file.path).catch(() => {});
      setTimeout(() => fs.remove(sessionDir).catch(() => {}), 60_000);
    }
  };
}

const isPdfUpload = req => path.extname(req.file.originalname || '').toLowerCase() === '.pdf' || req.file.mimetype === 'application/pdf';
function requirePdf(req) {
  if (!isPdfUpload(req)) throw Object.assign(new Error('Please upload a PDF file.'), { status: 400 });
}

app.post('/api/convert/to-pdf', upload.single('file'), conversionRoute('to-pdf', async (req, dir) => {
  // HTML opens in Writer/Web, which needs its own PDF export filter.
  const html = /\.html?$/i.test(req.file.originalname || '');
  return {
    file: await libreOfficeConvert(req.file.path, dir, html ? 'pdf:writer_web_pdf_Export' : 'pdf'),
    name: `${baseName(req.file)}.pdf`,
  };
}, { acceptBodyToolId: true }));

/* PDF → PDF/A-2b via Ghostscript (embeds fonts, converts colour to sRGB).
   PDF/A requires an output intent, so we write a small PostScript prologue
   that attaches Ghostscript's own sRGB ICC profile. */
const SRGB_ICC = ['/usr/share/color/icc/ghostscript/srgb.icc', '/usr/share/ghostscript/iccprofiles/srgb.icc', '/usr/local/share/ghostscript/iccprofiles/srgb.icc']
  .find(p => fs.existsSync(p));
app.post('/api/convert/pdf-to-pdfa', upload.single('file'), conversionRoute('pdfa', async (req, dir) => {
  requirePdf(req);
  if (!SRGB_ICC) throw Object.assign(new Error('PDF/A conversion is not available on this server yet.'), { status: 503 });
  const out = path.join(dir, 'pdfa.pdf');
  const def = path.join(dir, 'PDFA_def.ps');
  await fs.writeFile(def, `%!
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} <</N 3>> /PUT pdfmark
[{icc_PDFA} (${SRGB_ICC}) (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} <</Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB)>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
`);
  await run('gs', ['-q', '-dPDFA=2', '-dBATCH', '-dNOPAUSE', '-dNOOUTERSAVE', '-sColorConversionStrategy=RGB',
    '-dPDFACompatibilityPolicy=1', `--permit-file-read=${SRGB_ICC}`, '-sDEVICE=pdfwrite', `-sOutputFile=${out}`, def, req.file.path]);
  return { file: out, name: `${baseName(req.file)}_pdfa.pdf` };
}));

/* PDF → Word: pdf2docx rebuilds real paragraphs/tables; LibreOffice's PDF
   import (text boxes only) is the fallback if Python isn't available. */
app.post('/api/convert/pdf-to-docx', upload.single('file'), conversionRoute('pdf2word', async (req, dir) => {
  requirePdf(req);
  const out = path.join(dir, `${baseName(req.file)}.docx`);
  try {
    await pythonConvert('docx', req.file.path, out);
  } catch (e) {
    console.warn('[pdf2word] pdf2docx failed, falling back to LibreOffice:', e.message);
    await libreOfficeConvert(req.file.path, dir, 'docx:MS Word 2007 XML', 'writer_pdf_import');
    const loOut = path.join(dir, `${path.basename(req.file.path, path.extname(req.file.path))}.docx`);
    await fs.move(loOut, out, { overwrite: true });
  }
  return { file: out, name: `${baseName(req.file)}.docx` };
}));

/* PDF → Excel: table extraction per page (LibreOffice can't do this at all). */
app.post('/api/convert/pdf-to-xlsx', upload.single('file'), conversionRoute('pdf2excel', async (req, dir) => {
  requirePdf(req);
  const out = path.join(dir, `${baseName(req.file)}.xlsx`);
  await pythonConvert('xlsx', req.file.path, out);
  return { file: out, name: `${baseName(req.file)}.xlsx` };
}));

app.post('/api/convert/pdf-to-pptx', upload.single('file'), conversionRoute('pdf2ppt', async (req, dir) => {
  requirePdf(req);
  return {
    file: await libreOfficeConvert(req.file.path, dir, 'pptx', 'impress_pdf_import'),
    name: `${baseName(req.file)}.pptx`,
  };
}));

app.post('/api/repair', upload.single('file'), conversionRoute('repair', async (req, dir) => {
  requirePdf(req);
  const out = path.join(dir, 'repaired.pdf');
  // qpdf rebuilds broken xref tables/streams; Ghostscript re-renders what qpdf can't.
  try {
    await run('qpdf', [req.file.path, out]);
  } catch (e) {
    // qpdf exits 3 when it repaired the file with warnings — that output is what we want.
    if (!(await fs.pathExists(out))) await run('gs', ['-q', '-o', out, '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress', req.file.path]);
  }
  return { file: out, name: `${baseName(req.file)}_repaired.pdf` };
}));

/* Compress: Ghostscript image downsampling at three strengths. If the result
   isn't smaller (already-optimised files), the original is returned. */
const COMPRESS_LEVELS = { low: '/printer', recommended: '/ebook', extreme: '/screen' };
app.post('/api/compress', upload.single('file'), conversionRoute('compress', async (req, dir) => {
  requirePdf(req);
  const level = COMPRESS_LEVELS[req.body.level] ? req.body.level : 'recommended';
  const out = path.join(dir, 'compressed.pdf');
  await run('gs', ['-q', '-o', out, '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${COMPRESS_LEVELS[level]}`,
    '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true', req.file.path]);
  const [orig, comp] = await Promise.all([fs.stat(req.file.path), fs.stat(out)]);
  const file = comp.size < orig.size ? out : req.file.path;
  if (file === req.file.path) await fs.copy(req.file.path, out); // upload is deleted in finally
  return { file: out, name: `${baseName(req.file)}_compressed.pdf` };
}));

/* Protect / Unlock: real AES-256 encryption via qpdf (pdf-lib can't encrypt,
   and "unlocking" in the browser produced unreadable files). */
app.post('/api/protect', upload.single('file'), conversionRoute('protect', async (req, dir) => {
  requirePdf(req);
  const password = String(req.body.password || '');
  if (password.length < 4) throw Object.assign(new Error('Choose a password of at least 4 characters.'), { status: 400 });
  const out = path.join(dir, 'protected.pdf');
  await run('qpdf', ['--encrypt', password, password, '256', '--', req.file.path, out]);
  return { file: out, name: `${baseName(req.file)}_protected.pdf` };
}));

app.post('/api/unlock', upload.single('file'), conversionRoute('unlock', async (req, dir) => {
  requirePdf(req);
  const out = path.join(dir, 'unlocked.pdf');
  try {
    await run('qpdf', [`--password=${String(req.body.password || '')}`, '--decrypt', req.file.path, out]);
  } catch (e) {
    if (/invalid password/i.test(e.message)) throw Object.assign(new Error('That password is incorrect. Enter the password used to open this PDF.'), { status: 400 });
    if (!e.notFound && fs.existsSync(out)) return { file: out, name: `${baseName(req.file)}_unlocked.pdf` }; // warnings only
    throw e;
  }
  return { file: out, name: `${baseName(req.file)}_unlocked.pdf` };
}));

/* ── SPA catch-all ── */
// Unknown paths get a real 404 (the app still loads and shows the home page), so
// old or mistyped URLs drop out of Google instead of piling up as copies of "/".
app.get('*', (req, res) => {
  res.status(404).set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Error handler ── */
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large. Maximum ${Number(process.env.MAX_FILE_SIZE_MB) || 256} MB.` });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

/* ── Cron: purge old temp files + expired tokens/OTPs/usage rows ── */
cron.schedule('*/30 * * * *', async () => {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  for (const dir of [UPLOADS_DIR, OUTPUTS_DIR]) {
    try {
      for (const entry of await fs.readdir(dir)) {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && (Date.now() - stat.mtimeMs) > TWO_HOURS) await fs.remove(full).catch(() => {});
      }
    } catch {}
  }
  const now = Date.now();
  const tokenCount = Object.keys(tokens).length;
  Object.keys(tokens).forEach(t => { if (tokens[t].expires < now) delete tokens[t]; });
  if (Object.keys(tokens).length !== tokenCount) saveTokens();

});

/* ── Start ── */
app.listen(PORT, () => {
  // Tell Bing about new pages and guides once the site is up (production only).
  if (process.env.NODE_ENV === 'production' && process.env.INDEXNOW !== 'off') {
    setTimeout(() => indexNow.ping(seo.sitemapUrls())
      .then(r => r.sent && console.log(`[indexnow] sent ${r.sent} URLs`))
      .catch(e => console.warn(`[indexnow] ${e.message}`)), 30000);
  }
  console.log(`
╔══════════════════════════════════════════════════════╗
║        LetsConvertPDF — Server v2.3                  ║
║        Maqsusi Digital Industries Software           ║
╠══════════════════════════════════════════════════════╣
║  URL  : http://localhost:${PORT}                        ║
║  Email : ${transporter ? '✓ SMTP ready — ' + process.env.EMAIL_USER : '✗ NOT configured — contact form messages are only logged'}
║  Google: ${googleClient ? '✓ Sign-In ready' : '✗ Not configured — "Continue with Google" returns 501'}
║  Mode  : ${process.env.NODE_ENV || 'development'}                             ║
║  Credits: ${settings.startingCredits} to start · ${settings.costPerUse} per use · admins: ${ADMIN_EMAILS.length}
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
