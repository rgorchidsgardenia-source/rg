-- RG Orchids Gardenia: lead capture table.
-- Applied to the production Supabase project as migration "create_leads_table".
-- Re-running it is safe.

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  project      text not null default 'RG Orchids Gardenia',
  name         text not null check (char_length(name) between 2 and 80),
  phone        text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email        text check (email is null or char_length(email) <= 120),
  interest     text check (char_length(interest) <= 40),
  visit_date   date,
  form_id      text check (char_length(form_id) <= 60),
  page_url     text check (char_length(page_url) <= 500),
  referrer     text check (char_length(referrer) <= 300),
  utm_source   text check (char_length(utm_source) <= 200),
  utm_medium   text check (char_length(utm_medium) <= 200),
  utm_campaign text check (char_length(utm_campaign) <= 200),
  utm_term     text check (char_length(utm_term) <= 200),
  utm_content  text check (char_length(utm_content) <= 200),
  gclid        text check (char_length(gclid) <= 200),
  fbclid       text check (char_length(fbclid) <= 200),
  user_agent   text check (char_length(user_agent) <= 300),
  ip_address   text check (char_length(ip_address) <= 64),
  status       text not null default 'new'
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

-- Access model
--   * The browser never talks to Supabase. Only /api/lead on Vercel does.
--   * /api/lead uses the project's publishable (anon) key, which may INSERT new
--     leads and nothing else: it cannot read, update or delete them.
--   * Leads are read in the Supabase dashboard (or with the secret key).
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon;

drop policy if exists "landing page can add leads" on public.leads;
create policy "landing page can add leads"
  on public.leads for insert to anon
  with check (status = 'new' and project = 'RG Orchids Gardenia');
