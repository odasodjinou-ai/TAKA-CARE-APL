// Interface : notifications, panneaux (métiers, boutique, aéroport, famille…), minicarte.
// Toutes les données venant d'autres joueurs passent par textContent (pas d'injection HTML).
import { COUNTRIES, COUNTRY_BY_CODE, REGIONS } from '/shared/countries.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  JOBS, ITEMS, itemsBySlot, flightPrice, formatMoney, formatVida, formatXof, formatPrice, FAMILY_CREATION_COST,
  VIDA_PACKS, PREMIUM, EXCHANGE, PAYMENT_METHODS,
} from '/shared/catalog.js';
import { VEHICLES, VEHICLE_BY_ID, BRANDS, CATEGORIES } from '/shared/vehicles.js';
import { createCar, disposeCar } from './vehicles.js';
import { LOTS, LOT_BY_ID, HOUSE_TIERS, MAX_HOUSES_PER_FAMILY, SELL_REFUND, RESIDENTIAL, devicesFor } from '/shared/houses.js';
import { ROAD_LINES, WORLD, PLACES } from '/shared/layout.js';

export const $ = (sel) => document.querySelector(sel);

/** Petit créateur d'éléments DOM : h('div', {class:'x', onclick}, 'texte', enfant) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(message, kind = 'info', action) {
  const el = h('div', { class: `toast ${kind}` }, message);
  if (action) el.append(h('button', { class: 'btn blue', onclick: () => (action.fn(), el.remove()) }, action.label));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), action ? 30000 : 4000);
}

// --- Panneau générique ----------------------------------------------------------
let currentPanel = null;
let renderCurrent = null;

export function openPanel(id, title, render) {
  currentPanel = id;
  renderCurrent = render;
  $('#panel-title').textContent = title;
  document.querySelector('.panel-card').classList.toggle('wide', id === 'admin');
  document.querySelector('.panel-card').classList.toggle('narrow', id === 'phone');
  $('#panel').classList.remove('hidden');
  refreshPanel();
}

export function refreshPanel() {
  if (!renderCurrent) return;
  const body = $('#panel-body');
  const scroll = body.scrollTop;
  body.replaceChildren(renderCurrent());
  body.scrollTop = scroll;
}

export function closePanel() {
  if (currentPanel === 'phone') window.dispatchEvent(new Event('phoneclosed'));
  currentPanel = null;
  renderCurrent = null;
  $('#panel').classList.add('hidden');
}

export const panelOpen = () => currentPanel;

// --- Contenu des panneaux ---------------------------------------------------------
export const PANELS = {
  jobs(game) {
    const m = game.mission;
    return h(
      'div',
      {},
      m ? h('p', {}, `Métier actuel : ${JOBS[m.job].icon} ${JOBS[m.job].name}. `, h('button', { class: 'btn danger', onclick: () => game.net.send('jobQuit') }, 'Démissionner')) : h('p', { class: 'muted' }, 'Choisis un métier. Chaque mission réussie te rapporte de l\'argent ; une nouvelle mission arrive aussitôt.'),
      h(
        'ul',
        { class: 'list' },
        Object.values(JOBS).map((j) =>
          h(
            'li',
            {},
            h('div', {}, h('div', {}, `${j.icon} `, h('b', {}, j.name)), h('div', { class: 'meta' }, `${j.desc} — ${formatMoney(j.reward[0])} à ${formatMoney(j.reward[1])} / mission`)),
            h('button', { class: 'btn primary', disabled: m?.job === j.id, onclick: () => (game.net.send('jobStart', { job: j.id }), closePanel()) }, m?.job === j.id ? 'En cours' : 'Travailler'),
          ),
        ),
      ),
    );
  },

  shop(game) {
    return shopList(game, ['hair', 'top', 'hat'], 'shop');
  },

  cars(game) {
    const p = game.profile;
    const owned = new Set(p.owned);
    game.dealer ??= { cat: 'all', sel: p.skin.car };
    const d = game.dealer;
    const v = VEHICLE_BY_ID.get(d.sel) ?? VEHICLES[0];
    const id = `car:${v.id}`;
    const has = owned.has(id);
    const it = ITEMS[id];
    const equipped = p.skin.car === v.id;
    const brand = BRANDS[v.brand];
    const list = VEHICLES.filter((x) => d.cat === 'all' || x.body === d.cat || (d.cat === 'electric' && x.electric) || (d.cat === 'premium' && (x.premiumOnly || x.currency === 'vida')));
    const zeroTo100 = (100 / 3.6 / (v.accel / 1.15) / 1.6).toFixed(1);
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'tabs' },
        [['all', 'Tous'], ...Object.entries(CATEGORIES), ['electric', '⚡ Électriques'], ['premium', '💎 Luxe & Premium']].map(([k, label]) =>
          h('button', { class: `btn ${d.cat === k ? 'active' : ''}`, onclick: () => ((d.cat = k), refreshPanel()) }, label),
        ),
      ),
      h('div', { class: 'sticky' }, carPreview(v.id, p.skin.carColor),
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          { style: 'flex:1' },
          h('div', {}, `${brand.flag} `, h('b', {}, v.name), v.premiumOnly ? ' ⭐' : '', v.electric ? ' ⚡' : ''),
          h('div', { class: 'spec' }, `${CATEGORIES[v.body]} · ${brand.origin} · ${v.kmh} km/h · 0-100 en ${zeroTo100} s`),
          h('div', {}, h('b', {}, v.price ? formatPrice(v.price, v.currency) : 'Offert')),
        ),
        has
          ? h('button', { class: 'btn', disabled: equipped, onclick: () => game.saveSkin({ car: v.id }) }, equipped ? 'Ton véhicule' : 'Choisir')
          : h(
              'button',
              { class: 'btn primary', disabled: !canAfford(p, it) || (v.premiumOnly && !p.premium?.active), onclick: () => game.net.send('buy', { item: id }) },
              v.premiumOnly && !p.premium?.active ? 'Premium requis' : 'Acheter',
            ),
      ),
      ),
      h('div', { class: 'row' }, h('label', {}, 'Couleur de la peinture', h('input', { type: 'color', value: p.skin.carColor, onchange: (e) => game.saveSkin({ carColor: e.target.value }) }))),
      h(
        'ul',
        { class: 'list' },
        list.map((x) =>
          h(
            'li',
            { class: owned.has(`car:${x.id}`) ? 'owned' : '', style: `cursor:pointer;${x.id === v.id ? 'border-color:#0ea5e9' : ''}`, onclick: () => ((d.sel = x.id), refreshPanel()) },
            h('div', {}, `${BRANDS[x.brand].flag} `, h('b', {}, x.name), x.premiumOnly ? ' ⭐' : '', h('div', { class: 'meta' }, `${CATEGORIES[x.body]} · ${x.kmh} km/h`)),
            h('span', { class: 'meta' }, owned.has(`car:${x.id}`) ? '✔ Possédé' : x.price ? formatPrice(x.price, x.currency) : 'Offert'),
          ),
        ),
      ),
      h('p', { class: 'muted' }, 'Marques fictives inspirées des constructeurs du monde entier.'),
    );
  },

  vida(game) {
    const p = game.profile;
    const pay = (game.pay ??= { tab: 'buy', pack: VIDA_PACKS[1].id, method: null, methods: null, receipts: null, pending: null });
    if (!pay.methods) game.net.send('payInfo');
    const tab = (k, label) => h('button', { class: `btn ${pay.tab === k ? 'active' : ''}`, onclick: () => ((pay.tab = k), k === 'history' && game.net.send('receipts'), refreshPanel()) }, label);
    const header = h(
      'div',
      {},
      h('p', {}, 'Solde : ', h('b', { style: 'color:#c4b5fd' }, formatVida(p.vida ?? 0)), p.premium?.active ? ` · ⭐ Premium jusqu'au ${new Date(p.premium.until).toLocaleDateString('fr-FR')}` : ''),
      h('div', { class: 'tabs' }, tab('buy', '💳 Acheter des Vida'), tab('premium', '⭐ Premium'), tab('exchange', '🐚 Changer en Cauris'), tab('history', '🧾 Reçus')),
    );
    let body;
    if (pay.tab === 'buy') {
      const pack = VIDA_PACKS.find((x) => x.id === pay.pack);
      const methods = pay.methods ?? [];
      const method = methods.find((m) => m.id === pay.method && m.enabled);
      body = h(
        'div',
        {},
        h('p', { class: 'muted' }, 'Les Vida sont la monnaie de l\'application : Premium, véhicules de luxe, change en Cauris. Chaque paiement donne un reçu.'),
        h(
          'div',
          { class: 'grid' },
          VIDA_PACKS.map((x) =>
            h('div', { class: `pack ${x.id === pay.pack ? 'sel' : ''}`, onclick: () => ((pay.pack = x.id), refreshPanel()) }, h('div', { class: 'v' }, formatVida(x.vida)), h('div', {}, formatXof(x.xof)), x.bonus ? h('div', { class: 'bonus' }, `Bonus ${x.bonus}`) : null),
          ),
        ),
        h('div', { class: 'region-title' }, 'Moyen de paiement'),
        methods.length === 0
          ? h('p', { class: 'muted' }, 'Chargement…')
          : h(
              'div',
              { class: 'grid' },
              methods.map((m) =>
                h(
                  'button',
                  { class: `btn method ${m.id === pay.method ? 'active' : ''}`, disabled: !m.enabled, title: m.enabled ? `via ${m.via}` : 'Pas encore activé', onclick: () => ((pay.method = m.id), refreshPanel()) },
                  h('span', { class: 'sw', style: `background:${m.color}` }),
                  m.label,
                ),
              ),
            ),
        methods.length && !methods.some((m) => m.enabled) ? h('p', { class: 'muted' }, 'Aucun moyen de paiement n\'est encore activé sur ce serveur.') : null,
        h(
          'button',
          {
            class: 'btn primary big',
            disabled: !method || !pack,
            onclick: () => {
              // Ouvre l'onglet tout de suite (sinon le navigateur bloque la fenêtre)
              pay.window = window.open('about:blank', '_blank');
              game.net.send('payCreate', { pack: pack.id, method: method.id });
            },
          },
          method ? `Payer ${formatXof(pack.xof)} avec ${method.label}` : 'Choisis un moyen de paiement',
        ),
        pay.pending ? pendingView(game, pay) : null,
      );
    } else if (pay.tab === 'premium') {
      const price = p.premium?.nextPrice ?? PREMIUM.firstPrice;
      body = h(
        'div',
        { class: 'premium-card' },
        h('h3', { style: 'margin-top:0' }, '⭐ Titre Premium — 3 mois'),
        h(
          'ul',
          {},
          h('li', {}, 'Badge ⭐ doré à côté de ton pseudo, visible par tous'),
          h('li', {}, `+${PREMIUM.jobBonus * 100} % de salaire sur tous les métiers`),
          h('li', {}, `−${PREMIUM.flightDiscount * 100} % sur les billets d'avion`),
          h('li', {}, 'Accès aux véhicules exclusifs (Rossa Tempesta, Aurora Volt S…)'),
        ),
        h('p', {}, p.premium?.active ? `Actif jusqu'au ${new Date(p.premium.until).toLocaleDateString('fr-FR')}. Renouveler ajoute 3 mois.` : 'Inactif.'),
        h('p', {}, h('b', {}, `${formatVida(price)} (${formatXof(price * 10)})`), price === PREMIUM.firstPrice ? ' — tarif de bienvenue pour ton 1er abonnement' : ' — tarif de renouvellement'),
        h(
          'button',
          { class: 'btn primary big', disabled: (p.vida ?? 0) < price, onclick: () => confirm(`Activer Premium pour ${formatVida(price)} ?`) && game.net.send('premiumBuy') },
          (p.vida ?? 0) < price ? `Il te faut ${formatVida(price)} — recharge d'abord` : p.premium?.active ? 'Prolonger de 3 mois' : 'Devenir Premium',
        ),
      );
    } else if (pay.tab === 'exchange') {
      body = h(
        'ul',
        { class: 'list' },
        EXCHANGE.map((e) =>
          h('li', {}, h('div', {}, h('b', {}, formatVida(e.vida)), ' → ', h('b', {}, formatMoney(e.cauris))), h('button', { class: 'btn primary', disabled: (p.vida ?? 0) < e.vida, onclick: () => game.net.send('exchange', { id: e.id }) }, 'Changer')),
        ),
      );
    } else {
      body = h(
        'div',
        {},
        h('div', { class: 'region-title' }, 'Paiements'),
        !pay.receipts
          ? h('p', { class: 'muted' }, 'Chargement…')
          : pay.receipts.length === 0
            ? h('p', { class: 'muted' }, 'Aucun paiement pour l\'instant.')
            : h(
                'ul',
                { class: 'list' },
                pay.receipts.map((o) =>
                  h(
                    'li',
                    {},
                    h('div', {}, h('b', {}, `${formatVida(o.vida)} — ${formatXof(o.xof)}`), h('div', { class: 'meta' }, `${new Date(o.createdAt).toLocaleString('fr-FR')} · ${PAYMENT_METHODS[o.method]?.label ?? o.method}${o.receiptNo ? ` · ${o.receiptNo}` : ''}`)),
                    h('div', {}, statusBadge(o.status), ' ', h('a', { class: 'btn', href: o.receiptUrl, target: '_blank', rel: 'noopener' }, '🧾 Reçu')),
                  ),
                ),
              ),
        h('div', { class: 'region-title' }, 'Mouvements de Vida'),
        h('ul', { class: 'list' }, (p.vidaLog ?? []).map((l) => h('li', {}, h('span', { class: 'meta' }, `${new Date(l.at).toLocaleDateString('fr-FR')} · ${l.label}`), h('b', { style: `color:${l.delta > 0 ? '#4ade80' : '#fca5a5'}` }, `${l.delta > 0 ? '+' : ''}${formatVida(l.delta)}`)))),
      );
    }
    return h('div', {}, header, body);
  },

  airport(game) {
    let filter = '';
    const wrap = h('div', {});
    const list = h('div', {});
    const draw = () => {
      const from = game.country;
      const groups = {};
      for (const c of COUNTRIES) {
        if (c.code === from) continue;
        if (filter && !c.name.toLowerCase().includes(filter)) continue;
        (groups[c.region] ??= []).push(c);
      }
      list.replaceChildren(
        ...Object.entries(REGIONS)
          .filter(([r]) => groups[r])
          .flatMap(([r, name]) => [
            h('div', { class: 'region-title' }, name),
            h(
              'ul',
              { class: 'list', style: 'max-height:none;margin:0' },
              groups[r].map((c) => {
                const price = flightPrice(from, c.code);
                return h(
                  'li',
                  {},
                  h('div', {}, `${c.flag} `, h('b', {}, c.name), h('div', { class: 'meta' }, c.airport)),
                  h('button', { class: 'btn blue', disabled: game.profile.money < price, onclick: () => game.net.send('flight', { to: c.code }) }, `✈ ${formatMoney(price)}`),
                );
              }),
            ),
          ]),
      );
    };
    const search = h('input', { placeholder: 'Rechercher un pays…', oninput: (e) => ((filter = e.target.value.trim().toLowerCase()), draw()) });
    wrap.append(h('p', { class: 'muted' }, `Tu es à : ${COUNTRY_BY_CODE.get(game.country).flag} ${COUNTRY_BY_CODE.get(game.country).name}. Vol régional : ${formatMoney(400)} · International : ${formatMoney(1100)}.`), search, list);
    draw();
    setTimeout(() => search.focus(), 0);
    return wrap;
  },

  wardrobe(game) {
    const p = game.profile;
    const skin = { ...p.skin };
    const owned = new Set(p.owned);
    const color = (key, label) =>
      h('label', {}, label, h('input', { type: 'color', value: skin[key], oninput: (e) => ((skin[key] = e.target.value), game.previewSkin(skin)) }));
    const select = (slot, label) =>
      h(
        'label',
        {},
        label,
        h(
          'select',
          { onchange: (e) => ((skin[slot] = e.target.value), game.previewSkin(skin)) },
          itemsBySlot(slot)
            .filter((it) => owned.has(it.id))
            .map((it) => h('option', { value: it.value, selected: skin[slot] === it.value }, it.name)),
        ),
      );
    return h(
      'div',
      {},
      h('p', { class: 'muted' }, 'Change ton apparence gratuitement. Achète de nouveaux vêtements à la boutique.'),
      h('div', { class: 'row' }, color('tone', 'Teint'), color('hairColor', 'Cheveux')),
      h('div', { class: 'row' }, color('topColor', 'Haut'), color('pants', 'Pantalon')),
      h('div', { class: 'row' }, select('hair', 'Coiffure'), select('top', 'Haut'), select('hat', 'Chapeau')),
      h('button', { class: 'btn primary big', onclick: () => (game.saveSkin(skin), closePanel()) }, 'Enregistrer'),
    );
  },

  family(game) {
    const p = game.profile;
    const fam = p.family;
    if (!fam) {
      const input = h('input', { placeholder: 'Nom de la famille', maxlength: 20 });
      return h(
        'div',
        {},
        h('p', {}, 'Tu n\'as pas encore de famille. Crée-la et invite les joueurs proches de toi, ou attends une invitation.'),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => game.net.send('familyCreate', { name: input.value }) }, `Créer (${formatMoney(FAMILY_CREATION_COST)})`)),
      );
    }
    const nearby = game.nearbyPlayers().filter((pl) => !pl.family);
    return h(
      'div',
      {},
      h('p', {}, 'Famille ', h('b', {}, fam.name), ` — ${fam.members.length} membre(s). Discute avec elle via le canal « Famille » du chat.`),
      h(
        'ul',
        { class: 'list' },
        fam.members.map((m) =>
          h(
            'li',
            {},
            h('div', {}, h('span', { class: `dot ${m.online ? 'on' : ''}` }), m.name, m.id === fam.ownerId ? ' 👑' : '', m.id === p.id ? ' (toi)' : ''),
            m.id !== p.id
              ? h('button', {
                  class: 'btn',
                  onclick: () => {
                    const amount = Number.parseInt(prompt(`Combien envoyer à ${m.name} ? (tu as ${formatMoney(p.money)})`) ?? '', 10);
                    if (amount > 0) game.net.send('familyGift', { to: m.id, amount });
                  },
                }, '💸 Envoyer de l\'argent')
              : null,
          ),
        ),
      ),
      familyTreasury(game, fam),
      h('div', { class: 'region-title' }, 'Joueurs proches à inviter'),
      nearby.length
        ? h('ul', { class: 'list' }, nearby.map((pl) => h('li', {}, pl.name, h('button', { class: 'btn blue', onclick: () => game.net.send('familyInvite', { sid: pl.sid }) }, 'Inviter'))))
        : h('p', { class: 'muted' }, 'Aucun joueur sans famille à proximité (40 m).'),
      h('button', { class: 'btn danger', onclick: () => confirm('Quitter la famille ?') && game.net.send('familyLeave') }, 'Quitter la famille'),
    );
  },

  help() {
    const rows = [
      ['Z/Q/S/D ou W/A/S/D ou flèches', 'Se déplacer / conduire'],
      ['Clic + glisser souris', 'Tourner la caméra (molette : zoom)'],
      ['Maj', 'Courir'],
      ['Espace', 'Sauter / frein à main'],
      ['E', 'Interagir (emplois, boutique, concession, aéroport)'],
      ['V', 'Sortir / ranger ton véhicule'],
      ['Espace (en voiture)', 'Frein à main / dérapage'],
      ['B · M', 'Klaxon · couper le son'],
      ['P', '💎 Vida, Premium et reçus'],
      ['C · G · H', 'Garde-robe · Famille · Aide'],
      ['T', '📱 Téléphone : maison connectée, caméras, garage'],
      ['Entrée', 'Discuter'],
    ];
    return h(
      'div',
      {},
      h('ul', { class: 'list' }, rows.map(([k, v]) => h('li', {}, h('kbd', {}, k), h('span', { class: 'meta' }, v)))),
      h(
        'p',
        { class: 'muted' },
        'Gagne de l\'argent avec un métier à l\'agence pour l\'emploi (bâtiment bleu), achète des vêtements (rose) et des voitures (orange), puis prends l\'avion à l\'aéroport (à l\'est de la ville) pour visiter les autres pays.',
      ),
    );
  },
};

const canAfford = (p, it) => (it.currency === 'vida' ? (p.vida ?? 0) >= it.price : p.money >= it.price);

function shopList(game, slots, place) {
  const p = game.profile;
  const owned = new Set(p.owned);
  return h(
    'div',
    {},
    h('p', {}, 'Ton solde : ', h('b', {}, formatMoney(p.money)), ' · ', h('b', {}, formatVida(p.vida ?? 0))),
    slots.map((slot) =>
      h(
        'ul',
        { class: 'list', style: 'max-height:none' },
        itemsBySlot(slot).map((it) => {
          const has = owned.has(it.id);
          const equipped = p.skin[slot] === it.value;
          return h(
            'li',
            { class: has ? 'owned' : '' },
            h('div', {}, h('b', {}, it.name), h('div', { class: 'meta' }, it.price ? formatPrice(it.price, it.currency) : 'Gratuit')),
            has
              ? h('button', { class: 'btn', disabled: equipped, onclick: () => game.saveSkin({ [slot]: it.value }) }, equipped ? 'Équipé' : 'Équiper')
              : h('button', { class: 'btn primary', disabled: !canAfford(p, it), onclick: () => game.net.send('buy', { item: it.id }) }, 'Acheter'),
          );
        }),
      ),
    ),
    place === 'shop' ? h('p', { class: 'muted' }, 'Les couleurs se changent gratuitement dans la garde-robe (C).') : null,
  );
}

export { ITEMS };

// --- Minicarte -------------------------------------------------------------------
export function drawMinimap(canvas, { pos, yaw, remotes, mission, houses, myFamily }) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const range = 160; // mètres affichés du centre au bord
  const k = S / 2 / range;
  const tx = (x) => S / 2 + (x - pos.x) * k;
  const tz = (z) => S / 2 + (z - pos.z) * k;
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = WORLD.roadWidth * k;
  ctx.beginPath();
  for (const l of ROAD_LINES) {
    ctx.moveTo(tx(l), tz(-185));
    ctx.lineTo(tx(l), tz(185));
    ctx.moveTo(tx(-185), tz(l));
    ctx.lineTo(tx(185), tz(l));
  }
  ctx.moveTo(tx(180), tz(0));
  ctx.lineTo(tx(260), tz(0));
  ctx.moveTo(tx(RESIDENTIAL.fromX), tz(0));
  ctx.lineTo(tx(RESIDENTIAL.toX), tz(0));
  ctx.stroke();
  // Maisons : vertes = ta famille, grises = vendues, contour = à vendre
  for (const lot of LOTS) {
    const o = houses?.get(lot.id);
    const hs = lot.house;
    ctx.fillStyle = o ? (o.familyId === myFamily ? '#22c55e' : '#64748b') : '#334155';
    ctx.fillRect(tx(hs.x - hs.w / 2), tz(hs.z - hs.d / 2), hs.w * k, hs.d * k);
  }
  ctx.fillStyle = '#334155';
  ctx.fillRect(tx(325), tz(-320), 40 * k, 640 * k); // piste
  for (const p of Object.values(PLACES)) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(tx(p.door.x), tz(p.door.z), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#38bdf8';
  for (const r of remotes) {
    ctx.beginPath();
    ctx.arc(tx(r.x), tz(r.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (mission) {
    // Cible ramenée au bord si hors de portée
    let mx = tx(mission.x) - S / 2;
    let mz = tz(mission.z) - S / 2;
    const d = Math.hypot(mx, mz);
    if (d > S / 2 - 8) {
      mx *= (S / 2 - 8) / d;
      mz *= (S / 2 - 8) / d;
    }
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(S / 2 + mx, S / 2 + mz, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Joueur (triangle orienté)
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-yaw);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(5, -5);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const STATUS_LABEL = { paid: 'Payé', pending: 'En attente', failed: 'Échoué', review: 'Vérification' };
function statusBadge(status) {
  return h('span', { class: `status ${status}` }, STATUS_LABEL[status] ?? status);
}

function pendingView(game, pay) {
  const o = pay.pending.order;
  return h(
    'div',
    { class: 'premium-card', style: 'margin-top:12px' },
    h('div', {}, 'Commande ', h('b', {}, o.id), ' ', statusBadge(o.status)),
    o.status === 'pending'
      ? h(
          'div',
          {},
          h('p', { class: 'muted' }, 'Termine le paiement dans l\'onglet ouvert. Tes Vida arrivent automatiquement dès confirmation.'),
          h('a', { class: 'btn blue', href: pay.pending.redirectUrl, target: '_blank', rel: 'noopener' }, 'Ouvrir la page de paiement'),
          ' ',
          h('button', { class: 'btn', onclick: () => game.net.send('payCheck', { id: o.id }) }, 'J\'ai payé — vérifier'),
        )
      : h('p', {}, o.status === 'paid' ? `✅ +${formatVida(o.vida)} crédités. ` : 'Le paiement n\'a pas abouti. ', h('a', { class: 'btn', href: o.receiptUrl, target: '_blank', rel: 'noopener' }, '🧾 Voir le reçu')),
  );
}

// --- Aperçu 3D des véhicules (concession) -------------------------------------------------------
let preview = null;
function carPreview(model, color) {
  if (!preview) {
    const canvas = h('canvas', { id: 'car-preview' });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(4, 8, 6);
    scene.add(sun, new THREE.AmbientLight('#ffffff', 0.4));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.2 }));
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(35, 2.8, 0.1, 100);
    preview = { canvas, renderer, scene, camera, car: null, key: '', running: false };
  }
  const key = `${model}|${color}`;
  if (preview.key !== key) {
    if (preview.car) {
      preview.scene.remove(preview.car);
      disposeCar(preview.car);
    }
    preview.car = createCar(model, color);
    preview.scene.add(preview.car);
    preview.key = key;
    const box = new THREE.Box3().setFromObject(preview.car);
    const size = box.getSize(new THREE.Vector3()).length();
    preview.camera.position.set(size * 0.75, size * 0.32, size * 0.75);
    preview.camera.lookAt(0, size * 0.08, 0);
  }
  if (!preview.running) {
    preview.running = true;
    const loop = (t) => {
      if (!preview.canvas.isConnected) {
        preview.running = false;
        return;
      }
      const w = preview.canvas.clientWidth;
      const hgt = preview.canvas.clientHeight;
      if (preview.canvas.width !== Math.floor(w * preview.renderer.getPixelRatio())) {
        preview.renderer.setSize(w, hgt, false);
        preview.camera.aspect = w / hgt;
        preview.camera.updateProjectionMatrix();
      }
      preview.car.rotation.y = t * 0.0005;
      preview.renderer.render(preview.scene, preview.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return preview.canvas;
}

// --- Connexion par téléphone (code SMS) ---------------------------------------------------
// Indicatifs les plus courants ; « Autre » permet de taper n'importe quel indicatif (+xxx…).
export const CALLING_CODES = [
  ['+229', '🇧🇯 Bénin'], ['+228', '🇹🇬 Togo'], ['+225', '🇨🇮 Côte d\'Ivoire'], ['+221', '🇸🇳 Sénégal'], ['+226', '🇧🇫 Burkina Faso'],
  ['+223', '🇲🇱 Mali'], ['+227', '🇳🇪 Niger'], ['+224', '🇬🇳 Guinée'], ['+237', '🇨🇲 Cameroun'], ['+241', '🇬🇦 Gabon'],
  ['+242', '🇨🇬 Congo'], ['+243', '🇨🇩 RD Congo'], ['+235', '🇹🇩 Tchad'], ['+236', '🇨🇫 Centrafrique'], ['+222', '🇲🇷 Mauritanie'],
  ['+261', '🇲🇬 Madagascar'], ['+250', '🇷🇼 Rwanda'], ['+257', '🇧🇮 Burundi'], ['+253', '🇩🇯 Djibouti'], ['+269', '🇰🇲 Comores'],
  ['+234', '🇳🇬 Nigeria'], ['+233', '🇬🇭 Ghana'], ['+254', '🇰🇪 Kenya'], ['+27', '🇿🇦 Afrique du Sud'], ['+212', '🇲🇦 Maroc'],
  ['+213', '🇩🇿 Algérie'], ['+216', '🇹🇳 Tunisie'], ['+20', '🇪🇬 Égypte'], ['+509', '🇭🇹 Haïti'], ['+33', '🇫🇷 France'],
  ['+32', '🇧🇪 Belgique'], ['+41', '🇨🇭 Suisse'], ['+49', '🇩🇪 Allemagne'], ['+39', '🇮🇹 Italie'], ['+34', '🇪🇸 Espagne'],
  ['+351', '🇵🇹 Portugal'], ['+44', '🇬🇧 Royaume-Uni'], ['+1', '🇺🇸 🇨🇦 États-Unis / Canada'], ['+55', '🇧🇷 Brésil'], ['+86', '🇨🇳 Chine'],
  ['+91', '🇮🇳 Inde'], ['', '🌐 Autre (tape +indicatif)'],
];
// Pays où le 0 initial fait partie du numéro national (numérotation à 10 chiffres)
const KEEP_ZERO = new Set(['+229', '+225']);

export function buildPhone(cc, num) {
  const n = String(num).replace(/[\s.\-()]/g, '');
  if (n.startsWith('+') || n.startsWith('00') || !cc) return n.startsWith('00') ? `+${n.slice(2)}` : n;
  return cc + (KEEP_ZERO.has(cc) ? n : n.replace(/^0/, ''));
}

/**
 * Formulaire en 3 étapes : numéro -> code -> (nouveau compte) pseudo et pays.
 * @param {'login'|'link'} mode
 */
