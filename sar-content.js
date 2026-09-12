/* SAR content module: click-to-load vertical video + hotspot filter chips. No dependencies. */
(function () {
  'use strict';

  // --- Player: nothing loads until the visitor taps play ---
  document.querySelectorAll('.c-player').forEach(function (box) {
    var btn = box.querySelector('.c-player-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var yt = box.getAttribute('data-youtube');
      var file = box.getAttribute('data-file');
      var el;
      if (yt) {
        el = document.createElement('iframe');
        el.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(yt) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1';
        el.title = box.getAttribute('data-title') || 'Video';
        el.allow = 'autoplay; encrypted-media; picture-in-picture';
        el.setAttribute('allowfullscreen', '');
      } else if (file) {
        el = document.createElement('video');
        el.src = file;
        el.controls = true;
        el.playsInline = true;
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
        el.poster = (box.querySelector('.c-player-poster') || {}).src || '';
      } else {
        return;
      }
      box.appendChild(el);
      box.classList.add('is-playing');
      if (el.tagName === 'VIDEO') {
        var p = el.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked: controls are visible */ });
      }
      if (window.gtag) { try { gtag('event', 'video_play', { video_title: box.getAttribute('data-title') || '' }); } catch (e) {} }
    });
  });

  // --- Filter chips on the hotspots index ---
  var grid = document.getElementById('hotspotGrid');
  var chips = document.querySelectorAll('.c-chip[data-filter]');
  if (grid && chips.length) {
    var empty = document.getElementById('hotspotEmpty');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        chips.forEach(function (c) { var on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        var shown = 0;
        grid.querySelectorAll('.c-vcard').forEach(function (card) {
          var show = f === 'all' || card.getAttribute('data-cat') === f;
          card.hidden = !show;
          if (show) shown++;
        });
        if (empty) empty.hidden = shown > 0;
      });
    });
  }
})();

