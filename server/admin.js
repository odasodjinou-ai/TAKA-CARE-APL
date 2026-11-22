// Administration de la modération : traitement des signalements, sanctions, journal.
//
// Accès : un joueur est administrateur si son numéro VÉRIFIÉ PAR SMS figure dans ADMIN_PHONES
// (variable d'environnement, numéros au format international séparés par des virgules).
// Chaque message admin est revérifié côté serveur ; un client modifié ne peut rien faire de plus.
import crypto from 'node:crypto';
import { maskPhone, normalizePhone } from './auth/otp.js';
import { addStrike, mutedUntil } from './moderation.js';

export const DURATIONS = Object.freeze({
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7j': 7 * 86_400_000,
  '30j': 30 * 86_400_000,
  permanent: null,
});

export function parseAdminPhones(value = '') {
  return new Set(
    String(value)
      .split(',')
      .map((p) => normalizePhone(p.trim()))
      .filter(Boolean),
  );
}

export function isBanned(profile, now = Date.now()) {
  const b = profile?.ban;
  if (!b) return null;
  if (b.until === null || b.until > now) return b;
  return null;
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

/** Gestionnaires de messages admin, appelés avec `this` = Game. */
export const ADMIN_HANDLERS = {
  adminReports(client, { status = 'open' }) {
    if (!this.requireAdmin(client)) return;
    const reports = this.store.data.reports ?? [];
    const groups = new Map();
    for (const r of reports) {
      if (status === 'open' ? r.status !== 'open' : r.status === 'open') continue;
      if (!groups.has(r.target)) groups.set(r.target, []);
      groups.get(r.target).push(r);
    }
    const list = [...groups.entries()]
      .map(([target, rs]) => ({
        target: this.adminPlayerSummary(target),
        count: rs.length,
        reporters: new Set(rs.map((r) => r.by)).size,
        last: Math.max(...rs.map((r) => r.at)),
        reports: rs.sort((a, b) => b.at - a.at).slice(0, 20).map((r) => this.adminReportView(r)),
      }))
      .sort((a, b) => (status === 'open' ? b.reporters - a.reporters || b.last - a.last : b.last - a.last))
      .slice(0, 100);
    this.send(client, 'adminReports', { status, groups: list, openCount: reports.filter((r) => r.status === 'open').length });
  },

  adminPlayer(client, { id }) {
    if (!this.requireAdmin(client)) return;
    const p = this.store.getPlayer(id);
    if (!p) return this.error(client, 'Joueur introuvable.');
    const reports = (this.store.data.reports ?? []).filter((r) => r.target === id).sort((a, b) => b.at - a.at);
    this.send(client, 'adminPlayer', {
      player: {
        ...this.adminPlayerSummary(id),
        createdAt: p.createdAt,
        stats: p.stats,
        family: this.familyName(p),
        strikes: (p.moderation?.strikes ?? []).length,
      },
      recentMessages: this.chatLog.filter((m) => m.playerId === id).slice(-30).reverse().map((m) => ({ id: m.id, text: m.text, at: m.at, room: m.room })),
      reports: reports.slice(0, 50).map((r) => this.adminReportView(r)),
      reportsMade: (this.store.data.reports ?? []).filter((r) => r.by === id).length,
      audit: (this.store.data.audit ?? []).filter((a) => a.target === id).slice(-30).reverse(),
    });
  },

  adminSearch(client, { q }) {
    if (!this.requireAdmin(client)) return;
    const query = clean(q, 30).toLowerCase();
    if (query.length < 2) return this.send(client, 'adminSearch', { players: [] });
    const players = Object.values(this.store.data.players)
      .filter((p) => p.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((p) => this.adminPlayerSummary(p.id));
    this.send(client, 'adminSearch', { players });
  },

  adminLog(client) {
    if (!this.requireAdmin(client)) return;
    this.send(client, 'adminLog', { entries: (this.store.data.audit ?? []).slice(-200).reverse() });
  },

  /**
   * Action sur un joueur. action : dismiss | warn | mute | unmute | ban | unban
   * Les signalements ouverts visés (reportIds, ou tous ceux du joueur) sont clos avec cette action.
   */
  adminAction(client, { target, action, duration, reason, reportIds }) {
    if (!this.requireAdmin(client)) return;
    const p = this.store.getPlayer(target);
    if (!p) return this.error(client, 'Joueur introuvable.');
    const ACTIONS = ['dismiss', 'warn', 'mute', 'unmute', 'ban', 'unban'];
    if (!ACTIONS.includes(action)) return this.error(client, 'Action inconnue.');
    const why = clean(reason, 200);
    if (['warn', 'mute', 'ban'].includes(action)) {
      if (this.isAdminProfile(p)) return this.error(client, 'Impossible de sanctionner un autre administrateur.');
      if (!why) return this.error(client, 'Indique un motif : il est montré au joueur et gardé dans le journal.');
    }
    const now = this.now();
    const tc = this.findOnline(p.id);
    const durMs = DURATIONS[duration];
    if (['mute', 'ban'].includes(action) && durMs === undefined) return this.error(client, 'Durée invalide.');
    if (action === 'mute' && durMs === null) return this.error(client, 'Un silence doit avoir une durée.');
    const until = durMs === null ? null : now + (durMs ?? 0);
    const fmt = (t) => (t === null ? 'définitivement' : `jusqu'au ${new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`);

    switch (action) {
      case 'warn':
        addStrike(p, 1, now);
        if (tc) this.toast(tc, `⚠️ Avertissement de la modération : ${why}`, 'warn');
        break;
      case 'mute':
        p.moderation ??= { strikes: [], mutes: 0, mutedUntil: 0 };
        p.moderation.mutedUntil = until;
        p.moderation.mutes += 1;
        if (tc) this.toast(tc, `🔇 La modération t'a réduit au silence ${fmt(until)}. Motif : ${why}`, 'error');
        break;
      case 'unmute':
        if (p.moderation) p.moderation.mutedUntil = 0;
        if (tc) this.toast(tc, '🔊 Tu peux de nouveau écrire dans le chat.', 'success');
        break;
      case 'ban':
        p.ban = { until, reason: why, by: client.profile.name, at: now };
        if (tc) {
          this.send(tc, 'banned', { reason: why, until });
          this.disconnect(tc);
          tc.ws.close();
        }
        break;
      case 'unban':
        p.ban = null;
        break;
      default:
        break; // dismiss : aucun effet sur le joueur
    }

    // Clôture des signalements
    const ids = Array.isArray(reportIds) ? new Set(reportIds) : null;
    let closed = 0;
    for (const r of this.store.data.reports ?? []) {
      if (r.target !== p.id || r.status !== 'open' || (ids && !ids.has(r.id))) continue;
      r.status = action === 'dismiss' ? 'dismissed' : 'handled';
      r.handledBy = client.profile.name;
      r.handledAt = now;
      r.action = action;
      closed++;
    }
    this.store.data.audit ??= [];
    this.store.data.audit.push({ id: crypto.randomUUID(), at: now, admin: client.profile.name, adminId: client.profile.id, action, target: p.id, targetName: p.name, duration: duration ?? null, until: ['mute', 'ban'].includes(action) ? until : undefined, reason: why, reportsClosed: closed });
    if (this.store.data.audit.length > 5000) this.store.data.audit.splice(0, this.store.data.audit.length - 5000);
    this.store.save();
    console.warn(`[admin] ${client.profile.name} : ${action} sur ${p.name}${why ? ` (${why})` : ''}`);

    const LABEL = { dismiss: 'Signalements classés', warn: 'Avertissement envoyé', mute: 'Joueur réduit au silence', unmute: 'Silence levé', ban: 'Joueur banni', unban: 'Bannissement levé' };
    this.toast(client, `✅ ${LABEL[action]} — ${p.name}${closed ? ` (${closed} signalement(s) clos)` : ''}`, 'success');
    this.notifyAdmins();
    ADMIN_HANDLERS.adminPlayer.call(this, client, { id: p.id });
  },
};

/** Méthodes ajoutées à Game. */
export const AdminMixin = {
  isAdminProfile(profile) {
    return !!profile?.phone && this.adminPhones.has(profile.phone);
  },

  requireAdmin(client) {
    if (this.isAdminProfile(client.profile)) return true;
    this.error(client, 'Accès réservé à la modération.');
    return false;
  },

  adminPlayerSummary(id) {
    const p = this.store.getPlayer(id);
    if (!p) return { id, name: '(compte supprimé)' };
    const now = this.now();
    const ban = isBanned(p, now);
    return {
      id,
      name: p.name,
      phone: maskPhone(p.phone),
      online: !!this.findOnline(id),
      mutedUntil: mutedUntil(p, now) || null,
      mutes: p.moderation?.mutes ?? 0,
      ban: ban ? { until: ban.until, reason: ban.reason, by: ban.by } : null,
      isAdmin: this.isAdminProfile(p),
    };
  },

  adminReportView(r) {
    return { id: r.id, at: r.at, by: r.byName, text: r.text, reason: r.reason, status: r.status, action: r.action ?? null, handledBy: r.handledBy ?? null, msgId: r.msgId };
  },

  /** Prévient les administrateurs connectés (badge du nombre de signalements ouverts). */
  notifyAdmins(newReport = null) {
    const openCount = (this.store.data.reports ?? []).filter((r) => r.status === 'open').length;
    for (const c of this.clients) {
      if (!c.profile || !this.isAdminProfile(c.profile)) continue;
      this.send(c, 'adminBadge', { openCount });
      if (newReport) this.toast(c, `🛡️ Nouveau signalement contre ${newReport.targetName}`, 'warn');
    }
  },
};
