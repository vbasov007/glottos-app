#!/usr/bin/env tsx
/**
 * Second-pass dedup: lemma-level. Treats `Ich komme aus` and `kommen` as the
 * same lexeme (lemma key = `kommen`), `Wie heißt du?` and `Ich heiße` and
 * `heißen` as one (`heißen`), etc.
 *
 * Algorithm (tightened to preserve multi-word idioms)
 * ---------------------------------------------------
 * 1. For each entry, tokenize the German column and compute its content
 *    lemmas (non-stopword tokens, mapped to infinitive when recognizable
 *    as a verb form). The lemma signature is the sorted set joined by '+'.
 * 2. Walk lessons 1..50. An entry is a duplicate iff its lemma signature
 *    EXACTLY matches some entry from an EARLIER lesson. Two entries with
 *    overlapping but non-identical lemma sets both survive — so
 *    `Lust haben` (lust+haben) is kept even when `haben` (haben) was
 *    introduced earlier.
 * 3. After processing each lesson, merge that lesson's signatures into the
 *    seen set.
 *
 * Lemmatization rules (conservative)
 * ----------------------------------
 * - IRREGULAR table: known irregular verb forms (sein/haben/modals + strong
 *   verbs) map to their infinitive.
 * - Positional rules using the previous token as context:
 *     pronoun + word ending in -e (len ≥ 3)  →  word + 'n'   (Ich komme → kommen)
 *     'du'   + word ending in -st (len ≥ 4) →  word[:-2] + 'en'  (du kommst → kommen)
 *     er/sie/es + word ending in -t (len ≥ 4) → word[:-1] + 'en'  (er kommt → kommen)
 * - Past participles `ge_t` (regular weak): gemacht → machen
 * - Everything else: surface form unchanged. We deliberately don't try to
 *   lemmatize nouns ending in -t or -e without pronoun context, to avoid
 *   false collisions (das Heft → "heften" would be wrong).
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LESSONS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'courses',
  'losreden50',
  'de',
  'ru',
  'lessons',
);

const VOCAB_END = String.raw`(?=\n---\n\n>\s*\*\*Следующий шаг|$)`;
const VOCAB_SECTION_RE = new RegExp(
  String.raw`\n## Часть:\s*Словарь юнита[\s\S]*?${VOCAB_END}`,
);
const TABLE_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

const ARTICLES = new Set<string>([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einer', 'eines', 'einem',
  'kein', 'keine', 'keinen', 'keiner', 'keines', 'keinem',
  'mein', 'meine', 'meinen', 'meiner', 'meines', 'meinem',
  'dein', 'deine', 'deinen', 'deiner', 'deines', 'deinem',
  'seine', 'seinen', 'seiner', 'seines', 'seinem',
  'unser', 'unsere', 'unseren', 'unserer', 'unseres', 'unserem',
  'euer', 'eure', 'euren', 'eurer', 'eures', 'eurem',
  'dies', 'diese', 'dieser', 'dieses', 'diesen', 'diesem',
  'jede', 'jeder', 'jedes', 'jeden', 'jedem',
]);
const PRONOUNS = new Set<string>([
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'mich', 'dich', 'sich', 'mir', 'dir', 'ihm', 'uns', 'euch', 'ihnen',
  'man',
]);
const QUESTION = new Set<string>([
  'wie', 'wo', 'was', 'wer', 'wann', 'warum', 'woher', 'wohin',
  'welcher', 'welche', 'welches', 'welchen', 'welchem',
]);
const PREPOSITIONS = new Set<string>([
  'in', 'an', 'auf', 'aus', 'bei', 'mit', 'nach', 'von', 'zu', 'für', 'gegen',
  'ohne', 'um', 'durch', 'über', 'unter', 'vor', 'hinter', 'zwischen', 'neben',
  'im', 'am', 'zur', 'zum', 'ans', 'aufs', 'ins', 'beim', 'vom', 'als',
]);
const CONJUNCTIONS = new Set<string>(['und', 'oder', 'aber', 'denn', 'sondern', 'doch', 'weil', 'dass', 'ob']);

const STOPWORDS = new Set<string>([
  ...ARTICLES,
  ...PRONOUNS,
  ...QUESTION,
  ...PREPOSITIONS,
  ...CONJUNCTIONS,
]);

const IRREGULAR: Record<string, string> = {
  bin: 'sein', bist: 'sein', ist: 'sein', sind: 'sein', seid: 'sein',
  war: 'sein', warst: 'sein', waren: 'sein', wart: 'sein', gewesen: 'sein',
  habe: 'haben', hast: 'haben', hat: 'haben', habt: 'haben',
  hatte: 'haben', hattest: 'haben', hatten: 'haben', hattet: 'haben', gehabt: 'haben',
  werde: 'werden', wirst: 'werden', wird: 'werden', werdet: 'werden',
  wurde: 'werden', wurdest: 'werden', wurden: 'werden', geworden: 'werden',
  kann: 'können', kannst: 'können', könnt: 'können', konnte: 'können', konnten: 'können',
  will: 'wollen', willst: 'wollen', wollt: 'wollen', wollte: 'wollen', wollten: 'wollen',
  muss: 'müssen', musst: 'müssen', müsst: 'müssen', musste: 'müssen', mussten: 'müssen',
  mag: 'mögen', magst: 'mögen', mögt: 'mögen', mochte: 'mögen', mochten: 'mögen',
  darf: 'dürfen', darfst: 'dürfen', dürft: 'dürfen', durfte: 'dürfen', durften: 'dürfen',
  soll: 'sollen', sollst: 'sollen', sollt: 'sollen', sollte: 'sollen', sollten: 'sollen',
  möchte: 'möchten', möchtest: 'möchten', möchtet: 'möchten',
  weiß: 'wissen', weißt: 'wissen',
  gibt: 'geben', gibst: 'geben', gab: 'geben', gegeben: 'geben',
  spricht: 'sprechen', sprichst: 'sprechen', sprach: 'sprechen', gesprochen: 'sprechen',
  liest: 'lesen', las: 'lesen', gelesen: 'lesen',
  sieht: 'sehen', siehst: 'sehen', sah: 'sehen', gesehen: 'sehen',
  fährt: 'fahren', fährst: 'fahren', fuhr: 'fahren', gefahren: 'fahren',
  läuft: 'laufen', läufst: 'laufen', lief: 'laufen', gelaufen: 'laufen',
  isst: 'essen', aß: 'essen', gegessen: 'essen',
  nimmt: 'nehmen', nimmst: 'nehmen', nahm: 'nehmen', genommen: 'nehmen',
  kommt: 'kommen', kam: 'kommen', kamen: 'kommen', gekommen: 'kommen',
  geht: 'gehen', ging: 'gehen', gingen: 'gehen', gegangen: 'gehen',
  tut: 'tun', tat: 'tun', getan: 'tun',
  trifft: 'treffen', traf: 'treffen', getroffen: 'treffen',
  gefällt: 'gefallen', gefiel: 'gefallen',
  heißt: 'heißen', hieß: 'heißen', geheißen: 'heißen',
  lässt: 'lassen', ließ: 'lassen', gelassen: 'lassen',
  schläft: 'schlafen', schlief: 'schlafen', geschlafen: 'schlafen',
  trägt: 'tragen', trug: 'tragen', getragen: 'tragen',
  beginnt: 'beginnen', begann: 'beginnen', begonnen: 'beginnen',
  findet: 'finden', fand: 'finden', gefunden: 'finden',
  hilft: 'helfen', half: 'helfen', geholfen: 'helfen',
  vergisst: 'vergessen', vergaß: 'vergessen', vergessen: 'vergessen',
  bringt: 'bringen', brachte: 'bringen', gebracht: 'bringen',
  denkt: 'denken', dachte: 'denken', gedacht: 'denken',
  kennt: 'kennen', kannte: 'kennen', gekannt: 'kennen',
};

interface VocabRow {
  german: string;
  russian: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function tokensOf(germanField: string): string[] {
  return germanField
    .toLowerCase()
    .replace(/[…!?,.;:()«»"„"]/g, ' ')
    .split(/[\s\/]+/)
    .filter((t) => t.length > 0);
}

function lemmaKeys(germanField: string): Set<string> {
  const tokens = tokensOf(germanField);
  const keys = new Set<string>();
  let prev: string | null = null;
  for (const t of tokens) {
    if (STOPWORDS.has(t)) {
      prev = t;
      continue;
    }
    let lemma = t;
    if (IRREGULAR[t]) {
      lemma = IRREGULAR[t];
    } else if (/^ge[a-zäöüß]{3,}t$/.test(t)) {
      lemma = t.slice(2, -1) + 'en';
    } else if (prev !== null) {
      if (PRONOUNS.has(prev) && /^[a-zäöüß]+e$/.test(t) && t.length >= 3) {
        lemma = t + 'n';
      } else if (prev === 'du' && /^[a-zäöüß]+st$/.test(t) && t.length >= 4) {
        lemma = t.slice(0, -2) + 'en';
      } else if (
        (prev === 'er' || prev === 'sie' || prev === 'es') &&
        /^[a-zäöüß]+t$/.test(t) &&
        t.length >= 4
      ) {
        lemma = t.slice(0, -1) + 'en';
      }
    }
    keys.add(lemma);
    prev = t;
  }
  return keys;
}

function parseVocab(md: string): VocabRow[] {
  const m = md.match(VOCAB_SECTION_RE);
  if (!m) return [];
  const rows: VocabRow[] = [];
  for (const line of m[0].split('\n')) {
    const r = TABLE_ROW_RE.exec(line);
    if (!r) continue;
    const g = r[1]!.trim();
    const ru = r[2]!.trim();
    if (g === 'Немецкий') continue;
    if (/^[-:\s]+$/.test(g)) continue;
    rows.push({ german: g, russian: ru });
  }
  return rows;
}

function renderSection(entries: VocabRow[]): string {
  const rows = entries.map((e) => `| ${e.german} | ${e.russian} |`).join('\n');
  return [
    '## Часть: Словарь юнита',
    '',
    'Ключевая лексика этого юнита (AI-сводка по материалу юнита и аудио-текстам).',
    '',
    '| Немецкий | Русский |',
    '|----------|---------|',
    rows,
  ].join('\n');
}

function signature(lemmas: Set<string>): string {
  return [...lemmas].sort().join('+');
}

function main(): void {
  const seenSignatures = new Set<string>();
  for (let n = 1; n <= 50; n++) {
    const file = path.join(LESSONS_DIR, `lesson_${pad2(n)}.md`);
    const md = readFileSync(file, 'utf8');
    const items = parseVocab(md);
    if (items.length === 0) {
      console.log(`L${pad2(n)} (no vocab section)`);
      continue;
    }
    const kept: VocabRow[] = [];
    const dropped: string[] = [];
    const thisLessonAdded = new Set<string>();
    for (const item of items) {
      const keys = lemmaKeys(item.german);
      const sig = signature(keys);
      if (sig !== '' && seenSignatures.has(sig)) {
        dropped.push(item.german);
      } else {
        kept.push(item);
        if (sig !== '') thisLessonAdded.add(sig);
      }
    }
    for (const s of thisLessonAdded) seenSignatures.add(s);
    if (dropped.length > 0) {
      const updated = md.replace(VOCAB_SECTION_RE, '\n\n' + renderSection(kept));
      writeFileSync(file, updated);
    }
    const dropPreview =
      dropped.length === 0
        ? ''
        : `  drop: ${dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? ` +${dropped.length - 4}` : ''}`;
    console.log(`L${pad2(n)} ${items.length} → ${kept.length}${dropPreview}`);
  }
  console.log(`\nUnique lemma signatures across all lessons: ${seenSignatures.size}`);
}

main();
