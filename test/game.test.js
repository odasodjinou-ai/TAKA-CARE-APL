import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { COUNTRIES } from '../shared/countries.js';
import { getLayout, PLACES, resolveCollisions, onRoad } from '../shared/layout.js';
import { validateSkin, DEFAULT_SKIN, DEFAULT_OWNED, flightPrice, STARTING_MONEY } from '../shared/catalog.js';

// Faux WebSocket qui enregistre les messages envoyés
function fakeWs() {
  return { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() { this.readyState = 3; } };
}
const last = (ws, t) => [...ws.sent].reverse().find((m) => m.t === t);

function setup() {
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms) => (now += ms) };
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, flightMs: 10, now: clock.now });
  const join = (name = 'Alice', home = 'FR', room = 'europe-1') => {
    const ws = fakeWs();
    const c = game.connect(ws);
    game.handleRaw(c, JSON.stringify({ t: 'hello', name, home }));
    game.handleRaw(c, JSON.stringify({ t: 'join', room }));
    return { ws, c, send: (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d })) };
  };
  // Déplace le joueur par petits pas valides (respecte l'anti-téléportation)
  const walkTo = (p, x, z) => {
    for (;;) {
      const dx = x - p.c.pos.x;
      const dz = z - p.c.pos.z;
      const d = Math.hypot(dx, dz);
      clock.advance(200);
      if (d < 8) return p.send('state', { x, y: 0, z, ry: 0, a: 1 });
      p.send('state', { x: p.c.pos.x + (dx / d) * 8, y: 0, z: p.c.pos.z + (dz / d) * 8, ry: 0, a: 1 });
    }
  };
  return { store, game, join, walkTo, clock };
}

test('chaque pays a un drapeau, un biome et un aéroport', () => {
  assert.ok(COUNTRIES.length >= 190);
  const codes = new Set(COUNTRIES.map((c) => c.code));
  assert.equal(codes.size, COUNTRIES.length, 'codes uniques');
  for (const c of COUNTRIES) {
    assert.match(c.code, /^[A-Z]{2}$/);
    assert.ok(['temperate', 'mediterranean', 'desert', 'savanna', 'tropical', 'snow'].includes(c.biome), c.code);
  }
});

test('la carte est déterministe et le spawn / les portes sont accessibles', () => {
  for (const code of ['FR', 'BJ', 'US', 'JP', 'NO']) {
    const a = getLayout(code);
    assert.deepEqual(a.buildings.length, getLayout(code).buildings.length);
    for (const pt of [a.spawn, ...Object.values(PLACES).map((p) => p.door), ...a.poi]) {
      const moved = resolveCollisions({ ...pt }, 0.45, a.colliders);
      assert.ok(Math.hypot(moved.x - pt.x, moved.z - pt.z) < 1e-6, `${code}: point bloqué ${JSON.stringify(pt)}`);
    }
    for (const b of a.buildings.filter((b) => b.kind === 'building')) assert.ok(!onRoad(b.x, b.z), 'bâtiment sur la route');
  }
});

test('validation des skins : couleurs, objets inconnus et non possédés', () => {
  assert.ok(validateSkin(DEFAULT_SKIN, DEFAULT_OWNED).ok);
  assert.equal(validateSkin({ ...DEFAULT_SKIN, tone: 'red' }, DEFAULT_OWNED).ok, false);
  assert.equal(validateSkin({ ...DEFAULT_SKIN, hat: 'crown' }, DEFAULT_OWNED).ok, false);
  assert.equal(validateSkin({ ...DEFAULT_SKIN, hat: '<script>' }, DEFAULT_OWNED).ok, false);
  assert.ok(validateSkin({ ...DEFAULT_SKIN, hat: 'crown' }, [...DEFAULT_OWNED, 'hat:crown']).ok);
});

test('prix des vols', () => {
  assert.equal(flightPrice('FR', 'DE'), 400);
  assert.equal(flightPrice('FR', 'BJ'), 1100);
  assert.equal(flightPrice('FR', 'FR'), null);
  assert.equal(flightPrice('FR', 'ZZ'), null);
});

test('création de compte, reconnexion par jeton et refus d\'un mauvais jeton', () => {
  const { game, join } = setup();
  const a = join('Alice');
  const w = last(a.ws, 'welcome');
  assert.equal(w.profile.money, STARTING_MONEY);
  assert.ok(w.token);

  const ws2 = fakeWs();
  const c2 = game.connect(ws2);
  game.handleRaw(c2, JSON.stringify({ t: 'hello', id: w.id, token: w.token }));
  assert.equal(last(ws2, 'welcome').profile.id, w.id);
  assert.ok(last(a.ws, 'kicked'), 'l\'ancienne session est éjectée');

  const ws3 = fakeWs();
  game.handleRaw(game.connect(ws3), JSON.stringify({ t: 'hello', id: w.id, token: 'faux' }));
  assert.ok(last(ws3, 'authFailed'));
});

test('pseudo invalide refusé', () => {
  const { game } = setup();
  const ws = fakeWs();
  game.handleRaw(game.connect(ws), JSON.stringify({ t: 'hello', name: '<img src=x>', home: 'FR' }));
  assert.ok(last(ws, 'error'));
  assert.equal(last(ws, 'welcome'), undefined);
});

