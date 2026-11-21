import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { LOTS, LOT_BY_ID, HOUSE_TIERS, MAX_HOUSES_PER_FAMILY, SELL_REFUND, HOME_COOLDOWN_MS } from '../shared/houses.js';
import { getLayout, resolveCollisions } from '../shared/layout.js';

function setup() {
  let now = 50_000_000;
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, now: () => now });
  const join = (name, room = 'afrique-1') => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
    const c = game.connect(ws);
    const send = (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d }));
    send('hello', { name, home: 'BJ' });
    send('join', { room });
    const last = (t) => [...ws.sent].reverse().find((m) => m.t === t);
    return { c, ws, send, last };
  };
  /** Place le joueur devant un portail (sans passer par l'anti-téléportation). */
  const goTo = (p, lot) => Object.assign(p.c.pos, { x: lot.door.x, z: lot.door.z });
  /** Famille avec un chef et un membre. */
  const family = () => {
    const chef = join('Chef');
    const membre = join('Membre');
    chef.send('familyCreate', { name: 'Les Baobabs' });
    chef.send('familyInvite', { sid: membre.c.sid });
    membre.send('familyAccept', { familyId: chef.c.profile.familyId });
    return { chef, membre, fam: store.getFamily(chef.c.profile.familyId) };
  };
  return { store, game, join, goTo, family, advance: (ms) => (now += ms) };
}

const maison = LOTS.find((l) => l.tier === 'maison');
const villa = LOTS.find((l) => l.tier === 'villa');
const luxe = LOTS.find((l) => l.tier === 'luxe');

test('14 terrains dans 3 catégories, maisons accessibles depuis l\'avenue', () => {
  assert.equal(LOTS.length, 14);
  assert.deepEqual(new Set(LOTS.map((l) => l.tier)), new Set(['maison', 'villa', 'luxe']));
  const layout = getLayout('BJ');
  for (const l of LOTS) {
    const p = resolveCollisions({ ...l.door }, 0.45, layout.colliders);
    assert.ok(Math.hypot(p.x - l.door.x, p.z - l.door.z) < 1e-6, `portail ${l.id} bloqué`);
  }
});

test('cagnotte : dépôts des membres, retrait réservé au chef', () => {
  const { family } = setup();
  const { chef, membre, fam } = family();
  membre.send('familyDeposit', { amount: 1000 });
  assert.equal(fam.treasury, 1000);
  assert.equal(membre.c.profile.money, 1500);
  assert.equal(chef.last('profile').profile.family.treasury, 1000, 'le chef voit la cagnotte à jour');
  membre.send('familyDeposit', { amount: 999999 });
  assert.match(membre.last('error').message, /Pas assez/);
  membre.send('familyWithdraw', { amount: 100 });
  assert.match(membre.last('error').message, /chef/);
  chef.send('familyWithdraw', { amount: 400 });
  assert.equal(fam.treasury, 600);
});

test('achat : chef seulement, sur place, avec la cagnotte ; maison visible par tous les serveurs', () => {
  const { family, goTo, join, store } = setup();
  const { chef, membre, fam } = family();
  const autreServeur = join('Voisin', 'europe-1'); // même pays (BJ), autre serveur
  fam.treasury = HOUSE_TIERS.maison.price - 1;

  chef.send('houseBuy', { lot: maison.id });
  assert.match(chef.last('error').message, /portail/);
  goTo(chef, maison);
  chef.send('houseBuy', { lot: maison.id });
  assert.match(chef.last('error').message, /Il manque/);
  fam.treasury += 1;
  goTo(membre, maison);
  membre.send('houseBuy', { lot: maison.id });
  assert.match(membre.last('error').message, /chef/);

  chef.send('houseBuy', { lot: maison.id });
  assert.equal(fam.treasury, 0);
  assert.equal(store.housesOf(fam.id).length, 1);
  assert.equal(autreServeur.last('houses').houses[0].family, 'Les Baobabs');
  assert.ok(membre.ws.sent.some((m) => m.t === 'toast' && /a acheté/.test(m.message)));

  // Déjà vendue
  const autre = join('Rival');
  autre.send('familyCreate', { name: 'Les Rivaux' });
  store.getFamily(autre.c.profile.familyId).treasury = 1e6;
  goTo(autre, maison);
  autre.send('houseBuy', { lot: maison.id });
  assert.match(autre.last('error').message, /déjà vendue/);
});

test('limite de maisons par famille et revente à 60 %', () => {
  const { family, goTo, store } = setup();
  const { chef, fam } = family();
  fam.treasury = 1e6;
  for (const lot of [maison, villa]) {
    goTo(chef, lot);
    chef.send('houseBuy', { lot: lot.id });
  }
  assert.equal(store.housesOf(fam.id).length, MAX_HOUSES_PER_FAMILY);
  goTo(chef, luxe);
  chef.send('houseBuy', { lot: luxe.id });
  assert.match(chef.last('error').message, /au plus/);

  const before = fam.treasury;
  chef.send('houseSell', { lot: villa.id });
  assert.equal(fam.treasury, before + Math.floor(HOUSE_TIERS.villa.price * SELL_REFUND));
  assert.equal(store.housesOf(fam.id).length, 1);
});

test('couleurs, apparition à la maison et « Rentrer »', () => {
  const { family, goTo, advance, game } = setup();
  const { chef, membre, fam } = family();
  fam.treasury = 1e6;
  goTo(chef, maison);
  chef.send('houseBuy', { lot: maison.id });

  membre.send('houseColors', { lot: maison.id, wall: '#123456', roof: '#ABCDEF' });
  assert.equal(chef.last('houses').houses[0].roof, '#abcdef');
  membre.send('houseColors', { lot: maison.id, wall: 'rouge', roof: '#000000' });
  assert.match(membre.last('error').message, /Couleur/);

  // « Rentrer à la maison » depuis l'autre bout de la ville, avec délai entre deux retours
  Object.assign(membre.c.pos, { x: 150, z: 150 });
  membre.send('houseHome');
  const tp = membre.last('teleport');
  assert.ok(Math.hypot(tp.x - maison.door.x, tp.z - maison.door.z) < 5);
  membre.send('houseHome');
  assert.match(membre.last('error').message, /Patiente/);
  advance(HOME_COOLDOWN_MS);

  // En rejoignant un serveur, le membre apparaît devant la maison familiale
  membre.send('join', { room: 'roleplay-1' });
  const z = membre.last('zone');
  assert.ok(Math.hypot(z.pos.x - maison.door.x, z.pos.z - maison.door.z) < 5);
  void game;
});

test('famille dissoute : maisons remises en vente, cagnotte rendue', () => {
  const { join, goTo, store } = setup();
  const solo = join('Solo');
  solo.send('familyCreate', { name: 'Seul Au Monde' });
  const fam = store.getFamily(solo.c.profile.familyId);
  fam.treasury = HOUSE_TIERS.maison.price + 700;
  goTo(solo, maison);
  solo.send('houseBuy', { lot: maison.id });
  const money = solo.c.profile.money;
  solo.send('familyLeave');
  assert.equal(Object.keys(store.data.houses).length, 0);
  assert.equal(solo.c.profile.money, money + 700);
  assert.equal(LOT_BY_ID.get(maison.id).tier, 'maison');
});
