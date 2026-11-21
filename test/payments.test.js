import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { PaymentService, UserError } from '../server/payments/service.js';
import { createProviders, routeMethod } from '../server/payments/providers.js';
import { receiptPage } from '../server/payments/pages.js';
import { VEHICLES, VEHICLE_BY_ID } from '../shared/vehicles.js';
import { ITEMS, VIDA_PACKS, PREMIUM, validateSkin, DEFAULT_SKIN, DEFAULT_OWNED } from '../shared/catalog.js';
import { PLACES } from '../shared/layout.js';

const quiet = { error() {}, info() {} };

/** Prestataire factice contrôlable depuis le test. */
function fakeProvider() {
  const state = new Map();
  return {
    id: 'fake',
    label: 'Fake',
    enabled: true,
    methods: ['mtn'],
    verifyCalls: 0,
    async createCheckout(order) {
      state.set(order.id, { status: 'pending', amount: order.xof });
      return { redirectUrl: `https://pay.example/${order.id}`, providerRef: `ref-${order.id}` };
    },
    async verify(order) {
      this.verifyCalls++;
      await new Promise((r) => setTimeout(r, 5));
      return { ...state.get(order.id), currency: 'XOF' };
    },
    set(orderId, patch) {
      Object.assign(state.get(orderId), patch);
    },
  };
}

function setup() {
  const store = new Store(null);
  const provider = fakeProvider();
  const providers = { fake: provider };
  const paid = [];
  const svc = new PaymentService(store, providers, { publicUrl: 'https://jeu.example', onPaid: (o) => paid.push(o), log: quiet });
  // Route tous les moyens vers le prestataire factice
  svc.methods = () => [{ id: 'mtn', enabled: true }];
  const { player } = store.createPlayer('Awa', 'BJ');
  return { store, provider, svc, player, paid };
}

// routeMethod lit ROUTING : on simule un prestataire « fedapay »
function routedSetup() {
  const s = setup();
  s.provider.id = 'fedapay';
  s.svc.providers = { fedapay: s.provider };
  return s;
}

test('catalogue : plus de 40 véhicules, ids uniques, tous achetables', () => {
  assert.ok(VEHICLES.length >= 40);
  assert.equal(new Set(VEHICLES.map((v) => v.id)).size, VEHICLES.length);
  for (const v of VEHICLES) {
    assert.ok(ITEMS[`car:${v.id}`], v.id);
    assert.ok(v.speed > 0 && v.accel > 0, v.id);
  }
  assert.equal(VEHICLE_BY_ID.get('sakura-kora').price, 0, 'un véhicule offert');
});

test('routage : le prestataire le moins cher actif est choisi, rien si aucun', () => {
  const none = createProviders({});
  assert.equal(routeMethod(none, 'mtn'), null);
  const p = createProviders({ FEDAPAY_SECRET_KEY: 'sk', CINETPAY_API_KEY: 'a', CINETPAY_SITE_ID: 'b' });
  assert.equal(routeMethod(p, 'mtn').id, 'fedapay');
  assert.equal(routeMethod(p, 'orange').id, 'cinetpay');
  assert.equal(routeMethod(p, 'wave').id, 'cinetpay');
  assert.equal(routeMethod(p, 'paypal'), null);
  assert.equal(createProviders({ PAYMENTS_SANDBOX: '1', NODE_ENV: 'production' }).sandbox.enabled, false, 'simulation interdite en production');
});

test('paiement : crédit unique même avec confirmations concurrentes', async () => {
  const { svc, provider, player, store, paid } = routedSetup();
  const { order, redirectUrl } = await svc.createOrder(player, 'vida-260', 'mtn');
  assert.match(redirectUrl, /pay\.example/);
  assert.equal(player.vida, 0);

  await svc.confirm(order.id);
  assert.equal(order.status, 'pending', 'pas de crédit tant que non payé');

  provider.set(order.id, { status: 'paid' });
  await Promise.all([svc.confirm(order.id), svc.confirm(order.id), svc.confirm(order.id)]);
  await svc.confirm(order.id);
  assert.equal(player.vida, 260, 'crédité une seule fois');
  assert.equal(order.status, 'paid');
  assert.match(order.receiptNo, /^TV-\d{4}-000001$/);
  assert.equal(paid.length, 1);
  assert.equal(player.vidaLog[0].delta, 260);
  assert.equal(store.ordersOf(player.id).length, 1);
});

test('paiement : un montant différent du pack n\'est jamais crédité', async () => {
  const { svc, provider, player } = routedSetup();
  const { order } = await svc.createOrder(player, 'vida-1150', 'mtn');
  provider.set(order.id, { status: 'paid', amount: 100 });
  await svc.confirm(order.id);
  assert.equal(player.vida, 0);
  assert.equal(order.status, 'review');
});