export function phoneFlow(game, mode) {
  const f = (game.phone ??= { step: 'phone', cc: '+229', num: '', phone: null, masked: null, until: 0, dev: null, ticket: null, busy: false });
  const busyBtn = (label, onclick, cls = 'btn primary big') => h('button', { class: cls, type: 'button', disabled: f.busy, onclick }, f.busy ? 'Patiente…' : label);
  if (game.smsAvailable === false) return h('p', { class: 'muted' }, 'La connexion par SMS n\'est pas encore activée sur ce serveur.');

  if (f.step === 'phone') {
    const num = h('input', { class: 'phone-num', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', placeholder: f.cc === '+229' ? '01 23 45 67 89' : 'Ton numéro', value: f.num, oninput: (e) => (f.num = e.target.value) });
    const send = () => {
      f.phone = buildPhone(f.cc, f.num);
      f.busy = true;
      game.net.send('otpRequest', { phone: f.phone });
      game.rerenderPhone();
    };
    num.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), send()));
    return h(
      'div',
      {},
      h('label', {}, mode === 'link' ? 'Ton numéro de téléphone' : 'Numéro de téléphone'),
      h('div', { class: 'row nowrap' }, h('select', { class: 'phone-cc', style: 'width:42%', onchange: (e) => ((f.cc = e.target.value), game.rerenderPhone()) }, CALLING_CODES.map(([c, label]) => h('option', { value: c, selected: c === f.cc }, `${label} ${c}`))), num),
      busyBtn('Recevoir le code par SMS', send),
      h('p', { class: 'muted' }, 'Un SMS avec un code à 6 chiffres va t\'être envoyé. Ton numéro reste privé : il n\'est jamais montré aux autres joueurs.'),
    );
  }

  if (f.step === 'code') {
    const code = h('input', { class: 'otp-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '••••••', style: 'font-size:1.6rem;letter-spacing:0.4em;text-align:center' });
    const verify = () => {
      f.busy = true;
      game.net.send('otpVerify', { phone: f.phone, code: code.value.replace(/\D/g, '') });
      game.rerenderPhone();
    };
    code.addEventListener('input', () => code.value.replace(/\D/g, '').length === 6 && verify()); // validation auto
    code.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), verify()));
    setTimeout(() => code.focus(), 0);
    const left = Math.max(0, Math.ceil((f.until - Date.now()) / 1000));
    const resend = h('button', { class: 'btn ghost', type: 'button', disabled: left > 0, onclick: () => game.net.send('otpRequest', { phone: f.phone }) }, left > 0 ? `Renvoyer le code (${left} s)` : 'Renvoyer le code');
    if (left > 0) {
      const t = setInterval(() => {
        const l = Math.max(0, Math.ceil((f.until - Date.now()) / 1000));
        if (!resend.isConnected) return clearInterval(t);
        resend.textContent = l > 0 ? `Renvoyer le code (${l} s)` : 'Renvoyer le code';
        resend.disabled = l > 0;
        if (l === 0) clearInterval(t);
      }, 1000);
    }
    return h(
      'div',
      {},
      h('p', {}, 'Code envoyé au ', h('b', {}, f.masked ?? f.phone)),
      f.dev ? h('p', { class: 'muted' }, `🧪 Mode développement — code : ${f.dev}`) : null,
      code,
      busyBtn('Valider', verify),
      h('div', { class: 'row' }, resend, h('button', { class: 'btn ghost', type: 'button', onclick: () => ((f.step = 'phone'), game.rerenderPhone()) }, 'Changer de numéro')),
    );
  }

  // Nouveau compte : pseudo + pays
  const name = h('input', { class: 'phone-name', maxlength: 16, placeholder: 'Ton pseudo' });
  const home = h('select', { class: 'phone-home' }, COUNTRIES.map((c) => h('option', { value: c.code, selected: c.code === (game.guessCountry ?? 'BJ') }, `${c.flag} ${c.name}`)));
  return h(
    'div',
    {},
    h('p', {}, '✅ Numéro vérifié ! Crée ton personnage :'),
    h('label', {}, 'Pseudo', name),
    h('label', {}, 'Pays d\'origine (ton aéroport de départ)', home),
    busyBtn('Créer mon personnage', () => {
      f.busy = true;
      game.net.send('hello', { name: name.value.trim(), home: home.value, phoneTicket: f.ticket });
      game.rerenderPhone();
    }),
  );
}

