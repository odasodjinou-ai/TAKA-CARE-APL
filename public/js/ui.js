// Interface : notifications, panneaux (métiers, boutique, aéroport, famille…), minicarte.
// Toutes les données venant d'autres joueurs passent par textContent (pas d'injection HTML).
import { COUNTRIES, COUNTRY_BY_CODE, REGIONS } from '/shared/countries.js';
import { JOBS, ITEMS, itemsBySlot, flightPrice, formatMoney, FAMILY_CREATION_COST } from '/shared/catalog.js';
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
    return h(
      'div',
      {},
      shopList(game, ['car'], 'cars'),
      h('div', { class: 'row' }, h('label', {}, 'Couleur de ta voiture', h('input', { type: 'color', value: p.skin.carColor, onchange: (e) => game.saveSkin({ carColor: e.target.value }) }))),
    );
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
      ['V', 'Sortir / ranger ta voiture'],
      ['C · G · H', 'Garde-robe · Famille · Aide'],
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

function shopList(game, slots, place) {
  const p = game.profile;
  const owned = new Set(p.owned);
  return h(
    'div',
    {},
    h('p', {}, 'Ton solde : ', h('b', {}, formatMoney(p.money))),
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
            h('div', {}, h('b', {}, it.name), h('div', { class: 'meta' }, it.price ? formatMoney(it.price) : 'Gratuit', it.speed ? ` · ${Math.round(it.speed * 3.6)} km/h` : '')),
            has
              ? h('button', { class: 'btn', disabled: equipped, onclick: () => game.saveSkin({ [slot]: it.value }) }, equipped ? 'Équipé' : 'Équiper')
              : h('button', { class: 'btn primary', disabled: p.money < it.price, onclick: () => game.net.send('buy', { item: it.id }) }, 'Acheter'),
          );
        }),
      ),
    ),
    place === 'shop' ? h('p', { class: 'muted' }, 'Les couleurs se changent gratuitement dans la garde-robe (C).') : null,
  );
}

export { ITEMS };

// --- Minicarte -------------------------------------------------------------------
export function drawMinimap(canvas, { pos, yaw, remotes, mission }) {
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
  ctx.stroke();
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
