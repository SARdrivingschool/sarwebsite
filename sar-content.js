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

/* ---- Postcode distance check -------------------------------------------
   One rate inside the radius, a personalised quote outside it, decided by
   where the postcode actually is rather than which town it is in. Lookup is
   postcodes.io: public, no key, nothing to expose. Anything the lookup cannot
   answer resolves to "we'll confirm" and never to a confident price, and a
   postcode within half a mile of the line is treated as needing confirmation
   because postcode coordinates are a centroid, not a doorstep. */
(function () {
  'use strict';
  var SAR = window.SAR = window.SAR || {};
  var CACHE = {};
  var FULL = /^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/;
  var EDGE = 0.5;   // miles either side of the line we will not call

  SAR.tidyPostcode = function (raw) {
    var v = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length < 5 || v.length > 7) return null;
    return v.slice(0, v.length - 3) + ' ' + v.slice(-3);
  };
  SAR.isPostcode = function (raw) {
    var p = SAR.tidyPostcode(raw);
    return !!p && FULL.test(p);
  };
  SAR.miles = function (la1, lo1, la2, lo2) {
    var R = 3958.7613, r = Math.PI / 180;
    var dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
            Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // cb({ok:true, pc, miles, inside, edge}) | cb({ok:false, pc, reason:'format'|'notfound'|'offline'})
  SAR.checkPostcode = function (raw, origin, radius, cb) {
    var pc = SAR.tidyPostcode(raw);
    if (!pc || !FULL.test(pc)) { cb({ ok: false, pc: pc, reason: 'format' }); return; }
    if (CACHE[pc]) { cb(CACHE[pc]); return; }
    if (!window.fetch) { cb({ ok: false, pc: pc, reason: 'offline' }); return; }

    var settled = false;
    function finish(r) { if (settled) return; settled = true; if (r.ok || r.reason === 'notfound') CACHE[pc] = r; cb(r); }
    setTimeout(function () { finish({ ok: false, pc: pc, reason: 'offline' }); }, 6000);

    fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s/g, '')))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var res = j && j.result;
        if (!res || typeof res.latitude !== 'number') { finish({ ok: false, pc: pc, reason: 'notfound' }); return; }
        var d = SAR.miles(origin.lat, origin.lon, res.latitude, res.longitude);
        finish({ ok: true, pc: pc, miles: d, inside: d <= radius, edge: Math.abs(d - radius) <= EDGE });
      })
      .catch(function () { finish({ ok: false, pc: pc, reason: 'offline' }); });
  };
})();

