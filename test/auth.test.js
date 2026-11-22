import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { OtpService, OTP, normalizePhone, maskPhone } from '../server/auth/otp.js';
import { createSmsProvider } from '../server/auth/sms.js';

const quiet = { error() {}, info() {}, log() {} };

/** Fournisseur SMS factice : mémorise le dernier code envoyé à chaque numéro. */
function fakeSms() {
  const inbox = new Map();
  return {
    id: 'fake',
    sent: 0,
    async send(to, msg) {
      this.sent++;
      inbox.set(to, msg.match(/\d{6}/)[0]);
    },
    code: (to) => inbox.get(to),
  };
}

function setup() {
  let now = 5_000_000;
  const clock = { now: () => now, advance: (ms) => (now += ms) };
  const store = new Store(null);
  const sms = fakeSms();
  const otp = new OtpService(sms, { now: clock.now, log: quiet });
  const game = new Game(store, { tickMs: 0, now: clock.now, otp });
  const device = (ip = '1.2.3.4') => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() { this.readyState = 3; } };
    const c = game.connect(ws, { ip });
    const send = async (t, d = {}) => {
      game.handleRaw(c, JSON.stringify({ t, ...d }));
      await new Promise((r) => setImmediate(r)); // laisse finir les gestionnaires asynchrones
    };
    const last = (t) => [...ws.sent].reverse().find((m) => m.t === t);
    return { ws, c, send, last };
  };
  return { store, sms, otp, game, device, clock };
}

const PHONE = '+2290197000001';

test('normalisation et masquage des numéros', () => {
  assert.equal(normalizePhone('+229 01 97 00 00 01'), PHONE);
  assert.equal(normalizePhone('00229-01.97.00.00.01'), PHONE);
  assert.equal(normalizePhone('0197000001'), null, 'indicatif obligatoire');
  assert.equal(normalizePhone('+229abc'), null);
  assert.equal(normalizePhone('+1234'), null);
  assert.equal(maskPhone(PHONE), '+229 •• •• •• 01');
});

test('nouveau joueur : code SMS -> pseudo -> compte lié au numéro', async () => {
  const { device, sms, store } = setup();
  const d = device();
  await d.send('otpRequest', { phone: '+229 01 97 00 00 01' });
  assert.equal(d.last('otpSent').phone, '+229 •• •• •• 01');
  assert.equal(d.last('otpSent').devCode, undefined, 'le code n\'est jamais renvoyé au client en production');
  await d.send('otpVerify', { phone: PHONE, code: sms.code(PHONE) });
  const { ticket } = d.last('otpNeedProfile');
  assert.ok(ticket);
  await d.send('hello', { name: 'Aïcha', home: 'BJ', phoneTicket: ticket });
  const w = d.last('welcome');
  assert.ok(w.token);
  assert.equal(store.findByPhone(PHONE).name, 'Aïcha');
  assert.equal(w.profile.phone, '+229 •• •• •• 01');

  // Ticket à usage unique
  const d2 = device('5.6.7.8');
  await d2.send('hello', { name: 'Pirate', home: 'BJ', phoneTicket: ticket });
  assert.match(d2.last('error').message, /expirée/);
});

test('reconnexion sur un autre appareil avec le même numéro : même compte, même argent', async () => {
  const { device, sms, clock } = setup();
  const a = device();
  await a.send('otpRequest', { phone: PHONE });
  await a.send('otpVerify', { phone: PHONE, code: sms.code(PHONE) });
  await a.send('hello', { name: 'Koffi', home: 'TG', phoneTicket: a.last('otpNeedProfile').ticket });
  const profile = a.c.profile;
  profile.vida = 550;

  clock.advance(OTP.resendMs);
  const b = device('9.9.9.9');
  await b.send('otpRequest', { phone: PHONE });
  await b.send('otpVerify', { phone: PHONE, code: sms.code(PHONE) });
  const w = b.last('welcome');
  assert.equal(w.id, profile.id);
  assert.equal(w.profile.vida, 550);
  assert.equal(w.profile.devices, 2);
  assert.ok(a.last('kicked'), 'l\'ancienne session est fermée');

  // Les deux jetons restent valides ; « déconnecter les autres » révoque le premier
  await b.send('logoutOthers', { token: w.token });
  assert.equal(b.c.profile.tokenHashes.length, 1);
});

