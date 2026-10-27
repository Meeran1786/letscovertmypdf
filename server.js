/**
 * LetsConvertPDF — Server v2.3
 * Maqsusi Digital Industries Software
 *
 * Handles:
 *  - Static SPA serving
 *  - File uploads (multer)
 *  - Server-side conversions via LibreOffice
 *  - Auth: register, login, OTP verification, reset-password
 *  - Freemium usage metering: anonymous (by IP) + signed-up (by account), daily reset
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
const USAGE_FILE  = path.join(DATA_DIR, 'usage.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const PYTHON      = process.env.PYTHON_BIN || 'python3';
const PDF_CONVERT = path.join(__dirname, 'converters', 'pdf_convert.py');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(OUTPUTS_DIR);
fs.ensureDirSync(DATA_DIR);

/* Trust the first hop of a reverse proxy (Nginx/Caddy) so req.ip reflects the
   real client address rather than the proxy's. Configurable via TRUST_PROXY
   for deployments behind more than one proxy hop (e.g. a CDN + LB). */
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

/* ─── Auth state (in-memory + file persistence) ─── */
let users  = {};  // { email: { name, passwordHash, salt, verified, premium, createdAt } }
let otps   = {};  // { email: { code, expires, purpose } }
let tokens = {};  // { token: { email, expires } }

try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch {}
try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch {}

const saveUsers = () => {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) { console.error('[Data] Could not save users:', e.message); }
};
// Sessions are persisted too, so a server restart or redeploy doesn't sign everyone out.
const saveTokens = () => {
  try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens)); } catch (e) { console.error('[Data] Could not save sessions:', e.message); }
};

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
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
  return entry.email;
}

/* ═══════════════════════════════════════════
   FREEMIUM USAGE METERING
   - Anonymous visitors: identified by IP, 1 use / tool / day.
   - Signed-up (free) users: identified by account email, 3 uses / tool / day.
   - A user's `premium` flag (reserved for a future paid tier) bypasses the cap.
   Both tiers reset on a rolling UTC-day boundary.
═══════════════════════════════════════════ */
const LIMITS = {
  anonDaily: Number(process.env.FREE_ANON_DAILY_LIMIT) || 1,
  userDaily: Number(process.env.FREE_USER_DAILY_LIMIT) || 3,
};

let usage = {}; // { "user:email:toolId:2026-08-31": { count, day } }
try { usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch {}

const saveUsage = () => {
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2)); } catch {}
};

function todayStr() {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}
function getClientIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:/, '');
}
function resolveIdentity(req) {
  const email = getEmailFromToken(req);
  if (email && users[email]) return { type: 'user', id: email };
  return { type: 'anon', id: getClientIp(req) };
}
function getLimitFor(identity) {
  if (identity.type === 'user') {
    const u = users[identity.id];
    if (u && u.premium) return Infinity;
    return LIMITS.userDaily;
  }
  return LIMITS.anonDaily;
}
function usageKey(identity, toolId, day) {
  return `${identity.type}:${identity.id}:${toolId}:${day}`;
}
function readUsage(req, toolId) {
  const identity = resolveIdentity(req);
  const limit = getLimitFor(identity);
  const day = todayStr();
  const key = usageKey(identity, toolId, day);
  const used = usage[key]?.count || 0;
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  return { identity, limit, used, remaining, day, key };
}
/** Attempts to consume one unit of usage for (identity, toolId) today.
 *  Returns { ok, limit, used, remaining, identity } — does NOT throw. */
function tryConsume(req, toolId) {
  const info = readUsage(req, toolId);
  if (info.limit !== Infinity && info.used >= info.limit) {
    return { ok: false, ...info };
  }
  const nextUsed = info.used + 1;
  usage[info.key] = { count: nextUsed, day: info.day };
  saveUsage();
  const remaining = info.limit === Infinity ? Infinity : Math.max(0, info.limit - nextUsed);
  return { ok: true, ...info, used: nextUsed, remaining };
}
/** Gives back a unit spent by tryConsume when the conversion itself failed,
 *  so a server-side error doesn't eat the user's daily allowance. */