/* ---- Find Your Instructor: steps, postcode coverage, validation ---- */
(function () {
  'use strict';
  var RATE = 38, RADIUS = 10;
  var ORIGIN = { lat: 52.038252, lon: -0.777458, label: 'Central Milton Keynes' };

  document.querySelectorAll('form[data-matcher]').forEach(function (form) {
    form.setAttribute('novalidate', '');
    form.classList.add('is-js');
    var steps = Array.prototype.slice.call(form.querySelectorAll('.m-step'));
    var dots = form.querySelectorAll('.m-steps li');
    var status = form.querySelector('[data-status]');
    var pc = form.querySelector('[data-postcode]');
    var covMsg = form.querySelector('[data-coverage-msg]');
    var covField = form.querySelector('[data-coverage]');
    var stepNum = form.querySelector('[data-stepnum]');
    var testFields = form.querySelector('[data-test-fields]');
    var cur = 0;

    function show(i) {
      cur = i;
      steps.forEach(function (s, k) { s.hidden = k !== i; });
      dots.forEach(function (d, k) { d.classList.toggle('is-on', k <= i); d.classList.toggle('is-done', k < i); });
      if (stepNum) stepNum.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
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
      // Format only. The distance lookup never blocks an enquiry: if it is
      // slow, down or inconclusive the learner still gets through.
      if (i === 0 && pc) {
        if (!window.SAR || !SAR.isPostcode(pc.value)) {
          pc.focus(); pc.classList.add('is-bad');
          status.textContent = 'That doesn\'t look like a full UK postcode — try the format MK3 6DH.';
          return false;
        }
        pc.value = SAR.tidyPostcode(pc.value);
      }
      return true;
    }
    var covSeq = 0;
    function setCov(text, cls, field) {
      covMsg.textContent = text;
      covMsg.className = 'm-hint' + (cls ? ' ' + cls : '');
      covField.value = field || '';
    }
    function idleCoverage() {
      setCov('Lessons are \u00a3' + RATE + ' an hour for pickups within ' + RADIUS +
             ' miles of ' + ORIGIN.label + '. Enter your postcode and we\'ll check.', '', '');
    }
    function updateCoverage() {
      pc.classList.remove('is-bad');
      if (!window.SAR) return;
      var raw = pc.value;
      if (!SAR.isPostcode(raw)) { idleCoverage(); return; }
      var tidy = SAR.tidyPostcode(raw);
      var seq = ++covSeq;
      setCov('Checking ' + tidy + '\u2026', '', tidy + ' \u00b7 checking');
      SAR.checkPostcode(raw, ORIGIN, RADIUS, function (r) {
        if (seq !== covSeq) return;                       // a newer postcode won
        if (!r.ok) {
          if (r.reason === 'notfound') {
            setCov('We couldn\'t find ' + (r.pc || tidy) + '. Check it over \u2014 you can still send the enquiry and we\'ll confirm your rate.', 'is-warn', (r.pc || tidy) + ' \u00b7 not found');
          } else {
            setCov('We couldn\'t check the distance just now. Send the enquiry anyway and we\'ll confirm your rate.', 'is-warn', (r.pc || tidy) + ' \u00b7 lookup unavailable');
          }
          return;
        }
        var d = r.miles.toFixed(1);
        if (r.edge) {
          setCov(r.pc + ' is right on our ' + RADIUS + '-mile boundary, about ' + d +
                 ' miles out. We\'ll confirm your rate before anything is booked.', 'is-warn',
                 r.pc + ' \u00b7 ' + d + ' mi \u00b7 boundary');
        } else if (r.inside) {
          setCov('Good news \u2014 ' + r.pc + ' is about ' + d + ' miles from ' + ORIGIN.label +
                 ', so you qualify for our standard rate of \u00a3' + RATE + ' an hour.', 'is-ok',
                 r.pc + ' \u00b7 ' + d + ' mi \u00b7 inside');
        } else {
          setCov(r.pc + ' is about ' + d + ' miles from ' + ORIGIN.label + ', outside our ' + RADIUS +
                 '-mile standard-rate area. Send the enquiry and we\'ll come back with a personalised quote.', 'is-warn',
                 r.pc + ' \u00b7 ' + d + ' mi \u00b7 outside (quote)');
        }
      });
    }
    if (pc) {
      var covTimer = null;
      pc.addEventListener('input', function () { clearTimeout(covTimer); covTimer = setTimeout(updateCoverage, 450); });
      pc.addEventListener('blur', function () { clearTimeout(covTimer); updateCoverage(); });
      idleCoverage();
    }

    // Test date, centre and car question only matter once a test is booked.
    if (testFields) {
      var expRadios = form.querySelectorAll('input[name="Experience"]');
      var syncTest = function () {
        var on = false;
        expRadios.forEach(function (r) { if (r.checked && r.value === 'Test booked') on = true; });
        testFields.hidden = !on;
      };
      expRadios.forEach(function (r) { r.addEventListener('change', syncTest); });
      syncTest();
    }

    form.querySelectorAll('[data-next]').forEach(function (b) { b.addEventListener('click', function () { if (valid(cur)) show(Math.min(cur + 1, steps.length - 1)); }); });
    form.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { show(Math.max(cur - 1, 0)); }); });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && cur < steps.length - 1) { e.preventDefault(); if (valid(cur)) show(cur + 1); }
    });
    form.addEventListener('submit', function (e) {
      // show() clears the status line, so re-run the check after it to leave
      // the reason on screen — otherwise a bad last step fails silently.
      for (var i = 0; i < steps.length; i++) { if (!valid(i)) { e.preventDefault(); show(i); valid(i); return; } }
      var btn = form.querySelector('[data-submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      if (window.gtag) { try { gtag('event', 'generate_lead', { form: 'matcher', coverage: covField.value }); } catch (err) {} }
    });
    show(0);
  });
})();

/* ---- Hero pass coverflow: centre card plus neighbours, newest first ----
   Seven card elements are recycled rather than created per step, so an
   image only ever changes while its card is off-stage and invisible. The
   centre card shows the full-size photo; the rest show gallery thumbs, and
   the next one along is preloaded so promoting it to centre never flashes. */
