// Modération du chat, des pseudos et des noms de famille.
//
// Détection robuste aux contournements courants :
//   accents (« enculé »), chiffres et symboles (« c0nn4rd », « s@lope »), lettres répétées
//   (« connnnard »), lettres séparées (« c o n n a r d », « p.u.t.e »), majuscules.
// Sans faux positifs sur les mots innocents (« conduire », « concert », « assiette ») :
// on compare des MOTS entiers ou des RACINES en début de mot, jamais des sous-chaînes au milieu.
//
// Gravité : 1 = insulte / grossièreté, 2 = haine (racisme, homophobie…), menace, harcèlement sexuel.

// Mots exacts (après normalisation)
const EXACT = {
  1: [
    'con', 'cons', 'conne', 'connes', 'pute', 'putes', 'pd', 'fdp', 'ntm', 'tg', 'ftg', 'nique', 'niquer', 'nik', 'niktamere',
    'salaud', 'salauds', 'salop', 'merdeux', 'merdeuse', 'abruti', 'abrutie', 'cretin', 'cretine', 'debile', 'debiles',
    'gogol', 'teube', 'boloss', 'bouffon', 'bouffonne', 'tocard', 'tocarde', 'chienne', 'bite', 'bites',
    'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'bitches', 'asshole', 'dick', 'cunt', 'wanker', 'slut', 'whore', 'stfu',
    'idiot', 'idiote', 'imbecile', 'imbeciles',
  ],
  2: ['negro', 'negre', 'negresse', 'bougnoule', 'bougnoul', 'youpin', 'youpine', 'bicot', 'chinetoque', 'nigger', 'nigga', 'faggot', 'fag', 'tapette', 'tafiole', 'gouine'],
};
// Racines : tout mot qui COMMENCE par ces lettres (« connard », « connasses », « enculés »…)
const ROOTS = {
  1: ['connard', 'conard', 'connass', 'conass', 'encul', 'salop', 'putain', 'batard', 'merde', 'emmerd', 'chiott', 'bordel', 'branleu', 'branlo', 'couill', 'trouduc', 'casselesc', 'ptn', 'motherfuck', 'bullshit', 'dumbass', 'jackass', 'fdp', 'niqu', 'nichon'],
  2: ['pede', 'enculdetamere', 'nazi', 'hitler', 'jetetue', 'jevaistetuer', 'vaistetuer', 'vaistebuter', 'jetebute', 'tuetoi', 'suicidetoi', 'violer', 'viol', 'terroris', 'sale noir', 'salenoir', 'salearabe', 'salejuif', 'salechinois', 'saleblanc'],
};
// Racines à NE PAS signaler malgré une racine ci-dessus (mots courants)
const ALLOW = ['bordelais', 'violet', 'violon', 'violence', 'violent', 'violacé', 'pedestre', 'pedestr'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '€': 'e', '!': 'i', '|': 'i' };

/** minuscules, sans accents, leet remplacé, lettres répétées réduites (max 2). */
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$€!|]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1');
}

const EXACT_MAP = new Map();
for (const [sev, words] of Object.entries(EXACT)) for (const w of words) EXACT_MAP.set(normalize(w), Number(sev));
const ROOT_LIST = Object.entries(ROOTS).flatMap(([sev, roots]) => roots.map((r) => [normalize(r).replace(/\s/g, ''), Number(sev)]));
const ALLOW_LIST = ALLOW.map(normalize);

function severityOf(word) {
  if (!word) return 0;
  const candidates = [word, word.replace(/(.)\1/g, '$1')]; // « connard » et « conard »
  let best = 0;
  for (const w of candidates) {
    best = Math.max(best, EXACT_MAP.get(w) ?? 0);
    if (ALLOW_LIST.some((a) => w.startsWith(a))) continue;
    for (const [root, sev] of ROOT_LIST) if (w.startsWith(root)) best = Math.max(best, sev);
  }
  return best;
}

/**
 * Analyse un texte.
 * @returns {{ severity: 0|1|2, clean: string, hits: string[] }}
 *   clean : le texte avec les mots injurieux remplacés par des étoiles.
 */