PANELS.account = (game) => {
  const p = game.profile;
  return h(
    'div',
    {},
    h('p', {}, 'Pseudo : ', h('b', {}, p.name)),
    p.phone
      ? h('div', { class: 'premium-card' }, h('p', { style: 'margin:0' }, '📱 Compte sécurisé par le numéro ', h('b', {}, p.phone)), h('p', { class: 'muted' }, 'Tu peux te reconnecter sur n\'importe quel appareil avec ce numéro : tes Cauris, Vida, véhicules et Premium te suivent.'))
      : h(
          'div',
          { class: 'premium-card' },
          h('p', { style: 'margin-top:0' }, h('b', {}, '⚠️ Compte invité'), ' : si tu changes de téléphone ou effaces ton navigateur, tu perds tout. Lie ton numéro pour sécuriser ton compte (obligatoire pour acheter des Vida).'),
          phoneFlow(game, 'link'),
        ),
    h('div', { class: 'region-title' }, `Joueurs bloqués : ${game.blocked?.size ?? 0}`),
    game.blocked?.size
      ? h(
          'ul',
          { class: 'list' },
          [...game.blocked].map(([key, name]) =>
            h('li', {}, name, h('button', { class: 'btn', onclick: () => (game.blocked.delete(key), game.saveBlocked(), refreshPanel()) }, 'Débloquer')),
          ),
        )
      : h('p', { class: 'muted' }, 'Personne. Utilise 🚫 à côté d\'un message du chat pour ne plus voir un joueur, et 🚩 pour signaler une insulte.'),
    h('div', { class: 'region-title' }, `Appareils connectés : ${p.devices}`),
    h(
      'div',
      { class: 'row' },
      p.devices > 1 ? h('button', { class: 'btn', onclick: () => confirm('Déconnecter tous tes autres appareils ?') && game.net.send('logoutOthers', { token: game.creds()?.token }) }, 'Déconnecter mes autres appareils') : null,
      h(
        'button',
        {
          class: 'btn danger',
          onclick: () => {
            const msg = p.phone ? 'Se déconnecter ? Tu pourras revenir avec ton numéro.' : 'Attention : compte invité. Sans numéro lié, tu ne pourras PAS récupérer ce compte. Se déconnecter quand même ?';
            if (confirm(msg)) game.net.send('logout', { token: game.creds()?.token });
          },
        },
        'Se déconnecter',
      ),
    ),
  );
};

