import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getResidentIncidents } from '../../api/incidents';
import { getContacts } from '../../api/contacts';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { STATUS_LABELS, formatDistanceToNow, mapApiError } from '../../lib/formatters';
import StatusBadge, { incidentStatusVariant } from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { SkeletonCard } from '../../components/Skeleton';
import type { EmergencyType } from '../../api/types';
import { AlertTriangle, Building, FilePlus2, Home, PhoneCall, ShieldCheck, X } from 'lucide-react';
import { getPublicSocieties, getPublicBlocks, getPublicFlats, createMapping } from '../../api/society';
import SOSFlow from './SOSFlow';

const CATEGORIES: { type: EmergencyType; label: string }[] = [
  { type: 'medical', label: 'Medical' },
  { type: 'fall', label: 'Fall' },
  { type: 'fire', label: 'Fire' },
  { type: 'security', label: 'Security' },
  { type: 'accident', label: 'Accident' },
  { type: 'other', label: 'Other' },
];

export default function ResidentHomePage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const [selectedType, setSelectedType] = useState<EmergencyType>('medical');
  const [shortMessage, setShortMessage] = useState('');
  const [sosFlowOpen, setSosFlowOpen] = useState(false);

  // Link home modal state
  const [linkHomeOpen, setLinkHomeOpen] = useState(false);
  const [homeSocieties, setHomeSocieties] = useState<Array<{ id: number; name: string; city: string }>>([]);
  const [homeBlocks, setHomeBlocks] = useState<Array<{ id: number; name: string }>>([]);
  const [homeFlats, setHomeFlats] = useState<Array<{ id: number; flat_number: string; floor: number }>>([]);
  const [selectedHomeSoc, setSelectedHomeSoc] = useState<number | null>(null);
  const [selectedHomeBlk, setSelectedHomeBlk] = useState<number | null>(null);
  const [selectedHomeFlat, setSelectedHomeFlat] = useState<number | null>(null);
  const [savingHome, setSavingHome] = useState(false);
  const [homeError, setHomeError] = useState('');

  // Load societies when modal opens
  useEffect(() => {
    if (linkHomeOpen) {
      getPublicSocieties().then(setHomeSocieties).catch(console.error);
    }
  }, [linkHomeOpen]);

  // Load blocks
  useEffect(() => {
    if (selectedHomeSoc) {
      getPublicBlocks(selectedHomeSoc).then(setHomeBlocks).catch(console.error);
      setSelectedHomeBlk(null);
      setSelectedHomeFlat(null);
      setHomeFlats([]);
    } else {
      setHomeBlocks([]);
      setHomeFlats([]);
    }
  }, [selectedHomeSoc]);

  // Load flats
  useEffect(() => {
    if (selectedHomeBlk) {
      getPublicFlats(selectedHomeBlk).then(setHomeFlats).catch(console.error);
      setSelectedHomeFlat(null);
    } else {
      setHomeFlats([]);
    }
  }, [selectedHomeBlk]);

  const handleSaveHome = async () => {
    if (!selectedHomeFlat) {
      setHomeError('Please select your flat');
      return;
    }
    setSavingHome(true);
    setHomeError('');
    try {
      await createMapping({ flat: selectedHomeFlat, occupancy_type: 'owner', is_primary_resident: true });
      await refreshProfile();
      setLinkHomeOpen(false);
    } catch (err: any) {
      setHomeError(err?.response?.data?.detail || 'Failed to link flat. Please try again.');
    } finally {
      setSavingHome(false);
    }
  };

  // Press-and-hold logic (1.5s)
  const [isPressing, setIsPressing] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const pressTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const {
    data: incidents,
    isLoading: incidentsLoading,
    isError: incidentsError,
    error: incidentsErrObj,
    refetch: refetchIncidents,
  } = useQuery({
    queryKey: ['resident-incidents'],
    queryFn: getResidentIncidents,
    refetchInterval: 8000,
  });

  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    refetchInterval: 10000,
  });

  const allIncidents = incidents || [];
  const activeIncidents = allIncidents.filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status));
  const alertsSentCount = allIncidents.length;

  const allContacts = contacts || [];
  const verifiedGuardians = allContacts.filter(
    (c) =>
      (c.contact_type === 'primary_guardian' || c.contact_type === 'secondary_guardian') &&
      c.status === 'accepted'
  );
  const verifiedContactsCount = verifiedGuardians.length;
  const guardianTotal = allContacts.filter(
    (c) => c.contact_type === 'primary_guardian' || c.contact_type === 'secondary_guardian'
  ).length;
  const verifiedDisplay = guardianTotal > 0 ? `${verifiedContactsCount} of ${guardianTotal}` : '0 of 0';

  const primaryGuardian = allContacts.find((c) => c.contact_type === 'primary_guardian');
  const primaryName = primaryGuardian ? primaryGuardian.name : 'Not configured';
  const isPrimaryVerified = Boolean(primaryGuardian && primaryGuardian.status === 'accepted');

  const triggerDirectSOS = () => {
    if (!isOnline) return;
    setSosFlowOpen(true);
  };

  const startPress = () => {
    if (!isOnline) return;
    setIsPressing(true);
    setPressProgress(0);
    const startTime = Date.now();
    const duration = 1500;

    pressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, Math.round((elapsed / duration) * 100));
      setPressProgress(progress);

      if (elapsed >= duration) {
        clearInterval(pressTimerRef.current);
        setIsPressing(false);
        setPressProgress(0);
        triggerDirectSOS();
      }
    }, 40);
  };

  const endPress = () => {
    if (pressTimerRef.current) clearInterval(pressTimerRef.current);
    setIsPressing(false);
    setPressProgress(0);
  };

  const recentList = allIncidents.slice(0, 4);
  const firstName = user?.first_name || user?.username || 'Resident';
  const societyStr = user?.address || 'Green Meadows Community';

  return (
    <>
      {/* ── DESKTOP VIEW (>= 1024px) ── */}
      <div className="hidden lg:flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ font: '800 38px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Welcome back, {firstName}.
            </h1>
            <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
              {societyStr}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/resident/report')}
              className="ghost"
              style={{ padding: '8px 14px' }}
            >
              <FilePlus2 className="w-4 h-4" />
              Report Incident
            </button>
            <span className={`chip ${isOnline ? 'ok' : 'warn'}`}>
              {isOnline ? 'Online · Location ready' : 'Offline mode'}
            </span>
          </div>
        </div>

        {/* Offline SOS fallback card */}
        {!isOnline && (
          <div className="card" style={{ border: '1px solid #FCA5A5', background: '#FFF5F5' }}>
            <h2 style={{ font: '800 18px Inter', color: '#991B1B', marginBottom: '6px' }}>
              Offline Emergency Calling
            </h2>
            <p style={{ font: '500 14px Inter', color: '#5B5B6B', marginBottom: '12px' }}>
              Internet is unavailable, so online SOS dispatch is disabled. Use direct phone calling below:
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="tel:112" className="btn" style={{ background: '#D92D20' }}>
                <PhoneCall className="w-4 h-4" />
                Call 112 (Emergency)
              </a>
              {allContacts.map((c) => (
                <a key={c.id} href={`tel:${c.phone}`} className="ghost">
                  <PhoneCall className="w-4 h-4" />
                  Call {c.name} ({c.phone})
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Unlinked resident alert banner */}
        {user?.role === 'resident' && !user?.society_details?.society_linked && (
          <div
            role="alert"
            className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-2 border-amber-300 bg-amber-50/90 text-amber-900"
            style={{ padding: '16px 22px', borderRadius: '20px' }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-200/80 text-amber-800 shrink-0">
                <Building className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm sm:text-base text-amber-950">
                  Choose your home to enable emergency escalation
                </h4>
                <p className="text-xs sm:text-sm text-amber-800 mt-0.5">
                  You are not mapped to a society flat yet. Link your flat so security staff and nearby volunteers know where to rush.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLinkHomeOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 transition shadow-xs cursor-pointer"
            >
              Link My Home
            </button>
          </div>
        )}

        {/* Row 1: SOS Card + Who will be alerted */}
        <div style={{ display: 'flex', gap: '20px' }}>
          {/* Left: SOS Card */}
          <div className="card" style={{ flex: 2, display: 'flex', gap: '30px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 'none', width: '180px', height: '180px' }}>
              <button
                type="button"
                aria-label="Send SOS"
                disabled={!isOnline}
                title={!isOnline ? 'SOS server trigger is disabled while offline — call 112 directly' : 'Press and hold SOS'}
                onMouseDown={startPress}
                onMouseUp={endPress}
                onMouseLeave={endPress}
                onTouchStart={startPress}
                onTouchEnd={endPress}
                onClick={triggerDirectSOS}
                style={{
                  width: '180px',
                  height: '180px',
                  borderRadius: '50%',
                  border: 0,
                  background: isOnline ? '#D92D20' : '#9C9CAE',
                  color: '#fff',
                  font: '800 42px Inter',
                  letterSpacing: '-0.02em',
                  boxShadow: isOnline
                    ? '0 0 0 14px rgba(217,45,32,.12), 0 0 0 28px rgba(217,45,32,.07)'
                    : 'none',
                  cursor: isOnline ? 'pointer' : 'not-allowed',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'transform 0.15s ease',
                  transform: isPressing ? 'scale(0.96)' : 'scale(1)',
                }}
              >
                SOS
                {isPressing && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.25)',
                      transform: `scale(${pressProgress / 100})`,
                      transition: 'transform 0.05s linear',
                    }}
                  />
                )}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '16px', flex: 1 }}>
              <h2 style={{ font: '800 24px Inter', color: '#1A1A2E', letterSpacing: '-0.01em', margin: 0 }}>
                Need help? Press and hold SOS
              </h2>
              <p style={{ font: '500 14px/1.5 Inter', color: '#5B5B6B', margin: 0 }}>
                Your verified guardian, society security, admins, and nearby volunteers are alerted instantly.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {CATEGORIES.map((cat) => {
                  const isSelected = selectedType === cat.type;
                  return (
                    <button
                      key={cat.type}
                      type="button"
                      onClick={() => setSelectedType(cat.type)}
                      className={`cat ${isSelected ? 'on' : ''}`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={shortMessage}
                onChange={(e) => setShortMessage(e.target.value)}
                placeholder="Add a short message (optional)"
                className="fld"
                style={{ color: '#1A1A2E' }}
              />
            </div>
          </div>

          {/* Right: Who will be alerted */}
          <div className="card flex flex-col justify-between" style={{ flex: 1 }}>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Who will be alerted</h3>
                {contacts && verifiedContactsCount === 0 && (
                  <button
                    type="button"
                    onClick={() => navigate('/resident/contacts')}
                    className="chip warn cursor-pointer"
                    style={{ border: 0 }}
                  >
                    <AlertTriangle className="w-3 h-3 mr-1 inline" />
                    No verified guardian
                  </button>
                )}
              </div>
              <div
                onClick={() => navigate('/resident/contacts')}
                className="cursor-pointer"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #F0F0F4' }}
              >
                <div>
                  <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>Primary guardian</div>
                  <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>{primaryName}</div>
                </div>
                <span
                  className={`chip ${
                    isPrimaryVerified
                      ? 'ok'
                      : primaryGuardian?.status === 'declined'
                      ? 'bad'
                      : 'warn'
                  }`}
                >
                  {isPrimaryVerified
                    ? 'Verified'
                    : primaryGuardian?.status === 'declined'
                    ? 'Declined'
                    : primaryGuardian
                    ? 'Pending'
                    : 'Add'}
                </span>
              </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #F0F0F4' }}>
              <div>
                <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>Society security &amp; admins</div>
                <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>Response team</div>
              </div>
              <span className="chip ok">On duty</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #F0F0F4' }}>
              <div>
                <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>Volunteers</div>
                <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>Society responders</div>
              </div>
              <span className="chip info">Alerted</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0' }}>
              <div>
                <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>Neighbours</div>
                <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>Policy-controlled alert</div>
              </div>
              <span className="chip info">Private</span>
            </div>
            </div>
          </div>
        </div>

        {/* Row 2: 3 StatCards */}
        <div style={{ display: 'flex', gap: '20px' }}>
          <div
            onClick={() => navigate('/resident/incidents')}
            className="card cursor-pointer"
            style={{ flex: 1, padding: '18px' }}
          >
            <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
              ACTIVE INCIDENTS
            </div>
            <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
              {activeIncidents.length}
            </div>
          </div>
          <div
            onClick={() => navigate('/resident/incidents')}
            className="card cursor-pointer"
            style={{ flex: 1, padding: '18px' }}
          >
            <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
              TOTAL REPORTS &amp; SOS
            </div>
            <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
              {alertsSentCount}
            </div>
          </div>
          <div
            onClick={() => navigate('/resident/contacts')}
            className="card cursor-pointer"
            style={{ flex: 1, padding: '18px' }}
          >
            <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
              VERIFIED CONTACTS
            </div>
            <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
              {verifiedDisplay}
            </div>
          </div>
        </div>

        {/* Row 3: Recent activity */}
        {incidentsError && (
          <ErrorBanner
            message={mapApiError(incidentsErrObj, 'Could not load recent incidents.')}
            onRetry={() => refetchIncidents()}
          />
        )}

        <div className="card" style={{ padding: '16px 22px' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 style={{ font: '800 16px Inter', color: '#1A1A2E' }}>Recent activity</h3>
            <button
              type="button"
              onClick={() => navigate('/resident/incidents')}
              className="ghost"
              style={{ padding: '5px 12px', fontSize: '12px' }}
            >
              View all
            </button>
          </div>

          {incidentsLoading ? (
            <SkeletonCard count={2} />
          ) : recentList.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldCheck className="w-5 h-5 text-[#166534]" />}
              title="All clear — no recent alerts"
              description="Need to log a non-SOS hazard or facility alert with photos?"
              action={
                <button type="button" onClick={() => navigate('/resident/report')} className="ghost">
                  Report Incident
                </button>
              }
            />
          ) : (
            recentList.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => navigate(`/resident/incidents/${item.id}`)}
                className="cursor-pointer flex justify-between items-center py-2.5"
                style={{
                  borderBottom: idx === recentList.length - 1 ? 'none' : '1px solid #F0F0F4',
                  font: '600 14px Inter',
                  color: '#1A1A2E',
                }}
              >
                <span>
                  #{item.id} · {item.title || item.emergency_type} ·{' '}
                  <span style={{ color: '#5B5B6B', fontWeight: 500 }}>
                    {formatDistanceToNow(item.created_at)}
                  </span>
                </span>
                <StatusBadge
                  variant={incidentStatusVariant(item.status)}
                  label={STATUS_LABELS[item.status] || item.status}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── MOBILE VIEW (< 1024px) matching Board 5 ── */}
      <div className="flex lg:hidden flex-col gap-4 w-full px-1 py-2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ font: '500 13px Inter', color: '#5B5B6B' }}>{societyStr}</div>
            <h1 style={{ font: '800 26px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', marginTop: '2px' }}>
              Hi, {firstName}
            </h1>
          </div>
          <span className={`chip ${isOnline ? 'ok' : 'warn'}`}>
            {isOnline ? 'Location on' : 'Offline'}
          </span>
        </div>

        {!isOnline ? (
          <div className="card flex flex-col gap-3" style={{ background: '#FFF5F5', border: '1px solid #FCA5A5' }}>
            <strong style={{ color: '#991B1B', fontSize: '15px' }}>Offline Emergency Calling</strong>
            <a href="tel:112" className="btn w-full" style={{ background: '#D92D20' }}>
              <PhoneCall className="w-4 h-4" />
              Call 112 Directly
            </a>
            {allContacts.map((c) => (
              <a key={c.id} href={`tel:${c.phone}`} className="ghost w-full">
                Call {c.name}: {c.phone}
              </a>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
            <button
              type="button"
              aria-label="Send SOS"
              onMouseDown={startPress}
              onMouseUp={endPress}
              onTouchStart={startPress}
              onTouchEnd={endPress}
              onClick={triggerDirectSOS}
              style={{
                width: '163px',
                height: '158px',
                borderRadius: '50%',
                border: 0,
                background: '#D92D20',
                color: '#fff',
                font: '800 44px Inter',
                letterSpacing: '-0.02em',
                boxShadow: '0 0 0 14px rgba(217,45,32,.12), 0 0 0 28px rgba(217,45,32,.07)',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              SOS
            </button>
          </div>
        )}

        <p style={{ textAlign: 'center', font: '600 14px Inter', color: '#5B5B6B', margin: 0 }}>
          {isOnline ? 'Press and hold SOS, or choose a category' : 'Connect to submit online alerts'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.type}
              type="button"
              onClick={() => setSelectedType(cat.type)}
              className={`cat ${selectedType === cat.type ? 'on' : ''}`}
              style={{ textAlign: 'center', padding: '9px 10px', fontSize: '13px' }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={shortMessage}
          onChange={(e) => setShortMessage(e.target.value)}
          placeholder="Add a short message (optional)"
          className="fld"
        />

        <button
          type="button"
          onClick={() => navigate('/resident/report')}
          className="ghost w-full"
        >
          <FilePlus2 className="w-4 h-4" />
          Report Incident with Photos
        </button>

        <div
          onClick={() => navigate('/resident/contacts')}
          className="card cursor-pointer"
          style={{ padding: '14px 16px', font: '600 13px/1.5 Inter', color: '#1A1A2E' }}
        >
          {verifiedContactsCount > 0 ? (
            <>Alerting: {primaryName} ({verifiedContactsCount} verified guardian{verifiedContactsCount > 1 ? 's' : ''}), security, admins &amp; volunteers</>
          ) : (
            <span style={{ color: '#92400E' }}>
              No verified guardian yet — tap to invite a guardian by username or phone.
            </span>
          )}
        </div>
      </div>

      {/* SOS Modal Flow */}
      {sosFlowOpen && (
        <SOSFlow
          initialType={selectedType}
          initialDescription={shortMessage}
          onClose={() => setSosFlowOpen(false)}
        />
      )}

      {/* Link Home Modal */}
      {linkHomeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95 duration-150"
            style={{ borderRadius: '20px' }}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <Home className="w-5 h-5 text-red-600" />
                <h3 className="font-extrabold text-neutral-900 text-lg">Link Your Flat</h3>
              </div>
              <button
                type="button"
                onClick={() => setLinkHomeOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {homeError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                {homeError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="lbl">Society *</label>
                <select
                  className="fld"
                  value={selectedHomeSoc || ''}
                  onChange={(e) => setSelectedHomeSoc(Number(e.target.value) || null)}
                >
                  <option value="">Select your society</option>
                  {homeSocieties.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.city})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="lbl">Block / Tower *</label>
                <select
                  className="fld"
                  disabled={!selectedHomeSoc}
                  value={selectedHomeBlk || ''}
                  onChange={(e) => setSelectedHomeBlk(Number(e.target.value) || null)}
                >
                  <option value="">Select block</option>
                  {homeBlocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="lbl">Flat Number *</label>
                <select
                  className="fld"
                  disabled={!selectedHomeBlk}
                  value={selectedHomeFlat || ''}
                  onChange={(e) => setSelectedHomeFlat(Number(e.target.value) || null)}
                >
                  <option value="">Select flat unit</option>
                  {homeFlats.map((f) => (
                    <option key={f.id} value={f.id}>
                      Flat {f.flat_number} (Floor {f.floor})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLinkHomeOpen(false)}
                className="px-4 py-2 rounded-xl border border-neutral-300 text-neutral-700 hover:bg-neutral-50 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveHome}
                disabled={savingHome || !selectedHomeFlat}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {savingHome ? 'Saving...' : 'Confirm Flat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