(function () {
  'use strict';
  var box = document.querySelector('.h-carousel');
  if (!box) return;
  var track = box.querySelector('[data-cf]');
  if (!track) return;
  var nums = (box.getAttribute('data-passes') || '').split(',')
    .map(function (n) { return parseInt(n, 10); }).filter(Boolean);
  if (nums.length < 2) return;

  var WING = 3, SPAN = WING * 2 + 1, DELAY = 3800, SWIPE = 40;
  var ALT = 'A SAR Driving School pupil on the day they passed their driving test';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pad = function (n) { return ('000' + n).slice(-3); };
  var thumb = function (n) { return '/images/pass-gallery/pass-' + pad(n) + '-thumb.webp'; };
  var full  = function (n) { return '/images/pass-gallery/pass-' + pad(n) + '.webp'; };
  var at = function (k) { return nums[((k % nums.length) + nums.length) % nums.length]; };

  // Slot 0 is the card the page was served with, so the LCP image is reused.
  var els = [track.querySelector('.h-cf-item')];
  if (!els[0]) return;
  for (var s = 1; s < SPAN; s++) {
    var fig = document.createElement('figure');
    fig.className = 'h-cf-item';
    var im = document.createElement('img');
    im.width = 1080; im.height = 1350; im.decoding = 'async'; im.alt = '';
    im.setAttribute('aria-hidden', 'true');
    fig.appendChild(im);
    track.appendChild(fig);
    els.push(fig);
  }
  els[0].firstElementChild.setAttribute('data-n', String(nums[0]));
  els[0].firstElementChild.setAttribute('data-q', 'full');

  var centre = 0, timer = null;

  function paint(el, n, k) {
    var img = el.firstElementChild;
    var q = k === 0 ? 'full' : 'thumb';
    if (img.getAttribute('data-n') !== String(n) || img.getAttribute('data-q') !== q) {
      img.src = (k === 0 ? full : thumb)(n);
      img.setAttribute('data-n', String(n));
      img.setAttribute('data-q', q);
    }
    if (k === 0) { img.alt = ALT; img.removeAttribute('aria-hidden'); }
    else { img.alt = ''; img.setAttribute('aria-hidden', 'true'); }
  }

  function layout() {
    for (var k = -WING; k <= WING; k++) {
      var slot = (((centre + k) % SPAN) + SPAN) % SPAN;
      els[slot].setAttribute('data-off', String(k));
      paint(els[slot], at(centre + k), k);
    }
  }

  var warm = {};
  function preload(n) { if (warm[n]) return; warm[n] = new Image(); warm[n].src = full(n); }

  function go(dir) {
    centre += dir;
    layout();
    preload(at(centre + (dir >= 0 ? 1 : -1)));
  }

  function start() { if (reduce || timer) return; timer = setInterval(function () { go(1); }, DELAY); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  box.querySelector('.h-cnext').addEventListener('click', function () { stop(); go(1); start(); });
  box.querySelector('.h-cprev').addEventListener('click', function () { stop(); go(-1); start(); });
  box.addEventListener('mouseenter', stop);
  box.addEventListener('mouseleave', start);
  box.addEventListener('focusin', stop);
  box.addEventListener('focusout', start);
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });

  box.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); go(1); start(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); go(-1); start(); }
  });

  // Drag and swipe. The whole track follows the pointer, damped, and snaps
  // on release; a short drag counts as a tap and advances one card.
  var down = false, x0 = 0, y0 = 0, dx = 0, locked = false, id = null;
  function setDrag(px) { track.style.setProperty('--cf-drag', px + 'px'); }
  box.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.h-cbtn')) return;
    down = true; locked = false; dx = 0; x0 = e.clientX; y0 = e.clientY; id = e.pointerId;
    stop(); box.classList.add('is-drag');
  });
  box.addEventListener('pointermove', function (e) {
    if (!down || e.pointerId !== id) return;
    dx = e.clientX - x0;
    if (!locked) {
      if (Math.abs(e.clientY - y0) > Math.abs(dx) && Math.abs(e.clientY - y0) > 8) {
        down = false; box.classList.remove('is-drag'); setDrag(0); start(); return;
      }
      if (Math.abs(dx) > 8) { locked = true; try { box.setPointerCapture(id); } catch (err) {} }
    }
    if (locked) setDrag(dx * 0.4);
  });
  function release() {
    if (!down) return;
    down = false; box.classList.remove('is-drag'); setDrag(0);
    if (Math.abs(dx) > SWIPE) go(dx < 0 ? 1 : -1);
    else if (!locked) go(1);
    start();
  }
  box.addEventListener('pointerup', release);
  box.addEventListener('pointercancel', function () { down = false; locked = false; box.classList.remove('is-drag'); setDrag(0); start(); });
  box.addEventListener('dragstart', function (e) { e.preventDefault(); });

  layout();
  preload(at(1));
  start();
})();

