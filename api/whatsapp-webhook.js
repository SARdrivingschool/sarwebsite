// /api/whatsapp-webhook — delivery reports from WhatsApp (360dialog or Meta).
// When a message to a pupil fails because they aren't on WhatsApp, text them.
//
// Point the webhook at:  https://sardrivingschool.co.uk/api/whatsapp-webhook?key=<WEBHOOK_KEY>
// (Meta direct: also set META_VERIFY_TOKEN; META_APP_SECRET enables signature checks.)
const M = require('./_lib/messaging');

// Errors that mean "WhatsApp can't reach this person" → try SMS.
// 131026 = message undeliverable (not on WhatsApp / old app / hasn't accepted terms).
// Anything else that fails is also sent by SMS unless listed in NO_SMS_CODES.
const NO_SMS_CODES = new Set([]);
const handled = new Set();

module.exports = async (req, res) => {
  // Meta's one-off verification handshake when the webhook is first saved.
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && M.env('META_VERIFY_TOKEN') && q['hub.verify_token'] === M.env('META_VERIFY_TOKEN')) {
      res.status(200).send(q['hub.challenge']); return;
    }
    res.status(403).send('forbidden'); return;
  }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const raw = await M.readRaw(req).catch(() => '');

  // Authenticate: secret key in the URL (works for both providers), or Meta's signature.
  const keyOk = M.env('WEBHOOK_KEY') && M.safeEqual((req.query || {}).key, M.env('WEBHOOK_KEY'));
  let sigOk = false;
  const sig = req.headers['x-hub-signature-256'];
  if (sig && M.env('META_APP_SECRET')) {
    const expect = 'sha256=' + M.crypto.createHmac('sha256', M.env('META_APP_SECRET')).update(raw).digest('hex');
    sigOk = M.safeEqual(sig, expect);
  }
  if (!keyOk && !sigOk) { res.status(401).end(); return; }

  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { res.status(200).end(); return; }

  const statuses = [];
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    for (const s of (ch.value && ch.value.statuses) || []) statuses.push(s);
  }
  // Some 360dialog set-ups post the value object directly.
  for (const s of body.statuses || []) statuses.push(s);

  for (const s of statuses) {
    if (s.status !== 'failed') continue;
    if (handled.has(s.id)) continue;
    handled.add(s.id); if (handled.size > 1000) handled.clear();

    const code = s.errors && s.errors[0] && s.errors[0].code;
    let meta = {};
    try { meta = JSON.parse(s.biz_opaque_callback_data || '{}'); } catch (e) {}
    if (!meta.p) continue; // not one of our enquiry auto-replies — leave it alone
    // SMS is already sent up front by /api/enquiry, so don't text twice.
    if (M.env("SMS_ALWAYS", "true") === "true") continue;
    if (NO_SMS_CODES.has(code)) { console.log('[wa-webhook] failed, no SMS for code', code); continue; }

    const phone = M.toE164(meta.p || ('+' + s.recipient_id));
    if (!phone) continue;
    try {
      const sid = await M.sendSms(phone, M.firstName(meta.n));
      console.log('[wa-webhook] WhatsApp failed (' + code + '), SMS sent', M.mask(phone), sid);
    } catch (e) {
      console.error('[wa-webhook] SMS fallback failed', M.mask(phone), e.message);
    }
  }
  res.status(200).json({ ok: true });
};
