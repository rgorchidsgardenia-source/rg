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

## Connect Supabase (when the new account is ready)

1. In the new Supabase project, open **SQL Editor** and run `supabase/schema.sql`.
2. In Vercel > Project > Settings > Environment Variables add:
   - `SUPABASE_URL`: Project Settings > API > Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings > API > `service_role` key (server-only; never put it in the page)
3. Redeploy. The API response changes from `"stored": false` to `"stored": true`.

The browser never talks to Supabase directly; Row Level Security is on and only the server key can read or write.
Optional: `LEAD_WEBHOOK_URL` also forwards each lead (Google Sheets via Apps Script, Zapier, a CRM, ...).

## Putting it on rgstructures.in/landing-page

The site is WordPress on GoDaddy. Pick one:

**A. Upload the folder (recommended).** Upload the contents of `landing-page/` to
`public_html/landing-page/` with cPanel File Manager or FTP. WordPress's `.htaccess` only rewrites URLs
that are *not* real files or folders, so Apache serves this folder directly and WordPress is untouched.
Then in `assets/js/config.js` set:

```js
apiBase: 'https://<your-vercel-project>.vercel.app',
videoBase: 'https://<your-vercel-project>.vercel.app/landing-page/assets/video/',
```

The form keeps posting to the Vercel API (rgstructures.in is already allowed by CORS), and the heavy
videos keep streaming from Vercel's CDN instead of shared hosting, so you can skip uploading
`assets/video/` except the three `*-poster.jpg` files. Make sure no WordPress page uses the slug `landing-page`.
If the plan is GoDaddy *Managed WordPress* (no cPanel), use its SFTP access to upload to the site root.

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
