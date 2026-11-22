import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { APARTMENTS, APARTMENT_UNITS, TOLL, boothSpot, lightState, LIGHT_CYCLE, INTERSECTIONS, RIVER, BRIDGE } from '../shared/city.js';
import { LOTS } from '../shared/houses.js';
import { interiorLayout } from '../shared/interiors.js';
import { getLayout, resolveCollisions, AIRPORT } from '../shared/layout.js';
import { GAME_DAY_MS, HOUSE_INCOME, INCOME_MAX_DAYS } from '../server/properties.js';
import { STARTING_MONEY } from '../shared/catalog.js';

function setup() {
  let now = 90_000_000;
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
  const at = (p, x, z) => Object.assign(p.c.pos, { x, z });
  return { store, game, join, at, advance: (ms) => (now += ms), now: () => now };
}

test('carte : fleuve infranchissable sauf par le pont, piste raccourcie, feux sur 25 carrefours', () => {
  const layout = getLayout('BJ');
  const onBridge = resolveCollisions({ x: BRIDGE.x, z: RIVER.z }, 0.45, layout.colliders);
  assert.equal(onBridge.z, RIVER.z, 'le pont est praticable');
  const inRiver = resolveCollisions({ x: 100, z: RIVER.z }, 0.45, layout.colliders);
  assert.ok(Math.abs(inRiver.z - RIVER.z) >= RIVER.w / 2, 'le fleuve repousse');
  assert.ok(AIRPORT.runway.d / 2 < Math.abs(RIVER.z) - RIVER.w / 2, 'la piste ne traverse pas le fleuve');
  assert.equal(INTERSECTIONS.length, 25);
  // Les deux axes ne sont jamais verts en même temps
  for (let t = 0; t < 80; t += 0.25) assert.ok(!(lightState('ns', t) !== 'red' && lightState('ew', t) !== 'red'), `conflit à t=${t}`);
  assert.equal(lightState('ns', 0), 'green');
  assert.equal(lightState('ns', LIGHT_CYCLE.green + 0.1), 'yellow');
});

test('appartement : location, un seul par joueur, apparition, prolongation, fin de bail', () => {
  const { join, at, store, advance, game } = setup();
  const a = join('Locataire');
  a.send('aptRent', { unit: 101 });
  assert.match(a.last('error').message, /résidence/);
  at(a, APARTMENTS.door.x, APARTMENTS.door.z);
  a.c.profile.money = 5000;
  a.send('aptRent', { unit: 101 });
  assert.equal(a.c.profile.money, 5000 - APARTMENTS.rent);
  assert.equal(a.last('apartments').apartments.find((x) => x.unit === 101).renter, 'Locataire');
  a.send('aptRent', { unit: 102 });
  assert.match(a.last('error').message, /déjà un appartement/);
  const b = join('Autre');
  at(b, APARTMENTS.door.x, APARTMENTS.door.z);
  b.send('aptRent', { unit: 101 });
  assert.match(b.last('error').message, /déjà loué/);

  // En rejoignant un serveur, on apparaît devant la résidence
  a.send('join', { room: 'europe-1' });
  const z = a.last('zone');
  assert.ok(Math.hypot(z.pos.x - APARTMENTS.door.x, z.pos.z - APARTMENTS.door.z) < 5);

  a.send('aptRenew', { country: 'BJ', unit: 101 });
  const until = store.data.apartments['BJ:apt101'].until;
  assert.equal(until - game.now(), APARTMENTS.periodMs * 2);
  advance(APARTMENTS.periodMs * 2 + 1);
  game.economyTick();
  assert.equal(store.data.apartments['BJ:apt101'], undefined, 'bail terminé : appartement libéré');
  assert.equal(APARTMENT_UNITS.length, 12);
});

test('intérieurs : entrer chez soi, isolement des joueurs, porte verrouillée pour les autres, sortir', () => {
  const { join, at } = setup();
  const a = join('Habitant');
  const b = join('Dehors');
  at(a, APARTMENTS.door.x, APARTMENTS.door.z);
  a.send('aptRent', { unit: 203 });
  a.send('enter', { kind: 'apt', unit: 203 });
  const inn = a.last('interior');
  assert.equal(inn.layout, 'apartment');
  assert.equal(b.last('pleave').sid, a.c.sid, 'disparaît pour les joueurs dehors');
  // Position hors de la pièce refusée
  a.send('state', { x: 0, y: 0, z: 0, ry: 0, a: 0 });
  assert.ok(a.last('correct'));
  // Porte verrouillée pour un autre joueur
  at(b, APARTMENTS.door.x, APARTMENTS.door.z);
  b.send('enter', { kind: 'apt', unit: 203 });
  assert.match(b.last('error').message, /pas le tien/);
  // Interrupteur intérieur
  const lay = interiorLayout('apartment');
  a.c.pos.x = lay.exit.x + 1.2;
  a.c.pos.z = lay.exit.z;
  a.send('aptDevice', { unit: 203, device: 'lights', via: 'button' });
  assert.equal(a.last('interiorDevices').devices.lights, true);
  a.send('exit');
  assert.ok(a.last('exterior'));
  assert.equal(b.last('pjoin').p.name, 'Habitant');
});

