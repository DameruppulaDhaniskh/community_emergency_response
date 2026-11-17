import { useState, useRef, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createIncident } from '../../api/incidents';
import type { EmergencyType } from '../../api/types';
import { mapApiError } from '../../lib/formatters';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  MapPin,
  Upload,
  X,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';

const CATEGORIES: Array<{ value: EmergencyType; label: string }> = [
  { value: 'medical', label: 'Medical' },
  { value: 'fall', label: 'Fall / Injury' },
  { value: 'fire', label: 'Fire' },
  { value: 'security', label: 'Security Threat' },
  { value: 'accident', label: 'Accident' },
  { value: 'other', label: 'Other' },
];

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface SelectedPhoto {
  file: File;
  previewUrl: string;
}

export default function ReportIncidentPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EmergencyType>('medical');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Location state
  const [locState, setLocState] = useState<'idle' | 'capturing' | 'captured' | 'denied' | 'unavailable'>('idle');
  const [coords, setCoords] = useState<{ lat: string; lng: string; accuracy: number } | null>(null);

  // Submission state
  const [titleError, setTitleError] = useState('');
  const [fileError, setFileError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  const handleCaptureLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocState('unavailable');
      return;
    }
    setLocState('capturing');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
          accuracy: Math.round(pos.coords.accuracy),
        });
        setLocState('captured');
      },
      (err) => {
        setLocState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFileError('');

    const next = [...photos];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setFileError(`Maximum ${MAX_FILES} photos allowed per incident.`);
        break;
      }
      if (!ALLOWED_MIME.includes(f.type.toLowerCase()) && !/\.(jpg|jpeg|png|webp)$/i.test(f.name)) {
        setFileError(`"${f.name}" is unsupported. Only JPG, PNG, or WEBP images are allowed.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setFileError(`"${f.name}" exceeds the 5 MB limit.`);
        continue;
      }
      next.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    setPhotos(next);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (!title.trim()) {
      setTitleError('Please provide a short title describing the incident.');
      return;
    }
    setTitleError('');

    if (!isOnline) {
      setSubmitError('You are offline. Connect to the internet or call 112 directly.');
      return;
    }

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('category', category);
    if (description.trim()) {
      formData.append('description', description.trim());
    }
    if (coords) {
      formData.append('latitude', coords.lat);
      formData.append('longitude', coords.lng);
      formData.append('location_accuracy', String(coords.accuracy));
      formData.append('location_captured_at', new Date().toISOString());
    }
    photos.forEach((p) => formData.append('images', p.file));

    setSubmitting(true);
    setUploadPct(0);
    try {
      const res = await createIncident(formData, setUploadPct);
      toast.success('Incident reported. Admins & responders have been notified.');
      navigate(`/resident/incidents/${res.id}`);
    } catch (err) {
      setSubmitError(mapApiError(err, 'Could not submit report. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => navigate('/resident/incidents')}
            className="ghost mb-3"
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to My Incidents
          </button>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Report an Incident
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Submit details, optional location, and photo evidence to your society response team.
          </p>
        </div>
      </div>

      {submitError && (
        <div
          role="alert"
          style={{
            background: '#FEE2E2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            borderRadius: '14px',
            padding: '12px 16px',
            font: '600 13px Inter',
          }}
          className="flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5" noValidate>
        {/* Left main column (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          <div className="card flex flex-col gap-4">
            <div>
              <label htmlFor="incident-title" className="lbl block">
                Incident Title *
              </label>
              <input
                id="incident-title"
                type="text"
                className="fld"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError('');
                }}
                placeholder="e.g. Electrical short circuit near Block A lobby"
                maxLength={200}
              />
              {titleError && (
                <p role="alert" style={{ color: '#991B1B', font: '600 12px Inter', marginTop: '6px' }}>
                  {titleError}
                </p>
              )}
            </div>

            <div>
              <span className="lbl block">Emergency Category *</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`cat ${category === c.value ? 'on' : ''}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="incident-desc" className="lbl block">
                Description &amp; Exact Location Notes
              </label>
              <textarea
                id="incident-desc"
                className="fld"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Share helpful context such as floor, wing, access instructions, or hazards..."
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Drag-and-drop Photo Evidence */}
          <div className="card flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
                Photo Evidence (optional)
              </h2>
              <span style={{ font: '600 12px Inter', color: '#5B5B6B' }}>
                {photos.length} / {MAX_FILES} photos · Max 5 MB each (JPG, PNG, WEBP)
              </span>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#D9381E' : '#D5D5DE'}`,
                background: dragOver ? '#FFEDE5' : '#F7F7FA',
                borderRadius: '14px',
                padding: '22px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              <Upload className="w-6 h-6 mx-auto mb-2" style={{ color: '#D9381E' }} />
              <p style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                Drag &amp; drop photos here, or click to browse
              </p>
              <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                Supports JPG, PNG, and WEBP up to 5 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {fileError && (
              <p role="alert" style={{ color: '#991B1B', font: '600 12px Inter' }}>
                {fileError}
              </p>
            )}

            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                {photos.map((p, idx) => (
                  <div
                    key={p.previewUrl}
                    style={{
                      position: 'relative',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '1px solid #ECECF1',
                      height: '110px',
                    }}
                  >
                    <img
                      src={p.previewUrl}
                      alt={p.file.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto(idx);
                      }}
                      aria-label={`Remove ${p.file.name}`}
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        background: 'rgba(26,26,46,0.78)',
                        color: '#fff',
                        border: 0,
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column (5 cols): GPS & Submit */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>
              Location Capture (optional)
            </h2>
            <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
              Attach your GPS coordinates so assigned volunteers and security reach the right spot faster.
            </p>

            {locState === 'captured' && coords && (
              <div
                style={{
                  background: '#DCFCE7',
                  color: '#166534',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  font: '600 13px Inter',
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {coords.lat}, {coords.lng} (±{coords.accuracy} m)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCoords(null);
                    setLocState('idle');
                  }}
                  style={{ background: 'transparent', border: 0, color: '#166534', fontWeight: 800, cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
            )}

            {locState === 'denied' && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: '12px', padding: '10px 12px', font: '600 12px Inter' }}>
                Location permission was denied in your browser. You can still submit the incident with flat/building notes above.
              </div>
            )}

            {locState === 'unavailable' && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: '12px', padding: '10px 12px', font: '600 12px Inter' }}>
                GPS unavailable on this device. Your report will still be sent without coordinates.
              </div>
            )}

            <button
              type="button"
              onClick={handleCaptureLocation}
              disabled={locState === 'capturing'}
              className="ghost"
            >
              {locState === 'capturing' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {locState === 'captured' ? 'Refresh GPS Location' : 'Capture Current Location'}
            </button>
          </div>

          <div className="card flex flex-col gap-3">
            <h2 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Submit Report</h2>
            <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
              Your report enters status <strong>Reported</strong> and immediately alerts your society admins, security, and verified guardian.
            </p>

            {submitting && (
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1" style={{ color: '#5B5B6B' }}>
                  <span>Uploading report...</span>
                  <span>{uploadPct}%</span>
                </div>
                <div style={{ height: '6px', background: '#ECECF1', borderRadius: '99px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.max(15, uploadPct)}%`,
                      height: '100%',
                      background: '#D9381E',
                      transition: 'width 150ms ease',
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !isOnline}
              title={!isOnline ? 'Cannot submit reports while offline' : undefined}
              className="btn w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Incident Report'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

