// SAR Driving School — instant "we've received your enquiry" messages.
// WhatsApp first (from SAR's own number, via the WhatsApp Cloud API through
// 360dialog or Meta directly). If WhatsApp can't deliver — the number isn't on
// WhatsApp — the webhook in api/whatsapp-webhook.js sends an SMS instead (Twilio).
//
// Everything secret lives in Vercel → Project → Settings → Environment Variables.
// See api/README-auto-reply.md for the full list.

const crypto = require('crypto');

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

// ---------- phone numbers ----------
// Same rules as the website's phone check: fold +44 / 0044 / 44 to a UK 07,
// accept a full international number written with +.
function toE164(v) {
  let s = String(v || '').replace(/[\s()\.\-‐-― ]/g, '');
  if (/^00/.test(s)) s = '+' + s.slice(2);
  if (/^\+440/.test(s)) s = '0' + s.slice(4);
  if (/^\+44/.test(s)) s = '0' + s.slice(3);
  if (/^447\d{9}$/.test(s)) s = '0' + s.slice(2);
  if (/^07\d{9}$/.test(s)) return '+44' + s.slice(1);
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}
const isUkMobile = (e164) => /^\+447\d{9}$/.test(e164 || '');

// First name only, letters only, short — nobody can use the form to make SAR
// send a message with their own text in it.
function firstName(v) {
  const w = String(v || '').trim().split(/\s+/)[0] || '';
  const clean = w.replace(/[^A-Za-zÀ-ɏ'\-]/g, '').slice(0, 20);
  if (!clean) return 'there';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ---------- WhatsApp (Cloud API format) ----------
async function sendWhatsAppTemplate(toE164Num, name) {
  const provider = env('WA_PROVIDER', '360dialog'); // '360dialog' | 'meta'
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toE164Num.replace('+', ''),
    type: 'template',
    template: {
      name: env('WA_TEMPLATE_NAME', 'enquiry_received'),
      language: { code: env('WA_TEMPLATE_LANG', 'en_GB') },
      components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }],
    },
    // Comes back on the delivery-status webhook, so the SMS fallback knows who
    // this was without needing a database.
    biz_opaque_callback_data: JSON.stringify({ n: name, p: toE164Num }),
  };

  let url, headers;
  if (provider === 'meta') {
    url = `https://graph.facebook.com/${env('META_GRAPH_VERSION', 'v21.0')}/${env('META_PHONE_NUMBER_ID')}/messages`;
    headers = { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' };
  } else {
    url = env('D360_BASE_URL', 'https://waba-v2.360dialog.io') + '/messages';
    headers = { 'D360-API-KEY': env('D360_API_KEY'), 'Content-Type': 'application/json' };
  }

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error('WhatsApp send failed: ' + r.status + ' ' + JSON.stringify(data.error || data));
    err.status = r.status;
    throw err;
  }
  return (data.messages && data.messages[0] && data.messages[0].id) || null;
}

// ---------- SMS (Twilio) ----------
function smsText(name) {
  const t = env('SMS_TEXT',
    "Hi {name}, thanks for your enquiry with SAR Driving School! We've got it and are matching you with an instructor now. Questions? Call/WhatsApp 07902 023737");
  return t.replace(/\{name\}/g, name);
}

async function sendSms(toE164Num, name) {
  if (!isUkMobile(toE164Num) && env('SMS_UK_ONLY', 'true') === 'true') {
    console.log('[sms] skipped non-UK number', mask(toE164Num));
    return null;
  }
  const sid = env('TWILIO_ACCOUNT_SID');
  const tok = env('TWILIO_AUTH_TOKEN');
  const params = new URLSearchParams({ To: toE164Num, Body: smsText(name) });
  if (env('TWILIO_MESSAGING_SERVICE_SID')) params.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
  else params.set('From', env('TWILIO_SMS_FROM', 'SAR Driving'));

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('SMS send failed: ' + r.status + ' ' + (data.message || JSON.stringify(data)));
  return data.sid || null;
}

// ---------- helpers ----------
const mask = (p) => (p ? String(p).slice(0, 5) + '****' + String(p).slice(-3) : '');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { d += c; if (d.length > 100000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { env, toE164, isUkMobile, firstName, sendWhatsAppTemplate, sendSms, smsText, mask, readRaw, safeEqual, crypto };
