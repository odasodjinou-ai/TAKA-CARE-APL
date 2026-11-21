// Logique de jeu côté serveur. Le serveur fait autorité sur tout ce qui a de la
// valeur (argent, objets, métiers, vols, familles). Le client ne fait que demander.
import { COUNTRY_BY_CODE, isCountry } from '../shared/countries.js';
import { getLayout, PLACES, AIRPORT, INTERACT_RADIUS, WORLD, distance2D } from '../shared/layout.js';
import {
  JOBS,
  ITEMS,
  validateSkin,
  flightPrice,
  FLIGHT_DURATION_MS,
  FAMILY_CREATION_COST,
  FAMILY_MAX_MEMBERS,
  formatMoney,
} from '../shared/catalog.js';

export const ROOMS = [
  { id: 'afrique-1', name: 'Afrique #1', max: 40 },
  { id: 'europe-1', name: 'Europe #1', max: 40 },
  { id: 'ameriques-1', name: 'Amériques #1', max: 40 },
  { id: 'asie-1', name: 'Asie & Océanie #1', max: 40 },
  { id: 'roleplay-1', name: 'Roleplay sérieux', max: 30 },
];

const TICK_MS = 100;
const MAX_SPEED = 50; // m/s, au-dessus de la voiture la plus rapide (marge réseau)
const NAME_RE = /^[\p{L}\p{N} _-]{2,16}$/u;
const FAMILY_RE = /^[\p{L}\p{N} '_-]{3,20}$/u;
const INVITE_TTL_MS = 120_000;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanText = (s, max) =>
  String(s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

export class Game {
  /** @param {import('./store.js').Store} store */
  constructor(store, { tickMs = TICK_MS, flightMs = FLIGHT_DURATION_MS, now = () => Date.now() } = {}) {
    this.store = store;
    this.flightMs = flightMs;
    this.now = now;
    this.nextSid = 1;
    this.clients = new Set();
    this.rooms = new Map(ROOMS.map((r) => [r.id, { ...r, clients: new Set() }]));
    this.interval = tickMs > 0 ? setInterval(() => this.tick(), tickMs) : null;
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    for (const c of this.clients) if (c.flightTimer) clearTimeout(c.flightTimer);
  }

  // --- Connexions -----------------------------------------------------------
  connect(ws) {
    const client = {
      ws,
      sid: this.nextSid++,
      profile: null,
      room: null,
      zone: null,
      pos: { x: 0, y: 0, z: 0, ry: 0 },
      anim: 0,
      veh: null,
      lastStateAt: 0,
      mission: null,
      invites: new Map(),
      lastChatAt: 0,
      bucket: { tokens: 40, at: this.now() },
      flightTimer: null,
    };
    this.clients.add(client);
    return client;
  }

  disconnect(client) {
    if (!this.clients.has(client)) return;
    this.leaveRoom(client);
    if (client.flightTimer) clearTimeout(client.flightTimer);
    this.clients.delete(client);
    this.store.save();
  }

  send(client, t, data = {}) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify({ t, ...data }));
  }

  error(client, message) {
    this.send(client, 'error', { message });
  }

  toast(client, message, kind = 'info') {
    this.send(client, 'toast', { message, kind });
  }

  /** Limitation de débit : 40 messages en rafale, 25/s en continu. */
  allow(client) {
    const now = this.now();
    const b = client.bucket;
    b.tokens = Math.min(40, b.tokens + ((now - b.at) / 1000) * 25);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  handleRaw(client, raw) {
    if (!this.allow(client)) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    const handler = HANDLERS[msg.t];
    if (!handler) return;
    if (msg.t !== 'hello' && !client.profile) return this.error(client, 'Non connecté.');
    try {
      handler.call(this, client, msg);
    } catch (err) {
      console.error(`[game] Erreur sur « ${msg.t} »:`, err);
      this.error(client, 'Erreur serveur.');
    }
  }

  // --- Vues publiques -----------------------------------------------------------
  familyName(profile) {
    return this.store.getFamily(profile.familyId)?.name ?? null;
  }

  profileView(p) {
    const fam = this.store.getFamily(p.familyId);
    return {
      id: p.id,
      name: p.name,
      money: p.money,
      home: p.home,
      country: p.country,
      skin: p.skin,
      owned: p.owned,
      stats: p.stats,
      family: fam ? this.familyView(fam) : null,
    };
  }

  familyView(fam) {
    const online = new Set([...this.clients].filter((c) => c.profile).map((c) => c.profile.id));
    return {
      id: fam.id,
      name: fam.name,
      ownerId: fam.ownerId,
      members: fam.members.map((id) => ({ id, name: this.store.getPlayer(id)?.name ?? '?', online: online.has(id) })),
    };
  }

  publicInfo(c) {
    return {
      sid: c.sid,
      name: c.profile.name,
      skin: c.profile.skin,
      family: this.familyName(c.profile),
      job: c.mission?.job ?? null,
      x: c.pos.x,
      y: c.pos.y,
      z: c.pos.z,
      ry: c.pos.ry,
      a: c.anim,
      v: c.veh,
    };
  }

  roomList() {
    return [...this.rooms.values()].map((r) => ({ id: r.id, name: r.name, count: r.clients.size, max: r.max }));
  }

  zonePeers(client) {
    if (!client.room || !client.zone) return [];
    return [...client.room.clients].filter((c) => c !== client && c.zone === client.zone);
  }

  broadcastZone(client, t, data, includeSelf = false) {
    for (const c of this.zonePeers(client)) this.send(c, t, data);
    if (includeSelf) this.send(client, t, data);
  }

  sendProfile(client) {
    this.send(client, 'profile', { profile: this.profileView(client.profile) });
  }

  findOnline(profileId) {
    for (const c of this.clients) if (c.profile?.id === profileId) return c;
    return null;
  }

  // --- Zones (pays) -----------------------------------------------------------
  enterZone(client, country, at) {
    client.zone = country;
    const layout = getLayout(country);
    const spawn = at ?? layout.spawn;
    client.pos = { x: spawn.x, y: 0, z: spawn.z, ry: 0 };
    client.lastStateAt = this.now();
    client.veh = null;
    this.send(client, 'zone', {
      country,
      pos: client.pos,
      players: this.zonePeers(client).map((c) => this.publicInfo(c)),
    });
    this.broadcastZone(client, 'pjoin', { p: this.publicInfo(client) });
  }

  leaveZone(client) {
    if (client.zone) this.broadcastZone(client, 'pleave', { sid: client.sid });
    client.zone = null;
    client.mission = null;
  }

  leaveRoom(client) {
    if (!client.room) return;
    this.leaveZone(client);
    client.room.clients.delete(client);
    client.room = null;
  }

  tick() {
    for (const room of this.rooms.values()) {
      const zones = new Map();
      for (const c of room.clients) {
        if (!c.zone) continue;
        if (!zones.has(c.zone)) zones.set(c.zone, []);
        zones.get(c.zone).push(c);
      }
      for (const members of zones.values()) {
        if (members.length < 2) continue;
        const states = members.map((c) => [c.sid, +c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2), +c.pos.ry.toFixed(3), c.anim, c.veh]);
        for (const c of members) this.send(c, 'snap', { s: states.filter((s) => s[0] !== c.sid) });
      }
    }
  }

  nearPlace(client, placeId) {
    const p = PLACES[placeId];
    return p && distance2D(client.pos, p.door) <= INTERACT_RADIUS + 2;
  }

  newMission(client, jobId) {
    const job = JOBS[jobId];
    const layout = getLayout(client.zone);
    const candidates = layout.poi.filter((p) => {
      const d = distance2D(p, client.pos);
      return d > 60 && d < 330;
    });
    const target = candidates[Math.floor(Math.random() * candidates.length)] ?? layout.poi[0];
    const dist = distance2D(target, client.pos);
    const [min, max] = job.reward;
    const reward = Math.round(min + (max - min) * clamp(dist / 330, 0, 1));
    client.mission = {
      id: `${client.sid}-${this.now()}`,
      job: jobId,
      target: { x: target.x, z: target.z },
      reward,
      startedAt: this.now(),
      minSeconds: dist / MAX_SPEED,
    };
    this.send(client, 'mission', { mission: client.mission });
  }
}

