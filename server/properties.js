// Appartements en location, intérieurs (maisons, appartements, garages), revenus des
// maisons, péage et métier de péagiste. Méthodes ajoutées à Game + gestionnaires de messages.
import { APARTMENTS, APARTMENT_UNITS, apartmentKey, TOLL, boothSpot } from '../shared/city.js';
import { HOUSE_TIERS, LOT_BY_ID, DEFAULT_DEVICES, houseKey } from '../shared/houses.js';
import { interiorLayout, insideBounds } from '../shared/interiors.js';
import { distance2D } from '../shared/layout.js';
import { formatMoney, isPremium } from '../shared/catalog.js';
import { VEHICLE_BY_ID } from '../shared/vehicles.js';

export const GAME_DAY_MS = 24 * 60_000; // une journée de jeu = 24 min réelles
/** Revenu versé chaque journée de jeu à la cagnotte de la famille propriétaire. */
export const HOUSE_INCOME = Object.freeze({ maison: 150, villa: 400, luxe: 1000 });
export const INCOME_MAX_DAYS = 10; // plafond cumulé en l'absence de connexion
export const APT_DEVICES = ['lights', 'alarm', 'music'];
const ENTER_RADIUS = 4;

/** Interrupteur intérieur (lumières), à côté de la porte. */
export const interiorSwitch = (lay) => ({ x: lay.exit.x + 1.3, z: lay.exit.z + 0.2 });

