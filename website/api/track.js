// POST /api/track: anonymous analytics (page views and clicks on call / WhatsApp / directions / popup).
// No personal details: a random per-visit id, the page, device type and campaign tags.
const { applyCors, readBody, pick, clientIp, limiter, insert } = require('./_lib');

const EVENTS = ['page_view', 'call_click', 'whatsapp_click', 'email_click', 'directions_click', 'popup_open'];
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i;
const limited = limiter(120, 10 * 60 * 1000);

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false }); }
  const e = pick(body, { event: 30, label: 120, path: 300, session_id: 64, referrer: 300, device: 10, utm_source: 200, utm_medium: 200, utm_campaign: 200 });

  if (!EVENTS.includes(e.event) || !e.path.startsWith('/')) return res.status(400).json({ ok: false });
  if (BOTS.test(String(req.headers['user-agent'] || ''))) return res.status(204).end();
  if (limited(clientIp(req))) return res.status(204).end();
  if (!['mobile', 'tablet', 'desktop'].includes(e.device)) e.device = '';

  const row = { country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 8) || null };
  for (const [k, v] of Object.entries(e)) row[k] = v === '' ? null : v;

  try {
    await insert('site_events', row);
  } catch (err) {
    console.error('[track]', err.message);
  }
  return res.status(204).end();
};
