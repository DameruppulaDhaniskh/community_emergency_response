import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIncident,
  getAvailableVolunteers,
  assignVolunteer,
  updateIncidentStatus,
} from '../../api/incidents';
import {
  getIncidentNotifications,
  retryIncidentNotifications,
} from '../../api/notifications';
import type { IncidentStatus } from '../../api/types';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  EMERGENCY_TYPE_LABELS,
  STATUS_LABELS,
  format,
  formatDistanceToNow,
  mapApiError,
} from '../../lib/formatters';
import StatusStepper from '../../components/StatusStepper';
import StatusBadge, {
  deliveryStatusVariant,
  incidentStatusVariant,
} from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import ErrorBanner from '../../components/ErrorBanner';
import Modal from '../../components/Modal';
import {
  ArrowLeft,
  CheckCircle2,
  UserPlus,
  XCircle,
  PhoneCall,
  MapPin,
  ExternalLink,
  RefreshCw,
  Loader2,
} from 'lucide-react';

// Only valid sequential transitions (excluding Close which has its own dedicated flow)
function validNextStatuses(current: IncidentStatus, hasAssignedVolunteer: boolean): IncidentStatus[] {
  switch (current) {
    case 'REPORTED':
      return hasAssignedVolunteer ? ['ACKNOWLEDGED', 'ASSIGNED'] : ['ACKNOWLEDGED'];
    case 'ACKNOWLEDGED':
      return hasAssignedVolunteer ? ['ASSIGNED'] : [];
    case 'ASSIGNED':
      return ['IN_PROGRESS'];
    case 'IN_PROGRESS':
      return ['RESOLVED'];
    case 'RESOLVED':
      return ['CLOSED'];
    default:
      return [];
  }
}

