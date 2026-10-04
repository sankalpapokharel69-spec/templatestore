import { Hono } from 'hono';

/* ============================================================
   WebCraft Studio — Cloudflare Worker API
   Hono + D1 (SQLite) + R2 (files) + KV (rate limiting)
   ============================================================ */

const app = new Hono();
const enc = new TextEncoder();
const ITER = 100000;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const COOKIE = 'wc_session';
const ORDER_STATUSES = ['Pending', 'Paid', 'Rejected', 'Completed'];
const PAYMENT_METHODS = ['esewa', 'khalti', 'bank'];

/* ---------------- tiny utils ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template';
const titleCase = (s) => s.replace(/(^|[-_])([a-z])/g, (_, p, c) => (p ? ' ' : '') + c.toUpperCase());
const nowSec = () => Math.floor(Date.now() / 1000);
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hashCode = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/* ---------------- password hashing (PBKDF2-SHA256, salted) ---------------- */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function verifyPassword(password, stored) {
  try {
    const [, iterStr, saltHex, hashHex] = String(stored).split('$');
    const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: parseInt(iterStr, 10), hash: 'SHA-256' }, key, 256);
    return hex(new Uint8Array(bits)) === hashHex;
  } catch { return false; }
}

/* ---------------- JWT (HS256, HttpOnly cookie) ---------------- */
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (obj) => b64u(enc.encode(JSON.stringify(obj)));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}
async function signJWT(payload, secret) {
  const h = b64uJson({ alg: 'HS256', typ: 'JWT' });
  const p = b64uJson(payload);
  const sig = b64u(await hmac(secret, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${sig}`;
}
async function verifyJWT(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = b64u(await hmac(secret, enc.encode(`${h}.${p}`)));
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    if (payload.exp && payload.exp < nowSec()) return null;
    return payload;
  } catch { return null; }
}

/* ---------------- session helpers ---------------- */
function sessionCookieHeader(token, env) {
  const same = env.COOKIE_SAMESITE || 'Lax';
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=${same}; Max-Age=${SESSION_MAX_AGE}`;
}
function clearedCookieHeader(env) {
  const same = env.COOKIE_SAMESITE || 'Lax';
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=${same}; Max-Age=0`;
}
function getCookieValue(c) {
  const m = (c.req.header('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
async function currentUser(c) {
  if (!c.env.JWT_SECRET) return null;
  const payload = await verifyJWT(getCookieValue(c), c.env.JWT_SECRET);
  if (!payload) return null;
  return (await c.env.DB.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
    .bind(payload.sub).first().catch(() => null)) || null;
}
function requireUser(c) { return currentUser(c); } // returns null when not signed in

/* ---------------- rate limiting (KV, best-effort) ---------------- */
async function rateLimit(c, name, limit, windowSec) {
  if (!c.env.RATE_LIMIT) return true;
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${name}:${ip}:${bucket}`;
  try {
    const cur = parseInt((await c.env.RATE_LIMIT.get(key)) || '0', 10);
    if (cur >= limit) return false;
    await c.env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: Math.max(60, windowSec * 2) });
    return true;
  } catch { return true; }
}

/* ---------------- payment instructions ---------------- */
function paymentInfo(env) {
  return {
    esewa: {
      label: 'eSewa',
      instructions: `Open your eSewa app and send the exact total to eSewa ID: ${env.PAYMENT_ESEWA_ID || '9800000000'}. Take a screenshot of the successful transfer, then upload it as payment proof.`,
    },
    khalti: {
      label: 'Khalti',
      instructions: `Open your Khalti app and send the exact total to Khalti ID: ${env.PAYMENT_KHALTI_ID || '98XXXXXXXX'}. Take a screenshot of the successful transfer, then upload it as payment proof.`,
    },
    bank: {
      label: 'Bank Transfer',
      instructions: `Deposit the exact total to our bank account:\n${env.PAYMENT_BANK_INFO || 'Nabil Bank — WebCraft Studio — 1234567890'}\nKeep your deposit slip or transfer receipt, then upload a photo of it as payment proof.`,
    },
  };
}

/* ---------------- on-the-fly SVG preview generator ---------------- */
function generateSvg(key) {
  const base = key.split('/').pop().replace(/\.svg$/, '');
  const label = titleCase(base.replace(/-\d+$/, ''));
  const h = hashCode(key);
  const hue = h % 360;
  const hue2 = (hue + 45) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-label="${escXml(label)} template preview">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,92%)"/><stop offset="1" stop-color="hsl(${hue2},70%,86%)"/></linearGradient>
<linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},75%,55%)"/><stop offset="1" stop-color="hsl(${hue2},75%,45%)"/></linearGradient>
</defs>
<rect width="1200" height="800" fill="url(#bg)"/>
<circle cx="1050" cy="120" r="180" fill="hsl(${hue2},70%,80%)" opacity="0.5"/>
<circle cx="120" cy="720" r="220" fill="hsl(${hue},70%,80%)" opacity="0.4"/>
<rect x="150" y="110" width="900" height="580" rx="18" fill="#ffffff" opacity="0.95"/>
<rect x="150" y="110" width="900" height="56" rx="18" fill="#e8eaf2"/>
<rect x="150" y="148" width="900" height="18" fill="#e8eaf2"/>
<circle cx="184" cy="138" r="7" fill="#ff5f57"/><circle cx="208" cy="138" r="7" fill="#febc2e"/><circle cx="232" cy="138" r="7" fill="#28c840"/>
<rect x="190" y="210" width="380" height="26" rx="13" fill="url(#hero)" opacity="0.85"/>
<rect x="190" y="258" width="300" height="14" rx="7" fill="#d6dae8"/>
<rect x="190" y="284" width="260" height="14" rx="7" fill="#d6dae8"/>
<rect x="190" y="330" width="150" height="40" rx="20" fill="url(#hero)"/>
<rect x="640" y="210" width="330" height="220" rx="14" fill="hsl(${hue2},60%,90%)"/>
<rect x="190" y="470" width="250" height="150" rx="12" fill="hsl(${hue},60%,90%)"/>
<rect x="470" y="470" width="250" height="150" rx="12" fill="hsl(${hue2},60%,88%)"/>
<rect x="750" y="470" width="220" height="150" rx="12" fill="hsl(${hue},60%,86%)"/>
<text x="600" y="745" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-size="40" font-weight="700" fill="hsl(${hue},45%,30%)">${escXml(label)}</text>
<text x="600" y="778" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="16" fill="hsl(${hue},30%,45%)">WebCraft Studio — Template Preview</text>
</svg>`;
}

/* ---------------- minimal ZIP writer (stored, no compression) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = 0x5821; // 2024-01-01
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, e.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true); cd.setUint16(10, 0, true); cd.setUint16(12, DOS_TIME, true); cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, cdStart, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of [...chunks, ...central, new Uint8Array(eocd.buffer)]) { out.set(c, pos); pos += c.length; }
  return out;
}
function generateTemplateZip(title) {
  const css = `/* ${title} — base stylesheet */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,Arial,sans-serif;color:#1f2430;background:#fff;line-height:1.6}
