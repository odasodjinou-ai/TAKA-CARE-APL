// Intérieurs (maisons, appartements, garages). Les intérieurs sont placés loin de la
// carte (ORIGIN) : on y entre par la porte et le serveur isole les joueurs par intérieur.

export const ORIGIN = Object.freeze({ x: 5000, z: 0 });

// Meubles : type, position relative au centre de la pièce, dimensions, couleur.
// Les murs de séparation sont des « wall » (avec une ouverture laissée libre).
const PLANS = {
  apartment: {
    name: 'Studio',
    w: 10,
    d: 8,
    items: [
      { type: 'wall', x: 2.5, z: -2, w: 0.15, d: 4, h: 2.8 }, // salle d'eau
      { type: 'bed', x: -3.4, z: -2.4, w: 2.2, d: 2.6, color: '#1d4ed8' },
      { type: 'sofa', x: -1, z: 2.5, w: 2.6, d: 0.9, color: '#9a3412', rot: Math.PI },
      { type: 'tv', x: -1, z: -3.75, w: 1.8, d: 0.2 },
      { type: 'rug', x: -1, z: 0.8, w: 3, d: 2 },
      { type: 'counter', x: 4, z: 2.6, w: 1.6, d: 2.4 },
      { type: 'fridge', x: 4.4, z: 0.9, w: 0.8, d: 0.8 },
      { type: 'shower', x: 3.8, z: -2.6, w: 2, d: 2.4 },
      { type: 'plant', x: -4.4, z: 3.3, w: 0.6, d: 0.6 },
    ],
  },
  maison: {
    name: 'Maison',
    w: 12,
    d: 10,
    items: [
      { type: 'wall', x: 2, z: -2.5, w: 0.15, d: 5, h: 2.8 }, // chambre
      { type: 'sofa', x: -2.5, z: 2.6, w: 3, d: 1, color: '#14532d', rot: Math.PI },
      { type: 'table', x: -2.5, z: 0.9, w: 1.4, d: 0.8, low: true },
      { type: 'tv', x: -2.5, z: -4.75, w: 2.2, d: 0.2 },
      { type: 'rug', x: -2.5, z: 0.5, w: 3.6, d: 2.6 },
      { type: 'counter', x: 5, z: 3, w: 1.6, d: 3.2 },
      { type: 'fridge', x: 5.4, z: 0.6, w: 0.8, d: 0.8 },
      { type: 'bed', x: 4, z: -3, w: 2.2, d: 2.6, color: '#7c2d12' },
      { type: 'wardrobe', x: 5.6, z: -0.8, w: 0.6, d: 1.6 },
      { type: 'lamp', x: -5.3, z: -4.3, w: 0.4, d: 0.4 },
      { type: 'plant', x: -5.3, z: 4.3, w: 0.6, d: 0.6 },
    ],
  },
  villa: {
    name: 'Villa',
    w: 16,
    d: 12,
    items: [
      { type: 'wall', x: 3, z: -3, w: 0.15, d: 6, h: 3 },
      { type: 'wall', x: 5.5, z: 0, w: 5, d: 0.15, h: 3 },
      { type: 'sofa', x: -4, z: 3.4, w: 3.4, d: 1, color: '#1e3a8a', rot: Math.PI },
      { type: 'sofa', x: -6.6, z: 0.5, w: 2.4, d: 1, color: '#1e3a8a', rot: Math.PI / 2 },
      { type: 'table', x: -4, z: 1.2, w: 1.6, d: 0.9, low: true },
      { type: 'tv', x: -4, z: -5.75, w: 2.8, d: 0.2 },
      { type: 'rug', x: -4.4, z: 1, w: 4.4, d: 3.2 },
      { type: 'table', x: 0, z: 3.6, w: 2.4, d: 1.2 }, // salle à manger
      { type: 'counter', x: 0, z: -5.3, w: 3.2, d: 0.9 },
      { type: 'fridge', x: 2.1, z: -5.3, w: 0.8, d: 0.8 },
      { type: 'bed', x: 5.6, z: -3.4, w: 2.4, d: 2.6, color: '#6d28d9' },
      { type: 'bed', x: 5.6, z: 3.6, w: 1.6, d: 2.2, color: '#0e7490' },
      { type: 'wardrobe', x: 7.6, z: -0.9, w: 0.6, d: 1.4 },
      { type: 'lamp', x: -7.3, z: -5.3, w: 0.4, d: 0.4 },
      { type: 'plant', x: -7.3, z: 5.3, w: 0.6, d: 0.6 },
      { type: 'plant', x: 2.4, z: 5.3, w: 0.6, d: 0.6 },
    ],
  },
  luxe: {
    name: 'Villa de luxe',
    w: 20,
    d: 14,
    items: [
      { type: 'wall', x: 4, z: -3.5, w: 0.15, d: 7, h: 3.2 },
      { type: 'wall', x: 7, z: 0, w: 6, d: 0.15, h: 3.2 },
      { type: 'sofa', x: -5, z: 4.2, w: 4.4, d: 1.1, color: '#f5f5f4', rot: Math.PI },
      { type: 'sofa', x: -8.4, z: 1, w: 3, d: 1.1, color: '#f5f5f4', rot: Math.PI / 2 },
      { type: 'table', x: -5, z: 1.8, w: 2, d: 1, low: true },
      { type: 'tv', x: -5, z: -6.75, w: 3.6, d: 0.2 },
      { type: 'rug', x: -5.4, z: 1.4, w: 5.4, d: 4 },
      { type: 'piano', x: -7.6, z: -4.6, w: 1.6, d: 2 },
      { type: 'aquarium', x: 0.6, z: -6.6, w: 3, d: 0.6 },
      { type: 'bar', x: 1.4, z: 2.6, w: 0.8, d: 3 },
      { type: 'table', x: 1.4, z: 5.4, w: 2.4, d: 1.2 },
      { type: 'bed', x: 7, z: -4, w: 2.6, d: 2.8, color: '#b45309' },
      { type: 'bed', x: 7, z: 4.4, w: 2.2, d: 2.6, color: '#0f766e' },
      { type: 'wardrobe', x: 9.6, z: -1.2, w: 0.6, d: 1.8 },
      { type: 'lamp', x: -9.3, z: -6.3, w: 0.4, d: 0.4 },
      { type: 'lamp', x: 3.4, z: 6.3, w: 0.4, d: 0.4 },
      { type: 'plant', x: -9.3, z: 6.3, w: 0.7, d: 0.7 },
    ],
  },
  garage: {
    name: 'Garage',
    w: 14,
    d: 9,
    items: [
      { type: 'workbench', x: -4, z: -4, w: 3, d: 0.8 },
      { type: 'shelf', x: 1, z: -4.1, w: 2.4, d: 0.6 },
      { type: 'shelf', x: 6.6, z: 0, w: 0.6, d: 3 },
      { type: 'tires', x: 5.6, z: -3.6, w: 1, d: 1 },
    ],
    // Places des véhicules (côte à côte, capot vers la porte)
    slots: [{ x: -4.2, z: -0.7 }, { x: 0, z: -0.7 }, { x: 4.2, z: -0.7 }],
  },
};

