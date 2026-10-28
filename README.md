# RG Orchids Gardenia: landing page

A hand-coded landing page for **RG Orchids Gardenia** (RG Unique Structures), built from the
brand on rgstructures.in: plum `#3C1F4B` / `#5A4067` gradients, RG gold, DM Serif Text + Inter Tight,
and the real logos, renders, floor plans and project films.

- **No WordPress, no build step.** Plain HTML/CSS/JS in `landing-page/`, so it can be dropped into any host.
- **Lead API** in `api/lead.js` (a Vercel serverless function, no dependencies).
- **Supabase-ready**: add two environment variables and leads go into a `leads` table. Until then it runs
  in *log-only* mode: every lead is printed to the Vercel function logs and nothing is lost.

## What's on the page

| Section | Notes |
|---|---|
| Hero | Muted looping clip from the project film (5 MB desktop / 2.5 MB mobile), price card, inline enquiry form |
| Stats | 2.7 acres, 132 homes, 38% UDS, 11,000+ sq.ft clubhouse, 180° views, 3 towers |
| Overview | Architecture copy, construction highlights |
| Films | Project film (3:44) and model-flat walkthrough (2:20) in a player that picks 1080p or 720p for the device and connection |
| Homes | Interactive room sizes with interiors, smart-home features |
| Amenities | Gallery with lightbox, amenity chips |
| Floor plans | Master plan open; Tower A/B/C plans blurred until the visitor submits a form (lead magnet) |
| Specifications, location (with live Google Map), site-visit form, FAQ, footer with RERA no. | |
| Popup | Opens after 10 s, then again 10-15 s after every close, rotating its offer (price sheet, floor plans, site visit, 50:50 offer). It waits while someone is watching a film, viewing an image or typing in a form, and stops for the session once they submit. |
| Mobile | Sticky Call / WhatsApp / Enquire bar |

Every form sends name, phone, email, interest, visit date, the form and button it came from, page URL,
referrer and `utm_*` / `gclid` / `fbclid` (kept for the whole visit). Submits and call/WhatsApp clicks are
pushed to `window.dataLayer` (`lead_submit`, `lead_popup_open`, `video_play`, `contact_click`) for GTM / Google Ads / Meta.

## Editing

`landing-page/assets/js/config.js` holds everything you are likely to change: the API URL, video URL,
headline price and size, and the popup timing. Copy is in `landing-page/index.html`.

## Run locally

```bash
npm run dev
```

Then open http://localhost:3000/landing-page/. Leads print in the terminal.

## Production setup

| Piece | Where |
|---|---|
| Code | https://github.com/rgorchidsgardenia-source/rg (`main` deploys to production on every push) |
| Hosting + lead API | Vercel project `rgorchidsgardenia` (team `rg-4a5d`): https://rgorchidsgardenia.vercel.app/landing-page/ |
| Leads database | Supabase project `wjuoykhvusqohfllejpq`, table `public.leads` |

**Viewing leads:** Supabase dashboard > Table Editor > `leads` (newest first by `created_at`).
Use the `status` column to track follow-up (`new`, `called`, `visit booked`, ...).

**How leads are stored:** `/api/lead` inserts with the project's *publishable* key
(Vercel env vars `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). Row Level Security lets that key insert
leads and nothing else: it cannot read, change or delete them, so no secret key lives in Vercel.
The table also rejects invalid phone numbers on its own. The schema is in `supabase/schema.sql`.

If Supabase is ever unreachable the API returns an error to the visitor (who sees the phone number) and
writes the lead to the Vercel function logs, so nothing is lost.
Optional: `LEAD_WEBHOOK_URL` also forwards each lead (Google Sheets via Apps Script, Zapier, a CRM, ...).

## Putting it on rgstructures.in/landingpage

The site is WordPress on GoDaddy (LiteSpeed + cPanel). Use `/landingpage`: `/landing-page/` is already
taken by an existing WordPress page. Pick one:

**A. Upload the folder (recommended).** Build the package, then upload and extract it in `public_html`:

```bash
node scripts/build-godaddy.mjs
```

This writes `dist/rg-orchids-landingpage-godaddy.zip` (about 3 MB): the page with `config.js` pointing the
form at `https://rgorchidsgardenia.vercel.app` and the videos at Vercel's CDN, so no video files go on
shared hosting. In cPanel > File Manager > `public_html`, upload the zip and **Extract** it, which
creates `public_html/landingpage/index.html`. LiteSpeed serves real folders directly, so WordPress is
not touched; deleting the folder undoes it. If the old 404 is still shown, purge the LiteSpeed cache
(WordPress admin > LiteSpeed Cache > Purge All).

After that, content changes need a new zip (and leads/videos keep coming from Vercel).

**B. Subdomain.** Add `offers.rgstructures.in` (or similar) as a domain in Vercel and create the CNAME it
asks for in GoDaddy DNS. Nothing to upload, but the URL is a subdomain rather than `/landing-page`.

**C. Proxy the path.** If the domain's DNS is moved to Cloudflare, a Worker route on
`rgstructures.in/landing-page*` can proxy to Vercel, so the exact URL is served from Vercel without
touching the GoDaddy server.

## Project layout

```
landing-page/           the page (static; served at /landing-page/)
  index.html
  assets/css, js, img, video
api/lead.js             POST /api/lead
supabase/schema.sql     leads table + RLS
vercel.json             redirects / -> /landing-page/, caching headers
dev-server.mjs          local preview server
```

Videos were re-encoded from the 1.45 GB and 787 MB originals to H.264 with fast-start and 2 s keyframes,
so they start immediately and seek without stalling.
