#!/usr/bin/env tsx
/**
 * AI-generate per-unit vocabulary for each losreden50 lesson. The import
 * script aggregates German/Russian tables from Раздел 1 into a stub
 * `## Часть: Словарь юнита` section, but the stub catches only 2–5 items
 * for most units and nothing for PRACTICE units. This script sends the
 * full unit body (grammar, key-phrase tables, written exercises with
 * answer keys) plus the three audio-text bodies to Claude Haiku and
 * replaces the stub section in place with a 15–25 item table.
 *
 * Re-runnable: the section is replaced, not appended.
 * ANTHROPIC_API_KEY from .env.local.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const COURSES_DIR = path.resolve(__dirname, '..', '..', 'courses', 'losreden50', 'de', 'ru');
const LESSONS_DIR = path.join(COURSES_DIR, 'lessons');
const TEXTS_DIR = path.join(COURSES_DIR, 'texts');

const SYSTEM_PROMPT = `You extract per-unit vocabulary for a German fluency course for Russian speakers.

You receive the full body of one unit (grammar explanations, key-phrase tables, written exercises with German answer keys) plus the three audio-text bodies that accompany it. Pull out 15–25 of the most useful German vocabulary items the unit introduces or drills — nouns (with their article: der/die/das), verbs (in dictionary infinitive form), and frequent phrases. Skip proper nouns (personal names, city/country names), bare function words (articles, pronouns, prepositions on their own), and items the learner already knows from much earlier units (greetings like "hallo", numbers 1–10, etc.).

For each item, provide a short Russian translation in dictionary form (one line, ≤6 words).

Return STRICT JSON: { items: [{ german: string, russian: string }, ...] }`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          german: { type: 'string' },
          russian: { type: 'string' },
        },
        required: ['german', 'russian'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

interface ModelResponse {
  items: { german: string; russian: string }[];
}

// Lookahead anchor: end of the vocab section is the "---" divider preceding
// the "Следующий шаг" trailer, or end of file if it's missing.
const VOCAB_END = String.raw`(?=\n---\n\n>\s*\*\*Следующий шаг|$)`;
const VOCAB_SECTION_RE = new RegExp(
  String.raw`\n## Часть:\s*Словарь юнита[\s\S]*?${VOCAB_END}`,
);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function readAudioText(file: string): string {
  if (!existsSync(file)) return '';
  const raw = readFileSync(file, 'utf8');
  // Pull just the numbered sentences list under "## Текст для аудирования".
  const lines = raw.split('\n');
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^##\s+Текст\s+для\s+аудирования/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(line)) break;
    if (inSection) out.push(line);
  }
  return out.join('\n').trim();
}

function stripExistingVocab(md: string): string {
  // Remove the stub "## Часть: Словарь юнита" section so the model doesn't
  // feed on its own prior output. The lesson body still contains the
  // original Раздел 1 tables the stub was derived from.
  return md.replace(VOCAB_SECTION_RE, '\n').trim();
}

async function generateVocab(
  client: Anthropic,
  unitN: number,
  unitTitle: string,
  lessonBody: string,
  audioTexts: string[],
): Promise<{ german: string; russian: string }[]> {
  const userMsg = `Unit ${unitN}: ${unitTitle}

=== Unit material ===
${lessonBody}

=== Audio text A ===
${audioTexts[0] ?? ''}

=== Audio text B ===
${audioTexts[1] ?? ''}

=== Audio text C ===
${audioTexts[2] ?? ''}`;
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    messages: [{ role: 'user', content: userMsg }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return [];
  try {
    const parsed = JSON.parse(textBlock.text) as ModelResponse;
    return parsed.items.filter((it) => it.german && it.russian);
  } catch (err) {
    console.log(`(parse error: ${(err as Error).message.slice(0, 80)})`);
    return [];
  }
}

function renderSection(entries: { german: string; russian: string }[]): string {
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

function replaceVocabSection(md: string, section: string): string {
  if (VOCAB_SECTION_RE.test(md)) {
    // Preserve a leading newline so the replacement keeps the blank line
    // before the section.
    return md.replace(VOCAB_SECTION_RE, '\n\n' + section);
  }
  // No existing section: insert before the "Следующий шаг" divider, else append.
  const nextStepIdx = md.search(/\n---\n\n>\s*\*\*Следующий шаг/);
  if (nextStepIdx >= 0) {
    return md.slice(0, nextStepIdx) + '\n\n' + section + md.slice(nextStepIdx);
  }
  return md.trimEnd() + '\n\n' + section + '\n';
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  const client = new Anthropic();

  let enriched = 0;
  let failed = 0;
  for (let n = 1; n <= 50; n++) {
    const file = path.join(LESSONS_DIR, `lesson_${pad2(n)}.md`);
    const md = readFileSync(file, 'utf8');
    const titleMatch = md.match(/^#\s+(.+?)\s*$/m);
    const title = titleMatch ? titleMatch[1]! : `Юнит ${n}`;
    const lessonBody = stripExistingVocab(md);
    const audioTexts = ['a', 'b', 'c'].map((v) =>
      readAudioText(path.join(TEXTS_DIR, `text_${pad2(n)}_${v}.md`)),
    );
    process.stdout.write(`  L${pad2(n)} ${title.slice(0, 50)} … `);
    let items: { german: string; russian: string }[];
    try {
      items = await generateVocab(client, n, title, lessonBody, audioTexts);
    } catch (err) {
      console.log(`(error: ${(err as Error).message.slice(0, 80)})`);
      failed++;
      continue;
    }
    if (items.length === 0) {
      console.log('(no items)');
      failed++;
      continue;
    }
    const updated = replaceVocabSection(md, renderSection(items));
    writeFileSync(file, updated);
    enriched++;
    console.log(`✓ ${items.length} items`);
  }
  console.log(`\nDone. enriched=${enriched}, failed=${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
