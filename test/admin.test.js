import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { parseAdminPhones, isBanned, DURATIONS } from '../server/admin.js';
import { SANCTIONS } from '../server/moderation.js';

const ADMIN_PHONE = '+2290190000001';

function setup() {
  let now = 20_000_000;
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, now: () => now, adminPhones: `${ADMIN_PHONE}, +33 6 12 34 56 78` });
  const join = (name, phone = null) => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() { this.readyState = 3; } };
    const c = game.connect(ws);
    const send = (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d }));
    send('hello', { name, home: 'BJ' });
    if (phone) c.profile.phone = phone; // équivaut à un numéro vérifié par SMS
    send('join', { room: 'afrique-1' });
    const last = (t) => [...ws.sent].reverse().find((m) => m.t === t);
    return { c, ws, send, last, token: last('welcome').token, id: c.profile.id };
  };
  return { store, game, join, advance: (ms) => (now += ms), now: () => now };
}

/** Un joueur insulte, trois autres le signalent. */
function withReports(s) {
  const target = s.join('Troll');
  const reporters = [s.join('Awa'), s.join('Bio'), s.join('Codjo')];
  target.send('chat', { text: 'vous êtes tous nuls' });
  const msgId = reporters[0].last('chat').id;
  for (const r of reporters) r.send('report', { id: msgId, reason: 'harcèlement' });
  return { target, reporters };
}

test('ADMIN_PHONES : numéros normalisés, invalides ignorés', () => {
  const set = parseAdminPhones('+229 01 90 00 00 01, 0033612345678, n\'importe quoi,');
  assert.deepEqual([...set], ['+2290190000001', '+33612345678']);
});

test('accès refusé aux joueurs normaux et aux invités, même avec un pseudo d\'admin', () => {
  const s = setup();
  const p = s.join('Admin'); // invité : pas de numéro vérifié
  p.send('adminReports', {});
  assert.match(p.last('error').message, /réservé/);
  assert.equal(p.last('adminReports'), undefined);
  assert.equal(p.last('welcome').profile.isAdmin, false);
});

test('l\'admin voit les signalements groupés par joueur et reçoit les alertes', () => {
  const s = setup();
  const admin = s.join('Modo', ADMIN_PHONE);
  withReports(s);
  assert.equal(admin.last('adminBadge').openCount, 3);
  assert.ok(admin.ws.sent.some((m) => m.t === 'toast' && /Nouveau signalement contre Troll/.test(m.message)));
  admin.send('adminReports', { status: 'open' });
  const r = admin.last('adminReports');
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].target.name, 'Troll');
  assert.equal(r.groups[0].reporters, 3);
  assert.equal(r.groups[0].reports[0].text, 'vous êtes tous nuls');
});

test('dossier joueur : messages récents, signalements, recherche', () => {
  const s = setup();
  const admin = s.join('Modo', ADMIN_PHONE);
  const { target } = withReports(s);
  admin.send('adminPlayer', { id: target.id });
  const d = admin.last('adminPlayer');
  assert.equal(d.recentMessages[0].text, 'vous êtes tous nuls');
  assert.equal(d.reports.length, 3);
  admin.send('adminSearch', { q: 'tro' });
  assert.equal(admin.last('adminSearch').players[0].id, target.id);
});

test('silence : motif obligatoire, appliqué, signalements clos, journalisé, puis levé', () => {
  const s = setup();
  const admin = s.join('Modo', ADMIN_PHONE);
  const { target, reporters } = withReports(s);
  admin.send('adminAction', { target: target.id, action: 'mute', duration: '24h' });
  assert.match(admin.last('error').message, /motif/);

  admin.send('adminAction', { target: target.id, action: 'mute', duration: '24h', reason: 'Harcèlement répété' });
  assert.match(target.last('toast').message, /réduit au silence/);
  s.advance(SANCTIONS.muteMs[0] * 2);
  target.send('chat', { text: 'coucou' });
  assert.match(target.last('error').message, /ne peux pas écrire/);
  assert.ok(s.store.data.reports.every((r) => r.status === 'handled' && r.handledBy === 'Modo'));
  assert.equal(s.store.data.audit.at(-1).action, 'mute');
  assert.equal(s.store.data.audit.at(-1).reportsClosed, 3);

  admin.send('adminAction', { target: target.id, action: 'unmute' });
  s.advance(1000);
  target.send('chat', { text: 'merci' });
  assert.equal(reporters[0].last('chat').text, 'merci');
});

test('bannissement : expulsion immédiate, reconnexion refusée, levée possible', () => {
  const s = setup();
  const admin = s.join('Modo', ADMIN_PHONE);
  const { target } = withReports(s);
  admin.send('adminAction', { target: target.id, action: 'ban', duration: '7j', reason: 'Insultes racistes' });
  assert.equal(target.last('banned').reason, 'Insultes racistes');
  assert.equal(target.ws.readyState, 3, 'connexion fermée');
  assert.ok(isBanned(s.store.getPlayer(target.id), s.now()));

  // Tentative de reconnexion avec le même jeton
  const ws = { readyState: 1, sent: [], send(x) { this.sent.push(JSON.parse(x)); }, close() { this.readyState = 3; } };
  s.game.handleRaw(s.game.connect(ws), JSON.stringify({ t: 'hello', id: target.id, token: target.token }));
  assert.equal(ws.sent.at(-1).t, 'banned');
  assert.ok(!ws.sent.some((m) => m.t === 'welcome'));

  // Le bannissement temporaire expire tout seul
  s.advance(DURATIONS['7j'] + 1);
  assert.equal(isBanned(s.store.getPlayer(target.id), s.now()), null);

  admin.send('adminAction', { target: target.id, action: 'ban', duration: 'permanent', reason: 'Récidive' });
  admin.send('adminAction', { target: target.id, action: 'unban' });
  assert.equal(s.store.getPlayer(target.id).ban, null);
});

test('classer sans suite, garde-fous', () => {
  const s = setup();
  const admin = s.join('Modo', ADMIN_PHONE);
  const other = s.join('Modo2', '+33612345678');
  const { target } = withReports(s);
  admin.send('adminAction', { target: target.id, action: 'dismiss' });
  assert.ok(s.store.data.reports.every((r) => r.status === 'dismissed'));
  admin.send('adminAction', { target: other.id, action: 'ban', duration: '24h', reason: 'test' });
  assert.match(admin.last('error').message, /autre administrateur/);
  admin.send('adminAction', { target: target.id, action: 'mute', duration: 'permanent', reason: 'x' });
  assert.match(admin.last('error').message, /durée/);
  admin.send('adminAction', { target: target.id, action: 'delete' });
  assert.match(admin.last('error').message, /inconnue/);
  admin.send('adminLog');
  assert.equal(admin.last('adminLog').entries[0].action, 'dismiss');
});
