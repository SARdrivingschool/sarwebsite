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
