import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSecurityIncidents,
  securityAckIncident,
  updateIncidentStatus,
} from '../../api/incidents';
import { getSecurityDuty, setSecurityDuty } from '../../api/society';
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
import { LocationMap } from '../../components/LocationMap';
import {
  ShieldAlert,
  ShieldCheck,
  PhoneCall,
  CheckCircle2,
  ExternalLink,
  Clock,
  MapPin,
  Check,
  AlertCircle,
  Radio,
} from 'lucide-react';

export default function SecurityAlertsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'URGENT' | 'ALL' | 'RESOLVED'>('URGENT');

  // Duty status query & mutation
  const { data: dutyStatus } = useQuery({
    queryKey: ['security', 'duty'],
    queryFn: getSecurityDuty,
    refetchInterval: 12000,
  });

  const dutyMutation = useMutation({
    mutationFn: (onDuty: boolean) => setSecurityDuty(onDuty),
    onSuccess: (data) => {
      queryClient.setQueryData(['security', 'duty'], data);
      toast.success(data.on_duty ? 'Duty status set to: ON DUTY' : 'Duty status set to: OFF DUTY');
      queryClient.invalidateQueries({ queryKey: ['security-incidents'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to update duty status.');
    },
  });

  // Security Incidents
  const {
    data: incidents,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['security-incidents'],
    queryFn: getSecurityIncidents,
    refetchInterval: 5000,
  });

  // Acknowledge SOS mutation ("Acknowledge, I'm going")
  const ackMutation = useMutation({
    mutationFn: (id: number) => securityAckIncident(id),
    onSuccess: (updated) => {
      toast.success(`Emergency #${updated.id} acknowledged! Dispatch status broadcast.`);
      queryClient.invalidateQueries({ queryKey: ['security-incidents'] });
    },
    onError: (err: any) => {
      toast.error(mapApiError(err, 'Failed to acknowledge emergency.'));
    },
  });

  // Mark resolved mutation
  const resolveMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      updateIncidentStatus(id, 'RESOLVED', note),
    onSuccess: (res) => {
      toast.success(`Incident #${res.id} marked as resolved.`);
      queryClient.invalidateQueries({ queryKey: ['security-incidents'] });
    },
    onError: (err: any) => {
      toast.error(mapApiError(err, 'Failed to resolve incident.'));
    },
  });

  const allList = incidents || [];
  const urgentList = allList.filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status));
  const resolvedList = allList.filter((i) => ['RESOLVED', 'CLOSED'].includes(i.status));

  const displayList = filter === 'URGENT' ? urgentList : filter === 'RESOLVED' ? resolvedList : allList;
  const isOnDuty = !!dutyStatus?.on_duty;

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto pb-12">
      {/* Top Banner / On-Duty Status Card */}
      <div
        className="card"
        style={{
          padding: '22px 24px',
          background: isOnDuty
            ? 'linear-gradient(135deg, #F0FDF4 0%, #FFFFFF 100%)'
            : 'linear-gradient(135deg, #FEF2F2 0%, #FFFFFF 100%)',
          border: `1.5px solid ${isOnDuty ? '#86EFAC' : '#FCA5A5'}`,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '14px',
                background: isOnDuty ? '#DCFCE7' : '#FEE2E2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isOnDuty ? '#166534' : '#DC2626',
              }}
            >
              <Radio className={`w-6 h-6 ${isOnDuty ? 'animate-pulse' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 style={{ font: '800 22px Inter', color: '#1A1A2E', letterSpacing: '-0.02em' }}>
                  Security Operations Desk
                </h1>
                <span className={`chip ${isOnDuty ? 'ok' : 'bad'}`} style={{ fontWeight: 800 }}>
                  {isOnDuty ? 'ON DUTY' : 'OFF DUTY'}
                </span>
              </div>
              <p style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '3px' }}>
                {dutyStatus?.society_name
                  ? `${dutyStatus.society_name} ${dutyStatus.post_label ? `· ${dutyStatus.post_label}` : ''}`
                  : 'Assigned Gate Station'}
                {' · '}
                {isOnDuty
                  ? 'Active and receiving emergency dispatches'
                  : 'Off duty — automated escalations bypass this station'}
              </p>
            </div>
          </div>

          {/* Toggle Switch */}
          <div className="flex items-center gap-3">
            <span style={{ font: '700 13px Inter', color: isOnDuty ? '#166534' : '#5B5B6B' }}>
              {isOnDuty ? 'Currently On Duty' : 'Go On Duty'}
            </span>
            <label
              style={{
                position: 'relative',
                display: 'inline-block',
                width: '52px',
                height: '28px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isOnDuty}
                disabled={dutyMutation.isPending || !isOnline}
                onChange={(e) => dutyMutation.mutate(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: isOnDuty ? '#16A34A' : '#CBD5E1',
                  transition: '.25s',
                  borderRadius: '28px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    height: '22px',
                    width: '22px',
                    left: isOnDuty ? '26px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.25s',
                    borderRadius: '50%',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                />
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Off-duty notice */}
      {!isOnDuty && (
        <div
          className="card"
          style={{
            padding: '14px 20px',
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <AlertCircle className="w-5 h-5 text-[#D97706] shrink-0" />
          <div style={{ font: '500 13px Inter', color: '#92400E' }}>
            <strong>You are currently marked OFF DUTY.</strong> You can view society incidents below,
            but automated escalation alerts will not target your station until you toggle On Duty.
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            URGENT / ACTIVE ALERTS
          </div>
          <div style={{ font: '800 32px Inter', marginTop: '6px', color: '#D92D20' }}>
            {urgentList.length}
          </div>
        </div>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            RESOLVED / CLOSED
          </div>
          <div style={{ font: '800 32px Inter', marginTop: '6px', color: '#166534' }}>
            {resolvedList.length}
          </div>
        </div>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
            TOTAL RECORDED
          </div>
          <div style={{ font: '800 32px Inter', marginTop: '6px', color: '#1A1A2E' }}>
            {allList.length}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFilter('URGENT')}
            className={`cat ${filter === 'URGENT' ? 'on' : ''}`}
          >
            🚨 Urgent &amp; Active ({urgentList.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`cat ${filter === 'ALL' ? 'on' : ''}`}
          >
            All Society Incidents ({allList.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('RESOLVED')}
            className={`cat ${filter === 'RESOLVED' ? 'on' : ''}`}
          >
            Resolved ({resolvedList.length})
          </button>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Could not load society emergency incidents.')}
          onRetry={() => refetch()}
        />
      )}

      {/* Incidents List */}
      {isLoading ? (
        <SkeletonCard count={3} />
      ) : displayList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ShieldCheck className="w-8 h-8 text-[#166534]" />}
            title="All clear in your community"
            description={
              filter === 'URGENT'
                ? 'No active emergencies pending response in your society.'
                : 'No incidents match the selected filter.'
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {displayList.map((inc) => {
            const isUnacknowledged =
              inc.status === 'REPORTED' ||
              (!inc.acknowledged_at && !['RESOLVED', 'CLOSED'].includes(inc.status));
            const catLabel = EMERGENCY_TYPE_LABELS[inc.category || inc.emergency_type] || 'Emergency';
            const residentPhone = inc.reporter?.phone || (inc as any).resident_phone;
            const residentName = inc.reporter?.name || inc.resident_name || 'Resident';
            const flatInfo = inc.flat_number
              ? inc.block_name
                ? `Block ${inc.block_name}, Flat ${inc.flat_number}`
                : `Flat ${inc.flat_number}`
              : 'Community Area';

            const hasCoords = inc.latitude != null && inc.longitude != null;
            const googleMapsUrl = hasCoords
              ? `https://www.google.com/maps/search/?api=1&query=${inc.latitude},${inc.longitude}`
              : null;

            return (
              <div
                key={inc.id}
                className="card"
                style={{
                  padding: '24px 26px',
                  borderRadius: '20px',
                  background: isUnacknowledged ? '#FFF7F5' : '#FFFFFF',
                  border: isUnacknowledged ? '2px solid #D9381E' : '1px solid #ECECF1',
                  boxShadow: isUnacknowledged ? '0 6px 20px rgba(217, 56, 30, 0.12)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px',
                }}
              >
                {/* Urgent Header */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isUnacknowledged && (
                        <span
                          className="chip bad"
                          style={{
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#D92D20',
                            color: '#ffffff',
                          }}
                        >
                          <ShieldAlert className="w-4 h-4" />
                          URGENT SOS ALERT
                        </span>
                      )}
                      <span style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
                        #{inc.id} · {inc.title || catLabel}
                      </span>
                      <StatusBadge
                        variant={incidentStatusVariant(inc.status as IncidentStatus)}
                        label={STATUS_LABELS[inc.status] || inc.status}
                      />
                      {inc.is_escalated && (
                        <span className="chip bad" style={{ fontWeight: 700 }}>
                          Auto Escalated
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginTop: '6px',
                        font: '500 13.5px Inter',
                        color: '#5B5B6B',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#8E8E9E]" />
                        Triggered {formatDistanceToNow(inc.created_at)}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1 font-semibold text-[#1A1A2E]">
                        <MapPin className="w-3.5 h-3.5 text-[#D9381E]" />
                        {flatInfo}
                      </span>
                    </div>
                  </div>

                  {/* Top-right Call Resident Button */}
                  {residentPhone && (
                    <a
                      href={`tel:${residentPhone}`}
                      className="btn"
                      style={{
                        background: '#166534',
                        color: '#ffffff',
                        padding: '10px 18px',
                        fontSize: '13.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'none',
                        borderRadius: '12px',
                      }}
                    >
                      <PhoneCall className="w-4 h-4" />
                      Call {residentName} ({residentPhone})
                    </a>
                  )}
                </div>

                {/* Resident Details Banner */}
                <div
                  style={{
                    background: '#F9F9FB',
                    borderRadius: '12px',
                    padding: '14px 18px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    border: '1px solid #EAEAEF',
                  }}
                >
                  <div>
                    <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                      Resident: {residentName}
                    </div>
                    <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '2px' }}>
                      Location: {flatInfo} {inc.description ? `— "${inc.description}"` : ''}
                    </div>
                  </div>

                  {googleMapsUrl && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ghost"
                      style={{
                        padding: '6px 14px',
                        fontSize: '12.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open in Google Maps
                    </a>
                  )}
                </div>

                {/* Map View */}
                {hasCoords && (
                  <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #E2E2E8' }}>
                    <LocationMap
                      latitude={inc.latitude}
                      longitude={inc.longitude}
                      accuracy={inc.location_accuracy}
                      residentName={residentName}
                      residentPhone={residentPhone}
                      height={240}
                    />
                  </div>
                )}

                {/* Action Controls */}
                <div
                  className="flex flex-wrap items-center justify-between gap-3"
                  style={{
                    paddingTop: '6px',
                    borderTop: '1px solid #F0F0F4',
                  }}
                >
                  <div className="flex items-center gap-2">
                    {inc.acknowledged_at ? (
                      <span
                        className="chip ok"
                        style={{
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Acknowledged ({formatDistanceToNow(inc.acknowledged_at)})
                      </span>
                    ) : (
                      <span className="chip warn" style={{ fontWeight: 700 }}>
                        Pending Response
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Big Acknowledge Button */}
                    {isUnacknowledged && (
                      <button
                        type="button"
                        disabled={ackMutation.isPending || !isOnline}
                        onClick={() => ackMutation.mutate(inc.id)}
                        className="btn"
                        style={{
                          background: '#D92D20',
                          color: '#ffffff',
                          padding: '12px 24px',
                          fontSize: '14.5px',
                          fontWeight: 800,
                          letterSpacing: '.02em',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          boxShadow: '0 4px 12px rgba(217, 45, 32, 0.3)',
                          borderRadius: '12px',
                        }}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        {ackMutation.isPending ? 'Broadcasting...' : "Acknowledge, I'm going"}
                      </button>
                    )}

                    {/* Resolve button for acknowledged incidents */}
                    {!isUnacknowledged && !['RESOLVED', 'CLOSED'].includes(inc.status) && (
                      <button
                        type="button"
                        disabled={resolveMutation.isPending || !isOnline}
                        onClick={() => {
                          const note = window.prompt(
                            'Enter resolution notes for this emergency:',
                            'Resolved on site by society security.'
                          );
                          if (note) {
                            resolveMutation.mutate({ id: inc.id, note });
                          }
                        }}
                        className="btn"
                        style={{
                          background: '#166534',
                          color: '#ffffff',
                          padding: '10px 18px',
                          fontSize: '13.5px',
                          fontWeight: 700,
                          borderRadius: '12px',
                        }}
                      >
                        Mark Resolved
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => navigate(`/incidents/${inc.id}`)}
                      className="ghost"
                      style={{ padding: '10px 16px', fontSize: '13px' }}
                    >
                      Incident Log &amp; Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
