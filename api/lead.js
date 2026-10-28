// POST /api/lead: receives enquiries from the landing page.
//
// Storage:
//   - If SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, the lead is
//     inserted into the `leads` table (see supabase/schema.sql).
//   - Otherwise the function runs in log-only mode: the lead is written to
//     the Vercel function logs and the visitor still gets a success response.
//
// Other env vars:
//   ALLOWED_ORIGINS  comma-separated origins allowed to POST cross-origin
//                    (needed when the page is hosted on rgstructures.in).
//   LEAD_WEBHOOK_URL optional URL that also receives every lead as JSON
//                    (Google Apps Script, Zapier, Make, a CRM, ...).

const DEFAULT_ORIGINS = ['https://rgstructures.in', 'https://www.rgstructures.in'];
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // best-effort, per warm instance

const FIELDS = {
  name: 80, phone: 15, email: 120, interest: 40, visit_date: 10, form_id: 60,
  page_url: 500, referrer: 300,
  utm_source: 200, utm_medium: 200, utm_campaign: 200, utm_term: 200, utm_content: 200,
  gclid: 200, fbclid: 200
};

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
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function clean(body) {
  const out = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    const v = body[key];
    out[key] = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }
  out.phone = out.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return out;
}

function validate(lead) {
  if (lead.name.length < 2) return 'Please enter your name';
  if (!/^[6-9]\d{9}$/.test(lead.phone)) return 'Enter a valid 10-digit mobile number';
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return 'Enter a valid email';
  if (lead.visit_date && !/^\d{4}-\d{2}-\d{2}$/.test(lead.visit_date)) lead.visit_date = '';
  return null;
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

async function saveToSupabase(row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`Supabase insert failed: ${r.status} ${await r.text()}`);
  return true;
}

async function sendWebhook(row) {
  const hook = process.env.LEAD_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
  } catch (err) {
    console.error('[lead] webhook failed', err.message);
  }
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'Invalid request' }); }

  // Honeypot: bots fill the hidden "company" field. Pretend success.
  if (body.company) return res.status(200).json({ ok: true });

  const lead = clean(body);
  const problem = validate(lead);
  if (problem) return res.status(400).json({ ok: false, error: problem });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'Too many requests, please call us instead' });

  const row = {
    ...lead,
    email: lead.email || null,
    visit_date: lead.visit_date || null,
    project: 'RG Orchids Gardenia',
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    ip_address: ip || null
  };

  try {
    const stored = await saveToSupabase(row);
    if (!stored) console.log('[lead] (log-only mode, Supabase not configured)', JSON.stringify(row));
    await sendWebhook(row);
    return res.status(200).json({ ok: true, stored });
  } catch (err) {
    // Never lose a lead: keep a copy in the logs even if the database is down.
    console.error('[lead] storage error', err.message, JSON.stringify(row));
    return res.status(500).json({ ok: false, error: 'Could not submit right now' });
  }
};
