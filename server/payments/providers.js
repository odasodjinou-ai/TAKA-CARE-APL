// Connecteurs vers les prestataires de paiement.
//
// Principe de sécurité : on ne crédite JAMAIS sur la foi d'un retour navigateur ou du
// contenu d'un webhook. Chaque confirmation déclenche une relecture du statut auprès de
// l'API du prestataire (verify), authentifiée avec notre clé secrète.
//
// Chaque connecteur expose :
//   enabled                         : true si les clés sont configurées
//   methods                         : moyens de paiement couverts
//   createCheckout(order, urls)     -> { redirectUrl, providerRef }
//   verify(order)                   -> { status: 'paid' | 'pending' | 'failed', amount, currency }
//
// ⚠️ Les formats d'API ci-dessous suivent la documentation publique des prestataires.
//    Testez chaque connecteur en mode bac à sable du prestataire avant la mise en production.

const XOF_PER_EUR = 655.957; // parité fixe FCFA (UEMOA) / euro

async function http(fetchImpl, url, { method = 'GET', headers = {}, body, form } = {}) {
  const init = { method, headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) };
  if (form) {
    init.body = new URLSearchParams(form).toString();
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON */
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
    err.status = res.status;
    err.body = json ?? text.slice(0, 300);
    throw err;
  }
  return json;
}

// --- FedaPay (Bénin, Togo… : MTN MoMo, Moov Money, Celtiis Cash, cartes) -------------------
// Doc : https://docs.fedapay.com — variables FEDAPAY_SECRET_KEY, FEDAPAY_ENV=sandbox|live
function fedapay(env, fetchImpl) {
  const key = env.FEDAPAY_SECRET_KEY;
  const base = env.FEDAPAY_ENV === 'live' ? 'https://api.fedapay.com/v1' : 'https://sandbox-api.fedapay.com/v1';
  const auth = { authorization: `Bearer ${key}` };
  return {
    id: 'fedapay',
    label: 'FedaPay',
    enabled: !!key,
    methods: ['mtn', 'moov', 'celtiis'],
    async createCheckout(order, urls) {
      const created = await http(fetchImpl, `${base}/transactions`, {
        method: 'POST',
        headers: auth,
        body: {
          description: `Terra Vida — ${order.vida} Vida (commande ${order.id})`,
          amount: order.xof,
          currency: { iso: 'XOF' },
          callback_url: urls.returnUrl,
          merchant_reference: order.id,
          custom_metadata: { order_id: order.id },
        },
      });
      const tx = created?.['v1/transaction'] ?? created?.transaction ?? created;
      if (!tx?.id) throw new Error('FedaPay : réponse inattendue à la création.');
      const token = await http(fetchImpl, `${base}/transactions/${tx.id}/token`, { method: 'POST', headers: auth });
      if (!token?.url) throw new Error('FedaPay : lien de paiement absent.');
      return { redirectUrl: token.url, providerRef: String(tx.id) };
    },
    async verify(order) {
      const res = await http(fetchImpl, `${base}/transactions/${order.providerRef}`, { headers: auth });
      const tx = res?.['v1/transaction'] ?? res?.transaction ?? res;
      const map = { approved: 'paid', transferred: 'paid', pending: 'pending', declined: 'failed', canceled: 'failed', refunded: 'failed', expired: 'failed' };
      return { status: map[tx?.status] ?? 'pending', amount: Number(tx?.amount), currency: 'XOF' };
    },
  };
}

// --- Wave Checkout (Sénégal, Côte d'Ivoire…) ------------------------------------------------
// Doc : https://docs.wave.com/checkout — variable WAVE_API_KEY
function wave(env, fetchImpl) {
  const key = env.WAVE_API_KEY;
  const auth = { authorization: `Bearer ${key}` };
  return {
    id: 'wave',
    label: 'Wave',
    enabled: !!key,
    methods: ['wave'],
    async createCheckout(order, urls) {
      const s = await http(fetchImpl, 'https://api.wave.com/v1/checkout/sessions', {
        method: 'POST',
        headers: auth,
        body: { amount: String(order.xof), currency: 'XOF', success_url: urls.returnUrl, error_url: urls.returnUrl, client_reference: order.id },
      });
      if (!s?.wave_launch_url) throw new Error('Wave : lien de paiement absent.');
      return { redirectUrl: s.wave_launch_url, providerRef: s.id };
    },
    async verify(order) {
      const s = await http(fetchImpl, `https://api.wave.com/v1/checkout/sessions/${order.providerRef}`, { headers: auth });
      const status = s?.payment_status === 'succeeded' ? 'paid' : s?.checkout_status === 'expired' || s?.payment_status === 'cancelled' ? 'failed' : 'pending';
      return { status, amount: Number(s?.amount), currency: s?.currency };
    },
  };
}

// --- CinetPay (multi-pays : Orange Money, MTN, Moov, Wave, cartes) ----------------------------
// Doc : https://docs.cinetpay.com — variables CINETPAY_API_KEY, CINETPAY_SITE_ID
function cinetpay(env, fetchImpl) {
  const apikey = env.CINETPAY_API_KEY;
  const site_id = env.CINETPAY_SITE_ID;
  return {
    id: 'cinetpay',
    label: 'CinetPay',
    enabled: !!(apikey && site_id),
    methods: ['orange', 'wave', 'mtn', 'moov'],
    async createCheckout(order, urls) {
      const res = await http(fetchImpl, 'https://api-checkout.cinetpay.com/v2/payment', {
        method: 'POST',
        body: {
          apikey,
          site_id,
          transaction_id: order.id,
          amount: order.xof, // CinetPay exige un multiple de 5 : tous nos packs le sont
          currency: 'XOF',
          description: `Terra Vida ${order.vida} Vida`,
          notify_url: urls.webhookUrl,
          return_url: urls.returnUrl,
          channels: 'MOBILE_MONEY',
        },
      });
      if (!res?.data?.payment_url) throw new Error(`CinetPay : ${res?.message ?? 'lien absent'}`);
      return { redirectUrl: res.data.payment_url, providerRef: order.id };
    },
    async verify(order) {
      const res = await http(fetchImpl, 'https://api-checkout.cinetpay.com/v2/payment/check', {
        method: 'POST',
        body: { apikey, site_id, transaction_id: order.id },
      });
      const s = res?.data?.status;
      return { status: s === 'ACCEPTED' ? 'paid' : s === 'REFUSED' ? 'failed' : 'pending', amount: Number(res?.data?.amount), currency: res?.data?.currency };
    },
  };
}