.container{max-width:1080px;margin:0 auto;padding:0 24px}
header{display:flex;justify-content:space-between;align-items:center;padding:22px 0}
.logo{font-weight:800;font-size:20px;color:#4f46e5}
nav a{margin-left:18px;color:#1f2430;text-decoration:none;font-size:15px}
.hero{text-align:center;padding:90px 24px;background:linear-gradient(135deg,#eef2ff,#f5f3ff)}
.hero h1{font-size:44px;margin-bottom:14px}
.hero p{color:#5b6478;max-width:560px;margin:0 auto 26px}
.btn{display:inline-block;background:#4f46e5;color:#fff;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:600}
section{padding:70px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}
.card{border:1px solid #e5e8f0;border-radius:14px;padding:26px}
footer{padding:34px 0;text-align:center;color:#9aa3b8;font-size:14px}`;
  const page = (heading, lead) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="container">
<header>
<span class="logo">${title}</span>
<nav><a href="index.html">Home</a><a href="about.html">About</a><a href="contact.html">Contact</a></nav>
</header>
</div>
<div class="hero"><h1>${heading}</h1><p>${lead}</p><a class="btn" href="contact.html">Get in touch</a></div>
<section><div class="container"><div class="grid">
<div class="card"><h3>Fast</h3><p>Clean, lightweight markup that loads instantly.</p></div>
<div class="card"><h3>Responsive</h3><p>Looks great on phones, tablets and desktops.</p></div>
<div class="card"><h3>Yours</h3><p>Edit the content and make it your own.</p></div>
</div></div></section>
<div class="container"><footer>&copy; ${new Date().getFullYear()} ${title}. Crafted with WebCraft Studio.</footer></div>
</body>
</html>`;
  const files = [
    ['index.html', page(`Welcome to ${title}`, 'A beautiful starting point for your next website.')],
    ['about.html', page(`About ${title}`, 'Tell your visitors who you are and what you stand for.')],
    ['contact.html', page(`Contact ${title}`, 'Add your email, phone and social links here.')],
    ['css/style.css', css],
    ['README.txt', `Thank you for purchasing "${title}" from WebCraft Studio!\n\nQuick start:\n1. Unzip this package.\n2. Open index.html in your browser to preview.\n3. Edit the HTML text and css/style.css to customize.\n4. Upload the files to any static host (GitHub Pages, Netlify, Cloudflare Pages...).\n`],
  ];
  return makeZip(files.map(([name, content]) => ({ name, data: enc.encode(content) })));
}

/* ---------------- CORS (locked to configured origins) ---------------- */
app.use('*', async (c, next) => {
  await next();
  const origin = c.req.header('Origin');
  const allowed = (c.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Vary', 'Origin');
  }
});
app.options('*', (c) => c.text('', 204));

/* ---------------- admin guard (registered before admin routes) ---------------- */
app.use('/api/admin/*', async (c, next) => {
  const user = await currentUser(c);
  if (!user) return bad('Authentication required.', 401);
  if (user.role !== 'admin') return bad('Admin access required.', 403);
  c.set('user', user);
  await next();
});

/* ================= AUTH ================= */
app.post('/api/auth/register', async (c) => {
  if (!(await rateLimit(c, 'register', 5, 600))) return bad('Too many attempts. Please try again later.', 429);
  const b = await c.req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  const email = String(b?.email || '').trim().toLowerCase();
  const password = String(b?.password || '');
  if (name.length < 2 || name.length > 80) return bad('Please enter your full name (2-80 characters).');
  if (!validEmail(email)) return bad('Please enter a valid email address.');
  if (password.length < 8 || password.length > 100) return bad('Password must be at least 8 characters.');
  if (!c.env.JWT_SECRET) return bad('Server misconfigured: JWT_SECRET is not set.', 500);
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return bad('An account with this email already exists.', 409);
  const hash = await hashPassword(password);
  const r = await c.env.DB.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .bind(name, email, hash).run();
  const token = await signJWT({ sub: r.meta.last_row_id, iat: nowSec(), exp: nowSec() + SESSION_MAX_AGE }, c.env.JWT_SECRET);
  return json({ user: { id: r.meta.last_row_id, name, email, role: 'customer' } }, 200, { 'Set-Cookie': sessionCookieHeader(token, c.env) });
});

app.post('/api/auth/login', async (c) => {
  if (!(await rateLimit(c, 'login', 10, 300))) return bad('Too many login attempts. Please wait a few minutes.', 429);
  const b = await c.req.json().catch(() => null);
  const email = String(b?.email || '').trim().toLowerCase();
  const password = String(b?.password || '');
  if (!validEmail(email) || !password) return bad('Invalid email or password.', 401);
  const user = await c.env.DB.prepare('SELECT id, name, email, role, password_hash FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) return bad('Invalid email or password.', 401);
  const token = await signJWT({ sub: user.id, iat: nowSec(), exp: nowSec() + SESSION_MAX_AGE }, c.env.JWT_SECRET);
  return json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 200, { 'Set-Cookie': sessionCookieHeader(token, c.env) });
});

app.post('/api/auth/logout', (c) => json({ ok: true }, 200, { 'Set-Cookie': clearedCookieHeader(c.env) }));

app.get('/api/auth/me', async (c) => {
  const user = await currentUser(c);
  return json({ user: user || null });
});

app.post('/api/auth/forgot', async (c) => {
  if (!(await rateLimit(c, 'forgot', 5, 3600))) return bad('Too many requests. Please try again later.', 429);
  const b = await c.req.json().catch(() => null);
  const email = String(b?.email || '').trim().toLowerCase();
  const resp = { ok: true, message: 'If an account exists for that email, a reset link has been generated.' };
  if (validEmail(email)) {
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (user) {
      const token = randHex(32);
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id),
        c.env.DB.prepare(`INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`).bind(token, user.id),
      ]);
      if ((c.env.EXPOSE_RESET_LINK || '') === 'true') {
        const origin = c.req.header('Origin') || (c.req.header('Referer') || '').replace(/\/[^/]*$/, '');
        if (origin) resp.resetUrl = `${origin}/forgot-password.html?token=${token}`;
      }
    }
  }
  return json(resp);
});

app.post('/api/auth/reset', async (c) => {
  if (!(await rateLimit(c, 'reset', 10, 600))) return bad('Too many attempts. Please try again later.', 429);
  const b = await c.req.json().catch(() => null);
  const token = String(b?.token || '').trim();
  const password = String(b?.password || '');
  if (password.length < 8 || password.length > 100) return bad('Password must be at least 8 characters.');
  const row = await c.env.DB.prepare(
    `SELECT user_id FROM password_resets WHERE token = ? AND expires_at > datetime('now')`
  ).bind(token).first();
  if (!row) return bad('This reset link is invalid or has expired.');
  const hash = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, row.user_id),
    c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(row.user_id),
  ]);
  return json({ ok: true });
});

/* ================= PUBLIC CATALOG ================= */
app.get('/api/categories', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.slug, COUNT(t.id) AS count
     FROM categories c LEFT JOIN templates t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.name`
  ).all();
  return json({ categories: rows.results });
});

app.get('/api/templates', async (c) => {
  const q = c.req.query();
  const where = [], params = [];
  if (q.ids) {
    const ids = q.ids.split(',').map(Number).filter(Number.isInteger).slice(0, 50);
    if (ids.length) { where.push(`t.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  if (q.search) {
    const s = `%${q.search}%`;
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(s, s);
  }
  if (q.category) { where.push('c.slug = ?'); params.push(q.category); }
  if (q.featured === '1') where.push('t.featured = 1');
  const min = parseFloat(q.min), max = parseFloat(q.max);
  if (!isNaN(min)) { where.push('t.price >= ?'); params.push(min); }
  if (!isNaN(max)) { where.push('t.price <= ?'); params.push(max); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sorts = { newest: 't.created_at DESC, t.id DESC', 'price-asc': 't.price ASC', 'price-desc': 't.price DESC' };
  const order = sorts[q.sort] || sorts.newest;
  const limit = Math.min(Math.max(parseInt(q.limit) || 12, 1), 48);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM templates t JOIN categories c ON c.id = t.category_id ${whereSql}`
  ).bind(...params).first()).n;
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.price, t.description, t.pages_count, t.demo_url, t.featured, t.created_at,
            c.name AS category_name, c.slug AS category_slug,
            (SELECT r2_key FROM template_screenshots ts WHERE ts.template_id = t.id ORDER BY ts.sort LIMIT 1) AS cover
     FROM templates t JOIN categories c ON c.id = t.category_id
     ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...params, limit, (page - 1) * limit).all();
  return json({ items: rows.results, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
});

app.get('/api/templates/:id', async (c) => {
  const key = c.req.param('id');
  const col = /^\d+$/.test(key) ? 'id' : 'slug';
  const t = await c.env.DB.prepare(
    `SELECT t.*, c.name AS category_name, c.slug AS category_slug
     FROM templates t JOIN categories c ON c.id = t.category_id WHERE t.${col} = ?`
  ).bind(key).first();
  if (!t) return bad('Template not found.', 404);
  const shots = await c.env.DB.prepare(
    'SELECT r2_key FROM template_screenshots WHERE template_id = ? ORDER BY sort'
  ).bind(t.id).all();
  const related = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.price, t.pages_count, c.name AS category_name,
            (SELECT r2_key FROM template_screenshots ts WHERE ts.template_id = t.id ORDER BY ts.sort LIMIT 1) AS cover
     FROM templates t JOIN categories c ON c.id = t.category_id
     WHERE t.category_id = ? AND t.id <> ? ORDER BY t.created_at DESC LIMIT 4`
  ).bind(t.category_id, t.id).all();
  return json({
    template: {
      ...t,
      features: String(t.features).split('\n').map((s) => s.trim()).filter(Boolean),
      screenshots: shots.results.map((s) => `/api/files/${s.r2_key}`),
    },
    related: related.results,
  });
});

/* ================= FILES (R2 + generated previews) ================= */
app.get('/api/files/*', async (c) => {
  let key;
  try { key = decodeURIComponent(c.req.path.slice('/api/files/'.length)); }
  catch { return bad('Not found.', 404); }
  if (!key) return bad('Not found.', 404);
  if (key.startsWith('proofs/')) {
    const user = await currentUser(c);
    if (!user) return bad('Not found.', 404);
    if (user.role !== 'admin') {
      const m = key.match(/^proofs\/order-(\d+)-/);
      const order = m ? await c.env.DB.prepare('SELECT user_id FROM orders WHERE id = ?').bind(+m[1]).first() : null;
      if (!order || order.user_id !== user.id) return bad('Not found.', 404);
    }
  }
  if (key.startsWith('gen/')) {
    return new Response(generateSvg(key), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    });
  }
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return bad('Not found.', 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

/* ================= CART (server mirror) ================= */
app.get('/api/cart', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const row = await c.env.DB.prepare('SELECT items FROM carts WHERE user_id = ?').bind(user.id).first();
  let items = [];
  try { items = row ? JSON.parse(row.items) : []; } catch {}
  return json({ items: Array.isArray(items) ? items : [] });
});

app.put('/api/cart', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const b = await c.req.json().catch(() => null);
  if (!Array.isArray(b?.items)) return bad('Invalid cart payload.');
  const ids = [...new Set(b.items.map(Number).filter(Number.isInteger))].slice(0, 50);
  const valid = ids.length
    ? (await c.env.DB.prepare(`SELECT id FROM templates WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids).all()).results.map((r) => r.id)
    : [];
  const final = ids.filter((id) => valid.includes(id));
  await c.env.DB.prepare(
    `INSERT INTO carts (user_id, items) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = datetime('now')`
  ).bind(user.id, JSON.stringify(final)).run();
  return json({ items: final });
});

/* ================= ORDERS ================= */
async function getOrder(env, id) {
  const o = await env.DB.prepare(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
  ).bind(id).first();
  if (!o) return null;
  const items = await env.DB.prepare(
    'SELECT id, template_id, title, price FROM order_items WHERE order_id = ?'
  ).bind(id).all();
  return {
    ...o,
    items: items.results,
    proof_url: o.payment_proof_key ? `/api/files/${o.payment_proof_key}` : null,
    payment: paymentInfo(env)[o.payment_method] || null,
  };
}

app.post('/api/orders', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  if (!(await rateLimit(c, 'orders', 20, 600))) return bad('Too many order attempts. Please slow down.', 429);
  const b = await c.req.json().catch(() => null);
  const ids = [...new Set((Array.isArray(b?.items) ? b.items : []).map(Number).filter(Number.isInteger))];
  const method = String(b?.paymentMethod || '');
  if (!ids.length) return bad('Your cart is empty.');
  if (!PAYMENT_METHODS.includes(method)) return bad('Please choose a valid payment method.');
  const notes = String(b?.notes || '').slice(0, 500);
  const rows = await c.env.DB.prepare(
    `SELECT id, title, price FROM templates WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  if (rows.results.length !== ids.length) return bad('One or more items are no longer available.');
  const total = rows.results.reduce((s, r) => s + r.price, 0);
  const r = await c.env.DB.prepare(
    'INSERT INTO orders (user_id, status, total, payment_method, notes) VALUES (?,?,?,?,?)'
  ).bind(user.id, 'Pending', total, method, notes).run();
  const orderId = r.meta.last_row_id;
  await c.env.DB.batch(rows.results.map((t) =>
    c.env.DB.prepare('INSERT INTO order_items (order_id, template_id, title, price) VALUES (?,?,?,?)')
      .bind(orderId, t.id, t.title, t.price)));
  return json({ order: await getOrder(c.env, orderId) });
});

app.get('/api/orders', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const orders = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  const ids = orders.results.map((o) => o.id);
  const items = ids.length
    ? (await c.env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids).all()).results
    : [];
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] ||= []).push(it);
  return json({
    orders: orders.results.map((o) => ({
      ...o,
      items: byOrder[o.id] || [],
      payment: paymentInfo(c.env)[o.payment_method] || null,
    })),
  });
});

app.get('/api/orders/:id', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const order = await getOrder(c.env, +c.req.param('id'));
  if (!order || order.user_id !== user.id) return bad('Order not found.', 404);
  return json({ order });
});

app.post('/api/orders/:id/proof', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const orderId = +c.req.param('id');
  const order = await c.env.DB.prepare('SELECT id, user_id FROM orders WHERE id = ?').bind(orderId).first();
  if (!order || order.user_id !== user.id) return bad('Order not found.', 404);
  if (!(await rateLimit(c, 'proof', 10, 600))) return bad('Too many uploads. Please wait a few minutes.', 429);
  const form = await c.req.raw.formData();
  const file = form.get('proof');
  if (!(file instanceof File) || file.size === 0) return bad('Please choose a file to upload.');
  const okTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  if (!okTypes[file.type]) return bad('Proof must be a PNG, JPG, WEBP or PDF file.');
  if (file.size > 5 * 1024 * 1024) return bad('Proof file must be under 5 MB.');
  const key = `proofs/order-${orderId}-${randHex(4)}.${okTypes[file.type]}`;
  await c.env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(`UPDATE orders SET payment_proof_key = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(key, orderId).run();
  return json({ ok: true, proof_url: `/api/files/${key}` });
});

/* ================= DOWNLOADS (paid orders only) ================= */
app.get('/api/download/:orderId/:templateId', async (c) => {
  const user = await requireUser(c);
  if (!user) return bad('Please sign in to continue.', 401);
  const orderId = +c.req.param('orderId');
  const templateId = +c.req.param('templateId');
  const order = await c.env.DB.prepare('SELECT id, user_id, status FROM orders WHERE id = ?').bind(orderId).first();
  if (!order || order.user_id !== user.id) return bad('Order not found.', 404);
  if (!['Paid', 'Completed'].includes(order.status)) return bad('This order has not been marked as paid yet.', 403);
  const item = await c.env.DB.prepare(
    'SELECT template_id FROM order_items WHERE order_id = ? AND template_id = ?'
  ).bind(orderId, templateId).first();
  if (!item) return bad('This template is not part of the order.', 404);
  const t = await c.env.DB.prepare('SELECT title, slug, zip_key FROM templates WHERE id = ?').bind(templateId).first();
  if (!t) return bad('Template not found.', 404);
  const headers = { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${t.slug}.zip"` };
  if (t.zip_key.startsWith('gen/')) return new Response(generateTemplateZip(t.title), { headers });
  if (!t.zip_key) return bad('Template files are not available yet. Please contact support.', 404);
  const obj = await c.env.BUCKET.get(t.zip_key);
  if (!obj) return bad('Template files are not available yet. Please contact support.', 404);
  return new Response(obj.body, { headers });
});

/* ================= CONTACT & SUPPORT ================= */
async function saveMessage(c, type) {
  if (!(await rateLimit(c, 'message', 5, 600))) return bad('You are sending messages too quickly. Please wait a few minutes.', 429);
  const b = await c.req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  const email = String(b?.email || '').trim().toLowerCase();
  const subject = String(b?.subject || '').trim();
  const message = String(b?.message || '').trim();
  if (name.length < 2 || name.length > 80) return bad('Please enter your name.');
  if (!validEmail(email)) return bad('Please enter a valid email address.');
  if (subject.length > 120) return bad('Subject is too long.');
  if (message.length < 10 || message.length > 3000) return bad('Message must be between 10 and 3000 characters.');
  await c.env.DB.prepare('INSERT INTO messages (type, name, email, subject, message) VALUES (?,?,?,?,?)')
    .bind(type, name, email, subject, message).run();
  return json({ ok: true });
}
app.post('/api/contact', (c) => saveMessage(c, 'contact'));
app.post('/api/support', (c) => saveMessage(c, 'support'));

app.get('/api/payment-info', (c) => json({ methods: paymentInfo(c.env) }));
app.get('/api/health', (c) => json({ ok: true }));

/* ================= ADMIN: DASHBOARD STATS ================= */
app.get('/api/admin/stats', async (c) => {
  const r = await c.env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN ('Paid','Completed')) AS sales,
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM orders WHERE status = 'Pending') AS pending,
    (SELECT COUNT(*) FROM users WHERE role = 'customer') AS users,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COUNT(*) FROM messages WHERE is_read = 0) AS unread,
    (SELECT COUNT(*) FROM templates) AS templates`).first();
  return json(r);
});

/* ================= ADMIN: TEMPLATES ================= */
async function getTemplateRow(env, id) {
  return env.DB.prepare(
    `SELECT t.*, c.name AS category_name,
            (SELECT COUNT(*) FROM template_screenshots ts WHERE ts.template_id = t.id) AS shots,
            (SELECT r2_key FROM template_screenshots ts WHERE ts.template_id = t.id ORDER BY ts.sort LIMIT 1) AS cover
     FROM templates t JOIN categories c ON c.id = t.category_id WHERE t.id = ?`
  ).bind(id).first();
}

function validateTemplateBody(form) {
  const title = String(form.get('title') || '').trim();
  if (title.length < 3 || title.length > 120) return { error: 'Title must be 3-120 characters.' };
  const category_id = parseInt(form.get('category_id'), 10);
  if (!Number.isInteger(category_id) || category_id < 1) return { error: 'Please choose a valid category.' };
  const price = parseFloat(form.get('price'));
  if (isNaN(price) || price < 0 || price > 100000) return { error: 'Price must be between $0 and $100,000.' };
  const description = String(form.get('description') || '').trim();
  if (description.length < 10 || description.length > 5000) return { error: 'Description must be 10-5000 characters.' };
  const features = String(form.get('features') || '').trim();
  if (!features) return { error: 'Please add at least one feature.' };
  const pages_count = parseInt(form.get('pages_count'), 10) || 1;
  if (pages_count < 1 || pages_count > 200) return { error: 'Pages count must be between 1 and 200.' };
  const demo_url = String(form.get('demo_url') || '').trim();
  if (demo_url && !/^https?:\/\//i.test(demo_url)) return { error: 'Demo URL must start with http:// or https://.' };
  if (demo_url.length > 300) return { error: 'Demo URL is too long.' };
  const featured = ['1', 'true', 'on', 'yes'].includes(String(form.get('featured') || '').toLowerCase());
  return { v: { title, category_id, price, description, features, pages_count, demo_url, featured } };
}

async function saveTemplateFiles(env, id, form) {
  const shots = form.getAll('screenshots').filter((f) => f instanceof File && f.size > 0);
  let i = 0;
  for (const f of shots) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) continue;
    if (f.size > 5 * 1024 * 1024) continue;
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
    const key = `templates/${id}/screens/${i}-${randHex(4)}.${ext}`;
    await env.BUCKET.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    await env.DB.prepare('INSERT INTO template_screenshots (template_id, r2_key, sort) VALUES (?,?,?)')
      .bind(id, key, i).run();
    i++;
  }
  const zip = form.get('zip');
  if (zip instanceof File && zip.size > 0) {
    const key = `templates/${id}/package.zip`;
    await env.BUCKET.put(key, zip.stream(), { httpMetadata: { contentType: 'application/zip' } });
    await env.DB.prepare('UPDATE templates SET zip_key = ? WHERE id = ?').bind(key, id).run();
  }
}

async function deletePrefix(env, prefix) {
  if (!env.BUCKET) return;
  let listed = await env.BUCKET.list({ prefix });
  while (listed.objects.length) {
    await Promise.all(listed.objects.map((o) => env.BUCKET.delete(o.key)));
    if (listed.truncated && listed.cursor) listed = await env.BUCKET.list({ prefix, cursor: listed.cursor });
    else break;
  }
}

app.get('/api/admin/templates', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*, c.name AS category_name,
            (SELECT COUNT(*) FROM template_screenshots ts WHERE ts.template_id = t.id) AS shots,
            (SELECT r2_key FROM template_screenshots ts WHERE ts.template_id = t.id ORDER BY ts.sort LIMIT 1) AS cover
     FROM templates t JOIN categories c ON c.id = t.category_id ORDER BY t.created_at DESC`
  ).all();
  return json({ items: rows.results });
});

app.post('/api/admin/templates', async (c) => {
  const form = await c.req.raw.formData();
  const { v, error } = validateTemplateBody(form);
  if (error) return bad(error);
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(v.category_id).first();
  if (!cat) return bad('Category not found.');
  const zip = form.get('zip');
  if (zip instanceof File && zip.size > 0 && !/\.zip$/i.test(zip.name)) return bad('The package file must be a .zip file.');
  if (zip instanceof File && zip.size > 50 * 1024 * 1024) return bad('ZIP file must be under 50 MB.');
  let slug = slugify(v.title), finalSlug = slug, n = 1;
  while (await c.env.DB.prepare('SELECT id FROM templates WHERE slug = ?').bind(finalSlug).first()) finalSlug = `${slug}-${++n}`;
  const r = await c.env.DB.prepare(
    'INSERT INTO templates (title, slug, category_id, price, description, features, pages_count, demo_url, zip_key, featured) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(v.title, finalSlug, v.category_id, v.price, v.description, v.features, v.pages_count, v.demo_url, '', v.featured ? 1 : 0).run();
  await saveTemplateFiles(c.env, r.meta.last_row_id, form);
  return json({ template: await getTemplateRow(c.env, r.meta.last_row_id) });
});

app.put('/api/admin/templates/:id', async (c) => {
  const id = +c.req.param('id');
  const t = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first();
  if (!t) return bad('Template not found.', 404);
  const ctype = c.req.header('Content-Type') || '';
  if (ctype.includes('application/json')) {
    const b = await c.req.json().catch(() => null);
    if (b && typeof b.featured === 'boolean') {
      await c.env.DB.prepare('UPDATE templates SET featured = ? WHERE id = ?').bind(b.featured ? 1 : 0, id).run();
      return json({ ok: true });
    }
    return bad('Unsupported JSON update.');
  }
  const form = await c.req.raw.formData();
  const { v, error } = validateTemplateBody(form);
  if (error) return bad(error);
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(v.category_id).first();
  if (!cat) return bad('Category not found.');
  const zip = form.get('zip');
  if (zip instanceof File && zip.size > 0 && !/\.zip$/i.test(zip.name)) return bad('The package file must be a .zip file.');
  if (zip instanceof File && zip.size > 50 * 1024 * 1024) return bad('ZIP file must be under 50 MB.');
  const hasShots = form.getAll('screenshots').some((f) => f instanceof File && f.size > 0);
  if (hasShots) {
    await deletePrefix(c.env, `templates/${id}/screens/`);
    await c.env.DB.prepare('DELETE FROM template_screenshots WHERE template_id = ?').bind(id).run();
  }
  await c.env.DB.prepare(
    'UPDATE templates SET title = ?, category_id = ?, price = ?, description = ?, features = ?, pages_count = ?, demo_url = ?, featured = ? WHERE id = ?'
  ).bind(v.title, v.category_id, v.price, v.description, v.features, v.pages_count, v.demo_url, v.featured ? 1 : 0, id).run();
  await saveTemplateFiles(c.env, id, form);
  return json({ template: await getTemplateRow(c.env, id) });
});

app.delete('/api/admin/templates/:id', async (c) => {
  const id = +c.req.param('id');
  const t = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first();
  if (!t) return bad('Template not found.', 404);
  await deletePrefix(c.env, `templates/${id}/`);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM template_screenshots WHERE template_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
});

/* ================= ADMIN: ORDERS ================= */
app.get('/api/admin/orders', async (c) => {
  const status = c.req.query('status');
  const where = status && ORDER_STATUSES.includes(status) ? 'WHERE o.status = ?' : '';
  const params = where ? [status] : [];
  const orders = await c.env.DB.prepare(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email
     FROM orders o JOIN users u ON u.id = o.user_id ${where} ORDER BY o.created_at DESC`
  ).bind(...params).all();
  const ids = orders.results.map((o) => o.id);
  const items = ids.length
    ? (await c.env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids).all()).results
    : [];
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] ||= []).push(it);
  return json({
    orders: orders.results.map((o) => ({
      ...o,
      items: byOrder[o.id] || [],
      proof_url: o.payment_proof_key ? `/api/files/${o.payment_proof_key}` : null,
    })),
  });
});

app.patch('/api/admin/orders/:id', async (c) => {
  const b = await c.req.json().catch(() => null);
  const status = String(b?.status || '');
  if (!ORDER_STATUSES.includes(status)) return bad('Invalid status.');
  const r = await c.env.DB.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, +c.req.param('id')).run();
  if (!r.meta.changes) return bad('Order not found.', 404);
  return json({ ok: true });
});

/* ================= ADMIN: CUSTOMERS ================= */
app.get('/api/admin/customers', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.created_at, COUNT(o.id) AS orders, COALESCE(SUM(o.total), 0) AS spent
     FROM users u LEFT JOIN orders o ON o.user_id = u.id
     WHERE u.role = 'customer' GROUP BY u.id ORDER BY u.created_at DESC`
  ).all();
  return json({ customers: rows.results });
});

/* ================= ADMIN: INBOX ================= */
app.get('/api/admin/messages', async (c) => {
  const type = c.req.query('type');
  const unread = c.req.query('unread');
  let sql = 'SELECT * FROM messages';
  const where = [], params = [];
  if (type && ['contact', 'support'].includes(type)) { where.push('type = ?'); params.push(type); }
  if (unread === '1') where.push('is_read = 0');
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  return json({ messages: (await c.env.DB.prepare(sql).bind(...params).all()).results });
});

app.patch('/api/admin/messages/:id', async (c) => {
  const b = await c.req.json().catch(() => null);
  const isRead = b?.is_read ? 1 : 0;
  const r = await c.env.DB.prepare('UPDATE messages SET is_read = ? WHERE id = ?')
    .bind(isRead, +c.req.param('id')).run();
  if (!r.meta.changes) return bad('Message not found.', 404);
  return json({ ok: true });
});

app.delete('/api/admin/messages/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(+c.req.param('id')).run();
  if (!r.meta.changes) return bad('Message not found.', 404);
  return json({ ok: true });
});

/* ================= ADMIN: CATEGORIES ================= */
app.get('/api/admin/categories', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.slug, COUNT(t.id) AS count
     FROM categories c LEFT JOIN templates t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.name`
  ).all();
  return json({ categories: rows.results });
});

app.post('/api/admin/categories', async (c) => {
  const b = await c.req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  if (name.length < 2 || name.length > 40) return bad('Category name must be 2-40 characters.');
  const slug = slugify(name);
  const exists = await c.env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR name = ?').bind(slug, name).first();
  if (exists) return bad('That category already exists.', 409);
  const r = await c.env.DB.prepare('INSERT INTO categories (name, slug) VALUES (?,?)').bind(name, slug).run();
  return json({ category: { id: r.meta.last_row_id, name, slug } });
});

app.patch('/api/admin/categories/:id', async (c) => {
  const b = await c.req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  if (name.length < 2 || name.length > 40) return bad('Category name must be 2-40 characters.');
  const slug = slugify(name);
  const dup = await c.env.DB.prepare('SELECT id FROM categories WHERE (slug = ? OR name = ?) AND id <> ?')
    .bind(slug, name, +c.req.param('id')).first();
  if (dup) return bad('That category already exists.', 409);
  const r = await c.env.DB.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?')
    .bind(name, slug, +c.req.param('id')).run();
  if (!r.meta.changes) return bad('Category not found.', 404);
  return json({ ok: true });
});

app.delete('/api/admin/categories/:id', async (c) => {
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM templates WHERE category_id = ?')
    .bind(+c.req.param('id')).first();
  if (count.n > 0) return bad('Move or delete the templates in this category first.', 409);
  const r = await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(+c.req.param('id')).run();
  if (!r.meta.changes) return bad('Category not found.', 404);
  return json({ ok: true });
});

/* ================= FALLBACKS & EXPORT ================= */
app.notFound((c) => bad('Not found.', 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return bad('Unexpected server error. Please try again.', 500);
});

export default app;