// Codes de vérification à usage unique (OTP) envoyés par SMS.
// - code à 6 chiffres tiré avec un générateur cryptographique ;
// - seule une empreinte HMAC est conservée (jamais le code en clair) ;
// - expiration, nombre d'essais limité, délai entre deux envois ;
// - plafonds par numéro et par adresse IP (protège contre l'abus et la facture SMS).
import crypto from 'node:crypto';
import { UserError } from '../payments/service.js';

export const OTP = Object.freeze({
  length: 6,
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendMs: 60_000,
  perPhonePerHour: 5,
  perIpPerHour: 15,
  ticketTtlMs: 10 * 60_000,
});

/** Normalise un numéro au format international E.164 (+22901234567), ou null. */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let p = input.replace(/[\s.\-()]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/** +22901234567 -> +229 •• •• •• 67 */
export function maskPhone(p) {
  return p ? `${p.slice(0, 4)} •• •• •• ${p.slice(-2)}` : null;
}

export class OtpService {
  /**
   * @param {{ id: string, send: (to: string, msg: string) => Promise<void>, exposesCode?: boolean } | null} sms
   */
  constructor(sms, { now = () => Date.now(), appName = 'Terra Vida', log = console } = {}) {
    this.sms = sms;
    this.now = now;
    this.appName = appName;
    this.log = log;
    this.secret = crypto.randomBytes(32);
    this.codes = new Map(); // phone -> { hash, expires, attempts, sentAt }
    this.windows = new Map(); // clé de limitation -> horodatages
    this.tickets = new Map(); // ticket -> { phone, expires }
  }

  get available() {
    return !!this.sms;
  }

  hash(phone, code) {
    return crypto.createHmac('sha256', this.secret).update(`${phone}:${code}`).digest();
  }

  /** Compte un événement dans une fenêtre glissante d'une heure ; false si le plafond est atteint. */
  hit(key, max) {
    const now = this.now();
    const list = (this.windows.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= max) {
      this.windows.set(key, list);
      return false;
    }
    list.push(now);
    this.windows.set(key, list);
    return true;
  }

  /** Envoie un code. @returns {{ cooldownMs: number, devCode?: string }} */
  async request(phone, ip = 'inconnue') {
    if (!this.sms) throw new UserError('La connexion par SMS n\'est pas encore activée sur ce serveur.');
    const now = this.now();
    const prev = this.codes.get(phone);
    if (prev && now - prev.sentAt < OTP.resendMs) {
      throw new UserError(`Patiente ${Math.ceil((OTP.resendMs - (now - prev.sentAt)) / 1000)} s avant de redemander un code.`);
    }
    if (!this.hit(`ip:${ip}`, OTP.perIpPerHour)) throw new UserError('Trop de demandes depuis ta connexion. Réessaie dans une heure.');
    if (!this.hit(`phone:${phone}`, OTP.perPhonePerHour)) throw new UserError('Trop de codes envoyés à ce numéro. Réessaie dans une heure.');

    const code = String(crypto.randomInt(0, 10 ** OTP.length)).padStart(OTP.length, '0');
    const message = `${this.appName} : ton code est ${code}. Il expire dans ${OTP.ttlMs / 60_000} min. Ne le partage avec personne.`;
    try {
      await this.sms.send(phone, message);
    } catch (err) {
      this.log.error(`[sms] Échec d'envoi via ${this.sms.id} :`, err.message, err.body ?? '');
      throw new UserError('Impossible d\'envoyer le SMS. Vérifie le numéro ou réessaie plus tard.');
    }
    this.codes.set(phone, { hash: this.hash(phone, code), expires: now + OTP.ttlMs, attempts: 0, sentAt: now });
    return { cooldownMs: OTP.resendMs, ...(this.sms.exposesCode ? { devCode: code } : {}) };
  }

  /** Vérifie un code ; il est consommé en cas de succès. */
  verify(phone, code) {
    const entry = this.codes.get(phone);
    if (!entry || entry.expires < this.now()) {
      this.codes.delete(phone);
      throw new UserError('Code expiré. Demande un nouveau code.');
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new UserError('Le code contient 6 chiffres.');
    entry.attempts += 1;
    if (!crypto.timingSafeEqual(entry.hash, this.hash(phone, code))) {
      if (entry.attempts >= OTP.maxAttempts) {
        this.codes.delete(phone);
        throw new UserError('Trop d\'essais. Demande un nouveau code.');
      }
      throw new UserError(`Code incorrect (${OTP.maxAttempts - entry.attempts} essai(s) restant(s)).`);
    }
    this.codes.delete(phone);
    return true;
  }

  /** Jeton court prouvant qu'un numéro vient d'être vérifié (pour finir la création du compte). */
  issueTicket(phone) {
    const ticket = crypto.randomBytes(24).toString('hex');
    this.tickets.set(ticket, { phone, expires: this.now() + OTP.ticketTtlMs });
    return ticket;
  }

  consumeTicket(ticket) {
    const t = typeof ticket === 'string' ? this.tickets.get(ticket) : null;
    if (t) this.tickets.delete(ticket);
    return t && t.expires > this.now() ? t.phone : null;
  }
}
