// /api/email/* : email automation through Resend (one function, routed by ?action=, see vercel.json).
//
//   POST /api/email/lead     called by the database (pg_net trigger) for every new enquiry or landing page lead:
//                            sends the personalised auto-reply and, if set, a new-lead alert to the team.
//   POST /api/email/webhook  Resend webhooks: delivery status (sent, delivered, opened, clicked, bounced, ...) and
//                            replies (email.received). Signed with RESEND_WEBHOOK_SECRET (svix), or ?token=EMAIL_HOOK_SECRET.
//   POST /api/email/send     an admin sends an email (or a reply) from /admin. Needs the admin's Supabase login.
//   GET  /api/email/status   which pieces are configured, for the admin settings page.
//
// Env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EMAIL_HOOK_SECRET (same value as private.config in Supabase),
// RESEND_API_KEY, RESEND_WEBHOOK_SECRET (whsec_..., from the Resend webhook page).
// Without RESEND_API_KEY every email is logged as "skipped", so the whole flow can be tested before go-live.
import crypto from 'node:crypto';

const SITE = 'https://rgstructures.in';
const RESEND = 'https://api.resend.com';
const TEMPLATE_FOR_TYPE = { callback: 'callback', contact: 'contact', project: 'project', channel_partner: 'channel_partner',
  cp_lead: 'cp_lead', career: 'career' };
const FORM_LABEL = { callback: 'Call-back request', contact: 'Contact form', project: 'Project enquiry', channel_partner: 'Channel partner sign-up',
  cp_lead: 'CP lead registration', career: 'Job application', landing: 'Landing page' };
const STATUS_FOR_EVENT = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.opened': 'opened',
  'email.clicked': 'clicked', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'failed' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/* ---------- Supabase ---------- */
function sbHeaders(token) {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  else if (key && key.split('.').length === 3) h.Authorization = `Bearer ${key}`;
  return h;
}
const sbUrl = (path) => `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}${path}`;