test('anti-téléportation', () => {
  const { join, clock } = setup();
  const a = join();
  clock.advance(100);
  a.send('state', { x: 300, y: 0, z: 0, ry: 0, a: 0 });
  assert.ok(last(a.ws, 'correct'));
  assert.notEqual(a.c.pos.x, 300);
});

test('métier : une mission ne paie qu\'à destination et pas trop vite', () => {
  const { join, walkTo } = setup();
  const a = join();
  a.send('jobStart', { job: 'livreur' });
  assert.match(last(a.ws, 'error').message, /agence/);

  walkTo(a, PLACES.jobs.door.x, PLACES.jobs.door.z);
  a.send('jobStart', { job: 'livreur' });
  const m = last(a.ws, 'mission').mission;
  assert.ok(m && m.reward > 0);

  a.send('jobComplete', { id: m.id });
  assert.equal(a.c.profile.money, STARTING_MONEY, 'pas payé hors destination');

  walkTo(a, m.target.x, m.target.z);
  a.send('jobComplete', { id: m.id });
  assert.equal(a.c.profile.money, STARTING_MONEY + m.reward);
  assert.equal(a.c.profile.stats.missions, 1);
  assert.notEqual(last(a.ws, 'mission').mission.id, m.id, 'nouvelle mission enchaînée');
});

test('taxi : voiture obligatoire', () => {
  const { join, walkTo } = setup();
  const a = join();
  walkTo(a, PLACES.jobs.door.x, PLACES.jobs.door.z);
  a.send('jobStart', { job: 'taxi' });
  assert.match(last(a.ws, 'error').message, /voiture/);
  a.send('car', { on: true });
  a.send('jobStart', { job: 'taxi' });
  assert.ok(last(a.ws, 'mission').mission);
});

test('boutique : achat sur place uniquement, argent débité, puis équipement', () => {
  const { join, walkTo } = setup();
  const a = join();
  a.send('buy', { item: 'hat:cowboy' });
  assert.ok(!a.c.profile.owned.includes('hat:cowboy'));
  walkTo(a, PLACES.shop.door.x, PLACES.shop.door.z);
  a.send('buy', { item: 'hat:cowboy' });
  assert.ok(a.c.profile.owned.includes('hat:cowboy'));
  assert.equal(a.c.profile.money, STARTING_MONEY - 400);
  a.send('buy', { item: 'hat:crown' });
  assert.match(last(a.ws, 'error').message, /Vida/);
  a.send('skin', { skin: { ...a.c.profile.skin, hat: 'cowboy' } });
  assert.equal(a.c.profile.skin.hat, 'cowboy');
});

test('vol : billet débité, changement de pays, visibilité par pays', async () => {
  const { join, walkTo } = setup();
  const a = join('Alice', 'FR');
  const b = join('Bob', 'BJ');
  assert.equal(last(a.ws, 'zone').players.length, 0, 'pays différents : invisibles');

  a.send('flight', { to: 'BJ' });
  assert.match(last(a.ws, 'error').message, /aéroport/);

  walkTo(a, PLACES.airport.door.x, PLACES.airport.door.z);
  a.send('flight', { to: 'BJ' });
  assert.equal(a.c.profile.money, STARTING_MONEY - 1100);
  assert.ok(last(a.ws, 'flight'));
  await new Promise((r) => setTimeout(r, 30));
  const zone = last(a.ws, 'zone');
  assert.equal(zone.country, 'BJ');
  assert.equal(zone.players.length, 1);
  assert.equal(last(b.ws, 'pjoin').p.name, 'Alice');
});

test('familles : création, invitation, adhésion, virement et chat', () => {
  const { join } = setup();
  const a = join('Alice');
  const b = join('Bob');
  a.send('familyCreate', { name: 'Les Soleils' });
  const famId = a.c.profile.familyId;
  assert.ok(famId);
  assert.equal(a.c.profile.money, STARTING_MONEY - 500);

  b.send('familyAccept', { familyId: famId });
  assert.equal(b.c.profile.familyId, null, 'pas d\'adhésion sans invitation');

  a.send('familyInvite', { sid: b.c.sid });
  assert.equal(last(b.ws, 'familyInvite').name, 'Les Soleils');
  b.send('familyAccept', { familyId: famId });
  assert.equal(b.c.profile.familyId, famId);

  a.send('familyGift', { to: b.c.profile.id, amount: 300 });
  assert.equal(b.c.profile.money, STARTING_MONEY + 300);
  a.send('familyGift', { to: b.c.profile.id, amount: -50 });
  a.send('familyGift', { to: b.c.profile.id, amount: 1e9 });
  assert.equal(b.c.profile.money, STARTING_MONEY + 300, 'montants invalides refusés');

  a.send('chat', { text: 'Bonjour la famille', ch: 'family' });
  assert.equal(last(b.ws, 'chat').ch, 'family');

  a.send('familyLeave');
  assert.equal(a.c.profile.familyId, null);
  assert.ok(last(b.ws, 'profile').profile.family.ownerId === b.c.profile.id, 'propriété transmise');
});
