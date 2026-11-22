// Infrastructures urbaines partagées client/serveur : feux tricolores, nationale,
// fleuve, pont, péage, résidence d'appartements.
import { ROAD_LINES } from './roadlines.js';

// --- Feux tricolores -------------------------------------------------------------------
// Cycle commun à tous les joueurs (dérivé de l'horloge) : l'axe nord-sud puis l'axe est-ouest.
export const LIGHT_CYCLE = Object.freeze({ green: 14, yellow: 3, allRed: 1.5 });
const CYCLE = (LIGHT_CYCLE.green + LIGHT_CYCLE.yellow + LIGHT_CYCLE.allRed) * 2;

/**
 * Couleur du feu pour un axe.
 * @param {'ns'|'ew'} axis ns = circulation le long de z, ew = le long de x
 * @param {number} t secondes (horloge partagée)
 */
export function lightState(axis, t = Date.now() / 1000) {
  const half = CYCLE / 2;
  let p = ((t % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'ew') p = (p + half) % CYCLE;
  if (p < LIGHT_CYCLE.green) return 'green';
  if (p < LIGHT_CYCLE.green + LIGHT_CYCLE.yellow) return 'yellow';
  return 'red';
}

/** Carrefours équipés de feux (tous ceux de la ville, sauf la ceinture extérieure). */
export const INTERSECTIONS = Object.freeze(ROAD_LINES.slice(1, -1).flatMap((x) => ROAD_LINES.slice(1, -1).map((z) => ({ x, z }))));
export const STOP_OFFSET = 9; // distance de la ligne d'arrêt au centre du carrefour

// --- Nationale, fleuve, pont ------------------------------------------------------------
export const HIGHWAY = Object.freeze({ x: 0, fromZ: -430, toZ: -185, w: 10 });
export const RIVER = Object.freeze({ z: -300, w: 34 });
export const BRIDGE = Object.freeze({ x: 0, z: RIVER.z, w: 14, len: RIVER.w + 16 });

// --- Péage ------------------------------------------------------------------------------
export const TOLL = Object.freeze({
  z: -235, // ligne de péage
  w: 26, // largeur de la plateforme
  len: 34,
  fee: 50, // en Cauris, gratuit pour Premium
  lanes: [-9, -3, 3, 9], // centres des voies
  booths: [-6, 0, 6], // cabines entre les voies
  shareToAgent: 0.6, // part du péage reversée au péagiste en service
  agentPayEvery: 10_000, // ms : le péagiste encaisse aussi les voitures de la ville
  agentPayAmount: 25,
});
/** Point où le péagiste se tient (à la fenêtre de sa cabine). */
export const boothSpot = (bx) => ({ x: bx + 1.4, z: TOLL.z });

// --- Résidence d'appartements --------------------------------------------------------------
export const APARTMENTS = Object.freeze({
  block: [30, 90],
  door: { x: 9, z: 90 },
  floors: 3,
  perFloor: 4,
  rent: 1500, // Cauris pour une période de location
  periodMs: 7 * 24 * 3_600_000, // 7 jours réels
  garageSlots: 1,
  cameras: 1,
});
export const APARTMENT_UNITS = Object.freeze(
  Array.from({ length: APARTMENTS.floors * APARTMENTS.perFloor }, (_, i) => 100 * (Math.floor(i / APARTMENTS.perFloor) + 1) + (i % APARTMENTS.perFloor) + 1),
);
export const apartmentKey = (country, unit) => `${country}:apt${unit}`;