export default function AdminIncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const incidentId = Number(id);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null);
  const [assignNote, setAssignNote] = useState('');

  const [statusNote, setStatusNote] = useState('');
  const [nextStatusChoice, setNextStatusChoice] = useState<IncidentStatus | ''>('');

  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const {
    data: incident,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => getIncident(incidentId),
    refetchInterval: 8000,
    enabled: Number.isFinite(incidentId) && incidentId > 0,
  });

  const {
    data: volunteers,
    isLoading: volsLoading,
    isError: volsError,
    error: volsErrObj,
    refetch: refetchVols,
  } = useQuery({
    queryKey: ['available-volunteers', incidentId],
    queryFn: () => getAvailableVolunteers(incidentId),
    enabled: assignModalOpen && !!incident,
  });

  const { data: notifications, refetch: refetchNotifications } = useQuery({
    queryKey: ['incident-notifications', incidentId],
    queryFn: () => getIncidentNotifications(incidentId),
    enabled: !!incident,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
    queryClient.invalidateQueries({ queryKey: ['incident-notifications', incidentId] });
  };

  const statusMut = useMutation({
    mutationFn: ({ status, note, reason }: { status: IncidentStatus; note?: string; reason?: string }) =>
      updateIncidentStatus(incidentId, status, note, reason),
    onSuccess: (updated) => {
      toast.success(`Incident moved to ${STATUS_LABELS[updated.status] || updated.status}.`);
      setStatusNote('');
      setNextStatusChoice('');
      setCloseReason('');
      setCloseModalOpen(false);
      invalidateAll();
    },
    onError: (err) => toast.error(mapApiError(err, 'Failed to update incident status.')),
  });

  const assignMut = useMutation({
    mutationFn: ({ volId, note }: { volId: number; note: string }) =>
      assignVolunteer(incidentId, volId, note),
    onSuccess: (updated) => {
      toast.success(`Assigned to ${updated.assigned_to?.name || 'volunteer'}.`);
      setAssignModalOpen(false);
      setSelectedVolId(null);
      setAssignNote('');
      invalidateAll();
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not assign volunteer.')),
  });

  const retryMut = useMutation({
    mutationFn: () => retryIncidentNotifications(incidentId),
    onSuccess: (res) => {
      toast.success(`Retried ${res.retried} notification(s).`);
      refetchNotifications();
    },
    onError: (err) => toast.error(mapApiError(err, 'Retry failed.')),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
        <SkeletonCard count={3} />
      </div>
    );
  }

  if (isError || !incident) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-[1020px] mx-auto">
        <button type="button" onClick={() => navigate('/admin/dashboard')} className="ghost self-start">
          <ArrowLeft className="w-4 h-4" />
          Back to Incident Queue
        </button>
        <ErrorBanner
          message={mapApiError(error, 'Incident not found or not within your administered societies.')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const catLabel = EMERGENCY_TYPE_LABELS[incident.category || incident.emergency_type] || 'Emergency';
  const canAssign = ['REPORTED', 'ACKNOWLEDGED', 'ASSIGNED'].includes(incident.status);
  const validNext = validNextStatuses(incident.status, !!incident.assigned_to);
  const isClosed = incident.status === 'CLOSED';

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/dashboard')}
            className="ghost mb-3"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Queue
          </button>
          <h1 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Incident #{incident.id}: {incident.title || `SOS: ${catLabel}`}
          </h1>
          <p style={{ font: '500 14px Inter', color: '#5B5B6B', marginTop: '6px' }}>
            {catLabel} · {incident.flat_number || 'Society Resident'} ·{' '}
            <span title={format(incident.created_at)}>{formatDistanceToNow(incident.created_at)}</span>
          </p>
        </div>

        <StatusBadge
          variant={incidentStatusVariant(incident.status)}
          label={STATUS_LABELS[incident.status] || incident.status}
        />
      </div>

      {/* Status Stepper */}
      <StatusStepper status={incident.status} isEscalated={incident.is_escalated} />

      {/* Admin Controls Bar */}
      <div className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Admin Actions</h2>
            <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
              {isClosed
                ? `This incident is CLOSED (${incident.close_reason || 'Resolved'}) and read-only.`
                : 'Manage triage, volunteer dispatch, lifecycle status, and closure.'}
            </p>
          </div>

          {!isClosed && (
            <div className="flex flex-wrap gap-2">
              {incident.status === 'REPORTED' && (
                <button
                  type="button"
                  disabled={!isOnline || statusMut.isPending}
                  title={!isOnline ? 'Unavailable while offline' : undefined}
                  onClick={() => statusMut.mutate({ status: 'ACKNOWLEDGED', note: 'Acknowledged by admin' })}
                  className="ghost"
                  style={{ borderColor: '#1E40AF', color: '#1E40AF' }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Acknowledge
                </button>
              )}

              {canAssign && (
                <button
                  type="button"
                  disabled={!isOnline}
                  title={!isOnline ? 'Unavailable while offline' : undefined}
                  onClick={() => {
                    setSelectedVolId(incident.assigned_to?.id || null);
                    setAssignModalOpen(true);
                  }}
                  className="btn"
                  style={{ padding: '10px 16px' }}
                >
                  <UserPlus className="w-4 h-4" />
                  {incident.assigned_to ? 'Reassign Volunteer' : 'Assign Volunteer'}
                </button>
              )}

              <button
                type="button"
                disabled={!isOnline}
                title={!isOnline ? 'Unavailable while offline' : undefined}
                onClick={() => setCloseModalOpen(true)}
                className="ghost"
                style={{ borderColor: '#FCA5A5', color: '#991B1B' }}
              >
                <XCircle className="w-4 h-4" />
                Close Incident
              </button>
            </div>
          )}
        </div>

        {/* Valid Next Status Transition Selector */}
        {!isClosed && validNext.length > 0 && (
          <div
            className="flex flex-wrap items-end gap-3 pt-3"
            style={{ borderTop: '1px solid #F0F0F4' }}
          >
            <div className="min-w-[180px]">
              <label htmlFor="admin-next-status" className="lbl block">
                Advance Status
              </label>
              <select
                id="admin-next-status"
                className="fld"
                value={nextStatusChoice}
                onChange={(e) => setNextStatusChoice(e.target.value as IncidentStatus | '')}
              >
                <option value="">Select valid next status...</option>
                {validNext.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label htmlFor="admin-status-note" className="lbl block">
                Transition Note (optional)
              </label>
              <input
                id="admin-status-note"
                type="text"
                className="fld"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Reason or instructions..."
              />
            </div>

            <button
              type="button"
              disabled={!isOnline || !nextStatusChoice || statusMut.isPending}
              onClick={() => {
                if (nextStatusChoice === 'CLOSED') {
                  setCloseReason(statusNote || 'Resolved and closed');
                  setCloseModalOpen(true);
                } else if (nextStatusChoice) {
                  statusMut.mutate({ status: nextStatusChoice, note: statusNote });
                }
              }}
              className="btn"
              style={{ padding: '12px 18px' }}
            >
              {statusMut.isPending ? 'Updating...' : 'Update Status'}
            </button>
          </div>
        )}
      </div>

      {/* Main Details & History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 flex flex-col gap-5">
          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Details &amp; Reporter</h2>
            <p style={{ font: '500 14px/1.6 Inter', color: '#1A1A2E' }}>
              {incident.description || 'No description provided.'}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3" style={{ borderTop: '1px solid #F0F0F4' }}>
              <span style={{ font: '600 13px Inter', color: '#5B5B6B' }}>
                Reported by {incident.reporter?.name || incident.resident_name}
              </span>
              {incident.reporter?.phone && (
                <a href={`tel:${incident.reporter.phone}`} className="ghost" style={{ padding: '5px 10px', fontSize: '12px' }}>
                  <PhoneCall className="w-3.5 h-3.5" />
                  {incident.reporter.phone}
                </a>
              )}
            </div>
          </div>

          <div className="card">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E', marginBottom: '10px' }}>
              Full Audit History ({incident.history.length})
            </h2>
            <div className="flex flex-col">
              {incident.history.map((ev, idx) => (
                <div
                  key={ev.id}
                  className="flex gap-3 py-2.5"
                  style={{ borderBottom: idx === incident.history.length - 1 ? 'none' : '1px solid #F0F0F4' }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: ev.event_type === 'created' ? '#D9381E' : ev.event_type === 'assigned' || ev.event_type === 'reassigned' ? '#1E40AF' : '#166534',
                      marginTop: '5px',
                      flexShrink: 0,
                    }}
                  />
                  <div className="flex-1">
                    <div className="flex justify-between gap-2 flex-wrap">
                      <span style={{ font: '700 14px Inter', color: '#1A1A2E' }}>{ev.note || ev.event_type}</span>
                      <span style={{ font: '500 12px Inter', color: '#5B5B6B' }}>{format(ev.created_at)}</span>
                    </div>
                    <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                      By {ev.changed_by_name}
                      {ev.from_status && ev.to_status ? ` · ${ev.from_status} → ${ev.to_status}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {incident.evidence && incident.evidence.length > 0 && (
            <div className="card">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E', marginBottom: '10px' }}>
                Uploaded Evidence ({incident.evidence.length})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {incident.evidence.map((ev) => {
                  const src = ev.image_url || ev.url || ev.image;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setLightboxUrl(src)}
                      style={{
                        borderRadius: '12px',
                        overflow: 'hidden',
                        border: '1px solid #ECECF1',
                        height: '110px',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <img src={src} alt="Evidence" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="card flex flex-col gap-2">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Assigned Volunteer</h2>
            {incident.assigned_to ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>{incident.assigned_to.name}</div>
                  <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>{incident.assigned_to.phone}</div>
                </div>
                {incident.assigned_to.phone && (
                  <a href={`tel:${incident.assigned_to.phone}`} className="ghost" style={{ padding: '6px 12px', fontSize: '12px' }}>
                    <PhoneCall className="w-3.5 h-3.5" />
                    Call
                  </a>
                )}
              </div>
            ) : (
              <p style={{ font: '500 13px Inter', color: '#92400E' }}>
                Not yet assigned to a volunteer.
              </p>
            )}
          </div>

          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Location</h2>
            {incident.location_available && incident.latitude && incident.longitude ? (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="w-4 h-4 text-[#D9381E]" />
                  <span>
                    {Number(incident.latitude).toFixed(4)}, {Number(incident.longitude).toFixed(4)}
                  </span>
                </div>
                <a
                  href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ghost"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Google Maps
                </a>
              </>
            ) : (
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>Location coordinates not provided.</p>
            )}
          </div>

          <div className="card flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Notification Delivery</h2>
              {notifications?.some((n) => n.delivery_status === 'FAILED') && !isClosed && (
                <button
                  type="button"
                  disabled={!isOnline || retryMut.isPending}
                  onClick={() => retryMut.mutate()}
                  className="ghost"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry Failed
                </button>
              )}
            </div>
            {!notifications || notifications.length === 0 ? (
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>No delivery records.</p>
            ) : (
              notifications.slice(0, 10).map((n, idx) => (
                <div
                  key={n.id}
                  className="flex justify-between items-center py-2"
                  style={{ borderBottom: idx === Math.min(notifications.length, 10) - 1 ? 'none' : '1px solid #F0F0F4', fontSize: '13px' }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {n.recipient_name || n.recipient_type} · {n.channel.toUpperCase()}
                  </span>
                  <StatusBadge
                    variant={deliveryStatusVariant(n.delivery_status)}
                    label={n.is_read && n.channel === 'in_app' ? 'Read' : n.delivery_status}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Assign Volunteer Modal */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign Available Volunteer"
        size="md"
      >
        <div className="flex flex-col gap-4">
          {volsLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#5B5B6B]">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading available society volunteers...
            </div>
          ) : volsError ? (
            <ErrorBanner
              message={mapApiError(volsErrObj, 'Could not load available volunteers.')}
              onRetry={() => refetchVols()}
            />
          ) : !volunteers || volunteers.length === 0 ? (
            <p style={{ font: '500 14px Inter', color: '#5B5B6B' }}>
              No active and available volunteers found for this resident&apos;s society.
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {volunteers.map((vol) => {
                const selected = selectedVolId === vol.id;
                return (
                  <button
                    key={vol.id}
                    type="button"
                    onClick={() => setSelectedVolId(vol.id)}
                    style={{
                      border: `1.5px solid ${selected ? '#D9381E' : '#E3E3EA'}`,
                      background: selected ? '#FFEDE5' : '#fff',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    className="flex items-center justify-between gap-3"
                  >
                    <div>
                      <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>{vol.name}</div>
                      <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>{vol.phone || vol.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="chip info">{vol.open_assignments_count} active</span>
                      <span className={`chip ${vol.is_available ? 'ok' : 'warn'}`}>
                        {vol.is_available ? 'Available' : 'Off-duty'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <label htmlFor="assign-note" className="lbl block">
              Dispatch Instructions (optional)
            </label>
            <input
              id="assign-note"
              type="text"
              className="fld"
              value={assignNote}
              onChange={(e) => setAssignNote(e.target.value)}
              placeholder="e.g. Bring first-aid kit to Block A flat 101"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAssignModalOpen(false)} className="ghost">
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedVolId || assignMut.isPending || !isOnline}
              onClick={() => selectedVolId && assignMut.mutate({ volId: selectedVolId, note: assignNote })}
              className="btn"
            >
              {assignMut.isPending ? 'Assigning...' : 'Confirm Assignment'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Close Incident Modal */}
      <Modal
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        title="Close Incident"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
            Closed incidents become read-only. Please enter a clear closure reason for the audit log.
          </p>
          <div>
            <label htmlFor="close-reason-input" className="lbl block">
              Close Reason *
            </label>
            <textarea
              id="close-reason-input"
              className="fld"
              rows={3}
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="e.g. Incident verified resolved and documented"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCloseModalOpen(false)} className="ghost">
              Cancel
            </button>
            <button
              type="button"
              disabled={statusMut.isPending || (!closeReason.trim() && incident.status !== 'RESOLVED')}
              onClick={() =>
                statusMut.mutate({
                  status: 'CLOSED',
                  reason: closeReason.trim() || 'Resolved and closed',
                })
              }
              className="btn"
            >
              {statusMut.isPending ? 'Closing...' : 'Confirm Close'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!lightboxUrl} onClose={() => setLightboxUrl(null)} title="Evidence Photo" size="lg">
        {lightboxUrl && (
          <img
            src={lightboxUrl}
            alt="Evidence preview"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '12px' }}
          />
        )}
      </Modal>
    </div>
  );
}

