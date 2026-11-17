import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getIncident, updateIncidentStatus } from '../../api/incidents';
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
import StatusBadge, { incidentStatusVariant } from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import ErrorBanner from '../../components/ErrorBanner';
import Modal from '../../components/Modal';
import { ArrowLeft, CheckCircle2, ExternalLink, MapPin, PhoneCall, Play } from 'lucide-react';

export default function VolunteerAssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();

  const incidentId = Number(id);
  const [note, setNote] = useState('');
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

  const transitionMut = useMutation({
    mutationFn: (nextStatus: IncidentStatus) => updateIncidentStatus(incidentId, nextStatus, note),
    onSuccess: (updated) => {
      toast.success(
        updated.status === 'IN_PROGRESS'
          ? 'Work started! Status updated to In Progress.'
          : 'Incident marked Resolved! Admin & resident notified.'
      );
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['volunteer-incidents'] });
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not update status.')),
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
        <button type="button" onClick={() => navigate('/volunteer/incidents')} className="ghost self-start">
          <ArrowLeft className="w-4 h-4" />
          Back to My Assignments
        </button>
        <ErrorBanner
          message={mapApiError(error, 'Assignment not found or no longer assigned to you.')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const catLabel = EMERGENCY_TYPE_LABELS[incident.category || incident.emergency_type] || 'Emergency';

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/volunteer/incidents')}
            className="ghost mb-3"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Assignments
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

      <StatusStepper status={incident.status} isEscalated={incident.is_escalated} />

      {/* Volunteer Response Action Card */}
      {(incident.status === 'ASSIGNED' || incident.status === 'IN_PROGRESS') && (
        <div className="card flex flex-col gap-3">
          <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Responder Action</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label htmlFor="vol-action-note" className="lbl block">
                Optional Progress Note
              </label>
              <input
                id="vol-action-note"
                type="text"
                className="fld"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  incident.status === 'ASSIGNED'
                    ? 'e.g. Heading to Block A with first-aid kit'
                    : 'e.g. Resident assisted, hazard secured'
                }
              />
            </div>

            {incident.status === 'ASSIGNED' && (
              <button
                type="button"
                disabled={!isOnline || transitionMut.isPending}
                title={!isOnline ? 'Unavailable while offline' : undefined}
                onClick={() => transitionMut.mutate('IN_PROGRESS')}
                className="btn"
              >
                <Play className="w-4 h-4" />
                {transitionMut.isPending ? 'Starting...' : 'Start Work'}
              </button>
            )}

            {incident.status === 'IN_PROGRESS' && (
              <button
                type="button"
                disabled={!isOnline || transitionMut.isPending}
                title={!isOnline ? 'Unavailable while offline' : undefined}
                onClick={() => transitionMut.mutate('RESOLVED')}
                className="btn"
                style={{ background: '#166534' }}
              >
                <CheckCircle2 className="w-4 h-4" />
                {transitionMut.isPending ? 'Resolving...' : 'Mark Resolved'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 flex flex-col gap-5">
          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Resident &amp; Details</h2>
            <p style={{ font: '500 14px/1.6 Inter', color: '#1A1A2E' }}>
              {incident.description || 'No additional description.'}
            </p>
            <div className="flex items-center justify-between gap-2 pt-3" style={{ borderTop: '1px solid #F0F0F4' }}>
              <span style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                {incident.reporter?.name || incident.resident_name}
              </span>
              {incident.reporter?.phone && (
                <a href={`tel:${incident.reporter.phone}`} className="btn" style={{ padding: '8px 14px', fontSize: '13px' }}>
                  <PhoneCall className="w-3.5 h-3.5" />
                  Call {incident.reporter.phone}
                </a>
              )}
            </div>
          </div>

          <div className="card">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E', marginBottom: '8px' }}>
              Activity History
            </h2>
            {incident.history.map((ev, idx) => (
              <div
                key={ev.id}
                className="flex gap-3 py-2"
                style={{ borderBottom: idx === incident.history.length - 1 ? 'none' : '1px solid #F0F0F4' }}
              >
                <div
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#D9381E',
                    marginTop: '6px',
                    flexShrink: 0,
                  }}
                />
                <div className="flex-1">
                  <div style={{ font: '700 13px Inter', color: '#1A1A2E' }}>{ev.note || ev.event_type}</div>
                  <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                    {ev.changed_by_name} · {format(ev.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-5">
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
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                GPS not captured. Go to {incident.flat_number || 'resident flat'}.
              </p>
            )}
          </div>

          {incident.evidence && incident.evidence.length > 0 && (
            <div className="card">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E', marginBottom: '10px' }}>
                Evidence Photos
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {incident.evidence.map((ev) => {
                  const src = ev.image_url || ev.url || ev.image;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setLightboxUrl(src)}
                      style={{
                        borderRadius: '10px',
                        overflow: 'hidden',
                        border: '1px solid #ECECF1',
                        height: '100px',
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
      </div>

      <Modal open={!!lightboxUrl} onClose={() => setLightboxUrl(null)} title="Evidence Photo" size="lg">
        {lightboxUrl && (
          <img
            src={lightboxUrl}
            alt="Evidence full view"
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '12px' }}
          />
        )}
      </Modal>
    </div>
  );
}

