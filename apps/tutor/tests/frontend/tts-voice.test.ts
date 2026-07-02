import { describe, it, expect } from 'vitest';
import { resolveTtsVoice, LANGUAGES } from '../../server-utils';

describe('resolveTtsVoice', () => {
  it('should return google provider and default voice for German with no overrides', () => {
    const result = resolveTtsVoice('de', {});
    expect(result.provider).toBe('google');
    expect(result.voice).toBe('de-DE-Neural2-C');
  });

  it('should return azure provider for languages with defaultTtsProvider=azure', () => {
    const result = resolveTtsVoice('ka', {});
    expect(result.provider).toBe('azure');
    expect(result.voice).toBe('ka-GE-GiorgiNeural');
  });

  it('should respect global tts_provider=azure setting', () => {
    const result = resolveTtsVoice('de', { tts_provider: 'azure' });
    expect(result.provider).toBe('azure');
    expect(result.voice).toBe('de-DE-KatjaNeural');
  });

  it('should use per-language override from tts_voices (object format)', () => {
    const settings = {
      tts_voices: JSON.stringify({
        de: { provider: 'azure', voice: 'de-DE-CustomVoice' }
      })
    };
    const result = resolveTtsVoice('de', settings);
    expect(result.provider).toBe('azure');
    expect(result.voice).toBe('de-DE-CustomVoice');
  });

  it('should handle backward-compat string override (google voice)', () => {
    const settings = {
      tts_voices: JSON.stringify({
        de: 'de-DE-Wavenet-B'
      })
    };
    const result = resolveTtsVoice('de', settings);
    expect(result.provider).toBe('google');
    expect(result.voice).toBe('de-DE-Wavenet-B');
  });

  it('should fall back to German config for unknown language', () => {
    const result = resolveTtsVoice('xyz', {});
    expect(result.provider).toBe('google');
    expect(result.voice).toBe('de-DE-Neural2-C');
  });

  it('should ignore invalid JSON in tts_voices', () => {
    const result = resolveTtsVoice('de', { tts_voices: 'not-json' });
    expect(result.provider).toBe('google');
    expect(result.voice).toBe('de-DE-Neural2-C');
  });

  it('should use google for languages without defaultTtsProvider when global is google', () => {
    const result = resolveTtsVoice('en', { tts_provider: 'google' });
    expect(result.provider).toBe('google');
    expect(result.voice).toBe('en-GB-Neural2-C');
  });

  it('should return azure for Armenian (defaultTtsProvider=azure)', () => {
    const result = resolveTtsVoice('hy', {});
    expect(result.provider).toBe('azure');
    expect(result.voice).toBe('hy-AM-HaykNeural');
  });
});

describe('LANGUAGES config', () => {
  it('should have config for common languages', () => {
    expect(LANGUAGES.de).toBeDefined();
    expect(LANGUAGES.en).toBeDefined();
    expect(LANGUAGES.fr).toBeDefined();
    expect(LANGUAGES.he).toBeDefined();
  });

  it('each language should have ttsLang, ttsVoice, and ttsAzureVoice', () => {
    for (const [code, config] of Object.entries(LANGUAGES)) {
      expect(config.ttsLang, `${code} missing ttsLang`).toBeTruthy();
      expect(config.ttsVoice, `${code} missing ttsVoice`).toBeTruthy();
      expect(config.ttsAzureVoice, `${code} missing ttsAzureVoice`).toBeTruthy();
    }
  });
});
