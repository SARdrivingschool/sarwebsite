/* SAR Test Ready website preview: shared code for every page in /test-ready/.
   Reads only published content, and signs people in with the same accounts as the app. */
(function () {
  'use strict';

  var cfg = window.SAR_TEST_READY_CONFIG || {};
  var client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !cfg.url || !cfg.key) return null;
    client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Accepts a full YouTube link or a bare 11-character video ID.
  function youtubeId(value) {
    if (!value) return null;
    var text = String(value).trim();
    var match = text.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{11}$/.test(text) ? text : null;
  }

  var LEVELS = {
    green: { label: 'Beginner', className: 'lvl-green', order: 0 },
    amber: { label: 'Intermediate', className: 'lvl-amber', order: 1 },
    red: { label: 'Advanced', className: 'lvl-red', order: 2 }
  };

  // Same five categories the learner app shows.
  var CATEGORY_ORDER = ['roundabout', 'junction', 'hazard', 'meeting_situation', 'manoeuvre'];
  var CATEGORY_TITLES = {
    roundabout: 'Roundabouts',
    junction: 'Junctions',
    hazard: 'Tricky areas and hazards',
    meeting_situation: 'Meeting situations',
    manoeuvre: 'Manoeuvres'
  };

  function renderHeader(active) {
    var el = document.getElementById('tr-header');
    if (!el) return;
    el.innerHTML =
      '<div class="tr-wrap tr-head-row">' +
        '<a class="tr-brand" href="index.html"><img src="/images/logo-head.png" alt="SAR Driving School" width="321" height="138"></a>' +
        '<nav class="tr-nav" aria-label="SAR Test Ready">' +
          '<a href="index.html"' + (active === 'guides' ? ' aria-current="page"' : '') + '>Guides</a>' +
          '<a href="account.html" id="tr-account-link"' + (active === 'account' ? ' aria-current="page"' : '') + '>Sign in</a>' +
          '<a href="https://sardrivingschool.co.uk/">SAR website</a>' +
        '</nav>' +
      '</div>';
    var c = getClient();
    if (!c) return;
    c.auth.getSession().then(function (result) {
      var link = document.getElementById('tr-account-link');
      if (link && result.data && result.data.session) link.textContent = 'My account';
    });
  }

  window.TR = {
    client: getClient,
    esc: esc,
    youtubeId: youtubeId,
    LEVELS: LEVELS,
    CATEGORY_ORDER: CATEGORY_ORDER,
    CATEGORY_TITLES: CATEGORY_TITLES,
    renderHeader: renderHeader
  };
})();