// --- Administration : signalements et sanctions ----------------------------------------------------
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const ACTION_LABEL = { dismiss: 'Classé sans suite', warn: 'Avertissement', mute: 'Silence', unmute: 'Silence levé', ban: 'Bannissement', unban: 'Bannissement levé' };

function playerBadges(t) {
  return [
    h('span', { class: `dot ${t.online ? 'on' : ''}`, title: t.online ? 'En ligne' : 'Hors ligne' }),
    t.isAdmin ? h('span', { class: 'status review' }, 'Admin') : null,
    t.ban ? h('span', { class: 'status failed' }, t.ban.until ? `Banni → ${fmtDate(t.ban.until)}` : 'Banni définitivement') : null,
    t.mutedUntil ? h('span', { class: 'status pending' }, `Silence → ${fmtDate(t.mutedUntil)}`) : null,
  ];
}

PANELS.admin = (game) => {
  const a = (game.admin ??= { tab: 'open', open: null, handled: null, search: null, log: null, player: null, playerData: null, q: '' });
  const load = (tab) => {
    if (tab === 'open' || tab === 'handled') game.net.send('adminReports', { status: tab });
    if (tab === 'log') game.net.send('adminLog');
  };
  const tab = (k, label) => h('button', { class: `btn ${a.tab === k && !a.player ? 'active' : ''}`, onclick: () => ((a.tab = k), (a.player = null), load(k), refreshPanel()) }, label);
  const openPlayer = (id) => {
    a.player = id;
    a.playerData = null;
    game.net.send('adminPlayer', { id });
    refreshPanel();
  };
  if (a[a.tab] === null && !a.player) load(a.tab);

  const header = h('div', { class: 'tabs' }, tab('open', `🚩 À traiter (${game.adminOpenCount ?? 0})`), tab('handled', '✅ Traités'), tab('search', '🔎 Joueurs'), tab('log', '📜 Journal'));

  // --- Dossier d'un joueur ---
  if (a.player) {
    const d = a.playerData;
    if (!d || d.player.id !== a.player) return h('div', {}, header, h('p', { class: 'muted' }, 'Chargement du dossier…'));
    const t = d.player;
    const reason = h('input', { placeholder: 'Motif (obligatoire pour avertir, mettre en silence ou bannir)', maxlength: 200 });
    const muteDur = h('select', {}, ['1h', '24h', '7j', '30j'].map((k) => h('option', { value: k }, k)));
    const banDur = h('select', {}, ['24h', '7j', '30j', 'permanent'].map((k) => h('option', { value: k }, k === 'permanent' ? 'définitif' : k)));
    const act = (action, duration) => {
      if (action === 'ban' && !confirm(`Bannir ${t.name} (${duration === 'permanent' ? 'définitivement' : duration}) ?`)) return;
      game.net.send('adminAction', { target: t.id, action, duration, reason: reason.value });
    };
    const open = d.reports.filter((r) => r.status === 'open');
    return h(
      'div',
      {},
      header,
      h('button', { class: 'btn ghost', onclick: () => ((a.player = null), load(a.tab), refreshPanel()) }, '← Retour'),
      h('h3', {}, ...playerBadges(t), ' ', t.name),
      h('p', { class: 'muted' }, `Inscrit le ${fmtDate(t.createdAt)} · ${t.phone ?? 'compte invité (sans numéro)'}${t.family ? ` · famille « ${t.family} »` : ''} · ${t.stats?.missions ?? 0} missions · silences reçus : ${t.mutes} · signalements faits : ${d.reportsMade}`),
      t.isAdmin
        ? h('p', { class: 'muted' }, 'Administrateur : aucune sanction possible.')
        : h(
            'div',
            { class: 'premium-card' },
            reason,
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn', onclick: () => act('warn') }, '⚠️ Avertir'),
              h('span', {}, muteDur, ' ', h('button', { class: 'btn', onclick: () => act('mute', muteDur.value) }, '🔇 Silence')),
              h('span', {}, banDur, ' ', h('button', { class: 'btn danger', onclick: () => act('ban', banDur.value) }, '⛔ Bannir')),
            ),
            h(
              'div',
              { class: 'row' },
              open.length ? h('button', { class: 'btn ghost', onclick: () => act('dismiss') }, `Classer sans suite (${open.length})`) : null,
              t.mutedUntil ? h('button', { class: 'btn ghost', onclick: () => act('unmute') }, 'Lever le silence') : null,
              t.ban ? h('button', { class: 'btn ghost', onclick: () => act('unban') }, 'Lever le bannissement') : null,
            ),
          ),
      h('div', { class: 'region-title' }, `Signalements reçus (${d.reports.length})`),
      d.reports.length
        ? h('ul', { class: 'list' }, d.reports.map((r) => h('li', {}, h('div', {}, h('b', {}, `« ${r.text} »`), h('div', { class: 'meta' }, `${fmtDate(r.at)} · signalé par ${r.by}${r.handledBy ? ` · ${ACTION_LABEL[r.action] ?? r.action} par ${r.handledBy}` : ''}`)), h('span', { class: `status ${r.status === 'open' ? 'pending' : r.status === 'dismissed' ? 'review' : 'paid'}` }, r.status === 'open' ? 'À traiter' : r.status === 'dismissed' ? 'Classé' : 'Traité'))))
        : h('p', { class: 'muted' }, 'Aucun.'),
      h('div', { class: 'region-title' }, 'Derniers messages (depuis le démarrage du serveur)'),
      d.recentMessages.length ? h('ul', { class: 'list' }, d.recentMessages.map((m) => h('li', {}, h('span', {}, m.text), h('span', { class: 'meta' }, fmtDate(m.at))))) : h('p', { class: 'muted' }, 'Aucun message récent.'),
      h('div', { class: 'region-title' }, 'Historique des sanctions'),
      d.audit.length ? h('ul', { class: 'list' }, d.audit.map((e) => h('li', {}, h('div', {}, h('b', {}, ACTION_LABEL[e.action] ?? e.action), e.duration ? ` (${e.duration})` : '', h('div', { class: 'meta' }, `${fmtDate(e.at)} · par ${e.admin}${e.reason ? ` · ${e.reason}` : ''}`))))) : h('p', { class: 'muted' }, 'Aucune sanction.'),
    );
  }

  // --- Listes ---
  if (a.tab === 'search') {
    const input = h('input', { placeholder: 'Pseudo du joueur (2 lettres minimum)', value: a.q, oninput: (e) => ((a.q = e.target.value), game.net.send('adminSearch', { q: a.q })) });
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(a.q.length, a.q.length);
    }, 0);
    return h(
      'div',
      {},
      header,
      input,
      a.search?.length
        ? h('ul', { class: 'list' }, a.search.map((t) => h('li', { style: 'cursor:pointer', onclick: () => openPlayer(t.id) }, h('div', {}, ...playerBadges(t), ' ', h('b', {}, t.name), h('div', { class: 'meta' }, t.phone ?? 'invité')), h('span', { class: 'meta' }, 'Ouvrir →'))))
        : h('p', { class: 'muted' }, a.q.length >= 2 ? 'Aucun joueur trouvé.' : 'Recherche un joueur pour consulter son dossier ou le sanctionner sans signalement.'),
    );
  }
  if (a.tab === 'log') {
    return h(
      'div',
      {},
      header,
      !a.log
        ? h('p', { class: 'muted' }, 'Chargement…')
        : a.log.length
          ? h('ul', { class: 'list' }, a.log.map((e) => h('li', { style: 'cursor:pointer', onclick: () => openPlayer(e.target) }, h('div', {}, h('b', {}, `${ACTION_LABEL[e.action] ?? e.action}${e.duration ? ` (${e.duration})` : ''}`), ' — ', e.targetName, h('div', { class: 'meta' }, `${fmtDate(e.at)} · par ${e.admin}${e.reason ? ` · ${e.reason}` : ''}${e.reportsClosed ? ` · ${e.reportsClosed} signalement(s) clos` : ''}`)))))
          : h('p', { class: 'muted' }, 'Aucune action pour l\'instant.'),
    );
  }
  const groups = a[a.tab];
  return h(
    'div',
    {},
    header,
    !groups
      ? h('p', { class: 'muted' }, 'Chargement…')
      : groups.length === 0
        ? h('p', { class: 'muted' }, a.tab === 'open' ? '🎉 Aucun signalement en attente.' : 'Aucun signalement traité.')
        : h(
            'ul',
            { class: 'list', style: 'max-height:none' },
            groups.map((g) =>
              h(
                'li',
                { style: 'display:block' },
                h('div', { class: 'row', style: 'justify-content:space-between;margin:0' }, h('div', {}, ...playerBadges(g.target), ' ', h('b', {}, g.target.name), h('span', { class: 'meta' }, ` · ${g.count} signalement(s) par ${g.reporters} joueur(s) · dernier ${fmtDate(g.last)}`)), h('button', { class: 'btn blue', onclick: () => openPlayer(g.target.id) }, 'Ouvrir le dossier')),
                h('ul', { class: 'meta', style: 'margin:6px 0 0;padding-left:18px' }, g.reports.slice(0, 3).map((r) => h('li', {}, `« ${r.text} » — ${r.by}, ${fmtDate(r.at)}${r.handledBy ? ` · ${ACTION_LABEL[r.action] ?? r.action} par ${r.handledBy}` : ''}`))),
              ),
            ),
          ),
  );
};