export const PropertiesMixin = {
  // --- Accès ------------------------------------------------------------------------
  apartment(country, unit) {
    return this.store.data.apartments?.[apartmentKey(country, unit)] ?? null;
  },

  /** Le joueur peut-il utiliser cet appartement (locataire ou membre de sa famille) ? */
  canUseApartment(profile, apt) {
    if (!apt || apt.until <= this.now()) return false;
    if (apt.renterId === profile.id) return true;
    const renter = this.store.getPlayer(apt.renterId);
    return !!renter?.familyId && renter.familyId === profile.familyId;
  },

  /** Appartement loué par le joueur (ou par sa famille) dans ce pays. */
  homeApartment(profile, country) {
    for (const unit of APARTMENT_UNITS) {
      const a = this.apartment(country, unit);
      if (a && this.canUseApartment(profile, a)) return { unit, apt: a };
    }
    return null;
  },

  apartmentsView(country) {
    const now = this.now();
    return APARTMENT_UNITS.map((unit) => {
      const a = this.apartment(country, unit);
      if (!a || a.until <= now) return { unit, free: true };
      return {
        unit,
        free: false,
        renter: a.renterName,
        renterId: a.renterKey,
        until: a.until,
        devices: { ...DEFAULT_DEVICES, ...a.devices },
        garage: (a.garage ?? []).map((c) => (c ? { model: c.model, color: c.color, owner: c.ownerName } : null)),
      };
    });
  },

  broadcastApartments(country) {
    const apartments = this.apartmentsView(country);
    for (const c of this.clients) if (c.zone === country) this.send(c, 'apartments', { country, apartments });
  },

  // --- Intérieurs ----------------------------------------------------------------------
  /** Clé de groupe de visibilité : pays + intérieur éventuel. */
  areaKey(c) {
    return `${c.zone}|${c.inside?.key ?? ''}`;
  },

  /**
   * Fait entrer le client dans un intérieur.
   * @param {{key:string, kind:string, layout:string, title:string, back:{x:number,z:number,ry:number}, ref:object}} target
   */
  enterInterior(client, target) {
    const lay = interiorLayout(target.layout);
    this.broadcastZone(client, 'pleave', { sid: client.sid });
    client.inside = { ...target };
    client.veh = null;
    client.pos = { x: lay.spawn.x, y: 0, z: lay.spawn.z, ry: Math.PI };
    client.lastStateAt = this.now();
    this.send(client, 'interior', {
      key: target.key,
      kind: target.kind,
      layout: target.layout,
      title: target.title,
      ref: target.ref,
      pos: client.pos,
      players: this.zonePeers(client).map((c) => this.publicInfo(c)),
    });
    this.broadcastZone(client, 'pjoin', { p: this.publicInfo(client) });
  },

  leaveInterior(client, { withCar = null, at = null } = {}) {
    const inside = client.inside;
    if (!inside) return;
    this.broadcastZone(client, 'pleave', { sid: client.sid });
    client.inside = null;
    const back = at ?? inside.back;
    client.pos = { x: back.x, y: 0, z: back.z, ry: back.ry ?? 0 };
    client.lastStateAt = this.now();
    client.veh = withCar;
    this.send(client, 'exterior', { pos: client.pos, players: this.zonePeers(client).map((c) => this.publicInfo(c)), car: withCar });
    this.broadcastZone(client, 'pjoin', { p: this.publicInfo(client) });
  },

  // --- Péage -----------------------------------------------------------------------------
  /** Appelé à chaque position reçue : franchissement de la ligne de péage en véhicule. */
  checkToll(client, prev) {
    if (!client.veh || client.inside) return;
    const { x, z } = client.pos;
    if (Math.abs(x) > TOLL.w / 2 || (prev.z - TOLL.z) * (z - TOLL.z) > 0 || prev.z === z) return;
    const p = client.profile;
    if (isPremium(p, this.now())) return this.send(client, 'tollPaid', { fee: 0 });
    if (p.money < TOLL.fee) {
      // Barrière fermée : on renvoie le véhicule avant la ligne
      client.pos.z = TOLL.z + Math.sign(prev.z - TOLL.z || 1) * 6;
      this.send(client, 'correct', { x: client.pos.x, z: client.pos.z, stop: true });
      return this.error(client, `🚧 Barrière fermée : le péage coûte ${formatMoney(TOLL.fee)}.`);
    }
    p.money -= TOLL.fee;
    this.send(client, 'tollPaid', { fee: TOLL.fee });
    this.sendProfile(client);
    // Part reversée aux péagistes en service dans ce pays (même serveur)
    const agents = [...(client.room?.clients ?? [])].filter((c) => c.tollShift && c.zone === client.zone && c !== client);
    if (agents.length) {
      const share = Math.floor((TOLL.fee * TOLL.shareToAgent) / agents.length);
      for (const a of agents) {
        a.profile.money += share;
        a.profile.stats.earned += share;
        this.sendProfile(a);
        this.toast(a, `🎫 Péage encaissé (${p.name}) : +${formatMoney(share)}`, 'success');
      }
    }
    this.store.save();
  },

  // --- Tâches périodiques (toutes les 10 s) -------------------------------------------------
  economyTick() {
    const now = this.now();
    // Revenus des maisons -> cagnotte familiale
    for (const [key, h] of Object.entries(this.store.data.houses)) {
      const lot = LOT_BY_ID.get(Number(key.split(':')[1]));
      if (!lot) continue;
      h.lastIncomeAt ??= h.boughtAt ?? now;
      const days = Math.floor((now - h.lastIncomeAt) / GAME_DAY_MS);
      if (days < 1) continue;
      h.lastIncomeAt += days * GAME_DAY_MS;
      const fam = this.store.getFamily(h.familyId);
      if (!fam) continue;
      const amount = Math.min(days, INCOME_MAX_DAYS) * HOUSE_INCOME[lot.tier];
      fam.treasury += amount;
      this.store.logTreasury(fam, amount, `Revenu de la ${HOUSE_TIERS[lot.tier].name.toLowerCase()} n°${lot.id}`);
      for (const id of fam.members) {
        const c = this.findOnline(id);
        if (c) {
          this.sendProfile(c);
          this.toast(c, `🏠 Revenu de la maison : +${formatMoney(amount)} dans la cagnotte familiale.`, 'success');
        }
      }
      this.store.save();
    }
    // Fin des locations d'appartements
    for (const [key, a] of Object.entries(this.store.data.apartments ?? {})) {
      if (a.until > now) continue;
      delete this.store.data.apartments[key];
      const c = this.findOnline(a.renterId);
      if (c) this.toast(c, '🏢 Ta location d\'appartement est terminée. Renouvelle-la à la résidence.', 'warn');
      this.broadcastApartments(key.split(':')[0]);
      this.store.save();
    }
    // Salaire des péagistes (voitures de la ville)
    for (const c of this.clients) {
      const s = c.tollShift;
      if (!s) continue;
      if (c.veh || c.inside || distance2D(c.pos, boothSpot(s.booth)) > 3.5) {
        c.tollShift = null;
        this.toast(c, '🎫 Fin de service : tu as quitté ta cabine de péage.');
        this.broadcastZone(c, 'pinfo', { p: this.publicInfo(c) }, true);
        continue;
      }
      if (now - s.lastPay >= TOLL.agentPayEvery) {
        s.lastPay = now;
        c.profile.money += TOLL.agentPayAmount;
        c.profile.stats.earned += TOLL.agentPayAmount;
        this.sendProfile(c);
      }
    }
  },
};