function refundUsage(result) {
  if (!result?.ok || result.limit === Infinity) return;
  const row = usage[result.key];
  if (row && row.count > 0) { row.count -= 1; saveUsage(); }
}
function usageResponsePayload(info, toolId) {
  return {
    toolId,
    tier: info.identity.type === 'user' ? 'free_account' : 'anonymous',
    limit: info.limit === Infinity ? null : info.limit,
    used: info.used,
    remaining: info.remaining === Infinity ? null : info.remaining,
    resetsAt: `${info.day}T23:59:59.999Z`,
    isAuthenticated: info.identity.type === 'user',
  };
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

function otpEmailHTML(code, purpose) {
  const label = { register: 'Verify your account', login: 'Login code', reset: 'Reset your password' }[purpose] || 'Verification code';
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0A1628;padding:40px"><div style="max-width:480px;margin:0 auto;background:#162C56;border-radius:16px;padding:32px;color:#E2E8F0"><h2 style="color:#60A5FA;margin-top:0">LetsConvertPDF</h2><h3 style="color:#fff">${label}</h3><p style="color:#94A3B8">Your one-time code is:</p><div style="background:#0A1628;border-radius:12px;padding:24px;text-align:center;margin:24px 0"><span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#3B82F6">${code}</span></div><p style="color:#94A3B8;font-size:14px">Valid for <strong>10 minutes</strong>. Do not share this code.</p><hr style="border-color:rgba(255,255,255,0.1)"/><p style="color:#475569;font-size:12px">Maqsusi Digital Industries Software</p></div></body></html>`;
}

/* ─── Middleware ─── */
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","'unsafe-inline'","'unsafe-eval'",'cdn.tailwindcss.com','unpkg.com','cdnjs.cloudflare.com','fonts.googleapis.com','https://accounts.google.com/gsi/client'],
      // Google's sign-in button loads its own stylesheet; blocking it left the button unstyled/broken.
      styleSrc:   ["'self'","'unsafe-inline'",'fonts.googleapis.com','cdn.tailwindcss.com','https://accounts.google.com/gsi/style'],
      fontSrc:    ["'self'",'fonts.gstatic.com','data:'],
      imgSrc:     ["'self'",'data:','blob:','https://*.googleusercontent.com'],
      connectSrc: ["'self'",'https://accounts.google.com','cdnjs.cloudflare.com','unpkg.com'],
      frameSrc:   ["'self'",'https://accounts.google.com'],
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
      'image/jpeg','image/png','image/gif','image/webp','image/tiff','image/bmp',
    ];
    // Browsers often send Office files as application/octet-stream (or an
    // empty type), so fall back to the file extension before rejecting.
    const allowedExt = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.rtf','.jpg','.jpeg','.png','.gif','.webp','.tif','.tiff','.bmp'];
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

/** Shared guard for server-side conversion routes: consumes one unit of the
 *  caller's freemium quota for `toolId` before any processing happens.
 *  On rejection, cleans up the uploaded temp file and replies 429. */
function enforceUsageOrReject(req, res, toolId) {
  const result = tryConsume(req, toolId);
  res.set('X-RateLimit-Limit', result.limit === Infinity ? 'unlimited' : String(result.limit));
  res.set('X-RateLimit-Remaining', result.remaining === Infinity ? 'unlimited' : String(result.remaining));
  if (!result.ok) {
    if (req.file) fs.remove(req.file.path).catch(() => {});
    res.status(429).json({
      error: result.identity.type === 'user'
        ? `You've used all ${result.limit} free daily uses of this tool. Your quota resets at midnight UTC.`
        : `You've used your ${result.limit} free daily use of this tool as a guest. Sign up free for ${LIMITS.userDaily} uses per tool per day.`,
      usage: usageResponsePayload(result, toolId),
    });
    return null;
  }
  return result;
}

/* ═══════════════════════════════════════════
   USAGE / FREEMIUM ROUTES
═══════════════════════════════════════════ */

/* Check current quota for a tool without consuming it */
app.get('/api/usage/status', (req, res) => {
  const toolId = String(req.query.toolId || '').trim();
  if (!toolId) return res.status(400).json({ error: 'toolId query parameter is required.' });
  const info = readUsage(req, toolId);
  res.json(usageResponsePayload(info, toolId));
});

