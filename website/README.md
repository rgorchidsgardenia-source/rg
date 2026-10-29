# RG Unique Structures: website

A hand-coded rebuild of rgstructures.in (previously WordPress + Elementor): every page, label and image
carried over, redesigned with a cinematic video hero, word-by-word headline reveals, parallax, a scroll-lit
philosophy statement, smooth (Lenis) scrolling, page-to-page fades, and a lead backend with an admin dashboard.

| Piece | Where |
|---|---|
| Pages | `src/pages/*.html`, shared header/footer/popup in `src/partials/`, styles `src/assets/css/site.css`, behaviour `src/assets/js/site.js` |
| Project cards, testimonials | `src/data/projects.json`, `src/data/testimonials.json` |
| Form API | `api/enquiry.js` (all forms) and `api/track.js` (anonymous analytics) |
| Database | Supabase project `wjuoykhvusqohfllejpq`, schema in `supabase/schema.sql` |
| Admin | `/admin/` (`src/admin/`) |
| Hosting | Vercel project `rg-unique-structures` (team `rg-4a5d`): https://rg-unique-structures.vercel.app |

## Run and deploy

```bash
node dev.mjs
```

Builds into `dist/` on every change and serves http://localhost:3100 (forms print to the terminal unless
`SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are set). `node build.mjs` builds once.
Deploy from this folder with `vercel deploy --prod` (project env vars: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).

## Pages

`/`, `/project/`, `/about-us/`, `/channel-partner/`, `/existing-channel-partner/`, `/careers/`, `/contact-us/`,
`/terms-and-conditions/`, `/privacy-policy/` (new), `/rg-orchid-gardenia/`, `/a-k-maple/`, `/admin/`.
The URLs match the old site, and old WordPress URLs (`/rg-gardenia/`, `/projects/...`, `/completed/...`,
`/hello-world/`, `/wp-admin/`) redirect. `/landingpage/` serves the separate RG Orchids Gardenia landing page
(proxied from its own Vercel project) and `/landing-page/` redirects to it.

Each page starts with a JSON comment holding its title, description and options, for example
`"band": {"kicker": "Jumbo Homes"}` for the enquiry strip above the footer, `"noBand": true` to hide it,
`"autoPopup": false` to stop the timed popup, `"logo": "gardenia"` for the Gardenia header logo.

## Forms and where they go

Every form posts to `/api/enquiry` and becomes a row in `public.enquiries` with a `type`:
`callback` (popup, enquiry strips, hero buttons), `project` (RG Orchids Gardenia hero form), `contact`,
`channel_partner`, `cp_lead` (existing channel partner lead registration) and `career` (new application form).
Each row keeps the page, referrer and `utm_*` / `gclid` / `fbclid` of the visit. The API inserts with the
publishable key; Row Level Security lets that key add rows and nothing else.

The popup opens once per visit after 9 seconds (and from every "Request Call Back" / "Book a Site Visit" /
"Download" button), never while someone is typing, and not again after they submit.

## Admin dashboard (`/admin/`)

- **Dashboard**: leads, new leads, follow-ups due, site visits, bookings, visitors and visitor-to-lead rate;
  leads per day; where leads come from (Google Ads, Meta Ads, utm_source, referring site, direct);
  by project, form and pipeline stage; follow-ups due; latest leads.
- **All leads / Channel partners / Careers**: search, filters, CSV export. Opening a lead shows every
  detail, one-tap call / WhatsApp / email, status (New → Contacted → Follow-up → Site visit → Negotiation →
  Booked, or Closed / Junk), follow-up date, assignee, and a notes history recording who changed what.
  Landing page leads appear here too.
- **Website analytics**: visitors, page views, top pages, referrers, devices, campaigns, and taps on call,
  WhatsApp, directions, popup opens and form submits.
- **Pipeline**: drag-and-drop board (New → Contacted → Follow-up → Site visit → Negotiation → Booked → Closed).
- **Site settings**: phone numbers, WhatsApp, email, the Gardenia starting price, the timed popup (on/off,
  delay, heading) and an announcement bar across the top of every page. Saved settings reach visitors within
  about a minute through `/api/settings` (no redeploy), and the next deploy bakes them into the HTML.
- **Repeat leads** are flagged automatically when the same phone number enquired in the last 180 days.
- **Team**: add or remove admins.

Spam protection: hidden honeypot field, per-IP rate limit, database checks on every field, and forms
report whether a person interacted with them (scripted posts are dropped and only logged).

Access: a person needs a confirmed Supabase Auth login **and** their email in `public.admin_users`.
Add the first admin in Supabase (Table Editor > `admin_users` > insert their email in lower case); after that,
admins add each other under Team. New admins open `/admin/`, choose "First time? Create your login", confirm
the email, and sign in.

Supabase settings to check (Authentication > URL Configuration): set the Site URL to the live domain and add
`https://rg-unique-structures.vercel.app/admin/` and `https://rgstructures.in/admin/` to Redirect URLs, so
confirmation and password-reset links land on the admin page. Supabase's built-in email service only sends a
few emails an hour (and only to project team members); add custom SMTP (Authentication > Emails) before
inviting several staff.

## Films

The RG Orchids Gardenia page plays the project film and model-flat walkthrough from the landing page project
(`rgorchidsgardenia.vercel.app/landing-page/assets/video/`, 1080p on desktop, 720p on phones). The home hero
loop lives in `src/assets/video/`.

## Images

Downloaded from the old site and converted to WebP (`src/assets/img/`, ~5 MB in total, from ~58 MB).
