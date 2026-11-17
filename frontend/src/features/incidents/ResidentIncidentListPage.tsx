import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getResidentIncidents } from '../../api/incidents';
import type { IncidentStatus } from '../../api/types';
import {
  EMERGENCY_TYPE_LABELS,
  STATUS_LABELS,
  formatDistanceToNow,
  mapApiError,
} from '../../lib/formatters';
import StatusBadge, { incidentStatusVariant } from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { FilePlus2, Search, ShieldCheck } from 'lucide-react';

const STATUS_TABS: Array<{ value: IncidentStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function ResidentIncidentListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<IncidentStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const {
    data: incidents,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['resident-incidents'],
    queryFn: getResidentIncidents,
    refetchInterval: 10_000,
  });

  const list = incidents || [];
  const filtered = list.filter((item) => {
    const matchesStatus = filter === 'ALL' || item.status === filter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (item.title || '').toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      (item.category || item.emergency_type).toLowerCase().includes(q) ||
      String(item.id).includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            My Incidents
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Track every SOS and incident report from initial report to closure.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/resident/report')}
          className="btn"
          style={{ padding: '12px 18px' }}
        >
          <FilePlus2 className="w-4 h-4" />
          Report Incident
        </button>
      </div>

      {/* Search & Status Tabs */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#5B5B6B' }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, description, category, or #ID..."
            className="fld"
            style={{ paddingLeft: '38px' }}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`cat ${filter === f.value ? 'on' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Failed to load your incidents.')}
          onRetry={() => refetch()}
        />
      )}

      {isLoading ? (
        <SkeletonCard count={3} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ShieldCheck className="w-5 h-5 text-[#166534]" />}
            title={list.length === 0 ? 'No incidents reported yet' : 'No matching incidents'}
            description={
              list.length === 0
                ? 'When you trigger SOS or report a society issue, its full status progress appears here.'
                : 'Try switching status tabs or clearing your search query.'
            }
            action={
              list.length === 0 ? (
                <button type="button" onClick={() => navigate('/resident/report')} className="btn">
                  Report an Incident
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('ALL');
                    setSearch('');
                  }}
                  className="ghost"
                >
                  Clear filters
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => {
            const catLabel = EMERGENCY_TYPE_LABELS[item.category || item.emergency_type] || 'Emergency';
            return (
              <div
                key={item.id}
                onClick={() => navigate(`/resident/incidents/${item.id}`)}
                className="card cursor-pointer hover:shadow-md transition-shadow flex flex-wrap justify-between items-center gap-3"
                style={{ padding: '18px 22px' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
                      #{item.id} · {item.title || `SOS: ${catLabel}`}
                    </span>
                    <span className="chip info">{catLabel}</span>
                    {item.is_escalated && <span className="chip bad">Escalated</span>}
                  </div>
                  <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    {item.flat_number || 'Society Resident'} · {formatDistanceToNow(item.created_at)}
                    {item.assigned_to ? ` · Assigned to ${item.assigned_to.name}` : ''}
                  </div>
                </div>
                <StatusBadge
                  variant={incidentStatusVariant(item.status)}
                  label={STATUS_LABELS[item.status] || item.status}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
