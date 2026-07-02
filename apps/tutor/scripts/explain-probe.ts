/**
 * explain-probe — send the real `/api/explain` prompt to Gemini for one phrase
 * and print the structured result, without needing the Express server or the DB.
 *
 * It builds the prompt with the same `buildPrompt()` the server uses and
 * assembles `contents` exactly like `explainPhraseCore()` in server.ts, so it
 * faithfully reproduces what production sends. Handy for checking whether the
 * model fills a given field (e.g. `antonyms`) for a word, and for confirming a
 * prompt change has the intended effect before deploying.
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/explain-probe.ts <phrase> [textLang] [explLang] [--full]
 *
 * Examples:
 *   npx tsx scripts/explain-probe.ts warm              # de word, ru glosses (defaults)
 *   npx tsx scripts/explain-probe.ts groß de en        # de word, en glosses
 *   npx tsx scripts/explain-probe.ts warm de ru --full # print the whole result JSON
 *
 * Env: GEMINI_API_KEY (required). PROBE_MODEL overrides the model
 * (default gemini-2.5-flash-lite, matching the server default).
 */
import { GoogleGenAI } from '@google/genai';
import { buildPrompt, getTextLimit } from '../server-utils';

const args = process.argv.slice(2);
const full = args.includes('--full');
const [phrase, textLanguage = 'de', explanationLanguage = 'ru'] = args.filter((a) => a !== '--full');

if (!phrase) {
  console.error('Usage: GEMINI_API_KEY=... npx tsx scripts/explain-probe.ts <phrase> [textLang] [explLang] [--full]');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in the environment.');
  process.exit(1);
}

const model = process.env.PROBE_MODEL || 'gemini-2.5-flash-lite';

// Assemble `contents` exactly like explainPhraseCore() — phrase as both the
// selection and (for an isolated probe) the full text/cursor context.
const prompt = buildPrompt(textLanguage, explanationLanguage);
const text = phrase;
const limitedText = text.slice(0, getTextLimit(textLanguage));
const phraseIdx = text.indexOf(phrase);
const cursorContext = text.substring(
  Math.max(0, phraseIdx - 20),
  Math.min(text.length, phraseIdx + phrase.length + 20),
);
const contents = prompt
  .replace('{{selected_text}}', phrase)
  .replace('{{full_text}}', limitedText)
  .replace('{{cursor_context}}', cursorContext);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await ai.models.generateContent({
  model,
  contents,
  config: { responseMimeType: 'application/json' },
});

const result = JSON.parse(response.text || '{}');

console.log(`phrase="${phrase}" textLang=${textLanguage} explLang=${explanationLanguage} model=${model}`);
console.log(`input_type=${result.input_type} part_of_speech=${result.part_of_speech ?? 'null'}`);
console.log('near_synonyms:', JSON.stringify(result.near_synonyms ?? null));
console.log('antonyms:', JSON.stringify(result.antonyms ?? null));
if (full) {
  console.log('\n--- full result ---');
  console.log(JSON.stringify(result, null, 2));
}
