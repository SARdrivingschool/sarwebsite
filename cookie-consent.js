/* SAR Driving School — cookie consent (PECR / UK GDPR)
   Advertising cookies require consent BEFORE they are set. Consent Mode v2
   defaults are set inline in <head>; this file only renders the choice UI
   and updates the signal. Accept and Reject carry equal weight. */
(function () {
  var KEY = 'sar-consent';
  var GRANTED = {
    ad_storage: 'granted', analytics_storage: 'granted',
    ad_user_data: 'granted', ad_personalization: 'granted'
  };
  var DENIED = {
    ad_storage: 'denied', analytics_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied'
  };

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function signal(state) {
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', state);
  }

  function decide(choice) {
    save(choice);
    signal(choice === 'accepted' ? GRANTED : DENIED);
    var b = document.getElementById('cookie-banner');
    if (b) b.parentNode.removeChild(b);
  }

  function render() {
    var wrap = document.createElement('div');
    wrap.id = 'cookie-banner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Cookie choices');
    wrap.innerHTML =
      '<div class="cookie-inner">' +
        '<div class="cookie-copy">' +
          '<strong>Cookies on this site</strong>' +
          '<p>We use essential cookies to make the site work. We&rsquo;d also like to set advertising ' +
          'cookies that help us measure how well our ads work. We only set these if you accept. ' +
          'See our <a href="privacy.html">Privacy &amp; Cookie Policy</a>.</p>' +
        '</div>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="cookie-btn cookie-accept" id="cookieAccept">Accept</button>' +
          '<button type="button" class="cookie-btn cookie-reject" id="cookieReject">Reject</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.getElementById('cookieAccept').addEventListener('click', function () { decide('accepted'); });
    document.getElementById('cookieReject').addEventListener('click', function () { decide('rejected'); });
  }

  function start() {
    var c = stored();
    if (c === 'accepted') { signal(GRANTED); return; }
    if (c === 'rejected') { signal(DENIED); return; }
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }

  // let people change their mind from the footer link
  window.sarOpenCookieSettings = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    if (!document.getElementById('cookie-banner')) render();
  };
})();
