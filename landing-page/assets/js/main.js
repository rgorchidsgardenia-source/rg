(function () {
  'use strict';

  var CFG = Object.assign({
    apiBase: '',
    videoBase: 'assets/video/',
    popup: { firstDelay: 10000, repeatMin: 10000, repeatMax: 15000 },
    thankYouUrl: ''
  }, window.RG_CONFIG || {});

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var store = {
    get: function (area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set: function (area, k, v) { try { window[area].setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.dataLayer = window.dataLayer || [];
  function track(event, data) { window.dataLayer.push(Object.assign({ event: event }, data || {})); }

  /* ---------- Config-driven copy ---------- */
  if (CFG.price) $$('[data-price]').forEach(function (el) { el.textContent = CFG.price; });
  if (CFG.size) $$('[data-size]').forEach(function (el) { el.textContent = CFG.size; });
  var yearEl = $('#year'); if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- UTM capture (kept for the whole session) ---------- */
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  (function captureUtm() {
    var params = new URLSearchParams(location.search);
    ATTR_KEYS.forEach(function (k) { var v = params.get(k); if (v) store.set('sessionStorage', 'rg_' + k, v.slice(0, 200)); });
    if (!store.get('sessionStorage', 'rg_referrer')) store.set('sessionStorage', 'rg_referrer', document.referrer.slice(0, 300));
  })();

  /* ---------- Header ---------- */
  var header = $('.site-header');
  function onScroll() { header.classList.toggle('scrolled', window.scrollY > 40); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var navLinks = $$('.main-nav a');
  if ('IntersectionObserver' in window) {
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    navLinks.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) navIO.observe(s); });
  }

  /* ---------- Reveal + counters ---------- */
  function countUp(el) {
    var end = parseFloat(el.dataset.count), dec = parseInt(el.dataset.decimals || '0', 10);
    var fmt = function (n) { return el.dataset.format === 'in' ? Math.round(n).toLocaleString('en-IN') : n.toFixed(dec); };
    if (reduceMotion) { el.textContent = fmt(end); return; }
    var t0 = null, dur = 1600;
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(end * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        revealIO.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal').forEach(function (el, i) {
      el.style.transitionDelay = (el.parentElement.querySelectorAll(':scope > .reveal').length > 1 ? (Array.prototype.indexOf.call(el.parentElement.children, el) % 4) * 80 : 0) + 'ms';
      revealIO.observe(el);
    });
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); countIO.unobserve(e.target); } });
    }, { threshold: 0.6 });
    $$('[data-count]').forEach(function (el) { countIO.observe(el); });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Hero video: only play while visible ---------- */
  var heroVideo = $('.hero-video');
  if (heroVideo) {
    if (CFG.videoBase && CFG.videoBase !== 'assets/video/') {
      $$('source', heroVideo).forEach(function (s) { s.src = CFG.videoBase + s.getAttribute('src').split('/').pop(); });
      heroVideo.poster = CFG.videoBase + 'hero-poster.jpg';
      heroVideo.load();
    }
    if (reduceMotion) { heroVideo.removeAttribute('autoplay'); heroVideo.pause(); }
    else if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !document.body.classList.contains('modal-open')) { var p = heroVideo.play(); if (p && p.catch) p.catch(function () {}); }
          else heroVideo.pause();
        });
      }, { threshold: 0.05 }).observe(heroVideo);
    }
  }

  /* ---------- Tabs: rooms, floor plans, location ---------- */
  function activateTab(btns, btn) {
    btns.forEach(function (b) { var on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  }

  var spaceBtns = $$('.space-item'), spaceImg = $('#spaceImg');
  spaceBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.classList.contains('active')) return;
      activateTab(spaceBtns, btn);
      spaceImg.classList.add('swap');
      var next = new Image();
      next.onload = function () { spaceImg.src = next.src; spaceImg.classList.remove('swap'); };
      next.src = btn.dataset.img;
    });
  });
  // warm the cache so swaps are instant
  window.addEventListener('load', function () { setTimeout(function () { spaceBtns.forEach(function (b) { new Image().src = b.dataset.img; }); }, 1500); });

  var planStage = $('.plan-stage'), planBtns = $$('[data-plan]');
  function isUnlocked() { return store.get('localStorage', 'rg_plans_unlocked') === '1'; }
  function refreshPlanLock() {
    var active = $('.plan.active', planStage);
    var locked = !isUnlocked();
    planStage.classList.toggle('locked', locked);
    planStage.classList.toggle('show-lock', locked && active && active.classList.contains('gated'));
  }
  planBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(planBtns, btn);
      $$('.plan', planStage).forEach(function (p) { p.classList.toggle('active', p.dataset.planPanel === btn.dataset.plan); });
      refreshPlanLock();
    });
  });
  if (planStage) refreshPlanLock();

  var locBtns = $$('[data-loc]');
  locBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(locBtns, btn);
      $$('.loc-list').forEach(function (l) { l.classList.toggle('active', l.dataset.locPanel === btn.dataset.loc); });
    });
  });

  // Load the Google Map only when it is about to scroll into view
  var mapFrame = $('.map-wrap iframe');
  if (mapFrame) {
    var loadMap = function () { if (!mapFrame.src) mapFrame.src = mapFrame.dataset.src; };
    if ('IntersectionObserver' in window) {
      var mapIO = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { loadMap(); mapIO.disconnect(); } }, { rootMargin: '400px' });
      mapIO.observe(mapFrame);
    } else loadMap();
  }

  /* ---------- Modal plumbing ---------- */
  var openStack = [];
  var lastFocus = null;
  function openModal(modal, focusEl) {
    if (!openStack.length) lastFocus = document.activeElement;
    modal.hidden = false;
    openStack.push(modal);
    document.body.classList.add('modal-open');
    if (heroVideo) heroVideo.pause();
    setTimeout(function () { (focusEl || $('.modal-close', modal)).focus({ preventScroll: true }); }, 30);
  }
  function closeModal(modal) {
    if (modal.hidden) return;
    modal.hidden = true;
    openStack = openStack.filter(function (m) { return m !== modal; });
    if (!openStack.length) {
      document.body.classList.remove('modal-open');
      if (heroVideo && !reduceMotion && heroVideo.getBoundingClientRect().bottom > 0) { var p = heroVideo.play(); if (p && p.catch) p.catch(function () {}); }
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
    modal.dispatchEvent(new CustomEvent('modal:closed'));
  }
  $$('.modal').forEach(function (modal) {
    $$('[data-close]', modal).forEach(function (el) { el.addEventListener('click', function () { closeModal(modal); }); });
  });
  document.addEventListener('keydown', function (e) {
    var top = openStack[openStack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') { closeModal(top); return; }
    if (e.key === 'Tab') {
      var f = $$('a[href], button:not([disabled]), input:not([type="hidden"]):not(.hp), select, video[controls]', top).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Video player ---------- */
  var videoModal = $('#videoModal'), player = $('#player');
  function pickQuality() {
    var c = navigator.connection || {};
    if (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || '')) return '720';
    var px = Math.min(window.innerWidth, 1920) * Math.min(window.devicePixelRatio || 1, 2);
    return px >= 1500 ? '1080' : '720';
  }
  $$('[data-play]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.play;
      player.poster = CFG.videoBase + key + '-poster.jpg';
      player.src = CFG.videoBase + key + '-' + pickQuality() + '.mp4';
      openModal(videoModal, player);
      var p = player.play(); if (p && p.catch) p.catch(function () {});
      track('video_play', { video: key });
    });
  });
  videoModal.addEventListener('modal:closed', function () {
    player.pause();
    player.removeAttribute('src');
    player.load(); // stops the download
    scheduleLead(randomRepeat());
  });

  /* ---------- Lightbox ---------- */
  var lightbox = $('#lightbox'), lightboxImg = $('#lightboxImg');
  $$('[data-lightbox]').forEach(function (fig) {
    fig.addEventListener('click', function () {
      if (fig.classList.contains('gated') && planStage.classList.contains('locked')) return;
      var img = $('img', fig);
      lightboxImg.src = img.currentSrc || img.src;
      lightboxImg.alt = img.alt;
      openModal(lightbox);
    });
  });

  /* ---------- Lead popup ---------- */
  var leadModal = $('#leadModal'), leadTitle = $('#leadTitle'), popupForm = $('form', leadModal);
  var AUTO_PROMPTS = [
    ['Get the Price Sheet', 'Price sheet'],
    ['Unlock Floor Plans', 'Floor plans'],
    ['Book a Free Site Visit', 'Site visit'],
    ['Ask About the 50:50 Offer', 'Offer details']
  ];
  var autoIndex = 0, leadTimer = null;

  function hasSubmitted() { return store.get('sessionStorage', 'rg_lead_submitted') === '1'; }
  function randomRepeat() {
    var p = CFG.popup;
    return p.repeatMin + Math.random() * Math.max(0, p.repeatMax - p.repeatMin);
  }
  function setPopupCopy(title, interest) {
    leadTitle.textContent = title || 'Get the Price Sheet';
    popupForm.elements.interest.value = interest || 'Price sheet';
  }
  function openLead(source, title, interest) {
    clearTimeout(leadTimer);
    setPopupCopy(title, interest);
    popupForm.dataset.source = source;
    var touch = window.matchMedia('(hover: none)').matches;
    openModal(leadModal, source === 'auto' || touch ? null : popupForm.elements.name);
    track('lead_popup_open', { source: source });
  }
  function scheduleLead(delay) {
    clearTimeout(leadTimer);
    if (hasSubmitted()) return;
    leadTimer = setTimeout(function tryOpen() {
      if (hasSubmitted()) return;
      var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.lead-form');
      // Don't interrupt someone watching a film, viewing an image or filling a form.
      if (openStack.length || typing || document.hidden) { leadTimer = setTimeout(tryOpen, 4000); return; }
      var prompt = AUTO_PROMPTS[autoIndex++ % AUTO_PROMPTS.length];
      openLead('auto', prompt[0], prompt[1]);
    }, delay);
  }
  leadModal.addEventListener('modal:closed', function () { scheduleLead(randomRepeat()); });

  $$('[data-open-lead]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openLead(btn.dataset.openLead, btn.dataset.leadTitle, btn.dataset.leadInterest);
    });
  });

  scheduleLead(CFG.popup.firstDelay);

  /* ---------- Forms ---------- */
  function normalisePhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length > 10 && d.indexOf('91') === 0) d = d.slice(2);
    if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function setError(input, msg) {
    var field = input.closest('.field');
    if (!field) return;
    field.classList.toggle('invalid', !!msg);
    var err = $('.err', field);
    if (msg) {
      if (!err) { err = document.createElement('span'); err.className = 'err'; field.appendChild(err); }
      err.textContent = msg;
    } else if (err) err.remove();
  }
  function validate(form) {
    var ok = true, els = form.elements;
    var name = els.name.value.trim();
    if (name.length < 2) { setError(els.name, 'Please enter your name'); ok = false; } else setError(els.name, '');
    var phone = normalisePhone(els.phone.value);
    if (!/^[6-9]\d{9}$/.test(phone)) { setError(els.phone, 'Enter a valid 10-digit mobile number'); ok = false; } else setError(els.phone, '');
    if (els.email && els.email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(els.email.value.trim())) { setError(els.email, 'Enter a valid email or leave it blank'); ok = false; }
    else if (els.email) setError(els.email, '');
    var msg = $('.form-msg', form);
    if (els.consent && !els.consent.checked) { msg.className = 'form-msg error'; msg.textContent = 'Please allow us to contact you.'; ok = false; }
    return ok;
  }
  function payload(form) {
    var els = form.elements, data = {
      name: els.name.value.trim(),
      phone: normalisePhone(els.phone.value),
      email: els.email ? els.email.value.trim() : '',
      interest: els.interest ? els.interest.value : '',
      visit_date: els.visit_date ? els.visit_date.value : '',
      company: els.company ? els.company.value : '', // honeypot
      form_id: form.dataset.formId + (form.dataset.source ? ':' + form.dataset.source : ''),
      page_url: location.href.split('#')[0],
      referrer: store.get('sessionStorage', 'rg_referrer') || ''
    };
    ATTR_KEYS.forEach(function (k) { data[k] = store.get('sessionStorage', 'rg_' + k) || ''; });
    return data;
  }
  var toast = $('#toast'), toastTimer;
  function showToast() {
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }

  $$('.lead-form').forEach(function (form) {
    var phoneInput = form.elements.phone;
    phoneInput.addEventListener('input', function () {
      // Accepts "+91 98765 43210", "098765 43210" or pasted/autofilled numbers.
      var d = phoneInput.value.replace(/\D/g, '');
      if (d.length > 10) d = normalisePhone(d);
      if (d.length > 10) d = d.slice(-10);
      if (phoneInput.value !== d) phoneInput.value = d;
    });
    $$('input', form).forEach(function (i) { i.addEventListener('input', function () { if (i.closest('.field.invalid')) setError(i, ''); }); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('.form-msg', form);
      msg.className = 'form-msg'; msg.textContent = '';
      if (!validate(form)) return;

      var btn = $('button[type="submit"]', form), label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending…';

      fetch(CFG.apiBase.replace(/\/$/, '') + '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(form))
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Request failed'); return j; }); })
        .then(function () {
          store.set('sessionStorage', 'rg_lead_submitted', '1');
          store.set('localStorage', 'rg_plans_unlocked', '1');
          clearTimeout(leadTimer);
          if (planStage) refreshPlanLock();
          track('lead_submit', { form_id: form.dataset.formId, interest: form.elements.interest ? form.elements.interest.value : '' });
          form.reset();
          msg.className = 'form-msg ok';
          msg.textContent = 'Thank you! We’ll call you shortly.';
          if (!leadModal.hidden) closeModal(leadModal);
          if (CFG.thankYouUrl) { location.href = CFG.thankYouUrl; return; }
          showToast();
        })
        .catch(function (err) {
          msg.className = 'form-msg error';
          msg.innerHTML = (err && err.message && err.message !== 'Failed to fetch' && err.message !== 'Request failed' ? err.message + '. ' : 'Something went wrong. ') +
            'Please try again or call <a href="tel:+919988996506"><b>99 88 99 6506</b></a>.';
        })
        .then(function () { btn.disabled = false; btn.innerHTML = label; });
    });
  });

  /* ---------- Click tracking for calls / WhatsApp ---------- */
  $$('[data-track]').forEach(function (el) {
    el.addEventListener('click', function () { track('contact_click', { channel: el.dataset.track }); });
  });
})();
