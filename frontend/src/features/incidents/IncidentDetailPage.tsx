import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIncident,
  uploadEvidence,
  escalateIncident,
  updateIncidentStatus,
} from '../../api/incidents';
import {
  getIncidentNotifications,
  retryIncidentNotifications,
} from '../../api/notifications';
import { useAuth } from '../auth/AuthContext';
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
  PhoneCall,
  MapPin,
  ExternalLink,
  Upload,
  AlertTriangle,
  RefreshCw,
  UserCheck,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
} from 'lucide-react';

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  const incidentId = Number(id);
  const role = user?.role || 'resident';

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [ackNote, setAckNote] = useState('');

  const {
    data: incident,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => getIncident(incidentId),
    refetchInterval: 6000,
    enabled: Number.isFinite(incidentId) && incidentId > 0,
  });

  const canSeeDeliveryRecords = role === 'resident' || role === 'security' || role === 'admin';
  const canRetryNotifications = role === 'security' || role === 'admin';

  const {
    data: notifications,
    refetch: refetchNotifications,
  } = useQuery({
    queryKey: ['incident-notifications', incidentId],
    queryFn: () => getIncidentNotifications(incidentId),
    refetchInterval: 8000,
    enabled: !!incident && canSeeDeliveryRecords,
  });

  const evidenceMut = useMutation({
    mutationFn: (files: File[]) => uploadEvidence(incidentId, files),
    onSuccess: () => {
      toast.success('Photo evidence uploaded.');
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    },
    onError: (err) => toast.error(mapApiError(err, 'Failed to upload evidence.')),
  });

  const escalateMut = useMutation({
    mutationFn: () => escalateIncident(incidentId, 'Escalated for immediate review'),
    onSuccess: () => {
      toast.success('Incident escalated to society administration.');
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not escalate incident.')),
  });

  const retryMut = useMutation({
    mutationFn: () => retryIncidentNotifications(incidentId),
    onSuccess: (res) => {
      toast.success(
        `Retried ${res.retried} notification(s) (cooldown skipped: ${res.skipped_cooldown}).`
      );
      refetchNotifications();
    },
    onError: (err) => toast.error(mapApiError(err, 'Retry failed.')),
  });

  const securityAckMut = useMutation({
    mutationFn: () => updateIncidentStatus(incidentId, 'ACKNOWLEDGED', ackNote || 'Verified by security'),
    onSuccess: () => {
      toast.success('Incident acknowledged.');
      setAckNote('');
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not acknowledge incident.')),
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
        <button type="button" onClick={() => navigate(-1)} className="ghost self-start">
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <ErrorBanner
          message={mapApiError(error, 'Incident not found or you do not have permission to view it.')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const categoryLabel = EMERGENCY_TYPE_LABELS[incident.category || incident.emergency_type] || 'Emergency';
  const isReporter = user?.id === incident.resident || user?.id === incident.reported_by;
  const canUploadMore = isReporter && incident.status !== 'CLOSED' && (incident.evidence?.length || 0) < 5;

  const eventDotColor = (evType: string) => {
    if (evType === 'created') return '#D9381E';
    if (evType === 'escalated') return '#D92D20';
    if (evType === 'assigned' || evType === 'reassigned') return '#1E40AF';
    return '#166534';
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="ghost mb-3"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Incident #{incident.id}: {incident.title || `SOS: ${categoryLabel}`}
            </h1>
          </div>
          <p style={{ font: '500 14px Inter', color: '#5B5B6B', marginTop: '6px' }}>
            {categoryLabel} · {incident.flat_number || 'Society Resident'} · Reported{' '}
            <span title={format(incident.created_at)}>{formatDistanceToNow(incident.created_at)}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge
            variant={incidentStatusVariant(incident.status)}
            label={STATUS_LABELS[incident.status] || incident.status}
          />
          {!incident.is_escalated && !['RESOLVED', 'CLOSED'].includes(incident.status) && (
            <button
              type="button"
              disabled={!isOnline || escalateMut.isPending}
              title={!isOnline ? 'Unavailable while offline' : 'Escalate to society admin'}
              onClick={() => escalateMut.mutate()}
              className="ghost"
              style={{ borderColor: '#FCA5A5', color: '#991B1B', padding: '7px 12px', fontSize: '12px' }}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {escalateMut.isPending ? 'Escalating...' : 'Escalate'}
            </button>
          )}
        </div>
      </div>

      {/* 6-step Status Stepper */}
      <StatusStepper status={incident.status} isEscalated={incident.is_escalated} />

      {/* Security Quick Acknowledge Bar */}
      {role === 'security' && (incident.status === 'REPORTED' || incident.status === 'ACKNOWLEDGED') && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="sec-ack-note" className="lbl block">
              Security Note ({incident.status === 'REPORTED' ? 'Acknowledge Alert' : 'Add Shift Note'})
            </label>
            <input
              id="sec-ack-note"
              type="text"
              className="fld"
              value={ackNote}
              onChange={(e) => setAckNote(e.target.value)}
              placeholder="e.g. Gate security dispatched to Block A"
            />
          </div>
          <button
            type="button"
            disabled={!isOnline || securityAckMut.isPending || (incident.status === 'ACKNOWLEDGED' && !ackNote.trim())}
            onClick={() => securityAckMut.mutate()}
            className="btn self-end"
          >
            <CheckCircle2 className="w-4 h-4" />
            {incident.status === 'REPORTED' ? 'Acknowledge' : 'Save Security Note'}
          </button>
        </div>
      )}

      {/* Main 2-column content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left column (7 cols): Description + History Timeline + Evidence Gallery */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Incident Description & Reporter */}
          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Incident Details</h2>
            <p style={{ font: '500 14px/1.6 Inter', color: '#1A1A2E' }}>
              {incident.description || 'No additional description was provided.'}
            </p>
            {incident.close_reason && (
              <div
                style={{
                  background: '#DCFCE7',
                  color: '#166534',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  font: '600 13px Inter',
                }}
              >
                Close reason: {incident.close_reason}
              </div>
            )}
            <div
              className="flex flex-wrap items-center justify-between gap-2 pt-3"
              style={{ borderTop: '1px solid #F0F0F4', font: '600 13px Inter', color: '#5B5B6B' }}
            >
              <span>Reporter: {incident.reporter?.name || incident.resident_name}</span>
              {incident.reporter?.phone && (
                <a
                  href={`tel:${incident.reporter.phone}`}
                  className="ghost"
                  style={{ padding: '5px 10px', fontSize: '12px' }}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  {incident.reporter.phone}
                </a>
              )}
            </div>
          </div>

          {/* History Timeline */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>History Timeline</h2>
              <span style={{ font: '600 12px Inter', color: '#5B5B6B' }}>
                {incident.history_summary?.total_events ?? incident.history.length} events
              </span>
            </div>

            {incident.history.length === 0 ? (
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>No timeline entries recorded yet.</p>
            ) : (
              <div className="flex flex-col">
                {incident.history.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className="flex gap-3 py-2.5"
                    style={{
                      borderBottom: idx === incident.history.length - 1 ? 'none' : '1px solid #F0F0F4',
                    }}
                  >
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: eventDotColor(ev.event_type),
                        marginTop: '5px',
                        flexShrink: 0,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                          {ev.note || ev.event_type.replace('_', ' ')}
                        </span>
                        <span
                          title={format(ev.created_at)}
                          style={{ font: '500 12px Inter', color: '#5B5B6B' }}
                        >
                          {format(ev.created_at)}
                        </span>
                      </div>
                      <div style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '2px' }}>
                        By {ev.changed_by_name}
                        {ev.from_status && ev.to_status ? ` · ${ev.from_status} → ${ev.to_status}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence Gallery + Reporter Upload */}
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
                Photo Evidence ({incident.evidence?.length || 0}/5)
              </h2>
              {canUploadMore && (
                <>
                  <input
                    ref={evidenceInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) evidenceMut.mutate(files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={!isOnline || evidenceMut.isPending}
                    title={!isOnline ? 'Unavailable while offline' : undefined}
                    onClick={() => evidenceInputRef.current?.click()}
                    className="ghost"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {evidenceMut.isPending ? 'Uploading...' : 'Add Photo'}
                  </button>
                </>
              )}
            </div>

            {incident.evidence && incident.evidence.length > 0 ? (
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
                        height: '115px',
                        padding: 0,
                        cursor: 'pointer',
                        background: '#F7F7FA',
                      }}
                    >
                      <img
                        src={src}
                        alt={`Incident evidence #${ev.id}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  borderRadius: '12px',
                  background: '#F7F7FA',
                  padding: '16px',
                  font: '500 13px Inter',
                  color: '#5B5B6B',
                }}
                className="flex items-center gap-2"
              >
                <ImageIcon className="w-4 h-4 shrink-0" />
                <span>No photo evidence attached to this incident.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right column (5 cols): Assigned Volunteer + Location + Notification Delivery */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Assigned Volunteer Card */}
          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Assigned Volunteer</h2>
            {incident.assigned_to ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '12px',
                      background: '#FFEDE5',
                      color: '#B93412',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate" style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                      {incident.assigned_to.name}
                    </div>
                    <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                      {incident.assigned_to.phone || 'Verified Society Volunteer'}
                    </div>
                  </div>
                </div>
                {incident.assigned_to.phone && (
                  <a
                    href={`tel:${incident.assigned_to.phone}`}
                    className="btn"
                    style={{ padding: '8px 14px', fontSize: '13px' }}
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Call
                  </a>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm" style={{ color: '#5B5B6B' }}>
                <Clock className="w-4 h-4 shrink-0" />
                <span>Awaiting volunteer assignment by society admin.</span>
              </div>
            )}
          </div>

          {/* Location Card */}
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Location</h2>
              <span className={`chip ${incident.location_available ? 'ok' : 'warn'}`}>
                {incident.location_available ? 'GPS shared' : 'No GPS'}
              </span>
            </div>

            {incident.location_available && incident.latitude && incident.longitude ? (
              <>
                <div
                  style={{
                    borderRadius: '12px',
                    background: '#F7F7FA',
                    padding: '14px',
                    font: '600 13px Inter',
                    color: '#1A1A2E',
                  }}
                  className="flex items-center gap-2.5"
                >
                  <MapPin className="w-4 h-4 shrink-0" style={{ color: '#D9381E' }} />
                  <span>
                    {Number(incident.latitude).toFixed(4)}, {Number(incident.longitude).toFixed(4)}
                    {incident.location_accuracy ? ` · accuracy ${Math.round(incident.location_accuracy)} m` : ''}
                  </span>
                </div>
                <a
                  href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ghost w-full"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Google Maps
                </a>
              </>
            ) : (
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                GPS coordinates were not captured for this incident. Check flat details: {incident.flat_number || 'Society address'}.
              </p>
            )}
          </div>

          {/* Notification Delivery Audit Records */}
          {canSeeDeliveryRecords && (
            <div className="card flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
                  Notification Delivery
                </h2>
                {canRetryNotifications &&
                  notifications?.some((n) => n.delivery_status === 'FAILED') &&
                  !['RESOLVED', 'CLOSED'].includes(incident.status) && (
                    <button
                      type="button"
                      disabled={!isOnline || retryMut.isPending}
                      onClick={() => retryMut.mutate()}
                      className="ghost"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      {retryMut.isPending ? 'Retrying...' : 'Retry Failed'}
                    </button>
                  )}
              </div>

              {!notifications || notifications.length === 0 ? (
                <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                  No delivery records logged yet.
                </p>
              ) : (
                notifications.slice(0, 10).map((n, idx) => (
                  <div
                    key={n.id}
                    className="flex justify-between items-center py-2"
                    style={{
                      borderBottom: idx === Math.min(notifications.length, 10) - 1 ? 'none' : '1px solid #F0F0F4',
                      font: '600 13px Inter',
                      color: '#1A1A2E',
                    }}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate">
                        {n.recipient_name || n.recipient_type} · {n.channel.toUpperCase()}
                      </div>
                      <div style={{ font: '500 11px Inter', color: '#5B5B6B' }}>
                        {n.event_type.replace('_', ' ')}
                      </div>
                    </div>
                    <StatusBadge
                      variant={deliveryStatusVariant(n.delivery_status)}
                      label={n.is_read && n.channel === 'in_app' ? 'Read' : n.delivery_status}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      <Modal
        open={!!lightboxUrl}
        onClose={() => setLightboxUrl(null)}
        title="Evidence Photo"
        size="lg"
      >
        {lightboxUrl && (
          <img
            src={lightboxUrl}
            alt="Incident evidence full view"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '12px' }}
          />
        )}
      </Modal>
    </div>
  );
}
