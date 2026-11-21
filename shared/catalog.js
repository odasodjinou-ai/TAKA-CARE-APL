// Règles d'économie et catalogue — partagés client/serveur.
// Le serveur reste la seule autorité sur l'argent : le client n'utilise ces données
// que pour l'affichage.
//
// Deux monnaies :
//  - Cauris (🐚) : argent DU JEU, gagné avec les métiers, sert aux achats courants.
//  - Vida (Ʋ)    : monnaie DE L'APPLICATION, achetée en argent réel (Mobile Money, Wave,
//                  PayPal…). Sert à Premium, aux véhicules de luxe et au change en Cauris.
import { COUNTRY_BY_CODE } from './countries.js';
import { VEHICLES, DEFAULT_VEHICLE } from './vehicles.js';

export const CAURIS = { name: 'Cauris', symbol: '🐚' };
export const VIDA = { name: 'Vida', symbol: 'Ʋ' };
export const STARTING_MONEY = 2500; // en Cauris
export const FAMILY_CREATION_COST = 500;
export const FAMILY_MAX_MEMBERS = 12;

const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');
export const formatMoney = (n) => `${fmt(n)} ${CAURIS.symbol}`;
export const formatVida = (n) => `${fmt(n)} ${VIDA.symbol}`;
export const formatXof = (n) => `${fmt(n)} FCFA`;
export const formatPrice = (price, currency) => (currency === 'vida' ? formatVida(price) : formatMoney(price));

// --- Achat de Vida en argent réel ------------------------------------------------
// 1 Ʋ = 10 FCFA, avec un bonus sur les gros packs.
export const VIDA_PACKS = Object.freeze([
  { id: 'vida-100', vida: 100, xof: 1000 },
  { id: 'vida-260', vida: 260, xof: 2500, bonus: '+4 %' },
  { id: 'vida-550', vida: 550, xof: 5000, bonus: '+10 %' },
  { id: 'vida-1150', vida: 1150, xof: 10000, bonus: '+15 %' },
  { id: 'vida-2400', vida: 2400, xof: 20000, bonus: '+20 %' },
]);
export const PACK_BY_ID = new Map(VIDA_PACKS.map((p) => [p.id, p]));

/** Moyens de paiement proposés aux joueurs (le serveur indique lesquels sont actifs). */
export const PAYMENT_METHODS = Object.freeze({
  mtn: { label: 'MTN MoMo', color: '#ffcc00' },
  moov: { label: 'Moov Money', color: '#0066b3' },
  celtiis: { label: 'Celtiis Cash', color: '#e30613' },
  wave: { label: 'Wave', color: '#1dc8ff' },
  orange: { label: 'Orange Money', color: '#ff7900' },
  paypal: { label: 'PayPal / Carte bancaire', color: '#003087' },
});

// --- Premium ------------------------------------------------------------------------
// Dure 3 mois. Premier abonnement : 100 Ʋ (= 1 000 FCFA). Renouvellements : 160 Ʋ (= 1 600 FCFA).
export const PREMIUM = Object.freeze({
  days: 90,
  firstPrice: 100,
  renewPrice: 160,
  jobBonus: 0.5, // +50 % de salaire
  flightDiscount: 0.3, // −30 % sur les billets
  title: 'Premium',
});

export function isPremium(profile, now = Date.now()) {
  return !!profile?.premium?.until && profile.premium.until > now;
}

export function premiumPrice(profile) {
  return profile?.premium?.firstDone ? PREMIUM.renewPrice : PREMIUM.firstPrice;
}

// --- Change Vida -> Cauris ---------------------------------------------------------------
export const EXCHANGE = Object.freeze([
  { id: 'ex-20', vida: 20, cauris: 1000 },
  { id: 'ex-100', vida: 100, cauris: 5500 },
  { id: 'ex-500', vida: 500, cauris: 30000 },
]);

// --- Métiers --------------------------------------------------------------------------
/** reward = [min, max] en Cauris par mission, ajusté selon la distance. */
export const JOBS = Object.freeze({
  livreur: { id: 'livreur', name: 'Livreur', icon: '📦', needsCar: false, reward: [90, 160], desc: 'Livre des colis aux habitants à pied ou en voiture.' },
  taxi: { id: 'taxi', name: 'Chauffeur de taxi', icon: '🚕', needsCar: true, reward: [180, 280], desc: 'Conduis tes clients à destination. Véhicule obligatoire.' },
  ambulancier: { id: 'ambulancier', name: 'Ambulancier', icon: '🚑', needsCar: false, reward: [150, 240], desc: 'Intervient au plus vite auprès des patients.' },
  policier: { id: 'policier', name: 'Policier', icon: '🚓', needsCar: false, reward: [130, 210], desc: 'Patrouille entre les points de contrôle de la ville.' },
});

// --- Objets ----------------------------------------------------------------------------
const CLOTHES = {
  'hair:short': { slot: 'hair', name: 'Courts', price: 0 },
  'hair:long': { slot: 'hair', name: 'Longs', price: 0 },
  'hair:afro': { slot: 'hair', name: 'Afro', price: 0 },
  'hair:bald': { slot: 'hair', name: 'Rasé', price: 0 },
  'hair:braids': { slot: 'hair', name: 'Tresses', price: 250 },
  'hair:mohawk': { slot: 'hair', name: 'Crête', price: 300 },
  'top:tshirt': { slot: 'top', name: 'T-shirt', price: 0 },
  'top:hoodie': { slot: 'top', name: 'Sweat à capuche', price: 350 },
  'top:jacket': { slot: 'top', name: 'Veste en cuir', price: 800 },
  'top:suit': { slot: 'top', name: 'Costume', price: 1200 },
  'top:boubou': { slot: 'top', name: 'Boubou brodé', price: 900 },
  'hat:none': { slot: 'hat', name: 'Aucun', price: 0 },
  'hat:cap': { slot: 'hat', name: 'Casquette', price: 150 },
  'hat:beanie': { slot: 'hat', name: 'Bonnet', price: 120 },
  'hat:cowboy': { slot: 'hat', name: 'Chapeau de cowboy', price: 400 },
  'hat:crown': { slot: 'hat', name: 'Couronne', price: 60, currency: 'vida' },
};

export const ITEMS = Object.freeze({
  ...Object.fromEntries(Object.entries(CLOTHES).map(([id, it]) => [id, { currency: 'cauris', ...it }])),
  ...Object.fromEntries(
    VEHICLES.map((v) => [`car:${v.id}`, { slot: 'car', name: v.name, price: v.price, currency: v.currency, speed: v.speed, premiumOnly: v.premiumOnly, vehicle: v }]),
  ),
});

export const SLOTS = ['hair', 'top', 'hat', 'car'];

export function itemsBySlot(slot) {
  return Object.entries(ITEMS)
    .filter(([, it]) => it.slot === slot)
    .map(([id, it]) => ({ id, value: id.slice(id.indexOf(':') + 1), ...it }));
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
  car: DEFAULT_VEHICLE,
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

/** Prix d'un billet d'avion (Cauris) entre deux pays. */
export function flightPrice(from, to, premium = false) {
  const a = COUNTRY_BY_CODE.get(from);
  const b = COUNTRY_BY_CODE.get(to);
  if (!a || !b || a.code === b.code) return null;
  const base = a.region === b.region ? 400 : 1100;
  return premium ? Math.round(base * (1 - PREMIUM.flightDiscount)) : base;
}

export const FLIGHT_DURATION_MS = 7000;
