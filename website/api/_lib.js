// Shared helpers for the website's API functions (files starting with "_" are not routes on Vercel).

const DEFAULT_ORIGINS = ['https://rgstructures.in', 'https://www.rgstructures.in'];

function allowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ORIGINS.concat(extra);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const sameHost = (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  if (sameHost || allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Trims every expected string field to its column limit and strips control characters.
function pick(body, fields) {
  const out = {};
  for (const [key, max] of Object.entries(fields)) {
    const v = body[key];
    out[key] = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }
  return out;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

// Best effort, per warm instance.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > max;
  };
}

function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

// Inserts one row with the publishable key; RLS only lets it add rows.
async function insert(table, row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`; // legacy JWT keys
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`Supabase insert into ${table} failed: ${r.status} ${await r.text()}`);
  return true;
}

module.exports = { applyCors, readBody, pick, clientIp, limiter, insert, supabaseConfigured };
