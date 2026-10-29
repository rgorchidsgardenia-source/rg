-- RG Unique Structures website: enquiries, analytics and the admin dashboard.
-- Applied to the production Supabase project as migration "website_enquiries_admin".
-- The landing page's public.leads table (../supabase/schema.sql) is shared with the admin too.
--
-- Access model
--   * Visitors never talk to Supabase. The website's /api functions insert rows with the
--     publishable key, which may INSERT enquiries and analytics events and nothing else.
--   * Staff sign in on /admin with Supabase Auth. Only confirmed accounts whose email is in
--     public.admin_users can read or update anything (see public.is_admin()).

-- ---------- Admins ----------
create table if not exists public.admin_users (
  email      text primary key check (email = lower(email) and char_length(email) <= 120),
  name       text check (char_length(name) <= 80),
  created_at timestamptz not null default now(),
  added_by   text
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_users a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select, insert, delete on public.admin_users to authenticated;
drop policy if exists "admins read admins" on public.admin_users;
create policy "admins read admins" on public.admin_users for select to authenticated using (public.is_admin());
drop policy if exists "admins add admins" on public.admin_users;
create policy "admins add admins" on public.admin_users for insert to authenticated with check (public.is_admin());
drop policy if exists "admins remove admins" on public.admin_users;
create policy "admins remove admins" on public.admin_users for delete to authenticated
  using (public.is_admin() and email <> lower(coalesce(auth.jwt() ->> 'email', '')));

-- ---------- Website enquiries ----------
create table if not exists public.enquiries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  type          text not null check (type in ('callback', 'contact', 'project', 'channel_partner', 'cp_lead', 'career')),
  status        text not null default 'new'
                check (status in ('new', 'contacted', 'follow_up', 'site_visit', 'negotiation', 'booked', 'closed', 'junk')),
  name          text not null check (char_length(name) between 2 and 80),
  phone         text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email         text check (char_length(email) <= 120),
  city          text check (char_length(city) <= 80),
  message       text check (char_length(message) <= 1000),
  project       text check (char_length(project) <= 80),
  configuration text check (char_length(configuration) <= 40),
  visit_date    date,
  visit_time    text check (char_length(visit_time) <= 10),
  partner_name  text check (char_length(partner_name) <= 80),
  address       text check (char_length(address) <= 300),
  rera_no       text check (char_length(rera_no) <= 80),
  position      text check (char_length(position) <= 60),
  experience    text check (char_length(experience) <= 40),
  profile_url   text check (char_length(profile_url) <= 300),
  consent       boolean not null default false,
  cta           text check (char_length(cta) <= 60),
  form_id       text check (char_length(form_id) <= 60),
  page_url      text check (char_length(page_url) <= 500),
  referrer      text check (char_length(referrer) <= 300),
  utm_source    text check (char_length(utm_source) <= 200),
  utm_medium    text check (char_length(utm_medium) <= 200),
  utm_campaign  text check (char_length(utm_campaign) <= 200),
  utm_term      text check (char_length(utm_term) <= 200),
  utm_content   text check (char_length(utm_content) <= 200),
  gclid         text check (char_length(gclid) <= 200),
  fbclid        text check (char_length(fbclid) <= 200),
  session_id    text check (char_length(session_id) <= 64),
  user_agent    text check (char_length(user_agent) <= 300),
  ip_address    text check (char_length(ip_address) <= 64),
  country       text check (char_length(country) <= 8),
  assigned_to   text check (char_length(assigned_to) <= 120),
  follow_up_at  timestamptz
);
create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);
create index if not exists enquiries_phone_idx on public.enquiries (phone);
create index if not exists enquiries_status_idx on public.enquiries (status);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists enquiries_touch on public.enquiries;
create trigger enquiries_touch before update on public.enquiries for each row execute function public.touch_updated_at();

alter table public.enquiries enable row level security;
revoke all on public.enquiries from anon, authenticated;
grant insert on public.enquiries to anon;
grant select, update, delete on public.enquiries to authenticated;
drop policy if exists "website can add enquiries" on public.enquiries;
create policy "website can add enquiries" on public.enquiries for insert to anon
  with check (status = 'new' and assigned_to is null and follow_up_at is null);
