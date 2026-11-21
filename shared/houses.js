// Maisons familiales : catégories, terrains du quartier résidentiel, règles.
// Partagé client/serveur : le serveur reste seul juge des achats.

export const HOUSE_TIERS = Object.freeze({
  maison: { id: 'maison', name: 'Maison', price: 15000, w: 10, d: 9, h: 5, floors: 1 },
  villa: { id: 'villa', name: 'Villa avec garage', price: 40000, w: 14, d: 11, h: 7.5, floors: 2, garage: true },
  luxe: { id: 'luxe', name: 'Villa de luxe avec piscine', price: 120000, w: 17, d: 12, h: 8, floors: 2, garage: true, pool: true },
});

export const MAX_HOUSES_PER_FAMILY = 2;
export const SELL_REFUND = 0.6; // part du prix rendue à la cagnotte lors d'une revente
export const HOME_COOLDOWN_MS = 30_000; // délai entre deux « Rentrer à la maison »
export const DEFAULT_HOUSE_COLORS = Object.freeze({ wall: '#f5e6c8', roof: '#9a3b2e' });

// Quartier résidentiel : avenue est-ouest (z = 0) de x = -180 à -410, terrains des deux côtés.
export const RESIDENTIAL = Object.freeze({ fromX: -410, toX: -180, lotW: 26, lotD: 26, roadHalf: 8 });

/** Terrains (identiques dans tous les pays). Les 2 derniers de chaque côté sont des villas de luxe. */
export const LOTS = Object.freeze(
  (() => {
    const lots = [];
    const xs = [];
    for (let x = -215; x >= -395; x -= 30) xs.push(x); // 7 terrains par côté
    let n = 1;
    for (const side of [-1, 1]) {
      xs.forEach((x, i) => {
        const tier = i >= 5 ? 'luxe' : i >= 3 ? 'villa' : 'maison';
        const t = HOUSE_TIERS[tier];
        const front = side * (RESIDENTIAL.roadHalf + 1); // bord du trottoir
        const back = side * (RESIDENTIAL.roadHalf + 1 + RESIDENTIAL.lotD);
        const houseZ = back - side * (t.d / 2 + 2); // maison au fond, jardin devant
        lots.push(
          Object.freeze({
            id: n++,
            tier,
            side,
            x,
            z: (front + back) / 2,
            door: { x, z: front + side * 1.2 }, // point d'interaction devant le portail
            house: { x, z: houseZ, w: t.w, d: t.d, h: t.h },
          }),
        );
      });
    }
    return lots;
  })(),
);

export const LOT_BY_ID = new Map(LOTS.map((l) => [l.id, l]));
export const houseKey = (country, lotId) => `${country}:${lotId}`;
