/**
 * Build dictionary.md for a (target, native) course by extracting every
 * vocabulary entry from the lessons and texts in
 * courses/<target>/<native>/.
 *
 *   npx tsx web/scripts/build-dictionary.ts --target=fr --native=ru
 *
 * Sources:
 *   1. lessons/lesson_NN.md — every table under an H2 whose heading contains
 *      "Словарь" (matches both bare "## Словарь" and "## Часть N: Словарь — ...").
 *      Only tables whose header row is "| Французский | ... | Русский |" are
 *      mined; grammar tables under the same H2 are skipped.
 *
 *   2. texts/text_NN_{a,b,c}.md — the single 2-column table under "## Список
 *      слов и фраз" (the bilingual vocab footer of every TTS text).
 *
 * Article-and-gender inference is target-specific. The first column of every
 * row is parsed for a leading article (le/la/les/l'/un/une/des for French),
 * which both supplies the gender marker and is stripped to compute the sort
 * lemma. Reflexive verb markers (se /s') are also stripped for sorting.
 *
 * Dedup key is the first-column entry text (lower-cased, with internal
 * whitespace collapsed) — same entry surfacing in multiple lessons collapses
 * to one row in the final dictionary.
 *
 * Output overwrites courses/<target>/<native>/dictionary.md. Idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';

const COURSES_ROOT = path.resolve(__dirname, '..', '..', 'courses');

interface Args {
  target: string;
  native: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string, dflt?: string): string => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    if (!hit) {
      if (dflt !== undefined) return dflt;
      throw new Error(`Missing --${k}=…`);
    }
    return hit.slice(k.length + 3);
  };
  // The dictionary is now consolidated across all courses for a (target,
  // native) pair — the `--course` arg was dropped.
  return { target: get('target'), native: get('native') };
}

interface Lang {
  // Articles whose presence implies a gender. Order matters — longest match
  // first, multi-word forms before single-word.
  articles: { article: string; gender: 'm' | 'f' | 'n' | 'pl' }[];
  // Reflexive prefixes to strip when computing the sort lemma.
  reflexive: string[];
  // Headings the parser looks for in lessons and texts.
  vocabH2Pattern: RegExp;
  textTableH2Pattern: RegExp;
  // Header-row patterns identifying a vocabulary table (vs. a grammar table).
  headerRowPattern: RegExp;
  // Locale-specific title and intro for the generated dictionary.md.
  title: string;
  subtitle: string;
  sortRule: string;
  alphabet: string[];
  columnHeaders: { target: string; gender: string; native: string };
  /** Native-language label preceding the entry total, e.g. "Total entries". */
  totalLabel: string;
}

const SPANISH_ALPHABET = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z',
];

// Hebrew alphabet — 22 letters in their canonical order. Final-form letters
// (ך ם ן ף ץ) sort with their parent letters (כ מ נ פ צ) — not separately —
// because they're variants, not distinct letters in the alphabet.
const HEBREW_ALPHABET = [
  'א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת',
];

// Serbian Cyrillic — 30 letters in the conventional Vuk Karadžić order.
// Buckets entries written in Cyrillic. Latinica spellings of the same words
// also sort into these buckets if they appear (rare in the dictionary, which
// is primarily Cyrillic-first).
const SERBIAN_CYRILLIC_ALPHABET = [
  'А','Б','В','Г','Д','Ђ','Е','Ж','З','И','Ј','К','Л','Љ','М','Н','Њ','О','П','Р','С','Т','Ћ','У','Ф','Х','Ц','Ч','Џ','Ш',
];

// Georgian Mkhedruli — 33 letters in conventional order. No case in Mkhedruli.
const GEORGIAN_MKHEDRULI_ALPHABET = [
  'ა','ბ','გ','დ','ე','ვ','ზ','თ','ი','კ','ლ','მ','ნ','ო','პ','ჟ','რ','ს','ტ','უ','ფ','ქ','ღ','ყ','შ','ჩ','ც','ძ','წ','ჭ','ხ','ჯ','ჰ',
];

