-- RG Orchids Gardenia: lead capture table.
-- Run this once in the Supabase SQL editor (or as a migration) on the new project,
-- then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  project      text not null default 'RG Orchids Gardenia',
  name         text not null check (char_length(name) between 2 and 80),
  phone        text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email        text,
  interest     text,
  visit_date   date,
  form_id      text,
  page_url     text,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  fbclid       text,
  user_agent   text,
  ip_address   text,
  status       text not null default 'new'
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

-- Lock the table down. Only the server-side service role key (used by
-- /api/lead on Vercel) can read or write; the browser never talks to Supabase.
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
