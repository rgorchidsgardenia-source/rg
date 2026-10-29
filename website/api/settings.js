// GET /api/settings: the public site settings edited in /admin (price, phone numbers, popup,
// announcement bar). Cached at the edge for a minute, so changes go live within ~60 seconds.
const PUBLIC_KEYS = ['phone', 'phone_tel', 'whatsapp', 'email', 'price', 'popup_enabled', 'popup_delay', 'popup_title', 'announcement', 'announcement_link'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(200).json({});
  try {
    const headers = { apikey: key };
    if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/site_settings?select=key,value`, { headers });
    if (!r.ok) throw new Error(`${r.status}`);
    const out = {};
    for (const row of await r.json()) if (PUBLIC_KEYS.includes(row.key)) out[row.key] = row.value;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    return res.status(200).json(out);
  } catch (err) {
    console.error('[settings]', err.message);
    return res.status(200).json({});
  }
};