// Keyed by `${target}.${native}` (the courseKey). The vocab heading, table
// column headers, and dictionary title are all native-language-specific —
// so adding an English-native variant of an existing target is a new entry,
// not a reuse.
const LANGS: Record<string, Lang> = {
  'es.ru': {
    articles: [
      { article: 'los ', gender: 'pl' },
      { article: 'las ', gender: 'pl' },
      { article: 'unos ', gender: 'pl' },
      { article: 'unas ', gender: 'pl' },
      { article: 'el ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: 'un ', gender: 'm' },
      { article: 'una ', gender: 'f' },
    ],
    // Spanish reflexives are suffixed (-se) in infinitives. Strip the trailing
    // "se" only when it would otherwise dominate the sort lemma. Leading se/me/te
    // pronouns only appear in conjugated forms, not dictionary entries.
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Испанский\s*\|/i,
    title: 'Словарь курса испанского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → C1)',
    sortRule:
      'Сортировка по ключевому слову (артикли el/la/los/las/un/una/unos/unas не учитываются при сортировке)',
    alphabet: SPANISH_ALPHABET,
    columnHeaders: { target: 'Испанский', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'es.en': {
    articles: [
      { article: 'los ', gender: 'pl' },
      { article: 'las ', gender: 'pl' },
      { article: 'unos ', gender: 'pl' },
      { article: 'unas ', gender: 'pl' },
      { article: 'el ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: 'un ', gender: 'm' },
      { article: 'una ', gender: 'f' },
    ],
    reflexive: [],
    // English-native lessons use "## Part N: Vocabulary — …" headings.
    vocabH2Pattern: /^##\s.*([Vv]ocab|[Сс]ловарь)/,
    textTableH2Pattern: /^##\s.*([Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*Spanish\s*\|/i,
    title: 'Spanish course dictionary',
    subtitle: '50 lessons + 150 listening texts (A1 → C1)',
    sortRule:
      'Sorted by key word (articles el/la/los/las/un/una/unos/unas and reflexive "se" not counted for sorting)',
    alphabet: SPANISH_ALPHABET,
    columnHeaders: { target: 'Spanish', gender: 'Gender', native: 'English' },
    totalLabel: 'Total entries',
  },
  'es.pl': {
    articles: [
      { article: 'los ', gender: 'pl' },
      { article: 'las ', gender: 'pl' },
      { article: 'unos ', gender: 'pl' },
      { article: 'unas ', gender: 'pl' },
      { article: 'el ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: 'un ', gender: 'm' },
      { article: 'una ', gender: 'f' },
    ],
    reflexive: [],
    vocabH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Сс]ловарь)/,
    textTableH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*Hiszpański\s*\|/i,
    title: 'Słownik kursu hiszpańskiego',
    subtitle: '50 lekcji + 150 tekstów do słuchania (A1 → C1)',
    sortRule:
      'Sortowanie po słowie kluczowym (rodzajniki el/la/los/las/un/una/unos/unas oraz zwrotne "se" nie są uwzględniane przy sortowaniu)',
    alphabet: SPANISH_ALPHABET,
    columnHeaders: { target: 'Hiszpański', gender: 'Rodzaj', native: 'Polski' },
    totalLabel: 'Łącznie haseł',
  },
  'he.ru': {
    // Hebrew uses ה- as a prefix article, not a separate word — stripping is
    // done via prefix detection rather than the article-prefix list approach
    // used by Romance languages. Leave articles empty; gender is parsed from
    // the explicit Gender column.
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Иврит\s*\|/i,
    title: 'Словарь курса иврита',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → B2)',
    sortRule:
      'Сортировка по ключевому слову (артикль ה- и предлог-приставки ב-/ל-/מ- не учитываются при сортировке)',
    alphabet: HEBREW_ALPHABET,
    columnHeaders: { target: 'Иврит', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'sr.ru': {
    // Serbian — no preposed definite articles to strip; gender is read from
    // the Gender column in vocab tables. Allow either cyrillic or latinica
    // header rows since some lessons use either.
    articles: [],
    reflexive: ['се ', 'se '],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Сербский\s*\|/i,
    title: 'Словарь курса сербского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → B2)',
    sortRule:
      'Сортировка по ключевому слову (возвратное "се" не учитывается при сортировке)',
    alphabet: SERBIAN_CYRILLIC_ALPHABET,
    columnHeaders: { target: 'Сербский', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'ka.ru': {
    // Georgian has no preposed articles to strip and no grammatical gender —
    // the Gender column in vocab tables is usually empty or holds a
    // part-of-speech tag. Leave articles/reflexive empty; the vocab parser
    // will read whatever is in the Gender column verbatim.
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Грузинский\s*\|/i,
    title: 'Словарь курса грузинского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → B2)',
    sortRule:
      'Сортировка по ключевому слову. Сортировка по грузинскому алфавиту (мхедрули).',
    alphabet: GEORGIAN_MKHEDRULI_ALPHABET,
    columnHeaders: { target: 'Грузинский', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'fr.ru': {
    articles: [
      { article: 'les ', gender: 'pl' },
      { article: 'des ', gender: 'pl' },
      { article: 'le ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: "l'", gender: 'm' }, // l' alone is ambiguous; default m, override per-entry below
      { article: 'un ', gender: 'm' },
      { article: 'une ', gender: 'f' },
    ],
    reflexive: ['se ', "s'"],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Французский\s*\|/i,
    title: 'Словарь курса французского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → C1)',
    sortRule:
      'Сортировка по ключевому слову (артикли le/la/les/un/une/des и возвратное se не учитываются при сортировке)',
    alphabet: [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
      'N',
      'O',
      'P',
      'Q',
      'R',
      'S',
      'T',
      'U',
      'V',
      'W',
      'X',
      'Y',
      'Z',
    ],
    columnHeaders: { target: 'Французский', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'fr.en': {
    articles: [
      { article: 'les ', gender: 'pl' },
      { article: 'des ', gender: 'pl' },
      { article: 'le ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: "l'", gender: 'm' },
      { article: 'un ', gender: 'm' },
      { article: 'une ', gender: 'f' },
    ],
    reflexive: ['se ', "s'"],
    // English-native lessons use "## Part N: Vocabulary — …" headings.
    // Match the English forms; also accept the Russian forms as fallback in
    // case a lesson borrowed from the fr/ru source.
    vocabH2Pattern: /^##\s.*([Vv]ocab|[Сс]ловарь)/,
    // Texts use a variety of footer headings across agents — Word list, Word
    // and phrase list, Vocabulary, etc. Match any H2 mentioning vocab/word/
    // phrase or the Russian equivalents.
    textTableH2Pattern: /^##\s.*([Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*French\s*\|/i,
    title: 'French course dictionary',
    subtitle: '50 lessons + 150 listening texts (A1 → C1)',
    sortRule:
      'Sorted by key word (articles le/la/les/un/une/des and reflexive "se" not counted for sorting)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'French', gender: 'Gender', native: 'English' },
    totalLabel: 'Total entries',
  },
  'de.ru': {
    // Definite articles in nominative singular are what appear in dictionary
    // entries (`der Tag`, `die Stadt`, `das Haus`). Plural `die` is also `die`
    // — ambiguous with feminine singular, but in dictionary form we default
    // to feminine; genuine plural-only entries are rare in the corpus.
    articles: [
      { article: 'der ', gender: 'm' },
      { article: 'die ', gender: 'f' },
      { article: 'das ', gender: 'n' },
    ],
    // German reflexive verbs have "sich " before the verb in dictionary form
    // ("sich freuen", "sich entspannen"). Strip for sorting.
    reflexive: ['sich '],
    // Lessons use `## Часть: Словарь юнита` for the per-unit vocab section.
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    // losreden50 text files don't currently have a vocab table — the pattern
    // is included for parity with other languages in case texts grow one.
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Немецкий\s*\|/i,
    title: 'Немецкий словарь',
    subtitle: 'A1 → B1 · по частотному списку Гёте (B1) и лексике курсов',
    sortRule:
      'Сортировка по ключевому слову (артикли der/die/das и возвратное sich не учитываются при сортировке)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'Немецкий', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'de.en': {
    articles: [
      { article: 'der ', gender: 'm' },
      { article: 'die ', gender: 'f' },
      { article: 'das ', gender: 'n' },
    ],
    reflexive: ['sich '],
    // English-native lessons use `## Part N: Vocabulary — …` or `## Vocabulary` headings;
    // accept Russian fallback for any imported source.
    vocabH2Pattern: /^##\s.*([Vv]ocab|[Сс]ловарь)/,
    textTableH2Pattern: /^##\s.*([Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*German\s*\|/i,
    title: 'German vocabulary',
    subtitle: 'A1 → B1 · Goethe B1 frequency list + course vocabulary',
    sortRule:
      'Sorted by key word (articles der/die/das and reflexive "sich" not counted for sorting)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'German', gender: 'Gender', native: 'English' },
    totalLabel: 'Total entries',
  },
  'de.pl': {
    articles: [
      { article: 'der ', gender: 'm' },
      { article: 'die ', gender: 'f' },
      { article: 'das ', gender: 'n' },
    ],
    reflexive: ['sich '],
    // Polish-native lessons use `## Część N: Słownictwo …` or similar.
    vocabH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Сс]ловарь)/,
    textTableH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*Niemiecki\s*\|/i,
    title: 'Słownictwo niemieckie',
    subtitle: 'A1 → B1 · lista frekwencyjna B1 (Goethe) + słownictwo kursów',
    sortRule:
      'Sortowanie po słowie kluczowym (rodzajniki der/die/das oraz zwrotne "sich" nie są uwzględniane przy sortowaniu)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'Niemiecki', gender: 'Rodzaj', native: 'Polski' },
    totalLabel: 'Łącznie haseł',
  },
  'fr.pl': {
    articles: [
      { article: 'les ', gender: 'pl' },
      { article: 'des ', gender: 'pl' },
      { article: 'le ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: "l'", gender: 'm' },
      { article: 'un ', gender: 'm' },
      { article: 'une ', gender: 'f' },
    ],
    reflexive: ['se ', "s'"],
    // Polish-native lessons use "## Część N: Słownictwo — …" headings; also
    // match "Słownik" and the fallback Russian/English forms in case agents
    // borrow from the fr/ru or fr/en source.
    vocabH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Сс]ловарь)/,
    // Texts use a variety of footer headings: "Lista słów", "Słownik",
    // "Słownictwo", "Word list", "Vocabulary"… match any. The ł[oó]w covers
    // both "słow-" (Słownik/Słownictwo) and "słów" (Lista słów).
    textTableH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Ww]ord|[Pp]hrase|[Сс]лов)/,
    headerRowPattern: /^\|\s*Francuski\s*\|/i,
    title: 'Słownik kursu francuskiego',
    subtitle: '50 lekcji + 150 tekstów do słuchania (A1 → C1)',
    sortRule:
      'Sortowanie po słowie kluczowym (rodzajniki le/la/les/un/une/des oraz zwrotne se nie są uwzględniane przy sortowaniu)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'Francuski', gender: 'Rodzaj', native: 'Polski' },
    totalLabel: 'Łącznie haseł',
  },
  // English has no grammatical gender; gender column will be empty.
  'en.ru': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Сс]ловарь/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*English\s*\|/i,
    title: 'Словарь курса английского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → C1)',
    sortRule: 'Сортировка по ключевому слову',
    alphabet: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    columnHeaders: { target: 'English', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
  'en.pl': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab)/,
    textTableH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Ww]ord|[Pp]hrase)/,
    headerRowPattern: /^\|\s*English\s*\|/i,
    title: 'Słownik kursu angielskiego',
    subtitle: '50 lekcji + 150 tekstów do słuchania (A1 → C1)',
    sortRule: 'Sortowanie po słowie kluczowym',
    alphabet: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    columnHeaders: { target: 'English', gender: 'Rodzaj', native: 'Polski' },
    totalLabel: 'Łącznie haseł',
  },
  'en.de': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*([Ww]ortschatz|[Vv]ocab)/,
    textTableH2Pattern: /^##\s.*([Ww]ort|[Ww]endung|[Vv]ocab|[Pp]hrase)/,
    headerRowPattern: /^\|\s*English\s*\|/i,
    title: 'Wörterbuch des Englischkurses',
    subtitle: '50 Lektionen + 150 Hörtexte (A1 → C1)',
    sortRule: 'Sortiert nach Stichwort',
    alphabet: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    columnHeaders: { target: 'English', gender: 'Genus', native: 'Deutsch' },
    totalLabel: 'Einträge insgesamt',
  },
  'fr.de': {
    articles: [
      { article: 'les ', gender: 'pl' },
      { article: 'des ', gender: 'pl' },
      { article: 'le ', gender: 'm' },
      { article: 'la ', gender: 'f' },
      { article: "l'",  gender: 'm' },
      { article: 'un ', gender: 'm' },
      { article: 'une ', gender: 'f' },
    ],
    reflexive: ['se ', "s'"],
    vocabH2Pattern: /^##\s.*([Ww]ortschatz|[Vv]ocab)/,
    textTableH2Pattern: /^##\s.*([Ww]ort|[Ww]endung|[Vv]ocab|[Pp]hrase)/,
    headerRowPattern: /^\|\s*Französisch\s*\|/i,
    title: 'Wörterbuch des Französischkurses',
    subtitle: '50 Lektionen + 150 Hörtexte (A1 → C1)',
    sortRule: 'Sortiert nach Stichwort (Artikel le/la/les/un/une/des und reflexives se werden beim Sortieren ignoriert)',
    alphabet: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    columnHeaders: { target: 'Französisch', gender: 'Genus', native: 'Deutsch' },
    totalLabel: 'Einträge insgesamt',
  },
  'he.en': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Vv]ocab/,
    textTableH2Pattern: /^##\s.*([Vv]ocab|[Ww]ord|[Pp]hrase|[Ll]ist)/,
    headerRowPattern: /^\|\s*Hebrew\s*\|/i,
    title: 'Hebrew course dictionary',
    subtitle: '50 lessons + 150 listening texts (A1 → B2)',
    sortRule: 'Sorted by key word (definite article ה and prefixes ב/ל/מ ignored for sorting)',
    alphabet: HEBREW_ALPHABET,
    columnHeaders: { target: 'Hebrew', gender: 'Gender', native: 'English' },
    totalLabel: 'Total entries',
  },
  'he.de': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*[Ww]ortschatz/,
    textTableH2Pattern: /^##\s.*([Ww]ort|[Ww]endung|[Vv]ocab)/,
    headerRowPattern: /^\|\s*Hebr[aä]isch\s*\|/i,
    title: 'Wörterbuch des Hebräischkurses',
    subtitle: '50 Lektionen + 150 Hörtexte (A1 → B2)',
    sortRule: 'Sortiert nach Stichwort (Artikel ה- und Präfixe ב-/ל-/מ- werden ignoriert)',
    alphabet: HEBREW_ALPHABET,
    columnHeaders: { target: 'Hebräisch', gender: 'Genus', native: 'Deutsch' },
    totalLabel: 'Einträge insgesamt',
  },
  'he.pl': {
    articles: [],
    reflexive: [],
    vocabH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab)/,
    textTableH2Pattern: /^##\s.*([Ss]ł[oó]w|[Vv]ocab|[Ww]ord)/,
    headerRowPattern: /^\|\s*Hebrajski\s*\|/i,
    title: 'Słownik kursu hebrajskiego',
    subtitle: '50 lekcji + 150 tekstów do słuchania (A1 → B2)',
    sortRule: 'Sortowanie po słowie kluczowym (rodzajnik ה- i przedrostki ב-/ל-/מ- nie są uwzględniane)',
    alphabet: HEBREW_ALPHABET,
    columnHeaders: { target: 'Hebrajski', gender: 'Rodzaj', native: 'Polski' },
    totalLabel: 'Łącznie haseł',
  },
  'it.en': {
    articles: [
      { article: 'gli ', gender: 'pl' },
      { article: 'le ',  gender: 'pl' },
      { article: 'i ',   gender: 'pl' },
      { article: 'il ',  gender: 'm' },
      { article: 'lo ',  gender: 'm' },
      { article: 'la ',  gender: 'f' },
      { article: "l'",   gender: 'm' },
      { article: 'un ',  gender: 'm' },
      { article: 'uno ', gender: 'm' },
      { article: 'una ', gender: 'f' },
      { article: "un'",  gender: 'f' },
    ],
    reflexive: [],
    vocabH2Pattern: /^##\s.*([Vv]ocab|[Сс]ловарь)/,
    textTableH2Pattern: /^##\s.*([Vv]ocab|[Ww]ord|[Pp]hrase|[Ll]ist|[Сс]лов)/,
    headerRowPattern: /^\|\s*Italiano\s*\|/i,
    title: 'Italian course dictionary',
    subtitle: '50 lessons + 150 listening texts (A1 → B2)',
    sortRule: "Sorted by key word (articles il/lo/la/l'/i/gli/le/un/uno/una/un' are ignored for sorting)",
    alphabet: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
    columnHeaders: { target: 'Italiano', gender: 'Gender', native: 'English' },
    totalLabel: 'Total entries',
  },
  'it.ru': {
    articles: [
      { article: 'gli ', gender: 'pl' },
      { article: 'le ',  gender: 'pl' },
      { article: 'i ',   gender: 'pl' },
      { article: 'il ',  gender: 'm' },
      { article: 'lo ',  gender: 'm' },
      { article: 'la ',  gender: 'f' },
      { article: "l'",   gender: 'm' }, // l' is ambiguous; default m
      { article: 'un ',  gender: 'm' },
      { article: 'uno ', gender: 'm' },
      { article: 'una ', gender: 'f' },
      { article: "un'",  gender: 'f' },
    ],
    // Italian reflexive infinitives end in -si (alzarsi, lavarsi). Strip the
    // trailing "si" for sort lemma — handled below as a special case rather
    // than via prefix stripping, so leave reflexive empty here.
    reflexive: [],
    // Italian lessons use "## Часть N: Словарь — …", "## Словарный запас урока",
    // or "## … Лексика" — author choice varies between blocks.
    vocabH2Pattern: /^##\s.*([Сс]ловарь|[Сс]ловарный\s+запас|[Лл]ексика)/,
    textTableH2Pattern: /^##\s.*([Сс]писок\s+слов|[Сс]ловарь)/,
    headerRowPattern: /^\|\s*Italiano\s*\|/i,
    title: 'Словарь курса итальянского языка',
    subtitle: '50 уроков + 150 текстов для аудирования (A1 → B2)',
    sortRule:
      'Сортировка по ключевому слову (артикли il/lo/la/l\'/i/gli/le/un/uno/una/un\' не учитываются при сортировке)',
    alphabet: [
      'A','B','C','D','E','F','G','H','I','J','K','L','M',
      'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    ],
    columnHeaders: { target: 'Italiano', gender: 'Род', native: 'Русский' },
    totalLabel: 'Всего словарных единиц',
  },
};

