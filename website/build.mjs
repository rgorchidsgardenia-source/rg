// Builds the static site into dist/.
//
//   src/pages/*.html     one file per page. The first line is a JSON comment with page settings:
//                        <!--{"title": "...", "path": "/about-us/", "description": "..."}-->
//   src/partials/*.html  shared markup, included with {{> name}}
//   src/data/*.json      content rendered by the {{@...}} helpers below
//
// Placeholders: {{key}} reads the page settings (dots allowed: {{band.title}}), {{> partial}}
// includes a partial, {{@helper arg}} runs a helper. No dependencies, so Vercel can run it as is.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const final = join(root, 'dist');
// Build into a private folder and swap it in at the end, so a half-built dist/ is never served.
const out = join(root, `.dist-${process.pid}`);
const SITE = 'https://rgstructures.in';

const read = (p) => readFileSync(p, 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const projects = JSON.parse(read(join(src, 'data', 'projects.json')));
const testimonials = JSON.parse(read(join(src, 'data', 'testimonials.json')));

// Site settings: defaults from src/data/site.json, overridden by what admins saved in /admin
// (Supabase public.site_settings) when the build has the Supabase env vars. The browser also
// fetches /api/settings, so admin changes show up before the next deploy.
const settings = JSON.parse(read(join(src, 'data', 'site.json')));
if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/site_settings?select=key,value`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    for (const row of await r.json()) if (row.key in settings) settings[row.key] = row.value;
  } catch (err) { console.warn('Could not read site settings:', err.message); }
}
const withSettings = (text) => text.replace(/\{\{s\.(\w+)\}\}/g, (_, k) => String(settings[k] ?? ''));

function hashOf(files) {
  const h = createHash('sha1');
  for (const f of files) h.update(read(join(src, f)));
  return h.digest('hex').slice(0, 10);
}
const version = hashOf(['assets/css/site.css', 'assets/css/premium.css', 'assets/js/site.js']);

const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function projectCard(p) {
  const badge = { ongoing: 'Ongoing', upcoming: 'Upcoming', completed: 'Completed' }[p.status];
  const items = p.details.map((d) => `<li>${icon('chev')}<span>${esc(d)}</span></li>`).join('');
  const link = p.url
    ? `<a class="pcard__cover" href="${p.url}" aria-label="View ${esc(p.name)}"></a>`
    : '';
  const more = p.url ? `<div class="pcard__more"><span class="link-arrow">View project ${icon('arrow')}</span></div>` : '';
  const go = p.url ? `<span class="pcard__go">${icon('arrow')}</span>` : '';
  return `<article class="pcard reveal">
  ${link}
  <div class="pcard__media">
    <img src="/assets/img/projects/${p.image}" alt="${esc(p.name)}" width="900" height="506" loading="lazy" decoding="async">
    <span class="pcard__badge pcard__badge--${p.status}">${badge}</span>
    ${p.soldOut ? '<span class="pcard__sold">Sold Out</span>' : ''}
    ${go}
  </div>
  <div class="pcard__body">
    <h3 class="pcard__title">${esc(p.name)}</h3>
    <ul class="pcard__list">${items}</ul>
    ${more}
  </div>
</article>`;
}

const helpers = {
  // Tabbed project grid: {{@projects}}
  projects(arg, page) {
    const id = (arg || 'p').trim();
    const tabs = [['all', 'All'], ['ongoing', 'Ongoing'], ['upcoming', 'Upcoming'], ['completed', 'Completed']];
    const btns = tabs.map(([k, label], i) =>
      `<button class="tab" role="tab" id="${id}-tab-${k}" aria-controls="${id}-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join('');
    const panels = tabs.map(([k], i) => {
      const list = projects.filter((p) => k === 'all' || p.status === k);
      return `<div class="tabpanel" role="tabpanel" id="${id}-${k}" aria-labelledby="${id}-tab-${k}"${i ? ' hidden' : ''}>
  <div class="projects">${list.map(projectCard).join('\n')}</div>
</div>`;
    }).join('\n');
    const Tag = 'h2';
    return `<div class="tabs-row reveal"><${Tag} class="h2">Our Projects</${Tag}><div class="tabs" role="tablist" aria-label="Filter projects" data-tabs>${btns}</div></div>\n${panels}`;
  },
  project(slug) {
    const p = projects.find((x) => x.slug === slug.trim());
    if (!p) throw new Error(`Unknown project ${slug}`);
    return projectCard(p);
  },
  // Testimonial carousel slides: {{@testimonials home}}
  testimonials(set) {
    return (testimonials[set.trim()] || []).map((t) => `<article class="quote">
  <img src="/assets/img/people/${t.image}" alt="${esc(t.family)}" width="760" height="330" loading="lazy" decoding="async">
  <div class="quote__body">
    <div class="quote__who"><strong>${esc(t.family)}</strong><span>${esc(t.city)}</span></div>
    <blockquote>“${esc(t.quote)}”</blockquote>
    <cite>– ${esc(t.name)}</cite>
  </div>
</article>`).join('\n');
  },
  icon(name) { return icon(name.trim()); },
  band(_, page) { return page.noBand ? '' : render(read(join(src, 'partials', 'band.html')), page); },
  nav(_, page) {
    const items = [['/', 'Home'], ['/project/', 'Projects'], ['/about-us/', 'About Us'], ['/channel-partner/', 'Channel Partner'], ['/careers/', 'Careers'], ['/contact-us/', 'Contact']];
    return items.map(([href, label]) => {
      const current = page.path === href || (page.section && page.section === href);
      return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('');
  }
};

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function render(tpl, page, depth = 0) {
  if (depth > 8) throw new Error('Partial nesting too deep');
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => render(read(join(src, 'partials', `${name}.html`)), page, depth + 1))
    .replace(/\{\{@([\w-]+)([^}]*)\}\}/g, (_, name, arg) => {
      if (!helpers[name]) throw new Error(`Unknown helper @${name}`);
      return helpers[name](arg, page);
    })
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const v = get(page, key);
      if (v === undefined) throw new Error(`Missing value {{${key}}} on ${page.path}`);
      return v;
    });
}

