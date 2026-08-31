/**
 * LetsConvertPDF — Server v2.1
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
const { exec }     = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cron         = require('node-cron');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch { console.warn('[Email] nodemailer not installed — run: npm install nodemailer'); }

let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch { console.warn('[Security] express-rate-limit not installed — run: npm install express-rate-limit'); }

const app  = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(os.tmpdir(), 'letsconvertpdf', 'uploads');
const OUTPUTS_DIR = path.join(os.tmpdir(), 'letsconvertpdf', 'outputs');
const USERS_FILE  = path.join(os.tmpdir(), 'letsconvertpdf', 'users.json');
const USAGE_FILE  = path.join(os.tmpdir(), 'letsconvertpdf', 'usage.json');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(OUTPUTS_DIR);

/* Trust the first hop of a reverse proxy (Nginx/Caddy) so req.ip reflects the
   real client address rather than the proxy's. Configurable via TRUST_PROXY
   for deployments behind more than one proxy hop (e.g. a CDN + LB). */
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

/* ─── Auth state (in-memory + file persistence) ─── */
let users  = {};  // { email: { name, passwordHash, salt, verified, premium, createdAt } }
let otps   = {};  // { email: { code, expires, purpose } }
let tokens = {};  // { token: { email, expires } }

try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch {}

const saveUsers = () => {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch {}
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

async function sendEmail(to, subject, textBody, htmlBody) {
  if (!transporter) {
    console.log(`\n[Email stub] ─────────────────────────\nTo: ${to}\nSubject: ${subject}\n${textBody}\n──────────────────────────────────────\n`);
    return;
  }
  await transporter.sendMail({
    from: `"LetsConvertPDF" <${process.env.EMAIL_USER}>`,
    to, subject, text: textBody, html: htmlBody,
  });
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
      scriptSrc:  ["'self'","'unsafe-inline'","'unsafe-eval'",'cdn.tailwindcss.com','unpkg.com','cdnjs.cloudflare.com','fonts.googleapis.com'],
      styleSrc:   ["'self'","'unsafe-inline'",'fonts.googleapis.com','cdn.tailwindcss.com'],
      fontSrc:    ["'self'",'fonts.gstatic.com','data:'],
      imgSrc:     ["'self'",'data:','blob:'],
      connectSrc: ["'self'"],
      workerSrc:  ["'self'",'blob:','cdnjs.cloudflare.com'],
    },
  },
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
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported type: ${file.mimetype}`));
  },
});

/* ─── LibreOffice helper ─── */
function libreOfficeConvert(inputPath, outputDir, targetFormat) {
  return new Promise((resolve, reject) => {
    const cmd = `libreoffice --headless --convert-to ${targetFormat} "${inputPath}" --outdir "${outputDir}"`;
    exec(cmd, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`LibreOffice conversion failed: ${stderr || err.message}`));
      resolve(path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.${targetFormat}`));
    });
  });
}

async function sendFileAndCleanup(res, filePath, downloadName) {
  try {
    res.download(filePath, downloadName, async err => {
      if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
      setTimeout(() => fs.remove(filePath).catch(() => {}), 30_000);
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

  try { await sendEmail(email, 'Verify your LetsConvertPDF account', `Your verification code is: ${code}`, otpEmailHTML(code, 'register')); }
  catch (e) { console.error('[Email error]', e.message); }

  res.json({ message: 'Account created. Check your email for the verification code.', email: key });
});

/* Login */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const key = email?.toLowerCase();
  const user = users[key];
  if (!user || hashPassword(password, user.salt) !== user.passwordHash)
    return res.status(401).json({ error: 'Invalid email or password.' });

  const code = generateOTP();
  otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: 'login' };

  try { await sendEmail(email, 'Your LetsConvertPDF login code', `Your login code is: ${code}`, otpEmailHTML(code, 'login')); }
  catch (e) { console.error('[Email error]', e.message); }

  res.json({ message: 'Login code sent to your email.', email: key, name: user.name });
});

/* Verify OTP */
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  const key = email?.toLowerCase();
  const otp = otps[key];
  if (!otp) return res.status(400).json({ error: 'No pending verification. Please start again.' });
  if (Date.now() > otp.expires) { delete otps[key]; return res.status(400).json({ error: 'Code expired. Please request a new one.' }); }
  if (otp.code !== String(code).trim()) return res.status(400).json({ error: 'Incorrect code. Please try again.' });

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
  try { await sendEmail(email, 'Your new LetsConvertPDF code', `Your new code is: ${code}`, otpEmailHTML(code, purpose || 'login')); } catch {}
  res.json({ message: 'New code sent.' });
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
  res.json({ message: 'Logged out' });
});

/* Google OAuth stub — wire up real credentials when ready */
app.post('/api/auth/google', (req, res) => {
  res.status(501).json({
    error: 'Google OAuth is not configured yet.',
    hint: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then install google-auth-library.',
  });
});