interface Entry {
  target: string; // first-column text, original casing
  gender: string; // m/f/pl or '' if not derivable
  native: string; // translation
  lemma: string; // sort key (lowercase, no article, no diacritics for sorting bucket)
}

function inferGender(targetForm: string, lang: Lang): { gender: string; rest: string } {
  const lower = targetForm.toLowerCase();
  for (const a of lang.articles) {
    if (lower.startsWith(a.article.toLowerCase())) {
      return { gender: a.gender, rest: targetForm.slice(a.article.length) };
    }
  }
  return { gender: '', rest: targetForm };
}

function computeLemma(targetForm: string, lang: Lang): string {
  const { rest: afterArticle } = inferGender(targetForm, lang);
  let s = afterArticle.toLowerCase();
  for (const rfx of lang.reflexive) {
    if (s.startsWith(rfx)) s = s.slice(rfx.length);
  }
  // Drop trailing parenthetical notes for sorting only — keep them in the
  // displayed target column. "des lunettes (f. pl.)" → lemma "lunettes".
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return s;
}

function firstSortChar(lemma: string, alphabet?: string[]): string {
  // Strip leading punctuation (apostrophes etc) and diacritics for bucketing.
  // NFD splits combining diacritics (Latin accents, Hebrew niqqud) so we get
  // at the base letter underneath. We strip both Latin combining marks and
  // Hebrew niqqud/cantillation (U+0591–U+05C7).
  const stripped = lemma
    .replace(/^['’]/, '')
    .normalize('NFD')
    .replace(/[̀-֑ͯ-ׇ]/g, '');
  const ch0 = stripped.charAt(0);
  const chU = ch0.toUpperCase();
  // Latin alphabets bucket case-insensitively under the uppercase letter.
  if (/[A-Z]/.test(chU)) return chU;
  // Non-Latin alphabets (Hebrew, Cyrillic, etc.) bucket under whichever case
  // appears in the alphabet array. Cyrillic alphabets are typically listed in
  // uppercase, Hebrew has no case — try both.
  if (alphabet) {
    if (alphabet.includes(chU)) return chU;
    if (alphabet.includes(ch0)) return ch0;
  }
  return '#';
}

interface ParsedTable {
  headerCols: string[];
  rows: string[][];
}

function parseTable(lines: string[], startIdx: number): { table: ParsedTable; nextIdx: number } {
  // Header row at startIdx, separator at startIdx+1, then data rows.
  const headerCols = splitRow(lines[startIdx]!);
  let i = startIdx + 2;
  const rows: string[][] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith('|')) break;
    rows.push(splitRow(line));
    i++;
  }
  return { table: { headerCols, rows }, nextIdx: i };
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function findVocabTablesInLesson(content: string, lang: Lang): ParsedTable[] {
  const lines = content.split('\n');
  const tables: ParsedTable[] = [];
  let inVocabSection = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) {
      inVocabSection = lang.vocabH2Pattern.test(line);
      i++;
      continue;
    }
    if (inVocabSection && lang.headerRowPattern.test(line)) {
      const { table, nextIdx } = parseTable(lines, i);
      tables.push(table);
      i = nextIdx;
      continue;
    }
    i++;
  }
  return tables;
}