// --- Gestionnaires de messages -------------------------------------------------
const HANDLERS = {
  hello(client, { id, token, name, home }) {
    if (client.profile) return;
    let profile = id && token ? this.store.authenticate(id, token) : null;
    let newToken;
    if (!profile) {
      if (id && token && !name) return this.send(client, 'authFailed', {});
      const clean = cleanText(name ?? '', 16);
      if (!NAME_RE.test(clean)) return this.error(client, 'Pseudo invalide (2 à 16 lettres, chiffres, espaces, _ ou -).');
      if (!isCountry(home)) return this.error(client, 'Pays d\'origine invalide.');
      ({ player: profile, token: newToken } = this.store.createPlayer(clean, home));
    }
    // Une seule session active par compte
    const existing = this.findOnline(profile.id);
    if (existing) {
      this.send(existing, 'kicked', { reason: 'Connexion depuis un autre onglet.' });
      this.disconnect(existing);
      existing.ws.close();
    }
    client.profile = profile;
    this.send(client, 'welcome', { id: profile.id, token: newToken, profile: this.profileView(profile), rooms: this.roomList(), sid: client.sid });
  },

  rooms(client) {
    this.send(client, 'rooms', { rooms: this.roomList() });
  },

  join(client, { room: roomId }) {
    const room = this.rooms.get(roomId);
    if (!room) return this.error(client, 'Serveur introuvable.');
    if (room === client.room) return;
    if (room.clients.size >= room.max) return this.error(client, 'Ce serveur est plein.');
    this.leaveRoom(client);
    client.room = room;
    room.clients.add(client);
    this.send(client, 'joined', { room: { id: room.id, name: room.name } });
    this.enterZone(client, client.profile.country);
  },

  state(client, { x, y, z, ry, a }) {
    if (!client.zone || ![x, y, z, ry].every(num)) return;
    const now = this.now();
    const dt = Math.max(0.05, (now - client.lastStateAt) / 1000);
    const moved = Math.hypot(x - client.pos.x, z - client.pos.z);
    client.lastStateAt = now;
    if (moved > MAX_SPEED * dt + 6) {
      // Téléportation / triche de vitesse : on renvoie la position officielle.
      this.send(client, 'correct', { x: client.pos.x, z: client.pos.z });
      return;
    }
    client.pos.x = clamp(x, -WORLD.bound, WORLD.bound);
    client.pos.z = clamp(z, -WORLD.bound, WORLD.bound);
    client.pos.y = clamp(y, 0, 12);
    client.pos.ry = ry;
    client.anim = Number.isInteger(a) ? clamp(a, 0, 3) : 0;
  },

  chat(client, { text, ch }) {
    const now = this.now();
    if (now - client.lastChatAt < 700) return;
    const clean = cleanText(text ?? '', 200);
    if (!clean) return;
    client.lastChatAt = now;
    const msg = { from: client.profile.name, text: clean, ch: ch === 'family' ? 'family' : 'all', country: client.zone };
    if (msg.ch === 'family') {
      const fam = this.store.getFamily(client.profile.familyId);
      if (!fam) return this.error(client, 'Tu n\'as pas de famille.');
      for (const c of this.clients) if (c.profile && fam.members.includes(c.profile.id)) this.send(c, 'chat', msg);
    } else if (client.room) {
      for (const c of client.room.clients) this.send(c, 'chat', msg);
    }
  },

  skin(client, { skin }) {
    const res = validateSkin(skin, client.profile.owned);
    if (!res.ok) return this.error(client, res.error);
    client.profile.skin = res.skin;
    this.store.save();
    this.sendProfile(client);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
  },

  car(client, { on }) {
    if (!client.zone) return;
    client.veh = on ? client.profile.skin.car : null;
    if (!client.veh && client.mission && JOBS[client.mission.job].needsCar) {
      // Le taxi continue, mais il faudra remonter en voiture pour valider.
      this.toast(client, 'Remonte dans ta voiture pour terminer la course.', 'warn');
    }
  },

  buy(client, { item }) {
    const it = ITEMS[item];
    const p = client.profile;
    if (!it) return this.error(client, 'Objet inconnu.');
    const place = it.slot === 'car' ? 'cars' : 'shop';
    if (!this.nearPlace(client, place)) return this.error(client, `Va au ${PLACES[place].label.toLowerCase()} pour acheter.`);
    if (p.owned.includes(item)) return this.error(client, 'Tu possèdes déjà cet objet.');
    if (p.money < it.price) return this.error(client, 'Pas assez d\'argent.');
    p.money -= it.price;
    p.owned.push(item);
    this.store.save();
    this.sendProfile(client);
    this.toast(client, `Acheté : ${it.name} (−${formatMoney(it.price)})`, 'success');
  },

  jobStart(client, { job }) {
    if (!JOBS[job]) return this.error(client, 'Métier inconnu.');
    if (!client.zone) return;
    if (!client.mission && !this.nearPlace(client, 'jobs')) return this.error(client, 'Va à l\'agence pour l\'emploi pour prendre un métier.');
    if (JOBS[job].needsCar && !client.veh) return this.error(client, 'Il te faut une voiture (touche V) pour ce métier.');
    this.newMission(client, job);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
  },

  jobComplete(client, { id }) {
    const m = client.mission;
    if (!m || m.id !== id) return;
    const job = JOBS[m.job];
    if (distance2D(client.pos, m.target) > 10) return this.error(client, 'Tu n\'es pas encore à destination.');
    if ((this.now() - m.startedAt) / 1000 < m.minSeconds) return this.error(client, 'Mission terminée trop vite.');
    if (job.needsCar && !client.veh) return this.error(client, 'Tu dois être en voiture.');
    const p = client.profile;
    p.money += m.reward;
    p.stats.missions += 1;
    p.stats.earned += m.reward;
    this.store.save();
    this.sendProfile(client);
    this.toast(client, `${job.icon} Mission réussie : +${formatMoney(m.reward)}`, 'success');
    this.newMission(client, m.job);
  },

  jobQuit(client) {
    client.mission = null;
    this.send(client, 'mission', { mission: null });
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
  },

  flight(client, { to }) {
    const p = client.profile;
    if (!client.zone) return;
    if (!this.nearPlace(client, 'airport')) return this.error(client, 'Va au comptoir de l\'aéroport.');
    const price = flightPrice(client.zone, to);
    if (price == null) return this.error(client, 'Destination invalide.');
    if (p.money < price) return this.error(client, 'Pas assez d\'argent pour ce billet.');
    p.money -= price;
    p.country = to; // en cas de déconnexion en vol, on atterrit quand même
    p.stats.flights += 1;
    this.store.save();
    this.sendProfile(client);
    const from = client.zone;
    this.leaveZone(client);
    this.send(client, 'flight', { from, to, ms: this.flightMs });
    client.flightTimer = setTimeout(() => {
      client.flightTimer = null;
      if (!this.clients.has(client) || !client.room) return;
      this.enterZone(client, to, AIRPORT.arrival);
      this.toast(client, `${COUNTRY_BY_CODE.get(to).flag} Bienvenue : ${COUNTRY_BY_CODE.get(to).name} !`, 'success');
    }, this.flightMs);
  },

  // --- Familles -----------------------------------------------------------
  familyCreate(client, { name }) {
    const p = client.profile;
    const clean = cleanText(name ?? '', 20);
    if (p.familyId) return this.error(client, 'Tu fais déjà partie d\'une famille.');
    if (!FAMILY_RE.test(clean)) return this.error(client, 'Nom de famille invalide (3 à 20 caractères).');
    if (this.store.familyNameTaken(clean)) return this.error(client, 'Ce nom de famille est déjà pris.');
    if (p.money < FAMILY_CREATION_COST) return this.error(client, `Créer une famille coûte ${formatMoney(FAMILY_CREATION_COST)}.`);
    p.money -= FAMILY_CREATION_COST;
    this.store.createFamily(clean, p);
    this.sendProfile(client);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
    this.toast(client, `Famille « ${clean} » créée !`, 'success');
  },

  familyInvite(client, { sid }) {
    const fam = this.store.getFamily(client.profile.familyId);
    if (!fam) return this.error(client, 'Crée d\'abord une famille.');
    const target = [...(client.room?.clients ?? [])].find((c) => c.sid === sid);
    if (!target || target === client) return this.error(client, 'Joueur introuvable sur ce serveur.');
    if (target.profile.familyId) return this.error(client, `${target.profile.name} a déjà une famille.`);
    if (fam.members.length >= FAMILY_MAX_MEMBERS) return this.error(client, 'Ta famille est complète.');
    target.invites.set(fam.id, this.now() + INVITE_TTL_MS);
    this.send(target, 'familyInvite', { familyId: fam.id, name: fam.name, from: client.profile.name });
    this.toast(client, `Invitation envoyée à ${target.profile.name}.`);
  },

  familyAccept(client, { familyId }) {
    const exp = client.invites.get(familyId);
    client.invites.delete(familyId);
    if (!exp || exp < this.now()) return this.error(client, 'Invitation expirée.');
    if (client.profile.familyId) return this.error(client, 'Quitte d\'abord ta famille actuelle.');
    const fam = this.store.getFamily(familyId);
    if (!fam) return this.error(client, 'Cette famille n\'existe plus.');
    if (fam.members.length >= FAMILY_MAX_MEMBERS) return this.error(client, 'Cette famille est complète.');
    this.store.addToFamily(fam, client.profile);
    for (const id of fam.members) {
      const c = this.findOnline(id);
      if (c) {
        this.sendProfile(c);
        if (c !== client) this.toast(c, `${client.profile.name} a rejoint la famille !`, 'success');
      }
    }
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
  },

  familyLeave(client) {
    if (!client.profile.familyId) return;
    const fam = this.store.removeFromFamily(client.profile);
    this.sendProfile(client);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
    for (const id of fam?.members ?? []) {
      const c = this.findOnline(id);
      if (c) this.sendProfile(c);
    }
  },

  familyGift(client, { to, amount }) {
    const p = client.profile;
    const fam = this.store.getFamily(p.familyId);
    if (!fam || !fam.members.includes(to) || to === p.id) return this.error(client, 'Destinataire invalide.');
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return this.error(client, 'Montant invalide.');
    if (p.money < amount) return this.error(client, 'Pas assez d\'argent.');
    const dest = this.store.getPlayer(to);
    p.money -= amount;
    dest.money += amount;
    this.store.save();
    this.sendProfile(client);
    this.toast(client, `Tu as envoyé ${formatMoney(amount)} à ${dest.name}.`, 'success');
    const dc = this.findOnline(to);
    if (dc) {
      this.sendProfile(dc);
      this.toast(dc, `${p.name} t'a envoyé ${formatMoney(amount)} 💸`, 'success');
    }
  },
};
