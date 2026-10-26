# Enquiry auto-reply (WhatsApp → SMS fallback)

When someone sends any enquiry form on the site, the pupil instantly gets a
"we've got your enquiry" WhatsApp from 07902 023737 AND an SMS, at the same time.
The SMS goes even if they are on WhatsApp (set SMS_ALWAYS=false to send SMS only when WhatsApp fails). Allocation stays manual —
the FormSubmit email to sardrivingschool@gmail.com is unchanged.

How it flows:
  form submit ─┬─> FormSubmit (email to SAR, as before)
               └─> /api/enquiry ──> WhatsApp template (360dialog / Meta)
                                     │  API rejects it → SMS straight away
                                     └─ later "failed" report (not on WhatsApp)
                                        ──> /api/whatsapp-webhook ──> SMS (Twilio)

## 1. WhatsApp on SAR's own number (keep using the Business app)
Meta only lets approved partners connect a number that stays live in the
WhatsApp Business app ("coexistence"). Twilio doesn't offer this; 360dialog does.
1. Update WhatsApp Business on the phone (2.24.17 or newer).
2. Sign up at 360dialog, choose "connect existing WhatsApp Business App number",
   scan the QR from the phone. Chats and history stay in the app.
3. Open the WhatsApp Business app at least once every 13 days or the link drops.
4. Create an API key in the 360dialog hub → D360_API_KEY.

## 2. Message template (Meta must approve it — usually minutes to a day)
Name: enquiry_received · Category: UTILITY · Language: English (UK) en_GB
Body:
  Hi {{1}}, thanks for your enquiry with SAR Driving School. We've received it
  and we're now matching you with the right instructor for your area and
  availability. They'll be in touch shortly to arrange your first lesson.
  If you have any questions, just reply to this message.
Sample for {{1}}: Sarah
Keep it factual (no offers/prices) so it stays a cheaper Utility template.

## 3. SMS fallback (Twilio)
1. Twilio account → Account SID + Auth Token.
2. UK allows a sender name instead of a number: "SAR Driving" (max 11 chars).
   Replies can't come back to a name, so the text tells them to call/WhatsApp
   07902 023737. (A text can't legally show 07902 023737 as the sender unless
   that number is moved to Twilio.)

## 4. Vercel → Project → Settings → Environment Variables (Production)
  WA_PROVIDER        360dialog            (or meta)
  D360_API_KEY       <from 360dialog>
  WA_TEMPLATE_NAME   enquiry_received
  WA_TEMPLATE_LANG   en_GB
  TWILIO_ACCOUNT_SID <AC...>
  TWILIO_AUTH_TOKEN  <token>
  TWILIO_SMS_FROM    SAR Driving
  WEBHOOK_KEY        <any long random string>
Optional: SMS_TEXT (use {name}), HOURLY_CAP (default 40), SMS_UK_ONLY (default true),
ALLOW_PREVIEW_ORIGINS=true to test on *.vercel.app preview links.
Meta direct instead of 360dialog: META_PHONE_NUMBER_ID, META_ACCESS_TOKEN,
META_VERIFY_TOKEN, META_APP_SECRET.
Redeploy after adding them.

## 5. Point the delivery reports at the site
360dialog (run once, in Terminal):
  curl -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
    -H "D360-API-KEY: <key>" -H "Content-Type: application/json" \
    -d '{"url":"https://sardrivingschool.co.uk/api/whatsapp-webhook?key=<WEBHOOK_KEY>"}'

## 6. Test
Send the form with your own mobile → WhatsApp should arrive within seconds.
Send it with a number that has no WhatsApp → SMS a few seconds later.
Vercel → Project → Logs shows each "[enquiry]" / "[wa-webhook]" line.

## Safety built in
- Only the first name (letters only) goes into the message — the form can't be
  used to send someone else's text from SAR's number.
- Requests must come from sardrivingschool.co.uk; honeypot bots are ignored;
  one message per number per 10 min; hourly cap.
- Webhook needs the secret key (or Meta's signature).