/* ---- Lesson cost calculator (pricing page) ---- */
(function () {
  'use strict';
  var c = document.getElementById('calculator'); if (!c) return;
  var STD = +c.getAttribute('data-std'), FEE = +c.getAttribute('data-fee');
  var RADIUS = +c.getAttribute('data-radius');
  var ORIGIN = { lat: +c.getAttribute('data-origin-lat'), lon: +c.getAttribute('data-origin-lon'), label: c.getAttribute('data-origin-label') };
  var BH = JSON.parse(c.getAttribute('data-blocks')), BP = JSON.parse(c.getAttribute('data-block-prices'));
  var LH = JSON.parse(c.getAttribute('data-lessons')), LP = JSON.parse(c.getAttribute('data-lesson-prices'));
  var hours = document.getElementById('calc-hours'), out = document.getElementById('calc-hours-out');
  var pcIn = document.getElementById('calc-pc'), pcGo = document.getElementById('calc-pc-go'), pcMsg = document.getElementById('calc-pc-msg');
  var direct = document.getElementById('calc-direct'), sar = document.getElementById('calc-sar'), rate = document.getElementById('calc-rate'), note = document.getElementById('calc-note'), cta = document.getElementById('calc-cta');
  var presets = c.querySelectorAll('.p-calc-presets button');
  function gbp(n) { return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: (n % 1) ? 2 : 0, maximumFractionDigits: 2 }); }
  function calc() {
    var h = +hours.value, msg = '', price;
    var bi = BH.indexOf(h), li = LH.indexOf(h);
    if (bi > -1) { price = BP[bi]; msg = h + '-hour block rate applied — saves ' + gbp(h * STD - price) + ' against paying hourly.'; }
    else if (li > -1) { price = LP[li]; msg = 'Single lesson price.'; }
    else {
      // nearest block below + hourly top-up
      var best = 0, bp = 0; for (var i = 0; i < BH.length; i++) if (BH[i] <= h && BH[i] > best) { best = BH[i]; bp = BP[i]; }
      price = bp + (h - best) * STD;
      msg = best ? (best + '-hour block plus ' + (h - best) + ' hour' + (h - best === 1 ? '' : 's') + ' at £' + STD + '. A ' + nextBlock(h) + '-hour block would cost ' + gbp(nextPrice(h)) + '.') : 'Hourly rate of £' + STD + '.';
    }
    if (outside) msg = 'Your postcode is outside the ' + RADIUS + '-mile standard-rate area, so these figures are a guide only — ask us for a quote.';
    out.textContent = h; direct.textContent = gbp(price); sar.textContent = gbp(price * (1 + FEE / 100)); rate.textContent = gbp(price / h); note.textContent = msg;
    presets.forEach(function (b) { b.classList.toggle('is-on', +b.getAttribute('data-h') === h); });
    var t = (c.querySelector('input[name=calc-t]:checked') || {}).value || '';
    cta.href = '/book.html#match'; cta.textContent = 'Request ' + h + ' hour' + (h === 1 ? '' : 's') + (t ? ' · ' + t.toLowerCase() : '');
  }
  var outside = false;
  function setPc(text, cls) { pcMsg.textContent = text; pcMsg.className = 'm-hint' + (cls ? ' ' + cls : ''); }
  var pcSeq = 0;
  function checkPc() {
    if (!pcIn || !window.SAR) return;
    if (!SAR.isPostcode(pcIn.value)) {
      outside = false;
      setPc(pcIn.value.trim()
        ? 'That doesn\'t look like a full UK postcode — try the format MK9 1EN.'
        : 'Lessons are £' + STD + ' an hour within ' + RADIUS + ' miles of ' + ORIGIN.label + '. Enter a postcode to check.',
        pcIn.value.trim() ? 'is-warn' : '');
      calc(); return;
    }
    var seq = ++pcSeq, tidy = SAR.tidyPostcode(pcIn.value);
    pcIn.value = tidy;
    setPc('Checking ' + tidy + '…');
    SAR.checkPostcode(tidy, ORIGIN, RADIUS, function (r) {
      if (seq !== pcSeq) return;
      if (!r.ok) {
        outside = false;
        setPc(r.reason === 'notfound'
          ? 'We couldn\'t find ' + tidy + '. Check it over, or ask us and we\'ll confirm your rate.'
          : 'We couldn\'t check the distance just now. Ask us and we\'ll confirm your rate.', 'is-warn');
      } else if (r.edge) {
        outside = false;
        setPc(tidy + ' sits right on the ' + RADIUS + '-mile boundary, about ' + r.miles.toFixed(1) +
              ' miles out — we\'ll confirm your rate before anything is booked.', 'is-warn');
      } else if (r.inside) {
        outside = false;
        setPc('Good news! Your postcode qualifies for our standard rate of £' + STD + ' per hour (about ' +
              r.miles.toFixed(1) + ' miles from ' + ORIGIN.label + ').', 'is-ok');
      } else {
        outside = true;
        setPc('Your location is outside our standard ' + RADIUS + '-mile coverage area (about ' +
              r.miles.toFixed(1) + ' miles). Please send us an enquiry for a personalised quote.', 'is-warn');
      }
      calc();
    });
  }
  if (pcIn) {
    var pcTimer = null;
    pcIn.addEventListener('input', function () { clearTimeout(pcTimer); pcTimer = setTimeout(checkPc, 450); });
    pcIn.addEventListener('blur', function () { clearTimeout(pcTimer); checkPc(); });
    pcIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(pcTimer); checkPc(); } });
  }
  if (pcGo) pcGo.addEventListener('click', checkPc);

  function nextBlock(h) { for (var i = 0; i < BH.length; i++) if (BH[i] > h) return BH[i]; return BH[BH.length - 1]; }
  function nextPrice(h) { for (var i = 0; i < BH.length; i++) if (BH[i] > h) return BP[i]; return BP[BP.length - 1]; }
  hours.addEventListener('input', calc);
  c.querySelectorAll('input[name=calc-t]').forEach(function (r) { r.addEventListener('change', calc); });
  presets.forEach(function (b) { b.addEventListener('click', function () { hours.value = b.getAttribute('data-h'); calc(); }); });
  calc();
})();