drop policy if exists "admins read enquiries" on public.enquiries;
create policy "admins read enquiries" on public.enquiries for select to authenticated using (public.is_admin());
drop policy if exists "admins update enquiries" on public.enquiries;
create policy "admins update enquiries" on public.enquiries for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete enquiries" on public.enquiries;
create policy "admins delete enquiries" on public.enquiries for delete to authenticated using (public.is_admin());

-- ---------- Landing page leads: let admins work them too ----------
alter table public.leads add column if not exists updated_at timestamptz not null default now();
alter table public.leads add column if not exists assigned_to text check (char_length(assigned_to) <= 120);
alter table public.leads add column if not exists follow_up_at timestamptz;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
grant select, delete on public.leads to authenticated;
grant update (status, assigned_to, follow_up_at) on public.leads to authenticated;
drop policy if exists "admins read leads" on public.leads;
create policy "admins read leads" on public.leads for select to authenticated using (public.is_admin());
drop policy if exists "admins update leads" on public.leads;
create policy "admins update leads" on public.leads for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete leads" on public.leads;
create policy "admins delete leads" on public.leads for delete to authenticated using (public.is_admin());

-- ---------- Follow-up notes and history ----------
create table if not exists public.lead_activity (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source     text not null check (source in ('website', 'landing')),
  lead_id    uuid not null,
  actor      text not null default '',
  kind       text not null check (kind in ('note', 'status', 'follow_up', 'assign')),
  body       text not null check (char_length(body) between 1 and 2000)
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at desc);

create or replace function public.set_activity_actor() returns trigger
language plpgsql set search_path = '' as $$
begin new.actor := coalesce(auth.jwt() ->> 'email', 'system'); return new; end $$;
drop trigger if exists lead_activity_actor on public.lead_activity;
create trigger lead_activity_actor before insert on public.lead_activity for each row execute function public.set_activity_actor();

alter table public.lead_activity enable row level security;
revoke all on public.lead_activity from anon, authenticated;
grant select, insert on public.lead_activity to authenticated;
drop policy if exists "admins read activity" on public.lead_activity;
create policy "admins read activity" on public.lead_activity for select to authenticated using (public.is_admin());
drop policy if exists "admins add activity" on public.lead_activity;
create policy "admins add activity" on public.lead_activity for insert to authenticated with check (public.is_admin());

-- ---------- Anonymous site analytics ----------
create table if not exists public.site_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  event        text not null check (event in ('page_view', 'call_click', 'whatsapp_click', 'email_click', 'directions_click', 'popup_open', 'form_submit')),
  label        text check (char_length(label) <= 120),
  path         text not null check (char_length(path) <= 300),
  session_id   text check (char_length(session_id) <= 64),
  referrer     text check (char_length(referrer) <= 300),
  device       text check (device in ('mobile', 'tablet', 'desktop')),
  country      text check (char_length(country) <= 8),
  utm_source   text check (char_length(utm_source) <= 200),
  utm_medium   text check (char_length(utm_medium) <= 200),
  utm_campaign text check (char_length(utm_campaign) <= 200)
);
create index if not exists site_events_created_idx on public.site_events (created_at desc);
create index if not exists site_events_event_idx on public.site_events (event, created_at desc);

alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
grant insert on public.site_events to anon;
grant select on public.site_events to authenticated;
drop policy if exists "website can add events" on public.site_events;
create policy "website can add events" on public.site_events for insert to anon with check (true);
drop policy if exists "admins read events" on public.site_events;
create policy "admins read events" on public.site_events for select to authenticated using (public.is_admin());

-- ---------- One inbox for the admin (respects the RLS above) ----------
create or replace view public.inbox with (security_invoker = true) as
  select id, created_at, updated_at, 'website'::text as source, type, status, name, phone, email, project, city, message,
         configuration, visit_date, visit_time, partner_name, address, rera_no, position, experience, profile_url, consent,
         cta, form_id, page_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid,
         country, assigned_to, follow_up_at
  from public.enquiries
  union all
  select id, created_at, updated_at, 'landing', 'landing_page', status, name, phone, email, project, null, null,
         interest, visit_date, null, null, null, null, null, null, null, false,
         null, form_id, page_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid,
         null, assigned_to, follow_up_at
  from public.leads;
