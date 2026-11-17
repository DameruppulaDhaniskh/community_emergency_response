import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getIncidents, updateIncidentStatus } from '../../api/incidents';
import type { IncidentStatus } from '../../api/types';
import {
  EMERGENCY_TYPE_LABELS,
  STATUS_LABELS,
  formatDistanceToNow,
  mapApiError,
} from '../../lib/formatters';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import StatusBadge, { incidentStatusVariant } from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export default function LiveDashboardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL' | 'RESOLVED'>('ACTIVE');

  const {
    data: incidents,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => getIncidents(),
    refetchInterval: 6000,
  });

  const ackMut = useMutation({
    mutationFn: (incidentId: number) =>
      updateIncidentStatus(incidentId, 'ACKNOWLEDGED', 'Acknowledged by gate security'),
    onSuccess: () => {
      toast.success('Incident acknowledged.');
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not acknowledge incident.')),
  });

  const all = incidents || [];
  const activeList = all.filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status));
  const resolvedList = all.filter((i) => ['RESOLVED', 'CLOSED'].includes(i.status));

  const displayList = filter === 'ACTIVE' ? activeList : filter === 'RESOLVED' ? resolvedList : all;

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Security Dispatch &amp; Operations
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Acknowledge incoming alerts, review delivery records, and verify society dispatches.
          </p>
        </div>
        <span className="chip ok">Security On Duty</span>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            ACTIVE INCIDENTS
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#D92D20' }}>
            {activeList.length}
          </div>
        </div>
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            RESOLVED / CLOSED
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#166534' }}>
            {resolvedList.length}
          </div>
        </div>
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            TOTAL RECORDED
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
            {all.length}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['ACTIVE', 'ALL', 'RESOLVED'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`cat ${filter === tab ? 'on' : ''}`}
          >
            {tab === 'ACTIVE' ? 'Active Alerts' : tab === 'RESOLVED' ? 'Resolved & Closed' : 'All Incidents'}
          </button>
        ))}
      </div>

      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Could not load society incidents.')}
          onRetry={() => refetch()}
        />
      )}

      {isLoading ? (
        <SkeletonCard count={3} />
      ) : displayList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ShieldCheck className="w-5 h-5 text-[#166534]" />}
            title="All clear in your society"
            description="No incidents match the selected filter."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayList.map((inc) => {
            const catLabel = EMERGENCY_TYPE_LABELS[inc.category || inc.emergency_type] || 'Emergency';
            return (
              <div
                key={inc.id}
                onClick={() => navigate(`/incidents/${inc.id}`)}
                className="card cursor-pointer hover:shadow-md transition-shadow flex flex-wrap justify-between items-center gap-4"
                style={{ padding: '18px 22px' }}
              >
                <div className="min-w-[240px] flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
                      #{inc.id} · {inc.title || catLabel}
                    </span>
                    <StatusBadge
                      variant={incidentStatusVariant(inc.status as IncidentStatus)}
                      label={STATUS_LABELS[inc.status] || inc.status}
                    />
                    {inc.is_escalated && <span className="chip bad">Escalated</span>}
                  </div>
                  <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    Resident: {inc.resident_name} · {inc.flat_number || 'Community Flat'} ·{' '}
                    {formatDistanceToNow(inc.created_at)}
                  </div>
                  {inc.description && (
                    <div style={{ font: '500 13px Inter', color: '#1A1A2E', marginTop: '2px' }}>
                      &ldquo;{inc.description}&rdquo;
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {inc.status === 'REPORTED' && (
                    <button
                      type="button"
                      disabled={!isOnline || ackMut.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        ackMut.mutate(inc.id);
                      }}
                      className="btn"
                      style={{ padding: '8px 14px', fontSize: '13px' }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Acknowledge
                    </button>
                  )}
                  <button className="ghost" type="button">
                    Delivery &amp; Tracking
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