/* Pass gallery: paging and lightbox. Cards are rendered by tools/build.py from content/passes.json. */
(function () {
  'use strict';
  var grid = document.querySelector('[data-ggrid]');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.g-card'));
  var more = document.querySelector('[data-gmore]'), all = document.querySelector('[data-gall]');
  var moreRow = document.querySelector('.g-more');
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-gfilters] .g-chip'));
  var live = document.querySelector('[data-gcount-live]');
  var PAGE = window.matchMedia('(max-width: 640px)').matches ? 16 : 24;
  var limit = PAGE, filter = 'all';
  // The visible set drives paging AND the lightbox, so arrowing through a
  // filtered gallery never lands on a card that is not on screen.
  var visible = cards.slice();

  function matches(c) {
    if (filter === 'all') return true;
    if (filter === 'first') return c.getAttribute('data-first') === '1';
    if (filter.indexOf('centre:') === 0) return c.getAttribute('data-centre') === filter.slice(7);
    return true;
  }

  function apply() {
    visible = cards.filter(matches);
    cards.forEach(function (c) { c.hidden = true; });
    visible.forEach(function (c, i) { c.hidden = i >= limit; });
    if (moreRow) moreRow.hidden = visible.length <= limit;
    if (live) live.textContent = 'Showing ' + Math.min(limit, visible.length) + ' of ' + visible.length + ' passes.';
  }

  chips.forEach(function (ch) {
    ch.addEventListener('click', function () {
      filter = ch.getAttribute('data-filter') || 'all';
      limit = PAGE;
      chips.forEach(function (o) { o.classList.toggle('is-on', o === ch); o.setAttribute('aria-pressed', o === ch ? 'true' : 'false'); });
      apply();
    });
    ch.setAttribute('aria-pressed', ch.classList.contains('is-on') ? 'true' : 'false');
  });

  if (more) more.addEventListener('click', function () { limit += PAGE; apply(); });
  if (all) all.addEventListener('click', function () { limit = cards.length; apply(); });
  apply();

  // --- Lightbox ---
  var lb = document.querySelector('[data-glightbox]');
  if (!lb || typeof lb.showModal !== 'function') return;
  var img = lb.querySelector('[data-gimg]'), cap = lb.querySelector('[data-gcap]'), count = lb.querySelector('[data-gcount]');
  var idx = 0, opener = null;

  function show(i) {
    if (!visible.length) return;
    idx = (i + visible.length) % visible.length;
    var c = visible[idx];
    img.src = c.getAttribute('data-full');
    img.alt = c.querySelector('img').alt;
    cap.textContent = c.getAttribute('data-caption') || '';
    // No running total here: the gallery deliberately does not state how many
    // passes there are.
    if (count) count.textContent = '';
    var nx = visible[(idx + 1) % visible.length];
    if (nx) { var pre = new Image(); pre.src = nx.getAttribute('data-full'); }
  }

  function open(card) {
    opener = card; show(visible.indexOf(card));
    lb.showModal(); document.documentElement.style.overflow = 'hidden';
  }

  function close() { if (lb.open) lb.close(); }

  lb.addEventListener('close', function () {
    document.documentElement.style.overflow = '';
    img.removeAttribute('src');
    if (opener) opener.focus();
  });

  cards.forEach(function (c) { c.addEventListener('click', function () { open(c); }); });
  lb.querySelector('[data-gclose]').addEventListener('click', close);
  lb.querySelector('[data-gprev]').addEventListener('click', function () { show(idx - 1); });
  lb.querySelector('[data-gnext]').addEventListener('click', function () { show(idx + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
  lb.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
  });

  var tx = 0;
  lb.addEventListener('touchstart', function (e) { tx = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) show(dx < 0 ? idx + 1 : idx - 1);
  }, { passive: true });
})();

