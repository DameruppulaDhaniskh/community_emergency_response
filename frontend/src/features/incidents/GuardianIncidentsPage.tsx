import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIncidents,
  guardianAcknowledge,
  guardianHandoff,
  getNearbyVolunteers,
  getEscalationDiagnostics,
  type NearbyVolunteerCandidate,
  type EscalationDiagnostics,
} from '../../api/incidents';
import {
  getGuardianIncomingRequests,
  getGuardianDependents,
  acceptGuardianRequest,
  declineGuardianRequest,
} from '../../api/guardianRequests';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type {
  GuardianIncomingRequest,
  GuardianHandoffRequest,
} from '../../api/types';
import {
  CONTACT_TYPE_LABELS,
  EMERGENCY_TYPE_LABELS,
  RELATIONSHIP_LABELS,
  format,
  formatDistanceToNow,
  mapApiError,
} from '../../lib/formatters';
import { SkeletonCard } from '../../components/Skeleton';
import ErrorBanner from '../../components/ErrorBanner';
import LocationMap from '../../components/LocationMap';
import {
  Check,
  PhoneCall,
  ShieldCheck,
  UserPlus,
  X,
  Clock,
  Forward,
  CheckCircle2,
  Users,
  Shield,
  Send,
  Zap,
  Search,
} from 'lucide-react';