/** Gestionnaires de messages (this = Game). */
export const PROPERTY_HANDLERS = {
  aptRent(client, { unit }) {
    const p = client.profile;
    if (!APARTMENT_UNITS.includes(unit) || !client.zone) return this.error(client, 'Appartement inconnu.');
    if (distance2D(client.pos, APARTMENTS.door) > 8 && !client.inside) return this.error(client, 'Va à la résidence d\'appartements.');
    if (this.homeApartment(p, client.zone)) return this.error(client, 'Tu as déjà un appartement dans ce pays.');
    const cur = this.apartment(client.zone, unit);
    if (cur && cur.until > this.now()) return this.error(client, 'Cet appartement est déjà loué.');
    if (p.money < APARTMENTS.rent) return this.error(client, `Le loyer est de ${formatMoney(APARTMENTS.rent)} pour 7 jours.`);
    p.money -= APARTMENTS.rent;
    (this.store.data.apartments ??= {})[apartmentKey(client.zone, unit)] = {
      renterId: p.id,
      renterName: p.name,
      renterKey: this.playerKey(p),
      until: this.now() + APARTMENTS.periodMs,
      devices: { ...DEFAULT_DEVICES },
      garage: [],
      events: [],
    };
    this.store.save();
    this.sendProfile(client);
    this.broadcastApartments(client.zone);
    this.toast(client, `🏢 Appartement n°${unit} loué pour 7 jours. Bienvenue chez toi !`, 'success');
  },

  aptRenew(client, { country, unit }) {
    const p = client.profile;
    const a = this.apartment(country, unit);
    if (!a || a.renterId !== p.id) return this.error(client, 'Ce n\'est pas ton appartement.');
    if (p.money < APARTMENTS.rent) return this.error(client, `Il faut ${formatMoney(APARTMENTS.rent)} pour prolonger.`);
    p.money -= APARTMENTS.rent;
    a.until = Math.max(a.until, this.now()) + APARTMENTS.periodMs;
    this.store.save();
    this.sendProfile(client);
    this.broadcastApartments(country);
    this.toast(client, `🏢 Location prolongée jusqu'au ${new Date(a.until).toLocaleDateString('fr-FR')}.`, 'success');
  },

  aptLeave(client, { country, unit }) {
    const a = this.apartment(country, unit);
    if (!a || a.renterId !== client.profile.id) return this.error(client, 'Ce n\'est pas ton appartement.');
    delete this.store.data.apartments[apartmentKey(country, unit)];
    this.store.save();
    this.broadcastApartments(country);
    this.toast(client, 'Appartement rendu.');
  },

  aptDevice(client, { country, unit, device, via }) {
    const zone = via === 'phone' ? country : client.zone;
    const a = this.apartment(zone, unit);
    if (!a || !APT_DEVICES.includes(device)) return this.error(client, 'Appareil inconnu.');
    if (!this.canUseApartment(client.profile, a)) return this.error(client, '🔒 Accès refusé.');
    if (via === 'button') {
      const lay = interiorLayout('apartment');
      if (client.inside?.key !== `apt:${apartmentKey(zone, unit)}` || distance2D(client.pos, interiorSwitch(lay)) > 2.5) return this.error(client, 'Trop loin de l\'interrupteur.');
    }
    a.devices = { ...DEFAULT_DEVICES, ...a.devices, [device]: !a.devices?.[device] };
    this.store.save();
    this.broadcastApartments(zone);
    if (client.zone !== zone) this.send(client, 'apartments', { country: zone, apartments: this.apartmentsView(zone), remote: true });
    if (client.inside) this.send(client, 'interiorDevices', { devices: a.devices });
  },

  /** Entrer : dans sa maison, son appartement, ou un garage (maison ou parking de la résidence). */
  enter(client, { kind, lot: lotId, unit }) {
    if (!client.zone || client.inside) return;
    if (client.veh) return this.error(client, 'Descends d\'abord de ton véhicule.');
    const p = client.profile;
    if (kind === 'house' || kind === 'garage') {
      const lot = LOT_BY_ID.get(lotId);
      const key = houseKey(client.zone, lotId);
      const h = lot && this.store.data.houses[key];
      if (!h) return this.error(client, 'Maison introuvable.');
      const spot = kind === 'house' ? { x: lot.house.x, z: lot.house.frontZ - lot.side * 1 } : { x: lot.garage.x, z: lot.garage.doorFront };
      if (distance2D(client.pos, spot) > ENTER_RADIUS) return this.error(client, 'Approche-toi de la porte.');
      if (h.familyId !== p.familyId) {
        this.houseEvent(h, { kind: 'doorbell', name: p.name });
        const fam = this.store.getFamily(h.familyId);
        for (const id of fam?.members ?? []) {
          const c = this.findOnline(id);
          if (c) this.toast(c, `🔔 ${p.name} sonne à la porte de votre maison n°${lot.id}.`);
        }
        return this.error(client, '🔒 La porte est verrouillée. Tu as sonné.');
      }
      const back = { x: spot.x, z: spot.z - lot.side * 1.5, ry: lot.side < 0 ? 0 : Math.PI };
      return this.enterInterior(client, {
        key: `${kind}:${key}`,
        kind,
        layout: kind === 'house' ? lot.tier : 'garage',
        title: kind === 'house' ? `${HOUSE_TIERS[lot.tier].name} n°${lot.id}` : `Garage n°${lot.id}`,
        back,
        ref: { country: client.zone, lot: lot.id },
      });
    }
    if (kind === 'apt' || kind === 'aptgarage') {
      const a = this.apartment(client.zone, unit);
      if (distance2D(client.pos, APARTMENTS.door) > ENTER_RADIUS + 2) return this.error(client, 'Approche-toi de l\'entrée de la résidence.');
      if (!this.canUseApartment(p, a)) {
        if (a) a.events = [{ at: this.now(), kind: 'doorbell', name: p.name }, ...(a.events ?? [])].slice(0, 30);
        return this.error(client, '🔒 Cet appartement n\'est pas le tien.');
      }
      return this.enterInterior(client, {
        key: `${kind === 'apt' ? 'apt' : 'aptgarage'}:${apartmentKey(client.zone, unit)}`,
        kind,
        layout: kind === 'apt' ? 'apartment' : 'garage',
        title: kind === 'apt' ? `Appartement n°${unit}` : `Parking de la résidence — place n°${unit}`,
        back: { x: APARTMENTS.door.x - 2.5, z: APARTMENTS.door.z, ry: -Math.PI / 2 },
        ref: { country: client.zone, unit },
      });
    }
    this.error(client, 'Destination inconnue.');
  },

  exit(client) {
    if (client.inside) this.leaveInterior(client);
  },

  /** Garer au parking de la résidence (1 place par appartement). */
  aptPark(client, { unit }) {
    const a = this.apartment(client.zone, unit);
    if (!this.canUseApartment(client.profile, a)) return this.error(client, 'Ce n\'est pas ton appartement.');
    if (!client.veh) return this.error(client, 'Tu dois être au volant.');
    if (distance2D(client.pos, APARTMENTS.door) > 12) return this.error(client, 'Approche-toi de la résidence.');
    if (['bus', 'truck'].includes(VEHICLE_BY_ID.get(client.veh)?.body)) return this.error(client, 'Ce véhicule est trop grand pour le parking.');
    a.garage ??= [];
    if (a.garage.filter(Boolean).length >= APARTMENTS.garageSlots) return this.error(client, 'Ta place de parking est déjà occupée.');
    a.garage = [client.borrowed?.car ?? { model: client.veh, color: client.profile.skin.carColor, ownerId: client.profile.id, ownerName: client.profile.name }];
    client.borrowed = null;
    client.veh = null;
    this.store.save();
    this.broadcastApartments(client.zone);
    this.send(client, 'carParked', {});
    this.toast(client, '🅿️ Véhicule garé au parking de la résidence.', 'success');
  },

  aptTake(client, { unit }) {
    const a = this.apartment(client.zone, unit);
    if (!this.canUseApartment(client.profile, a)) return this.error(client, 'Ce n\'est pas ton appartement.');
    if (client.inside?.key !== `aptgarage:${apartmentKey(client.zone, unit)}`) return this.error(client, 'Va dans le parking de la résidence.');
    const car = a.garage?.[0];
    if (!car) return this.error(client, 'Place vide.');
    a.garage = [];
    const own = car.ownerId === client.profile.id && car.model === client.profile.skin.car;
    client.borrowed = own ? null : { car, apt: apartmentKey(client.zone, unit) };
    this.store.save();
    this.broadcastApartments(client.zone);
    this.leaveInterior(client, { withCar: car.model, at: { x: APARTMENTS.door.x - 6, z: APARTMENTS.door.z + 6, ry: Math.PI } });
    this.send(client, 'carTaken', { model: car.model, color: car.color, borrowed: !own, owner: car.ownerName, placed: true });
  },

  /** Prise / fin de service au poste de péage. */
  tollShift(client, { on, booth }) {
    if (!on) {
      client.tollShift = null;
      this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) }, true);
      return this.toast(client, '🎫 Fin de service.');
    }
    if (!TOLL.booths.includes(booth)) return this.error(client, 'Cabine inconnue.');
    if (client.veh) return this.error(client, 'Descends de ton véhicule.');
    if (distance2D(client.pos, boothSpot(booth)) > 3) return this.error(client, 'Place-toi dans la cabine.');
    if (client.mission) HANDLERS_REF.jobQuit?.call(this, client);
    client.tollShift = { booth, lastPay: this.now(), since: this.now() };
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) }, true);
    this.toast(client, `🎫 Service commencé : ${formatMoney(TOLL.agentPayAmount)} toutes les ${TOLL.agentPayEvery / 1000} s + ${TOLL.shareToAgent * 100} % des péages des joueurs.`, 'success');
  },
};

// Référence aux gestionnaires du jeu (renseignée par game.js) pour réutiliser jobQuit.
export const HANDLERS_REF = {};
