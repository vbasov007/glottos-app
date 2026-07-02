import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { ArrowLeft, Users, Activity, BookOpen, Volume2, Sparkles, Smartphone, Loader2, Settings, Download } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Legend,
} from 'recharts';

interface MonitoringData {
  summary: {
    total_users: number;
    active_users: number;
    new_users: number;
    total_explains: number;
    total_tts: number;
    total_generates: number;
  };
  subscriptions: { status: string; count: number }[];
  daily: {
    day: string;
    new_users: number;
    explains: number;
    tts: number;
    generates: number;
  }[];
  features: { action: string; count: number }[];
  devices: { device: string; count: number }[];
}

const PERIOD_OPTIONS = [7, 14, 30, 90] as const;

const CHART_COLORS = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  amber: '#f59e0b',
};

const SUB_COLORS: Record<string, string> = {
  free: '#71717a',
  pro: '#3b82f6',
  trial: '#f59e0b',
  past_due: '#ef4444',
  active: '#22c55e',
};

const tooltipStyle = {
  contentStyle: { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 },
  labelStyle: { color: '#a1a1aa' },
  itemStyle: { color: '#e4e4e7' },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

interface PromoSource {
  id: number;
  code: string;
  name: string;
  user_count: number;
}

export default function Monitoring() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [source, setSource] = useState<string>('');
  const [promoSources, setPromoSources] = useState<PromoSource[]>([]);
  // Cost-log date range — default to last 30 days, inclusive of today.
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const [costStart, setCostStart] = useState<string>(daysAgoIso(30));
  const [costEnd, setCostEnd] = useState<string>(todayIso());
  const [costDownloading, setCostDownloading] = useState(false);

  const sessionId = localStorage.getItem('session_id');

  const fetchData = useCallback(async (period: number, sourceCode: string) => {
    if (!sessionId) { setError('Not authenticated'); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(period) });
      if (sourceCode) params.set('source', sourceCode);
      const res = await fetch(`/api/admin/monitoring?${params}`, {
        headers: { 'X-Session-Id': sessionId },
      });
      if (res.status === 401) { setError('Not authenticated'); return; }
      if (res.status === 403) { setError('Access denied'); return; }
      if (!res.ok) { setError('Failed to load monitoring data'); return; }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    fetch('/api/admin/promo-sources', { headers: { 'X-Session-Id': sessionId } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPromoSources(d.sources); })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => { fetchData(days, source); }, [days, source, fetchData]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const totalRequests = data ? (data.devices.reduce((s, d) => s + d.count, 0) || 1) : 1;
  const mobileCount = data ? (data.devices.find(d => d.device === 'mobile')?.count || 0) : 0;
  const mobilePct = Math.round((mobileCount / totalRequests) * 100);

  const dailyData = data?.daily.map(d => ({ ...d, day: formatDate(d.day) })) || [];

  const pieData = data?.devices.filter(d => d.device !== 'unknown') || [];
  const DEVICE_COLORS = [CHART_COLORS.blue, CHART_COLORS.amber, CHART_COLORS.green, CHART_COLORS.purple];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Monitoring</h1>
          <div className="flex items-center gap-4">
            {/* Source filter */}
            {promoSources.length > 0 && (
              <select
                value={source}
                onChange={e => setSource(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-300 outline-none"
              >
                <option value="">All sources</option>
                {promoSources.map(ps => (
                  <option key={ps.code} value={ps.code}>{ps.name} ({ps.user_count})</option>
                ))}
              </select>
            )}
            {/* Period toggle */}
            <div className="flex bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
              {PERIOD_OPTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    days === p
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  {p}d
                </button>
              ))}
            </div>
            <a href="/admin" className="inline-flex items-center gap-2 text-zinc-400 hover:text-zinc-200 text-sm">
              <Settings className="w-4 h-4" /> Admin
            </a>
            <a href="/" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm">
              <ArrowLeft className="w-4 h-4" /> Back to app
            </a>
          </div>
        </div>

        {/* Cost log download */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1">Cost log (LLM + TTS)</div>
            <div className="text-xs text-zinc-500">CSV download of every billable request in the chosen range with per-row cost_usd.</div>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs text-zinc-500 flex flex-col gap-1">
              From
              <input
                type="date"
                value={costStart}
                onChange={e => setCostStart(e.target.value)}
                max={costEnd}
                className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              />
            </label>
            <label className="text-xs text-zinc-500 flex flex-col gap-1">
              To
              <input
                type="date"
                value={costEnd}
                onChange={e => setCostEnd(e.target.value)}
                min={costStart}
                max={todayIso()}
                className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-700"
              />
            </label>
            <button
              onClick={async () => {
                if (!sessionId || costDownloading) return;
                setCostDownloading(true);
                try {
                  const res = await fetch(`/api/admin/cost-log?start=${encodeURIComponent(costStart)}&end=${encodeURIComponent(costEnd)}`, {
                    headers: { 'X-Session-Id': sessionId },
                  });
                  if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    alert(`Download failed (${res.status}): ${txt.slice(0, 200)}`);
                    return;
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `cost-log-${costStart}-to-${costEnd}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } finally {
                  setCostDownloading(false);
                }
              }}
              disabled={costDownloading || !costStart || !costEnd}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              {costDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {costDownloading ? 'Preparing…' : 'Download CSV'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        ) : data ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              <KpiCard icon={<Users className="w-5 h-5 text-blue-400" />} label="Total Users" value={data.summary.total_users} sub={`+${data.summary.new_users} new`} />
              <KpiCard icon={<Activity className="w-5 h-5 text-green-400" />} label="Active Users" value={data.summary.active_users} sub={`in last ${days}d`} />
              <KpiCard icon={<BookOpen className="w-5 h-5 text-purple-400" />} label="Explanations" value={data.summary.total_explains} sub={`${days}d`} />
              <KpiCard icon={<Volume2 className="w-5 h-5 text-amber-400" />} label="TTS Requests" value={data.summary.total_tts} sub={`${days}d`} />
              <KpiCard icon={<Sparkles className="w-5 h-5 text-pink-400" />} label="Generations" value={data.summary.total_generates} sub={`${days}d`} />
              <KpiCard icon={<Smartphone className="w-5 h-5 text-cyan-400" />} label="Mobile" value={`${mobilePct}%`} sub="of requests" />
            </div>

            {/* Charts 2x2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* New User Registrations */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-4">New User Registrations</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 12 }} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="new_users" stroke={CHART_COLORS.amber} fill={CHART_COLORS.amber} fillOpacity={0.2} name="New Users" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Request Volume Trends */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-4">Request Volume Trends</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 12 }} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ color: '#a1a1aa', fontSize: 12 }} />
                    <Line type="monotone" dataKey="explains" stroke={CHART_COLORS.blue} strokeWidth={2} dot={false} name="Explains" />
                    <Line type="monotone" dataKey="tts" stroke={CHART_COLORS.green} strokeWidth={2} dot={false} name="TTS" />
                    <Line type="monotone" dataKey="generates" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} name="Generates" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Feature Usage */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-4">Feature Usage</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.features} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis type="number" tick={{ fill: '#71717a', fontSize: 12 }} allowDecimals={false} />
                    <YAxis dataKey="action" type="category" tick={{ fill: '#71717a', fontSize: 12 }} width={120} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="count" fill={CHART_COLORS.blue} radius={[0, 4, 4, 0]} name="Count" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Device Split */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-4">Device Split</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData.length ? pieData : [{ device: 'no data', count: 1 }]}
                      dataKey="count"
                      nameKey="device"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      label={({ device, percent }) => `${device} ${(percent * 100).toFixed(0)}%`}
                    >
                      {(pieData.length ? pieData : [{ device: 'no data', count: 1 }]).map((_, i) => (
                        <Cell key={i} fill={pieData.length ? DEVICE_COLORS[i % DEVICE_COLORS.length] : '#3f3f46'} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Subscription stats */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Subscriptions</h3>
              <div className="flex flex-wrap gap-3">
                {data.subscriptions.map(s => (
                  <span
                    key={s.status}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{ backgroundColor: (SUB_COLORS[s.status] || '#71717a') + '20', color: SUB_COLORS[s.status] || '#71717a' }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SUB_COLORS[s.status] || '#71717a' }} />
                    {s.status}: {s.count}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-zinc-500 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
