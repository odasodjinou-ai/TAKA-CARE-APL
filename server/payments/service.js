// Gestion des commandes de Vida : création, confirmation idempotente, reçus.
import crypto from 'node:crypto';
import { PACK_BY_ID, PAYMENT_METHODS } from '../../shared/catalog.js';
import { routeMethod } from './providers.js';

const MAX_PENDING_PER_PLAYER = 5;
const ORDER_TTL_MS = 2 * 60 * 60 * 1000; // une commande non payée expire après 2 h

export class PaymentService {
  /**
   * @param {import('../store.js').Store} store
   * @param {Record<string, any>} providers
   * @param {{ publicUrl: string, onPaid?: (order) => void, now?: () => number, log?: Console }} opts
   */
  constructor(store, providers, { publicUrl, onPaid = () => {}, now = () => Date.now(), log = console } = {}) {
    this.store = store;
    this.providers = providers;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.onPaid = onPaid;
    this.now = now;
    this.log = log;
    this.inFlight = new Map(); // orderId -> Promise (évite les doubles crédits concurrents)
  }

  /** Moyens de paiement disponibles (pour l'affichage client). */
  methods() {
    return Object.entries(PAYMENT_METHODS).map(([id, m]) => {
      const p = routeMethod(this.providers, id);
      return { id, label: m.label, color: m.color, enabled: !!p, via: p?.label ?? null };
    });
  }

  urls(order) {
    const q = `k=${order.receiptKey}`;
    return {
      returnUrl: `${this.publicUrl}/pay/return/${order.id}/${order.receiptKey}`, // clé dans le chemin : certains prestataires ajoutent leurs paramètres
      webhookUrl: `${this.publicUrl}/pay/webhook/${order.provider}`,
      sandboxUrl: `${this.publicUrl}/pay/sandbox/${order.id}?${q}`,
      receiptUrl: `${this.publicUrl}/receipt/${order.id}?${q}`,
    };
  }

  async createOrder(profile, packId, method) {
    const pack = PACK_BY_ID.get(packId);
    if (!pack) throw new UserError('Pack inconnu.');
    if (!PAYMENT_METHODS[method]) throw new UserError('Moyen de paiement inconnu.');
    const provider = routeMethod(this.providers, method);
    if (!provider) throw new UserError(`${PAYMENT_METHODS[method].label} n'est pas encore disponible.`);
    const pending = this.store.ordersOf(profile.id).filter((o) => o.status === 'pending' && this.now() - o.createdAt < ORDER_TTL_MS);
    if (pending.length >= MAX_PENDING_PER_PLAYER) throw new UserError('Trop de paiements en attente. Termine ou annule les précédents.');

    const order = {
      id: `TV${this.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      receiptKey: crypto.randomBytes(16).toString('hex'),
      playerId: profile.id,
      playerName: profile.name,
      pack: pack.id,
      vida: pack.vida,
      xof: pack.xof,
      method,
      provider: provider.id,
      providerRef: null,
      status: 'pending',
      createdAt: this.now(),
      paidAt: null,
      receiptNo: null,
    };
    let checkout;
    try {
      checkout = await provider.createCheckout(order, this.urls(order));
    } catch (err) {
      this.log.error(`[pay] Création ${provider.id} échouée :`, err.message, err.body ?? '');
      throw new UserError('Le service de paiement ne répond pas. Réessaie dans un instant.');
    }
    order.providerRef = checkout.providerRef;
    this.store.addOrder(order);
    return { order, redirectUrl: checkout.redirectUrl };
  }

  /**
   * Revérifie une commande auprès du prestataire et crédite les Vida une seule fois.
   * Peut être appelé autant de fois qu'on veut (retour navigateur, webhook, relance).
   */
  confirm(orderId) {
    if (this.inFlight.has(orderId)) return this.inFlight.get(orderId);
    const p = this.#confirm(orderId).finally(() => this.inFlight.delete(orderId));
    this.inFlight.set(orderId, p);
    return p;
  }

  async #confirm(orderId) {
    const order = this.store.getOrder(orderId);
    if (!order || order.status !== 'pending') return order;
    const provider = this.providers[order.provider];
    let res;
    try {
      res = await provider.verify(order);
    } catch (err) {
      this.log.error(`[pay] Vérification ${order.provider} ${order.id} :`, err.message);
      return order;
    }
    if (res.status === 'paid') {
      if (res.amount !== order.xof || (res.currency && res.currency !== 'XOF')) {
        // Montant différent du pack : on ne crédite pas, intervention manuelle.
        order.status = 'review';
        order.note = `Montant reçu ${res.amount} ${res.currency} ≠ ${order.xof} XOF`;
        this.log.error(`[pay] ${order.id} : ${order.note}`);
        this.store.save();
        return order;
      }
      const player = this.store.getPlayer(order.playerId);
      order.status = 'paid';
      order.paidAt = this.now();
      order.receiptNo = this.store.nextReceiptNo(new Date(order.paidAt).getFullYear());
      player.vida = (player.vida ?? 0) + order.vida;
      this.store.logVida(player, order.vida, `Achat ${order.vida} Ʋ (${order.receiptNo})`);
      this.store.save();
      this.log.info?.(`[pay] ${order.id} payée : +${order.vida} Ʋ pour ${player.name}`);
      this.onPaid(order);
    } else if (res.status === 'failed' || this.now() - order.createdAt > ORDER_TTL_MS) {
      order.status = 'failed';
      this.store.save();
    }
    return order;
  }

  /** Retrouve une commande depuis la référence du prestataire (webhooks). */
  findByProviderRef(providerId, ref) {
    return this.store.findOrder((o) => o.provider === providerId && (o.providerRef === String(ref) || o.id === String(ref)));
  }

  checkKey(order, key) {
    if (!order || typeof key !== 'string' || key.length !== order.receiptKey.length) return false;
    return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(order.receiptKey));
  }
}

export class UserError extends Error {}