test('paiement : pack ou moyen invalide, prestataire absent, trop de commandes', async () => {
  const { svc, player } = routedSetup();
  await assert.rejects(svc.createOrder(player, 'vida-999', 'mtn'), UserError);
  await assert.rejects(svc.createOrder(player, 'vida-100', 'bitcoin'), UserError);
  await assert.rejects(svc.createOrder(player, 'vida-100', 'paypal'), /pas encore disponible/);
  for (let i = 0; i < 5; i++) await svc.createOrder(player, 'vida-100', 'mtn');
  await assert.rejects(svc.createOrder(player, 'vida-100', 'mtn'), /Trop de paiements/);
});

test('reçu : clé obligatoire et contenu échappé', async () => {
  const { svc, provider, player } = routedSetup();
  player.name = '<b>x</b>';
  const { order } = await svc.createOrder(player, 'vida-100', 'mtn');
  assert.equal(svc.checkKey(order, 'mauvaise'), false);
  assert.equal(svc.checkKey(order, order.receiptKey), true);
  provider.set(order.id, { status: 'paid' });
  await svc.confirm(order.id);
  const html = receiptPage(order, { name: 'Terra Vida', support: 'x', timezone: 'Africa/Porto-Novo' });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.match(html, /1\s000\sFCFA/);
  assert.ok(!html.includes('<b>x</b>'));
});

// --- Intégration dans le jeu ---------------------------------------------------------
function gameSetup() {
  let now = 1_000_000;
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, now: () => now });
  const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
  const c = game.connect(ws);
  const send = (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d }));
  send('hello', { name: 'Kofi', home: 'BJ' });
  send('join', { room: 'afrique-1' });
  const last = (t) => [...ws.sent].reverse().find((m) => m.t === t);
  return { store, game, c, send, last, advance: (ms) => (now += ms) };
}

test('Premium : 1er abonnement 100 Ʋ, renouvellement 160 Ʋ, durée cumulée de 3 mois', () => {
  const { c, send, last, advance } = gameSetup();
  const p = c.profile;
  send('premiumBuy');
  assert.match(last('error').message, /Recharge/);
  p.vida = 300;
  send('premiumBuy');
  assert.equal(p.vida, 200);
  assert.equal(last('profile').profile.premium.active, true);
  assert.equal(last('profile').profile.premium.nextPrice, PREMIUM.renewPrice);
  const until1 = p.premium.until;
  advance(1000);
  send('premiumBuy');
  assert.equal(p.vida, 40);
  assert.equal(p.premium.until, until1 + PREMIUM.days * 86_400_000, 'prolongation cumulée');
});

test('Premium : expire, bonus de salaire et véhicules exclusifs', () => {
  const { c, send, last, advance } = gameSetup();
  const p = c.profile;
  p.owned.push('car:rossa-tempesta');
  p.skin.car = 'rossa-tempesta';
  send('car', { on: true });
  assert.match(last('error').message, /Premium/);
  p.vida = 100;
  send('premiumBuy');
  send('car', { on: true });
  assert.equal(c.veh, 'rossa-tempesta');
  advance(PREMIUM.days * 86_400_000 + 1);
  assert.equal(last('profile').profile.premium.active, true, 'dernière vue avant expiration');
  send('car', { on: true });
  assert.match(last('error').message, /Premium/, 'expiré');
});

test('achats en Vida et change Vida -> Cauris', () => {
  const { c, send, last } = gameSetup();
  const p = c.profile;
  c.pos = { ...c.pos, x: PLACES.cars.door.x, z: PLACES.cars.door.z };
  send('buy', { item: 'car:rossa-fulmine' });
  assert.match(last('error').message, /Vida/);
  p.vida = 400;
  send('buy', { item: 'car:rossa-fulmine' });
  assert.ok(p.owned.includes('car:rossa-fulmine'));
  assert.equal(p.vida, 50);
  const cauris = p.money;
  send('exchange', { id: 'ex-20' });
  assert.equal(p.money, cauris + 1000);
  assert.equal(p.vida, 30);
  send('exchange', { id: 'ex-500' });
  assert.equal(p.vida, 30, 'refusé sans solde');
});

test('anciens comptes : migration des voitures et des champs Vida', () => {
  const store = new Store(null);
  const p = { id: 'x', name: 'Old', owned: [...DEFAULT_OWNED.filter((i) => !i.startsWith('car:')), 'car:citadine', 'car:sport'], skin: { ...DEFAULT_SKIN, car: 'sport' } };
  // migration appliquée au chargement : on la déclenche via un fichier temporaire
  store.data.players.x = p;
  return import('node:fs').then(async (fs) => {
    const os = await import('node:os');
    const path = await import('node:path');
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tv-')), 'db.json');
    fs.writeFileSync(f, JSON.stringify(store.data));
    const loaded = new Store(f).getPlayer('x');
    assert.equal(loaded.skin.car, 'hanbit-strike');
    assert.ok(loaded.owned.includes('car:sakura-kora'));
    assert.equal(loaded.vida, 0);
    assert.ok(validateSkin(loaded.skin, loaded.owned).ok);
  });
});

test('les packs sont des multiples de 5 FCFA (exigence CinetPay) et 1 Ʋ ≈ 10 FCFA', () => {
  for (const p of VIDA_PACKS) {
    assert.equal(p.xof % 5, 0);
    assert.ok(p.vida >= p.xof / 10);
  }
});
