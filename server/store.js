// Persistance simple dans un fichier JSON (écriture atomique + différée).
// Suffisant pour un prototype / quelques centaines de joueurs. Pour la production,
// remplacer par PostgreSQL ou Redis derrière la même interface.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STARTING_MONEY, DEFAULT_OWNED, DEFAULT_SKIN } from '../shared/catalog.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export class Store {
  /** @param {string|null} file chemin du fichier JSON, ou null pour un stockage en mémoire (tests) */
  constructor(file, { saveDelayMs = 1500 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.timer = null;
    this.data = { players: {}, families: {} };
    if (file && fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data.players = parsed.players ?? {};
        this.data.families = parsed.families ?? {};
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
      money: STARTING_MONEY,
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
