// Pages HTML côté serveur : reçu imprimable et caisse de simulation.
import { PAYMENT_METHODS, formatXof, formatVida } from '../../shared/catalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = {
  paid: ['Payé', '#16a34a'],
  pending: ['En attente de paiement', '#d97706'],
  failed: ['Échoué / annulé', '#dc2626'],
  review: ['En vérification', '#7c3aed'],
};

const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light}body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;padding:16px;color:#0f172a}
.card{max-width:520px;margin:24px auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 10px 30px #0001}
h1{margin:0 0 4px;font-size:1.4rem}table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 0;border-bottom:1px solid #e2e8f0}
td:last-child{text-align:right;font-weight:600}.badge{display:inline-block;padding:4px 10px;border-radius:999px;color:#fff;font-weight:700}
.muted{color:#64748b;font-size:.85rem}button,.btn{display:inline-block;padding:10px 16px;border-radius:10px;border:0;font-weight:700;cursor:pointer;text-decoration:none;margin:4px 4px 0 0}
.pay{background:#16a34a;color:#fff}.cancel{background:#e2e8f0;color:#0f172a}@media print{.noprint{display:none}body{background:#fff}.card{box-shadow:none}}
</style></head><body><div class="card">${body}</div></body></html>`;

export function receiptPage(order, merchant) {
  const [label, color] = STATUS[order.status] ?? STATUS.pending;
  const date = (t) => (t ? new Date(t).toLocaleString('fr-FR', { timeZone: merchant.timezone }) : '—');
  return page(
    `Reçu ${order.receiptNo ?? order.id}`,
    `<h1>${order.status === 'paid' ? 'Reçu de paiement' : 'Commande'}</h1>
<div class="muted">${esc(merchant.name)}${merchant.address ? ` · ${esc(merchant.address)}` : ''}${merchant.taxId ? ` · ${esc(merchant.taxId)}` : ''}</div>
<p><span class="badge" style="background:${color}">${label}</span></p>
<table>
<tr><td>N° de reçu</td><td>${esc(order.receiptNo ?? '—')}</td></tr>
<tr><td>N° de commande</td><td>${esc(order.id)}</td></tr>
<tr><td>Joueur</td><td>${esc(order.playerName)}</td></tr>
<tr><td>Article</td><td>${formatVida(order.vida)} (monnaie Terra Vida)</td></tr>
<tr><td>Moyen de paiement</td><td>${esc(PAYMENT_METHODS[order.method]?.label ?? order.method)}</td></tr>
<tr><td>Montant</td><td>${formatXof(order.xof)}</td></tr>
<tr><td>Date de commande</td><td>${date(order.createdAt)}</td></tr>
<tr><td>Date de paiement</td><td>${date(order.paidAt)}</td></tr>
</table>
<p class="muted">Les Vida sont un contenu numérique livré immédiatement sur ton compte.${merchant.terms ? ` Conditions : <a href="${esc(merchant.terms)}">${esc(merchant.terms)}</a>.` : ''} Garde ce reçu, il te sera demandé en cas de réclamation (${esc(merchant.support)}).</p>
<div class="noprint">${order.status === 'pending' ? '<button class="cancel" onclick="location.reload()">Actualiser</button>' : ''}<button class="pay" onclick="print()">Imprimer / PDF</button><a class="btn cancel" href="/">Retour au jeu</a></div>`,
  );
}

export function sandboxPage(order) {
  return page(
    'Paiement simulé',
    `<h1>Caisse de test</h1><p class="muted">Mode simulation : aucun argent réel n'est débité. Ce mode est désactivé en production.</p>
<table><tr><td>Commande</td><td>${esc(order.id)}</td></tr><tr><td>Moyen</td><td>${esc(PAYMENT_METHODS[order.method]?.label)}</td></tr><tr><td>Montant</td><td>${formatXof(order.xof)}</td></tr></table>
<form method="post"><button class="pay" name="action" value="pay">Payer (simulation)</button><button class="cancel" name="action" value="cancel">Annuler</button></form>`,
  );
}
