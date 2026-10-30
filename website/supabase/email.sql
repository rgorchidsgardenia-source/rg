-- Email automation (Resend): auto-replies to every form, team alerts, delivery tracking, replies.
-- Applied as the Supabase migration "email_automation". Runs after schema.sql.
--
-- Flow:
--   1. A row lands in public.enquiries (website forms) or public.leads (landing page).
--   2. The trigger below posts it (with a shared secret) to https://rgstructures.in/api/email/lead
--      through pg_net, so the form itself never waits for email.
--   3. /api/email sends the personalised reply through Resend and logs it with public.email_server().
--   4. Resend webhooks (/api/email/webhook) update delivery status and store replies.
-- Nothing here is readable without an admin login, except through email_server() with the secret.

create extension if not exists pg_net with schema extensions;

-- ---------- Private config (not exposed through the API) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
insert into private.config (key, value) values
  ('email_hook_secret', encode(extensions.gen_random_bytes(24), 'hex')),
  ('email_hook_url', 'https://rgstructures.in/api/email/lead')
on conflict (key) do nothing;

-- ---------- Settings (one row) and templates, edited in /admin ----------
create table if not exists public.email_settings (
  id          int primary key default 1 check (id = 1),
  enabled     boolean not null default true,
  from_name   text not null default 'RG Unique Structures' check (char_length(from_name) <= 80),
  from_email  text not null default 'hello@rgstructures.in' check (char_length(from_email) <= 120),
  reply_to    text not null default '' check (char_length(reply_to) <= 120),
  notify_to   text not null default '' check (char_length(notify_to) <= 500),
  signature   text not null default 'Warm regards,
Team RG Unique Structures
+91 99 88 99 6506 · rgstructures.in' check (char_length(signature) <= 1000),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
insert into public.email_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.email_templates (
  key         text primary key,
  label       text not null,
  enabled     boolean not null default true,
  subject     text not null check (char_length(subject) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 5000),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
insert into public.email_templates (key, label, subject, body) values
('callback', 'Call-back request (popup, enquiry strips)',
 'Thank you, {{first_name}}. Our team will call you shortly',
 'Hi {{first_name}},

Thank you for your interest in {{project}}. We have your request, and our sales team will call you on {{phone}} shortly.

If you would like to speak to us sooner, call {{company_phone}} or simply reply to this email.'),
('project', 'RG Orchids Gardenia enquiry (project page form)',
 '{{first_name}}, your RG Orchids Gardenia details are on the way',
 'Hi {{first_name}},

Thank you for your interest in RG Orchids Gardenia, opposite Manyata Tech Park, Nagawara. Our team will call you on {{phone}} shortly with the price sheet, floor plans and current offers.

You are welcome to visit the site any day. Reply to this email with a convenient date and we will arrange it.'),
('contact', 'Contact form',
 'We have received your message, {{first_name}}',
 'Hi {{first_name}},

Thank you for writing to RG Unique Structures. We have received your message and the right person from our team will get back to you shortly.

For anything urgent, call us on {{company_phone}}.'),
('channel_partner', 'Channel partner sign-up',
 'Thank you for registering as a channel partner, {{first_name}}',
 'Hi {{first_name}},

Thank you for registering with the RG Unique Structures channel partner programme. Our partnerships team will review your details and get in touch with you shortly.'),
('cp_lead', 'Channel partner lead registration',
 'Lead registration received: {{name}}',
 'Hi {{partner_name}},

We have received your lead registration for {{name}}. Our team will verify it and update you shortly.'),
('career', 'Job application',
 'Thank you for applying, {{first_name}}',
 'Hi {{first_name}},

Thank you for applying for the {{position}} role at RG Unique Structures. Our HR team will review your profile and contact you if it matches our requirements.'),
('landing', 'RG Orchids Gardenia landing page',
 '{{first_name}}, your RG Orchids Gardenia {{interest}} request',
 'Hi {{first_name}},

Thank you for your interest in RG Orchids Gardenia, opposite Manyata Tech Park. Our team will call you on {{phone}} shortly about your {{interest}} request.

Large 3 BHK homes of 1,860 to 2,890 sq.ft with 12x12 ft floating balconies and a 180-degree open view. Reply to this email any time to book a site visit.'),
('team_alert', 'New lead alert to the sales team',
 'New lead: {{name}} ({{form}})',
 'A new lead just came in.

Name: {{name}}
Phone: {{phone}}
Email: {{email}}
Form: {{form}}
Project: {{project}}
Page: {{page_url}}

Open the admin dashboard to follow up.')
on conflict (key) do nothing;

-- ---------- Every email sent or received ----------
create table if not exists public.email_messages (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  direction     text not null check (direction in ('out', 'in')),
  kind          text not null check (kind in ('auto_reply', 'team_alert', 'manual', 'reply')),
  status        text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'delayed', 'opened', 'clicked',
                  'bounced', 'complained', 'failed', 'skipped', 'received')),
  resend_id     text unique,
  message_id    text,
  from_email    text,
  to_email      text,
  reply_to      text,
  subject       text,
  html          text,
  text_body     text,
  template_key  text,
  lead_source   text check (lead_source in ('website', 'landing')),
  lead_id       uuid,
  error         text,
  sent_by       text,
  delivered_at  timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  read_at       timestamptz,
  meta          jsonb not null default '{}'::jsonb
);
create index if not exists email_messages_created_idx on public.email_messages (created_at desc);
create index if not exists email_messages_lead_idx on public.email_messages (lead_id, created_at);
create index if not exists email_messages_to_idx on public.email_messages (lower(to_email));
create index if not exists email_messages_from_idx on public.email_messages (lower(from_email));

create table if not exists public.email_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  message_id  uuid references public.email_messages (id) on delete cascade,
  resend_id   text,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists email_events_message_idx on public.email_events (message_id, created_at);

drop trigger if exists email_messages_touch on public.email_messages;
create trigger email_messages_touch before update on public.email_messages for each row execute function public.touch_updated_at();

-- ---------- Row level security: admins only ----------
alter table public.email_settings  enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_messages  enable row level security;
alter table public.email_events    enable row level security;
revoke all on public.email_settings, public.email_templates, public.email_messages, public.email_events from anon, authenticated;
grant select, update on public.email_settings to authenticated;
grant select, update on public.email_templates to authenticated;
grant select, update, delete on public.email_messages to authenticated;
grant select on public.email_events to authenticated;

drop policy if exists "admins read email settings" on public.email_settings;
create policy "admins read email settings" on public.email_settings for select to authenticated using (public.is_admin());
drop policy if exists "admins update email settings" on public.email_settings;
create policy "admins update email settings" on public.email_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins read templates" on public.email_templates;
create policy "admins read templates" on public.email_templates for select to authenticated using (public.is_admin());
drop policy if exists "admins update templates" on public.email_templates;
create policy "admins update templates" on public.email_templates for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins read emails" on public.email_messages;
create policy "admins read emails" on public.email_messages for select to authenticated using (public.is_admin());
drop policy if exists "admins update emails" on public.email_messages;
create policy "admins update emails" on public.email_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete emails" on public.email_messages;
create policy "admins delete emails" on public.email_messages for delete to authenticated using (public.is_admin());
drop policy if exists "admins read email events" on public.email_events;
create policy "admins read email events" on public.email_events for select to authenticated using (public.is_admin());

-- ---------- Server access with the shared secret (used by /api/email) ----------
create or replace function public.email_server(p_secret text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_id uuid;
  v_rank_old int;
  v_rank_new int;
  v_status text;
  v_src text;
  v_lead_id uuid;
  ranks constant jsonb := '{"queued":0,"skipped":0,"sent":1,"delayed":1,"delivered":2,"opened":3,"clicked":4,"bounced":5,"complained":5,"failed":5,"received":0}';
begin
  select value into v_secret from private.config where key = 'email_hook_secret';
  if v_secret is null or p_secret is distinct from v_secret then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_action = 'context' then
    return jsonb_build_object(
      'settings', (select to_jsonb(s) - 'updated_by' from public.email_settings s where id = 1),
      'template', (select to_jsonb(t) from public.email_templates t where key = p_data ->> 'template_key'),
      'alert',    (select to_jsonb(t) from public.email_templates t where key = 'team_alert'),
      'company_phone', coalesce((select value #>> '{}' from public.site_settings where key = 'phone'), '+91 99 88 99 6506')
    );

  elsif p_action = 'log' then
    insert into public.email_messages (direction, kind, status, resend_id, message_id, from_email, to_email, reply_to, subject, html,
      text_body, template_key, lead_source, lead_id, error, sent_by, meta)
    values (coalesce(p_data ->> 'direction', 'out'), p_data ->> 'kind', coalesce(p_data ->> 'status', 'sent'), nullif(p_data ->> 'resend_id', ''),
      p_data ->> 'message_id', p_data ->> 'from_email', p_data ->> 'to_email', p_data ->> 'reply_to', left(p_data ->> 'subject', 300),
      p_data ->> 'html', p_data ->> 'text_body', p_data ->> 'template_key', p_data ->> 'lead_source', nullif(p_data ->> 'lead_id', '')::uuid,
      left(p_data ->> 'error', 500), p_data ->> 'sent_by', coalesce(p_data -> 'meta', '{}'::jsonb))
    returning id into v_id;
    return jsonb_build_object('id', v_id);

  elsif p_action = 'event' then
    v_status := p_data ->> 'status';
    select id, coalesce((ranks ->> status)::int, 0) into v_id, v_rank_old
      from public.email_messages where resend_id = p_data ->> 'resend_id';
    if v_id is null then return jsonb_build_object('found', false); end if;
    v_rank_new := coalesce((ranks ->> v_status)::int, -1);
    update public.email_messages set
      status       = case when v_rank_new >= v_rank_old then v_status else status end,
      delivered_at = case when v_status in ('delivered', 'opened', 'clicked') then coalesce(delivered_at, now()) else delivered_at end,
      opened_at    = case when v_status in ('opened', 'clicked') then coalesce(opened_at, now()) else opened_at end,
      clicked_at   = case when v_status = 'clicked' then coalesce(clicked_at, now()) else clicked_at end,
      error        = coalesce(left(p_data ->> 'error', 500), error)
    where id = v_id;
    insert into public.email_events (message_id, resend_id, type, payload)
      values (v_id, p_data ->> 'resend_id', p_data ->> 'type', coalesce(p_data -> 'payload', '{}'::jsonb));
    return jsonb_build_object('found', true, 'id', v_id);

  elsif p_action = 'inbound' then
    if exists (select 1 from public.email_messages where resend_id = p_data ->> 'resend_id') then
      return jsonb_build_object('duplicate', true);
    end if;
    select x.src, x.id into v_src, v_lead_id from (
      select 'website'::text as src, e.id, e.created_at from public.enquiries e where lower(e.email) = lower(p_data ->> 'from_email')
      union all
      select 'landing', l.id, l.created_at from public.leads l where lower(l.email) = lower(p_data ->> 'from_email')
    ) x order by created_at desc limit 1;
    insert into public.email_messages (direction, kind, status, resend_id, message_id, from_email, to_email, subject, html, text_body,
      lead_source, lead_id, meta)
    values ('in', 'reply', 'received', p_data ->> 'resend_id', p_data ->> 'message_id', p_data ->> 'from_email', p_data ->> 'to_email',
      left(p_data ->> 'subject', 300), p_data ->> 'html', p_data ->> 'text_body', v_src, v_lead_id, coalesce(p_data -> 'meta', '{}'::jsonb))
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'lead_id', v_lead_id);
  end if;

  raise exception 'unknown action %', p_action;
end;
$$;
revoke all on function public.email_server(text, text, jsonb) from public;
grant execute on function public.email_server(text, text, jsonb) to anon; -- secret-gated, called by the server only

-- ---------- New lead -> /api/email/lead (asynchronous, never blocks the form) ----------
create or replace function public.email_on_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.config where key = 'email_hook_url';
  select value into v_secret from private.config where key = 'email_hook_secret';
  if v_url is null or v_url = '' then return new; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('secret', v_secret, 'source', case when tg_table_name = 'leads' then 'landing' else 'website' end,
                                 'lead', to_jsonb(new) - 'ip_address' - 'user_agent'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'email_on_new_lead: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.email_on_new_lead() from public, anon, authenticated;

drop trigger if exists email_on_new_enquiry on public.enquiries;
create trigger email_on_new_enquiry after insert on public.enquiries for each row execute function public.email_on_new_lead();
drop trigger if exists email_on_new_landing_lead on public.leads;
create trigger email_on_new_landing_lead after insert on public.leads for each row execute function public.email_on_new_lead();
