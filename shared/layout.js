// Génération déterministe de la carte d'un pays (ville + aéroport).
// Utilisée par le client (rendu 3D) ET le serveur (spawn, missions, validation),
// ce qui garantit qu'ils partagent exactement la même géographie.
import { COUNTRY_BY_CODE } from './countries.js';
import { LOTS, RESIDENTIAL } from './houses.js';

export const WORLD = Object.freeze({
  bound: 420, // zone jouable : |x|,|z| <= bound
  roadStart: -180,
  roadStep: 60,
  roadCount: 7, // routes en x et z : -180..180
  roadWidth: 10,
  sidewalk: 3,
});

export const ROAD_LINES = Array.from({ length: WORLD.roadCount }, (_, i) => WORLD.roadStart + i * WORLD.roadStep);

/** Lieux d'intérêt fixes (points d'interaction « E »). */
export const PLACES = Object.freeze({
  jobs: { id: 'jobs', label: 'Agence pour l\'emploi', sign: 'EMPLOIS', block: [-30, -30], door: { x: -9, z: -30 }, color: '#2563eb' },
  shop: { id: 'shop', label: 'Boutique de mode', sign: 'BOUTIQUE', block: [30, -30], door: { x: 9, z: -30 }, color: '#db2777' },
  cars: { id: 'cars', label: 'Concessionnaire', sign: 'AUTOS', block: [-30, 30], door: { x: -9, z: 30 }, color: '#f59e0b' },
  airport: { id: 'airport', label: 'Comptoir de l\'aéroport', sign: 'AÉROPORT', door: { x: 252, z: 0 }, color: '#0ea5e9' },
});

export const INTERACT_RADIUS = 6;
export const AIRPORT = Object.freeze({
  terminal: { x: 272, z: 0, w: 30, d: 80, h: 14 },
  runway: { x: 345, z: 0, w: 40, d: 640 },
  arrival: { x: 246, z: 8 },
  plane: { x: 345, z: 270 },
});

// --- Aléatoire déterministe -------------------------------------------------
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bruit de valeur 2D lissé (suffisant pour du relief décoratif).
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const r = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = val(xi, yi);
    const b = val(xi + 1, yi);
    const c = val(xi, yi + 1);
    const d = val(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

const BIOME_STYLE = {
  temperate: { minH: 8, maxH: 46, palette: ['#d6d3d1', '#a8a29e', '#9ca3af', '#cbd5e1', '#e7e5e4', '#b45309'], mountains: 70, coast: false },
  mediterranean: { minH: 6, maxH: 24, palette: ['#fef3c7', '#fde68a', '#f5f5f4', '#fed7aa', '#e7e5e4'], mountains: 45, coast: true },
  desert: { minH: 4, maxH: 18, palette: ['#e7c79a', '#d6b48a', '#c8a27a', '#f1dcbc', '#b88b5d'], mountains: 55, coast: false },
  savanna: { minH: 5, maxH: 20, palette: ['#f1dcbc', '#e5c9a0', '#d6d3d1', '#fca5a5', '#c2a27a'], mountains: 30, coast: false },
  tropical: { minH: 6, maxH: 34, palette: ['#fde68a', '#86efac', '#93c5fd', '#fca5a5', '#f9a8d4', '#fef3c7'], mountains: 40, coast: true },
  snow: { minH: 6, maxH: 30, palette: ['#b91c1c', '#1e3a8a', '#f5f5f4', '#78716c', '#facc15'], mountains: 110, coast: false },
};

/**
 * Hauteur du terrain. La zone jouable est plate (y = 0) pour simplifier la
 * physique ; le relief n'apparaît qu'au-delà, comme décor.
 */
export function makeHeightFn(seed, biome) {
  const noise = makeNoise(seed);
  const style = BIOME_STYLE[biome] ?? BIOME_STYLE.temperate;
  const flat = WORLD.bound + 20;
  return (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d <= flat) return 0;
    const t = Math.min(1, (d - flat) / 260);
    const n = noise(x / 90, z / 90) * 0.65 + noise(x / 30, z / 30) * 0.35;
    let h = t * t * style.mountains * (0.35 + n);
    if (style.coast && z < -flat) h -= Math.min(1, (-z - flat) / 120) * (style.mountains * 0.6 + 14);
    return h;
  };
}

/** Est-ce que (x,z) est sur une route (chaussée + trottoir) ? */
export function onRoad(x, z, margin = 0) {
  const half = WORLD.roadWidth / 2 + WORLD.sidewalk + margin;
  const inCity = (v) => v >= WORLD.roadStart - half && v <= WORLD.roadStart + WORLD.roadStep * (WORLD.roadCount - 1) + half;
  for (const l of ROAD_LINES) {
    if (Math.abs(x - l) <= half && inCity(z)) return true;
    if (Math.abs(z - l) <= half && inCity(x)) return true;
  }
  // Route d'accès à l'aéroport
  if (Math.abs(z) <= half && x >= 180 && x <= 260) return true;
  // Avenue du quartier résidentiel
  if (Math.abs(z) <= half && x >= RESIDENTIAL.fromX && x <= RESIDENTIAL.toX) return true;
  return false;
}

const layoutCache = new Map();

/**
 * Construit (et met en cache) la carte d'un pays.
 * @param {string} code code ISO du pays
 */