// --- Cagnotte et maisons familiales -----------------------------------------------------------
function familyTreasury(game, fam) {
  const p = game.profile;
  const chef = fam.ownerId === p.id;
  const amount = h('input', { type: 'number', min: 1, step: 100, placeholder: 'Montant en Cauris', style: 'width:180px' });
  const val = () => Number.parseInt(amount.value, 10);
  return h(
    'div',
    {},
    h('div', { class: 'region-title' }, '🏦 Cagnotte familiale'),
    h(
      'div',
      { class: 'premium-card' },
      h('p', { style: 'margin-top:0' }, 'Solde : ', h('b', {}, formatMoney(fam.treasury)), ' — sert à acheter les maisons de la famille. Tout le monde peut y déposer ; seul le chef peut acheter ou retirer.'),
      h(
        'div',
        { class: 'row' },
        amount,
        h('button', { class: 'btn primary', onclick: () => val() > 0 && game.net.send('familyDeposit', { amount: val() }) }, 'Déposer'),
        chef ? h('button', { class: 'btn', onclick: () => val() > 0 && game.net.send('familyWithdraw', { amount: val() }) }, 'Retirer') : null,
      ),
      fam.treasuryLog?.length ? h('ul', { class: 'meta', style: 'margin:6px 0 0;padding-left:18px' }, fam.treasuryLog.slice(0, 5).map((l) => h('li', {}, `${l.delta > 0 ? '+' : ''}${formatMoney(l.delta)} · ${l.label}`))) : null,
    ),
    h('div', { class: 'region-title' }, `🏠 Maisons (${fam.houses.length}/${MAX_HOUSES_PER_FAMILY})`),
    fam.houses.length
      ? h(
          'ul',
          { class: 'list' },
          fam.houses.map((x) => {
            const c = COUNTRY_BY_CODE.get(x.country);
            const here = x.country === game.country;
            return h(
              'li',
              {},
              h('div', {}, `${c?.flag ?? ''} `, h('b', {}, `${HOUSE_TIERS[x.tier].name} n°${x.lot}`), h('div', { class: 'meta' }, `${c?.name ?? x.country}${here ? ' · tu es dans ce pays' : ''}`)),
              here ? h('button', { class: 'btn blue', onclick: () => game.net.send('houseHome') }, '🏠 Rentrer') : h('span', { class: 'meta' }, 'Prends l\'avion pour y aller'),
            );
          }),
        )
      : h('p', { class: 'muted' }, 'Aucune maison. Va dans le quartier résidentiel (à l\'ouest de la ville) et approche-toi d\'un panneau « À VENDRE ».'),
  );
}