export default function GuardianIncidentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  // Handoff modal state
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffReason, setHandoffReason] = useState<'far_away' | 'busy' | 'other'>('far_away');
  const [handoffTargets, setHandoffTargets] = useState<('secondary_guardian' | 'security' | 'volunteers')[]>([
    'secondary_guardian',
    'security',
    'volunteers',
  ]);
  const [handoffNote, setHandoffNote] = useState('');
  const [volunteersSearch, setVolunteersSearch] = useState('');
  const [volunteersRadius, setVolunteersRadius] = useState<number>(3.0);
  const [selectedVolunteerIds, setSelectedVolunteerIds] = useState<number[]>([]);
  const [nearbyCandidates, setNearbyCandidates] = useState<NearbyVolunteerCandidate[]>([]);
  const [handoffDiagnostics, setHandoffDiagnostics] = useState<EscalationDiagnostics | null>(null);
  const [loadingVolunteers, setLoadingVolunteers] = useState(false);

  // ── Queries ──
  const {
    data: incidents,
    isLoading: incidentsLoading,
    isError: incidentsError,
    error: incidentsErrObj,
    refetch: refetchIncidents,
  } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => getIncidents(),
    refetchInterval: 5000,
  });

  const {
    data: requests,
    isLoading: requestsLoading,
    isError: requestsError,
    error: requestsErrObj,
    refetch: refetchRequests,
  } = useQuery({
    queryKey: ['guardian-incoming-requests', 'pending'],
    queryFn: () => getGuardianIncomingRequests('pending'),
    refetchInterval: 8000,
  });

  const {
    data: dependents,
    isLoading: dependentsLoading,
    isError: dependentsError,
    error: dependentsErrObj,
    refetch: refetchDependents,
  } = useQuery({
    queryKey: ['guardian-dependents'],
    queryFn: getGuardianDependents,
    refetchInterval: 8000,
  });

  const invalidateGuardianQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['guardian-incoming-requests'] });
    queryClient.invalidateQueries({ queryKey: ['guardian-dependents'] });
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  // ── Guardian Request Acceptance / Decline ──
  const acceptMutation = useMutation({
    mutationFn: acceptGuardianRequest,
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: ['guardian-incoming-requests', 'pending'] });
      const prev = queryClient.getQueryData<GuardianIncomingRequest[]>(['guardian-incoming-requests', 'pending']);
      queryClient.setQueryData<GuardianIncomingRequest[]>(
        ['guardian-incoming-requests', 'pending'],
        (old) => (old || []).filter((r) => r.id !== requestId)
      );
      return { prev };
    },
    onSuccess: (updated) => {
      invalidateGuardianQueries();
      toast.success(`Accepted guardian request from ${updated.resident_name}`);
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['guardian-incoming-requests', 'pending'], ctx.prev);
      }
      toast.error(mapApiError(err, 'Could not accept guardian request.'));
    },
  });

  const declineMutation = useMutation({
    mutationFn: declineGuardianRequest,
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: ['guardian-incoming-requests', 'pending'] });
      const prev = queryClient.getQueryData<GuardianIncomingRequest[]>(['guardian-incoming-requests', 'pending']);
      queryClient.setQueryData<GuardianIncomingRequest[]>(
        ['guardian-incoming-requests', 'pending'],
        (old) => (old || []).filter((r) => r.id !== requestId)
      );
      return { prev };
    },
    onSuccess: (declined) => {
      invalidateGuardianQueries();
      toast.info(`Declined request from ${declined.resident_name}`);
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['guardian-incoming-requests', 'pending'], ctx.prev);
      }
      toast.error(mapApiError(err, 'Could not decline guardian request.'));
    },
  });

  // ── Guardian Actions: Acknowledge & Handoff ──
  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => guardianAcknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success("You are marked as responding. Auto-escalation is paused.");
    },
    onError: (err: any) => {
      toast.error(mapApiError(err, "Failed to record response."));
    },
  });

  const handoffMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: GuardianHandoffRequest }) =>
      guardianHandoff(id, payload),
    onSuccess: () => {
      setHandoffOpen(false);
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success("Alert passed on to selected responders.");
    },
    onError: (err: any) => {
      toast.error(mapApiError(err, "Failed to pass on alert."));
    },
  });

  const allIncidents = incidents || [];
  const activeAlert = allIncidents.find((i) => !['RESOLVED', 'CLOSED'].includes(i.status));
  const latestIncident = activeAlert || allIncidents[0];

  const residentName = latestIncident?.reporter?.name || latestIncident?.resident_name || 'Protected Resident';
  const residentFirstName = residentName.split(' ')[0] || 'Resident';
  const catKey = latestIncident ? latestIncident.category || latestIncident.emergency_type : 'medical';
  const categoryStr = EMERGENCY_TYPE_LABELS[catKey] || 'Emergency';
  const locationStr = latestIncident?.flat_number || 'Community Residence';
  const residentPhone = latestIncident?.reporter?.phone || '';
  const alertDescription = latestIncident?.description
    ? `“${latestIncident.description}”`
    : latestIncident
    ? latestIncident.title
    : 'All verified residents are currently safe.';

  const pendingList = requests || [];
  const dependentsList = dependents || [];

  // ── Countdown timer for auto-escalation ──
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!activeAlert?.escalate_at || activeAlert.is_escalated || activeAlert.guardian_acknowledged_at) {
      setCountdownSeconds(null);
      return;
    }

    const compute = () => {
      const now = Date.now();
      const target = new Date(activeAlert.escalate_at!).getTime();
      const diff = Math.max(0, Math.floor((target - now) / 1000));
      setCountdownSeconds(diff);
      if (diff === 0) {
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
      }
    };

    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [activeAlert?.escalate_at, activeAlert?.is_escalated, activeAlert?.guardian_acknowledged_at, queryClient]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const loadVolunteers = (incidentId: number, q: string, radius: number) => {
    setLoadingVolunteers(true);
    getNearbyVolunteers(incidentId, { q, radius_km: radius })
      .then(setNearbyCandidates)
      .catch((e) => console.error('Failed to load nearby volunteers', e))
      .finally(() => setLoadingVolunteers(false));
  };

  const handleOpenHandoffModal = () => {
    if (activeAlert?.handoff_defaults && activeAlert.handoff_defaults.length > 0) {
      setHandoffTargets(activeAlert.handoff_defaults as any);
    } else {
      setHandoffTargets(['secondary_guardian', 'security', 'volunteers']);
    }
    setHandoffReason('far_away');
    setHandoffNote('');
    setSelectedVolunteerIds([]);
    setVolunteersSearch('');
    setVolunteersRadius(3.0);
    setHandoffOpen(true);

    if (activeAlert?.id) {
      getEscalationDiagnostics(activeAlert.id)
        .then(setHandoffDiagnostics)
        .catch((e) => console.error('Failed to load diagnostics', e));
      loadVolunteers(activeAlert.id, '', 3.0);
    }
  };

  const toggleTarget = (target: 'secondary_guardian' | 'security' | 'volunteers') => {
    if (handoffTargets.includes(target)) {
      if (handoffTargets.length === 1) {
        toast.info('Select at least one escalation target.');
        return;
      }
      setHandoffTargets(handoffTargets.filter((t) => t !== target));
    } else {
      setHandoffTargets([...handoffTargets, target]);
    }
  };

  const handleCall = () => {
    if (residentPhone) {
      window.location.href = `tel:${residentPhone.replace(/\s+/g, '')}`;
    } else if (latestIncident) {
      navigate(`/incidents/${latestIncident.id}`);
    }
  };

  const isAcknowledgedByMe = Boolean(activeAlert?.guardian_acknowledged_at);

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto pb-10">
      {incidentsError && (
        <ErrorBanner
          message={mapApiError(incidentsErrObj, 'Failed to load dependent alerts.')}
          onRetry={() => refetchIncidents()}
        />
      )}

      {/* Top Requests Card (Pending invitations from residents) */}
      <div className="card" style={{ padding: '20px 22px' }}>
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-[#B93412]" />
            <h2 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
              Guardian Requests
            </h2>
            {pendingList.length > 0 && (
              <span className="chip bad">{pendingList.length} pending</span>
            )}
          </div>
          {user && (
            <span style={{ font: '600 12px Inter', color: '#5B5B6B' }}>
              Share handle: <strong style={{ color: '#1A1A2E' }}>@{user.username}</strong>
            </span>
          )}
        </div>

        {requestsError ? (
          <ErrorBanner
            message={mapApiError(requestsErrObj, 'Could not load guardian requests.')}
            onRetry={() => refetchRequests()}
          />
        ) : requestsLoading ? (
          <SkeletonCard count={1} />
        ) : pendingList.length === 0 ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 py-2"
            style={{ font: '500 13.5px Inter', color: '#5B5B6B' }}
          >
            <span>No pending guardian invitations right now.</span>
            <span style={{ font: '600 12px Inter', color: '#717184' }}>
              Residents add you via @{user?.username} or {user?.phone}.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingList.map((req, idx) => (
              <div
                key={req.id}
                className="flex flex-wrap justify-between items-center gap-3 py-3"
                style={{
                  borderBottom: idx === pendingList.length - 1 ? 'none' : '1px solid #F0F0F4',
                }}
              >
                <div className="min-w-0">
                  <div style={{ font: '800 15px Inter', color: '#1A1A2E' }}>
                    {req.resident_name}{' '}
                    <span style={{ font: '600 13px Inter', color: '#5B5B6B' }}>
                      ({req.flat}{req.block ? `, Block ${req.block}` : ''}{req.society ? ` · ${req.society}` : ''})
                    </span>
                  </div>
                  <div style={{ font: '500 12.5px Inter', color: '#5B5B6B', marginTop: '3px' }}>
                    {CONTACT_TYPE_LABELS[req.contact_type]} · {RELATIONSHIP_LABELS[req.relationship] || req.relationship}
                    {req.resident_phone ? ` · ${req.resident_phone}` : ''} · {formatDistanceToNow(req.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!isOnline || acceptMutation.isPending || declineMutation.isPending}
                    onClick={() => acceptMutation.mutate(req.id)}
                    className="btn"
                    style={{ padding: '8px 16px', fontSize: '13px' }}
                  >
                    <Check className="w-4 h-4" />
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={!isOnline || acceptMutation.isPending || declineMutation.isPending}
                    onClick={() => declineMutation.mutate(req.id)}
                    className="ghost"
                    style={{ padding: '8px 14px', fontSize: '13px', color: '#991B1B', borderColor: '#FCA5A5' }}
                  >
                    <X className="w-4 h-4" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hero Alert Banner */}
      <div
        style={{
          borderRadius: '24px',
          background: activeAlert
            ? 'linear-gradient(120deg, #B42318, #7A1E10)'
            : 'linear-gradient(120deg, #C2330F, #8E1D0B)',
          color: '#fff',
          padding: '26px 30px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: '280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              className="chip"
              style={{
                background: '#fff',
                color: '#B42318',
                fontWeight: 700,
                display: 'inline-block',
              }}
            >
              {activeAlert
                ? `ACTIVE ${activeAlert.status} · ${formatDistanceToNow(activeAlert.created_at)}`
                : 'ALL RESIDENTS SAFE'}
            </span>

            {/* Auto-escalation countdown pill */}
            {countdownSeconds !== null && (
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.25)',
                  color: '#FFFFFF',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Clock className="w-3.5 h-3.5" />
                Escalates in {formatTimer(countdownSeconds)}
              </span>
            )}

            {/* Acknowledged Badge */}
            {isAcknowledgedByMe && (
              <span
                style={{
                  background: '#DCFCE7',
                  color: '#166534',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Responding
              </span>
            )}

            {/* Escalated state badge */}
            {activeAlert?.is_escalated && (
              <span
                style={{
                  background: '#FEF08A',
                  color: '#854D0E',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Zap className="w-3.5 h-3.5" />
                {activeAlert.escalation_trigger === 'guardian_handoff' ? 'Passed on to responders' : 'Auto-escalated'}
              </span>
            )}
          </div>

          <h1 style={{ font: '800 32px Inter', marginTop: '10px', color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {activeAlert ? `${residentName} needs help` : 'Guardian Protection Active'}
          </h1>
          <p style={{ font: '600 15px Inter', marginTop: '6px', color: '#fff' }}>
            {latestIncident
              ? `${categoryStr} · ${locationStr}`
              : dependentsList.length > 0
              ? `Protecting ${dependentsList.length} verified resident${dependentsList.length > 1 ? 's' : ''}`
              : 'Accept a guardian request above to monitor residents'}
          </p>
          <p style={{ font: '500 14px Inter', marginTop: '6px', opacity: 0.95, color: '#fff' }}>
            {alertDescription}
          </p>

          {/* Delivery & Escalation badges */}
          {activeAlert?.escalation && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {activeAlert.escalation.targets.includes('secondary_guardian') && (
                <span style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', color: '#fff', fontWeight: 600 }}>
                  ✓ Secondary Guardian alerted
                </span>
              )}
              {activeAlert.escalation.targets.includes('security') && (
                <span style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', color: '#fff', fontWeight: 600 }}>
                  ✓ Security Guard alerted
                </span>
              )}
              {activeAlert.escalation.targets.includes('volunteers') && (
                <span style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', color: '#fff', fontWeight: 600 }}>
                  ✓ {activeAlert.escalation.target_counts?.volunteers || ''} Volunteers dispatched
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 'none', minWidth: '180px' }}>
          {residentPhone && (
            <button
              type="button"
              onClick={handleCall}
              style={{
                border: 0,
                borderRadius: '12px',
                padding: '12px 20px',
                background: '#fff',
                color: '#B42318',
                font: '800 14px Inter',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <PhoneCall className="w-4 h-4" />
              Call {residentFirstName}
            </button>
          )}

          {activeAlert && !isAcknowledgedByMe && (
            <button
              type="button"
              disabled={acknowledgeMutation.isPending}
              onClick={() => acknowledgeMutation.mutate(activeAlert.id)}
              style={{
                border: 0,
                borderRadius: '12px',
                padding: '12px 20px',
                background: '#166534',
                color: '#fff',
                font: '800 14px Inter',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 className="w-4 h-4" />
              {acknowledgeMutation.isPending ? 'Responding...' : "I'm Responding"}
            </button>
          )}

          {activeAlert && !activeAlert.is_escalated && (
            <button
              type="button"
              onClick={handleOpenHandoffModal}
              style={{
                border: '2px solid rgba(255,255,255,0.8)',
                borderRadius: '12px',
                padding: '10px 20px',
                background: 'rgba(0,0,0,0.2)',
                color: '#fff',
                font: '700 13px Inter',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Forward className="w-4 h-4" />
              I Can't Help, Pass It On
            </button>
          )}

          {latestIncident && (
            <button
              type="button"
              onClick={() => navigate(`/incidents/${latestIncident.id}`)}
              style={{
                border: '1px solid rgba(255,255,255,0.5)',
                borderRadius: '12px',
                padding: '8px 16px',
                background: 'transparent',
                color: '#fff',
                font: '600 12px Inter',
                cursor: 'pointer',
              }}
            >
              Open Incident #{latestIncident.id}
            </button>
          )}
        </div>
      </div>

      {incidentsLoading || dependentsLoading ? (
        <SkeletonCard count={2} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: My Residents & Live Timeline */}
          <div className="lg:col-span-6 flex flex-col gap-5">
            {/* My Residents */}
            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>My Residents</h3>
                <ShieldCheck className="w-4 h-4 text-[#166534]" />
              </div>

              {dependentsError ? (
                <ErrorBanner
                  message={mapApiError(dependentsErrObj, 'Failed to load residents.')}
                  onRetry={() => refetchDependents()}
                />
              ) : dependentsList.length === 0 ? (
                <p style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '6px' }}>
                  No verified residents linked yet. Once you accept a guardian request, the resident appears here along with live SOS alerts.
                </p>
              ) : (
                dependentsList.map((res, idx) => (
                  <div
                    key={res.id}
                    className="flex flex-wrap justify-between items-center gap-3 py-3"
                    style={{
                      borderBottom: idx === dependentsList.length - 1 ? 'none' : '1px solid #F0F0F4',
                    }}
                  >
                    <div className="min-w-0">
                      <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>{res.name}</div>
                      <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                        {res.flat}{res.society ? ` · ${res.society}` : ''} · {CONTACT_TYPE_LABELS[res.contact_type]}
                      </div>
                      {res.phone && (
                        <div style={{ font: '500 12px Inter', color: '#717184', marginTop: '2px' }}>
                          {res.phone}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {res.phone && (
                        <a
                          href={`tel:${res.phone.replace(/\s+/g, '')}`}
                          className="ghost"
                          style={{ padding: '5px 10px', fontSize: '12px' }}
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          Call
                        </a>
                      )}
                      {res.has_active_incident && res.active_incident_id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/incidents/${res.active_incident_id}`)}
                          className="btn"
                          style={{ padding: '5px 12px', fontSize: '12px', background: '#D92D20' }}
                        >
                          Alert #{res.active_incident_id}
                        </button>
                      ) : (
                        <span className="chip ok">Safe</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Live Timeline */}
            <div className="card">
              <h3 style={{ font: '800 16px Inter', color: '#1A1A2E', marginBottom: '6px' }}>
                Live Status Timeline
              </h3>
              {!latestIncident || latestIncident.history.length === 0 ? (
                <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                  No recent incident updates recorded yet.
                </p>
              ) : (
                latestIncident.history.map((ev) => (
                  <div key={ev.id} style={{ display: 'flex', gap: '12px', padding: '8px 0' }}>
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: ev.event_type === 'created' ? '#D9381E' : '#166534',
                        marginTop: '5px',
                        flex: 'none',
                      }}
                    />
                    <div>
                      <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                        {ev.note || ev.event_type}
                      </div>
                      <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                        {ev.changed_by_name} · {format(ev.created_at)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Embedded Interactive Map */}
          <div className="lg:col-span-6 card flex flex-col gap-3">
            <h3 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
              {activeAlert ? 'Incident GPS Location & Navigation' : 'Latest Incident Location'}
            </h3>

            {latestIncident ? (
              <LocationMap
                latitude={latestIncident.latitude}
                longitude={latestIncident.longitude}
                accuracy={latestIncident.location_accuracy}
                residentName={residentName}
                residentPhone={residentPhone}
                height={320}
              />
            ) : (
              <div
                style={{
                  height: '280px',
                  borderRadius: '14px',
                  background: '#F7F7FA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: '600 13px Inter',
                  color: '#5B5B6B',
                  padding: '16px',
                  textAlign: 'center',
                }}
              >
                GPS coordinates and live map will display here when a verified dependent raises an SOS.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Handoff Modal ("I can't help, pass it on") */}
      {handoffOpen && activeAlert && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20,20,40,0.5)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Forward className="w-5 h-5 text-[#D9381E]" />
                <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                  Pass On Emergency Alert
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setHandoffOpen(false)}
                className="cursor-pointer text-[#5B5B6B] hover:text-[#1A1A2E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p style={{ fontSize: '13.5px', color: '#5B5B6B', lineHeight: '1.4' }}>
              If you are far away or unavailable, pass this SOS immediately to other responders. SafeCircle will dispatch alerts with {residentFirstName}'s location.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handoffMutation.mutate({
                  id: activeAlert.id,
                  payload: {
                    reason: handoffReason,
                    targets: handoffTargets,
                    note: handoffNote.trim() || undefined,
                    volunteer_mode: selectedVolunteerIds.length > 0 ? 'selected' : 'auto',
                    volunteer_ids: selectedVolunteerIds,
                  },
                });
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <label className="lbl">Why can't you respond right now?</label>
                <select
                  className="fld"
                  value={handoffReason}
                  onChange={(e) => setHandoffReason(e.target.value as any)}
                >
                  <option value="far_away">I am far away / cannot reach in time</option>
                  <option value="busy">I am busy / unable to handle right now</option>
                  <option value="other">Other reason</option>
                </select>
              </div>

              <div>
                <label className="lbl">Select Responders to Alert Immediately</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  {/* Secondary Guardian */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      background: '#F9F9FB',
                      borderRadius: '8px',
                      border: '1px solid #E2E2E8',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={handoffTargets.includes('secondary_guardian')}
                        onChange={() => toggleTarget('secondary_guardian')}
                        style={{ accentColor: '#D9381E', width: '16px', height: '16px' }}
                      />
                      <Users className="w-4 h-4 text-[#5B5B6B]" />
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1A1A2E' }}>
                        Secondary Guardian
                      </span>
                    </div>
                    {handoffDiagnostics?.guardians?.secondary?.configured ? (
                      <span className="text-xs text-neutral-500 font-medium">
                        {handoffDiagnostics.guardians.secondary.name} ({handoffDiagnostics.guardians.secondary.verified ? 'Verified' : 'Pending'})
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium italic">
                        Not configured by resident
                      </span>
                    )}
                  </label>

                  {/* Security Guard */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      background: '#F9F9FB',
                      borderRadius: '8px',
                      border: '1px solid #E2E2E8',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={handoffTargets.includes('security')}
                        onChange={() => toggleTarget('security')}
                        style={{ accentColor: '#D9381E', width: '16px', height: '16px' }}
                      />
                      <Shield className="w-4 h-4 text-[#5B5B6B]" />
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1A1A2E' }}>
                        Society &amp; Building Security
                      </span>
                    </div>
                    {handoffDiagnostics?.security?.has_security_guard_configured ||
                    (handoffDiagnostics?.security?.society_security_approved_count ?? 0) > 0 ? (
                      <span className="text-xs text-emerald-700 font-medium">
                        {handoffDiagnostics?.security?.society_security_on_duty_count || 0} on duty
                        {handoffDiagnostics?.security?.resident_guard_count ? ` · ${handoffDiagnostics.security.resident_guard_count} building guards` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium italic">
                        No security guard available
                      </span>
                    )}
                  </label>

                  {/* Volunteers Target Toggle */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      background: '#F9F9FB',
                      borderRadius: '8px',
                      border: '1px solid #E2E2E8',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={handoffTargets.includes('volunteers')}
                        onChange={() => toggleTarget('volunteers')}
                        style={{ accentColor: '#D9381E', width: '16px', height: '16px' }}
                      />
                      <Users className="w-4 h-4 text-[#5B5B6B]" />
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1A1A2E' }}>
                        Nearby Community Volunteers
                      </span>
                    </div>
                    <span className="text-xs text-neutral-500 font-medium">
                      {selectedVolunteerIds.length > 0 ? `${selectedVolunteerIds.length} custom selected` : 'Auto (Block-first)'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Volunteer Search & Selection Panel */}
              {handoffTargets.includes('volunteers') && (
                <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-800">Volunteer Candidates</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-neutral-500">Radius:</span>
                      {[1, 2, 3, 5].map((rad) => (
                        <button
                          key={rad}
                          type="button"
                          onClick={() => {
                            setVolunteersRadius(rad);
                            if (activeAlert?.id) loadVolunteers(activeAlert.id, volunteersSearch, rad);
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition ${
                            volunteersRadius === rad ? 'bg-red-600 text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                          }`}
                        >
                          {rad}km
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Search input */}
                  <div className="relative">
                    <div className="flex items-center rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs shadow-xs focus-within:border-red-500">
                      <Search className="w-3.5 h-3.5 text-neutral-400 mr-1.5 shrink-0" />
                      <input
                        type="text"
                        value={volunteersSearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setVolunteersSearch(val);
                          if (activeAlert?.id) loadVolunteers(activeAlert.id, val, volunteersRadius);
                        }}
                        placeholder="Search volunteers by name, area..."
                        className="w-full text-xs text-neutral-900 bg-transparent focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Quick Select Buttons */}
                  {nearbyCandidates.length > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-neutral-600 pt-0.5">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const nearest3 = nearbyCandidates.slice(0, 3).map((v) => v.id);
                            setSelectedVolunteerIds(nearest3);
                          }}
                          className="font-semibold text-red-600 hover:underline cursor-pointer"
                        >
                          Select nearest 3
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setSelectedVolunteerIds(nearbyCandidates.map((v) => v.id))}
                          className="font-semibold text-red-600 hover:underline cursor-pointer"
                        >
                          Select all ({nearbyCandidates.length})
                        </button>
                      </div>
                      {selectedVolunteerIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedVolunteerIds([])}
                          className="text-neutral-500 hover:text-neutral-800 cursor-pointer"
                        >
                          Reset to auto
                        </button>
                      )}
                    </div>
                  )}

                  {/* Candidates List */}
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                    {loadingVolunteers ? (
                      <div className="py-4 text-center text-xs text-neutral-500">Loading nearby responders...</div>
                    ) : nearbyCandidates.length === 0 ? (
                      <div className="py-4 text-center text-xs text-neutral-500 italic">
                        No approved volunteers found within {volunteersRadius} km.
                        <br />
                        <span className="text-[11px] text-neutral-400">SafeCircle will auto-widen to find available community responders.</span>
                      </div>
                    ) : (
                      nearbyCandidates.map((cand) => {
                        const isChecked = selectedVolunteerIds.includes(cand.id);
                        return (
                          <label
                            key={cand.id}
                            className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition ${
                              isChecked ? 'border-red-500 bg-red-50/60' : 'border-neutral-200 hover:bg-neutral-100/60 bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedVolunteerIds(selectedVolunteerIds.filter((id) => id !== cand.id));
                                  } else {
                                    setSelectedVolunteerIds([...selectedVolunteerIds, cand.id]);
                                  }
                                }}
                                className="w-3.5 h-3.5 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                              />
                              <div>
                                <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                                  <span>{cand.name}</span>
                                  {cand.same_block && (
                                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800">
                                      Same Block
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-neutral-500">
                                  {cand.area_label || cand.society_name}
                                </div>
                              </div>
                            </div>
                            <span className="text-[11px] font-medium text-neutral-600 shrink-0">
                              {cand.distance_km !== null ? `${cand.distance_km} km` : 'Near'}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Note for Responders */}
              <div>
                <label className="lbl">Note for Responders (optional)</label>
                <textarea
                  className="fld"
                  rows={2}
                  placeholder="e.g. Currently in transit, resident might need medical help."
                  value={handoffNote}
                  onChange={(e) => setHandoffNote(e.target.value)}
                />
              </div>

              {/* Dynamic Live Summary Line */}
              <div className="p-2.5 rounded-xl bg-red-50/80 border border-red-200 text-xs text-red-950 font-medium">
                <span className="font-bold">Live Summary: </span>
                Passing alert to{' '}
                {(() => {
                  const parts: string[] = [];
                  if (handoffTargets.includes('secondary_guardian')) {
                    parts.push(
                      handoffDiagnostics?.guardians?.secondary?.name
                        ? `Secondary Guardian (${handoffDiagnostics.guardians.secondary.name})`
                        : 'Secondary Guardian'
                    );
                  }
                  if (handoffTargets.includes('security')) {
                    parts.push('Society Security');
                  }
                  if (handoffTargets.includes('volunteers')) {
                    if (selectedVolunteerIds.length > 0) {
                      parts.push(`${selectedVolunteerIds.length} selected volunteer${selectedVolunteerIds.length > 1 ? 's' : ''}`);
                    } else {
                      parts.push('nearest community volunteers');
                    }
                  }
                  return parts.length > 0 ? parts.join(', ') : 'no responders selected';
                })()}
                .
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setHandoffOpen(false)}
                  className="ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={handoffMutation.isPending || handoffTargets.length === 0}
                  className="btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Send className="w-4 h-4" />
                  {handoffMutation.isPending ? 'Passing Alert...' : 'Pass Alert Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
