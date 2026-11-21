import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';
import { LOTS, HOUSE_TIERS, RESIDENTIAL, lotAt, devicesFor } from '../shared/houses.js';
import { getLayout, resolveCollisions } from '../shared/layout.js';

function setup() {
  let now = 70_000_000;
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, now: () => now });
  const join = (name, home = 'BJ') => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
    const c = game.connect(ws);
    const send = (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d }));
    send('hello', { name, home });
    send('join', { room: 'afrique-1' });
    const last = (t) => [...ws.sent].reverse().find((m) => m.t === t);
    return { c, ws, send, last };
  };
  const at = (p, x, z) => Object.assign(p.c.pos, { x, z });
  /** Famille propriétaire d'une maison du type demandé. */
  const owners = (tier = 'villa') => {
    const lot = LOTS.find((l) => l.tier === tier);
    const chef = join('Chef');
    const membre = join('Membre');
    chef.send('familyCreate', { name: 'Les Iroko' });
    chef.send('familyInvite', { sid: membre.c.sid });
    membre.send('familyAccept', { familyId: chef.c.profile.familyId });
    store.getFamily(chef.c.profile.familyId).treasury = 1e6;
    at(chef, lot.door.x, lot.door.z);
    chef.send('houseBuy', { lot: lot.id });
    return { lot, chef, membre, house: store.data.houses[`BJ:${lot.id}`] };
  };
  return { store, game, join, at, owners, advance: (ms) => (now += ms) };
}

test('équipement selon la taille : caméras 2/4/6, places de garage 1/2/3, interrupteurs accessibles', () => {
  const layout = getLayout('BJ');
  const counts = { maison: [2, 1], villa: [4, 2], luxe: [6, 3] };
  for (const lot of LOTS) {
    assert.equal(lot.cameras.length, counts[lot.tier][0]);
    assert.equal(lot.garage.slots.length, counts[lot.tier][1]);
    assert.equal(lot.buttons.length, devicesFor(lot.tier).length, 'un interrupteur par appareil');
    // Les places de garage restent dans le terrain
    for (const sp of lot.garage.slots) {
      assert.ok(Math.abs(sp.x - lot.x) < RESIDENTIAL.lotW / 2 - 1, `place hors du terrain (lot ${lot.id})`);
      assert.ok(sp.z >= Math.min(lot.front, lot.back) && sp.z <= Math.max(lot.front, lot.back));
    }
    // On peut se placer devant chaque interrupteur (pas bloqué dans un mur)
    for (const b of lot.buttons) {
      const stand = { x: b.x, z: b.z - lot.side * 0.8 };
      const p = resolveCollisions({ ...stand }, 0.45, layout.colliders);
      assert.ok(Math.hypot(p.x - b.x, p.z - b.z) < 1.8, `interrupteur ${b.device} inaccessible (lot ${lot.id})`);
    }
    assert.equal(lotAt(lot.x, lot.z)?.id, lot.id);
  }
});

test('appareils : téléphone à distance pour la famille, interrupteur sur place, accès refusé aux autres', () => {
  const { owners, join, at, store } = setup();
  const { lot, chef, membre, house } = owners('luxe');
  // Par téléphone, depuis n'importe où
  at(membre, 0, 0);
  membre.send('houseDevice', { country: 'BJ', lot: lot.id, device: 'lights', via: 'phone' });
  assert.equal(house.devices.lights, true);
  assert.equal(chef.last('houses').houses[0].devices.lights, true);
  membre.send('houseDevice', { country: 'BJ', lot: lot.id, device: 'pool', via: 'phone' });
  assert.equal(house.devices.pool, true, 'appareil propre à la villa de luxe');

  // Interrupteur physique : il faut être à côté
  const b = lot.buttons.find((x) => x.device === 'music');
  chef.send('houseDevice', { lot: lot.id, device: 'music', via: 'button' });
  assert.match(chef.last('error').message, /Trop loin/);
  at(chef, b.x, b.z - lot.side * 0.8);
  chef.send('houseDevice', { lot: lot.id, device: 'music', via: 'button' });
  assert.equal(house.devices.music, true);

  // Un étranger appuie sur l'interrupteur : refusé et noté par les caméras
  const voleur = join('Voleur');
  at(voleur, b.x, b.z - lot.side * 0.8);
  voleur.send('houseDevice', { lot: lot.id, device: 'music', via: 'button' });
  assert.match(voleur.last('error').message, /Accès refusé/);
  assert.equal(house.devices.music, true);
  voleur.send('houseDevice', { country: 'BJ', lot: lot.id, device: 'alarm', via: 'phone' });
  assert.equal(house.devices.alarm, false);
  assert.ok(house.events.some((e) => e.kind === 'button' && e.name === 'Voleur'));

  // Appareil inexistant pour ce type de maison
  const maison = setup().owners('maison');
  maison.chef.send('houseDevice', { country: 'BJ', lot: maison.lot.id, device: 'pool', via: 'phone' });
  assert.match(maison.chef.last('error').message, /inconnu/);
  void store;
});