PANELS.house = (game) => {
  const lot = LOT_BY_ID.get(game.houseLot);
  if (!lot) return h('p', {}, 'Maison inconnue.');
  const t = HOUSE_TIERS[lot.tier];
  const owner = game.houses?.get(lot.id) ?? null;
  const p = game.profile;
  const fam = p.family;
  const mine = owner && fam && owner.familyId === fam.id;
  const chef = fam && fam.ownerId === p.id;
  const desc = h('p', { class: 'muted' }, `${t.name} · ${t.floors} étage(s)${t.garage ? ' · garage' : ''}${t.pool ? ' · piscine' : ''} · terrain n°${lot.id}`);

  if (mine) {
    const wall = h('input', { type: 'color', value: owner.wall });
    const roof = h('input', { type: 'color', value: owner.roof });
    return h(
      'div',
      {},
      desc,
      h('p', {}, '✅ Cette maison appartient à ta famille. Les membres y apparaissent en arrivant dans ce pays et peuvent y revenir depuis le panneau Famille.'),
      h('div', { class: 'row' }, h('label', {}, 'Couleur des murs', wall), h('label', {}, 'Couleur du toit', roof)),
      h('button', { class: 'btn primary', onclick: () => game.net.send('houseColors', { lot: lot.id, wall: wall.value, roof: roof.value }) }, 'Appliquer les couleurs'),
      chef
        ? h('p', {}, h('button', { class: 'btn danger', onclick: () => confirm(`Revendre cette maison ? La cagnotte récupère ${formatMoney(Math.floor(t.price * SELL_REFUND))} (${SELL_REFUND * 100} % du prix).`) && game.net.send('houseSell', { lot: lot.id }) }, 'Revendre la maison'))
        : null,
    );
  }
  if (owner) return h('div', {}, desc, h('p', {}, `Cette maison appartient à la famille « ${owner.family} ».`));

  // À vendre
  let action;
  if (!fam) action = h('p', {}, 'Crée ou rejoins une famille (touche G) pour pouvoir acheter une maison ensemble.');
  else if (!chef) action = h('p', {}, `Seul le chef de famille peut acheter. Aide-le en déposant des Cauris dans la cagnotte (${formatMoney(fam.treasury)} / ${formatMoney(t.price)}).`);
  else if (fam.houses.length >= MAX_HOUSES_PER_FAMILY) action = h('p', {}, `Ta famille a déjà ${MAX_HOUSES_PER_FAMILY} maisons (maximum).`);
  else
    action = h(
      'div',
      {},
      h('p', {}, 'Cagnotte familiale : ', h('b', {}, formatMoney(fam.treasury)), fam.treasury < t.price ? ` — il manque ${formatMoney(t.price - fam.treasury)}` : ''),
      h('button', { class: 'btn primary big', disabled: fam.treasury < t.price, onclick: () => confirm(`Acheter cette ${t.name.toLowerCase()} pour ${formatMoney(t.price)} avec la cagnotte familiale ?`) && game.net.send('houseBuy', { lot: lot.id }) }, `Acheter pour ${formatMoney(t.price)}`),
    );
  return h('div', {}, desc, h('p', {}, 'Prix : ', h('b', {}, formatMoney(t.price)), ' (payé avec la cagnotte familiale)'), action);
};