/* ---- Find Your Instructor: steps, postcode coverage, validation ---- */
(function () {
  'use strict';
  var AREAS = [
    { re: /^MK(1[0-9]|[1-9]|4[6-9]|19)$/i, key: 'mk', msg: 'Milton Keynes — covered. Lessons from £38 an hour.' },
    { re: /^MK4[0-5]$/i, key: 'bedford', msg: 'Bedford — covered. £43 an hour with a 2-hour minimum, so your instructor can travel to you.' },
    { re: /^NN[1-7]$/i, key: 'northampton', msg: 'Northampton — covered. £43 an hour with a 2-hour minimum, so your instructor can travel to you.' },
    { re: /^LU7$/i, key: 'leighton-buzzard', msg: 'Leighton Buzzard — covered. Lessons from £38 an hour.' }
  ];
  var PC = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/i;

  function coverage(raw) {
    var m = PC.exec((raw || '').trim().replace(/\s+/g, ' '));
    if (!m) return null;
    var out = m[1].toUpperCase();
    for (var i = 0; i < AREAS.length; i++) if (AREAS[i].re.test(out)) return { key: AREAS[i].key, msg: AREAS[i].msg, outward: out };
    return { key: 'other', outward: out, msg: 'We don\'t currently cover ' + out + ' as a pickup area. Leave your details and we\'ll tell you as soon as a SAR instructor is nearby — or continue if your lessons can start from a Milton Keynes address.' };
  }

  document.querySelectorAll('form[data-matcher]').forEach(function (form) {
    form.setAttribute('novalidate', '');
    form.classList.add('is-js');
    var steps = Array.prototype.slice.call(form.querySelectorAll('.m-step'));
    var dots = form.querySelectorAll('.m-steps li');
    var status = form.querySelector('[data-status]');
    var pc = form.querySelector('[data-postcode]');
    var covMsg = form.querySelector('[data-coverage-msg]');
    var covField = form.querySelector('[data-coverage]');
    var cur = 0;

    function show(i) {
      cur = i;
      steps.forEach(function (s, k) { s.hidden = k !== i; });
      dots.forEach(function (d, k) { d.classList.toggle('is-on', k <= i); d.classList.toggle('is-done', k < i); });
      status.textContent = '';
      var first = steps[i].querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea');
      if (first && i > 0) { try { first.focus({ preventScroll: true }); } catch (e) {} }
      if (i > 0) { var r = form.getBoundingClientRect(); if (r.top < 0) form.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }
    function valid(i) {
      var s = steps[i];
      var els = s.querySelectorAll('input, select, textarea');
      for (var k = 0; k < els.length; k++) {
        var el = els[k];
        if (el.type === 'radio') {
          if (el.required && !s.querySelector('input[name="' + el.name + '"]:checked')) { status.textContent = 'Please choose an option to continue.'; return false; }
          continue;
        }
        if (!el.checkValidity()) {
          el.focus(); el.classList.add('is-bad');
          status.textContent = el.validationMessage || 'Please check this field.';
          return false;
        }
        el.classList.remove('is-bad');
      }
      if (i === 0 && pc) {
        var c = coverage(pc.value);
        if (!c) { pc.focus(); pc.classList.add('is-bad'); status.textContent = 'That doesn\'t look like a UK postcode — try the format MK3 6DH.'; return false; }
      }
      return true;
    }
    function updateCoverage() {
      var c = coverage(pc.value);
      pc.classList.remove('is-bad');
      if (!c) { covMsg.textContent = 'Every SAR lesson starts from your address in Milton Keynes. Bedford, Northampton and Leighton Buzzard are covered too.'; covMsg.className = 'm-hint'; covField.value = ''; return; }
      covMsg.textContent = c.msg; covMsg.className = 'm-hint ' + (c.key === 'other' ? 'is-warn' : 'is-ok'); covField.value = c.key + ' (' + c.outward + ')';
    }
    if (pc) { pc.addEventListener('input', updateCoverage); pc.addEventListener('blur', updateCoverage); }

    form.querySelectorAll('[data-next]').forEach(function (b) { b.addEventListener('click', function () { if (valid(cur)) show(Math.min(cur + 1, steps.length - 1)); }); });
    form.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(Math.max(cur - 1, 0)); }); });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && cur < steps.length - 1) { e.preventDefault(); if (valid(cur)) show(cur + 1); }
    });
    form.addEventListener('submit', function (e) {
      for (var i = 0; i < steps.length; i++) { if (!valid(i)) { e.preventDefault(); show(i); return; } }
      var btn = form.querySelector('[data-submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      if (window.gtag) { try { gtag('event', 'generate_lead', { form: 'matcher', coverage: covField.value }); } catch (err) {} }
    });
    show(0);
  });
})();

/* ---- Hero pass carousel: crossfade through every pass, newest first ---- */
(function () {
  'use strict';
  var box = document.querySelector('.h-carousel');
  if (!box) return;
  var nums = (box.getAttribute('data-passes') || '').split(',').map(function (n) { return parseInt(n, 10); }).filter(Boolean);
  if (nums.length < 2) return;
  var slides = box.querySelectorAll('.h-slide');
  var count = box.querySelector('[data-ccount]');
  var i = 0, cur = 0, timer = null, busy = false;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function src(n) { return '/images/pass-gallery/pass-' + ('000' + n).slice(-3) + '.webp'; }
  function preload(n) { var im = new Image(); im.src = src(n); return im; }
  function go(dir) {
    if (busy) return; busy = true;
    i = (i + dir + nums.length) % nums.length;
    var nxt = slides[1 - cur], prev = slides[cur];
    var im = new Image();
    im.onload = function () {
      nxt.src = src(nums[i]); nxt.alt = 'A SAR Driving School pupil on the day they passed their driving test';
      nxt.setAttribute('aria-hidden', 'false'); prev.setAttribute('aria-hidden', 'true');
      nxt.classList.add('is-on'); prev.classList.remove('is-on');
      cur = 1 - cur; if (count) count.textContent = String(i + 1);
      preload(nums[(i + 1) % nums.length]);
      busy = false;
    };
    im.onerror = function () { busy = false; };
    im.src = src(nums[i]);
  }
  function start() { if (reduce || timer) return; timer = setInterval(function () { go(1); }, 2500); }
  function stop() { clearInterval(timer); timer = null; }
  box.querySelector('.h-cnext').addEventListener('click', function () { stop(); go(1); start(); });
  box.querySelector('.h-cprev').addEventListener('click', function () { stop(); go(-1); start(); });
  box.addEventListener('click', function (e) { if (e.target.closest('.h-cbtn')) return; stop(); go(1); start(); });
  box.addEventListener('mouseenter', stop); box.addEventListener('mouseleave', start);
  box.addEventListener('focusin', stop); box.addEventListener('focusout', start);
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  preload(nums[1]);
  start();
})();

