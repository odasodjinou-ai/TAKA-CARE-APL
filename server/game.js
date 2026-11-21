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
  formatVida,
  formatPrice,
  isPremium,
  premiumPrice,
  PREMIUM,
  EXCHANGE,
} from '../shared/catalog.js';
import { VEHICLE_BY_ID, MAX_VEHICLE_SPEED } from '../shared/vehicles.js';
import { UserError } from './payments/service.js';
import { normalizePhone, maskPhone } from './auth/otp.js';
import { moderate, isOffensiveName, addStrike, mutedUntil, SANCTIONS } from './moderation.js';
import crypto from 'node:crypto';
import { ADMIN_HANDLERS, AdminMixin, parseAdminPhones, isBanned } from './admin.js';
import {
  HOUSE_TIERS, LOT_BY_ID, MAX_HOUSES_PER_FAMILY, SELL_REFUND, HOME_COOLDOWN_MS, DEFAULT_HOUSE_COLORS, DEFAULT_DEVICES, houseKey,
  devicesFor, lotAt, BUTTON_RADIUS, GARAGE_RADIUS, NO_GARAGE_BODIES,
} from '../shared/houses.js';

export const ROOMS = [
  { id: 'afrique-1', name: 'Afrique #1', max: 40 },
  { id: 'europe-1', name: 'Europe #1', max: 40 },
  { id: 'ameriques-1', name: 'Amériques #1', max: 40 },
  { id: 'asie-1', name: 'Asie & Océanie #1', max: 40 },
  { id: 'roleplay-1', name: 'Roleplay sérieux', max: 30 },
];

