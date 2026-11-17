import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIncidents,
  getVolunteerIncidents,
  volunteerAccept,
} from '../../api/incidents';
import {
  getAvailability,
  toggleAvailability,
  updateVolunteerLocation,
} from '../../api/volunteers';
import { useAuth } from '../auth/AuthContext';
import type { IncidentStatus, Incident } from '../../api/types';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
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
import LocationMap from '../../components/LocationMap';
import {
  ClipboardCheck,
  PhoneCall,
  CheckCircle,
  AlertOctagon,
  EyeOff,
} from 'lucide-react';

const VOLUNTEER_TABS: Array<{ value: '' | IncidentStatus; label: string }> = [
  { value: '', label: 'All Assigned' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function VolunteerAssignmentList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | IncidentStatus>('');
  const [takenMap, setTakenMap] = useState<Record<number, string>>({});

  // Availability Query
  const { data: availability } = useQuery({
    queryKey: ['volunteer-availability'],
    queryFn: getAvailability,
  });

  const isAvailable = availability?.is_available ?? true;

  // Background GPS Location Tracking
  useEffect(() => {
    if (!isAvailable) return;

    const reportPosition = (pos: GeolocationPosition) => {
      updateVolunteerLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }).catch((err) => {
        console.debug('Volunteer GPS ping error:', err);
      });
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(reportPosition, () => {}, {
        enableHighAccuracy: true,
        timeout: 6000,
      });

      const interval = setInterval(() => {
        navigator.geolocation.getCurrentPosition(reportPosition, () => {}, {
          enableHighAccuracy: true,
          timeout: 6000,
        });
      }, 60000); // sync every 60s

      return () => clearInterval(interval);
    }
  }, [isAvailable]);

  // Query all authorized incidents (includes unassigned escalated alerts dispatched to this volunteer)
  const {
    data: allIncidents = [],
    refetch: refetchAll,
  } = useQuery({
    queryKey: ['incidents', 'volunteer-view'],
    queryFn: () => getIncidents(),
    refetchInterval: 6000,
  });

  // Query assigned incidents (for filtered tabs)
  const {
    data: assignedIncidents = [],
    isLoading: assignedLoading,
    isError,
    error,
    refetch: refetchAssigned,
  } = useQuery({
    queryKey: ['volunteer-incidents', statusFilter],
    queryFn: () => getVolunteerIncidents(statusFilter ? { status: statusFilter } : undefined),
    refetchInterval: 6000,
  });

  // Toggle Availability Mutation
  const toggleMutation = useMutation({
    mutationFn: (nextAvail: boolean) => toggleAvailability(nextAvail),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['volunteer-availability'] });
      toast.success(
        res.is_available
          ? 'You are now Available for new emergency assignments.'
          : 'You are now Off-Duty. Admins will see you as unavailable.'
      );
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not update availability.')),
  });

  // Accept Incident Mutation
  const acceptMutation = useMutation({
    mutationFn: (incidentId: number) => volunteerAccept(incidentId),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['volunteer-incidents'] });
      toast.success(`Emergency #${updated.id} accepted! Full resident details unlocked.`);
      navigate(`/volunteer/incidents/${updated.id}`);
    },
    onError: (err: any, incidentId: number) => {
      if (err.response?.status === 409) {
        const detail = err.response?.data?.detail || 'This emergency has already been taken by another responder.';
        setTakenMap((prev) => ({ ...prev, [incidentId]: detail }));
        toast.error('Emergency alert already claimed by another volunteer.');
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
        queryClient.invalidateQueries({ queryKey: ['volunteer-incidents'] });
      } else {
        const msg = mapApiError(err, 'Failed to accept incident assignment.');
        toast.error(msg);
      }
    },
  });

  // Separate incoming alerts (not yet accepted by me, active) from accepted assignments
  const incomingAlerts: Incident[] = allIncidents.filter(
    (inc) => inc.assigned_to_id !== user?.id && !['RESOLVED', 'CLOSED'].includes(inc.status)
  );

  const activeAssignments = assignedIncidents.filter((i) =>
    ['ASSIGNED', 'IN_PROGRESS'].includes(i.status)
  );
  const resolvedCount = assignedIncidents.filter((i) =>
    ['RESOLVED', 'CLOSED'].includes(i.status)
  ).length;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1020px] mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Volunteer Responder Dashboard
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Respond to block-first emergency SOS dispatches and manage your active assignments.
          </p>
        </div>

        <button
          type="button"
          disabled={!isOnline || toggleMutation.isPending}
          title={!isOnline ? 'Unavailable while offline' : 'Toggle volunteer duty availability'}
          onClick={() => toggleMutation.mutate(!isAvailable)}
          className={`chip ${isAvailable ? 'ok' : 'warn'} cursor-pointer`}
          style={{ fontSize: '13px', padding: '8px 16px', border: '1px solid rgba(20,20,40,.08)' }}
        >
          {toggleMutation.isPending
            ? 'Updating...'
            : isAvailable
            ? '● Available On-Duty'
            : '○ Off-Duty (Paused)'}
        </button>
      </div>

      {/* ── Incoming Emergency Dispatches Banner (Action Required) ── */}
      {incomingAlerts.length > 0 && (
        <div className="flex flex-col gap-4">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertOctagon className="w-5 h-5 text-[#DC2626] animate-pulse" />
            <h2 style={{ font: '800 18px Inter', color: '#991B1B' }}>
              Incoming Emergency Alerts ({incomingAlerts.length})
            </h2>
          </div>

          <div className="flex flex-col gap-4">
            {incomingAlerts.map((inc) => {
              const catKey = inc.category || inc.emergency_type || 'medical';
              const catLabel = EMERGENCY_TYPE_LABELS[catKey] || 'Emergency';
              const isCrossSociety = Boolean((inc as any).is_cross_society_preview);
              const takenReason = takenMap[inc.id];

              return (
                <div
                  key={inc.id}
                  className="card"
                  style={{
                    border: '2px solid #F87171',
                    background: '#FEF2F2',
                    padding: '20px 24px',
                    borderRadius: '16px',
                  }}
                >
                  <div className="flex flex-wrap justify-between items-start gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
                          SOS #{inc.id} · {catLabel}
                        </span>
                        <span className="chip bad" style={{ fontWeight: 700 }}>
                          {inc.is_escalated ? 'Escalated Dispatch' : 'Urgent Alert'}
                        </span>
                        {isCrossSociety ? (
                          <span
                            className="chip warn"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                            Neighbouring Society (Privacy Protected)
                          </span>
                        ) : (
                          <span className="chip ok">Same Society</span>
                        )}
                      </div>

                      <div style={{ fontSize: '14px', color: '#5B5B6B', marginTop: '6px' }}>
                        {isCrossSociety ? (
                          <span>
                            Resident: <strong>{inc.reporter?.name || inc.resident_name}</strong> · Flat & Phone unlocked upon accepting.
                          </span>
                        ) : (
                          <span>
                            Resident: <strong>{inc.reporter?.name || inc.resident_name}</strong>
                            {inc.flat_number ? ` · ${inc.flat_number}` : ''}
                            {inc.reporter?.phone ? ` · ${inc.reporter.phone}` : ''}
                          </span>
                        )}
                        <span style={{ marginLeft: '8px', color: '#8E8E9E' }}>
                          · {formatDistanceToNow(inc.created_at)}
                        </span>
                      </div>

                      {inc.description && !isCrossSociety && (
                        <p style={{ font: '500 14px Inter', color: '#1A1A2E', marginTop: '6px' }}>
                          &ldquo;{inc.description}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Accept Action or Claimed State */}
                    <div>
                      {takenReason ? (
                        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600 }}>
                          Claimed: {takenReason}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={acceptMutation.isPending}
                          onClick={() => acceptMutation.mutate(inc.id)}
                          className="btn"
                          style={{
                            background: '#166534',
                            fontSize: '15px',
                            padding: '12px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 12px rgba(22, 101, 52, 0.3)',
                          }}
                        >
                          <CheckCircle className="w-5 h-5" />
                          {acceptMutation.isPending ? 'Claiming...' : 'Accept Emergency'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Embedded Location Map for this incoming dispatch */}
                  {inc.location_available && inc.latitude && inc.longitude && (
                    <div style={{ marginTop: '12px', borderRadius: '12px', overflow: 'hidden' }}>
                      <LocationMap
                        latitude={inc.latitude}
                        longitude={inc.longitude}
                        accuracy={inc.location_accuracy}
                        residentName={inc.reporter?.name || inc.resident_name}
                        residentPhone={isCrossSociety ? undefined : inc.reporter?.phone}
                        height={180}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            ACTIVE ASSIGNMENTS
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
            {activeAssignments.length}
          </div>
        </div>
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            COMPLETED / RESOLVED
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#166534' }}>
            {resolvedCount}
          </div>
        </div>
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            ASSIGNED SOCIETIES
          </div>
          <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
            {availability?.societies?.length ?? 1}
          </div>
        </div>
      </div>

      {/* Filter Tabs for Assigned Incidents */}
      <div className="flex gap-2 flex-wrap">
        {VOLUNTEER_TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setStatusFilter(t.value)}
            className={`cat ${statusFilter === t.value ? 'on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Could not load your volunteer assignments.')}
          onRetry={() => {
            refetchAll();
            refetchAssigned();
          }}
        />
      )}

      {/* Assigned Incidents List */}
      {assignedLoading ? (
        <SkeletonCard count={3} />
      ) : assignedIncidents.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardCheck className="w-5 h-5 text-[#166534]" />}
            title="No assigned incidents right now"
            description="When an emergency is escalated and accepted, it will appear here with resident details and live updates."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {assignedIncidents.map((inc) => {
            const catLabel = EMERGENCY_TYPE_LABELS[inc.category || inc.emergency_type] || 'Emergency';
            return (
              <div
                key={inc.id}
                onClick={() => navigate(`/volunteer/incidents/${inc.id}`)}
                className="card cursor-pointer hover:shadow-md transition-shadow flex flex-wrap justify-between items-center gap-4"
                style={{ padding: '18px 22px' }}
              >
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ font: '800 17px Inter', color: '#1A1A2E' }}>
                      #{inc.id} · {inc.title || `SOS: ${catLabel}`}
                    </span>
                    <span className="chip info">{catLabel}</span>
                    {inc.is_escalated && <span className="chip bad">Escalated</span>}
                  </div>
                  <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    Resident: {inc.reporter?.name || inc.resident_name} · {inc.flat_number || 'Community Unit'} ·{' '}
                    {formatDistanceToNow(inc.created_at)}
                  </div>
                  {inc.description && (
                    <p style={{ font: '500 13px Inter', color: '#1A1A2E', marginTop: '4px' }}>
                      &ldquo;{inc.description}&rdquo;
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {inc.reporter?.phone && (
                    <a
                      href={`tel:${inc.reporter.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ghost"
                      style={{ padding: '7px 12px', fontSize: '12px' }}
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      Call
                    </a>
                  )}
                  <StatusBadge
                    variant={incidentStatusVariant(inc.status)}
                    label={STATUS_LABELS[inc.status] || inc.status}
                  />
                  <span className="btn" style={{ padding: '8px 14px', fontSize: '13px' }}>
                    Open Assignment
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