async function server(secret, action, data) {
  const r = await fetch(sbUrl('/rest/v1/rpc/email_server'), {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify({ p_secret: secret, p_action: action, p_data: data || {} })
  });
  if (r.status === 401 || r.status === 403) { const e = new Error('not allowed'); e.status = 401; throw e; }
  if (!r.ok) throw new Error(`email_server ${action}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Returns the signed-in admin's email, or null.
async function adminFrom(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const [isAdmin, user] = await Promise.all([
    fetch(sbUrl('/rest/v1/rpc/is_admin'), { method: 'POST', headers: sbHeaders(token), body: '{}' }).then((r) => (r.ok ? r.json() : false)),
    fetch(sbUrl('/auth/v1/user'), { headers: sbHeaders(token) }).then((r) => (r.ok ? r.json() : null))
  ]);
  return isAdmin === true && user && user.email ? user.email : null;
}

/* ---------- Resend ---------- */
async function resend(path, init = {}) {
  const r = await fetch(`${RESEND}${path}`, {
    ...init, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || `Resend ${r.status}`);
  return body;
}

function verifySvix(raw, headers, secret) {
  const id = headers.get('svix-id'); const ts = headers.get('svix-timestamp'); const sigs = headers.get('svix-signature');
  if (!id || !ts || !sigs || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from(crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64'));
  return sigs.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    const given = Buffer.from(sig || '');
    return version === 'v1' && given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

/* ---------- Rendering ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fill(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

function varsFor(lead, source, ctx) {
  const name = (lead.name || '').trim();
  const interest = source === 'landing' ? (lead.interest || 'enquiry') : (lead.configuration || '');
  return {
    name, first_name: name.split(/\s+/)[0] || 'there', phone: lead.phone ? `+91 ${lead.phone}` : '', email: lead.email || '',
    project: lead.project || 'RG Unique Structures', interest: interest.toLowerCase(), position: lead.position || '',
    partner_name: lead.partner_name || name, visit_date: lead.visit_date || '', city: lead.city || '',
    form: FORM_LABEL[source === 'landing' ? 'landing' : lead.type] || 'Website form', page_url: lead.page_url || '',
    company_phone: ctx.company_phone || '+91 99 88 99 6506'
  };
}

function renderHtml(bodyText, signature, opts = {}) {
  const paras = String(bodyText).trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#2b2430">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const sig = signature ? `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#5a4f60">${esc(signature).replace(/\n/g, '<br>')}</p>` : '';
  const cta = opts.cta === false ? '' : `
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 4px"><tr>
          <td style="border-radius:999px;background:#c9962e"><a href="tel:${esc(opts.phoneTel || '+919988996506')}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#24112f;text-decoration:none">Call us</a></td>
          <td style="width:10px"></td>
          <td style="border-radius:999px;border:1px solid #3c1f4b"><a href="${SITE}/" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#3c1f4b;text-decoration:none">Visit our website</a></td>
        </tr></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4ece2;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4ece2;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#2e1739;padding:22px 28px" align="left"><img src="${SITE}/assets/img/brand/email-logo.png" width="120" alt="RG Unique Structures" style="display:block;border:0"></td></tr>
      <tr><td style="padding:30px 28px 26px">${paras}${cta}${sig}</td></tr>
      <tr><td style="padding:18px 28px;background:#fbf6f0;font-size:12px;line-height:1.6;color:#8a7f8f">
        RG Unique Structures Pvt. Ltd. · Bengaluru · <a href="${SITE}/" style="color:#8a6420">rgstructures.in</a><br>
        You are receiving this because you contacted us through our website. Reply to this email to reach our team.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/* ---------- Sending + logging ---------- */
async function sendAndLog(secret, { settings, to, subject, text, html, kind, template_key, lead_source, lead_id, sent_by, headers, meta }) {
  const from = `${settings.from_name} <${settings.from_email}>`;
  const base = { kind, from_email: from, to_email: to, reply_to: settings.reply_to || null, subject, html, text_body: text, template_key,
    lead_source, lead_id, sent_by, meta: meta || {} };
  if (!process.env.RESEND_API_KEY) {
    await server(secret, 'log', { ...base, status: 'skipped', error: 'Resend is not connected yet (RESEND_API_KEY missing)' });
    return { skipped: true };
  }
  try {
    const out = await resend('/emails', { method: 'POST', body: JSON.stringify({
      from, to: [to], subject, html, text, reply_to: settings.reply_to || undefined, headers,
      tags: [{ name: 'kind', value: kind }, { name: 'lead_source', value: lead_source || 'none' }]
    }) });
    await server(secret, 'log', { ...base, status: 'sent', resend_id: out.id });
    return { id: out.id };
  } catch (err) {
    await server(secret, 'log', { ...base, status: 'failed', error: err.message });
    return { error: err.message };
  }
}

async function onLead(request) {
  const body = await request.json().catch(() => ({}));
  const { secret, source, lead } = body;
  if (!secret || !lead) return json({ ok: false }, 400);
  const templateKey = source === 'landing' ? 'landing' : TEMPLATE_FOR_TYPE[lead.type];
  let ctx;
  try { ctx = await server(secret, 'context', { template_key: templateKey }); } catch (err) { return json({ ok: false }, err.status || 500); }
  const { settings, template, alert } = ctx;
  const vars = varsFor(lead, source, ctx);
  const result = {};

  if (settings && settings.enabled && template && template.enabled && EMAIL.test(lead.email || '')) {
    const subject = fill(template.subject, vars).slice(0, 200);
    const text = `${fill(template.body, vars)}\n\n${settings.signature || ''}`.trim();
    const html = renderHtml(fill(template.body, vars), settings.signature, { phoneTel: `+91${String(ctx.company_phone).replace(/\D/g, '').slice(-10)}` });
    result.reply = await sendAndLog(secret, { settings, to: lead.email, subject, text, html, kind: 'auto_reply', template_key: templateKey,
      lead_source: source, lead_id: lead.id });
  }

  const team = String((settings && settings.notify_to) || '').split(/[,\s]+/).filter((e) => EMAIL.test(e));
  if (settings && settings.enabled && alert && alert.enabled && team.length) {
    const subject = fill(alert.subject, vars).slice(0, 200);
    const text = fill(alert.body, vars);
    const html = renderHtml(text, '', { cta: false });
    result.alerts = await Promise.all(team.map((to) => sendAndLog(secret, { settings, to, subject, text, html, kind: 'team_alert',
      template_key: 'team_alert', lead_source: source, lead_id: lead.id })));
  }
  return json({ ok: true, ...result });
}

async function onWebhook(request, url) {
  const raw = await request.text();
  const signed = process.env.RESEND_WEBHOOK_SECRET && verifySvix(raw, request.headers, process.env.RESEND_WEBHOOK_SECRET);
  const tokenOk = process.env.EMAIL_HOOK_SECRET && url.searchParams.get('token') === process.env.EMAIL_HOOK_SECRET;
  if (!signed && !tokenOk) return json({ ok: false }, 401);
  const secret = process.env.EMAIL_HOOK_SECRET;
  let event; try { event = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
  const data = event.data || {};

  if (event.type === 'email.received') {
    let full = {};
    if (process.env.RESEND_API_KEY) {
      try { full = await resend(`/emails/receiving/${encodeURIComponent(data.email_id)}`); } catch (err) { console.error('[email] receiving', err.message); }
    }
    let html = full.html || null;
    if (html && /^data:/.test(html)) {
      const [, meta, payload] = /^data:([^,]*),(.*)$/s.exec(html) || [];
      html = meta && /base64/.test(meta) ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload || '');
    }
    const from = String(full.from || data.from || '');
    const fromEmail = (/<([^>]+)>/.exec(from) || [, from])[1].trim().toLowerCase();
    const out = await server(secret, 'inbound', {
      resend_id: data.email_id, message_id: full.message_id || data.message_id, from_email: fromEmail,
      to_email: [].concat(full.to || data.to || []).join(', '), subject: full.subject || data.subject, html, text_body: full.text || null,
      meta: { from, cc: full.cc || data.cc || [], attachments: (full.attachments || data.attachments || []).map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, size: a.size })) }
    });
    return json({ ok: true, ...out });
  }

  const status = STATUS_FOR_EVENT[event.type];
  if (!status || !data.email_id) return json({ ok: true, ignored: event.type });
  const error = event.type === 'email.bounced' ? (data.bounce && (data.bounce.message || data.bounce.type)) || 'Bounced'
    : event.type === 'email.suppressed' ? 'Suppressed by Resend' : event.type === 'email.failed' ? (data.failed && data.failed.reason) || 'Failed' : null;
  const out = await server(secret, 'event', { resend_id: data.email_id, type: event.type, status, error,
    payload: { created_at: event.created_at, click: data.click || null, bounce: data.bounce || null } });
  return json({ ok: true, ...out });
}

async function onSend(request) {
  const admin = await adminFrom(request);
  if (!admin) return json({ ok: false, error: 'Please sign in again' }, 401);
  const b = await request.json().catch(() => ({}));
  const to = String(b.to || '').trim().toLowerCase();
  const subject = String(b.subject || '').trim().slice(0, 200);
  const text = String(b.body || '').trim().slice(0, 10000);
  if (!EMAIL.test(to)) return json({ ok: false, error: 'Enter a valid email address' }, 400);
  if (!subject || !text) return json({ ok: false, error: 'Add a subject and a message' }, 400);
  const secret = process.env.EMAIL_HOOK_SECRET;
  if (!secret) return json({ ok: false, error: 'EMAIL_HOOK_SECRET is not set on the server' }, 500);
  const ctx = await server(secret, 'context', {});
  const headers = b.in_reply_to ? { 'In-Reply-To': b.in_reply_to, References: b.in_reply_to } : undefined;
  const html = renderHtml(text, ctx.settings.signature, { cta: false });
  const out = await sendAndLog(secret, { settings: ctx.settings, to, subject, text: `${text}\n\n${ctx.settings.signature || ''}`.trim(), html,
    kind: 'manual', lead_source: b.lead_source || null, lead_id: b.lead_id || null, sent_by: admin, headers });
  if (out.error) return json({ ok: false, error: out.error }, 502);
  return json({ ok: true, ...out });
}

async function onStatus(request) {
  if (!(await adminFrom(request))) return json({ ok: false }, 401);
  return json({ ok: true, resend: Boolean(process.env.RESEND_API_KEY), webhook_signing: Boolean(process.env.RESEND_WEBHOOK_SECRET),
    hook_secret: Boolean(process.env.EMAIL_HOOK_SECRET), webhook_url: `${SITE}/api/email/webhook` });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || url.pathname.split('/').filter(Boolean).pop();
    try {
      if (action === 'status' && request.method === 'GET') return await onStatus(request);
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      if (action === 'lead') return await onLead(request);
      if (action === 'webhook') return await onWebhook(request, url);
      if (action === 'send') return await onSend(request);
      return json({ ok: false, error: 'Not found' }, 404);
    } catch (err) {
      console.error(`[email] ${action}`, err.message);
      return json({ ok: false, error: 'Something went wrong' }, err.status || 500);
    }
  }
};
