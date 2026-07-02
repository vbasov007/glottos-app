import { describe, it, expect } from 'vitest';
import {
  ACOUSTIC_PRESETS,
  NOISE_PRESETS,
  NOISE_LEVELS,
  nextAcousticPreset,
  nextNoisePreset,
  nextNoiseLevel,
} from '../../src/types';

describe('nextAcousticPreset', () => {
  it('cycles through every preset in order and wraps', () => {
    let cur = ACOUSTIC_PRESETS[0]; // 'none'
    const visited: string[] = [cur];
    for (let i = 0; i < ACOUSTIC_PRESETS.length; i++) {
      cur = nextAcousticPreset(cur);
      visited.push(cur);
    }
    expect(visited[ACOUSTIC_PRESETS.length]).toBe(ACOUSTIC_PRESETS[0]);
    expect(new Set(visited).size).toBe(ACOUSTIC_PRESETS.length);
  });

  it('returns the canonical order: none → far → phone → cb_radio → none', () => {
    expect(nextAcousticPreset('none')).toBe('far');
    expect(nextAcousticPreset('far')).toBe('phone');
    expect(nextAcousticPreset('phone')).toBe('cb_radio');
    expect(nextAcousticPreset('cb_radio')).toBe('none');
  });
});

describe('nextNoisePreset', () => {
  it('cycles through every preset in order and wraps', () => {
    let cur = NOISE_PRESETS[0]; // 'none'
    const visited: string[] = [cur];
    for (let i = 0; i < NOISE_PRESETS.length; i++) {
      cur = nextNoisePreset(cur);
      visited.push(cur);
    }
    expect(visited[NOISE_PRESETS.length]).toBe(NOISE_PRESETS[0]);
    expect(new Set(visited).size).toBe(NOISE_PRESETS.length);
  });

  it('returns the canonical order: none → street → crowd → none', () => {
    expect(nextNoisePreset('none')).toBe('street');
    expect(nextNoisePreset('street')).toBe('crowd');
    expect(nextNoisePreset('crowd')).toBe('none');
  });
});

describe('nextNoiseLevel', () => {
  it('cycles through every level in order and wraps', () => {
    let cur = NOISE_LEVELS[0]; // 'ambient'
    const visited: string[] = [cur];
    for (let i = 0; i < NOISE_LEVELS.length; i++) {
      cur = nextNoiseLevel(cur);
      visited.push(cur);
    }
    expect(visited[NOISE_LEVELS.length]).toBe(NOISE_LEVELS[0]);
    expect(new Set(visited).size).toBe(NOISE_LEVELS.length);
  });

  it('returns the canonical order: ambient → moderate → disturbing → ambient', () => {
    expect(nextNoiseLevel('ambient')).toBe('moderate');
    expect(nextNoiseLevel('moderate')).toBe('disturbing');
    expect(nextNoiseLevel('disturbing')).toBe('ambient');
  });
});
