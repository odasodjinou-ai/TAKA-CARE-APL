import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderate, isOffensiveName, addStrike, mutedUntil, SANCTIONS } from '../server/moderation.js';
import { Store } from '../server/store.js';
import { Game } from '../server/game.js';

test('insultes détectées malgré les contournements', () => {
  const insults = [
    'espèce de connard',
    'CONNARD',
    'connnnnnard',
    'c0nn4rd',
    'c o n n a r d',
    'p.u.t.e',
    't es un enculé',
    'enculééé',
    'sal0pe',
    'fdp va',
    'f d p',
    'ntm',
    'ta gueule tg',
    'bâtard',
    'what the fuck',
    'you bitch',
    'putain de merde',
    'vous êtes des idiots',
    'bande de crétins',
    'les bouffons',
  ];
  for (const t of insults) assert.ok(moderate(t).severity >= 1, `non détecté : « ${t} »`);
});

test('propos haineux et menaces = gravité 2, message entier masqué pour les phrases', () => {
  for (const t of ['sale nègre', 'espèce de pédé', 'je te tue', 'j\'vais te tuer', 'jevaistetuer', 'tue toi', 'sale noir', 'sale arabe']) {
    assert.equal(moderate(t).severity, 2, `gravité attendue 2 : « ${t} »`);
  }
  assert.match(moderate('sale arabe').clean, /^\*+ \*+$/);
});

test('aucun faux positif sur des phrases normales', () => {
  const ok = [
    'Je vais conduire jusqu\'à l\'aéroport',
    'Super concert ce soir',
    'On se retrouve au restaurant, il y a une belle assiette',
    'Mon pick-up est violet',
    'Je joue du violon',
    'Bonne nuit la famille !',
    'Je suis en retard, désolé',
    'Un gros bisou, un baiser',
    'Le chiot du voisin est mignon',
    'J\'ai acheté une Rossa Fulmine',
    'Promenade pédestre au parc',
    'La Mongolie est belle, la steppe mongole',
    'C\'est un compte invité ou pas ?',
    'Cotonou, Porto-Novo, Parakou',
    'Ce bus est complet',
    'Constitution, construction, conseil',
    'Il fait chaud au Bénin',
    'Tu as combien de Vida ?',
    'Le pédiatre est à l\'hôpital',
    'Je baisse le son',
  ];
  for (const t of ok) {
    const r = moderate(t);
    assert.equal(r.severity, 0, `faux positif : « ${t} » (${r.hits.join(', ')})`);
    assert.equal(r.clean, t);
  }
});

test('masquage : seuls les mots fautifs sont remplacés', () => {
  assert.equal(moderate('salut connard ça va').clean, 'salut ******* ça va');
  assert.equal(moderate('c o n').clean, '* * *');
});

test('pseudos et noms de famille injurieux refusés', () => {
  for (const n of ['LeConnard', 'xXputeXx', 'Fdp_229', 'Salope', 'Hitler88']) assert.ok(isOffensiveName(n), n);
  for (const n of ['Aïcha', 'Koffi', 'Constant', 'Les Soleils', 'Conducteur', 'Violette', 'Bassirou']) assert.ok(!isOffensiveName(n), n);
});

test('sanctions progressives : 5 min, 30 min puis 24 h', () => {
  const p = {};
  let now = 1_000_000;
  const muteFor = () => {
    let r;
    for (let i = 0; i < SANCTIONS.threshold; i++) r = addStrike(p, 1, now);
    return r.mutedUntil - now;
  };
  assert.equal(addStrike(p, 1, now).mutedUntil, null);
  assert.equal(addStrike(p, 1, now).mutedUntil, null);
  assert.equal(addStrike(p, 1, now).mutedUntil - now, SANCTIONS.muteMs[0]);
  assert.ok(mutedUntil(p, now + 1000));
  now += SANCTIONS.windowMs * 2;
  assert.equal(mutedUntil(p, now), 0, 'silence terminé');
  assert.equal(muteFor(), SANCTIONS.muteMs[1]);
  now += SANCTIONS.windowMs * 100;
  assert.equal(muteFor(), SANCTIONS.muteMs[2]);
  // Les points expirent après la fenêtre
  const q = {};
  addStrike(q, 1, 0);
  addStrike(q, 1, 0);
  assert.equal(addStrike(q, 1, SANCTIONS.windowMs + 1).mutedUntil, null);
  // Un propos haineux compte double
  const r = {};
  addStrike(r, 2, 0);
  assert.ok(addStrike(r, 1, 0).mutedUntil);
});

function chatSetup() {
  let now = 9_000_000;
  const store = new Store(null);
  const game = new Game(store, { tickMs: 0, now: () => now });
  const join = (name) => {
    const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
    const c = game.connect(ws);
    const send = (t, d = {}) => game.handleRaw(c, JSON.stringify({ t, ...d }));
    send('hello', { name, home: 'BJ' });
    send('join', { room: 'afrique-1' });
    const all = (t) => ws.sent.filter((m) => m.t === t);
    return { c, ws, send, all, last: (t) => all(t).at(-1) };
  };
  return { game, store, join, advance: (ms) => (now += ms) };
}

test('chat : message filtré pour tous, avertissement puis silence', () => {
  const { join, advance } = chatSetup();
  const a = join('Rude');
  const b = join('Gentil');
  a.send('chat', { text: 'bonjour à tous' });
  assert.equal(b.last('chat').text, 'bonjour à tous');
  assert.equal(b.last('chat').filtered, false);

  advance(1000);
  a.send('chat', { text: 't es un connard' });
  assert.equal(b.last('chat').text, 't es un *******');
  assert.match(a.last('toast').message, /avertissement 1\/3/);

  advance(1000);
  a.send('chat', { text: 'fdp' });
  advance(1000);
  a.send('chat', { text: 'salope' });
  assert.match(a.last('toast').message, /silence pendant 5 min/);
  assert.ok(b.all('chat').some((m) => m.sys && /réduit au silence/.test(m.text)));

  const before = b.all('chat').length;
  advance(1000);
  a.send('chat', { text: 'je suis gentil maintenant' });
  assert.match(a.last('error').message, /ne peux pas écrire/);
  assert.equal(b.all('chat').length, before, 'message bloqué pendant le silence');

  advance(SANCTIONS.muteMs[0]);
  a.send('chat', { text: 'pardon tout le monde' });
  assert.equal(b.last('chat').text, 'pardon tout le monde');
});

test('signalements : un par message, 3 joueurs distincts déclenchent un avertissement', () => {
  const { join, store } = chatSetup();
  const t = join('Cible');
  const r = [join('Un'), join('Deux'), join('Trois')];
  t.send('chat', { text: 'message limite' });
  const id = r[0].last('chat').id;
  assert.equal(typeof r[0].last('chat').key, 'string');
  r[0].send('report', { id });
  r[0].send('report', { id });
  assert.equal(store.data.reports.length, 1, 'doublon ignoré');
  t.send('report', { id });
  assert.equal(store.data.reports.length, 1, 'on ne peut pas se signaler soi-même');
  r[1].send('report', { id });
  r[2].send('report', { id });
  assert.equal(store.data.reports.length, 3);
  assert.match(t.last('toast').message, /signalé/);
  assert.equal(store.data.reports[0].text, 'message limite', 'le texte original est conservé pour la modération');
});

test('pseudo injurieux refusé à la création', () => {
  const { game } = chatSetup();
  const ws = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
  game.handleRaw(game.connect(ws), JSON.stringify({ t: 'hello', name: 'Connard229', home: 'BJ' }));
  assert.match(ws.sent.at(-1).message, /pas autorisé/);
});
