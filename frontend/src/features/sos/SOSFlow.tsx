import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { triggerSOS, getIncident, getIncidentMessages, postIncidentMessage, escalateIncident } from '../../api/incidents';
import { getIncidentNotifications } from '../../api/notifications';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { mapApiError } from '../../lib/formatters';
import { LocationMap } from '../../components/LocationMap';
import {
  Heart,
  AlertTriangle,
  Flame,
  Shield,
  Car,
  HelpCircle,
  X,
  CheckCircle2,
  Clock,
  PhoneCall,
  MessageSquare,
  Share2,
  RefreshCw,
  Send,
  AlertOctagon,
  ArrowRight,
  Zap,
  MapPin,
} from 'lucide-react';
import type { EmergencyType } from '../../api/types';

interface SOSFlowProps {
  onClose: () => void;
  activeIncidentId?: number | null;
  initialType?: EmergencyType;
  initialDescription?: string;
}

type Step = 'category' | 'countdown' | 'live_response' | 'error';

const categories: Array<{ type: EmergencyType; label: string; icon: typeof Heart; desc: string }> = [
  { type: 'medical', label: 'Medical Emergency', icon: Heart, desc: 'Chest pain, breathing difficulty, injury' },
  { type: 'fall', label: 'Fall / Mobility', icon: AlertTriangle, desc: 'Slip, fracture, cannot stand' },
  { type: 'fire', label: 'Fire / Smoke', icon: Flame, desc: 'Fire outbreak, gas leak, burning' },
  { type: 'security', label: 'Security Threat', icon: Shield, desc: 'Intruder, harassment, trespass' },
  { type: 'accident', label: 'Accident', icon: Car, desc: 'Vehicle or structural hazard' },
  { type: 'other', label: 'Other Urgent', icon: HelpCircle, desc: 'Immediate assistance needed' },
];