export function moderate(text) {
  const original = String(text);
  // Découpe en jetons en gardant leurs positions dans le texte original
  const tokens = [];
  const re = /[\p{L}\p{N}@$€!|]+/gu;
  let m;
  while ((m = re.exec(original))) tokens.push({ start: m.index, end: m.index + m[0].length, norm: normalize(m[0]) });

  const flagged = []; // [start, end, severity]
  let severity = 0;
  const hits = [];
  // 1) mots isolés
  for (const t of tokens) {
    const sev = severityOf(t.norm);
    if (sev) {
      flagged.push([t.start, t.end]);
      severity = Math.max(severity, sev);
      hits.push(t.norm);
    }
  }
  // 2) lettres séparées : « c o n n a r d », « p.u.t.e », « f d p »
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].norm.length > 2) continue;
    let joined = '';
    for (let j = i; j < tokens.length && tokens[j].norm.length <= 2 && joined.length < 20; j++) {
      joined += tokens[j].norm;
      if (j > i) {
        const sev = severityOf(joined);
        if (sev) {
          flagged.push([tokens[i].start, tokens[j].end]);
          severity = Math.max(severity, sev);
          hits.push(joined);
        }
      }
    }
  }
  // 3) phrases collées sans espaces (« sale noir » -> « salenoir », « tue toi »)
  const compact = tokens.map((t) => t.norm).join('');
  for (const [root, sev] of ROOT_LIST) {
    if (sev === 2 && root.length >= 6 && compact.includes(root) && !hits.some((h) => h.startsWith(root))) {
      severity = Math.max(severity, sev);
      hits.push(root);
      flagged.push([0, original.length]); // phrase haineuse : tout le message est masqué
    }
  }

  let clean = original;
  for (const [s, e] of flagged.sort((a, b) => b[0] - a[0])) {
    clean = clean.slice(0, s) + clean.slice(s, e).replace(/[^\s]/g, '*') + clean.slice(e);
  }
  return { severity, clean, hits };
}

/** Pour les pseudos et noms de famille : refusés s'ils contiennent quoi que ce soit d'injurieux. */
export function isOffensiveName(name) {
  if (moderate(name).severity > 0) return true;
  // Noms collés : « LeConnard », « xXputeXx »
  const n = normalize(name).replace(/[^a-z]/g, '');
  const bare = n.replace(/^x+|x+$/g, ''); // décorations « xX…Xx »
  if (EXACT_MAP.has(bare)) return true;
  const contains = (word) => {
    for (let i = n.indexOf(word); i !== -1; i = n.indexOf(word, i + 1)) {
      if (!ALLOW_LIST.some((a) => n.startsWith(a, i))) return true; // « Violette » n'est pas « viol »
    }
    return false;
  };
  return ROOT_LIST.some(([root]) => root.length >= 4 && contains(root)) || [...EXACT_MAP.keys()].some((w) => w.length >= 5 && contains(w));
}

// --- Sanctions --------------------------------------------------------------------------
export const SANCTIONS = Object.freeze({
  windowMs: 30 * 60_000, // les points d'avertissement s'effacent après 30 min
  threshold: 3, // points avant mise au silence
  // durée de mise au silence selon le nombre de sanctions déjà reçues
  muteMs: [5 * 60_000, 30 * 60_000, 24 * 3_600_000],
});

/**
 * Enregistre une infraction sur le profil et décide d'une éventuelle mise au silence.
 * @returns {{ points: number, mutedUntil: number | null }}
 */
export function addStrike(profile, severity, now = Date.now()) {
  const mod = (profile.moderation ??= { strikes: [], mutes: 0, mutedUntil: 0 });
  mod.strikes = mod.strikes.filter((s) => now - s.at < SANCTIONS.windowMs);
  mod.strikes.push({ at: now, points: severity === 2 ? 2 : 1 });
  const points = mod.strikes.reduce((a, s) => a + s.points, 0);
  if (points >= SANCTIONS.threshold) {
    const d = SANCTIONS.muteMs[Math.min(mod.mutes, SANCTIONS.muteMs.length - 1)];
    mod.mutedUntil = now + d;
    mod.mutes += 1;
    mod.strikes = [];
    return { points, mutedUntil: mod.mutedUntil };
  }
  return { points, mutedUntil: null };
}

export function mutedUntil(profile, now = Date.now()) {
  const t = profile.moderation?.mutedUntil ?? 0;
  return t > now ? t : 0;
}
