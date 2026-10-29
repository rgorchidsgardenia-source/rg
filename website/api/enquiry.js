// POST /api/enquiry: every form on the website (call-back, contact, project, channel partner,
// CP lead registration, careers) ends up as one row in public.enquiries.
//
// Env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (insert-only through RLS).
// Optional: LEAD_WEBHOOK_URL also receives each enquiry as JSON; ALLOWED_ORIGINS for cross-origin forms.
// Without Supabase settings it runs in log-only mode: the enquiry is printed to the function logs.
const { applyCors, readBody, pick, clientIp, limiter, insert, supabaseConfigured } = require('./_lib');

const TYPES = ['callback', 'contact', 'project', 'channel_partner', 'cp_lead', 'career'];
const FIELDS = {
  type: 20, name: 80, phone: 20, email: 120, city: 80, message: 1000, project: 80, configuration: 40,
  visit_date: 10, visit_time: 10, partner_name: 80, address: 300, rera_no: 80, position: 60, experience: 40,
  profile_url: 300, cta: 60, form_id: 60, page_url: 500, referrer: 300, session_id: 64,
  utm_source: 200, utm_medium: 200, utm_campaign: 200, utm_term: 200, utm_content: 200, gclid: 200, fbclid: 200
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const limited = limiter(6, 10 * 60 * 1000);

function validate(e) {
  if (!TYPES.includes(e.type)) return 'Invalid form';
  if (e.name.length < 2) return e.type === 'cp_lead' ? 'Please enter the client name' : 'Please enter your name';
  if (!/^[6-9]\d{9}$/.test(e.phone)) return 'Enter a valid 10-digit mobile number';
  if (e.email && !EMAIL.test(e.email)) return 'Enter a valid email address';
  if (e.type === 'cp_lead' && e.partner_name.length < 2) return 'Please enter the channel partner name';
  if ((e.type === 'cp_lead' || e.type === 'career' || e.type === 'project') && !e.email) return 'Please enter an email address';
  if (e.type === 'project' && !e.city) return 'Please enter your city or pincode';
  if (e.profile_url && !/^https?:\/\//i.test(e.profile_url)) e.profile_url = `https://${e.profile_url}`;
  if (e.visit_date && !/^\d{4}-\d{2}-\d{2}$/.test(e.visit_date)) e.visit_date = '';
  if (e.visit_time && !/^\d{2}:\d{2}$/.test(e.visit_time)) e.visit_time = '';
  return null;
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'Invalid request' }); }

  // Honeypot: bots fill the hidden "company" field. Pretend success.
  if (body.company) return res.status(200).json({ ok: true });

  const e = pick(body, FIELDS);
  e.phone = e.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  e.email = e.email.toLowerCase();
  const problem = validate(e);
  if (problem) return res.status(400).json({ ok: false, error: problem });

  const ip = clientIp(req);
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'Too many requests, please call us instead' });

  const row = { consent: body.consent === true, user_agent: String(req.headers['user-agent'] || '').slice(0, 300), ip_address: ip || null,
    country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 8) || null };
  for (const [k, v] of Object.entries(e)) row[k] = v === '' ? null : v;

  try {
    const stored = await insert('enquiries', row);
    if (!stored) console.log('[enquiry] (log-only mode, Supabase not configured)', JSON.stringify(row));
    // Analytics: a form submission, without personal details.
    if (supabaseConfigured()) {
      insert('site_events', { event: 'form_submit', label: `${row.type}:${row.form_id || ''}`.slice(0, 120),
        path: (() => { try { return new URL(row.page_url).pathname.slice(0, 300); } catch { return '/'; } })(),
        session_id: row.session_id, country: row.country, utm_source: row.utm_source, utm_medium: row.utm_medium, utm_campaign: row.utm_campaign
      }).catch((err) => console.error('[enquiry] event', err.message));
    }
    if (process.env.LEAD_WEBHOOK_URL) {
      try {
        await fetch(process.env.LEAD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row, ip_address: undefined, user_agent: undefined }) });
      } catch (err) { console.error('[enquiry] webhook failed', err.message); }
    }
    return res.status(200).json({ ok: true, stored });
  } catch (err) {
    // Never lose an enquiry: keep a copy in the logs even if the database is down.
    console.error('[enquiry] storage error', err.message, JSON.stringify(row));
    return res.status(500).json({ ok: false, error: 'Could not submit right now' });
  }
};