/* Consume one unit of quota — used by client-side tools before local processing */
app.post('/api/usage/consume', (req, res) => {
  const toolId = String(req.body?.toolId || '').trim();
  if (!toolId) return res.status(400).json({ error: 'toolId is required.' });
  const result = tryConsume(req, toolId);
  if (!result.ok) {
    return res.status(429).json({
      error: result.identity.type === 'user'
        ? `You've used all ${result.limit} free daily uses of this tool. Your quota resets at midnight UTC.`
        : `You've used your ${result.limit} free daily use of this tool as a guest. Sign up free for ${LIMITS.userDaily} uses per tool per day.`,
      usage: usageResponsePayload(result, toolId),
    });
  }
  res.json(usageResponsePayload(result, toolId));
});

/* ═══════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════ */

/* Register */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const key = email.toLowerCase();
  if (users[key]) return res.status(409).json({ error: 'An account with this email already exists.' });

  const salt = crypto.randomBytes(16).toString('hex');
  users[key] = { name, passwordHash: hashPassword(password, salt), salt, verified: false, premium: false, createdAt: new Date().toISOString() };
  saveUsers();

  const code = generateOTP();
  otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: 'register' };

  let emailSent = false;
  try { emailSent = await sendEmail(email, 'Verify your LetsConvertPDF account', `Your verification code is: ${code}`, otpEmailHTML(code, 'register')); }
  catch (e) { console.error('[Email error] register:', e.message); }

  res.json({
    message: emailSent
      ? 'Account created. Check your email for the verification code.'
      : "Account created, but we couldn't deliver the verification email just now. Tap \"Resend code\" in a moment, or contact support if this keeps happening.",
    email: key,
    emailSent,
  });
});

/* Login */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const key = email?.toLowerCase();
  const user = users[key];
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
  if (!user.passwordHash) return res.status(401).json({ error: 'This account was created with Google Sign-In. Use "Continue with Google" to log in.' });
  if (hashPassword(password, user.salt) !== user.passwordHash)
    return res.status(401).json({ error: 'Invalid email or password.' });

  const code = generateOTP();
  otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: 'login' };

  let emailSent = false;
  try { emailSent = await sendEmail(email, 'Your LetsConvertPDF login code', `Your login code is: ${code}`, otpEmailHTML(code, 'login')); }
  catch (e) { console.error('[Email error] login:', e.message); }

  res.json({
    message: emailSent
      ? 'Login code sent to your email.'
      : "We couldn't deliver your login code just now. Tap \"Resend code\" in a moment, or contact support if this keeps happening.",
    email: key,
    name: user.name,
    emailSent,
  });
});

/* Verify OTP */
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  const key = email?.toLowerCase();
  const otp = otps[key];
  if (!otp) return res.status(400).json({ error: 'No pending verification. Please start again.' });
  if (Date.now() > otp.expires) { delete otps[key]; return res.status(400).json({ error: 'Code expired. Please request a new one.' }); }
  if (otp.code !== String(code).trim()) return res.status(400).json({ error: 'Incorrect code. Please try again.' });

  // A reset code is only checked here; it's consumed by /reset-password, which
  // needs it again. Consuming it here made every password reset fail.
  if (otp.purpose === 'reset') return res.json({ verified: true });

  delete otps[key];
  if (users[key]) { users[key].verified = true; saveUsers(); }

  const token = createToken(key);
  res.json({ token, user: { email: key, name: users[key]?.name || '' } });
});

/* Resend OTP */
app.post('/api/auth/resend-otp', async (req, res) => {
  const { email, purpose } = req.body;
  const key = email?.toLowerCase();
  if (!users[key]) return res.status(404).json({ error: 'No account found.' });
  const code = generateOTP();
  otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: purpose || 'login' };
  let emailSent = false;
  try { emailSent = await sendEmail(email, 'Your new LetsConvertPDF code', `Your new code is: ${code}`, otpEmailHTML(code, purpose || 'login')); }
  catch (e) { console.error('[Email error] resend-otp:', e.message); }
  res.json({
    message: emailSent ? 'New code sent.' : "We couldn't deliver that email just now. Please try again shortly.",
    emailSent,
  });
});

