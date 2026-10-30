/* RG Unique Structures admin: leads inbox, follow-ups and website analytics.
   Data access is enforced by Supabase Row Level Security: only confirmed accounts listed in
   public.admin_users can read or change anything. The key below is the public (publishable) key. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://wjuoykhvusqohfllejpq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_tu8Mp4Ae7zUwhtqxGlLKiA_GQlO-tUf';
  var PAGE = 25;

  var STATUSES = [
    ['new', 'New'], ['contacted', 'Contacted'], ['follow_up', 'Follow-up'], ['site_visit', 'Site visit'],
    ['negotiation', 'Negotiation'], ['booked', 'Booked'], ['closed', 'Closed / lost'], ['junk', 'Junk']
  ];
  var TYPES = {
    callback: 'Call-back', project: 'Project enquiry', contact: 'Contact page', landing_page: 'Landing page',
    channel_partner: 'CP sign-up', cp_lead: 'CP lead', career: 'Job application'
  };
  var CLICKS = [['call_click', 'Call taps'], ['whatsapp_click', 'WhatsApp taps'], ['directions_click', 'Direction taps'],
    ['email_click', 'Email taps'], ['popup_open', 'Popup opens'], ['form_submit', 'Form submits']];

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var state = { view: 'dashboard', page: 0, rows: [], current: null, lastNew: null, user: null };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var tz = { timeZone: 'Asia/Kolkata' };
  function fmtDate(iso, withTime) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('en-IN', Object.assign({ day: 'numeric', month: 'short' }, withTime === false ? {} : { hour: 'numeric', minute: '2-digit' }, tz));
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return fmtDate(iso, false);
  }
  function statusLabel(s) { var f = STATUSES.find(function (x) { return x[0] === s; }); return f ? f[1] : s; }
  function badge(s) { return '<span class="badge st-' + esc(s) + '">' + esc(statusLabel(s)) + '</span>'; }
  function channel(r) {
    if (r.gclid) return 'Google Ads';
    if (r.fbclid) return 'Meta Ads';
    if (r.utm_source) return r.utm_source;
    if (!r.referrer || /rgstructures|vercel\.app/i.test(r.referrer)) return 'Direct';
    var m = /^https?:\/\/(?:www\.)?([^/:]+)/i.exec(r.referrer);
    return m ? m[1] : 'Other';
  }
  function rangeFrom() {
    var days = Number($('#range').value);
    // Ranges are counted in whole days, India time: "Today" starts at midnight IST.
    var startIst = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('en-CA', tz);
    return new Date(startIst + 'T00:00:00+05:30').toISOString();
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('is-on'); }, 3800);
  }
  function fail(err) { console.error(err); toast(err && err.message ? err.message : 'Something went wrong'); }
  function tableFor(r) { return r.source === 'landing' ? 'leads' : 'enquiries'; }
  function digits(p) { return String(p || '').replace(/\D/g, ''); }

  /* ---------- auth (sign in only; the admin login already exists) ---------- */
  function msg(text, ok) { var m = $('#authMsg'); m.textContent = text; m.className = 'auth__msg ' + (text ? (ok ? 'ok' : 'err') : ''); }

  $('#authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#authForm [name=email]').value.trim().toLowerCase();
    var password = $('#authForm [name=password]').value;
    var btn = $('#authBtn');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Enter a valid email'); return; }
    if (!password) { msg('Enter your password'); return; }
    btn.disabled = true; msg('');
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw res.error;
    }).catch(function (err) {
      msg(/Invalid login/i.test(err.message) ? 'Wrong email or password.' : err.message);
    }).then(function () { btn.disabled = false; });
  });
  $$('[data-signout]').forEach(function (b) { b.addEventListener('click', function () { sb.auth.signOut().then(function () { location.replace('/admin/'); }); }); });

  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' && !state.user) boot();
  });

  function show(which) {
    $('#auth').hidden = which !== 'auth';
    $('#denied').hidden = which !== 'denied';
    $('#app').hidden = which !== 'app';
  }

  function boot() {
    sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) { show('auth'); return; }
      return sb.rpc('is_admin').then(function (res) {
        if (res.error || !res.data) { $('#deniedEmail').textContent = session.user.email; show('denied'); return; }
        if (state.user) return;
        state.user = session.user;
        $('#whoami').textContent = session.user.email;
        show('app');
        startApp();
      });
    }).catch(fail);
  }

  /* ---------- app shell ---------- */
  var VIEWS = { dashboard: 'Dashboard', leads: 'All leads', pipeline: 'Pipeline', emails: 'Emails', automation: 'Email automation', partners: 'Channel partners', careers: 'Careers', analytics: 'Website analytics', settings: 'Site settings' };
  function route() {
    var v = (location.hash || '#dashboard').slice(1);
    if (!VIEWS[v]) v = 'dashboard';
    state.view = v;
    $('#viewTitle').textContent = VIEWS[v];
    $$('.side__nav a').forEach(function (a) { a.classList.toggle('is-active', a.dataset.view === v); });
    var panel = v === 'partners' || v === 'careers' ? 'leads' : v;
    $$('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + panel; });
    $('#app').classList.remove('nav-open');
    $('#range').hidden = v === 'settings' || v === 'automation';
    if (panel === 'leads') {
      var typeSel = $('#fType');
      typeSel.hidden = v !== 'leads';
      $('#fProject').hidden = v === 'careers';
      state.page = 0;
    }
    load();
  }
  function load() {
    if (state.view === 'dashboard') return loadDashboard();
    if (state.view === 'analytics') return loadDashboard();
    if (state.view === 'pipeline') return loadBoard();
    if (state.view === 'settings') return loadSettings();
    if (state.view === 'emails') return loadEmails();
    if (state.view === 'automation') return loadAutomation();
    return loadLeads();
  }

  function startApp() {
    var st = $('#fStatus');
    STATUSES.forEach(function (s) { st.insertAdjacentHTML('beforeend', '<option value="' + s[0] + '">' + s[1] + '</option>'); });
    var ds = $('#dStatus');
    STATUSES.forEach(function (s) { ds.insertAdjacentHTML('beforeend', '<option value="' + s[0] + '">' + s[1] + '</option>'); });
    window.addEventListener('hashchange', route);
    $('#range').addEventListener('change', function () { state.page = 0; load(); });
    $('#refreshBtn').addEventListener('click', load);
    $('#menuBtn').addEventListener('click', function () { $('#app').classList.toggle('nav-open'); });
    var t;
    $('#q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.page = 0; loadLeads(); }, 300); });
    ['#fType', '#fStatus', '#fProject', '#fDue'].forEach(function (s) { $(s).addEventListener('change', function () { state.page = 0; loadLeads(); }); });
    $('#prevPage').addEventListener('click', function () { if (state.page > 0) { state.page--; loadLeads(); } });
    $('#nextPage').addEventListener('click', function () { state.page++; loadLeads(); });
    $('#exportBtn').addEventListener('click', exportCsv);
    $$('[data-filter-followup]').forEach(function (a) { a.addEventListener('click', function () { $('#fDue').checked = true; }); });
    $('#settingsForm').addEventListener('submit', saveSettings);
    bindEmails();
    route();
    pollNew();
    setInterval(pollNew, 60000);
    setInterval(function () { if (!document.hidden && state.view === 'dashboard') loadDashboard(); }, 120000);
  }

  function pollNew() {
    sb.from('inbox').select('id', { count: 'exact', head: true }).eq('status', 'new').then(function (r) {
      if (r.error) return;
      var n = r.count || 0; var pill = $('#newCount');
      pill.hidden = !n; pill.textContent = n;
      if (state.lastNew !== null && n > state.lastNew) {
        toast('New lead received');
        if (state.view !== 'analytics') load();
      }
      state.lastNew = n;
    });
    sb.from('email_messages').select('id', { count: 'exact', head: true }).eq('direction', 'in').is('read_at', null).then(function (r) {
      if (r.error) return;
      var n = r.count || 0; var pill = $('#replyCount');
      pill.hidden = !n; pill.textContent = n;
      if (state.lastReplies !== undefined && n > state.lastReplies) { toast('New email reply received'); if (state.view === 'emails') loadEmails(); }
      state.lastReplies = n;
    });
  }

  /* ---------- dashboard + analytics ---------- */
  function bars(el, list, labels) {
    if (!list || !list.length) { el.innerHTML = '<div class="empty">No data yet</div>'; return; }
    var max = Math.max.apply(null, list.map(function (x) { return x.n; }));
    el.innerHTML = list.slice(0, 8).map(function (x) {
      var label = labels ? (labels[x.k] || x.k) : x.k;
      return '<div class="barrow"><span title="' + esc(label) + '">' + esc(label) + '</span><b>' + x.n.toLocaleString('en-IN') + '</b><i style="--w:' + Math.max(3, Math.round(x.n / max * 100)) + '%"></i></div>';
    }).join('');
  }
  function fillDays(series, keyA, keyB) {
    var days = Number($('#range').value);
    var map = {}; (series || []).forEach(function (x) { map[x.d] = x; });
    if (days > 90) return (series || []).map(function (x) { return { d: x.d, a: x[keyA], b: keyB ? x[keyB] : 0 }; });
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', tz);
      var x = map[d] || {};
      out.push({ d: d, a: x[keyA] || 0, b: keyB ? (x[keyB] || 0) : 0 });
    }
    return out;
  }
  function chart(el, points, twoSeries) {
    if (!points.length || points.every(function (p) { return !p.a && !p.b; })) { el.innerHTML = '<div class="empty">No data in this period</div>'; return; }
    var W = 800, H = 220, pad = 24, bottom = 22;
    var max = Math.max(1, Math.max.apply(null, points.map(function (p) { return Math.max(p.a, p.b); })));
    var step = (W - pad) / points.length; var bw = Math.max(2, step * 0.62);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Chart">';
    [0.5, 1].forEach(function (f) { var y = H - bottom - (H - bottom - 10) * f; svg += '<line class="grid-line" x1="' + pad + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/><text class="axis" x="0" y="' + (y + 3) + '">' + Math.round(max * f) + '</text>'; });
    points.forEach(function (p, i) {
      var x = pad + i * step + (step - bw) / 2;
      var hb = (H - bottom - 10) * (twoSeries ? p.b : 0) / max;
      var ha = (H - bottom - 10) * p.a / max;
      if (twoSeries && hb) svg += '<rect class="bar2" x="' + x + '" y="' + (H - bottom - hb) + '" width="' + bw + '" height="' + hb + '" rx="2"><title>' + p.d + ': ' + p.b + ' page views</title></rect>';
      if (ha) svg += '<rect class="bar" x="' + (twoSeries ? x + bw * 0.2 : x) + '" y="' + (H - bottom - ha) + '" width="' + (twoSeries ? bw * 0.6 : bw) + '" height="' + ha + '" rx="2"><title>' + p.d + ': ' + p.a + '</title></rect>';
      var every = Math.ceil(points.length / 8);
      if (i % every === 0) svg += '<text class="axis" x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + new Date(p.d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</text>';
    });
    el.innerHTML = svg + '</svg>';
  }
  function kpi(label, value, note) {
    return '<div class="kpi"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }
  function miniList(el, rows, empty) {
    if (!rows.length) { el.innerHTML = '<div class="empty">' + empty + '</div>'; return; }
    el.innerHTML = '<div class="mini">' + rows.map(function (r) {
      return '<a href="#" data-open="' + r.id + '"><span><b>' + esc(r.name) + '</b> <span class="muted small">' + esc(TYPES[r.type] || r.type) + (r.project ? ' · ' + esc(r.project) : '') + '</span></span>' + badge(r.status) +
        '<span class="muted small">' + (r.follow_up_at ? '<span class="' + (new Date(r.follow_up_at) < new Date() ? 'overdue' : '') + '">' + fmtDate(r.follow_up_at) + '</span>' : ago(r.created_at)) + '</span></a>';
    }).join('') + '</div>';
    $$('[data-open]', el).forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var r = rows.find(function (x) { return x.id === a.dataset.open; }); openLead(r); });
    });
  }

  function loadDashboard() {
    var from = rangeFrom(); var to = new Date(Date.now() + 60000).toISOString();
    sb.rpc('admin_dashboard', { p_from: from, p_to: to }).then(function (res) {
      if (res.error) throw res.error;
      var d = res.data; var c = d.clicks || {};
      var conv = d.visitors ? (d.leads / d.visitors * 100).toFixed(1) + '%' : '–';
      if (state.view === 'dashboard') {
        $('#kpis').innerHTML = kpi('Leads', d.leads.toLocaleString('en-IN'), 'in this period') + kpi('New, not yet contacted', d.open_new, 'all time') +
          kpi('Follow-ups due', d.due_follow_ups, 'today or overdue') + kpi('Site visits', d.site_visits) + kpi('Booked', d.booked) +
          kpi('Visitors', d.visitors.toLocaleString('en-IN')) + kpi('Visitor → lead', conv);
        $('#leadsTotal').textContent = d.leads + ' leads';
        chart($('#leadsChart'), fillDays(d.leads_by_day, 'n'));
        bars($('#byChannel'), d.by_channel);
        bars($('#byProject'), d.by_project);
        bars($('#byType'), d.by_type, TYPES);
        bars($('#byStatus'), d.by_status, Object.fromEntries(STATUSES));
        var now = new Date(Date.now() + 86400000).toISOString();
        sb.from('inbox').select('*').not('follow_up_at', 'is', null).lte('follow_up_at', now).not('status', 'in', '(booked,closed,junk)').order('follow_up_at').limit(8)
          .then(function (r) { miniList($('#dueList'), r.data || [], 'Nothing due. Set a follow-up date on a lead to see it here.'); });
        sb.from('inbox').select('*').order('created_at', { ascending: false }).limit(8)
          .then(function (r) { miniList($('#recentList'), r.data || [], 'No leads yet'); });
      } else {
        $('#aKpis').innerHTML = kpi('Visitors', d.visitors.toLocaleString('en-IN')) + kpi('Page views', d.views.toLocaleString('en-IN')) +
          CLICKS.map(function (k) { return kpi(k[1], (c[k[0]] || 0).toLocaleString('en-IN')); }).join('') + kpi('Visitor → lead', conv);
        chart($('#viewsChart'), fillDays(d.views_by_day, 'v', 'n'), true);
        bars($('#topPages'), d.top_pages);
        bars($('#referrers'), d.referrers);
        bars($('#devices'), d.devices);
        bars($('#campaigns'), d.by_campaign);
      }
    }).catch(fail);
  }

  /* ---------- leads ---------- */
  function leadsQuery(select, opts) {
    var q = sb.from('inbox').select(select, opts).gte('created_at', rangeFrom());
    if (state.view === 'partners') q = q.in('type', ['channel_partner', 'cp_lead']);
    else if (state.view === 'careers') q = q.eq('type', 'career');
    else if ($('#fType').value) q = q.eq('type', $('#fType').value);
    if ($('#fStatus').value) q = q.eq('status', $('#fStatus').value);
    if ($('#fProject').value && state.view !== 'careers') q = q.eq('project', $('#fProject').value);
    if ($('#fDue').checked) q = q.not('follow_up_at', 'is', null).lte('follow_up_at', new Date(Date.now() + 86400000).toISOString()).not('status', 'in', '(booked,closed,junk)');
    var term = $('#q').value.trim().replace(/[,()%*\\]/g, ' ').trim();
    if (term) {
      var like = '%' + term + '%';
      q = q.or(['name', 'phone', 'email', 'partner_name', 'city'].map(function (c) { return c + '.ilike.' + like; }).join(','));
    }
    return q;
  }
  function loadLeads() {
    var a = state.page * PAGE;
    leadsQuery('*', { count: 'exact' }).order('created_at', { ascending: false }).range(a, a + PAGE - 1).then(function (res) {
      if (res.error) throw res.error;
      state.rows = res.data;
      var total = res.count || 0;
      $('#pageInfo').textContent = total ? (a + 1) + '–' + Math.min(total, a + PAGE) + ' of ' + total.toLocaleString('en-IN') : '';
      $('#prevPage').disabled = state.page === 0;
      $('#nextPage').disabled = a + PAGE >= total;
      var tb = $('#rows');
      if (!res.data.length) { tb.innerHTML = '<tr><td colspan="8" class="empty">No leads match these filters</td></tr>'; return; }
      tb.innerHTML = res.data.map(function (r) {
        var due = r.follow_up_at ? '<span class="' + (new Date(r.follow_up_at) < new Date() && ['booked', 'closed', 'junk'].indexOf(r.status) < 0 ? 'overdue' : '') + '">' + fmtDate(r.follow_up_at) + '</span>' : '<span class="muted">–</span>';
        var who = (r.type === 'cp_lead' ? esc(r.name) + ' <span class="muted small">via ' + esc(r.partner_name) + '</span>' : esc(r.name)) + (r.is_repeat ? '<span class="repeat" title="This phone number enquired before">Repeat</span>' : '');
        return '<tr data-id="' + r.id + '" class="' + (r.status === 'new' ? 'is-new' : '') + '"><td title="' + esc(new Date(r.created_at).toLocaleString('en-IN', tz)) + '">' + ago(r.created_at) + '</td><td>' + who + '</td><td>' + esc(r.phone) + '</td><td>' + esc(TYPES[r.type] || r.type) + '</td><td>' + esc(r.type === 'career' ? r.position : r.project) + '</td><td>' + esc(channel(r)) + '</td><td>' + badge(r.status) + '</td><td>' + due + '</td></tr>';
      }).join('');
      $$('tr[data-id]', tb).forEach(function (tr) {
        tr.addEventListener('click', function () { openLead(state.rows.find(function (x) { return x.id === tr.dataset.id; })); });
      });
    }).catch(fail);
  }

  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv() {
    var btn = $('#exportBtn'); btn.disabled = true;
    leadsQuery('*').order('created_at', { ascending: false }).limit(5000).then(function (res) {
      if (res.error) throw res.error;
      var cols = ['created_at', 'status', 'type', 'name', 'phone', 'email', 'project', 'city', 'configuration', 'visit_date', 'visit_time', 'partner_name', 'address', 'rera_no', 'position', 'experience', 'profile_url', 'message', 'assigned_to', 'follow_up_at', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'referrer', 'page_url', 'source'];
      var lines = [cols.join(',')].concat(res.data.map(function (r) { return cols.map(function (c) { return csvCell(c === 'created_at' || c === 'follow_up_at' ? (r[c] ? new Date(r[c]).toLocaleString('en-IN', tz) : '') : r[c]); }).join(','); }));
      var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'rg-leads-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast(res.data.length + ' leads exported');
    }).catch(fail).then(function () { btn.disabled = false; });
  }

  /* ---------- lead drawer ---------- */
  var drawer = $('#drawer');
  function closeDrawer() { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); }
  $$('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', closeDrawer); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso); var off = d.getTimezoneOffset();
    return new Date(d - off * 60000).toISOString().slice(0, 16);
  }

  var DETAILS = [
    ['email', 'Email'], ['project', 'Project'], ['configuration', 'Configuration'], ['city', 'City / pincode'], ['message', 'Message'],
    ['partner_name', 'Channel partner'], ['address', 'Address'], ['rera_no', 'RERA no.'], ['visit_date', 'Site visit date'], ['visit_time', 'Site visit time'],
    ['position', 'Position'], ['experience', 'Experience'], ['profile_url', 'Profile / résumé'], ['consent', 'Contact consent'],
    ['cta', 'Button clicked'], ['form_id', 'Form'], ['page_url', 'Page'], ['referrer', 'Referrer'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'],
    ['utm_campaign', 'utm_campaign'], ['utm_term', 'utm_term'], ['utm_content', 'utm_content'], ['gclid', 'Google click id'], ['fbclid', 'Meta click id'], ['country', 'Country']
  ];

  function openLead(r) {
    if (!r) return;
    state.current = r;
    $('#dTitle').innerHTML = esc(r.name) + (r.is_repeat ? '<span class="repeat" title="This phone number enquired in the last 180 days">Repeat</span>' : '');
    $('#dSub').textContent = (TYPES[r.type] || r.type) + ' · received ' + new Date(r.created_at).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) + ' · ' + channel(r);
    var ph = digits(r.phone); var wa = ph.length === 10 ? '91' + ph : ph;
    $('#dQuick').innerHTML = '<a class="btn btn--sm" href="tel:+91' + esc(ph) + '">Call ' + esc(r.phone) + '</a>' +
      '<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent('Hello ' + r.name + ', this is RG Unique Structures regarding your enquiry' + (r.project ? ' for ' + r.project : '') + '.') + '">WhatsApp</a>' +
      (r.email ? '<a class="btn btn--ghost btn--sm" href="mailto:' + esc(r.email) + '">Email</a>' : '');
    $('#dStatus').value = r.status;
    $('#dFollow').value = toLocalInput(r.follow_up_at);
    $('#dAssign').value = r.assigned_to || '';
    $('#dDetails').innerHTML = DETAILS.filter(function (d) { var v = r[d[0]]; return v !== null && v !== '' && v !== undefined && !(d[0] === 'consent' && r.type !== 'cp_lead'); }).map(function (d) {
      var v = r[d[0]];
      if (d[0] === 'consent') v = v ? 'Yes' : 'No';
      var html = /url|referrer/.test(d[0]) && /^https?:\/\//.test(v) ? '<a class="link" target="_blank" rel="noopener noreferrer" href="' + esc(v) + '">' + esc(v) + '</a>' : esc(v);
      return '<dt>' + d[1] + '</dt><dd>' + html + '</dd>';
    }).join('') || '<dt>Details</dt><dd>Only name and phone were shared.</dd>';
    $('#noteText').value = '';
    $('#dMail').hidden = !r.email;
    loadTimeline();
    loadLeadEmails();
    drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false');
  }

  function loadTimeline() {
    var r = state.current;
    sb.from('lead_activity').select('*').eq('lead_id', r.id).order('created_at', { ascending: false }).then(function (res) {
      if (res.error) throw res.error;
      var items = res.data.map(function (a) {
        return '<li class="k-' + esc(a.kind) + '"><div class="meta">' + esc(a.actor) + ' · ' + new Date(a.created_at).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) + '</div><p>' + esc(a.body) + '</p></li>';
      });
      items.push('<li><div class="meta">' + new Date(r.created_at).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) + '</div><p>Lead received from ' + esc(TYPES[r.type] || r.type) + (r.page_url ? ' (' + esc(r.page_url.replace(/^https?:\/\/[^/]+/, '') || '/') + ')' : '') + '</p></li>');
      $('#dTimeline').innerHTML = items.join('');
    }).catch(fail);
  }

  function logActivity(kind, body) {
    var r = state.current;
    return sb.from('lead_activity').insert({ source: r.source, lead_id: r.id, kind: kind, body: body });
  }

  $('#dSave').addEventListener('click', function () {
    var r = state.current; var btn = $('#dSave');
    var status = $('#dStatus').value;
    var follow = $('#dFollow').value ? new Date($('#dFollow').value).toISOString() : null;
    var assign = $('#dAssign').value.trim() || null;
    var patch = {}; var log = [];
    if (status !== r.status) { patch.status = status; log.push(['status', 'Status: ' + statusLabel(r.status) + ' → ' + statusLabel(status)]); }
    if ((follow || null) !== (r.follow_up_at ? new Date(r.follow_up_at).toISOString() : null)) { patch.follow_up_at = follow; log.push(['follow_up', follow ? 'Follow-up set for ' + new Date(follow).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) : 'Follow-up cleared']); }
    if (assign !== (r.assigned_to || null)) { patch.assigned_to = assign; log.push(['assign', assign ? 'Assigned to ' + assign : 'Unassigned']); }
    if (!log.length) { toast('Nothing changed'); return; }
    btn.disabled = true;
    sb.from(tableFor(r)).update(patch).eq('id', r.id).then(function (res) {
      if (res.error) throw res.error;
      Object.assign(r, patch);
      return Promise.all(log.map(function (l) { return logActivity(l[0], l[1]); }));
    }).then(function () {
      toast('Saved'); loadTimeline(); pollNew();
      if (state.view === 'dashboard') loadDashboard(); else if (state.view === 'pipeline') loadBoard(); else if (state.view !== 'analytics') loadLeads();
    }).catch(fail).then(function () { btn.disabled = false; });
  });

  $('#noteForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('#noteText').value.trim(); if (!text) return;
    logActivity('note', text).then(function (res) {
      if (res.error) throw res.error;
      $('#noteText').value = ''; loadTimeline(); toast('Note added');
    }).catch(fail);
  });

  $('#dDelete').addEventListener('click', function () {
    var r = state.current;
    if (!window.confirm('Delete the lead from ' + r.name + ' (' + r.phone + ') permanently? This cannot be undone. To hide spam, set the status to Junk instead.')) return;
    sb.from(tableFor(r)).delete().eq('id', r.id).then(function (res) {
      if (res.error) throw res.error;
      closeDrawer(); toast('Lead deleted'); load(); pollNew();
    }).catch(fail);
  });

  /* ---------- pipeline board ---------- */
  var BOARD = ['new', 'contacted', 'follow_up', 'site_visit', 'negotiation', 'booked', 'closed'];
  function loadBoard() {
    sb.from('inbox').select('*').gte('created_at', rangeFrom()).neq('status', 'junk').order('created_at', { ascending: false }).limit(500).then(function (res) {
      if (res.error) throw res.error;
      var rows = res.data; var board = $('#board');
      board.innerHTML = BOARD.map(function (st) {
        var list = rows.filter(function (r) { return r.status === st; });
        return '<div class="col" data-status="' + st + '"><div class="col__head">' + esc(statusLabel(st)) + '<span>' + list.length + '</span></div>' +
          list.map(function (r) {
            return '<div class="kcard" draggable="true" data-id="' + r.id + '"><b>' + esc(r.name) + (r.is_repeat ? '<span class="repeat">Repeat</span>' : '') + '</b><div class="muted">' + esc(r.phone) + ' · ' + esc(TYPES[r.type] || r.type) + '</div><div class="muted">' + esc(r.project || '') + (r.follow_up_at ? ' · follow-up ' + fmtDate(r.follow_up_at) : '') + '</div></div>';
          }).join('') + '</div>';
      }).join('');
      $$('.kcard', board).forEach(function (c) {
        var r = rows.find(function (x) { return x.id === c.dataset.id; });
        c.addEventListener('click', function () { openLead(r); });
        c.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', r.id); c.classList.add('is-dragging'); });
        c.addEventListener('dragend', function () { c.classList.remove('is-dragging'); });
      });
      $$('.col', board).forEach(function (col) {
        col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('is-over'); });
        col.addEventListener('dragleave', function () { col.classList.remove('is-over'); });
        col.addEventListener('drop', function (e) {
          e.preventDefault(); col.classList.remove('is-over');
          var r = rows.find(function (x) { return x.id === e.dataTransfer.getData('text/plain'); });
          var to = col.dataset.status;
          if (!r || r.status === to) return;
          var from = r.status;
          sb.from(tableFor(r)).update({ status: to }).eq('id', r.id).then(function (u) {
            if (u.error) throw u.error;
            state.current = r; r.status = to;
            return logActivity('status', 'Status: ' + statusLabel(from) + ' → ' + statusLabel(to));
          }).then(function () { toast(r.name + ' moved to ' + statusLabel(to)); loadBoard(); pollNew(); }).catch(fail);
        });
      });
    }).catch(fail);
  }

  /* ---------- emails (Resend) ---------- */
  var MAIL_STATUS = { queued: 'Queued', skipped: 'Not sent', sent: 'Sent', delivered: 'Delivered', delayed: 'Delayed', opened: 'Opened',
    clicked: 'Clicked', bounced: 'Bounced', complained: 'Spam complaint', failed: 'Failed', received: 'Received' };
  var MAIL_KIND = { auto_reply: 'Auto-reply', team_alert: 'Team alert', manual: 'Sent by team', reply: 'Reply' };
  var mail = { box: '', page: 0, rows: [], current: null };
  function mailBadge(s) { return '<span class="badge es-' + esc(s) + '">' + esc(MAIL_STATUS[s] || s) + '</span>'; }
  // Emails we sent to a person (not team alerts): did they write back?
  function awaitsReply(m) { return m.direction === 'out' && m.kind !== 'team_alert' && ['queued', 'skipped', 'failed', 'bounced', 'complained'].indexOf(m.status) < 0; }
  function replyBadge(m) {
    if (!awaitsReply(m)) return '';
    return m.replied_at ? ' <span class="badge es-replied">Replied</span>' : ' <span class="badge es-noreply">No reply</span>';
  }
  function longDate(iso) { return iso ? new Date(iso).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) : ''; }
  function shortAddr(a) { var m = /<([^>]+)>/.exec(a || ''); return m ? m[1] : (a || ''); }

  function api(path, opts) {
    return sb.auth.getSession().then(function (r) {
      var token = r.data && r.data.session && r.data.session.access_token;
      opts = opts || {};
      opts.headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, opts.headers || {});
      return fetch(path, opts).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.error || 'Request failed (' + res.status + ')');
          return body;
        });
      });
    });
  }

  function showConnection(el) {
    api('/api/email/status').then(function (st) {
      el.hidden = false;
      if (st.resend && (st.webhook_signing || st.hook_secret)) {
        el.className = 'conn ok';
        el.innerHTML = '<div><b>Resend is connected.</b> Every form with an email address gets a personalised reply, and delivery, opens, clicks and replies show up here.' +
          (st.webhook_signing ? '' : ' Add the webhook signing secret for signed delivery updates.') + '</div>';
      } else {
        el.className = 'conn';
        el.innerHTML = '<div><b>Beta: Resend is not connected yet.</b> The automation is running, so each new form submission is logged here as <em>Not sent</em>. ' +
          'Once the Resend API key is added on the server, the same emails go out for real. Webhook URL for Resend: <code>' + esc(st.webhook_url) + '</code></div>';
      }
    }).catch(function () { el.hidden = true; });
  }

  function emailQuery() {
    var q = sb.from('email_messages').select('id,created_at,direction,kind,status,from_email,to_email,subject,lead_source,lead_id,read_at,replied_at,error', { count: 'exact' })
      .gte('created_at', rangeFrom()).order('created_at', { ascending: false });
    var box = mail.box;
    if (box === 'in' || box === 'out') q = q.eq('direction', box);
    else if (box === 'problems') q = q.in('status', ['bounced', 'complained', 'failed', 'delayed', 'skipped']);
    else if (box === 'noreply') q = q.eq('direction', 'out').neq('kind', 'team_alert').is('replied_at', null).not('status', 'in', '(queued,skipped,failed,bounced,complained)');
    else if (box) q = q.eq('kind', box);
    var term = $('#eq').value.trim().replace(/[,()%]/g, ' ');
    if (term) q = q.or('to_email.ilike.%' + term + '%,from_email.ilike.%' + term + '%,subject.ilike.%' + term + '%');
    return q;
  }

  function loadEmails() {
    showConnection($('#emailConn'));
    sb.from('email_messages').select('direction,kind,status,opened_at,clicked_at,delivered_at,replied_at').gte('created_at', rangeFrom()).limit(5000).then(function (res) {
      if (res.error) throw res.error;
      var out = res.data.filter(function (m) { return m.direction === 'out'; });
      var real = out.filter(function (m) { return m.status !== 'skipped'; });
      var count = function (f) { return out.filter(f).length; };
      var k = [
        ['Emails sent', real.length, out.length - real.length ? (out.length - real.length) + ' not sent' : ''],
        ['Delivered', count(function (m) { return m.delivered_at || ['delivered', 'opened', 'clicked'].indexOf(m.status) >= 0; }), ''],
        ['Opened', count(function (m) { return m.opened_at || m.status === 'opened' || m.status === 'clicked'; }), real.length ? Math.round(count(function (m) { return m.opened_at || m.status === 'opened' || m.status === 'clicked'; }) / real.length * 100) + '% open rate' : ''],
        ['Clicked', count(function (m) { return m.clicked_at || m.status === 'clicked'; }), ''],
        ['Replied', count(function (m) { return awaitsReply(m) && m.replied_at; }), (function () {
          var asked = count(awaitsReply), got = count(function (m) { return awaitsReply(m) && m.replied_at; });
          return asked ? Math.round(got / asked * 100) + '% reply rate · ' + (asked - got) + ' no reply' : '';
        })()],
        ['Problems', count(function (m) { return ['bounced', 'complained', 'failed'].indexOf(m.status) >= 0; }), 'bounced or failed']
      ];
      $('#eKpis').innerHTML = k.map(function (x) { return '<div class="kpi"><span>' + x[0] + '</span><strong>' + x[1].toLocaleString('en-IN') + '</strong><small>' + esc(x[2]) + '</small></div>'; }).join('');
    }).catch(fail);
    emailQuery().range(mail.page * PAGE, mail.page * PAGE + PAGE - 1).then(function (res) {
      if (res.error) throw res.error;
      mail.rows = res.data;
      $('#eRows').innerHTML = res.data.length ? res.data.map(function (m, i) {
        var who = m.direction === 'in' ? m.from_email : m.to_email;
        return '<tr data-i="' + i + '" class="' + (m.direction === 'in' && !m.read_at ? 'unread' : '') + '"><td>' + esc(ago(m.created_at)) + '</td>' +
          '<td><span class="dir ' + m.direction + '" title="' + (m.direction === 'in' ? 'Received' : 'Sent') + '">' + (m.direction === 'in' ? '&#8601;' : '&#8599;') + '</span></td>' +
          '<td>' + esc(shortAddr(who)) + '</td><td class="subj">' + esc(m.subject || '(no subject)') + '</td><td>' + esc(MAIL_KIND[m.kind] || m.kind) + '</td><td>' + mailBadge(m.status) + replyBadge(m) + '</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty">No emails in this period yet</div></td></tr>';
      var total = res.count || 0;
      $('#ePageInfo').textContent = total ? (mail.page * PAGE + 1) + '–' + Math.min(total, mail.page * PAGE + PAGE) + ' of ' + total.toLocaleString('en-IN') : '';
      $('#ePrev').disabled = mail.page === 0; $('#eNext').disabled = (mail.page + 1) * PAGE >= total;
      $$('#eRows tr[data-i]').forEach(function (tr) { tr.addEventListener('click', function () { openEmail(mail.rows[Number(tr.dataset.i)].id); }); });
    }).catch(fail);
  }

  var mailDrawer = $('#mailDrawer'); var compose = $('#compose');
  function closeMail() { mailDrawer.classList.remove('is-open'); mailDrawer.setAttribute('aria-hidden', 'true'); }
  function closeCompose() { compose.classList.remove('is-open'); compose.setAttribute('aria-hidden', 'true'); }

  function openEmail(id) {
    sb.from('email_messages').select('*').eq('id', id).single().then(function (res) {
      if (res.error) throw res.error;
      var m = res.data; mail.current = m;
      $('#mTitle').textContent = m.subject || '(no subject)';
      $('#mSub').innerHTML = (m.direction === 'in' ? 'Reply received ' : (MAIL_KIND[m.kind] || 'Email') + ' · ') + esc(longDate(m.created_at)) + ' · ' + mailBadge(m.status) + replyBadge(m);
      var rows = [['From', m.from_email], ['To', m.to_email], ['Reply-to', m.reply_to], ['Sent by', m.sent_by], ['Template', m.template_key],
        ['Delivered', longDate(m.delivered_at)], ['First opened', longDate(m.opened_at)], ['First click', longDate(m.clicked_at)], ['Replied', longDate(m.replied_at)], ['Problem', m.error]];
      var att = (m.meta && m.meta.attachments) || [];
      if (att.length) rows.push(['Attachments', att.map(function (a) { return a.filename; }).join(', ')]);
      $('#mDetails').innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
      var frame = $('#mFrame');
      frame.srcdoc = m.html || ('<pre style="font:14px/1.6 Arial,sans-serif;white-space:pre-wrap;margin:16px">' + esc(m.text_body || '') + '</pre>');
      var quick = '';
      if (m.lead_id) quick += '<button class="btn btn--ghost btn--sm" type="button" id="mLead">Open lead</button>';
      if (m.direction === 'in') quick += '<button class="btn btn--sm" type="button" id="mReply">Reply</button>';
      else if (m.status === 'skipped' || m.status === 'failed') quick += '<button class="btn btn--sm" type="button" id="mResend">Send again</button>';
      $('#mQuick').innerHTML = quick;
      if ($('#mLead')) $('#mLead').addEventListener('click', function () {
        sb.from('inbox').select('*').eq('id', m.lead_id).single().then(function (r) { if (r.error) throw r.error; closeMail(); openLead(r.data); }).catch(fail);
      });
      if ($('#mReply')) $('#mReply').addEventListener('click', function () {
        openCompose({ to: m.from_email, subject: /^re:/i.test(m.subject || '') ? m.subject : 'Re: ' + (m.subject || ''), lead_source: m.lead_source, lead_id: m.lead_id, in_reply_to: m.message_id,
          body: '\n\n\nOn ' + longDate(m.created_at) + ', ' + m.from_email + ' wrote:\n> ' + String(m.text_body || '').trim().split('\n').slice(0, 30).join('\n> ') });
      });
      if ($('#mResend')) $('#mResend').addEventListener('click', function () {
        openCompose({ to: m.to_email, subject: m.subject, lead_source: m.lead_source, lead_id: m.lead_id, body: String(m.text_body || '') });
      });
      sb.from('email_events').select('*').eq('message_id', m.id).order('created_at', { ascending: false }).then(function (ev) {
        if (ev.error) throw ev.error;
        var items = ev.data.map(function (e) {
          var label = MAIL_STATUS[(e.type || '').replace('email.', '').replace('delivery_delayed', 'delayed')] || e.type;
          var extra = e.payload && e.payload.click && e.payload.click.link ? ' · ' + e.payload.click.link : '';
          return '<li><div class="meta">' + esc(longDate(e.created_at)) + '</div><p>' + esc(label + extra) + '</p></li>';
        });
        items.push('<li><div class="meta">' + esc(longDate(m.created_at)) + '</div><p>' + (m.direction === 'in' ? 'Received' : m.status === 'skipped' ? 'Logged, not sent: ' + esc(m.error || '') : 'Handed to Resend') + '</p></li>');
        $('#mTimeline').innerHTML = items.join('');
      }).catch(fail);
      mailDrawer.classList.add('is-open'); mailDrawer.setAttribute('aria-hidden', 'false');
      if (m.direction === 'in' && !m.read_at) {
        sb.from('email_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id).then(function () { pollNew(); if (state.view === 'emails') loadEmails(); });
      }
    }).catch(fail);
  }

  function openCompose(v) {
    v = v || {};
    var f = $('#composeForm');
    ['to', 'subject', 'body', 'lead_source', 'lead_id', 'in_reply_to'].forEach(function (k) { f.elements[k].value = v[k] || ''; });
    $('#cTitle').textContent = v.in_reply_to ? 'Reply' : 'New email';
    closeMail();
    compose.classList.add('is-open'); compose.setAttribute('aria-hidden', 'false');
    setTimeout(function () { (v.to ? f.elements[v.subject ? 'body' : 'subject'] : f.elements.to).focus(); }, 50);
  }

  function sendEmail(e) {
    e.preventDefault();
    var f = e.target; if (!f.reportValidity()) return;
    var btn = $('button[type=submit]', f); btn.disabled = true;
    var payload = {}; ['to', 'subject', 'body', 'lead_source', 'lead_id', 'in_reply_to'].forEach(function (k) { payload[k] = f.elements[k].value.trim() || null; });
    api('/api/email/send', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) {
      closeCompose();
      toast(r.skipped ? 'Saved in Emails as "Not sent": Resend is not connected yet' : 'Email sent');
      if (state.view === 'emails') loadEmails();
      if (state.current && payload.lead_id === state.current.id) loadLeadEmails();
    }).catch(fail).then(function () { btn.disabled = false; });
  }

  function loadLeadEmails() {
    var r = state.current; var box = $('#dEmails');
    var q = sb.from('email_messages').select('id,created_at,direction,kind,status,subject,replied_at').order('created_at', { ascending: false }).limit(20);
    q = r.email ? q.or('lead_id.eq.' + r.id + ',to_email.ilike.' + r.email.replace(/[,()]/g, '') + ',from_email.ilike.' + r.email.replace(/[,()]/g, '')) : q.eq('lead_id', r.id);
    q.then(function (res) {
      if (res.error) throw res.error;
      box.innerHTML = res.data.length ? res.data.map(function (m) {
        return '<button type="button" class="mail-item" data-mail="' + m.id + '"><span class="dir ' + m.direction + '">' + (m.direction === 'in' ? '&#8601;' : '&#8599;') + '</span>' +
          '<span class="s">' + esc(m.subject || '(no subject)') + '</span>' + mailBadge(m.status) + replyBadge(m) + '<span class="muted small">' + esc(ago(m.created_at)) + '</span></button>';
      }).join('') : '<p class="muted small">' + (r.email ? 'No emails yet.' : 'No email address on this lead.') + '</p>';
      $$('[data-mail]', box).forEach(function (b) { b.addEventListener('click', function () { closeDrawer(); openEmail(b.dataset.mail); }); });
    }).catch(fail);
  }

  /* ---------- email automation settings ---------- */
  function loadAutomation() {
    showConnection($('#autoConn'));
    sb.from('email_settings').select('*').eq('id', 1).single().then(function (res) {
      if (res.error) throw res.error;
      var f = $('#mailSettings'); var d = res.data;
      f.enabled.checked = d.enabled; ['from_name', 'from_email', 'reply_to', 'notify_to', 'signature'].forEach(function (k) { f.elements[k].value = d[k] || ''; });
      $('#mailMeta').textContent = d.updated_by ? 'Last changed ' + longDate(d.updated_at) + ' by ' + d.updated_by : '';
    }).catch(fail);
    sb.from('email_templates').select('*').order('key').then(function (res) {
      if (res.error) throw res.error;
      var order = ['callback', 'project', 'landing', 'contact', 'channel_partner', 'cp_lead', 'career', 'team_alert'];
      res.data.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
      $('#templates').innerHTML = res.data.map(function (t) {
        return '<form class="card tpl" data-key="' + esc(t.key) + '"><div class="card__head"><h2>' + esc(t.label) + '</h2>' +
          '<label class="chk"><input type="checkbox" name="enabled"' + (t.enabled ? ' checked' : '') + '> On</label></div>' +
          '<label class="fld"><span>Subject</span><input name="subject" maxlength="200" required value="' + esc(t.subject) + '"></label>' +
          '<label class="fld"><span>Message</span><textarea name="body" maxlength="5000" required>' + esc(t.body) + '</textarea></label>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="muted small">' + (t.updated_by ? 'Edited ' + esc(ago(t.updated_at)) + ' by ' + esc(t.updated_by) : 'Default text') + '</span>' +
          '<button class="btn btn--sm" type="submit">Save template</button></div></form>';
      }).join('');
      $$('#templates form').forEach(function (f) { f.addEventListener('submit', saveTemplate); });
    }).catch(fail);
  }

  function saveMailSettings(e) {
    e.preventDefault();
    var f = e.target; if (!f.reportValidity()) return;
    var notify = f.notify_to.value.split(/[,\s]+/).filter(Boolean);
    if (notify.some(function (x) { return !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x); })) { toast('Check the team alert email addresses'); return; }
    var row = { enabled: f.enabled.checked, from_name: f.from_name.value.trim(), from_email: f.from_email.value.trim().toLowerCase(), reply_to: f.reply_to.value.trim().toLowerCase(),
      notify_to: notify.join(', '), signature: f.signature.value.trim(), updated_at: new Date().toISOString(), updated_by: state.user.email };
    sb.from('email_settings').update(row).eq('id', 1).then(function (res) { if (res.error) throw res.error; toast('Email settings saved'); loadAutomation(); }).catch(fail);
  }

  function saveTemplate(e) {
    e.preventDefault();
    var f = e.target; if (!f.reportValidity()) return;
    sb.from('email_templates').update({ enabled: f.enabled.checked, subject: f.subject.value.trim(), body: f.body.value.trim(), updated_at: new Date().toISOString(), updated_by: state.user.email })
      .eq('key', f.dataset.key).then(function (res) { if (res.error) throw res.error; toast('Template saved'); }).catch(fail);
  }

  function bindEmails() {
    $$('#eBox button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#eBox button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        mail.box = b.dataset.box; mail.page = 0; loadEmails();
      });
    });
    var t; $('#eq').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { mail.page = 0; loadEmails(); }, 300); });
    $('#ePrev').addEventListener('click', function () { if (mail.page > 0) { mail.page--; loadEmails(); } });
    $('#eNext').addEventListener('click', function () { mail.page++; loadEmails(); });
    $('#composeBtn').addEventListener('click', function () { openCompose(); });
    $('#composeForm').addEventListener('submit', sendEmail);
    $('#mailSettings').addEventListener('submit', saveMailSettings);
    $('#dMail').addEventListener('click', function () {
      var r = state.current; if (!r || !r.email) return;
      closeDrawer();
      openCompose({ to: r.email, subject: (r.project || 'RG Unique Structures') + ': your enquiry', lead_source: r.source, lead_id: r.id, body: 'Hi ' + String(r.name || '').split(' ')[0] + ',\n\n' });
    });
    $$('[data-close-mail]').forEach(function (b) { b.addEventListener('click', closeMail); });
    $$('[data-close-compose]').forEach(function (b) { b.addEventListener('click', closeCompose); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMail(); closeCompose(); } });
  }

  /* ---------- site settings ---------- */
  function loadSettings() {
    sb.from('site_settings').select('*').then(function (res) {
      if (res.error) throw res.error;
      var f = $('#settingsForm'); var latest = null;
      res.data.forEach(function (row) {
        var el = f.elements[row.key]; if (!el) return;
        if (el.type === 'checkbox') el.checked = row.value === true; else el.value = row.value == null ? '' : row.value;
        if (!latest || row.updated_at > latest.updated_at) latest = row;
      });
      $('#settingsMeta').textContent = latest ? 'Last changed ' + new Date(latest.updated_at).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, tz)) + (latest.updated_by ? ' by ' + latest.updated_by : '') + '. Changes appear on the website within about a minute.' : '';
    }).catch(fail);
  }
  function saveSettings(e) {
    e.preventDefault();
    var f = e.target;
    if (!f.reportValidity()) return;
    var link = f.announcement_link.value.trim();
    if (link && !/^(https?:\/\/|\/)/.test(link)) { toast('The link must start with / or https://'); return; }
    var rows = ['phone', 'phone_tel', 'whatsapp', 'email', 'price', 'popup_title', 'announcement', 'announcement_link'].map(function (k) { return { key: k, value: f.elements[k].value.trim() }; });
    rows.push({ key: 'popup_enabled', value: f.popup_enabled.checked });
    rows.push({ key: 'popup_delay', value: Math.max(3, Math.min(120, Number(f.popup_delay.value) || 9)) });
    var btn = $('button[type=submit]', f); btn.disabled = true;
    sb.from('site_settings').upsert(rows).then(function (res) {
      if (res.error) throw res.error;
      toast('Settings saved. The website updates within a minute.'); loadSettings();
    }).catch(fail).then(function () { btn.disabled = false; });
  }

  boot();
})();