// --- PayPal (Orders v2 : compte PayPal et cartes bancaires) ------------------------------------
// Doc : https://developer.paypal.com/docs/api/orders/v2/
// Variables : PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV=sandbox|live. Le FCFA n'est pas
// supporté par PayPal : on facture l'équivalent exact en euros (parité fixe).
function paypal(env, fetchImpl) {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_SECRET;
  const base = env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  let cached = { token: null, exp: 0 };
  const token = async () => {
    if (cached.token && cached.exp > Date.now() + 60_000) return cached.token;
    const res = await http(fetchImpl, `${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      form: { grant_type: 'client_credentials' },
    });
    cached = { token: res.access_token, exp: Date.now() + res.expires_in * 1000 };
    return cached.token;
  };
  const eur = (xof) => (Math.ceil((xof / XOF_PER_EUR) * 100) / 100).toFixed(2);
  return {
    id: 'paypal',
    label: 'PayPal',
    enabled: !!(id && secret),
    methods: ['paypal'],
    async createCheckout(order, urls) {
      const res = await http(fetchImpl, `${base}/v2/checkout/orders`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'PayPal-Request-Id': order.id },
        body: {
          intent: 'CAPTURE',
          purchase_units: [{ reference_id: order.id, custom_id: order.id, description: `Terra Vida — ${order.vida} Vida`, amount: { currency_code: 'EUR', value: eur(order.xof) } }],
          payment_source: { paypal: { experience_context: { return_url: urls.returnUrl, cancel_url: urls.returnUrl, user_action: 'PAY_NOW', brand_name: 'Terra Vida' } } },
        },
      });
      const link = res?.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
      if (!link) throw new Error('PayPal : lien d\'approbation absent.');
      return { redirectUrl: link.href, providerRef: res.id };
    },
    async verify(order) {
      const auth = { authorization: `Bearer ${await token()}` };
      let o = await http(fetchImpl, `${base}/v2/checkout/orders/${order.providerRef}`, { headers: auth });
      if (o?.status === 'APPROVED') {
        // L'acheteur a validé : on capture l'argent (idempotent grâce à PayPal-Request-Id)
        o = await http(fetchImpl, `${base}/v2/checkout/orders/${order.providerRef}/capture`, {
          method: 'POST',
          headers: { ...auth, 'PayPal-Request-Id': `${order.id}-capture` },
          body: {},
        });
      }
      const cap = o?.purchase_units?.[0]?.payments?.captures?.[0];
      const ok = o?.status === 'COMPLETED' && cap?.status === 'COMPLETED' && cap.amount?.value === eur(order.xof) && cap.amount?.currency_code === 'EUR';
      const failed = ['VOIDED'].includes(o?.status) || ['DECLINED', 'FAILED'].includes(cap?.status);
      // Montant reconverti en FCFA pour le contrôle générique du service
      return { status: ok ? 'paid' : failed ? 'failed' : 'pending', amount: ok ? order.xof : Number.NaN, currency: 'XOF' };
    },
  };
}

// --- Bac à sable interne (développement uniquement) -----------------------------------------
function sandbox(env) {
  const paid = new Set();
  return {
    id: 'sandbox',
    label: 'Simulation (test)',
    enabled: env.PAYMENTS_SANDBOX === '1' && env.NODE_ENV !== 'production',
    methods: ['mtn', 'moov', 'celtiis', 'wave', 'orange', 'paypal'],
    async createCheckout(order, urls) {
      return { redirectUrl: urls.sandboxUrl, providerRef: order.id };
    },
    async verify(order) {
      return { status: paid.has(order.id) ? 'paid' : 'pending', amount: order.xof, currency: 'XOF' };
    },
    markPaid(orderId) {
      paid.add(orderId);
    },
  };
}

/**
 * Ordre de préférence par moyen de paiement : le moins cher d'abord.
 * (Tarifs publics constatés fin 2026 — voir README, section Paiements.)
 */
export const ROUTING = {
  mtn: ['fedapay', 'cinetpay'],
  moov: ['fedapay', 'cinetpay'],
  celtiis: ['fedapay'],
  wave: ['wave', 'cinetpay'],
  orange: ['cinetpay'],
  paypal: ['paypal'],
};

export function createProviders(env = process.env, fetchImpl = globalThis.fetch) {
  const list = [fedapay(env, fetchImpl), wave(env, fetchImpl), cinetpay(env, fetchImpl), paypal(env, fetchImpl), sandbox(env)];
  return Object.fromEntries(list.map((p) => [p.id, p]));
}

/** Choisit le prestataire actif le moins cher pour un moyen de paiement. */
export function routeMethod(providers, method) {
  if (providers.sandbox?.enabled) return providers.sandbox;
  for (const id of ROUTING[method] ?? []) if (providers[id]?.enabled) return providers[id];
  return null;
}
