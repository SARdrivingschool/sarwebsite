// POST /api/enquiry — fired by the website (sar-content.js) the moment an
// enquiry form is sent. This is the path the lead itself travels: it texts the
// full enquiry to SAR (SAR_NOTIFY_NUMBER) and sends the pupil their instant
// "we've got your enquiry" message. FormSubmit still gets a copy for the
// formatted email, but it is no longer what tells SAR an enquiry happened.
// Allocation stays manual.
const M = require('./_lib/messaging');

const ALLOWED = (M.env('ALLOWED_ORIGINS', 'https://sardrivingschool.co.uk,https://www.sardrivingschool.co.uk'))
  .split(',').map((s) => s.trim()).filter(Boolean);

// Light abuse guard (per warm server instance): one message per number per
// 10 minutes, and a ceiling per hour. Real enquiries are a handful a day.
const seen = new Map();
let hourStart = Date.now(), hourCount = 0;
const HOURLY_CAP = Number(M.env('HOURLY_CAP', '40'));

function originOk(req) {
  const o = req.headers.origin || '';
  const ref = req.headers.referer || '';
  const src = o || ref;
  if (!src) return false;
  if (M.env('ALLOW_PREVIEW_ORIGINS', 'false') === 'true' && /\.vercel\.app/.test(src)) return true;
  return ALLOWED.some((a) => src === a || src.startsWith(a + '/'));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (!originOk(req)) { res.status(403).json({ ok: false }); return; }

  let data = {};
  try {
    const raw = await M.readRaw(req);
    data = JSON.parse(raw || '{}');
  } catch (e) { res.status(400).json({ ok: false }); return; }

  if (data._honey) { res.status(200).json({ ok: true }); return; } // bot

  const phone = M.toE164(data.Phone || data.phone);
  if (!phone) { res.status(400).json({ ok: false, reason: 'phone' }); return; }
  const name = M.firstName(data.Name || data.name);

  const now = Date.now();
  if (now - hourStart > 3600e3) { hourStart = now; hourCount = 0; }
  if (++hourCount > HOURLY_CAP) { console.warn('[enquiry] hourly cap hit'); res.status(429).json({ ok: false }); return; }
  // A repeat from the same number inside ten minutes is usually the pupil
  // correcting a typo. Don't message them twice — but DO send the lead, or the
  // corrected details never reach SAR.
  const last = seen.get(phone);
  const dup = !!(last && now - last < 10 * 60e3);
  seen.set(phone, now);
  if (seen.size > 500) seen.clear();

  const page = String(data.Page || data.page || "").slice(0, 80);

  // The lead itself goes to SAR from here, not only to the form provider.
  // FormSubmit went down on 30 Oct 2026 (Cloudflare 521) and every enquiry in
  // that window was lost, because nothing else told SAR an enquiry existed.
  const NOTIFY = M.env('SAR_NOTIFY_NUMBER', '');

  // The known fields first, in the order SAR reads them, then anything else
  // the form carried. A field added to a form later still reaches SAR.
  const ORDER = [
    ['Name', 'Name', 60], ['Phone', 'Phone', 20],
    ['Postcode', 'Postcode', 12], ['Pickup postcode', 'Postcode', 12],
    ['Transmission', 'Car', 20], ['Experience', 'Experience', 40],
    ['Package', 'Package', 40],
    ['Availability', 'Free', 80], ['Best days and times', 'Free', 80],
    ['Coverage', 'Area', 50], ['Email', 'Email', 60],
    ['TestDate', 'Test', 30], ['Test date', 'Test', 30],
    ['Test centre', 'Test centre', 40], ['Car for test', 'Car for test', 30],
    ['How did you hear about us', 'Heard via', 40],
    ['Notes', 'Notes', 240], ['Message', 'Notes', 240],
  ];
  const lines = ['SAR enquiry'];
  const used = new Set(['_honey', 'Page', 'page', 'name', 'phone']);
  const seenLabel = new Set();
  for (const [key, label, cap] of ORDER) {
    used.add(key);
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    if (seenLabel.has(label)) continue;        // Postcode/Pickup postcode etc.
    seenLabel.add(label);
    lines.push(label + ': ' + String(v).trim().slice(0, cap));
  }
  for (const key of Object.keys(data)) {
    if (used.has(key) || key.startsWith('_')) continue;
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    lines.push(String(key).slice(0, 40) + ': ' + String(v).trim().slice(0, 80));
  }
  if (!lines.some((l) => l.startsWith('Name: '))) lines.splice(1, 0, 'Name: ?');
  if (!lines.some((l) => l.startsWith('Phone: '))) lines.splice(2, 0, 'Phone: ' + phone);
  lines.push('Page: ' + page);
  if (dup) lines.push('(repeat within 10 min - details may be corrected)');
  const lead = lines.join('\n');

  // Always send both: WhatsApp from SAR's number, and an SMS at the same time.
  const [wa, sms, own] = await Promise.allSettled([
    dup ? Promise.resolve(null) : M.sendWhatsAppTemplate(phone, name),
    dup ? Promise.resolve(null) : M.sendSms(phone, name),
    NOTIFY ? M.sendSmsRaw(NOTIFY, lead) : Promise.resolve(null),
  ]);
  if (!NOTIFY) console.warn('[enquiry] SAR_NOTIFY_NUMBER not set - the lead is NOT being sent to SAR');
  else if (own.status === 'fulfilled') console.log('[enquiry] lead sent to SAR', own.value);
  else console.error('[enquiry] LEAD NOT DELIVERED TO SAR', own.reason && own.reason.message);
  if (wa.status === "fulfilled") console.log("[enquiry] WhatsApp queued", M.mask(phone), wa.value, page);
  else console.error("[enquiry] WhatsApp failed", wa.reason && wa.reason.message);
  if (sms.status === "fulfilled") console.log("[enquiry] SMS", sms.value ? "sent" : "skipped", M.mask(phone), sms.value, page);
  else console.error("[enquiry] SMS failed", sms.reason && sms.reason.message);
  const channels = [];
  if (wa.status === "fulfilled" && wa.value) channels.push("whatsapp");
  if (sms.status === "fulfilled" && sms.value) channels.push("sms");
  const leadDelivered = own.status === 'fulfilled' && own.value;
  if (leadDelivered) channels.push('lead-to-sar');
  // The pupil's confirmation is nice to have. Getting the lead to SAR is not,
  // so that is what decides the status code.
  res.status(leadDelivered || !NOTIFY ? 200 : 502).json({ ok: true, channels, lead: !!leadDelivered, dup });
};