/* ---- Lesson cost calculator (pricing page) ---- */
(function () {
  'use strict';
  var c = document.getElementById('calculator'); if (!c) return;
  var STD = +c.getAttribute('data-std'), OUT = +c.getAttribute('data-outer'), OUTMIN = +c.getAttribute('data-outer-min'), FEE = +c.getAttribute('data-fee');
  var BH = JSON.parse(c.getAttribute('data-blocks')), BP = JSON.parse(c.getAttribute('data-block-prices'));
  var LH = JSON.parse(c.getAttribute('data-lessons')), LP = JSON.parse(c.getAttribute('data-lesson-prices'));
  var area = document.getElementById('calc-area'), hours = document.getElementById('calc-hours'), out = document.getElementById('calc-hours-out');
  var direct = document.getElementById('calc-direct'), sar = document.getElementById('calc-sar'), rate = document.getElementById('calc-rate'), note = document.getElementById('calc-note'), cta = document.getElementById('calc-cta');
  var presets = c.querySelectorAll('.p-calc-presets button');
  function gbp(n) { return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: (n % 1) ? 2 : 0, maximumFractionDigits: 2 }); }
  function calc() {
    var h = +hours.value, outer = area.value === 'outer', msg = '', price;
    if (outer) {
      if (h < OUTMIN) { h = OUTMIN; hours.value = h; }
      price = h * OUT; msg = OUT + ' an hour with a ' + OUTMIN + '-hour minimum in ' + area.options[area.selectedIndex].text + '. Ask us about block rates.';
      msg = '£' + msg;
    } else {
      var bi = BH.indexOf(h), li = LH.indexOf(h);
      if (bi > -1) { price = BP[bi]; msg = h + '-hour block rate applied — saves ' + gbp(h * STD - price) + ' against paying hourly.'; }
      else if (li > -1) { price = LP[li]; msg = 'Single lesson price.'; }
      else {
        // nearest block below + hourly top-up
        var best = 0, bp = 0; for (var i = 0; i < BH.length; i++) if (BH[i] <= h && BH[i] > best) { best = BH[i]; bp = BP[i]; }
        price = bp + (h - best) * STD;
        msg = best ? (best + '-hour block plus ' + (h - best) + ' hour' + (h - best === 1 ? '' : 's') + ' at £' + STD + '. A ' + nextBlock(h) + '-hour block would cost ' + gbp(nextPrice(h)) + '.') : 'Hourly rate of £' + STD + '.';
      }
    }
    out.textContent = h; direct.textContent = gbp(price); sar.textContent = gbp(price * (1 + FEE / 100)); rate.textContent = gbp(price / h); note.textContent = msg;
    presets.forEach(function (b) { b.classList.toggle('is-on', +b.getAttribute('data-h') === h); });
    var t = (c.querySelector('input[name=calc-t]:checked') || {}).value || '';
    cta.href = '/book.html#match'; cta.textContent = 'Request ' + h + ' hour' + (h === 1 ? '' : 's') + (t ? ' · ' + t.toLowerCase() : '');
  }
  function nextBlock(h) { for (var i = 0; i < BH.length; i++) if (BH[i] > h) return BH[i]; return BH[BH.length - 1]; }
  function nextPrice(h) { for (var i = 0; i < BH.length; i++) if (BH[i] > h) return BP[i]; return BP[BP.length - 1]; }
  hours.addEventListener('input', calc); area.addEventListener('change', calc);
  c.querySelectorAll('input[name=calc-t]').forEach(function (r) { r.addEventListener('change', calc); });
  presets.forEach(function (b) { b.addEventListener('click', function () { hours.value = b.getAttribute('data-h'); calc(); }); });
  calc();
})();
