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

export class Store {
  /** @param {string|null} file chemin du fichier JSON, ou null pour un stockage en mémoire (tests) */
  constructor(file, { saveDelayMs = 1500 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.timer = null;
    this.data = { players: {}, families: {}, orders: {}, counters: {} };
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data.players = parsed.players ?? {};
        this.data.families = parsed.families ?? {};
        this.data.orders = parsed.orders ?? {};
        this.data.counters = parsed.counters ?? {};
        for (const p of Object.values(this.data.players)) migratePlayer(p);
      } catch (err) {
        // On ne détruit jamais une sauvegarde illisible : on la met de côté.
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, backup);
        console.error(`[store] Sauvegarde illisible, copiée vers ${backup}:`, err.message);
      }
    }
  }

  createPlayer(name, home) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const player = {
      id,
      name,
      tokenHash: hashToken(token),
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
    const a = Buffer.from(p.tokenHash, 'hex');
    const b = Buffer.from(hashToken(token), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? p : null;
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
    const family = { id, name, ownerId: owner.id, members: [owner.id], createdAt: Date.now() };
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
      if (family.members.length === 0) delete this.data.families[family.id];
      else if (family.ownerId === player.id) family.ownerId = family.members[0];
    }
    this.save();
    return family;
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
  p.vida ??= 0;
  p.vidaLog ??= [];
  p.premium ??= { until: 0, firstDone: false };
  p.owned = [...new Set(p.owned.map((id) => (id.startsWith('car:') && LEGACY_CARS[id.slice(4)] ? `car:${LEGACY_CARS[id.slice(4)]}` : id)).filter((id) => ITEMS[id]))];
  for (const id of DEFAULT_OWNED) if (!p.owned.includes(id)) p.owned.push(id);
  if (LEGACY_CARS[p.skin.car]) p.skin.car = LEGACY_CARS[p.skin.car];
  for (const slot of ['hair', 'top', 'hat', 'car']) if (!p.owned.includes(`${slot}:${p.skin[slot]}`)) p.skin[slot] = DEFAULT_SKIN[slot];
}