/* Reviews page: paging plus a read-more toggle on any review that overflows.
   Cards are rendered by tools/build.py from content/reviews.json. */
(function () {
  'use strict';
  var grid = document.querySelector('[data-rgrid]');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.r-card'));
  var more = document.querySelector('[data-rmore]'), all = document.querySelector('[data-rall]');
  var moreRow = document.querySelector('.r-more');
  var PAGE = window.matchMedia('(max-width: 640px)').matches ? 6 : 9;
  var limit = PAGE;

  // A clamped review only earns a toggle if it genuinely overflows. Cards must
  // be visible to measure, so this runs after each paging step.
  function clamp(card) {
    if (card.dataset.rdone) return;
    var body = card.querySelector('[data-rbody]'), p = body && body.querySelector('p');
    if (!p) return;
    card.dataset.rdone = '1';
    body.classList.add('is-clamped');
    if (p.scrollHeight - p.clientHeight < 4) { body.classList.remove('is-clamped'); return; }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'r-toggle';
    btn.textContent = 'Read full review';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      var clamped = body.classList.toggle('is-clamped');
      btn.textContent = clamped ? 'Read full review' : 'Show less';
      btn.setAttribute('aria-expanded', clamped ? 'false' : 'true');
    });
    body.insertAdjacentElement('afterend', btn);
  }

  function apply() {
    var shown = 0;
    cards.forEach(function (c, i) {
      c.hidden = i >= limit;
      if (i < limit) shown++;
    });
    if (moreRow) moreRow.hidden = shown >= cards.length;
    cards.slice(0, limit).forEach(clamp);
  }

  if (more) more.addEventListener('click', function () {
    var first = cards[limit];
    limit += PAGE; apply();
    if (first) { try { first.querySelector('cite').focus({ preventScroll: true }); } catch (e) {} }
  });
  if (all) all.addEventListener('click', function () { limit = cards.length; apply(); });
  apply();
})();