const TICK_MS = 100;
const MAX_SPEED = MAX_VEHICLE_SPEED + 8; // m/s, au-dessus du véhicule le plus rapide (marge réseau)
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
  constructor(store, { tickMs = TICK_MS, flightMs = FLIGHT_DURATION_MS, now = () => Date.now(), payments = null, otp = null, adminPhones = '' } = {}) {
    this.store = store;
    this.payments = payments;
    this.otp = otp;
    this.adminPhones = adminPhones instanceof Set ? adminPhones : parseAdminPhones(adminPhones);
    this.chatLog = []; // 500 derniers messages (pour les signalements)
    this.nextMsgId = 1;
    this.keySecret = crypto.randomBytes(16);
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
  connect(ws, { ip = 'inconnue' } = {}) {
    const client = {
      ws,
      ip,
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
    if (client.borrowed) HANDLERS.car.call(this, client, { on: false }); // l'emprunt retourne au garage
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
    if (!PUBLIC_MESSAGES.has(msg.t) && !client.profile) return this.error(client, 'Non connecté.');
    const fail = (err) => {
      if (err instanceof UserError) return this.error(client, err.message);
      console.error(`[game] Erreur sur « ${msg.t} »:`, err);
      this.error(client, 'Erreur serveur.');
    };
    try {
      const r = handler.call(this, client, msg);
      if (r && typeof r.catch === 'function') r.catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  /** Identifiant public stable d'un joueur (pour bloquer/signaler) sans exposer son id de compte. */
  playerKey(profile) {
    return crypto.createHmac('sha256', this.keySecret).update(profile.id).digest('base64url').slice(0, 12);
  }

  /** Ouvre la session d'un joueur authentifié (une seule session active par compte). */
  login(client, profile, newToken) {
    const ban = isBanned(profile, this.now());
    if (ban) {
      this.send(client, 'banned', { reason: ban.reason, until: ban.until });
      return client.ws.close?.();
    }
    const existing = this.findOnline(profile.id);
    if (existing && existing !== client) {
      this.send(existing, 'kicked', { reason: 'Connexion depuis un autre appareil ou onglet.' });
      this.disconnect(existing);
      existing.ws.close();
    }
    client.profile = profile;
    this.send(client, 'welcome', { id: profile.id, token: newToken, profile: this.profileView(profile), rooms: this.roomList(), sid: client.sid, sms: !!this.otp?.available, key: this.playerKey(profile) });
    if (this.isAdminProfile(profile)) this.send(client, 'adminBadge', { openCount: (this.store.data.reports ?? []).filter((r) => r.status === 'open').length });
  }

  /** Appelé par le service de paiement quand une commande est confirmée. */
  notifyPaid(order) {
    const c = this.findOnline(order.playerId);
    if (!c) return;
    this.sendProfile(c);
    this.send(c, 'paid', { order: this.orderView(order) });
    this.toast(c, `💎 Paiement reçu : +${formatVida(order.vida)}. Merci !`, 'success');
  }

  orderView(o) {
    return {
      id: o.id,
      vida: o.vida,
      xof: o.xof,
      method: o.method,
      status: o.status,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      receiptNo: o.receiptNo,
      receiptUrl: `/receipt/${o.id}?k=${o.receiptKey}`,
    };
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
      phone: maskPhone(p.phone),
      devices: p.tokenHashes.length,
      isAdmin: this.isAdminProfile(p),
      money: p.money,
      vida: p.vida,
      vidaLog: p.vidaLog.slice(0, 20),
      premium: { active: isPremium(p, this.now()), until: p.premium.until, nextPrice: premiumPrice(p) },
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
      treasury: fam.treasury ?? 0,
      treasuryLog: (fam.treasuryLog ?? []).slice(0, 15),
      houses: this.store.housesOf(fam.id).map((h) => ({ country: h.country, lot: h.lot, tier: LOT_BY_ID.get(h.lot)?.tier })),
      members: fam.members.map((id) => ({ id, name: this.store.getPlayer(id)?.name ?? '?', online: online.has(id) })),
    };
  }

  publicInfo(c) {
    return {
      sid: c.sid,
      name: c.profile.name,
      skin: c.profile.skin,
      family: this.familyName(c.profile),
      premium: isPremium(c.profile, this.now()),
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
    const home = at ? null : this.homeLot(client.profile, country);
    const spawn = at ?? (home ? { x: home.door.x, z: home.door.z - home.side * 3 } : layout.spawn);
    client.pos = { x: spawn.x, y: 0, z: spawn.z, ry: 0 };
    client.lastStateAt = this.now();
    client.veh = null;
    this.send(client, 'zone', {
      country,
      pos: client.pos,
      players: this.zonePeers(client).map((c) => this.publicInfo(c)),
    });
    this.broadcastZone(client, 'pjoin', { p: this.publicInfo(client) });
    this.send(client, 'houses', { country, houses: this.housesView(country) });
  }

  // --- Maisons ---------------------------------------------------------------------
  housesView(country) {
    return this.store.housesIn(country).map((h) => ({
      lot: h.lot,
      family: this.store.getFamily(h.familyId)?.name ?? '?',
      familyId: h.familyId,
      wall: h.wall,
      roof: h.roof,
      devices: { ...DEFAULT_DEVICES, ...h.devices },
      garage: (h.garage ?? []).map((c) => (c ? { model: c.model, color: c.color, owner: c.ownerName } : null)),
    }));
  }

  /** Maison de la famille du joueur sur ce terrain (pays courant), ou null. */
  familyHouse(client, lotId, country = client.zone) {
    const h = this.store.data.houses[houseKey(country, lotId)];
    return h && client.profile.familyId && h.familyId === client.profile.familyId ? h : null;
  }

  /** Le véhicule personnel du joueur est-il garé dans un garage familial ? */
  parkedCar(profile) {
    if (!profile.familyId) return false;
    return this.store.housesOf(profile.familyId).some((h) => (h.garage ?? []).some((c) => c && c.ownerId === profile.id && c.model === profile.skin.car));
  }

  /** Note un événement (visite, alarme…) dans le journal de la maison. */
  houseEvent(house, event) {
    house.events = [{ at: this.now(), ...event }, ...(house.events ?? [])].slice(0, 30);
  }

  /** Détection des visiteurs par les caméras et l'alarme (appelée à chaque position reçue). */
  checkIntrusion(client) {
    const lot = lotAt(client.pos.x, client.pos.z);
    if (!lot) return;
    const h = this.store.data.houses[houseKey(client.zone, lot.id)];
    if (!h || h.familyId === client.profile.familyId) return;
    const key = `${client.zone}:${lot.id}:${client.profile.id}`;
    const now = this.now();
    this.intrusions ??= new Map();
    if (now - (this.intrusions.get(key) ?? 0) < 60_000) return;
    this.intrusions.set(key, now);
    const alarm = !!h.devices?.alarm;
    this.houseEvent(h, { kind: alarm ? 'alarm' : 'visit', name: client.profile.name });
    const fam = this.store.getFamily(h.familyId);
    for (const id of fam?.members ?? []) {
      const c = this.findOnline(id);
      if (c) this.toast(c, alarm ? `🚨 ALARME : ${client.profile.name} est entré chez vous (maison n°${lot.id}) !` : `📷 Caméra : ${client.profile.name} est devant votre maison n°${lot.id}.`, alarm ? 'error' : 'info');
    }
    if (alarm) this.send(client, 'alarm', { lot: lot.id, family: fam?.name });
    this.store.save();
  }

  /** Terrain de la maison familiale du joueur dans ce pays (ou null). */
  homeLot(profile, country) {
    if (!profile?.familyId) return null;
    const h = this.store.housesOf(profile.familyId).find((x) => x.country === country);
    return h ? LOT_BY_ID.get(h.lot) : null;
  }

  /** Prévient tous les joueurs présents dans ce pays (tous serveurs confondus). */
  broadcastHouses(country) {
    const houses = this.housesView(country);
    for (const c of this.clients) if (c.zone === country) this.send(c, 'houses', { country, houses });
  }

  /** Met à jour le profil de tous les membres connectés (cagnotte, maisons). */
  refreshFamily(fam) {
    for (const id of fam.members) {
      const c = this.findOnline(id);
      if (c) this.sendProfile(c);
    }
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
    const base = min + (max - min) * clamp(dist / 330, 0, 1);
    const reward = Math.round(base * (isPremium(client.profile, this.now()) ? 1 + PREMIUM.jobBonus : 1));
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

Object.assign(Game.prototype, AdminMixin);

// --- Gestionnaires de messages -------------------------------------------------
const PUBLIC_MESSAGES = new Set(['hello', 'otpRequest', 'otpVerify', 'smsInfo']);
const HANDLERS = {
  hello(client, { id, token, name, home, phoneTicket }) {
    if (client.profile) return;
    let profile = id && token ? this.store.authenticate(id, token) : null;
    let newToken;
    if (!profile) {
      if (id && token && !name) return this.send(client, 'authFailed', {});
      let phone = null;
      if (phoneTicket) {
        phone = this.otp?.consumeTicket(phoneTicket);
        if (!phone) return this.error(client, 'Vérification expirée. Recommence avec ton numéro.');
        const owner = this.store.findByPhone(phone);
        if (owner) return this.login(client, owner, this.store.addToken(owner)); // compte créé entre-temps
      }
      const clean = cleanText(name ?? '', 16);
      if (!NAME_RE.test(clean)) return this.error(client, 'Pseudo invalide (2 à 16 lettres, chiffres, espaces, _ ou -).');
      if (isOffensiveName(clean)) return this.error(client, 'Ce pseudo n\'est pas autorisé. Choisis un pseudo respectueux.');
      if (!isCountry(home)) return this.error(client, 'Pays d\'origine invalide.');
      ({ player: profile, token: newToken } = this.store.createPlayer(clean, home, phone));
    }
    this.login(client, profile, newToken);
  },

  // --- Connexion par téléphone (code SMS) ------------------------------------------------
  async otpRequest(client, { phone: raw }) {
    const phone = normalizePhone(raw);
    if (!phone) return this.error(client, 'Numéro invalide. Écris-le avec l\'indicatif, ex. +229 01 23 45 67 89.');
    if (!this.otp) return this.error(client, 'Connexion par SMS indisponible.');
    if (client.profile) {
      const owner = this.store.findByPhone(phone);
      if (owner && owner.id !== client.profile.id) return this.error(client, 'Ce numéro est déjà lié à un autre compte. Connecte-toi avec lui.');
    }
    const res = await this.otp.request(phone, client.ip);
    this.send(client, 'otpSent', { phone: maskPhone(phone), cooldownMs: res.cooldownMs, devCode: res.devCode });
  },

  otpVerify(client, { phone: raw, code }) {
    const phone = normalizePhone(raw);
    if (!phone || !this.otp) return this.error(client, 'Numéro invalide.');
    this.otp.verify(phone, typeof code === 'string' ? code.trim() : '');
    const owner = this.store.findByPhone(phone);
    if (client.profile) {
      // Lier le numéro au compte actuel (compte invité -> compte sécurisé)
      if (owner && owner.id !== client.profile.id) return this.error(client, 'Ce numéro est déjà lié à un autre compte.');
      client.profile.phone = phone;
      this.store.save();
      this.sendProfile(client);
      this.send(client, 'phoneLinked', {});
      return this.toast(client, `📱 Numéro ${maskPhone(phone)} lié : ton compte est sécurisé.`, 'success');
    }
    if (owner) return this.login(client, owner, this.store.addToken(owner));
    // Nouveau numéro : le joueur choisit son pseudo et son pays, puis envoie hello avec ce ticket
    this.send(client, 'otpNeedProfile', { ticket: this.otp.issueTicket(phone) });
  },

  logout(client, { token, everywhere }) {
    if (everywhere) this.store.keepOnlyToken(client.profile, '');
    else this.store.removeToken(client.profile, token);
    this.send(client, 'loggedOut', {});
    this.disconnect(client);
    client.ws.close();
  },

  logoutOthers(client, { token }) {
    this.store.keepOnlyToken(client.profile, token);
    for (const c of this.clients) if (c !== client && c.profile?.id === client.profile.id) c.ws.close();
    this.sendProfile(client);
    this.toast(client, 'Tes autres appareils ont été déconnectés.', 'success');
  },

  smsInfo(client) {
    this.send(client, 'smsInfo', { available: !!this.otp?.available });
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
    this.checkIntrusion(client);
  },

  chat(client, { text, ch }) {
    const now = this.now();
    if (now - client.lastChatAt < 700) return;
    const raw = cleanText(text ?? '', 200);
    if (!raw) return;
    const p = client.profile;
    const muted = mutedUntil(p, now);
    if (muted) return this.error(client, `🔇 Tu ne peux pas écrire avant ${new Date(muted).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (propos insultants).`);
    client.lastChatAt = now;
    const mod = moderate(raw);
    const fam = ch === 'family' ? this.store.getFamily(p.familyId) : null;
    if (ch === 'family' && !fam) return this.error(client, 'Tu n\'as pas de famille.');
    const msg = { id: this.nextMsgId++, from: p.name, key: this.playerKey(p), text: mod.clean, ch: fam ? 'family' : 'all', country: client.zone, premium: isPremium(p, now), filtered: mod.severity > 0 };
    this.chatLog.push({ id: msg.id, playerId: p.id, name: p.name, text: raw, at: now, room: client.room?.id });
    if (this.chatLog.length > 500) this.chatLog.shift();
    if (fam) {
      for (const c of this.clients) if (c.profile && fam.members.includes(c.profile.id)) this.send(c, 'chat', msg);
    } else if (client.room) {
      for (const c of client.room.clients) this.send(c, 'chat', msg);
    }
    if (mod.severity > 0) {
      const res = addStrike(p, mod.severity, now);
      this.store.save();
      if (res.mutedUntil) {
        const min = Math.round((res.mutedUntil - now) / 60_000);
        this.toast(client, `🔇 Propos insultants répétés : silence pendant ${min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`}.`, 'error');
        if (client.room) for (const c of client.room.clients) if (c !== client) this.send(c, 'chat', { id: this.nextMsgId++, sys: true, text: `${p.name} a été réduit au silence pour insultes.` });
      } else {
        this.toast(client, `⚠️ Message filtré : reste respectueux (avertissement ${res.points}/${SANCTIONS.threshold}).`, 'warn');
      }
    }
  },

  report(client, { id, reason }) {
    const entry = this.chatLog.find((m) => m.id === id);
    if (!entry || entry.playerId === client.profile.id) return;
    const reports = (this.store.data.reports ??= []);
    if (reports.some((r) => r.msgId === id && r.by === client.profile.id)) return this.toast(client, 'Déjà signalé, merci.');
    if (reports.filter((r) => r.by === client.profile.id && this.now() - r.at < 3_600_000).length >= 10) return this.error(client, 'Trop de signalements cette heure-ci.');
    reports.push({ id: crypto.randomUUID(), msgId: id, room: entry.room, by: client.profile.id, byName: client.profile.name, target: entry.playerId, targetName: entry.name, text: entry.text, reason: cleanText(reason ?? '', 100), at: this.now(), status: 'open' });
    if (reports.length > 5000) reports.splice(0, reports.length - 5000);
    this.store.save();
    console.warn(`[modération] Signalement de ${client.profile.name} contre ${entry.name} : « ${entry.text} »`);
    this.notifyAdmins({ targetName: entry.name });
    // Plusieurs signalements distincts sur un même joueur en peu de temps : avertissement automatique
    const recent = new Set(reports.filter((r) => r.target === entry.playerId && this.now() - r.at < SANCTIONS.windowMs).map((r) => r.by));
    if (recent.size >= 3) {
      const target = this.store.getPlayer(entry.playerId);
      const res = addStrike(target, 1, this.now());
      const tc = this.findOnline(entry.playerId);
      if (tc) this.toast(tc, res.mutedUntil ? '🔇 Plusieurs joueurs t\'ont signalé : tu es réduit au silence.' : '⚠️ Plusieurs joueurs t\'ont signalé. Reste respectueux.', 'warn');
    }
    this.toast(client, '🚩 Signalement envoyé. Merci de garder Terra Vida agréable !', 'success');
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
    if (!on && client.borrowed) {
      // Véhicule emprunté au garage familial : il y retourne automatiquement
      const b = client.borrowed;
      client.borrowed = null;
      const h = this.store.data.houses[b.house];
      const free = h?.garage?.findIndex((x) => !x) ?? -1;
      if (h && free !== -1) h.garage[free] = b.car;
      else if (h && h.garage.length < HOUSE_TIERS[LOT_BY_ID.get(b.lot).tier].garageSlots) h.garage.push(b.car);
      client.veh = null;
      this.store.save();
      this.broadcastHouses(b.house.split(':')[0]);
      return this.toast(client, '🚗 Le véhicule emprunté est retourné au garage familial.');
    }
    if (on && this.parkedCar(client.profile)) return this.error(client, '🚗 Ton véhicule est garé à la maison : va le chercher au garage.');
    if (on && client.borrowed) return;
    const v = VEHICLE_BY_ID.get(client.profile.skin.car);
    if (on && v?.premiumOnly && !isPremium(client.profile, this.now())) {
      return this.error(client, `${v.name} est réservé aux membres Premium ⭐.`);
    }
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
    if (it.premiumOnly && !isPremium(p, this.now())) return this.error(client, 'Réservé aux membres Premium ⭐.');
    if (it.currency === 'vida') {
      if (p.vida < it.price) return this.error(client, 'Pas assez de Vida. Recharge dans 💎 Vida.');
      p.vida -= it.price;
      this.store.logVida(p, -it.price, `Achat : ${it.name}`);
    } else {
      if (p.money < it.price) return this.error(client, 'Pas assez de Cauris.');
      p.money -= it.price;
    }
    p.owned.push(item);
    this.store.save();
    this.sendProfile(client);
    this.toast(client, `Acheté : ${it.name} (−${formatPrice(it.price, it.currency)})`, 'success');
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
    const price = flightPrice(client.zone, to, isPremium(p, this.now()));
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

  // --- Vida, paiements, Premium ---------------------------------------------------------
  payInfo(client) {
    this.send(client, 'payInfo', { methods: this.payments?.methods() ?? [] });
  },

  async payCreate(client, { pack, method }) {
    if (!this.payments) return this.error(client, 'Paiements indisponibles.');
    if (!client.profile.phone) return this.send(client, 'phoneRequired', { reason: 'Pour acheter des Vida, lie d\'abord ton numéro de téléphone : tes achats seront récupérables sur tous tes appareils.' });
    const { order, redirectUrl } = await this.payments.createOrder(client.profile, pack, method);
    this.send(client, 'payCreated', { order: this.orderView(order), redirectUrl });
  },

  async payCheck(client, { id }) {
    const order = this.store.getOrder(id);
    if (!order || order.playerId !== client.profile.id) return;
    const updated = await this.payments.confirm(id);
    this.send(client, 'payStatus', { order: this.orderView(updated) });
  },

  receipts(client) {
    const orders = this.store.ordersOf(client.profile.id).slice(0, 30).map((o) => this.orderView(o));
    this.send(client, 'receipts', { orders });
  },

  premiumBuy(client) {
    const p = client.profile;
    const price = premiumPrice(p);
    if (p.vida < price) return this.error(client, `Premium coûte ${formatVida(price)}. Recharge tes Vida.`);
    const now = this.now();
    p.vida -= price;
    p.premium.until = Math.max(now, p.premium.until) + PREMIUM.days * 86_400_000;
    p.premium.firstDone = true;
    this.store.logVida(p, -price, `Premium ⭐ ${PREMIUM.days} jours`);
    this.store.save();
    this.sendProfile(client);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
    this.toast(client, `⭐ Premium actif jusqu'au ${new Date(p.premium.until).toLocaleDateString('fr-FR')} !`, 'success');
  },

  exchange(client, { id }) {
    const ex = EXCHANGE.find((e) => e.id === id);
    const p = client.profile;
    if (!ex) return this.error(client, 'Offre inconnue.');
    if (p.vida < ex.vida) return this.error(client, 'Pas assez de Vida.');
    p.vida -= ex.vida;
    p.money += ex.cauris;
    this.store.logVida(p, -ex.vida, `Change : +${formatMoney(ex.cauris)}`);
    this.store.save();
    this.sendProfile(client);
    this.toast(client, `Change effectué : +${formatMoney(ex.cauris)}`, 'success');
  },

  // --- Familles -----------------------------------------------------------
  familyCreate(client, { name }) {
    const p = client.profile;
    const clean = cleanText(name ?? '', 20);
    if (p.familyId) return this.error(client, 'Tu fais déjà partie d\'une famille.');
    if (!FAMILY_RE.test(clean)) return this.error(client, 'Nom de famille invalide (3 à 20 caractères).');
    if (isOffensiveName(clean)) return this.error(client, 'Ce nom de famille n\'est pas autorisé.');
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
    // Ses véhicules garés chez la famille lui reviennent
    for (const h of this.store.housesOf(client.profile.familyId)) {
      const rec = this.store.data.houses[h.key];
      rec.garage = (rec.garage ?? []).map((c) => (c && c.ownerId === client.profile.id ? null : c));
      this.broadcastHouses(h.country);
    }
    const fam = this.store.removeFromFamily(client.profile);
    this.sendProfile(client);
    this.broadcastZone(client, 'pinfo', { p: this.publicInfo(client) });
    for (const id of fam?.members ?? []) {
      const c = this.findOnline(id);
      if (c) this.sendProfile(c);
    }
  },

  // --- Cagnotte familiale et maisons ---------------------------------------------------
  familyDeposit(client, { amount }) {
    const p = client.profile;
    const fam = this.store.getFamily(p.familyId);
    if (!fam) return this.error(client, 'Tu n\'as pas de famille.');
    if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) return this.error(client, 'Montant invalide.');
    if (p.money < amount) return this.error(client, 'Pas assez de Cauris.');
    p.money -= amount;
    fam.treasury += amount;
    this.store.logTreasury(fam, amount, `Dépôt de ${p.name}`);
    this.store.save();
    this.refreshFamily(fam);
    this.toast(client, `🏦 ${formatMoney(amount)} déposés dans la cagnotte familiale.`, 'success');
  },

  familyWithdraw(client, { amount }) {
    const p = client.profile;
    const fam = this.store.getFamily(p.familyId);
    if (!fam || fam.ownerId !== p.id) return this.error(client, 'Seul le chef de famille peut retirer de la cagnotte.');
    if (!Number.isInteger(amount) || amount < 1 || amount > fam.treasury) return this.error(client, 'Montant invalide.');
    fam.treasury -= amount;
    p.money += amount;
    this.store.logTreasury(fam, -amount, `Retrait par ${p.name}`);
    this.store.save();
    this.refreshFamily(fam);
  },

  houseBuy(client, { lot: lotId }) {
    const p = client.profile;
    const lot = LOT_BY_ID.get(lotId);
    const fam = this.store.getFamily(p.familyId);
    if (!lot || !client.zone) return this.error(client, 'Terrain inconnu.');
    if (!fam) return this.error(client, 'Il faut une famille pour acheter une maison.');
    if (fam.ownerId !== p.id) return this.error(client, 'Seul le chef de famille peut acheter une maison.');
    if (distance2D(client.pos, lot.door) > INTERACT_RADIUS + 2) return this.error(client, 'Approche-toi du portail de la maison.');
    const key = houseKey(client.zone, lot.id);
    if (this.store.data.houses[key]) return this.error(client, 'Cette maison est déjà vendue.');
    if (this.store.housesOf(fam.id).length >= MAX_HOUSES_PER_FAMILY) return this.error(client, `Une famille peut avoir au plus ${MAX_HOUSES_PER_FAMILY} maisons.`);
    const price = HOUSE_TIERS[lot.tier].price;
    if (fam.treasury < price) return this.error(client, `Il manque ${formatMoney(price - fam.treasury)} dans la cagnotte familiale.`);
    fam.treasury -= price;
    this.store.logTreasury(fam, -price, `Achat : ${HOUSE_TIERS[lot.tier].name} n°${lot.id} (${client.zone})`);
    this.store.data.houses[key] = { familyId: fam.id, boughtAt: this.now(), price, ...DEFAULT_HOUSE_COLORS, devices: { ...DEFAULT_DEVICES }, garage: [], events: [] };
    this.store.save();
    this.broadcastHouses(client.zone);
    this.refreshFamily(fam);
    for (const id of fam.members) {
      const c = this.findOnline(id);
      if (c) this.toast(c, `🏠 La famille « ${fam.name} » a acheté une ${HOUSE_TIERS[lot.tier].name.toLowerCase()} !`, 'success');
    }
  },

  houseSell(client, { lot: lotId }) {
    const p = client.profile;
    const fam = this.store.getFamily(p.familyId);
    const key = houseKey(client.zone, lotId);
    const h = this.store.data.houses[key];
    if (!fam || !h || h.familyId !== fam.id) return this.error(client, 'Cette maison n\'est pas à ta famille.');
    if (fam.ownerId !== p.id) return this.error(client, 'Seul le chef de famille peut vendre.');
    const refund = Math.floor(h.price * SELL_REFUND);
    delete this.store.data.houses[key];
    fam.treasury += refund;
    this.store.logTreasury(fam, refund, `Vente de la maison n°${lotId} (${client.zone})`);
    this.store.save();
    this.broadcastHouses(client.zone);
    this.refreshFamily(fam);
    this.toast(client, `Maison vendue : +${formatMoney(refund)} dans la cagnotte.`, 'success');
  },

  houseColors(client, { lot: lotId, wall, roof }) {
    const p = client.profile;
    const h = this.store.data.houses[houseKey(client.zone, lotId)];
    if (!h || h.familyId !== p.familyId) return this.error(client, 'Cette maison n\'est pas à ta famille.');
    if (![wall, roof].every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) return this.error(client, 'Couleur invalide.');
    h.wall = wall.toLowerCase();
    h.roof = roof.toLowerCase();
    this.store.save();
    this.broadcastHouses(client.zone);
  },

  /** Appareil connecté. via 'phone' : à distance (n'importe où) ; via 'button' : interrupteur sur place. */
  houseDevice(client, { country, lot: lotId, device, via }) {
    const zone = via === 'phone' ? country : client.zone;
    const lot = LOT_BY_ID.get(lotId);
    const h = lot && this.store.data.houses[houseKey(zone, lotId)];
    if (!h) return this.error(client, 'Maison introuvable.');
    if (!devicesFor(lot.tier).some((d) => d.id === device)) return this.error(client, 'Appareil inconnu.');
    if (via === 'button') {
      const b = lot.buttons.find((x) => x.device === device);
      if (distance2D(client.pos, b) > BUTTON_RADIUS + 1) return this.error(client, 'Trop loin de l\'interrupteur.');
    }
    if (h.familyId !== client.profile.familyId) {
      if (via === 'button') this.houseEvent(h, { kind: 'button', name: client.profile.name });
      return this.error(client, '🔒 Accès refusé : cet appareil appartient à une autre famille.');
    }
    h.devices = { ...DEFAULT_DEVICES, ...h.devices, [device]: !h.devices?.[device] };
    this.store.save();
    this.broadcastHouses(zone);
    if (via === 'phone' && client.zone !== zone) this.send(client, 'houses', { country: zone, houses: this.housesView(zone), remote: true });
  },

  /** État des maisons d'un pays (pour piloter à distance une maison située dans un autre pays). */
  housesFor(client, { country }) {
    if (!isCountry(country)) return;
    this.send(client, 'houses', { country, houses: this.housesView(country), remote: country !== client.zone });
  },

  /** Journal des caméras / alarme d'une maison de la famille. */
  houseEvents(client, { country, lot: lotId }) {
    const h = this.familyHouse(client, lotId, country);
    if (!h) return this.error(client, 'Maison introuvable.');
    this.send(client, 'houseEvents', { country, lot: lotId, events: h.events ?? [] });
  },

  /** Gare le véhicule conduit dans le garage familial. */
  garagePark(client, { lot: lotId }) {
    const lot = LOT_BY_ID.get(lotId);
    const h = lot && this.familyHouse(client, lotId);
    if (!h) return this.error(client, 'Ce garage n\'est pas à ta famille.');
    if (!client.veh) return this.error(client, 'Tu dois être au volant pour garer un véhicule.');
    if (distance2D(client.pos, { x: lot.garage.x, z: lot.garage.doorFront }) > GARAGE_RADIUS) return this.error(client, 'Approche-toi du garage.');
    if (NO_GARAGE_BODIES.includes(VEHICLE_BY_ID.get(client.veh)?.body)) return this.error(client, 'Ce véhicule est trop grand pour le garage.');
    h.garage ??= [];
    const cap = HOUSE_TIERS[lot.tier].garageSlots;
    let slot = h.garage.findIndex((x) => !x);
    if (slot === -1) {
      if (h.garage.length >= cap) return this.error(client, `Garage plein (${cap} place(s)).`);
      slot = h.garage.length;
    }
    const car = client.borrowed?.car ?? { model: client.veh, color: client.profile.skin.carColor, ownerId: client.profile.id, ownerName: client.profile.name };
    h.garage[slot] = car;
    client.borrowed = null;
    client.veh = null;
    this.store.save();
    this.broadcastHouses(client.zone);
    this.send(client, 'carParked', {});
    this.toast(client, `🅿️ Véhicule garé (place ${slot + 1}/${cap}).`, 'success');
  },

  /** Sort un véhicule du garage familial (le sien ou celui d'un membre : emprunt). */
  garageTake(client, { lot: lotId, slot }) {
    const lot = LOT_BY_ID.get(lotId);
    const h = lot && this.familyHouse(client, lotId);
    if (!h) return this.error(client, 'Ce garage n\'est pas à ta famille.');
    if (client.veh) return this.error(client, 'Gare d\'abord le véhicule que tu conduis.');
    if (distance2D(client.pos, { x: lot.garage.x, z: lot.garage.doorFront }) > GARAGE_RADIUS) return this.error(client, 'Approche-toi du garage.');
    const car = h.garage?.[slot];
    if (!car) return this.error(client, 'Place vide.');
    h.garage[slot] = null;
    while (h.garage.length && !h.garage.at(-1)) h.garage.pop();
    const own = car.ownerId === client.profile.id && car.model === client.profile.skin.car;
    client.borrowed = own ? null : { car, house: houseKey(client.zone, lotId), lot: lotId };
    client.veh = car.model;
    if (!h.devices?.garage) h.devices = { ...DEFAULT_DEVICES, ...h.devices, garage: true }; // la porte s'ouvre
    this.store.save();
    this.broadcastHouses(client.zone);
    this.send(client, 'carTaken', { model: car.model, color: car.color, borrowed: !own, owner: car.ownerName });
  },

  houseHome(client) {
    const lot = this.homeLot(client.profile, client.zone);
    if (!lot) return this.error(client, 'Ta famille n\'a pas de maison dans ce pays.');
    const now = this.now();
    if (now - (client.lastHomeAt ?? 0) < HOME_COOLDOWN_MS) return this.error(client, 'Patiente un peu avant de rentrer à nouveau.');
    client.lastHomeAt = now;
    client.veh = null;
    client.pos = { x: lot.door.x, y: 0, z: lot.door.z - lot.side * 3, ry: lot.side > 0 ? 0 : Math.PI };
    client.lastStateAt = now;
    this.send(client, 'teleport', { x: client.pos.x, z: client.pos.z, ry: client.pos.ry });
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

Object.assign(HANDLERS, ADMIN_HANDLERS);
