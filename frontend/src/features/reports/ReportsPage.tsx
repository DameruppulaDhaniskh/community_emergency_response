import { useQuery } from '@tanstack/react-query';
import { getIncidents } from '../../api/incidents';
import { SkeletonCard } from '../../components/Skeleton';
import Card, { CardHeader } from '../../components/Card';
import {
  EMERGENCY_TYPE_LABELS,
  STATUS_LABELS,
} from '../../lib/formatters';
import {
  BarChart3,
  Clock,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { IncidentStatus, EmergencyType } from '../../api/types';

const CHART_COLORS = ['#D9381E', '#B93412', '#166534', '#1E40AF', '#B45309', '#5B5B6B'];

export default function ReportsPage() {
  const { data: incidents, isLoading } = useQuery({
    queryKey: ['all-incidents-reports'],
    queryFn: () => getIncidents(),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
        <h1 style={{ font: '800 34px Inter', color: '#1A1A2E' }}>Reports &amp; Analytics</h1>
        <SkeletonCard count={2} />
      </div>
    );
  }

  const all = incidents || [];

  // ── Compute stats ──
  const totalIncidents = all.length;
  const resolved = all.filter((i) => i.status === 'RESOLVED' || i.status === 'CLOSED');
  const escalated = all.filter((i) => i.is_escalated);
  const resolutionRate = totalIncidents > 0 ? Math.round((resolved.length / totalIncidents) * 100) : 0;
  const escalationRate = totalIncidents > 0 ? Math.round((escalated.length / totalIncidents) * 100) : 0;

  // Average response time (created_at to resolved_at)
  const resolvedWithTime = resolved.filter((i) => i.resolved_at);
  const avgResponseMs =
    resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((sum, i) => {
          return sum + (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime());
        }, 0) / resolvedWithTime.length
      : 0;
  const avgResponseMin = Math.round(avgResponseMs / 60000);

  // By category
  const byCategory = Object.entries(
    all.reduce((acc, i) => {
      acc[i.emergency_type] = (acc[i.emergency_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([type, count]) => ({
    name: EMERGENCY_TYPE_LABELS[type as EmergencyType] || type,
    value: count,
  }));

  // By status
  const byStatus = Object.entries(
    all.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({
    name: STATUS_LABELS[status as IncidentStatus] || status,
    value: count,
  }));

  // By day of week
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDayOfWeek = dayNames.map((day, i) => ({
    name: day,
    incidents: all.filter((inc) => new Date(inc.created_at).getDay() === i).length,
  }));

  // By hour
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    name: `${h.toString().padStart(2, '0')}:00`,
    incidents: all.filter((inc) => new Date(inc.created_at).getHours() === h).length,
  }));

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Society Safety Analytics
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Emergency response metrics, resolution bottlenecks, and historical patterns.
          </p>
        </div>
        <span className="chip info">
          Total Recorded: {totalIncidents}
        </span>
      </div>

      {totalIncidents === 0 ? (
        <Card className="text-center py-16">
          <div className="w-12 h-12 rounded-2xl bg-surface-sunken flex items-center justify-center text-ink-disabled mx-auto mb-3">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-ink">No incident logs available</h3>
          <p className="text-sm text-ink-secondary mt-1 max-w-sm mx-auto">
            Analytical charts and response timelines will automatically populate here once incidents are recorded in your society.
          </p>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-raised border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-2 text-ink-secondary">
                <AlertTriangle className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider">Total Alerts</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-ink tabular-nums">{totalIncidents}</p>
              <p className="text-xs text-ink-secondary mt-1.5">{escalated.length} escalated to authorities</p>
            </div>

            <div className="bg-surface-raised border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-2 text-ink-secondary">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Avg. Time to Close</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-ink tabular-nums">
                {avgResponseMin > 0 ? `${avgResponseMin} min` : '< 5 min'}
              </p>
              <p className="text-xs text-ink-secondary mt-1.5">
                {resolvedWithTime.length > 0 ? `Across ${resolvedWithTime.length} closed alerts` : 'Initial sample period'}
              </p>
            </div>

            <div className="bg-surface-raised border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-2 text-ink-secondary">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold uppercase tracking-wider">Resolution Rate</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-emerald-700 tabular-nums">{resolutionRate}%</p>
              <p className="text-xs text-ink-secondary mt-1.5">{resolved.length} of {totalIncidents} safely resolved</p>
            </div>

            <div className="bg-surface-raised border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center gap-2 mb-2 text-ink-secondary">
                <ArrowUpCircle className="w-4 h-4 text-critical" />
                <span className="text-xs font-semibold uppercase tracking-wider">Escalation Rate</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-ink tabular-nums">{escalationRate}%</p>
              <p className="text-xs text-ink-secondary mt-1.5">
                {escalationRate > 25 ? 'High · optimize security triage' : 'Within normal safety threshold'}
              </p>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By category */}
            <Card>
              <CardHeader
                title="Incidents by Category"
                description="Distribution across medical, fire, security and falls"
              />
              <div className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/5 px-3 py-1.5 rounded-lg mb-4">
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {byCategory.length > 0
                    ? `${byCategory.sort((a, b) => b.value - a.value)[0].name} emergencies represent the most frequent resident call.`
                    : 'Awaiting categorical distribution data.'}
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCategory} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        fontSize: 12,
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      }}
                    />
                    <Bar dataKey="value" fill="#0F766E" radius={[6, 6, 0, 0]} name="Incidents" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* By status */}
            <Card>
              <CardHeader
                title="Status Pipeline Breakdown"
                description="Proportion of open vs escalated vs resolved"
              />
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg mb-4">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{resolutionRate}% of incidents handled through to formal closure.</span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byStatus}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                      fontSize={11}
                    >
                      {byStatus.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* By day of week */}
            <Card>
              <CardHeader
                title="Weekly Incident Density"
                description="Identifies days with elevated emergency call volumes"
              />
              <div className="flex items-center gap-2 text-xs font-medium text-amber-900 bg-amber-50 px-3 py-1.5 rounded-lg mb-4">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {byDayOfWeek.length > 0
                    ? `${byDayOfWeek.sort((a, b) => b.incidents - a.incidents)[0].name} records the highest volume of alerts.`
                    : 'Analyzing day patterns...'}
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDayOfWeek} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="incidents" fill="#B45309" radius={[6, 6, 0, 0]} name="Incidents" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* By hour */}
            <Card>
              <CardHeader
                title="24-Hour Diurnal Trend"
                description="Hourly distribution to assist guard desk shift scheduling"
              />
              <div className="flex items-center gap-2 text-xs font-medium text-blue-900 bg-blue-50 px-3 py-1.5 rounded-lg mb-4">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  {byHour.length > 0
                    ? `Peak response window occurs near ${byHour.sort((a, b) => b.incidents - a.incidents)[0].name}.`
                    : 'Evaluating hourly peaks...'}
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byHour} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} interval={3} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="incidents" fill="#0284C7" radius={[4, 4, 0, 0]} name="Incidents" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
