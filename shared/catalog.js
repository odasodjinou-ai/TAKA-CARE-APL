// Règles d'économie et catalogue — partagés client/serveur.
// Le serveur reste la seule autorité sur l'argent : le client n'utilise ces données
// que pour l'affichage.
import { COUNTRY_BY_CODE } from './countries.js';

export const CURRENCY = { name: 'Vida', symbol: 'Ʋ' };
export const STARTING_MONEY = 2500;
export const FAMILY_CREATION_COST = 500;
export const FAMILY_MAX_MEMBERS = 12;

export function formatMoney(n) {
  return `${Math.floor(n).toLocaleString('fr-FR')} ${CURRENCY.symbol}`;
}

/** Métiers. reward = [min, max] par mission, ajusté selon la distance. */
export const JOBS = Object.freeze({
  livreur: { id: 'livreur', name: 'Livreur', icon: '📦', needsCar: false, reward: [90, 160], desc: 'Livre des colis aux habitants à pied ou en voiture.' },
  taxi: { id: 'taxi', name: 'Chauffeur de taxi', icon: '🚕', needsCar: true, reward: [180, 280], desc: 'Conduis tes clients à destination. Voiture obligatoire.' },
  ambulancier: { id: 'ambulancier', name: 'Ambulancier', icon: '🚑', needsCar: false, reward: [150, 240], desc: 'Intervient au plus vite auprès des patients.' },
  policier: { id: 'policier', name: 'Policier', icon: '🚓', needsCar: false, reward: [130, 210], desc: 'Patrouille entre les points de contrôle de la ville.' },
});

/** Objets achetables. price 0 = gratuit et possédé par défaut. */
export const ITEMS = Object.freeze({
  // Coiffures
  'hair:short': { slot: 'hair', name: 'Courts', price: 0 },
  'hair:long': { slot: 'hair', name: 'Longs', price: 0 },
  'hair:afro': { slot: 'hair', name: 'Afro', price: 0 },
  'hair:bald': { slot: 'hair', name: 'Rasé', price: 0 },
  'hair:braids': { slot: 'hair', name: 'Tresses', price: 250 },
  'hair:mohawk': { slot: 'hair', name: 'Crête', price: 300 },
  // Hauts
  'top:tshirt': { slot: 'top', name: 'T-shirt', price: 0 },
  'top:hoodie': { slot: 'top', name: 'Sweat à capuche', price: 350 },
  'top:jacket': { slot: 'top', name: 'Veste en cuir', price: 800 },
  'top:suit': { slot: 'top', name: 'Costume', price: 1200 },
  'top:boubou': { slot: 'top', name: 'Boubou brodé', price: 900 },
  // Chapeaux
  'hat:none': { slot: 'hat', name: 'Aucun', price: 0 },
  'hat:cap': { slot: 'hat', name: 'Casquette', price: 150 },
  'hat:beanie': { slot: 'hat', name: 'Bonnet', price: 120 },
  'hat:cowboy': { slot: 'hat', name: 'Chapeau de cowboy', price: 400 },
  'hat:crown': { slot: 'hat', name: 'Couronne', price: 25000 },
  // Véhicules
  'car:citadine': { slot: 'car', name: 'Citadine', price: 0, speed: 26 },
  'car:pickup': { slot: 'car', name: 'Pick-up', price: 6000, speed: 30 },
  'car:suv': { slot: 'car', name: 'SUV', price: 9000, speed: 32 },
  'car:sport': { slot: 'car', name: 'Sportive', price: 18000, speed: 42 },
});

export const SLOTS = ['hair', 'top', 'hat', 'car'];

export function itemsBySlot(slot) {
  return Object.entries(ITEMS)
    .filter(([, it]) => it.slot === slot)
    .map(([id, it]) => ({ id, value: id.split(':')[1], ...it }));
}

export const DEFAULT_OWNED = Object.keys(ITEMS).filter((id) => ITEMS[id].price === 0);

export const DEFAULT_SKIN = Object.freeze({
  tone: '#a0673a',
  hair: 'short',
  hairColor: '#1b120c',
  top: 'tshirt',
  topColor: '#2563eb',
  pants: '#1f2937',
  hat: 'none',
  car: 'citadine',
  carColor: '#dc2626',
});

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_FIELDS = ['tone', 'hairColor', 'topColor', 'pants', 'carColor'];

/**
 * Valide un skin envoyé par un client.
 * @returns {{ok: true, skin: object} | {ok: false, error: string}}
 */
export function validateSkin(input, owned) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Apparence invalide.' };
  const skin = {};
  for (const f of COLOR_FIELDS) {
    if (typeof input[f] !== 'string' || !COLOR_RE.test(input[f])) return { ok: false, error: `Couleur invalide (${f}).` };
    skin[f] = input[f].toLowerCase();
  }
  const ownedSet = new Set(owned);
  for (const slot of SLOTS) {
    const id = `${slot}:${input[slot]}`;
    if (!ITEMS[id]) return { ok: false, error: `Objet inconnu (${slot}).` };
    if (!ownedSet.has(id)) return { ok: false, error: `Tu ne possèdes pas « ${ITEMS[id].name} ».` };
    skin[slot] = input[slot];
  }
  return { ok: true, skin };
}

/** Prix d'un billet d'avion entre deux pays. */
export function flightPrice(from, to) {
  const a = COUNTRY_BY_CODE.get(from);
  const b = COUNTRY_BY_CODE.get(to);
  if (!a || !b || a.code === b.code) return null;
  return a.region === b.region ? 400 : 1100;
}

export const FLIGHT_DURATION_MS = 7000;