const defaults = {
  logo: 'rg',
  description: 'RG Unique Structures, established in 2006, is a Bangalore real estate developer with two decades of expertise, delivering 40+ projects spanning 30+ lakh sq. ft.',
  image: '/assets/img/home/hero-1.webp',
  band: { kicker: 'Villomes', title: `Starting at ${settings.price}`, project: 'RG Orchids Gardenia' },
  popup: { kicker: 'Request a call back', title: settings.popup_title, price: `RG Orchids Gardenia · Starting at ${settings.price}`, project: 'RG Orchids Gardenia' },
  autoPopup: true,
  section: '',
  extraHead: ''
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(src, 'admin'), join(out, 'admin'), { recursive: true });
for (const f of ['robots.txt', 'favicon.ico']) {
  try { cpSync(join(src, f), join(out, f)); } catch { /* optional */ }
}

const layout = read(join(src, 'partials', 'layout.html'));
const urls = [];
for (const file of readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html'))) {
  const raw = read(join(src, 'pages', file));
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\s*/);
  if (!m) throw new Error(`${file}: missing settings comment`);
  const meta = JSON.parse(withSettings(m[1]));
  const page = {
    ...defaults, ...meta,
    band: { ...defaults.band, ...(meta.band || {}) },
    popup: { ...defaults.popup, ...(meta.popup || {}) },
    v: version, site: SITE, s: settings
  };
  page.sJson = JSON.stringify(settings).replace(/</g, '\\u003c');
  page.canonical = SITE + page.path;
  page.autoAttr = page.autoPopup ? ' data-auto' : '';
  page.logoHtml = page.logo === 'gardenia'
    ? '<a class="header__logo header__logo--gardenia header__logo--swap" href="/" aria-label="RG Unique Structures home"><img class="logo-dark" src="/assets/img/brand/gardenia-logo.webp" alt="RG Orchids Gardenia" width="640" height="265"><img class="logo-light" src="/assets/img/brand/gardenia-logo-white.svg" alt="" width="191" height="64"></a>'
    : '<a class="header__logo" href="/" aria-label="RG Unique Structures home"><img src="/assets/img/brand/rg-logo.webp" alt="RG Unique Structures" width="520" height="350"></a>';
  page.content = render(raw.slice(m[0].length), page);
  const html = render(layout, page);
  const dest = file === 'index.html' ? join(out, 'index.html')
    : file === '404.html' ? join(out, '404.html')
      : join(out, page.path.replace(/^\/|\/$/g, ''), 'index.html');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  if (!page.noindex) urls.push(page.canonical);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.sort().map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);

rmSync(final, { recursive: true, force: true });
renameSync(out, final);

const size = (d) => readdirSync(d).reduce((n, f) => { const p = join(d, f); const s = statSync(p); return n + (s.isDirectory() ? size(p) : s.size); }, 0);
console.log(`Built ${urls.length} pages into dist/ (${(size(final) / 1048576).toFixed(1)} MB, assets v${version})`);
