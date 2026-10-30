// POST /api/enquiry — fired by the website (sar-content.js) the moment an
// enquiry form is sent. The form itself still goes to FormSubmit as before, so
// the email to SAR is unchanged; this only sends the pupil an instant
// "we've got your enquiry" message. Allocation stays manual.
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
  const last = seen.get(phone);
  if (last && now - last < 10 * 60e3) { res.status(200).json({ ok: true, dup: true }); return; }
  seen.set(phone, now);
  if (seen.size > 500) seen.clear();

  const page = String(data.Page || data.page || "").slice(0, 80);

  // The lead itself goes to SAR from here, not only to the form provider.
  // FormSubmit went down on 30 Oct 2026 (Cloudflare 521) and every enquiry in
  // that window was lost, because nothing else told SAR an enquiry existed.
  const NOTIFY = M.env('SAR_NOTIFY_NUMBER', '');
  const lead = [
    'SAR enquiry',
    'Name: ' + String(data.Name || data.name || '?').slice(0, 60),
    'Phone: ' + String(data.Phone || data.phone || '?').slice(0, 20),
    data.Postcode ? 'Postcode: ' + String(data.Postcode).slice(0, 10) : '',
    data.Transmission ? 'Car: ' + String(data.Transmission).slice(0, 20) : '',
    data.Experience ? 'Experience: ' + String(data.Experience).slice(0, 30) : '',
    data.Availability ? 'Free: ' + String(data.Availability).slice(0, 80) : '',
    data.Coverage ? 'Area: ' + String(data.Coverage).slice(0, 50) : '',
    data.Email ? 'Email: ' + String(data.Email).slice(0, 60) : '',
    data.TestDate ? 'Test: ' + String(data.TestDate).slice(0, 30) : '',
    data.Notes ? 'Notes: ' + String(data.Notes).slice(0, 200) : '',
    'Page: ' + page,
  ].filter(Boolean).join('\n');
  // Always send both: WhatsApp from SAR's number, and an SMS at the same time.
  const [wa, sms, own] = await Promise.allSettled([
    M.sendWhatsAppTemplate(phone, name),
    M.sendSms(phone, name),
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
  if (wa.status === "fulfilled") channels.push("whatsapp");
  if (sms.status === "fulfilled" && sms.value) channels.push("sms");
  const leadDelivered = own.status === 'fulfilled' && own.value;
  if (leadDelivered) channels.push('lead-to-sar');
  // The pupil's confirmation is nice to have. Getting the lead to SAR is not,
  // so that is what decides the status code.
  res.status(leadDelivered || !NOTIFY ? 200 : 502).json({ ok: true, channels, lead: !!leadDelivered });
};
