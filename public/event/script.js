// Mappingg Events — registration form. Posts to the Mappingg website API
// (config.js → apiBase); each registration appears in the Mappingg admin panel
// under CRM & Leads → Event registrations.
(function () {
  var cfg = window.MAPPINGG_EVENT || {};
  var form = document.getElementById('form');
  var f = form.elements; // not form.name — that is the form's own name attribute
  var errBox = document.getElementById('err');
  var btn = document.getElementById('submit');
  var btnHtml = btn.innerHTML;

  document.getElementById('yr').textContent = new Date().getFullYear();

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu: toggles the icon, closes on link tap, outside tap or Escape.
  var menuBtn = document.getElementById('menuBtn');
  var menuUse = menuBtn.querySelector('use');
  var nav = document.getElementById('nav');
  function setMenu(open) {
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuUse.setAttribute('href', open ? '#i-x' : '#i-menu');
  }
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!nav.classList.contains('open')); });
  nav.addEventListener('click', function () { setMenu(false); });
  document.addEventListener('click', function (e) { if (nav.classList.contains('open') && !nav.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // Header shadow once the page scrolls.
  var hd = document.querySelector('.hd');
  function onScroll() { hd.classList.toggle('scrolled', scrollY > 8); }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // "Add to calendar" links (Google Calendar), from config.js.
  function gcalDate(iso) { return new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, ''); }
  if (cfg.start && cfg.end) {
    var cal = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent(cfg.title || cfg.eventName || 'Mappingg Event')
      + '&dates=' + gcalDate(cfg.start) + '/' + gcalDate(cfg.end)
      + '&location=' + encodeURIComponent(cfg.venue || '')
      + '&details=' + encodeURIComponent('Mappingg Events — ' + location.href.split('#')[0]);
    document.querySelectorAll('.js-cal').forEach(function (a) { a.href = cal; });
  } else {
    document.querySelectorAll('.js-cal').forEach(function (a) { a.hidden = true; });
  }

  // Countdown to the event (hidden once it has started).
  var cd = document.getElementById('countdown');
  var startAt = cfg.start ? new Date(cfg.start).getTime() : NaN;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tickCountdown() {
    var left = Math.floor((startAt - Date.now()) / 1000);
    if (!(left > 0)) { cd.hidden = true; return false; }
    cd.hidden = false;
    var v = { d: Math.floor(left / 86400), h: Math.floor(left / 3600) % 24, m: Math.floor(left / 60) % 60, s: left % 60 };
    cd.querySelectorAll('b').forEach(function (b) { b.textContent = pad(v[b.getAttribute('data-k')]); });
    return true;
  }
  if (cd && tickCountdown()) setInterval(tickCountdown, 1000);

  // Registration popup: the hero's form card (#register) is moved into the dialog while it is
  // open and put back on close, so there is one form, one set of handlers and one success screen.
  var reg = document.getElementById('register');
  var pop = document.getElementById('regPop');
  var ph = null; // keeps the card's space in the hero while it is in the popup
  function openPop(focusName) {
    if (typeof pop.showModal !== 'function') { // very old browsers: scroll to the form instead
      reg.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    if (!pop.open) {
      ph = document.createElement('div');
      ph.className = 'reg-ph';
      ph.style.minHeight = reg.offsetHeight + 'px';
      reg.parentNode.insertBefore(ph, reg);
      pop.appendChild(reg);
      pop.showModal();
    }
    if (focusName && !form.closest('[hidden]')) f.name.focus();
    else if (!focusName) document.getElementById('popClose').focus();
  }
  pop.addEventListener('close', function () {
    if (ph) { ph.parentNode.replaceChild(reg, ph); ph = null; }
  });
  document.getElementById('popClose').addEventListener('click', function () { pop.close(); });
  pop.addEventListener('click', function (e) { if (e.target === pop) pop.close(); }); // backdrop click
  document.querySelectorAll('a[href="#register"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      openPop(true);
    });
  });

  // Mobile sticky "Register" bar: shown while the hero and the form are off screen.
  var mCta = document.getElementById('mCta');
  if ('IntersectionObserver' in window) {
    var regSeen = true, heroSeen = true;
    var syncBar = function () {
      var show = !regSeen && !heroSeen && document.getElementById('done').hidden;
      mCta.classList.toggle('show', show);
      mCta.setAttribute('aria-hidden', String(!show));
      mCta.querySelector('a').tabIndex = show ? 0 : -1;
    };
    new IntersectionObserver(function (es) { regSeen = es[0].isIntersecting; syncBar(); }).observe(reg);
    new IntersectionObserver(function (es) { heroSeen = es[0].isIntersecting; syncBar(); }).observe(document.querySelector('.hero-copy'));
    new IntersectionObserver(function (es) { mCta.style.visibility = es[0].isIntersecting ? 'hidden' : ''; }).observe(document.querySelector('.cta'));

    // Reveal sections as they scroll into view.
    if (!reduced) {
      var items = document.querySelectorAll('.l-why-art, .l-why > div, .spk, .ros-meta, .ros-i, .ros-bar, .lv-grid > li, .l-join, .vh-head, .vid, .devs-band .ros-head, .logos-rows, .pbs-top, .pb, .pbs-end');
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px' });
      items.forEach(function (el) {
        var i = Array.prototype.indexOf.call(el.parentNode.children, el);
        el.style.transitionDelay = Math.min(i, 5) * 70 + 'ms';
        el.classList.add('rv');
        io.observe(el);
      });
    }
  }

  // "Trusted by Developers": the home page's developer logos (Super admin → Developers,
  // /api/developers?trusted=1), in two rows once there are enough of them (alternating, so
  // both rows mix the biggest names). The five logos in the HTML stay if these can't be loaded.
  (function () {
    var lists = document.querySelectorAll('.logos');
    if (!lists.length || !window.fetch) return;
    function fill(list, devs) {
      // One copy is at least ten logos long (wider than the screen); the CSS loops three copies.
      var per = Math.max(devs.length, 10);
      var frag = document.createDocumentFragment();
      for (var c = 0; c < 3; c++) {
        for (var i = 0; i < per; i++) {
          var d = devs[i % devs.length], hidden = c > 0 || i >= devs.length;
          var li = document.createElement('li'), img = document.createElement('img');
          if (hidden) li.setAttribute('aria-hidden', 'true');
          img.src = d.logo; img.alt = hidden ? '' : d.name; img.title = d.name; img.decoding = 'async';
          li.appendChild(img); frag.appendChild(li);
        }
      }
      list.replaceChildren(frag);
      list.style.animationDuration = Math.round(per * 3.2) + 's';
    }
    fetch('/api/developers?trusted=1').then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      var devs = ((b && b.data) || []).filter(function (d) { return d && d.logo && d.name; });
      if (devs.length < 4) return;
      var two = devs.length >= 12 && lists.length > 1;
      fill(lists[0], two ? devs.filter(function (_, i) { return i % 2 === 0; }) : devs);
      if (two) {
        fill(lists[1], devs.filter(function (_, i) { return i % 2 === 1; }));
        lists[1].parentNode.hidden = false;
      }
    }).catch(function () {});
  })();

  // Carousels (speakers, Video Hub): arrows scroll by one card; hidden when everything fits.
  document.querySelectorAll('.carousel').forEach(function (car) {
    var track = car.querySelector('.track');
    var prev = car.querySelector('.car-btn.prev');
    function sync() {
      car.classList.toggle('static', track.scrollWidth <= track.clientWidth + 4);
      prev.disabled = track.scrollLeft < 4;
    }
    track.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);
    sync();
    car.querySelectorAll('.car-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var card = track.firstElementChild;
        var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        var step = card ? card.getBoundingClientRect().width + gap : track.clientWidth;
        var dir = Number(b.getAttribute('data-dir'));
        var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
        if (dir > 0 && atEnd) track.scrollTo({ left: 0, behavior: 'smooth' });
        else track.scrollBy({ left: dir * step, behavior: 'smooth' });
      });
    });
  });

  // Digits only in the mobile number.
  f.phone.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });

  // Live field feedback: green border once valid, error cleared as soon as it's fixed.
  var checks = {
    name: function (v) { return v.trim().length >= 2; },
    email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); },
    phone: function (v) { return /^\d{10}$/.test(v); },
    city: function (v) { return v.trim().length >= 2; },
    attendee_type: function (v) { return !!v; },
  };
  Object.keys(checks).forEach(function (k) {
    var el = f[k], wrap = el.closest('.field');
    var update = function () {
      var good = checks[k](el.value);
      wrap.classList.toggle('ok', good);
      if (good && wrap.classList.contains('bad')) { wrap.classList.remove('bad'); errBox.hidden = true; }
    };
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });

  // Custom dropdowns: the native <select> stays in the form (validation and submit read it),
  // hidden behind a button + styled option list. Keyboard: arrows, Home/End, Enter, Esc, type-ahead.
  var ddIcons = { 'Home buyer': 'i-pin', Investor: 'i-chart', Developer: 'i-layers', 'Channel partner': 'i-team', Other: 'i-spark' };
  var ddNames = { '+91': 'India', '+971': 'UAE', '+1': 'USA / Canada', '+44': 'UK', '+65': 'Singapore' };
  var openDd = null;
  function svgIc(id, cls) { return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function enhanceSelect(sel, n) {
    var wrap = sel.closest('.field, .sel');
    var ph = sel.querySelector('option[disabled]');
    var opts = Array.prototype.filter.call(sel.options, function (o) { return !o.disabled; });
    var label = sel.getAttribute('aria-label') || (ph ? ph.textContent.replace(/[…*\s]+$/, '') : '');
    var id = 'dd' + n;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    var list = document.createElement('ul');
    list.className = 'dd-list';
    list.id = id;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    opts.forEach(function (o, i) {
      var li = document.createElement('li');
      li.id = id + '-' + i;
      li.setAttribute('role', 'option');
      var icon = ddIcons[o.value], name = ddNames[o.value];
      li.innerHTML = (icon ? '<span class="dd-ic">' + svgIc(icon) + '</span>' : '')
        + (name ? '<b>' + o.textContent + '</b><span class="dd-sub">' + name + '</span>' : '<span>' + o.textContent + '</span>')
        + svgIc('i-check', 'dd-ck');
      li.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus on the button
      li.addEventListener('mousemove', function () { if (active !== i) setActive(i); });
      li.addEventListener('click', function (e) { e.preventDefault(); pick(i); });
      list.appendChild(li);
    });
    sel.classList.add('dd-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    wrap.appendChild(list);
    wrap.classList.add('dd');

    var active = -1;
    function refresh() {
      var o = sel.options[sel.selectedIndex];
      var has = !!o && !o.disabled;
      btn.textContent = has ? o.textContent : (ph ? ph.textContent : '');
      btn.classList.toggle('ph', !has);
      btn.setAttribute('aria-label', label + (has ? ': ' + o.textContent : ''));
      opts.forEach(function (op, i) { list.children[i].setAttribute('aria-selected', String(has && op === o)); });
    }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, j) { li.classList.toggle('active', j === i); });
      if (i < 0) { btn.removeAttribute('aria-activedescendant'); return; }
      btn.setAttribute('aria-activedescendant', id + '-' + i);
      var li = list.children[i]; // keep the active option visible when the list scrolls
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop - 6;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight + 6;
    }
    // Fits the list inside the viewport and any clipping ancestor (the popup on small screens):
    // opens downwards if it fits, else towards the side with more room, scrolling inside if needed.
    function place() {
      wrap.classList.remove('up');
      list.style.maxHeight = '';
      var top = 0, bottom = innerHeight;
      for (var el = wrap.parentElement; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).overflowY === 'visible') continue;
        var b = el.getBoundingClientRect();
        top = Math.max(top, b.top);
        bottom = Math.min(bottom, b.bottom);
      }
      var w = wrap.getBoundingClientRect(), h = list.offsetHeight;
      var below = bottom - w.bottom - 14, above = w.top - top - 14;
      if (h <= below) return;
      if (above > below) wrap.classList.add('up');
      var room = Math.max(above, below, 132);
      if (h > room) list.style.maxHeight = room + 'px';
    }
    function open() {
      if (openDd && openDd !== api) openDd.close();
      list.hidden = false;
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      place();
      setActive(Math.max(opts.indexOf(sel.options[sel.selectedIndex]), 0));
      btn.focus();
      openDd = api;
    }
    function close() {
      list.hidden = true;
      wrap.classList.remove('open', 'up');
      btn.setAttribute('aria-expanded', 'false');
      setActive(-1);
      if (openDd === api) openDd = null;
    }
    function pick(i) {
      sel.value = opts[i].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      btn.focus();
    }
    btn.addEventListener('click', function () { if (list.hidden) open(); else close(); });
    btn.addEventListener('blur', close);
    btn.addEventListener('keydown', function (e) {
      var k = e.key, isOpen = !list.hidden, last = opts.length - 1;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) open();
        else setActive(k === 'ArrowDown' ? (active >= last ? 0 : active + 1) : (active <= 0 ? last : active - 1));
      } else if (isOpen && (k === 'Home' || k === 'End')) {
        e.preventDefault();
        setActive(k === 'Home' ? 0 : last);
      } else if (isOpen && (k === 'Enter' || k === ' ')) {
        e.preventDefault();
        if (active >= 0) pick(active);
      } else if (isOpen && k === 'Escape') {
        e.preventDefault(); // keep the popup open
        e.stopPropagation();
        close();
      } else if (k.length === 1 && /\S/.test(k)) { // type-ahead on the first letter
        var from = isOpen ? active : opts.indexOf(sel.options[sel.selectedIndex]);
        for (var s = 1; s <= opts.length; s++) {
          var j = (from + s + opts.length) % opts.length;
          if (opts[j].textContent.trim().toLowerCase().indexOf(k.toLowerCase()) === 0) {
            if (isOpen) setActive(j); else pick(j);
            break;
          }
        }
      }
    });
    // Clicks anywhere on the field (icon, padding) open the list instead of focusing the hidden select.
    wrap.addEventListener('click', function (e) {
      if (btn.contains(e.target) || list.contains(e.target)) return;
      e.preventDefault();
      btn.click();
    });
    sel.addEventListener('change', refresh); // also catches values copied in from the quick form
    var api = { close: close, btn: btn, wrap: wrap };
    sel._dd = api;
    refresh();
  }
  document.querySelectorAll('#form select, #quickForm select').forEach(enhanceSelect);
  document.addEventListener('pointerdown', function (e) {
    if (openDd && !openDd.wrap.contains(e.target)) openDd.close();
  });

  function showError(msg, field) {
    errBox.textContent = msg;
    errBox.hidden = false;
    form.querySelectorAll('.field.bad').forEach(function (f) { f.classList.remove('bad'); });
    if (field) {
      var wrap = field.closest('.field');
      if (wrap) wrap.classList.add('bad');
      (field._dd ? field._dd.btn : field).focus();
    }
  }

  function validate() {
    var name = f.name.value.trim();
    var email = f.email.value.trim();
    var phone = f.phone.value.trim();
    if (name.length < 2) return showError('Please enter your full name.', f.name), false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email address.', f.email), false;
    if (!/^\d{10}$/.test(phone)) return showError('Please enter a valid 10-digit mobile number.', f.phone), false;
    if (f.city.value.trim().length < 2) return showError('Please enter your city.', f.city), false;
    if (!f.attendee_type.value) return showError('Please tell us who you are (I am a…).', f.attendee_type), false;
    if (!f.agree.checked) return showError('Please accept the Event Terms & Conditions and Privacy Policy.', f.agree), false;
    return true;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.hidden = true;
    if (!validate()) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Registering…';
    var body = {
      name: f.name.value.trim(),
      email: f.email.value.trim(),
      phone: f.code.value + ' ' + f.phone.value.trim(),
      attendee_type: f.attendee_type.value,
      city: f.city.value.trim(),
      event: cfg.eventName || '',
      agree: f.agree.checked,
      consent_whatsapp: f.consent_whatsapp.checked,
      company: f.company.value,
    };

    fetch((cfg.apiBase || '').replace(/\/$/, '') + '/api/event-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (!r.ok) throw new Error((b && b.error && b.error.message) || 'Could not register. Please try again.');
          return b.data || {};
        });
      })
      .then(function (d) {
        if (d.already) document.getElementById('doneMsg').textContent = 'You’re already registered with this email — we’ll send the livestream links before we go live.';
        document.getElementById('regForm').hidden = true;
        document.getElementById('done').hidden = false;
        mCta.classList.remove('show');
        if (!pop.open) reg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        confetti();
      })
      .catch(function (err) {
        showError(err && err.message && err.message !== 'Failed to fetch' ? err.message : 'Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.innerHTML = btnHtml;
      });
  });

  // "Be Part of the Grand Launch" band: copies its details into the main form and submits that,
  // so both share one validation, API call and success screen. Its fine print covers the agreement.
  var quick = document.getElementById('quickForm');
  var q = quick.elements;
  q.phone.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });
  quick.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!document.getElementById('done').hidden) { openPop(false); return; }
    ['name', 'email', 'phone', 'city', 'attendee_type'].forEach(function (k) {
      f[k].value = q[k].value;
      f[k].dispatchEvent(new Event('change'));
    });
    f.code.value = '+91';
    f.agree.checked = true;
    f.consent_whatsapp.checked = q.consent_whatsapp.checked;
    openPop(false);
    if (validate()) form.requestSubmit(btn);
  });

  // Small confetti burst on successful registration.
  function confetti() {
    if (reduced) return;
    var c = document.getElementById('confetti');
    (pop.open ? pop : document.body).appendChild(c); // the popup sits in the top layer, above the page
    var ctx = c.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = (c.width = innerWidth * dpr), h = (c.height = innerHeight * dpr);
    var colors = ['#0f5c47', '#2f7a3c', '#e3a83e', '#f5c75a', '#ffffff', '#7fbf9e'];
    var bits = [];
    for (var i = 0; i < 160; i++) {
      bits.push({
        x: w * (0.2 + Math.random() * 0.6), y: h + 10,
        vx: (Math.random() - 0.5) * 16 * dpr, vy: -(13 + Math.random() * 15) * dpr,
        s: (5 + Math.random() * 7) * dpr, r: Math.random() * 3, vr: (Math.random() - 0.5) * 0.3,
        col: colors[(Math.random() * colors.length) | 0],
      });
    }
    var start = performance.now();
    (function tick(t) {
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.vy += 0.4 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.col; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (t - start < 4000) requestAnimationFrame(tick); else ctx.clearRect(0, 0, w, h);
    })(start);
  }
})();