test('caméras et alarme : visiteur détecté, famille alertée, sirène pour l\'intrus', () => {
  const { owners, join, at, advance } = setup();
  const { lot, chef, membre, house } = owners('villa');
  const visiteur = join('Curieux');
  advance(1000);
  at(visiteur, lot.door.x, lot.door.z - lot.side * 2 - 6); // reste sur l'avenue, avant d'entrer
  visiteur.send('state', { x: lot.x, y: 0, z: lot.z, ry: 0, a: 1 });
  // L'anti-téléportation peut refuser un saut : on avance par petits pas
  for (let i = 0; i < 10 && !house.events?.length; i++) {
    advance(200);
    visiteur.send('state', { x: lot.door.x, y: 0, z: lot.door.z - lot.side * 4, ry: 0, a: 1 });
  }
  assert.equal(house.events[0].kind, 'visit');
  assert.ok(chef.ws.sent.some((m) => m.t === 'toast' && /Caméra : Curieux/.test(m.message)));

  membre.send('houseDevice', { country: 'BJ', lot: lot.id, device: 'alarm', via: 'phone' });
  advance(61_000);
  visiteur.send('state', { x: lot.door.x, y: 0, z: lot.door.z + lot.side * 5, ry: 0, a: 1 });
  assert.equal(house.events[0].kind, 'alarm');
  assert.ok(visiteur.last('alarm'));
  assert.ok(membre.ws.sent.some((m) => m.t === 'toast' && /ALARME/.test(m.message)));

  // Les membres de la famille ne déclenchent rien chez eux
  const before = house.events.length;
  advance(61_000);
  membre.send('state', { x: lot.door.x, y: 0, z: lot.door.z + lot.side * 5, ry: 0, a: 1 });
  assert.equal(house.events.length, before);
});

test('garage : garer, capacité, emprunt entre membres, retour automatique', () => {
  const { owners, at, store } = setup();
  const { lot, chef, membre, house } = owners('villa'); // 2 places
  const g = lot.garage;
  at(chef, g.x, g.doorFront);
  chef.send('garagePark', { lot: lot.id });
  assert.match(chef.last('error').message, /volant/);

  chef.send('car', { on: true });
  chef.send('garagePark', { lot: lot.id });
  assert.equal(house.garage[0].model, chef.c.profile.skin.car);
  assert.equal(chef.c.veh, null);
  assert.ok(chef.last('carParked'));
  // Le véhicule garé n'est plus « dans la poche »
  chef.send('car', { on: true });
  assert.match(chef.last('error').message, /garé à la maison/);

  // Le membre emprunte la voiture du chef
  at(membre, g.x, g.doorFront);
  membre.send('garageTake', { lot: lot.id, slot: 0 });
  assert.equal(membre.c.veh, chef.c.profile.skin.car);
  assert.equal(membre.last('carTaken').borrowed, true);
  assert.equal(house.garage.filter(Boolean).length, 0);
  assert.equal(house.devices.garage, true, 'la porte du garage s\'ouvre');
  // En descendant, elle retourne au garage
  membre.send('car', { on: false });
  assert.equal(house.garage.filter(Boolean)[0].ownerName, 'Chef');
  assert.equal(membre.c.veh, null);

  // Capacité : 2 places pour une villa
  membre.send('car', { on: true });
  membre.send('garagePark', { lot: lot.id });
  const tiers = setup();
  void tiers;
  const third = store.data.houses[`BJ:${lot.id}`];
  assert.equal(third.garage.filter(Boolean).length, 2);
  chef.c.profile.owned.push('car:sakura-zeta');
  chef.c.profile.skin.car = 'sakura-zeta';
  chef.send('car', { on: true });
  chef.send('garagePark', { lot: lot.id });
  assert.match(chef.last('error').message, /plein/);
  assert.equal(HOUSE_TIERS.villa.garageSlots, 2);
});

test('garage : bus refusé, étranger refusé, emprunt rendu à la déconnexion', () => {
  const { owners, at, join, game } = setup();
  const { lot, chef, membre, house } = owners('luxe');
  const g = lot.garage;
  chef.c.profile.owned.push('car:savane-bus');
  chef.c.profile.skin.car = 'savane-bus';
  at(chef, g.x, g.doorFront);
  chef.send('car', { on: true });
  chef.send('garagePark', { lot: lot.id });
  assert.match(chef.last('error').message, /trop grand/);

  const intrus = join('Intrus');
  at(intrus, g.x, g.doorFront);
  intrus.send('car', { on: true });
  intrus.send('garagePark', { lot: lot.id });
  assert.match(intrus.last('error').message, /pas à ta famille/);

  at(membre, g.x, g.doorFront);
  membre.send('car', { on: true });
  membre.send('garagePark', { lot: lot.id });
  chef.send('car', { on: false });
  chef.send('garageTake', { lot: lot.id, slot: 0 });
  assert.equal(house.garage.filter(Boolean).length, 0);
  game.disconnect(chef.c); // déconnexion pendant l'emprunt
  assert.equal(house.garage.filter(Boolean)[0].ownerName, 'Membre');
});
