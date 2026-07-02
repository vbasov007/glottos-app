'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, getStoredSessionId } from '../lib/api-client';
import type { TargetLang } from '../lib/content-types';
import type { ProviderInfo, TtsProviderId, VoiceOption } from '../lib/tts-providers';

interface Overrides {
  [target: string]: { provider: TtsProviderId; voice: string } | undefined;
}

interface SettingsResponse {
  overrides: Overrides;
  defaults: Record<TargetLang, { provider: TtsProviderId; voice: string }>;
  providers: Record<TtsProviderId, ProviderInfo>;
}

const TARGETS: { code: TargetLang; label: string; flag: string }[] = [
  { code: 'de', label: 'German',   flag: '🇩🇪' },
  { code: 'fr', label: 'French',   flag: '🇫🇷' },
  { code: 'es', label: 'Spanish',  flag: '🇪🇸' },
  { code: 'sr', label: 'Serbian',  flag: '🇷🇸' },
  { code: 'ka', label: 'Georgian', flag: '🇬🇪' },
  { code: 'he', label: 'Hebrew',   flag: '🇮🇱' },
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'it', label: 'Italian',  flag: '🇮🇹' },
];

export function AdminTtsSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Overrides>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<SettingsResponse>('/api/admin/tts-settings');
      if (res.ok && res.data) {
        setData(res.data);
        setDraft(res.data.overrides ?? {});
      } else {
        setError(`Could not load settings (${res.status})`);
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onChange = (target: TargetLang, provider: TtsProviderId, voice: string) => {
    setDraft((d) => ({ ...d, [target]: { provider, voice } }));
  };

  const onClear = (target: TargetLang) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[target];
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; overrides: Overrides }>(
        '/api/admin/tts-settings',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ overrides: draft }),
        },
      );
      if (res.ok && res.data) {
        setDraft(res.data.overrides ?? {});
        if (data) setData({ ...data, overrides: res.data.overrides ?? {} });
        setSavedAt(Date.now());
      } else {
        setError(`Save failed (${res.status})`);
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = useMemo(() => {
    if (!data) return false;
    return JSON.stringify(draft) !== JSON.stringify(data.overrides ?? {});
  }, [draft, data]);

  if (!data) {
    return (
      <div className="mt-8 text-sm text-zinc-500">
        {error ? `Error: ${error}` : 'Loading TTS settings…'}
      </div>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">Text-to-speech</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Pick a provider and voice for each target language. Leave a row on
        "Default" to use the hard-coded fallback. The Test button plays a
        sample phrase with the currently-selected voice without saving.
      </p>

      <div className="mt-4 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/60">
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Voice</th>
              <th className="px-3 py-2">Test</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {TARGETS.map((t) => (
              <Row
                key={t.code}
                target={t}
                providers={data.providers}
                value={draft[t.code]}
                defaultValue={data.defaults[t.code]}
                onChange={(p, v) => onChange(t.code, p, v)}
                onClear={() => onClear(t.code)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className={
            'px-4 py-2 rounded-md text-sm font-medium transition-colors ' +
            (dirty && !saving
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed')
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && !saving && <span className="text-xs text-zinc-500">Unsaved changes</span>}
        {!dirty && savedAt && (
          <span className="text-xs text-green-600 dark:text-green-400">Saved.</span>
        )}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </section>
  );
}

function Row({
  target,
  providers,
  value,
  defaultValue,
  onChange,
  onClear,
}: {
  target: { code: TargetLang; label: string; flag: string };
  providers: Record<TtsProviderId, ProviderInfo>;
  value: { provider: TtsProviderId; voice: string } | undefined;
  defaultValue: { provider: TtsProviderId; voice: string } | undefined;
  onChange: (provider: TtsProviderId, voice: string) => void;
  onClear: () => void;
}) {
  // Effective selection = override if set, else default.
  const effective = value ?? defaultValue;
  const effectiveProvider = effective?.provider;
  const effectiveVoice = effective?.voice;

  const availableProviders = (Object.keys(providers) as TtsProviderId[]).filter(
    (id) => (providers[id].voices[target.code] ?? []).length > 0,
  );
  const voices: VoiceOption[] = effectiveProvider
    ? providers[effectiveProvider]?.voices[target.code] ?? []
    : [];

  const onProviderChange = (next: TtsProviderId) => {
    const firstVoice = providers[next].voices[target.code]?.[0]?.id;
    if (firstVoice) onChange(next, firstVoice);
  };

  return (
    <tr>
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        <span className="mr-2">{target.flag}</span>
        <span className="font-medium">{target.label}</span>
        <span className="ml-2 text-xs font-mono text-zinc-400">{target.code}</span>
      </td>
      <td className="px-3 py-2 align-middle">
        {availableProviders.length === 0 ? (
          <span className="text-xs text-zinc-500">— no provider —</span>
        ) : (
          <select
            value={effectiveProvider ?? ''}
            onChange={(e) => onProviderChange(e.target.value as TtsProviderId)}
            className="text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
          >
            {availableProviders.map((id) => (
              <option key={id} value={id}>
                {providers[id].label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        {voices.length === 0 ? (
          <span className="text-xs text-zinc-500">— no voice —</span>
        ) : (
          <select
            value={effectiveVoice ?? ''}
            onChange={(e) =>
              effectiveProvider && onChange(effectiveProvider, e.target.value)
            }
            className="text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 min-w-[14rem]"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} ({v.gender})
              </option>
            ))}
          </select>
        )}
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="ml-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            title="Reset to default"
          >
            reset
          </button>
        )}
      </td>
      <td className="px-3 py-2 align-middle whitespace-nowrap">
        {effectiveProvider && effectiveVoice ? (
          <TestButton
            target={target.code}
            provider={effectiveProvider}
            voice={effectiveVoice}
          />
        ) : (
          <span className="text-xs text-zinc-500">—</span>
        )}
      </td>
    </tr>
  );
}

function TestButton({
  target,
  provider,
  voice,
}: {
  target: TargetLang;
  provider: TtsProviderId;
  voice: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = async () => {
    setError(null);
    setPlaying(true);
    try {
      const sid = getStoredSessionId();
      const qs = new URLSearchParams({ target, provider, voice }).toString();
      const res = await fetch(`/api/admin/tts-test?${qs}`, {
        headers: sid ? { 'X-Session-Id': sid } : undefined,
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
      };
      audio.onerror = () => {
        setError('playback error');
        setPlaying(false);
      };
      await audio.play();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setPlaying(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={play}
        disabled={playing}
        className={
          'px-2 py-1 rounded text-xs font-medium transition-colors ' +
          (playing
            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
            : 'border border-zinc-300 dark:border-zinc-700 hover:border-blue-400 hover:text-blue-700 dark:hover:text-blue-300')
        }
      >
        {playing ? '▶ playing…' : '▶ Test'}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