/* Forgot password */
app.post('/api/auth/forgot-password', async (req, res) => {
  const key = req.body.email?.toLowerCase();
  if (users[key]) {
    const code = generateOTP();
    otps[key] = { code, expires: Date.now() + 10 * 60 * 1000, purpose: 'reset' };
    try { await sendEmail(key, 'Reset your LetsConvertPDF password', `Your reset code is: ${code}`, otpEmailHTML(code, 'reset')); } catch {}
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
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0A1628;padding:40px"><div style="max-width:560px;margin:0 auto;background:#162C56;border-radius:16px;padding:32px;color:#E2E8F0"><h2 style="color:#60A5FA;margin-top:0">💬 New Chat Message</h2><p><strong>From:</strong> ${name}</p><p><strong>Reply to:</strong> <a href="mailto:${email}" style="color:#60A5FA">${email}</a></p><hr style="border-color:rgba(255,255,255,0.1)"/><div style="background:#0A1628;border-radius:8px;padding:16px;margin-top:16px">${message.replace(/\n/g,'<br>')}</div><hr style="border-color:rgba(255,255,255,0.1);margin-top:24px"/><p style="color:#475569;font-size:12px">Via LetsConvertPDF Chat</p></div></body></html>`;

  try {
    if (adminEmail) {
      await sendEmail(adminEmail, `[LetsConvertPDF Chat] Message from ${name}`, `From: ${name} <${email}>\n\n${message}`, html);
    } else {
      console.log(`[Chat stub] From: ${name} <${email}>\n${message}`);
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'LetsConvertPDF API', version: '2.1.0', timestamp: new Date().toISOString() });
});

app.post('/api/convert/to-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const toolId = req.body.toolId || 'to-pdf';
  const usageResult = enforceUsageOrReject(req, res, toolId);
  if (!usageResult) return;
  const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
  try {
    await fs.ensureDir(sessionDir);
    const outFile = await libreOfficeConvert(req.file.path, sessionDir, 'pdf');
    await sendFileAndCleanup(res, outFile, `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.pdf`);
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'Ensure LibreOffice is installed.' });
  } finally {
    fs.remove(req.file.path).catch(() => {});
    setTimeout(() => fs.remove(sessionDir).catch(() => {}), 60_000);
  }
});

app.post('/api/convert/pdf-to-docx', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const usageResult = enforceUsageOrReject(req, res, 'pdf2word');
  if (!usageResult) return;
  const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
  try {
    await fs.ensureDir(sessionDir);
    const outFile = await libreOfficeConvert(req.file.path, sessionDir, 'docx');
    await sendFileAndCleanup(res, outFile, `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.docx`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.remove(req.file.path).catch(() => {});
    setTimeout(() => fs.remove(sessionDir).catch(() => {}), 60_000);
  }
});

app.post('/api/convert/pdf-to-xlsx', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const usageResult = enforceUsageOrReject(req, res, 'pdf2excel');
  if (!usageResult) return;
  const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
  try {
    await fs.ensureDir(sessionDir);
    const outFile = await libreOfficeConvert(req.file.path, sessionDir, 'xlsx');
    await sendFileAndCleanup(res, outFile, `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.xlsx`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.remove(req.file.path).catch(() => {});
    setTimeout(() => fs.remove(sessionDir).catch(() => {}), 60_000);
  }
});

app.post('/api/convert/pdf-to-pptx', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const usageResult = enforceUsageOrReject(req, res, 'pdf2ppt');
  if (!usageResult) return;
  const sessionDir = path.join(OUTPUTS_DIR, uuidv4());
  try {
    await fs.ensureDir(sessionDir);
    const outFile = await libreOfficeConvert(req.file.path, sessionDir, 'pptx');
    await sendFileAndCleanup(res, outFile, `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.pptx`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.remove(req.file.path).catch(() => {});
    setTimeout(() => fs.remove(sessionDir).catch(() => {}), 60_000);
  }
});

app.post('/api/repair', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const usageResult = enforceUsageOrReject(req, res, 'repair');
  if (!usageResult) return;
  const outPath = path.join(OUTPUTS_DIR, `${uuidv4()}_repaired.pdf`);
  try {
    await new Promise((resolve, reject) => {
      const cmd = `gs -o "${outPath}" -sDEVICE=pdfwrite -dPDFSETTINGS=/prepress "${req.file.path}"`;
      exec(cmd, { timeout: 120_000 }, (err, _, stderr) => { if (err) reject(new Error(`Ghostscript: ${stderr}`)); else resolve(); });
    });
    await sendFileAndCleanup(res, outPath, `${path.basename(req.file.originalname, '.pdf')}_repaired.pdf`);
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'Ensure Ghostscript (gs) is installed.' });
  } finally {
    fs.remove(req.file.path).catch(() => {});
  }
});

/* ── SPA catch-all ── */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ── Error handler ── */
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large. Maximum ${Number(process.env.MAX_FILE_SIZE_MB) || 256} MB.` });
  res.status(500).json({ error: err.message || 'Internal server error' });
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
  Object.keys(tokens).forEach(t => { if (tokens[t].expires < now) delete tokens[t]; });
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
║        LetsConvertPDF — Server v2.1                  ║
║        Maqsusi Digital Industries Software           ║
╠══════════════════════════════════════════════════════╣
║  URL  : http://localhost:${PORT}                        ║
║  Email: ${process.env.EMAIL_USER ? '✓ ' + process.env.EMAIL_USER : '✗ Not configured (stub mode)'}
║  Mode : ${process.env.NODE_ENV || 'development'}                             ║
║  Free tier: guest ${LIMITS.anonDaily}/tool/day · account ${LIMITS.userDaily}/tool/day
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;