test('compte invité : lier un numéro, refus si déjà utilisé par un autre compte', async () => {
  const { device, sms, clock } = setup();
  const guest = device();
  await guest.send('hello', { name: 'Invite', home: 'FR' });
  await guest.send('otpRequest', { phone: PHONE });
  await guest.send('otpVerify', { phone: PHONE, code: sms.code(PHONE) });
  assert.ok(guest.last('phoneLinked'));
  assert.equal(guest.c.profile.phone, PHONE);

  clock.advance(OTP.resendMs);
  const other = device('8.8.8.8');
  await other.send('hello', { name: 'Autre', home: 'FR' });
  await other.send('otpRequest', { phone: PHONE });
  assert.match(other.last('error').message, /déjà lié/);
});

test('code faux : essais limités puis code invalidé ; expiration', async () => {
  const { device, sms, clock } = setup();
  const d = device();
  await d.send('otpRequest', { phone: PHONE });
  const good = sms.code(PHONE);
  const bad = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < OTP.maxAttempts - 1; i++) await d.send('otpVerify', { phone: PHONE, code: bad });
  assert.match(d.last('error').message, /incorrect/);
  await d.send('otpVerify', { phone: PHONE, code: bad });
  assert.match(d.last('error').message, /Trop d'essais/);
  await d.send('otpVerify', { phone: PHONE, code: good });
  assert.match(d.last('error').message, /expiré/, 'le bon code ne marche plus après trop d\'essais');

  clock.advance(OTP.resendMs);
  await d.send('otpRequest', { phone: PHONE });
  clock.advance(OTP.ttlMs + 1);
  await d.send('otpVerify', { phone: PHONE, code: sms.code(PHONE) });
  assert.match(d.last('error').message, /expiré/);
});

test('anti-abus : délai entre deux SMS, plafond par numéro et par IP', async () => {
  const { device, sms, clock } = setup();
  const d = device('7.7.7.7');
  await d.send('otpRequest', { phone: PHONE });
  await d.send('otpRequest', { phone: PHONE });
  assert.match(d.last('error').message, /Patiente/);
  for (let i = 1; i < OTP.perPhonePerHour; i++) {
    clock.advance(OTP.resendMs);
    await d.send('otpRequest', { phone: PHONE });
  }
  const sent = sms.sent;
  clock.advance(OTP.resendMs);
  await d.send('otpRequest', { phone: PHONE });
  assert.match(d.last('error').message, /Trop de codes/);
  assert.equal(sms.sent, sent, 'aucun SMS payé au-delà du plafond');

  // Plafond par IP : beaucoup de numéros différents depuis la même connexion
  const e = device('6.6.6.6');
  for (let i = 0; i < OTP.perIpPerHour; i++) await e.send('otpRequest', { phone: `+22901970001${String(i).padStart(2, '0')}` });
  await e.send('otpRequest', { phone: '+2290197000199' });
  assert.match(e.last('error').message, /ta connexion/);
});

test('achat de Vida : numéro vérifié obligatoire', async () => {
  const { store, device, otp } = setup();
  const game = new Game(store, { tickMs: 0, otp, payments: { createOrder: async () => ({ order: { id: 'x', receiptKey: 'k' }, redirectUrl: 'u' }), methods: () => [] } });
  const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
  const c = game.connect(ws);
  game.handleRaw(c, JSON.stringify({ t: 'hello', name: 'Sans', home: 'BJ' }));
  game.handleRaw(c, JSON.stringify({ t: 'payCreate', pack: 'vida-100', method: 'mtn' }));
  await new Promise((r) => setImmediate(r));
  assert.ok(ws.sent.some((m) => m.t === 'phoneRequired'));
  assert.ok(!ws.sent.some((m) => m.t === 'payCreated'));
  void device;
});

test('fournisseur SMS : désactivé sans clés, mode dev interdit en production', () => {
  assert.equal(createSmsProvider({}), null);
  assert.equal(createSmsProvider({ SMS_DEV: '1', NODE_ENV: 'production' }), null);
  assert.equal(createSmsProvider({ SMS_DEV: '1' }).id, 'dev');
  assert.equal(createSmsProvider({ AT_USERNAME: 'u', AT_API_KEY: 'k', TWILIO_ACCOUNT_SID: 's', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: 'TV' }).id, 'africastalking');
  assert.equal(createSmsProvider({ SMS_PROVIDER: 'twilio', AT_USERNAME: 'u', AT_API_KEY: 'k', TWILIO_ACCOUNT_SID: 's', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: 'TV' }).id, 'twilio');
});