/* Session check */
app.get('/api/auth/me', (req, res) => {
  const email = getEmailFromToken(req);
  if (!email || !users[email]) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: { email, name: users[email].name, premium: !!users[email].premium } });
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
  if (!users[key]) {
    users[key] = {
      name: payload.name || key.split('@')[0],
      passwordHash: null, // Google-only account — no local password
      salt: null,
      verified: true,     // Google already verified this email
      premium: false,
      authProvider: 'google',
      createdAt: new Date().toISOString(),
    };
  } else if (!users[key].verified) {
    users[key].verified = true;
  }
  saveUsers();

  const token = createToken(key);
  res.json({ token, user: { email: key, name: users[key].name } });
});

/* Forgot password */
app.post('/api/auth/forgot-password', async (req, res) => {
  const key = req.body.email?.toLowerCase();
  if (users[key]) {
    const code = generateOTP();
    otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: 'reset' };
    try { await sendEmail(key, 'Reset your LetsConvertPDF password', `Your reset code is: ${code}`, otpEmailHTML(code, 'reset')); }
    catch (e) { console.error('[Email error] forgot-password:', e.message); }
    // Note: the response below stays identical whether the account exists or the
    // send failed, by design — revealing either would let an attacker enumerate
    // registered emails. Check server logs / GET /api/health to confirm SMTP health.
  }
  res.json({ message: 'If an account exists with that email, a reset code has been sent.', email: key });
});

/* Reset password */
app.post('/api/auth/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  const key = email?.toLowerCase();
  const otp = otps[key];
  if (!otp || otp.purpose !== 'reset') return res.status(400).json({ error: 'No pending reset for this email.' });
  if (Date.now() > otp.expires) { delete otps[key]; return res.status(400).json({ error: 'Reset code expired.' }); }
  if (otp.code !== String(code).trim()) return res.status(400).json({ error: 'Incorrect code.' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (!users[key]) return res.status(404).json({ error: 'No account found.' });
  delete otps[key];
  const salt = crypto.randomBytes(16).toString('hex');
  users[key].passwordHash = hashPassword(newPassword, salt);
  users[key].salt = salt;
  saveUsers();
  res.json({ message: 'Password reset successfully. You can now log in.' });
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
    version: '2.3.0',
    timestamp: new Date().toISOString(),
    // Booleans only — never exposes credentials — so ops can confirm config
    // via a plain curl instead of grepping server logs or SSHing in.
    emailConfigured: !!transporter,
    googleSignInConfigured: !!googleClient,
    engines,
  });
});

/** Wraps a server-side tool: meters usage, gives the job its own output
 *  folder, refunds the use and reports a readable error if the job fails,
 *  and always cleans up the upload. `job` returns { file, name }. */
function conversionRoute(defaultToolId, job, { acceptBodyToolId = false } = {}) {
  return async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const toolId = (acceptBodyToolId && req.body.toolId) || defaultToolId;
    const usageResult = enforceUsageOrReject(req, res, toolId);
    if (!usageResult) return;
    const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
    try {
      await fs.ensureDir(sessionDir);
      const { file, name } = await job(req, sessionDir);
      await sendFileAndCleanup(res, file, name);
    } catch (e) {
      refundUsage(usageResult);
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

app.post('/api/convert/to-pdf', upload.single('file'), conversionRoute('to-pdf', async (req, dir) => ({
  file: await libreOfficeConvert(req.file.path, dir, 'pdf'),
  name: `${baseName(req.file)}.pdf`,
}), { acceptBodyToolId: true }));

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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
  Object.keys(otps).forEach(e => { if (otps[e].expires < now) delete otps[e]; });

  // Usage rows older than 2 days are no longer needed for any reset window.
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let changed = false;
  Object.keys(usage).forEach(k => {
    const day = usage[k]?.day;
    if (day && day !== today && day !== yesterday) { delete usage[k]; changed = true; }
  });
  if (changed) saveUsage();
});

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        LetsConvertPDF — Server v2.3                  ║
║        Maqsusi Digital Industries Software           ║
╠══════════════════════════════════════════════════════╣
║  URL  : http://localhost:${PORT}                        ║
║  Email : ${transporter ? '✓ SMTP ready — ' + process.env.EMAIL_USER : '✗ NOT configured — OTPs will only print to this log, not send'}
║  Google: ${googleClient ? '✓ Sign-In ready' : '✗ Not configured — "Continue with Google" returns 501'}
║  Mode  : ${process.env.NODE_ENV || 'development'}                             ║
║  Free tier: guest ${LIMITS.anonDaily}/tool/day · account ${LIMITS.userDaily}/tool/day
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
