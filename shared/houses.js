// Maisons familiales : catégories, terrains du quartier résidentiel, règles.
// Partagé client/serveur : le serveur reste seul juge des achats.

// garageSlots : véhicules garables ; cameras : caméras de surveillance installées
export const HOUSE_TIERS = Object.freeze({
  maison: { id: 'maison', name: 'Maison', price: 15000, w: 10, d: 9, h: 5, floors: 1, garageSlots: 1, cameras: 2, carport: true },
  villa: { id: 'villa', name: 'Villa avec garage', price: 40000, w: 13, d: 11, h: 7.5, floors: 2, garage: true, garageSlots: 2, cameras: 4 },
  luxe: { id: 'luxe', name: 'Villa de luxe avec piscine', price: 120000, w: 15, d: 12, h: 8, floors: 2, garage: true, pool: true, garageSlots: 3, cameras: 6 },
});

/** Appareils connectés : pilotables par téléphone ou par interrupteur physique. */
export const DEVICES = Object.freeze({
  lights: { id: 'lights', label: 'Lumières', icon: '💡' },
  garage: { id: 'garage', label: 'Porte du garage', icon: '🚗' },
  alarm: { id: 'alarm', label: 'Alarme', icon: '🚨' },
  music: { id: 'music', label: 'Musique', icon: '🎵' },
  pool: { id: 'pool', label: 'Éclairage de la piscine', icon: '🌊', tiers: ['luxe'] },
});
export const devicesFor = (tier) => Object.values(DEVICES).filter((d) => !d.tiers || d.tiers.includes(tier));
export const DEFAULT_DEVICES = Object.freeze({ lights: false, garage: false, alarm: false, music: false, pool: false });

export const GARAGE_W = 4.6;
export const GARAGE_D = 6.2;
export const BUTTON_RADIUS = 1.8; // distance pour appuyer sur un interrupteur
export const GARAGE_RADIUS = 9; // distance au garage pour garer / sortir un véhicule
export const NO_GARAGE_BODIES = ['bus', 'truck']; // trop grands

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
        const f = -side; // direction de la façade (vers l'avenue)
        const hx = x + 1.5; // maison décalée pour laisser la place au garage
        const bodyH = t.floors === 2 ? 6.4 : 3.4;
        const frontZ = houseZ + f * (t.d / 2);
        const houseBack = houseZ - f * (t.d / 2);
        // Garage (ou abri) à gauche de la maison, aligné sur le fond
        const gx = hx - t.w / 2 - GARAGE_W / 2 - 0.2;
        const gz = houseBack + f * (GARAGE_D / 2);
        const doorFront = houseBack + f * GARAGE_D;
        const slots = [{ x: gx, z: gz }]; // place 0 : dans le garage
        for (let i = 1; i < t.garageSlots; i++) slots.push({ x: gx, z: doorFront + f * (3.2 + 5 * (i - 1)) }); // allée
        const lotFront = front;
        const lotBack = back;
        const poolZ = (frontZ + front) / 2 - f * 0.5;
        const cams = [
          { id: 1, label: 'Entrée', pos: [hx + t.w / 2 - 0.3, bodyH - 0.3, frontZ + f * 0.3], look: [x, 1, front] },
          { id: 2, label: 'Rue', pos: [x + 11.5, 2.6, lotFront + f * 0.4], look: [x - 6, 1, 0] },
          { id: 3, label: 'Garage', pos: [gx + GARAGE_W / 2 + 0.3, 2.8, doorFront + f * 0.2], look: [gx, 0.6, doorFront + f * 7] },
          { id: 4, label: 'Jardin arrière', pos: [hx, bodyH - 0.3, houseBack - f * 0.3], look: [hx, 0.5, lotBack] },
          { id: 5, label: 'Piscine', pos: [hx + t.w / 2 - 0.3, 2.8, frontZ + f * 0.3], look: [x + 7, 0, poolZ] },
          { id: 6, label: 'Côté jardin', pos: [hx + t.w / 2 + 0.3, 2.8, houseZ], look: [x + 12, 0.5, houseZ + f * 5] },
        ].slice(0, t.cameras);
        const buttons = [
          { device: 'lights', x: hx - 1.3, z: frontZ + f * 0.25, y: 1.3 },
          { device: 'music', x: hx - 2.1, z: frontZ + f * 0.25, y: 1.3 },
          { device: 'alarm', x: hx + 1.3, z: frontZ + f * 0.25, y: 1.3 },
          { device: 'garage', x: gx + GARAGE_W / 2 + 0.25, z: doorFront + f * 0.3, y: 1.2 },
          ...(t.pool ? [{ device: 'pool', x: x + 2.4, z: poolZ, y: 0.9 }] : []),
        ];
        lots.push(
          Object.freeze({
            id: n++,
            tier,
            side,
            x,
            z: (front + back) / 2,
            front: lotFront,
            back: lotBack,
            door: { x: hx, z: front + side * 1.2 }, // point d'interaction devant le portail
            house: { x: hx, z: houseZ, w: t.w, d: t.d, h: t.h, bodyH, frontZ },
            garage: { x: gx, z: gz, w: GARAGE_W, d: GARAGE_D, doorFront, carport: !!t.carport, slots },
            pool: t.pool ? { x: x + 7, z: poolZ } : null,
            cameras: cams,
            buttons,
          }),
        );
      });
    }
    return lots;
  })(),
);

export const LOT_BY_ID = new Map(LOTS.map((l) => [l.id, l]));
export const houseKey = (country, lotId) => `${country}:${lotId}`;

/** Terrain qui contient le point (x, z), ou null. */
export function lotAt(x, z) {
  return (
    LOTS.find(
      (l) => Math.abs(x - l.x) <= RESIDENTIAL.lotW / 2 && Math.min(l.front, l.back) <= z && z <= Math.max(l.front, l.back),
    ) ?? null
  );
}