function findVocabTablesInText(content: string, lang: Lang): ParsedTable[] {
  const lines = content.split('\n');
  const tables: ParsedTable[] = [];
  let afterTextVocabH2 = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) {
      afterTextVocabH2 = lang.textTableH2Pattern.test(line);
      i++;
      continue;
    }
    if (afterTextVocabH2 && lang.headerRowPattern.test(line)) {
      const { table, nextIdx } = parseTable(lines, i);
      tables.push(table);
      i = nextIdx;
      continue;
    }
    i++;
  }
  return tables;
}

/**
 * Strip authoring clutter from the target column: trailing parenthetical
 * gender markers like "(f)", grammar tails like "(+ subj.)" or " + subj",
 * and extra whitespace. Multi-variant forms ("beau / belle / bel") are kept
 * as-is — they're the standard dictionary form for variable adjectives.
 */
function cleanTarget(target: string): string {
  return target
    .replace(/\s*\(\s*[mfn]\.?\s*(?:pl\.?)?\s*\)\s*$/i, '') // (f), (m. pl.)
    .replace(/\s*\(\s*\+?\s*subj\.?\s*\)\s*$/i, '') // (+ subj.)
    .replace(/\s+\+\s+subj\.?\s*$/i, '') // + subj
    .replace(/\s+\+\s+infinitif\s*$/i, '') // + infinitif
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True for rows that look like example sentences rather than vocabulary
 * entries — they slip in when the model puts an example into the table.
 * Heuristics: native column wrapped in italics (model formatted it as a
 * quotation), or target column has 6+ tokens (real entries are 1–5).
 */
const REGISTER_TAG_ONLY = /^(familier|soutenu|courant|populaire|argot|formel|informel|вульг\.?|разг\.?)$/i;

function looksLikeExample(target: string, native: string): boolean {
  if (/^\*.*\*$/.test(native)) return true; // model wrapped an example in italics
  if (native.length > 100) return true;
  if (target.includes('...') || target.includes('…')) return true; // skeleton like "il ... que"
  if (/^→/.test(native.trim())) return true; // cross-reference, not a translation
  if (REGISTER_TAG_ONLY.test(native.trim())) return true; // Russian col is just a register tag
  if (target.split(/\s+/).length > 5) return true;
  return false;
}

function tableToEntries(table: ParsedTable, lang: Lang): Entry[] {
  // Find the gender and native columns by header label (anywhere in the row,
  // not just specific positions). Hebrew tables look like "Иврит | Транслит |
  // Род | Перевод | Мн.ч." — gender at index 2, native at index 3. German
  // tables can be "Немецкий | Русский | Пример" — taking row[row.length-1]
  // grabs the example sentence instead of the translation.
  const cols = table.headerCols;
  const genderLabel = lang.columnHeaders.gender.toLowerCase();
  const nativeLabel = lang.columnHeaders.native.toLowerCase();
  const genderIdx = cols.findIndex((c) => c.toLowerCase().includes(genderLabel));
  const explicitNativeIdx = cols.findIndex((c) => c.toLowerCase().includes(nativeLabel));
  return table.rows
    .filter((row) => row.length >= 2 && row[0]! && (explicitNativeIdx >= 0 ? row[explicitNativeIdx] : row[row.length - 1])!)
    .map((row) => {
      const rawTarget = row[0]!.trim();
      const target = cleanTarget(rawTarget);
      // Prefer the column whose header matches the configured native label.
      // Fall back to the last column for legacy 2-column tables that omit
      // headers like "Русский"/"Polski" but still keep a single translation
      // column on the right.
      const native = (explicitNativeIdx >= 0 ? row[explicitNativeIdx] : row[row.length - 1])!.trim();
      let gender: string;
      if (genderIdx >= 0 && row[genderIdx]) {
        gender = row[genderIdx]!.trim();
      } else {
        gender = inferGender(target, lang).gender;
      }
      const lemma = computeLemma(target, lang);
      return { target, gender, native, lemma };
    })
    .filter((e) => e.lemma.length > 0 && !looksLikeExample(e.target, e.native));
}

/**
 * A target form is "preferred" over a synonym when it leads with a
 * definite article. "le café" beats "un café" beats bare "café" — matches
 * the German dictionary's convention.
 */
function targetPreferenceRank(target: string): number {
  const lower = target.toLowerCase();
  if (/^(le|la|les|l')/.test(lower)) return 0;
  if (/^(un|une|des)/.test(lower)) return 1;
  return 2;
}

function dedupe(entries: Entry[]): Entry[] {
  // Key on (lemma, gender). "la bagnole" and "une bagnole" and "la bagnole (f)"
  // all collapse to lemma=bagnole / gender=f. Genuinely distinct entries —
  // "le café" m vs "la cave" f — stay split.
  const seen = new Map<string, Entry>();
  for (const e of entries) {
    const key = `${e.lemma}::${e.gender}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, e);
      continue;
    }
    if (targetPreferenceRank(e.target) < targetPreferenceRank(existing.target)) {
      existing.target = e.target;
    }
    if (existing.native.length < e.native.length && e.native.length < 80) {
      existing.native = e.native;
    }
  }
  return [...seen.values()];
}

function sortAndGroup(entries: Entry[], lang: Lang): Map<string, Entry[]> {
  entries.sort((a, b) =>
    a.lemma.localeCompare(b.lemma, 'fr', { sensitivity: 'base' }) ||
    a.target.localeCompare(b.target, 'fr', { sensitivity: 'base' }),
  );
  const groups = new Map<string, Entry[]>();
  for (const letter of lang.alphabet) groups.set(letter, []);
  groups.set('#', []);
  for (const e of entries) {
    const letter = firstSortChar(e.lemma, lang.alphabet);
    const bucket = groups.get(letter) ?? groups.get('#')!;
    bucket.push(e);
  }
  return groups;
}

function renderMarkdown(groups: Map<string, Entry[]>, total: number, lang: Lang): string {
  const out: string[] = [];
  out.push(`# ${lang.title}`);
  out.push(`**${lang.subtitle}**`);
  out.push('');
  out.push(`${lang.totalLabel}: **${total}**`);
  out.push('');
  out.push(`> ${lang.sortRule}`);
  out.push('');
  out.push('---');
  out.push('');
  for (const [letter, rows] of groups) {
    if (rows.length === 0) continue;
    out.push(`## ${letter}`);
    out.push('');
    out.push(`| ${lang.columnHeaders.target} | ${lang.columnHeaders.gender} | ${lang.columnHeaders.native} |`);
    out.push('|-------------|-----|---------|');
    for (const e of rows) {
      out.push(`| ${e.target} | ${e.gender} | ${e.native} |`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

/**
 * Load supplementary entries from a shared per-target list. Currently only
 * German is wired up — courses/_shared/goethe_b1_de.md is the Goethe-Institut
 * B1 frequency wortliste with translations for every supported native.
 *
 * The supplementary file has a header table:
 *   | German | Gender | Russian | English | Polish |
 *
 * We project to (target, native, gender) Entries that flow into the same
 * dedupe step as lesson-derived entries — supplementary entries lose to
 * any matching (lemma, gender) coming from the course corpus.
 */
function loadSupplementary(target: TargetLang, native: NativeLang, lang: Lang): Entry[] {
  if (target !== 'de') return [];
  const file = path.join(COURSES_ROOT, '_shared', 'goethe_b1_de.md');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  // Header: | German | Gender | Russian | English | Polish |
  // 5 cells after stripping the leading/trailing empties of split('|').
  const nativeCol: Record<NativeLang, number> = { ru: 2, en: 3, pl: 4 };
  const col = nativeCol[native];
  const out: Entry[] = [];
  let inTable = false;
  for (const ln of lines) {
    if (!ln.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = ln.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    // Header / separator detection
    if (cells[0] === 'German' || /^[-:\s]+$/.test(cells[0] ?? '')) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const german = cells[0] ?? '';
    const gender = cells[1] ?? '';
    const translation = cells[col] ?? '';
    if (!german || !translation) continue;
    out.push({
      target: german,
      gender,
      native: translation,
      lemma: computeLemma(german, lang),
    });
  }
  return out;
}

function main(): void {
  const args = parseArgs();
  const courseKey = `${args.target}.${args.native}`;
  const lang = LANGS[courseKey];
  if (!lang) throw new Error(`No language config for courseKey=${courseKey}. Add to LANGS map.`);

  // Iterate every course directory that ships content for this (target,
  // native) pair. The dictionary is now consolidated — a word taught in any
  // course shows up once in the unified output.
  const allEntries: Entry[] = [];
  let lessonTables = 0;
  let textTables = 0;
  let lessonFilesTotal = 0;
  let textFilesTotal = 0;
  const courseDirs = fs
    .readdirSync(COURSES_ROOT)
    .map((slug) => ({
      slug,
      path: path.join(COURSES_ROOT, slug, args.target, args.native),
    }))
    .filter(
      (c) => !c.slug.startsWith('_') && fs.existsSync(c.path) && fs.statSync(c.path).isDirectory(),
    );
  for (const { path: courseDir } of courseDirs) {
    const lessonsDir = path.join(courseDir, 'lessons');
    const textsDir = path.join(courseDir, 'texts');
    if (fs.existsSync(lessonsDir)) {
      const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md'));
      lessonFilesTotal += files.length;
      for (const f of files) {
        const content = fs.readFileSync(path.join(lessonsDir, f), 'utf8');
        const tables = findVocabTablesInLesson(content, lang);
        lessonTables += tables.length;
        for (const t of tables) allEntries.push(...tableToEntries(t, lang));
      }
    }
    if (fs.existsSync(textsDir)) {
      const files = fs.readdirSync(textsDir).filter((f) => f.endsWith('.md'));
      textFilesTotal += files.length;
      for (const f of files) {
        const content = fs.readFileSync(path.join(textsDir, f), 'utf8');
        const tables = findVocabTablesInText(content, lang);
        textTables += tables.length;
        for (const t of tables) allEntries.push(...tableToEntries(t, lang));
      }
    }
  }
  // Supplementary entries land AFTER lesson entries so any matching
  // (lemma, gender) keeps the lesson-corpus version on dedup.
  const supplementary = loadSupplementary(args.target as TargetLang, args.native as NativeLang, lang);
  allEntries.push(...supplementary);

  const deduped = dedupe(allEntries);
  const groups = sortAndGroup(deduped, lang);
  const md = renderMarkdown(groups, deduped.length, lang);
  const outDir = path.join(COURSES_ROOT, '_shared', 'dictionaries', args.target, args.native);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dictionary.md');
  fs.writeFileSync(outPath, md);

  console.log(`Courses scanned: ${courseDirs.map((c) => c.slug).join(', ')}`);
  console.log(`Lessons: ${lessonFilesTotal} files, ${lessonTables} vocab tables`);
  console.log(`Texts:   ${textFilesTotal} files, ${textTables} vocab tables`);
  console.log(`Supplementary: ${supplementary.length} entries from goethe_b1_de.md`);
  console.log(`Entries: ${allEntries.length} raw → ${deduped.length} unique`);
  console.log(`Wrote ${outPath}`);
}

main();