const WALL_T = 0.2;

/**
 * Plan complet d'un intérieur, en coordonnées du monde.
 * @param {'apartment'|'maison'|'villa'|'luxe'|'garage'} kind
 */
export function interiorLayout(kind) {
  const p = PLANS[kind] ?? PLANS.apartment;
  const ox = ORIGIN.x;
  const oz = ORIGIN.z;
  const hw = p.w / 2;
  const hd = p.d / 2;
  const colliders = [
    // Murs extérieurs (la porte d'entrée est au milieu du mur avant, côté +z)
    { minX: ox - hw - WALL_T, maxX: ox + hw + WALL_T, minZ: oz - hd - WALL_T, maxZ: oz - hd },
    { minX: ox - hw - WALL_T, maxX: ox - hw, minZ: oz - hd, maxZ: oz + hd },
    { minX: ox + hw, maxX: ox + hw + WALL_T, minZ: oz - hd, maxZ: oz + hd },
    { minX: ox - hw - WALL_T, maxX: ox + hw + WALL_T, minZ: oz + hd, maxZ: oz + hd + WALL_T },
  ];
  const items = p.items.map((it) => ({ ...it, x: ox + it.x, z: oz + it.z }));
  for (const it of items) {
    if (it.type === 'rug') continue;
    const rot = Math.abs(Math.sin(it.rot ?? 0)) > 0.5;
    const w = rot ? it.d : it.w;
    const d = rot ? it.w : it.d;
    colliders.push({ minX: it.x - w / 2, maxX: it.x + w / 2, minZ: it.z - d / 2, maxZ: it.z + d / 2 });
  }
  return {
    kind,
    name: p.name,
    w: p.w,
    d: p.d,
    h: kind === 'garage' ? 3.4 : 3,
    items,
    colliders,
    exit: { x: ox, z: oz + hd - 0.9 }, // se placer ici et appuyer sur E pour sortir
    spawn: { x: ox, z: oz + hd - 1.8 },
    slots: (p.slots ?? []).map((s) => ({ x: ox + s.x, z: oz + s.z })),
    bounds: { minX: ox - hw, maxX: ox + hw, minZ: oz - hd, maxZ: oz + hd },
  };
}

export const insideBounds = (layout, x, z, margin = 1) =>
  x >= layout.bounds.minX - margin && x <= layout.bounds.maxX + margin && z >= layout.bounds.minZ - margin && z <= layout.bounds.maxZ + margin;