// --- Téléphone : maison connectée, caméras, garage -------------------------------------------
const EVENT_LABEL = { visit: '📷 Visiteur devant la maison', alarm: '🚨 Intrusion (alarme)', button: '🔒 Tentative sur un interrupteur' };

function myHouses(game) {
  return (game.profile.family?.houses ?? []).map((x) => ({ ...x, lotData: LOT_BY_ID.get(x.lot), state: game.housesByCountry?.get(x.country)?.get(x.lot) }));
}

PANELS.phone = (game) => {
  const ph = (game.phoneUi ??= { app: 'home', cam: 0, house: null });
  const houses = myHouses(game);
  // Demande l'état des maisons situées dans d'autres pays
  for (const x of houses) if (!game.housesByCountry?.has(x.country) && !ph.asked?.has(x.country)) {
    (ph.asked ??= new Set()).add(x.country);
    game.net.send('housesFor', { country: x.country });
  }
  const go = (app) => () => {
    ph.app = app;
    if (app !== 'cams') game.cctv = null;
    refreshPanel();
  };
  const bar = h('div', { class: 'phone-bar' }, h('span', {}, game.clock?.() ?? ''), h('span', {}, '📶 🔋'));
  const back = h('button', { class: 'btn ghost', onclick: go('home') }, '‹ Accueil');
  let screen;
  if (!game.profile.family) screen = h('p', { class: 'muted' }, 'Rejoins une famille et achetez une maison pour utiliser la maison connectée.');
  else if (!houses.length) screen = h('p', { class: 'muted' }, 'Ta famille n\'a pas encore de maison. Les appareils, caméras et le garage apparaîtront ici.');
  else if (ph.app === 'home') {
    screen = h(
      'div',
      { class: 'phone-apps' },
      [['devices', '🏠', 'Maison'], ['cams', '📷', 'Caméras'], ['garage', '🚗', 'Garage']].map(([app, icon, label]) => h('button', { class: 'phone-app', onclick: go(app) }, h('span', {}, icon), label)),
    );
  } else if (ph.app === 'devices') {
    screen = h(
      'div',
      {},
      back,
      houses.map((x) =>
        h(
          'div',
          { class: 'phone-card' },
          h('b', {}, `${COUNTRY_BY_CODE.get(x.country)?.flag ?? ''} ${HOUSE_TIERS[x.tier].name} n°${x.lot}`),
          devicesFor(x.tier).map((d) => {
            const on = !!x.state?.devices?.[d.id];
            return h(
              'div',
              { class: 'phone-row' },
              h('span', {}, `${d.icon} ${d.label}`),
              h('button', { class: `toggle ${on ? 'on' : ''}`, disabled: !x.state, onclick: () => game.net.send('houseDevice', { country: x.country, lot: x.lot, device: d.id, via: 'phone' }) }, h('i', {})),
            );
          }),
        ),
      ),
      h('p', { class: 'muted' }, 'Tu peux aussi utiliser les interrupteurs sur la maison (touche E).'),
    );
  } else if (ph.app === 'cams') {
    const here = houses.filter((x) => x.country === game.country);
    if (!here.length) {
      game.cctv = null;
      screen = h('div', {}, back, h('p', { class: 'muted' }, 'Hors de portée : les caméras se consultent quand tu es dans le même pays que la maison.'));
    } else {
      const x = here.find((y) => y.lot === ph.house) ?? here[0];
      ph.house = x.lot;
      const cams = x.lotData.cameras;
      ph.cam = Math.min(ph.cam, cams.length - 1);
      const cam = cams[ph.cam];
      const view = (game.cctvCanvas ??= h('canvas', { width: 320, height: 180, class: 'cctv' }));
      game.cctv = { cam, canvas: view, label: `CAM ${cam.id} · ${cam.label}` };
      if (!ph.events || ph.eventsLot !== x.lot) {
        ph.eventsLot = x.lot;
        game.net.send('houseEvents', { country: x.country, lot: x.lot });
      }
      screen = h(
        'div',
        {},
        back,
        here.length > 1 ? h('div', { class: 'tabs' }, here.map((y) => h('button', { class: `btn ${y.lot === x.lot ? 'active' : ''}`, onclick: () => ((ph.house = y.lot), (ph.cam = 0), (ph.events = null), refreshPanel()) }, `n°${y.lot}`))) : null,
        view,
        h('div', { class: 'phone-row' }, h('button', { class: 'btn', onclick: () => ((ph.cam = (ph.cam - 1 + cams.length) % cams.length), refreshPanel()) }, '◀'), h('span', {}, `${cam.label} (${ph.cam + 1}/${cams.length})`), h('button', { class: 'btn', onclick: () => ((ph.cam = (ph.cam + 1) % cams.length), refreshPanel()) }, '▶')),
        h('div', { class: 'region-title' }, 'Journal de surveillance'),
        ph.events?.length
          ? h('ul', { class: 'list phone-list' }, ph.events.slice(0, 10).map((e) => h('li', {}, h('span', {}, `${EVENT_LABEL[e.kind] ?? e.kind} — ${e.name}`), h('span', { class: 'meta' }, new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })))))
          : h('p', { class: 'muted' }, 'Aucun passage enregistré.'),
      );
    }
  } else {
    screen = h(
      'div',
      {},
      back,
      houses.map((x) => {
        const slots = HOUSE_TIERS[x.tier].garageSlots;
        const list = x.state?.garage ?? [];
        return h(
          'div',
          { class: 'phone-card' },
          h('b', {}, `${COUNTRY_BY_CODE.get(x.country)?.flag ?? ''} Garage n°${x.lot} — ${list.filter(Boolean).length}/${slots}`),
          Array.from({ length: slots }, (_, i) => {
            const c = list[i];
            return h(
              'div',
              { class: 'phone-row' },
              h('span', {}, c ? `🚗 ${VEHICLE_BY_ID.get(c.model)?.name ?? c.model} (${c.owner})` : `Place ${i + 1} : libre`),
              c && x.country === game.country ? h('button', { class: 'btn', onclick: () => game.net.send('garageTake', { lot: x.lot, slot: i }) }, 'Sortir') : null,
            );
          }),
          x.country === game.country ? h('button', { class: 'btn primary', onclick: () => game.net.send('garagePark', { lot: x.lot }) }, '🅿️ Garer mon véhicule ici') : h('p', { class: 'muted' }, 'Garage dans un autre pays.'),
        );
      }),
      h('p', { class: 'muted' }, 'Pour garer ou sortir un véhicule, approche-toi du garage. Les véhicules des autres membres peuvent être empruntés : ils y retournent quand tu descends.'),
    );
  }
  return h('div', { class: 'phone' }, bar, h('div', { class: 'phone-screen' }, screen));
};
