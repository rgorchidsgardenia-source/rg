/* RG Unique Structures: site behaviour. No framework; Lenis for smooth scrolling. */
(function () {
  'use strict';

  var CFG = {
    api: '',                       // same origin: /api/enquiry, /api/track
    popupDelay: 9000,              // first automatic popup, once per visit
    slideMs: 6000,
    tawk: 'https://embed.tawk.to/67ee27429e22ed190f0c1207/1int4pm88'
  };

  var doc = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  /* ---------------- Analytics ---------------- */
  window.dataLayer = window.dataLayer || [];
  var sid = store.get('rg_sid');
  if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('rg_sid', sid); }

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var attribution = (function () {
    var saved = {};
    try { saved = JSON.parse(store.get('rg_attr') || '{}'); } catch (e) { saved = {}; }
    var q = new URLSearchParams(location.search);
    var fresh = UTM_KEYS.some(function (k) { return q.get(k); });
    if (fresh) {
      saved = {};
      UTM_KEYS.forEach(function (k) { if (q.get(k)) saved[k] = q.get(k).slice(0, 200); });
    }
    if (!saved.landing) {
      saved.landing = location.pathname;
      saved.first_referrer = document.referrer && document.referrer.indexOf(location.host) === -1 ? document.referrer.slice(0, 300) : '';
    }
    store.set('rg_attr', JSON.stringify(saved));
    return saved;
  })();

  function device() {
    var w = window.innerWidth;
    return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop';
  }

  function track(event, label) {
    window.dataLayer.push({ event: event, label: label || '' });
    var body = JSON.stringify({
      event: event, label: (label || '').slice(0, 120), path: location.pathname, session_id: sid,
      referrer: document.referrer.slice(0, 300), device: device(),
      utm_source: attribution.utm_source || '', utm_medium: attribution.utm_medium || '', utm_campaign: attribution.utm_campaign || ''
    });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(CFG.api + '/api/track', new Blob([body], { type: 'application/json' }));
      else fetch(CFG.api + '/api/track', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
    } catch (e) { /* analytics must never break the page */ }
  }
  track('page_view');

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (/^tel:/.test(href)) track('call_click', href.slice(4));
    else if (/wa\.me|whatsapp/.test(href)) track('whatsapp_click', a.dataset.label || 'whatsapp');
    else if (/^mailto:/.test(href)) track('email_click', href.slice(7));
    else if (/maps\.app|google\.[a-z.]+\/maps|goo\.gl\/maps/.test(href)) track('directions_click', a.dataset.label || a.textContent.trim());
  });

  /* ---------------- Smooth scroll ---------------- */
  var lenis = null;
  if (!reduceMotion && window.Lenis && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
    lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothWheel: true });
    var raf = function (time) { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  function scrollToEl(el) {
    var offset = -($('.header') ? $('.header').offsetHeight : 0) - 12;
    if (lenis) lenis.scrollTo(el, { offset: offset });
    else window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset + offset, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href').length < 2) return;
    var target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return;
    e.preventDefault();
    closeDrawer();
    scrollToEl(target);
  });
  var locks = 0;
  function lockScroll(on) {
    locks = Math.max(0, locks + (on ? 1 : -1));
    var locked = locks > 0;
    doc.style.overflow = locked ? 'hidden' : '';
    if (lenis) { if (locked) lenis.stop(); else lenis.start(); }
  }

  /* ---------------- Header ---------------- */
  var header = $('.header');
  var toTop = $('.to-top');
  var lastY = window.pageYOffset;
  function onScroll() {
    var y = window.pageYOffset;
    if (header) {
      header.classList.toggle('is-scrolled', y > 10);
      var drawerOpen = drawer && drawer.classList.contains('is-open');
      header.classList.toggle('is-hidden', !drawerOpen && y > 420 && y > lastY + 4);
      if (y < lastY - 4) header.classList.remove('is-hidden');
    }
    if (toTop) toTop.classList.toggle('is-on', y > 900);
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (header) header.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    lastY = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (toTop) toTop.addEventListener('click', function () { if (lenis) lenis.scrollTo(0); else window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* ---------------- Drawer ---------------- */
  var drawer = $('#drawer');
  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); lockScroll(true);
    var b = $('.burger'); if (b) b.setAttribute('aria-expanded', 'true');
    setTimeout(function () { var f = $('.x-btn', drawer); if (f) f.focus(); }, 50);
  }
  function closeDrawer() {
    if (!drawer || !drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); lockScroll(false);
    var b = $('.burger'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
  }
  $$('.burger').forEach(function (b) { b.addEventListener('click', openDrawer); });
  $$('[data-close-drawer]').forEach(function (b) { b.addEventListener('click', closeDrawer); });

  /* ---------------- Word-by-word headings ---------------- */
  // Wraps each word of large headings so they rise into view one after another.
  function splitWords(el) {
    var i = 0;
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.nodeValue.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
            var inner = document.createElement('span'); inner.textContent = part; inner.style.setProperty('--i', i++);
            w.appendChild(inner); frag.appendChild(w);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    })(el);
  }
  if (!reduceMotion) {
    $$('.words, .section .h2, .page-hero .h1, .band__title').forEach(function (el) {
      if (el.closest('.hero-card') || el.closest('.modal')) return;
      el.classList.add('words'); el.classList.remove('reveal');
      splitWords(el);
    });
  }

  /* ---------------- Reveal + counters + lazy maps ---------------- */
  doc.classList.add('js');
  function countUp(el) {
    var to = parseFloat(el.dataset.count); var dur = reduceMotion ? 0 : 1800; var start = null;
    var fmt = function (n) { return Math.round(n).toLocaleString('en-IN'); };
    if (!dur) { el.firstChild.nodeValue = fmt(to); return; }
    function step(t) {
      if (!start) start = t;
      var p = Math.min(1, (t - start) / dur); var eased = 1 - Math.pow(1 - p, 4);
      el.firstChild.nodeValue = fmt(to * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        if (el.dataset.count) countUp(el);
        else if (el.dataset.src) { el.src = el.dataset.src; el.removeAttribute('data-src'); }
        else el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    $$('.reveal, .reveal-img, .words, [data-count]').forEach(function (el) { io.observe(el); });
    var mapIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.src = en.target.dataset.src; mapIO.unobserve(en.target); } });
    }, { rootMargin: '400px 0px' });
    $$('iframe[data-src]').forEach(function (f) { mapIO.observe(f); });
  } else {
    $$('.reveal, .reveal-img, .words').forEach(function (el) { el.classList.add('is-in'); });
    $$('[data-count]').forEach(function (el) { el.firstChild.nodeValue = Number(el.dataset.count).toLocaleString('en-IN'); });
    $$('iframe[data-src]').forEach(function (f) { f.src = f.dataset.src; });
  }

  /* ---------------- Hero slider ---------------- */
  $$('[data-slider]').forEach(function (root) {
    var slides = $$('.hero__slide', root);
    var dots = $$('.hero__dot', root);
    if (slides.length < 2) { if (slides[0]) slides[0].classList.add('is-active'); return; }
    var i = 0; var timer = null; var paused = false;
    root.style.setProperty('--slide-ms', CFG.slideMs + 'ms');
    function show(n) {
      slides[i].classList.remove('is-active');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('is-active');
      slides.forEach(function (s, k) { s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
      dots.forEach(function (d, k) {
        d.classList.remove('is-active', 'is-done');
        d.setAttribute('aria-current', k === i ? 'true' : 'false');
        if (k < i) d.classList.add('is-done');
      });
      if (dots[i]) { void dots[i].offsetWidth; dots[i].classList.add('is-active'); }
      var img = slides[(i + 1) % slides.length].querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
      restart();
    }
    function restart() { clearTimeout(timer); if (!paused && !reduceMotion) timer = setTimeout(function () { show(i + 1); }, CFG.slideMs); }
    dots.forEach(function (d, k) { d.addEventListener('click', function () { show(k); }); });
    var prev = $('[data-prev]', root), next = $('[data-next]', root);
    if (prev) prev.addEventListener('click', function () { show(i - 1); });
    if (next) next.addEventListener('click', function () { show(i + 1); });
    var x0 = null;
    root.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('visibilitychange', function () { paused = document.hidden; restart(); });
    show(0);
  });

  /* ---------------- Tabs ---------------- */
  $$('[data-tabs]').forEach(function (list) {
    var tabs = $$('[role="tab"]', list);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) {
          p.hidden = !on;
          if (on) { p.classList.remove('is-entering'); void p.offsetWidth; p.classList.add('is-entering'); }
        }
      });
      if (focus) tab.focus();
      if (lenis) lenis.resize();
    }
    tabs.forEach(function (t, k) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return; e.preventDefault();
        select(tabs[(k + d + tabs.length) % tabs.length], true);
      });
    });
  });

  /* ---------------- Space explorer ---------------- */
  $$('[data-space]').forEach(function (root) {
    var btns = $$('.space__btn', root); var imgs = $$('.space__view img', root); var cap = $('.space__cap', root);
    btns.forEach(function (b, k) {
      b.addEventListener('click', function () {
        btns.forEach(function (x, j) { x.setAttribute('aria-selected', j === k ? 'true' : 'false'); });
        imgs.forEach(function (im, j) { im.classList.toggle('is-on', j === k); });
        if (cap) cap.textContent = b.dataset.caption || '';
      });
    });
  });

  /* ---------------- Accordion ---------------- */
  $$('.acc__btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.acc__item'); var open = !item.classList.contains('is-open');
      var group = btn.closest('[data-acc-single]');
      if (group && open) $$('.acc__item.is-open', group).forEach(function (o) { o.classList.remove('is-open'); $('.acc__btn', o).setAttribute('aria-expanded', 'false'); });
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (lenis) setTimeout(function () { lenis.resize(); }, 520);
    });
  });

  /* ---------------- Carousels ---------------- */
  $$('[data-carousel]').forEach(function (root) {
    var track = $('.carousel__track', root); var dotsWrap = $('.carousel__dots', root);
    var prev = $('[data-prev]', root); var next = $('[data-next]', root);
    if (!track) return;
    function pages() { return Math.max(1, Math.round(track.scrollWidth / track.clientWidth)); }
    function page() { return Math.round(track.scrollLeft / track.clientWidth); }
    function go(n) {
      var max = track.scrollWidth - track.clientWidth;
      var left = Math.max(0, Math.min(max, n * track.clientWidth));
      if (n >= pages()) left = 0;
      if (n < 0) left = max;
      track.scrollTo({ left: left, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function drawDots() {
      if (!dotsWrap) return;
      var n = pages(); dotsWrap.innerHTML = '';
      for (var k = 0; k < n; k++) {
        var b = document.createElement('button'); b.type = 'button';
        b.setAttribute('aria-label', 'Go to slide ' + (k + 1));
        (function (k2) { b.addEventListener('click', function () { go(k2); }); })(k);
        dotsWrap.appendChild(b);
      }
      mark();
    }
    function mark() { if (!dotsWrap) return; var p = page(); $$('button', dotsWrap).forEach(function (b, k) { b.setAttribute('aria-current', k === p ? 'true' : 'false'); }); }
    if (prev) prev.addEventListener('click', function () { go(page() - 1); });
    if (next) next.addEventListener('click', function () { go(page() + 1); });
    var t; track.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(mark, 60); }, { passive: true });
    window.addEventListener('resize', drawDots);
    drawDots();
    if (root.hasAttribute('data-autoplay') && !reduceMotion) {
      var hover = false;
      root.addEventListener('mouseenter', function () { hover = true; });
      root.addEventListener('mouseleave', function () { hover = false; });
      setInterval(function () { if (!hover && !document.hidden && isVisible(root)) go(page() + 1); }, 5500);
    }
  });
  function isVisible(el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }

  /* ---------------- Modals ---------------- */
  var lastFocus = null;
  function openModal(m) {
    if (!m || m.classList.contains('is-open')) return;
    lastFocus = document.activeElement;
    m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false'); lockScroll(true);
    setTimeout(function () { var f = $('input:not([type=hidden]):not(.hp input), button.modal__close', m); if (f) f.focus({ preventScroll: true }); }, 80);
  }
  function closeModal(m) {
    if (!m || !m.classList.contains('is-open')) return;
    m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); lockScroll(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $$('.modal').forEach(function (m) {
    $$('[data-close]', m).forEach(function (b) { b.addEventListener('click', function () { closeModal(m); }); });
    m.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $$('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea', m).filter(function (x) { return x.offsetParent !== null && !x.closest('.hp'); });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('.modal.is-open').forEach(closeModal);
    closeDrawer();
  });

  /* Popup enquiry */
  var popup = $('#popup');
  function openPopup(context) {
    if (!popup) return;
    var form = $('form', popup);
    var ctx = $('[name="cta"]', popup);
    if (ctx) ctx.value = context || 'popup';
    var kicker = $('.popup__kicker', popup);
    if (kicker) kicker.textContent = context === 'brochure' ? 'Download brochure' : context === 'site visit' ? 'Book a site visit' : context === 'floor plans' ? 'Get floor plans' : 'Request a call back';
    var wrap = popup.querySelector('.is-sent'); if (wrap) wrap.classList.remove('is-sent');
    if (form) form.reset();
    openModal(popup);
    track('popup_open', context || 'auto');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-popup]');
    if (!t) return;
    e.preventDefault(); closeDrawer();
    openPopup(t.getAttribute('data-popup'));
  });
  function schedulePopup(delayMs) {
    setTimeout(function tryOpen() {
      var busy = $('.modal.is-open') || (drawer && drawer.classList.contains('is-open')) ||
        (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) || document.hidden;
      if (busy) { setTimeout(tryOpen, 4000); return; }
      store.set('rg_popup_seen', '1');
      openPopup('auto');
    }, delayMs);
  }

  /* Lightbox */
  var lb = $('#lightbox'); var lbImg = lb && $('img', lb); var lbCap = lb && $('.lightbox__cap', lb);
  var lbSet = []; var lbIdx = 0;
  function lbShow(k) {
    lbIdx = (k + lbSet.length) % lbSet.length; var it = lbSet[lbIdx];
    lbImg.src = it.dataset.full || it.querySelector('img').src;
    lbImg.alt = it.dataset.caption || '';
    lbCap.textContent = it.dataset.caption || '';
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-lightbox]');
    if (!t || !lb) return;
    e.preventDefault();
    lbSet = $$('[data-lightbox="' + t.dataset.lightbox + '"]');
    lbShow(lbSet.indexOf(t));
    openModal(lb);
  });
  if (lb) {
    $('[data-lb-prev]', lb).addEventListener('click', function () { lbShow(lbIdx - 1); });
    $('[data-lb-next]', lb).addEventListener('click', function () { lbShow(lbIdx + 1); });
    lb.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') lbShow(lbIdx - 1); if (e.key === 'ArrowRight') lbShow(lbIdx + 1); });
  }

  /* ---------------- Toast ---------------- */
  var toastEl = $('#toast'); var toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 4200);
  }

  /* ---------------- Forms ---------------- */
  function normalisePhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length > 10) d = d.replace(/^(91|0)(?=\d{10}$)/, '');
    return d;
  }
  function setErr(field, msg) {
    if (!field) return;
    field.classList.toggle('is-invalid', !!msg);
    var e = $('.field__err', field);
    if (!e) { e = document.createElement('div'); e.className = 'field__err'; field.appendChild(e); }
    e.textContent = msg || '';
  }
  function validate(form) {
    var ok = true; var first = null;
    $$('input, select, textarea', form).forEach(function (el) {
      if (el.type === 'hidden' || el.closest('.hp')) return;
      var f = el.closest('.field'); var v = (el.value || '').trim(); var msg = '';
      if (el.required && !v && el.type !== 'checkbox') msg = 'This field is required';
      else if (el.type === 'checkbox' && el.required && !el.checked) msg = 'Please tick this box to continue';
      else if (el.type === 'tel' && v && !/^[6-9]\d{9}$/.test(normalisePhone(v))) msg = 'Enter a valid 10-digit mobile number';
      else if (el.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = 'Enter a valid email address';
      else if (el.name === 'name' && v && v.length < 2) msg = 'Please enter your name';
      if (el.type === 'checkbox') { var c = el.closest('.check'); if (c) c.style.color = msg ? '#C0392B' : ''; }
      else setErr(f, msg);
      if (msg) { ok = false; if (!first) first = el; }
    });
    if (first) first.focus();
    return ok;
  }
  $$('input[type="tel"]').forEach(function (el) {
    el.addEventListener('input', function () {
      var d = el.value.replace(/[^\d+ ]/g, '');
      if (d !== el.value) el.value = d;
    });
    el.addEventListener('blur', function () { var n = normalisePhone(el.value); if (n.length === 10) el.value = n; });
  });
  $$('input, select, textarea').forEach(function (el) {
    el.addEventListener('input', function () { var f = el.closest('.field'); if (f && f.classList.contains('is-invalid')) setErr(f, ''); });
  });

  $$('form[data-form]').forEach(function (form) {
    ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach(function (ev) {
      form.addEventListener(ev, function () { form.dataset.human = '1'; }, { passive: true });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate(form)) return;
      var btn = $('button[type="submit"]', form); var label = btn ? btn.innerHTML : '';
      var data = {};
      $$('input, select, textarea', form).forEach(function (el) {
        if (!el.name) return;
        data[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      data.phone = normalisePhone(data.phone);
      data.type = form.dataset.form;
      data.project = data.project || form.dataset.project || '';
      data.form_id = form.dataset.formId || form.dataset.form;
      data.page_url = location.href.slice(0, 500);
      data.referrer = (attribution.first_referrer || document.referrer || '').slice(0, 300);
      data.session_id = sid;
      data.human = form.dataset.human === '1';
      UTM_KEYS.forEach(function (k) { data[k] = attribution[k] || ''; });
      if (btn) { btn.disabled = true; btn.innerHTML = 'Sending…'; }
      fetch(CFG.api + '/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          if (!res.body.ok) throw new Error(res.body.error || 'Could not submit right now');
          store.set('rg_submitted', '1');
          window.dataLayer.push({ event: 'lead_submit', form_type: data.type, form_id: data.form_id });
          var wrap = form.closest('[data-form-wrap]');
          if (wrap) wrap.classList.add('is-sent'); else toast('Thank you! Our team will call you shortly.');
          form.reset();
        })
        .catch(function (err) {
          toast((err && err.message ? err.message : 'Something went wrong') + '. You can also call us on 99 88 99 6506.');
        })
        .then(function () { if (btn) { btn.disabled = false; btn.innerHTML = label; } });
    });
  });

  /* ---------------- Scroll-driven motion: parallax and lit statements ---------------- */
  var parallax = reduceMotion ? [] : $$('[data-parallax]');
  var scrubs = $$('[data-scrub]').map(function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.textContent = '';
    words.forEach(function (w, k) {
      var sp = document.createElement('span'); sp.className = 'sw'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = w;
      el.appendChild(sp); if (k < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    return { el: el, words: $$('.sw', el) };
  });
  var ticking = false;
  function motion() {
    ticking = false;
    var vh = window.innerHeight;
    parallax.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var k = parseFloat(el.dataset.parallax) || 0.1;
      var shift = (r.top + r.height / 2 - vh / 2) * -k;
      var scale = el.tagName === 'IMG' ? ' scale(1.14)' : '';
      el.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0)' + scale;
    });
    scrubs.forEach(function (sc) {
      var r = sc.el.getBoundingClientRect();
      var p = reduceMotion ? 1 : Math.max(0, Math.min(1, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      var lit = Math.round(p * sc.words.length);
      sc.words.forEach(function (w, k) { w.classList.toggle('on', k < lit); });
    });
  }
  function requestMotion() { if (!ticking) { ticking = true; requestAnimationFrame(motion); } }
  if (parallax.length || scrubs.length) {
    window.addEventListener('scroll', requestMotion, { passive: true });
    window.addEventListener('resize', requestMotion);
    motion();
  }

  /* Magnetic call-to-action buttons (mouse only) */
  if (!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    $$('.vhero .btn, .btn--gold, .cta-strip .btn, .statement-wrap .btn').forEach(function (b) {
      b.classList.add('is-magnetic');
      b.addEventListener('mousemove', function (e) {
        var r = b.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / r.width; var y = (e.clientY - r.top - r.height / 2) / r.height;
        b.style.transform = 'translate(' + (x * 10).toFixed(1) + 'px,' + (y * 8).toFixed(1) + 'px)';
      });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
    });
  }

  /* Background hero video: smaller file on phones, paused off screen and for reduced motion */
  $$('video[data-hero-video]').forEach(function (v) {
    var source = v.querySelector('source');
    if (source && source.dataset.srcMobile && window.innerWidth < 900) { source.src = source.dataset.srcMobile; v.load(); }
    if (reduceMotion) { v.removeAttribute('autoplay'); v.pause(); return; }
    var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } else v.pause(); });
      }).observe(v);
    }
  });

  /* Film player */
  var vm = $('#videoModal'); var vmVideo = vm && $('video', vm);
  function stopVideo() { if (!vmVideo) return; vmVideo.pause(); vmVideo.removeAttribute('src'); vmVideo.load(); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-video]');
    if (!t || !vm) return;
    e.preventDefault();
    var hd = window.innerWidth > 900 && !(navigator.connection && /2g|3g/.test(navigator.connection.effectiveType || ''));
    vmVideo.src = hd ? t.dataset.video : (t.dataset.videoSd || t.dataset.video);
    vmVideo.poster = t.dataset.poster || '';
    openModal(vm);
    var q = vmVideo.play(); if (q && q.catch) q.catch(function () {});
    track('popup_open', 'video:' + (t.dataset.label || ''));
  });
  if (vm) {
    $$('[data-close]', vm).forEach(function (b) { b.addEventListener('click', stopVideo); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') stopVideo(); });
  }

  /* ---------------- Site settings managed in /admin ---------------- */
  // Pages are built with the saved settings (window.__S). Fresh values from /api/settings replace
  // them in text and links, so an admin change shows up without a redeploy.
  function applySettings(next) {
    var cur = window.__S || {};
    var swaps = [];
    ['phone', 'phone_tel', 'whatsapp', 'email', 'price'].forEach(function (k) {
      if (next[k] && cur[k] && next[k] !== cur[k]) swaps.push([cur[k], next[k]]);
    });
    if (swaps.length) {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = walker.nextNode())) {
        var v = n.nodeValue;
        swaps.forEach(function (sw) { v = v.split(sw[0]).join(sw[1]); });
        if (v !== n.nodeValue) n.nodeValue = v;
      }
      $$('a[href], [aria-label]').forEach(function (el) {
        ['href', 'aria-label'].forEach(function (attr) {
          var val = el.getAttribute(attr); if (!val) return;
          var out = val; swaps.forEach(function (sw) { out = out.split(sw[0]).join(sw[1]); });
          if (out !== val) el.setAttribute(attr, out);
        });
      });
    }
    var bar = $('#announce');
    if (bar && next.announcement) {
      bar.textContent = next.announcement;
      if (/^(https?:\/\/|\/)/.test(next.announcement_link || '')) {
        var a = document.createElement('a'); a.href = next.announcement_link; a.textContent = 'Know more'; bar.appendChild(a);
      }
      bar.classList.add('is-on');
    }
    if (popup && next.popup_title && cur.popup_title && next.popup_title !== cur.popup_title) {
      var title = $('.popup__title', popup); if (title && title.textContent === cur.popup_title) title.textContent = next.popup_title;
    }
    window.__S = Object.assign({}, cur, next);
  }
  var settingsReady = fetch(CFG.api + '/api/settings')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (st) { applySettings(st || {}); return window.__S || {}; })
    .catch(function () { return window.__S || {}; });

  if (popup && popup.hasAttribute('data-auto') && !store.get('rg_popup_seen') && !store.get('rg_submitted')) {
    settingsReady.then(function (st) {
      if (st && st.popup_enabled === false) return;
      var secs = Number(st && st.popup_delay);
      if (!(secs >= 3 && secs <= 120)) secs = CFG.popupDelay / 1000;
      schedulePopup(secs * 1000);
    });
  }

  /* ---------------- Misc ---------------- */
  $$('[data-position]').forEach(function (a) {
    a.addEventListener('click', function () {
      var sel = $('select[name="position"]');
      if (sel) sel.value = a.dataset.position;
    });
  });
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // Live chat (Tawk.to, same widget as the previous site), loaded after the page is idle.
  function loadTawk() {
    if (window.Tawk_API || !CFG.tawk) return;
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_API.customStyle = { visibility: { desktop: { position: 'br', xOffset: 20, yOffset: 20 }, mobile: { position: 'br', xOffset: 12, yOffset: 84 } } };
    window.Tawk_LoadStart = new Date();
    var s = document.createElement('script'); s.async = true; s.src = CFG.tawk; s.charset = 'UTF-8'; s.setAttribute('crossorigin', '*');
    document.body.appendChild(s);
  }
  var tawkTimer = setTimeout(loadTawk, 6000);
  ['pointerdown', 'keydown', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, function once() { window.removeEventListener(ev, once); clearTimeout(tawkTimer); tawkTimer = setTimeout(loadTawk, 2500); }, { passive: true });
  });
})();
