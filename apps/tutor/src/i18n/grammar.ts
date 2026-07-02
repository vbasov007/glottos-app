import type { GrammarLabels } from './types';

export const GRAMMAR_LABELS: Record<string, GrammarLabels> = {
  de: {
    masculine: 'Maskulinum (der)', feminine: 'Femininum (die)', neuter: 'Neutrum (das)',
    cases: { nom: 'Nominativ', akk: 'Akkusativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Präsens (ich)', past: 'Präteritum', perfect: 'Perfekt',
  },
  en: {
    masculine: 'Masculine', feminine: 'Feminine', neuter: 'Neuter',
    cases: { nom: 'Nominative', akk: 'Accusative', dat: 'Dative', gen: 'Genitive' },
    infinitive: 'Infinitive', present: 'Present (I)', past: 'Past simple', perfect: 'Present perfect',
  },
  fr: {
    masculine: 'Masculin (le)', feminine: 'Féminin (la)', neuter: 'Neutre',
    cases: { nom: 'Nominatif', akk: 'Accusatif', dat: 'Datif', gen: 'Génitif' },
    infinitive: 'Infinitif', present: 'Présent (je)', past: 'Imparfait', perfect: 'Passé composé',
  },
  es: {
    masculine: 'Masculino (el)', feminine: 'Femenino (la)', neuter: 'Neutro',
    cases: { nom: 'Nominativo', akk: 'Acusativo', dat: 'Dativo', gen: 'Genitivo' },
    infinitive: 'Infinitivo', present: 'Presente (yo)', past: 'Pretérito', perfect: 'Pretérito perfecto',
  },
  it: {
    masculine: 'Maschile (il)', feminine: 'Femminile (la)', neuter: 'Neutro',
    cases: { nom: 'Nominativo', akk: 'Accusativo', dat: 'Dativo', gen: 'Genitivo' },
    infinitive: 'Infinito', present: 'Presente (io)', past: 'Imperfetto', perfect: 'Passato prossimo',
  },
  pt: {
    masculine: 'Masculino (o)', feminine: 'Feminino (a)', neuter: 'Neutro',
    cases: { nom: 'Nominativo', akk: 'Acusativo', dat: 'Dativo', gen: 'Genitivo' },
    infinitive: 'Infinitivo', present: 'Presente (eu)', past: 'Pretérito imperfeito', perfect: 'Pretérito perfeito',
  },
  ru: {
    masculine: 'Мужской (он)', feminine: 'Женский (она)', neuter: 'Средний (оно)',
    cases: { nom: 'Именительный', akk: 'Винительный', dat: 'Дательный', gen: 'Родительный' },
    infinitive: 'Инфинитив', present: 'Настоящее (я)', past: 'Прошедшее', perfect: 'Совершенный вид',
  },
  he: {
    masculine: 'זכר', feminine: 'נקבה', neuter: '—',
    cases: { nom: 'נושא', akk: 'מושא', dat: 'עקיף', gen: 'קניין' },
    infinitive: 'שם הפועל', present: 'הווה (אני)', past: 'עבר', perfect: 'עבר מושלם',
  },
  zh: {
    masculine: '阳性', feminine: '阴性', neuter: '中性',
    cases: { nom: '主格', akk: '宾格', dat: '与格', gen: '属格' },
    infinitive: '不定式', present: '现在时', past: '过去时', perfect: '完成时',
  },
  ar: {
    masculine: 'مذكر', feminine: 'مؤنث', neuter: '—',
    cases: { nom: 'مرفوع', akk: 'منصوب', dat: 'مجرور', gen: 'مضاف إليه' },
    infinitive: 'مصدر', present: 'مضارع', past: 'ماضٍ', perfect: 'تام',
  },
  hr: {
    masculine: 'Muški (on)', feminine: 'Ženski (ona)', neuter: 'Srednji (ono)',
    cases: { nom: 'Nominativ', akk: 'Akuzativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Prezent (ja)', past: 'Preterit', perfect: 'Perfekt',
  },
  ja: {
    masculine: '男性', feminine: '女性', neuter: '中性',
    cases: { nom: '主格', akk: '対格', dat: '与格', gen: '属格' },
    infinitive: '辞書形', present: '現在形', past: '過去形', perfect: '完了形',
  },
  ko: {
    masculine: '남성', feminine: '여성', neuter: '중성',
    cases: { nom: '주격', akk: '목적격', dat: '여격', gen: '속격' },
    infinitive: '기본형', present: '현재형', past: '과거형', perfect: '완료형',
  },
  nl: {
    masculine: 'Mannelijk (de)', feminine: 'Vrouwelijk (de)', neuter: 'Onzijdig (het)',
    cases: { nom: 'Nominatief', akk: 'Accusatief', dat: 'Datief', gen: 'Genitief' },
    infinitive: 'Infinitief', present: 'Tegenwoordig (ik)', past: 'Verleden', perfect: 'Voltooid',
  },
  pl: {
    masculine: 'Męski (on)', feminine: 'Żeński (ona)', neuter: 'Nijaki (ono)',
    cases: { nom: 'Mianownik', akk: 'Biernik', dat: 'Celownik', gen: 'Dopełniacz' },
    infinitive: 'Bezokolicznik', present: 'Czas teraźniejszy (ja)', past: 'Czas przeszły', perfect: 'Czas dokonany',
  },
  tr: {
    masculine: 'Eril', feminine: 'Dişil', neuter: 'Nötr',
    cases: { nom: 'Yalın', akk: 'Belirtme', dat: 'Yönelme', gen: 'Tamlayan' },
    infinitive: 'Mastar', present: 'Şimdiki zaman (ben)', past: 'Geçmiş zaman', perfect: 'Miş\'li geçmiş',
  },
  uk: {
    masculine: 'Чоловічий (він)', feminine: 'Жіночий (вона)', neuter: 'Середній (воно)',
    cases: { nom: 'Називний', akk: 'Знахідний', dat: 'Давальний', gen: 'Родовий' },
    infinitive: 'Інфінітив', present: 'Теперішній (я)', past: 'Минулий', perfect: 'Доконаний вид',
  },
  sv: {
    masculine: 'Maskulinum (en)', feminine: 'Femininum (en)', neuter: 'Neutrum (ett)',
    cases: { nom: 'Nominativ', akk: 'Ackusativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Presens (jag)', past: 'Preteritum', perfect: 'Perfekt',
  },
  da: {
    masculine: 'Hankøn (en)', feminine: 'Hunkøn (en)', neuter: 'Intetkøn (et)',
    cases: { nom: 'Nominativ', akk: 'Akkusativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Nutid (jeg)', past: 'Datid', perfect: 'Førnutid',
  },
  no: {
    masculine: 'Hankjønn (en)', feminine: 'Hunkjønn (ei)', neuter: 'Intetkjønn (et)',
    cases: { nom: 'Nominativ', akk: 'Akkusativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Presens (jeg)', past: 'Preteritum', perfect: 'Perfektum',
  },
  fi: {
    masculine: 'Maskuliini', feminine: 'Feminiini', neuter: 'Neutri',
    cases: { nom: 'Nominatiivi', akk: 'Akkusatiivi', dat: 'Datiivi', gen: 'Genetiivi' },
    infinitive: 'Infinitiivi', present: 'Preesens (minä)', past: 'Imperfekti', perfect: 'Perfekti',
  },
  cs: {
    masculine: 'Mužský (on)', feminine: 'Ženský (ona)', neuter: 'Střední (ono)',
    cases: { nom: 'Nominativ', akk: 'Akuzativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Přítomný čas (já)', past: 'Minulý čas', perfect: 'Předpřítomný čas',
  },
  el: {
    masculine: 'Αρσενικό (ο)', feminine: 'Θηλυκό (η)', neuter: 'Ουδέτερο (το)',
    cases: { nom: 'Ονομαστική', akk: 'Αιτιατική', dat: 'Δοτική', gen: 'Γενική' },
    infinitive: 'Απαρέμφατο', present: 'Ενεστώτας (εγώ)', past: 'Αόριστος', perfect: 'Παρακείμενος',
  },
  ro: {
    masculine: 'Masculin (un)', feminine: 'Feminin (o)', neuter: 'Neutru (un/o)',
    cases: { nom: 'Nominativ', akk: 'Acuzativ', dat: 'Dativ', gen: 'Genitiv' },
    infinitive: 'Infinitiv', present: 'Prezent (eu)', past: 'Imperfect', perfect: 'Perfect compus',
  },
  hu: {
    masculine: 'Hímnem', feminine: 'Nőnem', neuter: 'Semlegesnem',
    cases: { nom: 'Alanyeset', akk: 'Tárgyeset', dat: 'Részeseset', gen: 'Birtokos eset' },
    infinitive: 'Főnévi igenév', present: 'Jelen idő (én)', past: 'Múlt idő', perfect: 'Befejezett jelen',
  },
  vi: {
    masculine: 'Giống đực', feminine: 'Giống cái', neuter: 'Trung tính',
    cases: { nom: 'Chủ cách', akk: 'Đối cách', dat: 'Tặng cách', gen: 'Sở hữu cách' },
    infinitive: 'Nguyên mẫu', present: 'Hiện tại', past: 'Quá khứ', perfect: 'Hoàn thành',
  },
  th: {
    masculine: 'เพศชาย', feminine: 'เพศหญิง', neuter: 'กลาง',
    cases: { nom: 'ประธาน', akk: 'กรรม', dat: 'สัมปทาน', gen: 'เจ้าของ' },
    infinitive: 'รูปพื้นฐาน', present: 'ปัจจุบัน', past: 'อดีต', perfect: 'สมบูรณ์',
  },
  id: {
    masculine: 'Maskulin', feminine: 'Feminin', neuter: 'Netral',
    cases: { nom: 'Nominatif', akk: 'Akusatif', dat: 'Datif', gen: 'Genitif' },
    infinitive: 'Infinitif', present: 'Kini (saya)', past: 'Lampau', perfect: 'Sempurna',
  },
  hi: {
    masculine: 'पुल्लिंग', feminine: 'स्त्रीलिंग', neuter: 'नपुंसकलिंग',
    cases: { nom: 'कर्ता', akk: 'कर्म', dat: 'संप्रदान', gen: 'संबंध' },
    infinitive: 'मूल रूप', present: 'वर्तमान (मैं)', past: 'भूतकाल', perfect: 'पूर्ण भूत',
  },
  bn: {
    masculine: 'পুংলিঙ্গ', feminine: 'স্ত্রীলিঙ্গ', neuter: 'ক্লীবলিঙ্গ',
    cases: { nom: 'কর্তৃকারক', akk: 'কর্মকারক', dat: 'সম্প্রদান', gen: 'সম্বন্ধ' },
    infinitive: 'মূল রূপ', present: 'বর্তমান (আমি)', past: 'অতীত', perfect: 'পুরাঘটিত',
  },
  sk: {
    masculine: 'Mužský (on)', feminine: 'Ženský (ona)', neuter: 'Stredný (ono)',
    cases: { nom: 'Nominatív', akk: 'Akuzatív', dat: 'Datív', gen: 'Genitív' },
    infinitive: 'Infinitív', present: 'Prítomný čas (ja)', past: 'Minulý čas', perfect: 'Predprítomný čas',
  },
  bg: {
    masculine: 'Мъжки (той)', feminine: 'Женски (тя)', neuter: 'Среден (то)',
    cases: { nom: 'Именителен', akk: 'Винителен', dat: 'Дателен', gen: 'Родителен' },
    infinitive: 'Инфинитив', present: 'Сегашно време (аз)', past: 'Минало време', perfect: 'Перфект',
  },
  sr: {
    masculine: 'Мушки (он)', feminine: 'Женски (она)', neuter: 'Средњи (оно)',
    cases: { nom: 'Номинатив', akk: 'Акузатив', dat: 'Датив', gen: 'Генитив' },
    infinitive: 'Инфинитив', present: 'Презент (ја)', past: 'Претерит', perfect: 'Перфекат',
  },
  ca: {
    masculine: 'Masculí (el)', feminine: 'Femení (la)', neuter: 'Neutre',
    cases: { nom: 'Nominatiu', akk: 'Acusatiu', dat: 'Datiu', gen: 'Genitiu' },
    infinitive: 'Infinitiu', present: 'Present (jo)', past: 'Pretèrit', perfect: 'Perfet',
  },
  ka: {
    masculine: 'მამრობითი', feminine: 'მდედრობითი', neuter: 'საშუალო',
    cases: { nom: 'სახელობითი', akk: 'მოთხრობითი', dat: 'მიცემითი', gen: 'ნათესაობითი' },
    infinitive: 'მასდარი', present: 'აწმყო (მე)', past: 'წარსული', perfect: 'ნამყო სრული',
  },
  hy: {
    masculine: 'Արական', feminine: 'Իգական', neuter: 'Չեզոկ',
    cases: { nom: 'Ուղղական', akk: 'Հայցական', dat: 'Տրական', gen: 'Սեռական' },
    infinitive: 'Անորոշ դերբայ', present: 'Ներկա (ես)', past: 'Անցյալ', perfect: 'Վաղակատարյալ',
  },
  kk: {
    masculine: 'Ерлік', feminine: 'Аналық', neuter: 'Орта',
    cases: { nom: 'Атау', akk: 'Табыс', dat: 'Барыс', gen: 'Ілік' },
    infinitive: 'Тұйық рай', present: 'Осы шақ (мен)', past: 'Өткен шақ', perfect: 'Аяқталған',
  },
  uz: {
    masculine: 'Erkak', feminine: 'Ayol', neuter: 'Neytral',
    cases: { nom: 'Bosh kelishik', akk: 'Tushum kelishik', dat: 'Jo\'nalish kelishik', gen: 'Qaratqich kelishik' },
    infinitive: 'Harakat nomi', present: 'Hozirgi zamon (men)', past: 'O\'tgan zamon', perfect: 'Tugallangan',
  },
  lv: {
    masculine: 'Vīriešu dzimte', feminine: 'Sieviešu dzimte', neuter: 'Vidējā dzimte',
    cases: { nom: 'Nominatīvs', akk: 'Akuzatīvs', dat: 'Datīvs', gen: 'Ģenitīvs' },
    infinitive: 'Nenoteiksme', present: 'Tagadne (es)', past: 'Pagātne', perfect: 'Perfekts',
  },
  lt: {
    masculine: 'Vyriškoji giminė', feminine: 'Moteriškoji giminė', neuter: 'Bevardė giminė',
    cases: { nom: 'Vardininkas', akk: 'Galininkas', dat: 'Naudininkas', gen: 'Kilmininkas' },
    infinitive: 'Bendratis', present: 'Esamasis laikas (aš)', past: 'Būtasis laikas', perfect: 'Būtasis kartinis laikas',
  },
  et: {
    masculine: 'Meessugu', feminine: 'Naissugu', neuter: 'Kesksugu',
    cases: { nom: 'Nimetav', akk: 'Osastav', dat: 'Alaleütlev', gen: 'Omastav' },
    infinitive: 'Infinitiiv', present: 'Olevik (ma)', past: 'Lihtminevik', perfect: 'Täisminevik',
  },
};

export const getGrammar = (lang: string) => GRAMMAR_LABELS[lang] || GRAMMAR_LABELS.en;

// ---------------------------------------------------------------------------
// Noun definite articles (base singular), for flashcard display + TTS.
//
// German is decided by gender alone. The Romance languages also need the noun's
// SPELLING, because the article form depends on the initial sound:
//   - French/Italian elide to l' before a vowel sound (l'eau, l'acqua).
//   - Italian masculine uses lo before impure s, z, gn, ps, pn, x, y, i+vowel.
//   - Spanish feminine nouns with a STRESSED initial a-/ha- take el (el agua).
// The cases that aren't derivable from spelling (French aspirated h, Spanish
// unwritten stress) are handled with small, documented exception sets — not
// exhaustive, but they cover common vocabulary.
//
// Elision is signalled by a trailing apostrophe on the returned token (l'), so
// the caller attaches it without a separating space.
// ---------------------------------------------------------------------------

export const NOUN_ARTICLES: Record<string, Partial<Record<'m' | 'f' | 'n', string>>> = {
  de: { m: 'der', f: 'die', n: 'das' },
};

// Vowels (incl. accented forms) that count as vowel-initial for each language.
const FRENCH_VOWELS = 'aàâäeéèêëiîïoôöœæuùûü'; // no y — it's consonant-like here (le yaourt)
const ITALIAN_VOWELS = 'aàáeèéiìíoòóuùú';

// French nouns beginning with an ASPIRATED h ("h aspiré"): NO elision (le/la).
// Not derivable from spelling. Anything else starting with h is treated as a
// mute h and elides (l'homme, l'heure). Accented and bare spellings both listed.
const FRENCH_ASPIRATED_H = new Set([
  'hache', 'haie', 'haine', 'hall', 'halte', 'hamac', 'hameau', 'hamster', 'hanche',
  'handicap', 'hangar', 'hareng', 'haricot', 'harpe', 'hasard', 'hâte', 'hate',
  'hausse', 'haut', 'hauteur', 'havre', 'hérisson', 'herisson', 'héron', 'heron',
  'héros', 'heros', 'hêtre', 'hetre', 'hibou', 'hiérarchie', 'hierarchie', 'hockey',
  'homard', 'honte', 'hoquet', 'horde', 'hotte', 'houblon', 'houille', 'houle',
  'housse', 'hublot', 'huit', 'hurlement', 'hutte',
]);

// Spanish feminine nouns whose initial a-/ha- is STRESSED and so take "el" in the
// singular for euphony (el agua — the noun stays feminine). Written-accent forms
// (águila, área) are detected separately via the leading 'á'.
const SPANISH_EUPHONIC_EL = new Set([
  'agua', 'ala', 'alba', 'alga', 'alma', 'ama', 'ancla', 'ansia', 'arca', 'arma',
  'arpa', 'asa', 'ascua', 'asma', 'aspa', 'asta', 'aula', 'ave', 'haba', 'habla',
  'hacha', 'hada', 'hambre', 'hampa', 'haya',
]);

const normalizeNoun = (word?: string | null): string => (word || '').trim().toLowerCase();

const frenchArticle = (gender: 'm' | 'f' | 'n', word?: string | null): string | null => {
  if (gender === 'n') return null; // French has no neuter
  const base = gender === 'm' ? 'le' : 'la';
  const w = normalizeNoun(word);
  if (!w) return base;
  if (FRENCH_VOWELS.includes(w[0])) return "l'";
  if (w[0] === 'h' && !FRENCH_ASPIRATED_H.has(w)) return "l'"; // mute h elides
  return base;
};

const spanishArticle = (gender: 'm' | 'f' | 'n', word?: string | null): string | null => {
  if (gender === 'n') return null; // Spanish has no neuter
  if (gender === 'm') return 'el';
  const w = normalizeNoun(word);
  if (!w) return 'la';
  // Euphonic "el" for feminine nouns with a stressed initial a-/ha-.
  if (w[0] === 'á' || SPANISH_EUPHONIC_EL.has(w)) return 'el';
  return 'la'; // Spanish does not elide: la isla, la abeja
};

const italianArticle = (gender: 'm' | 'f' | 'n', word?: string | null): string | null => {
  if (gender === 'n') return null; // Italian has no neuter
  const w = normalizeNoun(word);
  if (!w) return gender === 'm' ? 'il' : 'la';
  const c0 = w[0];
  const c1 = w[1] || '';
  const isVowel = (c: string) => ITALIAN_VOWELS.includes(c);
  // Silent h appears only in loanwords (hotel, hobby), all h+vowel → elides.
  const vowelInitial = isVowel(c0) || c0 === 'h';
  if (gender === 'f') {
    if (vowelInitial) return c0 === 'i' && isVowel(c1) ? 'la' : "l'"; // la iena, but l'acqua
    return 'la';
  }
  // masculine
  if (vowelInitial) return c0 === 'i' && isVowel(c1) ? 'lo' : "l'"; // lo iato, but l'amico
  if (c0 === 'z' || c0 === 'x' || c0 === 'y') return 'lo';
  if (c0 === 's' && c1 && !isVowel(c1)) return 'lo'; // impure s: lo studente
  if (w.startsWith('gn') || w.startsWith('ps') || w.startsWith('pn') || w.startsWith('pt')) return 'lo';
  return 'il';
};

/** Definite article for a noun, given its language, gender and (for the Romance
 *  languages) the noun itself. Returns null when no article applies — unsupported
 *  language, missing gender, or a gender the language lacks. A trailing apostrophe
 *  (l') signals elision: the caller should attach it without a space. */
export const getNounArticle = (
  language: string,
  gender: 'm' | 'f' | 'n' | null | undefined,
  word?: string | null,
): string | null => {
  if (!gender) return null;
  switch (language) {
    case 'de': return NOUN_ARTICLES.de[gender] ?? null;
    case 'fr': return frenchArticle(gender, word);
    case 'es': return spanishArticle(gender, word);
    case 'it': return italianArticle(gender, word);
    default: return null;
  }
};
