import Anthropic from '@anthropic-ai/sdk';

// Singleton client. Reads ANTHROPIC_API_KEY from env.
let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  _client = new Anthropic();
  return _client;
}

// Model alias for cost-sensitive answer judging. Per skill docs current Haiku.
export const ANSWER_JUDGE_MODEL = 'claude-haiku-4-5';

// Sonnet for exercise generation: better German fluency than Haiku, ~5x cheaper
// than Opus. Adaptive thinking enabled per the skill's defaults.
export const EXERCISE_GEN_MODEL = 'claude-sonnet-4-6';
