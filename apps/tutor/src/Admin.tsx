import { useState, useEffect, useCallback } from 'react';
import { Trash2, ArrowLeft, ShieldAlert, Loader2, Download, MessageSquare, Settings, Volume2, Gauge, Crown, Languages, Search, BarChart3, RotateCcw, Play, Share2, ChevronDown, ChevronRight, ExternalLink, Copy, KeyRound } from 'lucide-react';
import { LANGUAGES } from './i18n';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
  workspace_count: number;
  subscription_status: string;
  llm_calls: number;
  tts_calls: number;
}

interface FeedbackRow {
  id: number;
  email: string;
  name: string | null;
  detail: string;
  created_at: string;
}

interface SharedLesson {
  id: string;
  workspace_name: string | null;
  text_language: string;
  share_source: string | null;
  created_at: string;
}

interface SharedLessonFull {
  id: string;
  workspace_name: string | null;
  text_language: string;
  explanation_language: string | null;
  share_source: string | null;
  created_at: string;
  creator_name: string | null;
  creator_email: string;
}

interface PromoSource {
  id: number;
  code: string;
  name: string;
  description: string | null;
  user_count: number;
  created_at: string;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userPeriod, setUserPeriod] = useState<'' | 'day' | 'week' | 'month'>('');
  const [hasSearched, setHasSearched] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [expandedSharesUserId, setExpandedSharesUserId] = useState<string | null>(null);
  const [userShares, setUserShares] = useState<SharedLesson[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [allShares, setAllShares] = useState<SharedLessonFull[]>([]);
  const [llmModel, setLlmModel] = useState('gemini-2.5-flash');
  const [llmFallbackModel, setLlmFallbackModel] = useState('gemini-2.5-flash-lite');
  const [thinkingBudget, setThinkingBudget] = useState('-1');
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'deepseek'>('gemini');
  const [deepseekEndpoint, setDeepseekEndpoint] = useState('https://api.deepseek.com/v1');
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [ttsProvider, setTtsProvider] = useState<'google' | 'yandex' | 'azure'>('google');
  const [yandexTtsApiKey, setYandexTtsApiKey] = useState('');
  const [azureTtsKey, setAzureTtsKey] = useState('');
  const [azureTtsRegion, setAzureTtsRegion] = useState('westeurope');
  const [russianStressModel, setRussianStressModel] = useState('gemini-2.5-flash');
  const [savingSettings, setSavingSettings] = useState(false);
  const [freeDailyExplains, setFreeDailyExplains] = useState('5');
  const [freeDailyTts, setFreeDailyTts] = useState('5');
  const [freeDailyGenerates, setFreeDailyGenerates] = useState('2');
  const [freeMaxGenerateSentences, setFreeMaxGenerateSentences] = useState('10');
  const [freeMaxTextLength, setFreeMaxTextLength] = useState('800');
  const [freeWeeklyWavText, setFreeWeeklyWavText] = useState('1');
  const [freeWeeklyWavFlashcards, setFreeWeeklyWavFlashcards] = useState('1');
  const [savingQuotas, setSavingQuotas] = useState(false);
  const [anonDailyExplains, setAnonDailyExplains] = useState('3');
  const [anonDailyTts, setAnonDailyTts] = useState('3');
  const [anonDailyGenerates, setAnonDailyGenerates] = useState('1');
  const [anonMaxTextLength, setAnonMaxTextLength] = useState('400');
  const [anonMaxGenerateSentences, setAnonMaxGenerateSentences] = useState('5');
  const [anonSessionTtlDays, setAnonSessionTtlDays] = useState('7');
  const [anonMaxWorkspaces, setAnonMaxWorkspaces] = useState('1');
  const [savingAnonQuotas, setSavingAnonQuotas] = useState(false);
  const [freeTrialDays, setFreeTrialDays] = useState('0');
  const [freeLimitsEnabled, setFreeLimitsEnabled] = useState(true);
  const [anonLimitsEnabled, setAnonLimitsEnabled] = useState(true);
  const [disabledTextLanguages, setDisabledTextLanguages] = useState<Set<string>>(new Set());
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, { provider: 'google' | 'azure'; voice: string }>>({});
  const [voiceTestStatus, setVoiceTestStatus] = useState<Record<string, 'testing' | 'ok' | 'error'>>({});
  const [voiceTestError, setVoiceTestError] = useState<Record<string, string>>({});
  const [savingLanguages, setSavingLanguages] = useState(false);
  const [promoSources, setPromoSources] = useState<PromoSource[]>([]);
  const [newPromoName, setNewPromoName] = useState('');
  const [newPromoDesc, setNewPromoDesc] = useState('');
  const [creatingPromo, setCreatingPromo] = useState(false);
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [lastCreatedKey, setLastCreatedKey] = useState<string | null>(null);

  const sessionId = localStorage.getItem('session_id');

  const searchUsers = useCallback(async (q: string, period: string) => {
    if (!sessionId) {
      setError('Not authenticated');
      return;
    }
    setLoading(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (period) params.set('period', period);
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { 'X-Session-Id': sessionId },
      });
      if (res.status === 401) { setError('Not authenticated'); return; }
      if (res.status === 403) { setError('Access denied'); return; }
      if (!res.ok) { setError('Failed to load users'); return; }
      const data = await res.json();
      setUsers(data.users);
      setError(null);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchFeedback = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/admin/feedback', {
        headers: { 'X-Session-Id': sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        setFeedback(data.feedback);
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  const fetchSettings = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { 'X-Session-Id': sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings.llm_model) setLlmModel(data.settings.llm_model);
        if (data.settings.llm_fallback_model) setLlmFallbackModel(data.settings.llm_fallback_model);
        if (data.settings.thinking_budget) setThinkingBudget(data.settings.thinking_budget);
        if (data.settings.llm_provider) setLlmProvider(data.settings.llm_provider);
        if (data.settings.deepseek_endpoint) setDeepseekEndpoint(data.settings.deepseek_endpoint);
        if (data.settings.deepseek_api_key) setDeepseekApiKey(data.settings.deepseek_api_key);
        if (data.settings.tts_provider) setTtsProvider(data.settings.tts_provider);
        if (data.settings.yandex_tts_api_key) setYandexTtsApiKey(data.settings.yandex_tts_api_key);
        if (data.settings.free_daily_explains) setFreeDailyExplains(data.settings.free_daily_explains);
        if (data.settings.free_daily_tts) setFreeDailyTts(data.settings.free_daily_tts);
        if (data.settings.free_daily_generates) setFreeDailyGenerates(data.settings.free_daily_generates);
        if (data.settings.free_max_generate_sentences) setFreeMaxGenerateSentences(data.settings.free_max_generate_sentences);
        if (data.settings.free_max_text_length) setFreeMaxTextLength(data.settings.free_max_text_length);
        if (data.settings.free_weekly_wav_text) setFreeWeeklyWavText(data.settings.free_weekly_wav_text);
        if (data.settings.free_weekly_wav_flashcards) setFreeWeeklyWavFlashcards(data.settings.free_weekly_wav_flashcards);
        if (data.settings.disabled_text_languages != null) {
          const codes = data.settings.disabled_text_languages.split(',').map((s: string) => s.trim()).filter(Boolean);
          setDisabledTextLanguages(new Set(codes));
        }
        if (data.settings.free_trial_days) setFreeTrialDays(data.settings.free_trial_days);
        if (data.settings.free_limits_enabled != null) setFreeLimitsEnabled(data.settings.free_limits_enabled !== 'false');
        if (data.settings.anon_limits_enabled != null) setAnonLimitsEnabled(data.settings.anon_limits_enabled !== 'false');
        if (data.settings.anon_daily_explains) setAnonDailyExplains(data.settings.anon_daily_explains);
        if (data.settings.anon_daily_tts) setAnonDailyTts(data.settings.anon_daily_tts);
        if (data.settings.anon_daily_generates) setAnonDailyGenerates(data.settings.anon_daily_generates);
        if (data.settings.anon_max_text_length) setAnonMaxTextLength(data.settings.anon_max_text_length);
        if (data.settings.anon_max_generate_sentences) setAnonMaxGenerateSentences(data.settings.anon_max_generate_sentences);
        if (data.settings.anon_session_ttl_days) setAnonSessionTtlDays(data.settings.anon_session_ttl_days);
        if (data.settings.anon_max_workspaces) setAnonMaxWorkspaces(data.settings.anon_max_workspaces);
        if (data.settings.azure_tts_key != null) setAzureTtsKey(data.settings.azure_tts_key);
        if (data.settings.azure_tts_region) setAzureTtsRegion(data.settings.azure_tts_region);
        if (data.settings.russian_stress_model) setRussianStressModel(data.settings.russian_stress_model);
        if (data.settings.tts_voices) {
          try {
            const parsed = JSON.parse(data.settings.tts_voices);
            // Normalize: string values (backward compat) → { provider: 'google', voice }
            const normalized: Record<string, { provider: 'google' | 'azure'; voice: string }> = {};
            for (const [code, val] of Object.entries(parsed) as [string, any][]) {
              if (typeof val === 'string') normalized[code] = { provider: 'google', voice: val };
              else if (val && typeof val === 'object' && val.provider && val.voice) normalized[code] = { provider: val.provider, voice: val.voice };
            }
            setVoiceOverrides(normalized);
          } catch { /* ignore bad JSON */ }
        }
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  const fetchPromoSources = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/admin/promo-sources', {
        headers: { 'X-Session-Id': sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        setPromoSources(data.sources);
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  const fetchApiKeys = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/admin/api-keys', { headers: { 'X-Session-Id': sessionId } });
      if (res.ok) setApiKeys(await res.json());
    } catch { /* ignore */ }
  }, [sessionId]);

  const fetchAllShares = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch('/api/admin/shares', { headers: { 'X-Session-Id': sessionId } });
      if (res.ok) {
        const data = await res.json();
        setAllShares(data.shares);
      }
    } catch { /* ignore */ }
  }, [sessionId]);

  const saveSetting = async (key: string, value: string) => {
    if (!sessionId) return;
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ key, value }),
    });
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await Promise.all([
        saveSetting('llm_model', llmModel),
        saveSetting('llm_fallback_model', llmFallbackModel),
        saveSetting('thinking_budget', thinkingBudget),
        saveSetting('llm_provider', llmProvider),
        saveSetting('deepseek_endpoint', deepseekEndpoint),
        saveSetting('deepseek_api_key', deepseekApiKey),
        saveSetting('tts_provider', ttsProvider),
        saveSetting('yandex_tts_api_key', yandexTtsApiKey),
        saveSetting('azure_tts_key', azureTtsKey),
        saveSetting('azure_tts_region', azureTtsRegion),
        saveSetting('russian_stress_model', russianStressModel),
      ]);
    } catch {
      alert('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Initial auth check — just verify access without loading all users
  useEffect(() => {
    if (!sessionId) { setError('Not authenticated'); setInitialLoading(false); return; }
    (async () => {
      try {
        const res = await fetch('/api/admin/users?q=__auth_check__', { headers: { 'X-Session-Id': sessionId } });
        if (res.status === 401) { setError('Not authenticated'); }
        else if (res.status === 403) { setError('Access denied'); }
      } catch { setError('Network error'); }
      finally { setInitialLoading(false); }
    })();
  }, [sessionId]);
  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchPromoSources(); }, [fetchPromoSources]);
  useEffect(() => { fetchApiKeys(); }, [fetchApiKeys]);
  useEffect(() => { fetchAllShares(); }, [fetchAllShares]);

  const toggleUserShares = async (userId: string) => {
    if (expandedSharesUserId === userId) {
      setExpandedSharesUserId(null);
      return;
    }
    setExpandedSharesUserId(userId);
    setSharesLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/shares`, { headers: { 'X-Session-Id': sessionId! } });
      if (res.ok) {
        const data = await res.json();
        setUserShares(data.shares || []);
      }
    } catch { /* ignore */ }
    setSharesLoading(false);
  };

  const deleteShare = async (shareId: string) => {
    if (!confirm(`Delete shared link "${shareId}"?`)) return;
    try {
      const res = await fetch(`/api/admin/shared/${shareId}`, { method: 'DELETE', headers: { 'X-Session-Id': sessionId! } });
      if (res.ok) {
        setUserShares(prev => prev.filter(s => s.id !== shareId));
        setAllShares(prev => prev.filter(s => s.id !== shareId));
      }
    } catch { alert('Network error'); }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Delete user "${user.name || user.email}"?\n\nThis will permanently remove all their data including workspaces and sessions.`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'X-Session-Id': sessionId! },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
        return;
      }
      setUsers(prev => prev.filter(u => u.id !== user.id));
    } catch {
      alert('Network error');
    } finally {
      setDeletingId(null);
    }
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold text-zinc-100">{error}</h1>
          <a href="/" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300">
            <ArrowLeft className="w-4 h-4" /> Back to app
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/admin/logs', {
                    headers: { 'X-Session-Id': sessionId! },
                  });
                  if (!res.ok) { alert('Failed to download logs'); return; }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'activity_logs.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { alert('Network error'); }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
            >
              <Download className="w-4 h-4" /> Download Logs (CSV)
            </button>
            <a href="/monitoring" className="inline-flex items-center gap-2 text-zinc-400 hover:text-zinc-200 text-sm">
              <BarChart3 className="w-4 h-4" /> Monitoring
            </a>
            <a href="/" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm">
              <ArrowLeft className="w-4 h-4" /> Back to app
            </a>
          </div>
        </div>

        {/* User search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <form
            className="flex-1 flex gap-2"
            onSubmit={(e) => { e.preventDefault(); searchUsers(userSearch, userPeriod); }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading || (!userSearch.trim() && !userPeriod)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </form>
          <div className="flex gap-1">
            {([['day', 'Last day'], ['week', 'Last week'], ['month', 'Last month']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => {
                  const next = userPeriod === val ? '' : val;
                  setUserPeriod(next);
                  if (next || userSearch.trim()) searchUsers(userSearch, next);
                  else { setUsers([]); setHasSearched(false); }
                }}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  userPeriod === val
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {hasSearched && (
          <>
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Email</th>
                    <th className="text-left px-4 py-3 font-medium">Role</th>
                    <th className="text-left px-4 py-3 font-medium">Created</th>
                    <th className="text-center px-4 py-3 font-medium">Workspaces</th>
                    <th className="text-right px-4 py-3 font-medium">LLM</th>
                    <th className="text-right px-4 py-3 font-medium">TTS</th>
                    <th className="text-center px-4 py-3 font-medium w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (<>
                    <tr key={user.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3">{user.name || '—'}</td>
                      <td className="px-4 py-3 text-zinc-400">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          user.role === 'admin' ? 'bg-amber-900/50 text-amber-300' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {user.role}
                        </span>
                        {(user.subscription_status === 'active' || user.subscription_status === 'trialing') && (
                          <span className="ml-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/50 text-emerald-300 inline-flex items-center gap-1">
                            <Crown className="w-3 h-3" /> Pro
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-center">{user.workspace_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-400">{user.llm_calls}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-400">{user.tts_calls}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={async () => {
                              const isPro = user.subscription_status === 'active' || user.subscription_status === 'trialing';
                              const newStatus = isPro ? 'free' : 'active';
                              if (!confirm(`${isPro ? 'Revoke Pro from' : 'Grant free Pro to'} "${user.name || user.email}"?`)) return;
                              try {
                                const res = await fetch(`/api/admin/users/${user.id}/subscription`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId! },
                                  body: JSON.stringify({ status: newStatus }),
                                });
                                if (res.ok) {
                                  setUsers(prev => prev.map(u => u.id === user.id ? { ...u, subscription_status: newStatus } : u));
                                }
                              } catch { alert('Network error'); }
                            }}
                            className={`p-1.5 rounded transition-colors ${
                              user.subscription_status === 'active' || user.subscription_status === 'trialing'
                                ? 'hover:bg-orange-900/30 text-emerald-400 hover:text-orange-400'
                                : 'hover:bg-emerald-900/30 text-zinc-500 hover:text-emerald-400'
                            }`}
                            title={user.subscription_status === 'active' || user.subscription_status === 'trialing' ? 'Revoke Pro' : 'Grant Pro'}
                          >
                            <Crown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleUserShares(user.id)}
                            className={`p-1.5 rounded transition-colors ${expandedSharesUserId === user.id ? 'bg-blue-900/30 text-blue-400' : 'hover:bg-blue-900/30 text-zinc-500 hover:text-blue-400'}`}
                            title="Shared links"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          {user.role !== 'admin' && (
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={deletingId === user.id}
                              className="p-1.5 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                              title="Delete user"
                            >
                              {deletingId === user.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedSharesUserId === user.id && (
                      <tr key={`${user.id}-shares`} className="border-b border-zinc-800/50 bg-zinc-900/50">
                        <td colSpan={8} className="px-6 py-3">
                          {sharesLoading ? (
                            <div className="flex items-center gap-2 text-zinc-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                          ) : userShares.length === 0 ? (
                            <div className="text-zinc-500 text-sm">No shared links</div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="text-xs font-medium text-zinc-400 mb-2">Shared links ({userShares.length})</div>
                              {userShares.map(share => (
                                <div key={share.id} className="flex items-center gap-3 text-sm">
                                  <a
                                    href={`/s/${share.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                  >
                                    /s/{share.id} <ExternalLink className="w-3 h-3" />
                                  </a>
                                  <span className="text-zinc-500">{share.workspace_name || '—'}</span>
                                  <span className="text-zinc-600 text-xs">{share.text_language}</span>
                                  {share.share_source && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/50 text-purple-300">{share.share_source}</span>
                                  )}
                                  <span className="text-zinc-600 text-xs">{new Date(share.created_at).toLocaleDateString()}</span>
                                  <button
                                    onClick={() => deleteShare(share.id)}
                                    className="p-1 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors ml-auto"
                                    title="Delete shared link"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center text-zinc-500 py-8">No users found</div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-zinc-600">
              <span>{users.length} user{users.length !== 1 ? 's' : ''} found</span>
              {users.length > 0 && (
                <button
                  onClick={() => downloadCsv('users.csv',
                    ['Name', 'Email', 'Role', 'Created', 'Workspaces', 'LLM Calls', 'TTS Calls'],
                    users.map(u => [u.name || '', u.email, u.role, new Date(u.created_at).toLocaleDateString(), String(u.workspace_count), String(u.llm_calls), String(u.tts_calls)])
                  )}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download CSV
                </button>
              )}
            </div>
          </>
        )}

        {/* LLM Settings */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold">LLM Settings</h2>
          </div>

          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Provider</label>
              <div className="flex gap-4">
                {(['gemini', 'deepseek'] as const).map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                    <input
                      type="radio"
                      name="llm_provider"
                      value={p}
                      checked={llmProvider === p}
                      onChange={() => setLlmProvider(p)}
                      className="accent-blue-500"
                    />
                    {p === 'gemini' ? 'Gemini' : 'DeepSeek'}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Model</label>
              {llmProvider === 'gemini' ? (
                <select
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full sm:w-64"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                </select>
              ) : (
                <select
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full sm:w-64"
                >
                  <option value="deepseek-chat">deepseek-chat</option>
                  <option value="deepseek-reasoner">deepseek-reasoner</option>
                </select>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Fallback model</label>
              <div className="flex flex-col gap-1 w-full sm:w-64">
                <input
                  type="text"
                  value={llmFallbackModel}
                  onChange={e => setLlmFallbackModel(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full"
                  placeholder="gemini-2.5-flash-lite"
                />
                <span className="text-xs text-zinc-500">Used when primary model returns 503 (overloaded)</span>
              </div>
            </div>

            {llmProvider === 'gemini' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <label className="text-sm text-zinc-400 w-36 shrink-0">Thinking budget</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={thinkingBudget}
                    onChange={e => setThinkingBudget(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-28"
                    min={-1}
                  />
                  <span className="text-xs text-zinc-500">-1 = auto, 0 = off, &gt;0 = token budget</span>
                </div>
              </div>
            )}

            {llmProvider === 'deepseek' && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="text-sm text-zinc-400 w-36 shrink-0">Endpoint</label>
                  <input
                    type="text"
                    value={deepseekEndpoint}
                    onChange={e => setDeepseekEndpoint(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full sm:w-96"
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="text-sm text-zinc-400 w-36 shrink-0">API Key</label>
                  <input
                    type="password"
                    value={deepseekApiKey}
                    onChange={e => setDeepseekApiKey(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full sm:w-96"
                    placeholder="sk-..."
                  />
                </div>
              </>
            )}

            <div className="pt-2">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* TTS Settings */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Volume2 className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-semibold">TTS Settings</h2>
          </div>

          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Provider</label>
              <div className="flex gap-4">
                {(['google', 'azure', 'yandex'] as const).map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                    <input
                      type="radio"
                      name="tts_provider"
                      value={p}
                      checked={ttsProvider === p}
                      onChange={() => setTtsProvider(p)}
                      className="accent-blue-500"
                    />
                    {p === 'google' ? 'Google Cloud' : p === 'azure' ? 'Microsoft Azure' : 'Yandex SpeechKit'}
                  </label>
                ))}
              </div>
            </div>

            {ttsProvider === 'yandex' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <label className="text-sm text-zinc-400 w-36 shrink-0">API Key</label>
                <div className="flex flex-col gap-1 w-full sm:w-96">
                  <input
                    type="password"
                    value={yandexTtsApiKey}
                    onChange={e => setYandexTtsApiKey(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full"
                    placeholder="AQVN..."
                  />
                  <span className="text-xs text-zinc-500">Leave empty to use YANDEX_TTS_API_KEY env variable</span>
                </div>
              </div>
            )}

            {ttsProvider === 'azure' && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="text-sm text-zinc-400 w-36 shrink-0">Subscription Key</label>
                  <div className="flex flex-col gap-1 w-full sm:w-96">
                    <input
                      type="password"
                      value={azureTtsKey}
                      onChange={e => setAzureTtsKey(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full"
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <span className="text-xs text-zinc-500">Leave empty to use AZURE_TTS_KEY env variable</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="text-sm text-zinc-400 w-36 shrink-0">Region</label>
                  <input
                    type="text"
                    value={azureTtsRegion}
                    onChange={e => setAzureTtsRegion(e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full sm:w-96"
                    placeholder="westeurope"
                  />
                </div>
              </>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 pt-2 border-t border-zinc-800">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Russian stress model</label>
              <div className="flex flex-col gap-1 w-full sm:w-96">
                <input
                  type="text"
                  value={russianStressModel}
                  onChange={e => setRussianStressModel(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-full"
                  placeholder="gemini-2.5-flash"
                />
                <span className="text-xs text-zinc-500">Gemini model for Russian homograph stress disambiguation before TTS</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Free Trial Period */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Crown className="w-5 h-5 text-yellow-400" />
            <h2 className="text-lg font-semibold">Free Trial Period</h2>
          </div>
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Trial days</label>
              <input
                type="number"
                min="0"
                value={freeTrialDays}
                onChange={e => setFreeTrialDays(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
              <span className="text-xs text-zinc-500">0 = no trial. New users get unlimited access for this many days.</span>
            </div>
            <div className="pt-2">
              <button
                onClick={() => saveSetting('free_trial_days', freeTrialDays)}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Free Tier Quota Limits */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-semibold">Free Tier Quotas</h2>
            <label className="ml-auto flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-zinc-500">{freeLimitsEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={freeLimitsEnabled}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setFreeLimitsEnabled(val);
                  await saveSetting('free_limits_enabled', String(val));
                }}
                className="accent-orange-500 w-4 h-4"
              />
            </label>
          </div>

          <div className={`bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4 ${!freeLimitsEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Explains / day</label>
              <input
                type="number"
                min="0"
                value={freeDailyExplains}
                onChange={e => setFreeDailyExplains(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">TTS / day</label>
              <input
                type="number"
                min="0"
                value={freeDailyTts}
                onChange={e => setFreeDailyTts(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Generates / day</label>
              <input
                type="number"
                min="0"
                value={freeDailyGenerates}
                onChange={e => setFreeDailyGenerates(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Max sentences</label>
              <input
                type="number"
                min="1"
                max="30"
                value={freeMaxGenerateSentences}
                onChange={e => setFreeMaxGenerateSentences(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
              <span className="text-xs text-zinc-500">Max sentences per generated text</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Max text length</label>
              <input
                type="number"
                min="0"
                value={freeMaxTextLength}
                onChange={e => setFreeMaxTextLength(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
              <span className="text-xs text-zinc-500">Max characters in text area (0 = unlimited)</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">WAV text / week</label>
              <input
                type="number"
                min="0"
                value={freeWeeklyWavText}
                onChange={e => setFreeWeeklyWavText(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
              <span className="text-xs text-zinc-500">Full text audio downloads per week</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">WAV cards / week</label>
              <input
                type="number"
                min="0"
                value={freeWeeklyWavFlashcards}
                onChange={e => setFreeWeeklyWavFlashcards(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24"
              />
              <span className="text-xs text-zinc-500">Flashcard audio downloads per week</span>
            </div>

            <p className="text-xs text-zinc-500">Limits for free-tier users. Pro subscribers have unlimited access.</p>

            <div className="pt-2">
              <button
                onClick={async () => {
                  setSavingQuotas(true);
                  try {
                    await Promise.all([
                      saveSetting('free_daily_explains', freeDailyExplains),
                      saveSetting('free_daily_tts', freeDailyTts),
                      saveSetting('free_daily_generates', freeDailyGenerates),
                      saveSetting('free_max_generate_sentences', freeMaxGenerateSentences),
                      saveSetting('free_max_text_length', freeMaxTextLength),
                      saveSetting('free_weekly_wav_text', freeWeeklyWavText),
                      saveSetting('free_weekly_wav_flashcards', freeWeeklyWavFlashcards),
                    ]);
                  } catch {
                    alert('Failed to save quotas');
                  } finally {
                    setSavingQuotas(false);
                  }
                }}
                disabled={savingQuotas}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingQuotas ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Anonymous Tier Quotas */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-semibold">Anonymous Tier Quotas</h2>
            <label className="ml-auto flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-zinc-500">{anonLimitsEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={anonLimitsEnabled}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAnonLimitsEnabled(val);
                  await saveSetting('anon_limits_enabled', String(val));
                }}
                className="accent-orange-500 w-4 h-4"
              />
            </label>
          </div>
          <div className={`bg-zinc-900 rounded-lg border border-zinc-800 p-5 space-y-4 ${!anonLimitsEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Explains / day</label>
              <input type="number" min="0" value={anonDailyExplains} onChange={e => setAnonDailyExplains(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">TTS / day</label>
              <input type="number" min="0" value={anonDailyTts} onChange={e => setAnonDailyTts(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Generates / day</label>
              <input type="number" min="0" value={anonDailyGenerates} onChange={e => setAnonDailyGenerates(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Max text length</label>
              <input type="number" min="0" value={anonMaxTextLength} onChange={e => setAnonMaxTextLength(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
              <span className="text-xs text-zinc-500">Max characters in text area</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Max sentences</label>
              <input type="number" min="1" max="30" value={anonMaxGenerateSentences} onChange={e => setAnonMaxGenerateSentences(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
              <span className="text-xs text-zinc-500">Max sentences per generated text</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Max workspaces</label>
              <input type="number" min="1" max="10" value={anonMaxWorkspaces} onChange={e => setAnonMaxWorkspaces(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
              <span className="text-xs text-zinc-500">Max workspaces per anonymous user</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-zinc-400 w-36 shrink-0">Session TTL (days)</label>
              <input type="number" min="1" value={anonSessionTtlDays} onChange={e => setAnonSessionTtlDays(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-24" />
              <span className="text-xs text-zinc-500">How long anonymous data is kept</span>
            </div>
            <p className="text-xs text-zinc-500">Limits for users who try without registration.</p>
            <div className="pt-2">
              <button
                onClick={async () => {
                  setSavingAnonQuotas(true);
                  try {
                    await Promise.all([
                      saveSetting('anon_daily_explains', anonDailyExplains),
                      saveSetting('anon_daily_tts', anonDailyTts),
                      saveSetting('anon_daily_generates', anonDailyGenerates),
                      saveSetting('anon_max_text_length', anonMaxTextLength),
                      saveSetting('anon_max_generate_sentences', anonMaxGenerateSentences),
                      saveSetting('anon_session_ttl_days', anonSessionTtlDays),
                      saveSetting('anon_max_workspaces', anonMaxWorkspaces),
                    ]);
                  } catch {
                    alert('Failed to save quotas');
                  } finally {
                    setSavingAnonQuotas(false);
                  }
                }}
                disabled={savingAnonQuotas}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingAnonQuotas ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Text Languages */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Languages className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold">Text Languages</h2>
          </div>

          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
            <p className="text-xs text-zinc-500 mb-4">
              Configure which languages are available and their TTS voice names. Uncheck to hide from the text language selector.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                    <th className="py-2 px-2 w-10">On</th>
                    <th className="py-2 px-2 w-28">Language</th>
                    <th className="py-2 px-2 w-24">Provider</th>
                    <th className="py-2 px-2">TTS Voice Name</th>
                    <th className="py-2 px-2 w-16"></th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(LANGUAGES).map(([code, lang]) => {
                    const override = voiceOverrides[code];
                    const currentProvider = override?.provider || lang.defaultTtsProvider || 'google';
                    const defaultVoice = currentProvider === 'azure' ? lang.ttsAzureVoice : lang.ttsVoice;
                    const currentVoice = override?.voice || defaultVoice;
                    const isDefault = !override;
                    return (
                      <tr key={code} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="py-1.5 px-2">
                          <input
                            type="checkbox"
                            checked={!disabledTextLanguages.has(code)}
                            onChange={() => {
                              setDisabledTextLanguages(prev => {
                                const next = new Set(prev);
                                if (next.has(code)) next.delete(code);
                                else next.add(code);
                                return next;
                              });
                            }}
                            className="accent-purple-500 w-4 h-4"
                          />
                        </td>
                        <td className="py-1.5 px-2 text-zinc-200 font-medium">
                          <span className="text-zinc-500 text-xs mr-1">{code}</span> {lang.label}
                        </td>
                        <td className="py-1.5 px-2">
                          <select
                            value={currentProvider}
                            onChange={(e) => {
                              const p = e.target.value as 'google' | 'azure';
                              const voice = p === 'azure' ? lang.ttsAzureVoice : lang.ttsVoice;
                              setVoiceOverrides(prev => ({ ...prev, [code]: { provider: p, voice } }));
                              setVoiceTestStatus(prev => { const n = { ...prev }; delete n[code]; return n; });
                              setVoiceTestError(prev => { const n = { ...prev }; delete n[code]; return n; });
                            }}
                            className={`text-xs px-1.5 py-1 rounded border bg-zinc-800 text-zinc-200 transition-colors ${!isDefault && currentProvider !== 'google' ? 'border-amber-600' : 'border-zinc-700'}`}
                          >
                            <option value="google">Google</option>
                            <option value="azure">Azure</option>
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={currentVoice}
                            onChange={(e) => {
                              setVoiceOverrides(prev => ({ ...prev, [code]: { provider: currentProvider as 'google' | 'azure', voice: e.target.value } }));
                            }}
                            className={`w-full text-xs px-2 py-1 rounded border bg-zinc-800 text-zinc-200 transition-colors ${isDefault ? 'border-zinc-700' : 'border-amber-600'}`}
                            spellCheck={false}
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <button
                            onClick={async () => {
                              setVoiceTestStatus(prev => ({ ...prev, [code]: 'testing' }));
                              setVoiceTestError(prev => { const n = { ...prev }; delete n[code]; return n; });
                              try {
                                const res = await fetch('/api/admin/test-tts', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId || '' },
                                  body: JSON.stringify({ languageCode: lang.ttsLang, voiceName: currentVoice, text: lang.ttsTestPhrase, provider: currentProvider }),
                                });
                                if (!res.ok) {
                                  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                                  const d = body.detail;
                                  const detail = d ? ` [${d.provider}/${d.voice}${d.region ? `@${d.region}` : ''}]` : '';
                                  throw new Error((body.error || `HTTP ${res.status}`) + detail);
                                }
                                const { audio } = await res.json();
                                const raw = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
                                const ctx = new AudioContext({ sampleRate: 24000 });
                                const buf = ctx.createBuffer(1, raw.length / 2, 24000);
                                const ch = buf.getChannelData(0);
                                const view = new DataView(raw.buffer);
                                for (let i = 0; i < ch.length; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
                                const src = ctx.createBufferSource();
                                src.buffer = buf;
                                src.connect(ctx.destination);
                                src.start();
                                setVoiceTestStatus(prev => ({ ...prev, [code]: 'ok' }));
                              } catch (err) {
                                setVoiceTestStatus(prev => ({ ...prev, [code]: 'error' }));
                                setVoiceTestError(prev => ({ ...prev, [code]: err instanceof Error ? err.message : String(err) }));
                              }
                            }}
                            disabled={voiceTestStatus[code] === 'testing'}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              voiceTestStatus[code] === 'error' ? 'text-red-400 bg-red-950/50 border border-red-800' :
                              voiceTestStatus[code] === 'ok' ? 'text-green-400 bg-green-950/50 border border-green-800' :
                              'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-700'
                            } disabled:opacity-50`}
                            title={voiceTestError[code] || 'Test this voice'}
                          >
                            {voiceTestStatus[code] === 'testing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                            {voiceTestStatus[code] === 'error' ? '!' : voiceTestStatus[code] === 'ok' ? '✓' : 'Test'}
                          </button>
                          {voiceTestStatus[code] === 'error' && voiceTestError[code] && (
                            <div className="mt-1 text-[10px] text-red-400 leading-tight max-w-[200px] break-words">{voiceTestError[code]}</div>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          {!isDefault && (
                            <button
                              onClick={() => {
                                setVoiceOverrides(prev => {
                                  const next = { ...prev };
                                  delete next[code];
                                  return next;
                                });
                                setVoiceTestStatus(prev => { const n = { ...prev }; delete n[code]; return n; });
                                setVoiceTestError(prev => { const n = { ...prev }; delete n[code]; return n; });
                              }}
                              className="p-1 rounded text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition-colors"
                              title={`Reset to default: Google / ${lang.ttsVoice}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pt-4 flex items-center gap-3">
              <button
                onClick={async () => {
                  setSavingLanguages(true);
                  try {
                    // Filter out entries that match defaults (google + default voice)
                    const entries = Object.entries(voiceOverrides) as [string, { provider: 'google' | 'azure'; voice: string }][];
                    const nonDefaultOverrides = Object.fromEntries(
                      entries.filter(([code, o]) => {
                        const lang = LANGUAGES[code];
                        if (!lang) return false;
                        if (o.provider === 'google' && o.voice === lang.ttsVoice) return false;
                        if (o.provider === 'azure' && o.voice === lang.ttsAzureVoice && ttsProvider === 'azure') return false;
                        return true;
                      })
                    );
                    await Promise.all([
                      saveSetting('disabled_text_languages', Array.from(disabledTextLanguages).join(',')),
                      saveSetting('tts_voices', JSON.stringify(nonDefaultOverrides)),
                    ]);
                  } catch {
                    alert('Failed to save');
                  } finally {
                    setSavingLanguages(false);
                  }
                }}
                disabled={savingLanguages}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {savingLanguages ? 'Saving...' : 'Save'}
              </button>
              <span className="text-xs text-zinc-500">
                {Object.keys(LANGUAGES).length - disabledTextLanguages.size} of {Object.keys(LANGUAGES).length} enabled
                {Object.keys(voiceOverrides).length > 0 &&
                  ` · ${Object.keys(voiceOverrides).length} customized`}
              </span>
            </div>
          </div>
        </div>

        {/* Promo Sources */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold">Promo Sources</h2>
          </div>

          {/* Create new source */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={newPromoName}
                onChange={e => setNewPromoName(e.target.value)}
                placeholder="Name (e.g. YouTube Ad)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
              <input
                value={newPromoDesc}
                onChange={e => setNewPromoDesc(e.target.value)}
                placeholder="Description (optional)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
              <button
                onClick={async () => {
                  if (!newPromoName.trim() || !sessionId) return;
                  setCreatingPromo(true);
                  try {
                    const res = await fetch('/api/admin/promo-sources', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
                      body: JSON.stringify({ name: newPromoName.trim(), description: newPromoDesc.trim() || null }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setPromoSources(prev => [data.source, ...prev]);
                      setNewPromoName('');
                      setNewPromoDesc('');
                    } else {
                      alert('Failed to create');
                    }
                  } catch { alert('Network error'); }
                  finally { setCreatingPromo(false); }
                }}
                disabled={creatingPromo || !newPromoName.trim()}
                className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {creatingPromo ? 'Creating...' : 'Create Link'}
              </button>
            </div>
          </div>

          {/* Sources list */}
          {promoSources.length > 0 && (
            <div className="space-y-2">
              {promoSources.map(ps => (
                <div key={ps.id} className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{ps.name}</span>
                      <span className="text-xs text-zinc-500">{ps.description}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <code className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-cyan-400 select-all">
                        {window.location.origin}/?s={ps.code}
                      </code>
                      <span className="text-xs text-zinc-500">
                        {ps.user_count} user{ps.user_count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {new Date(ps.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/?s=${ps.code}`);
                    }}
                    className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                  >
                    Copy
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete promo source "${ps.name}"?`)) return;
                      try {
                        const res = await fetch(`/api/admin/promo-sources/${ps.id}`, {
                          method: 'DELETE',
                          headers: { 'X-Session-Id': sessionId! },
                        });
                        if (res.ok) setPromoSources(prev => prev.filter(s => s.id !== ps.id));
                      } catch { alert('Network error'); }
                    }}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API Keys */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold">API Keys</h2>
          </div>

          {/* Create new key */}
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={newApiKeyName}
                onChange={e => setNewApiKeyName(e.target.value)}
                placeholder="Key name (e.g. Production)"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
              />
              <button
                onClick={async () => {
                  if (!sessionId) return;
                  setCreatingApiKey(true);
                  setLastCreatedKey(null);
                  try {
                    const res = await fetch('/api/admin/api-keys', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
                      body: JSON.stringify({ name: newApiKeyName.trim() || 'default' }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setLastCreatedKey(data.key);
                      setNewApiKeyName('');
                      fetchApiKeys();
                    } else {
                      alert('Failed to create');
                    }
                  } catch { alert('Network error'); }
                  finally { setCreatingApiKey(false); }
                }}
                disabled={creatingApiKey}
                className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {creatingApiKey ? 'Creating...' : 'Generate Key'}
              </button>
            </div>
            {lastCreatedKey && (
              <div className="mt-3 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
                <div className="text-xs text-amber-300 mb-1 font-medium">New API key (copy now — it won't be shown again):</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-zinc-800 px-3 py-1.5 rounded text-amber-200 select-all break-all">{lastCreatedKey}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(lastCreatedKey)}
                    className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Keys list */}
          {apiKeys.length > 0 && (
            <div className="space-y-2">
              {apiKeys.map(ak => (
                <div key={ak.id} className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-medium text-sm">{ak.name}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-zinc-500 font-mono">{ak.id.slice(0, 8)}...</span>
                      <span className="text-xs text-zinc-600">
                        {new Date(ak.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete API key "${ak.name}"?`)) return;
                      try {
                        const res = await fetch(`/api/admin/api-keys/${ak.id}`, {
                          method: 'DELETE',
                          headers: { 'X-Session-Id': sessionId! },
                        });
                        if (res.ok) setApiKeys(prev => prev.filter(k => k.id !== ak.id));
                      } catch { alert('Network error'); }
                    }}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shared Links */}
        {allShares.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Share2 className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold">Shared Links ({allShares.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-zinc-700 text-zinc-400">
                    <th className="px-4 py-3 font-medium">Creator</th>
                    <th className="px-4 py-3 font-medium">Workspace</th>
                    <th className="px-4 py-3 font-medium">Link</th>
                    <th className="px-4 py-3 font-medium">Text</th>
                    <th className="px-4 py-3 font-medium">Expl.</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {allShares.map(share => (
                    <tr key={share.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5">
                        <div className="text-zinc-300">{share.creator_name || '—'}</div>
                        <div className="text-zinc-500 text-xs">{share.creator_email}</div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{share.workspace_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <a href={`/s/${share.id}`} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 w-fit"
                        >
                          /s/{share.id} <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{share.text_language}</td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{share.explanation_language || '—'}</td>
                      <td className="px-4 py-2.5">
                        {share.share_source ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/50 text-purple-300">{share.share_source}</span>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{new Date(share.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/s/${share.id}`).catch(() => {}); }}
                            className="p-1 rounded hover:bg-blue-900/30 text-zinc-600 hover:text-blue-400 transition-colors"
                            title="Copy link"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteShare(share.id)}
                            className="p-1 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
                            title="Delete shared link"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* User Feedback */}
        {feedback.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold">User Feedback ({feedback.length})</h2>
            </div>

            <div className="space-y-3">
              {feedback.map((fb, i) => {
                const isBug = fb.detail?.startsWith('[bug]');
                const isFeature = fb.detail?.startsWith('[feature]');
                const typeLabel = isBug ? 'Bug' : isFeature ? 'Feature' : 'Other';
                const typeColor = isBug ? 'bg-red-900/50 text-red-300' : isFeature ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-800 text-zinc-400';
                const message = fb.detail?.replace(/^\[(bug|feature|other)\]\s*/i, '') || '';

                return (
                  <div key={fb.id} className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor}`}>
                        {typeLabel}
                      </span>
                      <span className="text-sm text-zinc-300">{fb.name || fb.email}</span>
                      <span className="text-xs text-zinc-600 ml-auto">
                        {new Date(fb.created_at).toLocaleString()}
                      </span>
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this feedback?')) return;
                          try {
                            const res = await fetch(`/api/admin/feedback/${fb.id}`, {
                              method: 'DELETE',
                              headers: { 'X-Session-Id': sessionId! },
                            });
                            if (res.ok) setFeedback(prev => prev.filter(f => f.id !== fb.id));
                          } catch { alert('Network error'); }
                        }}
                        className="p-1 rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete feedback"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-10 text-center text-xs text-zinc-600">
          Build: {process.env.COMMIT_HASH || 'dev'} · {process.env.BUILD_TIME || 'local'}
        </div>
      </div>
    </div>
  );
}