revoke all on public.inbox from anon, authenticated;
grant select on public.inbox to authenticated;

-- ---------- Dashboard numbers in one call ----------
create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  with l as (
    select i.*,
      case
        when coalesce(i.gclid, '') <> '' then 'Google Ads'
        when coalesce(i.fbclid, '') <> '' then 'Meta Ads'
        when coalesce(i.utm_source, '') <> '' then i.utm_source
        when coalesce(i.referrer, '') = '' or i.referrer ~* 'rgstructures|vercel\.app' then 'Direct'
        else coalesce(substring(i.referrer from '^https?://(?:www\.)?([^/:]+)'), 'Other')
      end as channel
    from public.inbox i
    where i.created_at >= p_from and i.created_at < p_to
  ),
  e as (
    select * from public.site_events s where s.created_at >= p_from and s.created_at < p_to
  )
  select jsonb_build_object(
    'leads',        (select count(*) from l),
    'open_new',     (select count(*) from public.inbox where status = 'new'),
    'booked',       (select count(*) from l where status = 'booked'),
    'site_visits',  (select count(*) from l where status = 'site_visit'),
    'due_follow_ups', (select count(*) from public.inbox where follow_up_at is not null and follow_up_at < now() + interval '1 day' and status not in ('booked', 'closed', 'junk')),
    'leads_by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
                     from (select (created_at at time zone 'Asia/Kolkata')::date d, count(*) n from l group by 1) x),
    'by_type',      (select coalesce(jsonb_agg(jsonb_build_object('k', type, 'n', n) order by n desc), '[]'::jsonb)
                     from (select type, count(*) n from l group by 1) x),
    'by_status',    (select coalesce(jsonb_agg(jsonb_build_object('k', status, 'n', n) order by n desc), '[]'::jsonb)
                     from (select status, count(*) n from l group by 1) x),
    'by_project',   (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                     from (select coalesce(nullif(project, ''), 'Not specified') k, count(*) n from l group by 1) x),
    'by_channel',   (select coalesce(jsonb_agg(jsonb_build_object('k', channel, 'n', n) order by n desc), '[]'::jsonb)
                     from (select channel, count(*) n from l group by 1) x),
    'by_campaign',  (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                     from (select utm_campaign k, count(*) n from l where coalesce(utm_campaign, '') <> '' group by 1 limit 10) x),
    'views',        (select count(*) from e where event = 'page_view'),
    'visitors',     (select count(distinct session_id) from e where event = 'page_view'),
    'views_by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n, 'v', v) order by d), '[]'::jsonb)
                     from (select (created_at at time zone 'Asia/Kolkata')::date d, count(*) n, count(distinct session_id) v
                           from e where event = 'page_view' group by 1) x),
    'top_pages',    (select coalesce(jsonb_agg(jsonb_build_object('k', path, 'n', n) order by n desc), '[]'::jsonb)
                     from (select path, count(*) n from e where event = 'page_view' group by 1 order by 2 desc limit 10) x),
    'referrers',    (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc), '[]'::jsonb)
                     from (select coalesce(substring(referrer from '^https?://(?:www\.)?([^/:]+)'), 'Direct') k, count(distinct session_id) n
                           from e where event = 'page_view' and coalesce(referrer, '') !~* 'rgstructures|localhost|vercel\.app'
                           group by 1 order by 2 desc limit 10) x),
    'devices',      (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(device, 'unknown'), 'n', n) order by n desc), '[]'::jsonb)
                     from (select device, count(distinct session_id) n from e where event = 'page_view' group by 1) x),
    'clicks',       (select coalesce(jsonb_object_agg(event, n), '{}'::jsonb)
                     from (select event, count(*) n from e where event <> 'page_view' group by 1) x)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to authenticated;