export function getLayout(code) {
  if (layoutCache.has(code)) return layoutCache.get(code);
  const country = COUNTRY_BY_CODE.get(code);
  if (!country) throw new Error(`Pays inconnu: ${code}`);
  const seed = hashString(`terra-vida:${code}`);
  const rand = mulberry32(seed);
  const style = BIOME_STYLE[country.biome] ?? BIOME_STYLE.temperate;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const buildings = [];
  const colliders = [];
  const parks = [];
  const addBox = (b) => {
    buildings.push(b);
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
  };

  const specialBlocks = new Map(
    Object.values(PLACES)
      .filter((p) => p.block)
      .map((p) => [p.block.join(','), p]),
  );
  const parkBlock = '30,30';
  const blockCenters = ROAD_LINES.slice(0, -1).map((l) => l + WORLD.roadStep / 2);
  const inner = WORLD.roadStep - WORLD.roadWidth - WORLD.sidewalk * 2; // 44 m

  for (const bx of blockCenters) {
    for (const bz of blockCenters) {
      const key = `${bx},${bz}`;
      const special = specialBlocks.get(key);
      if (special) {
        addBox({ x: bx, z: bz, w: 34, d: 34, h: 11, color: '#f8fafc', kind: 'special', place: special.id });
        continue;
      }
      const distCenter = Math.hypot(bx, bz);
      if (key === parkBlock || rand() < 0.12) {
        parks.push({ x: bx, z: bz, size: inner });
        continue;
      }
      // Les blocs centraux sont plus hauts (centre-ville)
      const heightBoost = Math.max(0.25, 1 - distCenter / 260);
      const split = rand() < 0.55 ? 2 : 1;
      const cell = inner / split;
      for (let i = 0; i < split; i++) {
        for (let j = 0; j < split; j++) {
          if (split === 2 && rand() < 0.12) continue;
          const w = cell - 4 - rand() * 4;
          const d = cell - 4 - rand() * 4;
          const h = style.minH + (style.maxH - style.minH) * heightBoost * (0.35 + rand() * 0.65);
          addBox({
            x: bx - inner / 2 + cell * (i + 0.5),
            z: bz - inner / 2 + cell * (j + 0.5),
            w,
            d,
            h: Math.round(h * 10) / 10,
            color: pick(style.palette),
            kind: 'building',
            seed: Math.floor(rand() * 1e9),
          });
        }
      }
    }
  }

  // Aéroport
  const t = AIRPORT.terminal;
  addBox({ x: t.x, z: t.z, w: t.w, d: t.d, h: t.h, color: '#e2e8f0', kind: 'terminal' });
  // Hangars
  for (const hz of [-110, 110]) addBox({ x: 280, z: hz, w: 26, d: 40, h: 12, color: '#94a3b8', kind: 'hangar' });
  // Maisons du quartier résidentiel (toujours construites ; à vendre tant qu'aucune famille ne les achète)
  for (const lot of LOTS) {
    const h = lot.house;
    colliders.push({ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2 });
  }

  // Arbres / végétation (hors routes, hors bâtiments, hors aéroport)
  const trees = [];
  const blocked = (x, z, pad) =>
    onRoad(x, z, pad) ||
    colliders.some((c) => x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) ||
    (x > 230 && x < 380 && Math.abs(z) < 330) ||
    (x > RESIDENTIAL.fromX - 6 && x < RESIDENTIAL.toX && Math.abs(z) < RESIDENTIAL.roadHalf + RESIDENTIAL.lotD + 4);
  for (const p of parks) {
    const n = 10 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const x = p.x + (rand() - 0.5) * (p.size - 6);
      const z = p.z + (rand() - 0.5) * (p.size - 6);
      if (Math.hypot(x - p.x, z - p.z) < 7) continue; // place centrale libre
      trees.push({ x, z, s: 0.8 + rand() * 0.6, r: rand() * Math.PI * 2 });
    }
  }
  for (let i = 0; i < 900 && trees.length < 520; i++) {
    const x = (rand() * 2 - 1) * 650;
    const z = (rand() * 2 - 1) * 650;
    const inCity = Math.abs(x) < 200 && Math.abs(z) < 200;
    if (inCity || blocked(x, z, 4)) continue;
    trees.push({ x, z, s: 0.8 + rand() * 0.9, r: rand() * Math.PI * 2 });
  }

  // Points de mission : sur les trottoirs, le long des routes
  const poi = [];
  for (const l of ROAD_LINES) {
    for (let v = WORLD.roadStart + 15; v < -WORLD.roadStart; v += 30) {
      const off = WORLD.roadWidth / 2 + 1.5;
      poi.push({ x: l + off, z: v }, { x: v, z: l - off });
    }
  }

  // Livraisons aussi devant les maisons
  for (const lot of LOTS) poi.push({ x: lot.door.x, z: lot.door.z });

  const layout = {
    code,
    seed,
    biome: country.biome,
    buildings,
    colliders,
    parks,
    trees,
    poi,
    spawn: { x: 4, z: 6 },
  };
  layoutCache.set(code, layout);
  return layout;
}

/** Repousse un cercle (x,z,r) hors des boîtes de collision. Mute `pos`. */
export function resolveCollisions(pos, radius, colliders) {
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centre à l'intérieur de la boîte : sortie par le côté le plus proche
      const exits = [
        [pos.x - c.minX, -1, 0],
        [c.maxX - pos.x, 1, 0],
        [pos.z - c.minZ, 0, -1],
        [c.maxZ - pos.z, 0, 1],
      ].sort((a, b) => a[0] - b[0]);
      const [dist, sx, sz] = exits[0];
      pos.x += sx * (dist + radius);
      pos.z += sz * (dist + radius);
    }
  }
  pos.x = Math.max(-WORLD.bound, Math.min(WORLD.bound, pos.x));
  pos.z = Math.max(-WORLD.bound, Math.min(WORLD.bound, pos.z));
  return pos;
}

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
