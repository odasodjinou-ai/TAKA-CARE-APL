// Persistance simple dans un fichier JSON (écriture atomique + différée).
// Suffisant pour un prototype / quelques centaines de joueurs. Pour la production,
// remplacer par PostgreSQL ou Redis derrière la même interface.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STARTING_MONEY, DEFAULT_OWNED, DEFAULT_SKIN, ITEMS } from '../shared/catalog.js';

// Anciens identifiants de voitures (v0.1) -> nouveaux modèles
const LEGACY_CARS = { citadine: 'sakura-kora', pickup: 'savane-baobab', suv: 'dragonfly-mountain', sport: 'hanbit-strike' };

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const MAX_DEVICES = 5; // nombre d'appareils connectés simultanément à un même compte

export class Store {
  /** @param {string|null} file chemin du fichier JSON, ou null pour un stockage en mémoire (tests) */
  constructor(file, { saveDelayMs = 1500 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.timer = null;
    this.data = { players: {}, families: {}, orders: {}, counters: {}, houses: {} };
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data.players = parsed.players ?? {};
        this.data.families = parsed.families ?? {};
        this.data.orders = parsed.orders ?? {};
        this.data.counters = parsed.counters ?? {};
        this.data.reports = parsed.reports ?? [];
        this.data.houses = parsed.houses ?? {};
        for (const f of Object.values(this.data.families)) {
          f.treasury ??= 0;
          f.treasuryLog ??= [];
        }
        this.data.audit = parsed.audit ?? [];
        for (const r of this.data.reports) r.id ??= crypto.randomUUID();
        for (const p of Object.values(this.data.players)) migratePlayer(p);
      } catch (err) {
        // On ne détruit jamais une sauvegarde illisible : on la met de côté.
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, backup);
        console.error(`[store] Sauvegarde illisible, copiée vers ${backup}:`, err.message);
      }
    }
  }

  createPlayer(name, home, phone = null) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const player = {
      id,
      name,
      phone, // numéro vérifié par SMS (E.164) ou null pour un compte invité
      tokenHashes: [hashToken(token)], // un jeton par appareil
      money: STARTING_MONEY, // Cauris (argent du jeu)
      vida: 0, // Vida (monnaie de l'application, achetée en argent réel)
      vidaLog: [],
      premium: { until: 0, firstDone: false },
      home,
      country: home,
      skin: { ...DEFAULT_SKIN },
      owned: [...DEFAULT_OWNED],
      familyId: null,
      stats: { missions: 0, earned: 0, flights: 0 },
      createdAt: Date.now(),
    };
    this.data.players[id] = player;
    this.save();
    return { player, token };
  }

  authenticate(id, token) {
    if (typeof id !== 'string' || typeof token !== 'string') return null;
    const p = this.data.players[id];
    if (!p) return null;
    const b = Buffer.from(hashToken(token), 'hex');
    const ok = p.tokenHashes.some((h) => {
      const a = Buffer.from(h, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    return ok ? p : null;
  }

  /** Nouveau jeton pour un appareil (les plus anciens sont révoqués au-delà de MAX_DEVICES). */
  addToken(player) {
    const token = crypto.randomBytes(32).toString('hex');
    player.tokenHashes = [...player.tokenHashes, hashToken(token)].slice(-MAX_DEVICES);
    this.save();
    return token;
  }

  removeToken(player, token) {
    if (typeof token !== 'string') return;
    const h = hashToken(token);
    player.tokenHashes = player.tokenHashes.filter((x) => x !== h);
    this.save();
  }

  /** Déconnecte tous les appareils sauf celui qui fait la demande. */
  keepOnlyToken(player, token) {
    const h = hashToken(token ?? '');
    player.tokenHashes = player.tokenHashes.filter((x) => x === h);
    this.save();
  }

  findByPhone(phone) {
    return phone ? Object.values(this.data.players).find((p) => p.phone === phone) ?? null : null;
  }

  getPlayer(id) {
    return this.data.players[id] ?? null;
  }

  // --- Familles -----------------------------------------------------------
  getFamily(id) {
    return id ? this.data.families[id] ?? null : null;
  }

  familyNameTaken(name) {
    const n = name.toLowerCase();
    return Object.values(this.data.families).some((f) => f.name.toLowerCase() === n);
  }

  createFamily(name, owner) {
    const id = crypto.randomUUID();
    const family = { id, name, ownerId: owner.id, members: [owner.id], createdAt: Date.now(), treasury: 0, treasuryLog: [] };
    this.data.families[id] = family;
    owner.familyId = id;
    this.save();
    return family;
  }

  addToFamily(family, player) {
    if (!family.members.includes(player.id)) family.members.push(player.id);
    player.familyId = family.id;
    this.save();
  }

  removeFromFamily(player) {
    const family = this.getFamily(player.familyId);
    player.familyId = null;
    if (family) {
      family.members = family.members.filter((m) => m !== player.id);
      if (family.members.length === 0) {
        // Famille dissoute : ses maisons sont remises en vente, la cagnotte rendue au dernier membre
        player.money += family.treasury ?? 0;
        for (const [key, h] of Object.entries(this.data.houses)) if (h.familyId === family.id) delete this.data.houses[key];
        delete this.data.families[family.id];
      }
      else if (family.ownerId === player.id) family.ownerId = family.members[0];
    }
    this.save();
    return family;
  }

  // --- Maisons -----------------------------------------------------------------------
  housesOf(familyId) {
    return Object.entries(this.data.houses)
      .filter(([, h]) => h.familyId === familyId)
      .map(([key, h]) => ({ key, country: key.split(':')[0], lot: Number(key.split(':')[1]), ...h }));
  }

  housesIn(country) {
    return Object.entries(this.data.houses)
      .filter(([key]) => key.startsWith(`${country}:`))
      .map(([key, h]) => ({ lot: Number(key.split(':')[1]), ...h }));
  }

  /** Mouvement de la cagnotte familiale (30 derniers). */
  logTreasury(family, delta, label) {
    family.treasuryLog = [{ at: Date.now(), delta, label }, ...(family.treasuryLog ?? [])].slice(0, 30);
  }

  // --- Vida & commandes ----------------------------------------------------------------
  /** Historique des mouvements de Vida (50 derniers). */
  logVida(player, delta, label) {
    player.vidaLog = [{ at: Date.now(), delta, label }, ...(player.vidaLog ?? [])].slice(0, 50);
  }

  addOrder(order) {
    this.data.orders[order.id] = order;
    this.save();
  }

  getOrder(id) {
    return typeof id === 'string' ? this.data.orders[id] ?? null : null;
  }

  findOrder(pred) {
    return Object.values(this.data.orders).find(pred) ?? null;
  }

  ordersOf(playerId) {
    return Object.values(this.data.orders)
      .filter((o) => o.playerId === playerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Numéro de reçu séquentiel par année : TV-2026-000001 */
  nextReceiptNo(year) {
    const n = (this.data.counters[`receipt-${year}`] ?? 0) + 1;
    this.data.counters[`receipt-${year}`] = n;
    return `TV-${year}-${String(n).padStart(6, '0')}`;
  }

  // --- Sauvegarde -----------------------------------------------------------
  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.saveDelayMs);
  }

  flush() {
    if (!this.file) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file); // atomique sur un même système de fichiers
  }
}

/** Met à niveau un profil créé par une ancienne version. */
function migratePlayer(p) {
  if (p.tokenHash) {
    p.tokenHashes = [p.tokenHash];
    delete p.tokenHash;
  }
  p.tokenHashes ??= [];
  p.phone ??= null;
  p.vida ??= 0;
  p.vidaLog ??= [];
  p.premium ??= { until: 0, firstDone: false };
  p.owned = [...new Set(p.owned.map((id) => (id.startsWith('car:') && LEGACY_CARS[id.slice(4)] ? `car:${LEGACY_CARS[id.slice(4)]}` : id)).filter((id) => ITEMS[id]))];
  for (const id of DEFAULT_OWNED) if (!p.owned.includes(id)) p.owned.push(id);
  if (LEGACY_CARS[p.skin.car]) p.skin.car = LEGACY_CARS[p.skin.car];
  for (const slot of ['hair', 'top', 'hat', 'car']) if (!p.owned.includes(`${slot}:${p.skin[slot]}`)) p.skin[slot] = DEFAULT_SKIN[slot];
}