test('maison : entrer, sonnette pour les visiteurs, garage intérieur et sortie en voiture', () => {
  const { join, at, store } = setup();
  const lot = LOTS.find((l) => l.tier === 'villa');
  const chef = join('Chef');
  chef.send('familyCreate', { name: 'Les Néré' });
  store.getFamily(chef.c.profile.familyId).treasury = 1e6;
  at(chef, lot.door.x, lot.door.z);
  chef.send('houseBuy', { lot: lot.id });
  const visiteur = join('Visiteur');
  at(visiteur, lot.house.x, lot.house.frontZ - lot.side);
  visiteur.send('enter', { kind: 'house', lot: lot.id });
  assert.match(visiteur.last('error').message, /verrouillée/);
  assert.ok(chef.ws.sent.some((m) => m.t === 'toast' && /sonne à la porte/.test(m.message)));

  at(chef, lot.house.x, lot.house.frontZ - lot.side);
  chef.send('enter', { kind: 'house', lot: lot.id });
  assert.equal(chef.last('interior').layout, 'villa');
  chef.send('exit');

  // Garer puis entrer dans le garage et ressortir avec le véhicule
  at(chef, lot.garage.x, lot.garage.doorFront);
  chef.send('car', { on: true });
  chef.send('garagePark', { lot: lot.id });
  chef.send('enter', { kind: 'garage', lot: lot.id });
  assert.equal(chef.last('interior').layout, 'garage');
  chef.send('garageTake', { lot: lot.id, slot: 0 });
  const ext = chef.last('exterior');
  assert.equal(ext.car, chef.c.profile.skin.car);
  assert.equal(chef.c.veh, chef.c.profile.skin.car);
  assert.equal(chef.c.inside, null);
});

test('revenus : la maison rapporte chaque journée de jeu à la cagnotte, plafonné', () => {
  const { join, at, store, advance, game } = setup();
  const lot = LOTS.find((l) => l.tier === 'luxe');
  const chef = join('Rentier');
  chef.send('familyCreate', { name: 'Les Kapokiers' });
  const fam = store.getFamily(chef.c.profile.familyId);
  fam.treasury = 1e6;
  at(chef, lot.door.x, lot.door.z);
  chef.send('houseBuy', { lot: lot.id });
  const t0 = fam.treasury;
  advance(GAME_DAY_MS * 2 + 5);
  game.economyTick();
  assert.equal(fam.treasury, t0 + 2 * HOUSE_INCOME.luxe);
  assert.match(chef.last('toast').message, /Revenu de la maison/);
  advance(GAME_DAY_MS * 500);
  game.economyTick();
  assert.equal(fam.treasury, t0 + (2 + INCOME_MAX_DAYS) * HOUSE_INCOME.luxe, 'plafonné');
});

test('péage : paiement au passage, gratuit pour Premium, barrière fermée sans argent, péagiste payé', () => {
  const { join, at, advance, game } = setup();
  const agent = join('Péagiste');
  const conducteur = join('Conducteur');
  // Le péagiste prend son service dans la cabine du milieu
  const spot = boothSpot(0);
  at(agent, spot.x, spot.z);
  agent.send('tollShift', { on: true, booth: 0 });
  assert.match(agent.last('toast').message, /Service commencé/);
  assert.equal(conducteur.last('pinfo').p.job, 'toll');

  // Le conducteur franchit la ligne en voiture (par petits pas)
  at(conducteur, 3, TOLL.z + 8);
  conducteur.send('car', { on: true });
  for (const z of [TOLL.z + 4, TOLL.z - 1]) {
    advance(200);
    conducteur.send('state', { x: 3, y: 0, z, ry: 0, a: 3 });
  }
  assert.equal(conducteur.c.profile.money, STARTING_MONEY - TOLL.fee);
  assert.equal(conducteur.last('tollPaid').fee, TOLL.fee);
  assert.equal(agent.c.profile.money, STARTING_MONEY + Math.floor(TOLL.fee * TOLL.shareToAgent));

  // Salaire régulier du péagiste
  const before = agent.c.profile.money;
  advance(TOLL.agentPayEvery);
  game.economyTick();
  assert.equal(agent.c.profile.money, before + TOLL.agentPayAmount);
  // Quitter la cabine met fin au service
  at(agent, 50, 50);
  game.economyTick();
  assert.equal(agent.c.tollShift, null);

  // Sans argent : barrière fermée, renvoyé avant la ligne
  conducteur.c.profile.money = 10;
  conducteur.c.pos.z = TOLL.z + 8; // retour avant la barrière
  for (const z of [TOLL.z + 4, TOLL.z - 1]) {
    advance(200);
    conducteur.send('state', { x: 3, y: 0, z, ry: 0, a: 3 });
  }
  assert.match(conducteur.last('error').message, /Barrière fermée/);
  assert.ok(conducteur.c.pos.z > TOLL.z);
  assert.equal(conducteur.c.profile.money, 10);

  // Premium : gratuit
  conducteur.c.profile.premium = { until: game.now() + 1e9, firstDone: true };
  conducteur.c.pos.z = TOLL.z + 4;
  advance(200);
  conducteur.send('state', { x: 3, y: 0, z: TOLL.z - 1, ry: 0, a: 3 });
  assert.equal(conducteur.last('tollPaid').fee, 0);
});