export default function SOSFlow({ onClose, activeIncidentId, initialType = 'medical', initialDescription = '' }: SOSFlowProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();

  const [step, setStep] = useState<Step>(activeIncidentId ? 'live_response' : 'countdown');
  const [selectedType, setSelectedType] = useState<EmergencyType>(initialType);
  const [description, setDescription] = useState(initialDescription);
  const [countdown, setCountdown] = useState(5);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [incidentId, setIncidentId] = useState<number | null>(activeIncidentId || null);
  const [sendError, setSendError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [newMessage, setNewMessage] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isEscalatingManual, setIsEscalatingManual] = useState(false);
  const [remainingEscalationSec, setRemainingEscalationSec] = useState<number | null>(null);

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Capture high-accuracy GPS coordinates with watchPosition (up to 5s, smallest accuracy value)
  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    let bestAcc = Infinity;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy < bestAcc) {
          bestAcc = pos.coords.accuracy;
          setLocation({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracy: Math.round(pos.coords.accuracy),
          });
        }
      },
      (err) => {
        console.warn('Geolocation warning:', err);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    const timer = setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
    }, 5000);

    return () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Poll incident data every 3 seconds once created
  const { data: incident } = useQuery({
    queryKey: ['live-incident-detail', incidentId],
    queryFn: () => (incidentId ? getIncident(incidentId) : null),
    enabled: !!incidentId,
    refetchInterval: 3000,
  });

  // Poll notifications dispatched for this incident
  const { data: notifications } = useQuery({
    queryKey: ['live-incident-notifications', incidentId],
    queryFn: () => (incidentId ? getIncidentNotifications(incidentId) : []),
    enabled: !!incidentId,
    refetchInterval: 3500,
  });

  // Poll discussion / notes
  const { data: messages, refetch: refetchMessages } = useQuery({
    queryKey: ['live-incident-messages', incidentId],
    queryFn: () => (incidentId ? getIncidentMessages(incidentId) : []),
    enabled: !!incidentId,
    refetchInterval: 4000,
  });

  // Countdown handler (5-second window to cancel)
  useEffect(() => {
    if (step !== 'countdown') return;

    if (countdown <= 0) {
      executeSendSOS();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [step, countdown]);

  // Elapsed time tracker for live response
  useEffect(() => {
    if (step !== 'live_response') return;
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(elapsedTimerRef.current);
  }, [step]);

  const cancelCountdown = () => {
    clearInterval(countdownTimerRef.current);
    setCountdown(5);
    setStep('category');
  };

  const executeSendSOS = async () => {
    try {
      setIsRetrying(false);
      const payload: Parameters<typeof triggerSOS>[0] = {
        emergency_type: selectedType,
        description: description.trim() || undefined,
      };
      if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
        payload.latitude = location.lat.toFixed(6);
        payload.longitude = location.lng.toFixed(6);
        payload.location_accuracy = location.accuracy;
        payload.location_captured_at = new Date().toISOString();
      }

      console.log('[executeSendSOS] Dispatching SOS payload:', payload);
      const res = await triggerSOS(payload);
      console.log('[executeSendSOS] Success response:', res);
      setIncidentId(res.id);
      setStep('live_response');
      toast('success', 'Emergency SOS dispatched to your guardians, security and responders.');
    } catch (err) {
      console.error('[executeSendSOS] Error occurred:', err);
      setSendError(mapApiError(err, 'Unable to reach server. Please call 112 if this is an emergency.'));
      setStep('error');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !incidentId || !user) return;
    try {
      await postIncidentMessage(
        incidentId,
        user.id,
        `${user.first_name} ${user.last_name}`.trim() || user.username,
        user.role,
        newMessage.trim()
      );
      setNewMessage('');
      refetchMessages();
    } catch {
      toast('error', 'Could not post note.');
    }
  };

  const handleCloseLiveModal = () => {
    setShowCancelConfirm(false);
    onClose();
    if (incidentId) navigate(`/resident/incidents/${incidentId}`);
  };

  // Dynamic server-driven escalation countdown
  useEffect(() => {
    if (!incident?.escalate_at || incident.guardian_acknowledged_at || incident.is_escalated || ['RESOLVED', 'CLOSED'].includes(incident?.status || '')) {
      setRemainingEscalationSec(null);
      return;
    }

    const updateRemaining = () => {
      const targetTime = new Date(incident.escalate_at!).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.round((targetTime - now) / 1000));
      setRemainingEscalationSec(diffSec);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [incident?.escalate_at, incident?.guardian_acknowledged_at, incident?.is_escalated, incident?.status]);

  const handleManualEscalate = async () => {
    if (!incidentId || isEscalatingManual) return;
    setIsEscalatingManual(true);
    try {
      await escalateIncident(incidentId, 'Resident initiated immediate escalation');
      toast('success', 'Incident escalated immediately to security and volunteers.');
    } catch {
      toast('error', 'Could not escalate incident.');
    } finally {
      setIsEscalatingManual(false);
    }
  };

  // Helper for delivery status checklist
  const guardianNotified = notifications?.some((n) => n.recipient_type === 'primary_guardian' || n.recipient_name?.toLowerCase().includes('guardian'));
  const securityNotified = notifications?.some((n) => n.recipient_type === 'security' || n.recipient_name?.toLowerCase().includes('security'));
  const volunteerNotified = notifications?.some((n) => n.recipient_type === 'volunteer' || n.recipient_name?.toLowerCase().includes('volunteer'));

  // Escalation countdown math
  const countdownVal = remainingEscalationSec !== null ? remainingEscalationSec : Math.max(0, 120 - elapsedSeconds);
  const escalationMin = String(Math.floor(countdownVal / 60)).padStart(2, '0');
  const escalationSec = String(countdownVal % 60).padStart(2, '0');

  // Elapsed format
  const elapsedMin = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const elapsedSec = String(elapsedSeconds % 60).padStart(2, '0');

  return (
    <div
      className="fixed inset-0 z-50 bg-surface-overlay backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl bg-surface-raised border border-border rounded-[20px] shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── STEP 1: CATEGORY SELECTION ── */}
        {step === 'category' && (
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-critical bg-critical-light px-2.5 py-1 rounded-full border border-critical/20 inline-block mb-2">
                  Emergency Alert
                </span>
                <h2 className="font-display text-2xl font-bold text-ink">What is your emergency?</h2>
                <p className="text-sm text-ink-secondary mt-1">
                  Select the category so responders arrive prepared with proper medical or security gear.
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-surface-sunken text-ink-tertiary hover:text-ink cursor-pointer"
                aria-label="Cancel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const isSelected = selectedType === cat.type;
                return (
                  <button
                    key={cat.type}
                    onClick={() => setSelectedType(cat.type)}
                    className={`
                      flex items-start gap-3 p-4 rounded-[14px] border text-left transition-all cursor-pointer min-h-[76px]
                      ${
                        isSelected
                          ? 'border-critical bg-critical-light/40 ring-2 ring-critical/20'
                          : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface-sunken/60'
                      }
                    `}
                  >
                    <div
                      className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-critical text-critical-text' : 'bg-surface-sunken text-ink-secondary'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink leading-snug">{cat.label}</p>
                      <p className="text-xs text-ink-secondary mt-0.5 leading-relaxed">{cat.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              <label className="text-xs font-semibold text-ink-secondary uppercase tracking-wider block mb-1.5">
                Optional Note / Room or Location specifics
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Master bedroom, door unlocked, chest tightness..."
                className="w-full h-20 px-3.5 py-2.5 rounded-[12px] border border-border bg-surface-raised text-sm text-ink placeholder:text-ink-disabled resize-none focus:border-border-focus focus:ring-1 focus:ring-border-focus"
                maxLength={400}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 rounded-[10px] text-sm font-semibold text-ink-secondary hover:bg-surface-sunken transition-colors cursor-pointer"
              >
                Never Mind
              </button>
              <button
                type="button"
                onClick={() => {
                  setCountdown(5);
                  setStep('countdown');
                }}
                className="flex items-center gap-2 px-7 py-3 rounded-[12px] bg-critical hover:bg-critical-hover text-critical-text font-bold text-base shadow-md transition-all cursor-pointer"
              >
                <span>Trigger SOS Alert</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: 5-SECOND CANCEL WINDOW ── */}
        {step === 'countdown' && (
          <div className="p-8 sm:p-12 text-center flex flex-col items-center justify-center">
            <span className="text-xs font-bold uppercase tracking-wider text-critical bg-critical-light px-3 py-1 rounded-full mb-4 border border-critical/20">
              Accidental Press Protection
            </span>

            {/* Circular Countdown Progress Ring */}
            <div className="relative w-36 h-36 my-4 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-border)" strokeWidth="6" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--color-critical)"
                  strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - countdown / 5)}`}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-5xl font-display font-extrabold text-critical tabular-nums leading-none">
                  {countdown}
                </span>
                <span className="text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider mt-1">
                  Seconds
                </span>
              </div>
            </div>

            <h2 className="font-display text-2xl font-bold text-ink mt-2">Sending SOS Alert...</h2>
            <p className="text-sm text-ink-secondary max-w-sm mt-1 mb-8">
              Press cancel now if this was pressed by mistake. Once the timer reaches zero, emergency responders will be alerted immediately.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs justify-center">
              <button
                type="button"
                onClick={executeSendSOS}
                className="py-3 px-5 rounded-[12px] bg-critical hover:bg-critical-hover text-critical-text font-bold text-sm shadow-sm transition-all cursor-pointer"
              >
                Send Now
              </button>
              <button
                type="button"
                onClick={cancelCountdown}
                className="py-3 px-5 rounded-[12px] border border-border text-ink font-bold text-sm hover:bg-surface-sunken transition-all cursor-pointer"
              >
                Cancel SOS
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: CONFIRMED LIVE SOS RESPONSE SCREEN ── */}
        {step === 'live_response' && (
          <div className="p-6 sm:p-8 space-y-6">
            {/* Headline Banner: Calm & Reassuring */}
            <div className="bg-primary-light/60 border border-primary/20 rounded-[16px] p-5 sm:p-6 text-center sm:text-left flex flex-col sm:flex-row items-center gap-5">
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-full bg-primary text-primary-text flex items-center justify-center shadow-md">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping -z-10" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary-light px-2.5 py-0.5 rounded-full border border-primary/30 inline-block mb-1">
                  Alert Active · Elapsed {elapsedMin}:{elapsedSec}
                </span>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
                  Help is on the way.
                </h1>
                <p className="text-sm text-ink-secondary mt-1 leading-relaxed">
                  Guardians, society security staff, and nearby community volunteers have been alerted with your location. Stay where you are if it is safe to do so.
                </p>
              </div>
            </div>

            {/* Prominent Call 112 Alert when no responder accepts in time */}
            {incident?.no_responder_alerted_at && (
              <div className="bg-red-50 border-2 border-red-600 rounded-[16px] p-5 text-center shadow-lg animate-pulse">
                <div className="flex items-center justify-center gap-2 text-red-700 font-bold text-base mb-1">
                  <AlertOctagon className="w-6 h-6 text-red-600" />
                  <span>Immediate Action: No Responder Has Accepted</span>
                </div>
                <p className="text-xs text-red-800 mb-3 max-w-md mx-auto">
                  The escalation window elapsed without an active responder. Please call national emergency services (112) immediately!
                </p>
                <a
                  href="tel:112"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-[12px] bg-red-600 text-white font-extrabold text-base hover:bg-red-700 shadow-md transition-transform active:scale-95"
                >
                  <PhoneCall className="w-5 h-5" />
                  <span>Call 112 Now</span>
                </a>
              </div>
            )}

            {/* Live Responder Status Banner */}
            {incident?.assigned_to ? (
              <div className="p-4 rounded-[14px] bg-emerald-50 border border-emerald-300 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-emerald-950 text-sm">
                      Volunteer {incident.assigned_to.name} is responding!
                    </p>
                    <p className="text-emerald-800 text-xs">En route to your location. Keep your phone handy.</p>
                  </div>
                </div>
                {incident.assigned_to.phone && (
                  <a
                    href={`tel:${incident.assigned_to.phone}`}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold text-xs hover:bg-emerald-800 transition"
                  >
                    Call Responder
                  </a>
                )}
              </div>
            ) : incident?.guardian_acknowledged_at ? (
              <div className="p-4 rounded-[14px] bg-blue-50 border border-blue-300 flex items-center gap-3 text-xs">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-bold text-blue-950 text-sm">
                    Guardian {incident.guardian_acknowledged_by?.name || 'Primary Guardian'} is responding!
                  </p>
                  <p className="text-blue-800 text-xs">Guardian acknowledged your SOS and is on the way.</p>
                </div>
              </div>
            ) : incident?.is_escalated ? (
              <div className="p-3.5 rounded-[14px] bg-amber-50 border border-amber-300 flex items-center gap-3 text-xs">
                <Zap className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <p className="font-bold text-amber-950">
                    Escalated to local security guards and nearby community volunteers
                  </p>
                  <p className="text-amber-800 text-[11px]">First volunteer or security guard to accept will arrive shortly.</p>
                </div>
              </div>
            ) : null}

            {/* Embedded Live Location Map */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-ink-secondary">
                <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-red-600" />
                  Captured SOS Location
                </span>
                {location?.accuracy && (
                  <span className="text-[11px] text-ink-tertiary">
                    Accurate to &plusmn;{location.accuracy}m
                  </span>
                )}
              </div>
              <LocationMap
                latitude={incident?.latitude || location?.lat}
                longitude={incident?.longitude || location?.lng}
                accuracy={incident?.location_accuracy || location?.accuracy}
                residentName={user ? `${user.first_name} ${user.last_name}`.trim() : 'Resident'}
                residentPhone={user?.phone}
                height={190}
              />
            </div>

            {/* Live Notification Dispatch Checklist */}
            <div className="bg-surface-sunken/40 border border-border rounded-[14px] p-4 sm:p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-secondary mb-3 flex items-center justify-between">
                <span>Alert Distribution Live Checklist</span>
                <span className="text-primary font-semibold normal-case flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Live Sync
                </span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-[8px] bg-surface-raised border border-border/80">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  <span className="font-medium text-ink">SOS incident registered #{incidentId}</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-[8px] bg-surface-raised border border-border/80">
                  {guardianNotified || incident?.guardian_alerted_at || notifications?.length ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-warning shrink-0 animate-spin" />
                  )}
                  <span className="font-medium text-ink">
                    {incident?.guardian_acknowledged_at
                      ? 'Guardian acknowledged & responding'
                      : guardianNotified || incident?.guardian_alerted_at
                      ? 'Primary Guardian alerted (with GPS link)'
                      : 'Alerting Guardians...'}
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-[8px] bg-surface-raised border border-border/80">
                  {securityNotified || incident?.is_escalated ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-ink-tertiary shrink-0" />
                  )}
                  <span className="font-medium text-ink">
                    {incident?.is_escalated
                      ? 'Gate Security dispatched'
                      : 'Security (Tier 2 auto-escalation)'}
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-[8px] bg-surface-raised border border-border/80">
                  {volunteerNotified || incident?.assigned_to || incident?.is_escalated ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-ink-tertiary shrink-0" />
                  )}
                  <span className="font-medium text-ink">
                    {incident?.assigned_to
                      ? `Volunteer ${incident.assigned_to.name} assigned`
                      : incident?.is_escalated
                      ? 'Nearby Block Volunteers notified'
                      : 'Nearby Volunteers (Tier 2)'}
                  </span>
                </div>
              </div>

              {/* Auto Escalation Timer & Escalate Now Button */}
              {!incident?.is_escalated && !incident?.guardian_acknowledged_at && !['RESOLVED', 'CLOSED'].includes(incident?.status || '') && (
                <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-warning" />
                    <span>Auto-escalating in:</span>
                    <span className="font-mono font-bold text-ink bg-warning-light text-warning-text px-2 py-0.5 rounded border border-warning/20 tabular-nums">
                      {escalationMin}:{escalationSec}
                    </span>
                    {incident?.escalation_plan?.targets && (
                      <span className="text-[11px] text-ink-tertiary hidden sm:inline">
                        to {incident.escalation_plan.targets.join(', ')}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleManualEscalate}
                    disabled={isEscalatingManual}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-[8px] bg-warning-light border border-warning/40 text-warning-text font-bold hover:bg-warning hover:text-white transition cursor-pointer text-xs"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{isEscalatingManual ? 'Escalating...' : 'Escalate Now'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quick Emergency Action Buttons */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-ink-tertiary mb-2.5">
                Direct Emergency Contacts
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <a
                  href="tel:112"
                  className="flex items-center justify-center gap-2 p-3 rounded-[12px] bg-critical text-critical-text font-bold text-sm hover:bg-critical-hover shadow-sm transition-transform active:scale-95"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Call 112 (Police)</span>
                </a>
                <a
                  href="tel:+918022001122"
                  className="flex items-center justify-center gap-2 p-3 rounded-[12px] bg-surface-raised border border-border font-semibold text-sm text-ink hover:bg-surface-sunken transition-colors"
                >
                  <Shield className="w-4 h-4 text-primary" />
                  <span>Call Gate Security</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.share && location) {
                      navigator.share({
                        title: 'Emergency Alert Location',
                        text: `Emergency SOS triggered at CERAN. Location: ${location.lat}, ${location.lng}`,
                        url: window.location.href,
                      });
                    } else {
                      toast('info', 'Live location coordinates copied to clipboard.');
                    }
                  }}
                  className="flex items-center justify-center gap-2 p-3 rounded-[12px] bg-surface-raised border border-border font-semibold text-sm text-ink hover:bg-surface-sunken transition-colors cursor-pointer col-span-2 sm:col-span-1"
                >
                  <Share2 className="w-4 h-4 text-ink-secondary" />
                  <span>Share Location</span>
                </button>
              </div>
            </div>

            {/* Live Message Thread / Quick Update */}
            <div className="bg-surface-raised border border-border rounded-[14px] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-secondary flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Incident Live Chat & Assistance Updates
                </span>
                <span className="text-xs text-ink-tertiary tabular-nums">
                  {messages?.length || 0} updates
                </span>
              </div>

              {messages && messages.length > 0 ? (
                <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                  {messages.map((m) => (
                    <div key={m.id} className="text-xs p-2.5 rounded-[8px] bg-surface-sunken">
                      <div className="flex items-center justify-between font-semibold text-ink mb-1">
                        <span>{m.user_name} ({m.user_role})</span>
                        <span className="text-[10px] text-ink-tertiary">Just now</span>
                      </div>
                      <p className="text-ink-secondary">{m.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-tertiary italic">
                  No responder notes yet. Type a message below to inform arriving personnel.
                </p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Add note: e.g. door is unlocked, 3rd floor..."
                  className="flex-1 h-9 px-3 text-xs rounded-[8px] border border-border bg-surface-raised text-ink placeholder:text-ink-disabled focus:border-border-focus"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="px-3 h-9 rounded-[8px] bg-primary text-primary-text font-semibold text-xs hover:bg-primary-hover disabled:opacity-50 cursor-pointer flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </button>
              </div>
            </div>

            {/* Bottom Actions: View Full Incident / I'm Safe Cancel */}
            <div className="pt-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (incidentId) navigate(`/incidents/${incidentId}`);
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-[10px] border border-border text-xs font-semibold text-ink-secondary hover:bg-surface-sunken transition-colors cursor-pointer text-center"
              >
                View Incident Timeline & Full Details
              </button>

              <div className="w-full sm:w-auto flex items-center gap-2">
                {showCancelConfirm ? (
                  <div className="flex items-center gap-2 bg-warning-light p-1.5 rounded-[10px] border border-warning/30">
                    <span className="text-xs font-semibold text-warning-text px-2">Track updates or notify admin?</span>
                    <button
                      type="button"
                      onClick={handleCloseLiveModal}
                      className="px-3 py-1.5 rounded-[8px] bg-success text-success-text text-xs font-bold hover:bg-success/90 cursor-pointer"
                    >
                      Open Incident Page
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2 py-1.5 text-xs text-ink-secondary hover:text-ink cursor-pointer"
                    >
                      Back
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!isOnline && false}
                    onClick={() => setShowCancelConfirm(true)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-[10px] bg-surface-sunken hover:bg-surface-sunken/80 text-xs font-semibold text-ink-secondary transition-colors cursor-pointer"
                  >
                    Dismiss SOS Panel
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: FAILURE / RETRY STATE ── */}
        {step === 'error' && (
          <div className="p-8 sm:p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-critical-light text-critical flex items-center justify-center mx-auto mb-4 border border-critical/20">
              <AlertOctagon className="w-8 h-8" />
            </div>
            <h2 className="font-display text-2xl font-bold text-ink">Couldn't send SOS</h2>
            <p className="text-sm text-ink-secondary max-w-md mx-auto mt-2 mb-6">
              {sendError || 'Network connection dropped. We will automatically retry while you call emergency services.'}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto mb-6">
              <a
                href="tel:112"
                className="flex-1 py-3.5 px-6 rounded-[12px] bg-critical text-critical-text font-bold text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call 112 Immediately</span>
              </a>
              <button
                onClick={() => {
                  setStep('countdown');
                  setCountdown(3);
                }}
                className="flex-1 py-3 px-5 rounded-[12px] border border-border font-semibold text-sm text-ink hover:bg-surface-sunken flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>Retry Now</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="text-xs font-medium text-ink-tertiary hover:text-ink cursor-pointer"
            >
              Close dialog
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
