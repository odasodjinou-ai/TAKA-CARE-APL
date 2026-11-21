// Envoi de SMS. Un fournisseur s'active dès que ses clés sont configurées.
// Ordre de préférence : le moins cher d'abord (voir README, section « Connexion par SMS »).
//
// ⚠️ Testez chaque fournisseur avec un vrai numéro avant la mise en production.

async function post(fetchImpl, url, { headers = {}, form }) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
    err.body = text.slice(0, 300);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// --- Africa's Talking — https://developers.africastalking.com/docs/sms/sending ---------------
// Variables : AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optionnel, nom d'expéditeur validé)
function africasTalking(env, fetchImpl) {
  const username = env.AT_USERNAME;
  const apiKey = env.AT_API_KEY;
  const sandbox = username === 'sandbox';
  return {
    id: 'africastalking',
    label: "Africa's Talking",
    enabled: !!(username && apiKey),
    async send(to, message) {
      const url = sandbox ? 'https://api.sandbox.africastalking.com/version1/messaging' : 'https://api.africastalking.com/version1/messaging';
      const form = { username, to, message };
      if (env.AT_SENDER_ID) form.from = env.AT_SENDER_ID;
      const res = await post(fetchImpl, url, { headers: { apiKey }, form });
      const r = res?.SMSMessageData?.Recipients?.[0];
      if (!r || !['Success', 'Sent'].includes(r.status)) throw new Error(`Africa's Talking : ${r?.status ?? 'réponse inattendue'}`);
    },
  };
}

// --- Twilio — https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
// Variables : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, et TWILIO_FROM (numéro ou nom d'expéditeur)
//             ou TWILIO_MESSAGING_SERVICE_SID
function twilio(env, fetchImpl) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  return {
    id: 'twilio',
    label: 'Twilio',
    enabled: !!(sid && token && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)),
    async send(to, message) {
      const form = { To: to, Body: message };
      if (env.TWILIO_MESSAGING_SERVICE_SID) form.MessagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
      else form.From = env.TWILIO_FROM;
      const res = await post(fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
        form,
      });
      if (!res?.sid || ['failed', 'undelivered'].includes(res.status)) throw new Error(`Twilio : ${res?.status ?? 'réponse inattendue'}`);
    },
  };
}

// --- Développement : le code s'affiche dans la console et dans le jeu --------------------------
function devConsole(env) {
  return {
    id: 'dev',
    label: 'Console (développement)',
    enabled: env.SMS_DEV === '1' && env.NODE_ENV !== 'production',
    exposesCode: true,
    async send(to, message) {
      console.log(`[sms:dev] → ${to} : ${message}`);
    },
  };
}

export function createSmsProvider(env = process.env, fetchImpl = globalThis.fetch) {
  const all = [devConsole(env), africasTalking(env, fetchImpl), twilio(env, fetchImpl)];
  const forced = env.SMS_PROVIDER && all.find((p) => p.id === env.SMS_PROVIDER && p.enabled);
  return forced ?? all.find((p) => p.enabled) ?? null;
}