/* ---- Phone check: a UK mobile that's one digit short is a lost enquiry ---- */
(function () {
  'use strict';

  var EXAMPLE = '07123 456789';

  // Strip everything people type around a number, and fold +44 / 0044 to 0.
  function tidy(v) {
    var s = String(v || '').replace(/[\s()\.\-‐-― ]/g, '');
    if (/^00/.test(s)) s = '+' + s.slice(2);
    if (/^\+440/.test(s)) s = '0' + s.slice(4);   // +4407… — common mistake
    if (/^\+44/.test(s)) s = '0' + s.slice(3);
    if (/^447\d{9}$/.test(s)) s = '0' + s.slice(2);   // 44… with the + left off
    return s;
  }

  function check(v) {
    var s = tidy(v);
    if (!s) return { empty: true };

    // UK mobile: 07 + 9 digits.
    if (/^07\d{9}$/.test(s)) {
      return { ok: true, local: s, pretty: s.slice(0, 5) + ' ' + s.slice(5), e164: '+44' + s.slice(1) };
    }

    // Another country, written properly with a + and its country code.
    if (/^\+[1-9]\d{7,14}$/.test(s)) {
      return { ok: true, local: s, pretty: s, e164: s };
    }

    if (/^07/.test(s) && /^[\d]+$/.test(s.slice(1))) {
      var n = s.length, short = 11 - n;
      if (short > 0) {
        return { msg: 'That mobile number is ' + short + ' digit' + (short > 1 ? 's' : '') +
                      ' short — a UK mobile has 11, like ' + EXAMPLE + '.' };
      }
      return { msg: 'That mobile number has ' + (-short) + ' digit' + (-short > 1 ? 's' : '') +
                    ' too many — a UK mobile has 11, like ' + EXAMPLE + '.' };
    }

    // UK landline — valid, but an instructor can't text or WhatsApp it.
    if (/^0[1235][\d]{8,9}$/.test(s)) {
      return { msg: 'That looks like a landline. Please give a mobile — your instructor confirms lessons by text or WhatsApp.' };
    }

    if (/^\d+$/.test(s) && s.length === 10 && /^7/.test(s)) {
      return { msg: 'Please include the leading 0 — a UK mobile looks like ' + EXAMPLE + '.' };
    }

    if (/^\+/.test(s)) {
      return { msg: 'That international number doesn\'t look complete — please include the country code and the full number.' };
    }

    return { msg: 'That doesn\'t look like a UK mobile. It should start 07 and have 11 digits, like ' + EXAMPLE + '.' };
  }

  document.querySelectorAll('input[data-uk-phone]').forEach(function (el) {
    // The pattern attribute is the no-JavaScript fallback; from here the
    // checks below are better than it, and they also allow non-UK numbers.
    el.removeAttribute('pattern');

    var form = el.form;
    var hidden = null;
    if (form) {
      hidden = form.querySelector('input[name="WhatsApp"]');
      if (!hidden) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'WhatsApp';
        form.appendChild(hidden);
      }
    }

    function apply(showState) {
      var r = check(el.value);
      el.setCustomValidity(r.ok || r.empty ? '' : r.msg);
      if (hidden) hidden.value = r.ok ? 'https://wa.me/' + r.e164.replace('+', '') : '';
      if (showState) {
        el.classList.toggle('is-bad', !!r.msg);
        if (r.ok && r.pretty) el.value = r.pretty;
      } else if (!r.msg) {
        el.classList.remove('is-bad');
      }
      return r;
    }

    el.addEventListener('input', function () { apply(false); });
    el.addEventListener('blur', function () { if (el.value.trim()) apply(true); });
    apply(false);   // browser may have autofilled before we got here
  });
})();

/* ---- Instant enquiry confirmation ----
   When any enquiry form passes its checks and is sent to FormSubmit, also tell
   /api/enquiry so the pupil gets a WhatsApp (SMS if not on WhatsApp). The email
   to SAR still goes through FormSubmit as before. Failures are silent so the
   form never looks broken to the pupil. */
(function () {
  'use strict';
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || e.defaultPrevented) return;
    if (!/formsubmit/i.test(form.getAttribute('action') || '')) return;
    var f = form.elements;
    var phone = f.Phone ? String(f.Phone.value || '').trim() : '';
    if (!phone) return;
    var payload = {
      Name: f.Name ? String(f.Name.value || '').trim() : '',
      Phone: phone,
      Page: f.Page ? String(f.Page.value || '') : location.pathname,
      _honey: f._honey ? String(f._honey.value || '') : ''
    };
    try {
      fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (err) { /* ignore: the email to SAR still goes */ }
  });
})();
