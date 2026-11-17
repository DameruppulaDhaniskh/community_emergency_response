import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminVolunteers,
  approveVolunteer,
  rejectVolunteer,
} from '../../api/volunteers';
import {
  getSocietyPolicy,
  updateSocietyPolicy,
  getAdminSecurityList,
  approveSecurityStaff,
  rejectSecurityStaff,
} from '../../api/society';
import type { SocietyAlertPolicy } from '../../api/types';
import { useToast } from '../../components/Toast';
import { SkeletonCard } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import {
  ShieldCheck,
  AlertTriangle,
  Search,
  X,
  Sliders,
  Check,
  Users,
  Shield,
  Phone,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from '../../lib/formatters';

export default function VolunteerApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Top-level tab: Volunteers vs Security Staff
  const [staffType, setStaffType] = useState<'volunteers' | 'security'>('volunteers');

  // Volunteer tabs & search
  const [volTab, setVolTab] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [volSearch, setVolSearch] = useState('');

  // Security tabs & search
  const [secTab, setSecTab] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [secSearch, setSecSearch] = useState('');

  // Reject modal state (for either volunteer or security)
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingItem, setRejectingItem] = useState<{
    type: 'volunteer' | 'security';
    id: number;
    name: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // ── Queries ──
  const {
    data: volunteersData,
    isLoading: volunteersLoading,
    isError: volunteersError,
    refetch: refetchVolunteers,
  } = useQuery({
    queryKey: ['admin-volunteers', volTab, volSearch],
    queryFn: () => getAdminVolunteers({ status: volTab, search: volSearch.trim() || undefined }),
    refetchInterval: 10000,
  });

  const {
    data: securityData,
    isLoading: securityLoading,
    isError: securityError,
    refetch: refetchSecurity,
  } = useQuery({
    queryKey: ['admin-security', secTab],
    queryFn: () => getAdminSecurityList(secTab || undefined),
    refetchInterval: 10000,
  });

  const {
    data: policy,
    isLoading: policyLoading,
  } = useQuery({
    queryKey: ['society-policy'],
    queryFn: getSocietyPolicy,
  });

  // ── Volunteer Mutations ──
  const approveVolMutation = useMutation({
    mutationFn: (id: number) => approveVolunteer(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['admin-volunteers'] });
      toast.success(`Volunteer ${updated.name || updated.user_name || 'profile'} approved.`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || 'Failed to approve volunteer.';
      toast.error(msg);
    },
  });

  const rejectVolMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectVolunteer(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-volunteers'] });
      closeRejectModal();
      toast.info('Volunteer application rejected.');
    },
    onError: (err: any) => {
      const fieldErrors = err.response?.data;
      if (fieldErrors?.reason) {
        setRejectError(Array.isArray(fieldErrors.reason) ? fieldErrors.reason[0] : fieldErrors.reason);
      } else {
        setRejectError(fieldErrors?.detail || 'Failed to reject volunteer application.');
      }
    },
  });

  // ── Security Staff Mutations ──
  const approveSecMutation = useMutation({
    mutationFn: (id: number) => approveSecurityStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-security'] });
      toast.success('Security guard approved.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to approve security guard.');
    },
  });

  const rejectSecMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => rejectSecurityStaff(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-security'] });
      closeRejectModal();
      toast.info('Security guard application rejected.');
    },
    onError: (err: any) => {
      setRejectError(err?.response?.data?.detail || 'Failed to reject security guard.');
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: (data: Partial<SocietyAlertPolicy>) => updateSocietyPolicy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['society-policy'] });
      toast.success('Society alert policy updated.');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || 'Failed to update society policy.';
      toast.error(msg);
    },
  });

  const closeRejectModal = () => {
    setRejectModalOpen(false);
    setRejectingItem(null);
    setRejectReason('');
    setRejectError('');
  };

  const handleConfirmReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingItem) return;
    if (!rejectReason.trim()) {
      setRejectError('Please enter a reason for rejecting this application.');
      return;
    }
    if (rejectingItem.type === 'volunteer') {
      rejectVolMutation.mutate({ id: rejectingItem.id, reason: rejectReason.trim() });
    } else {
      rejectSecMutation.mutate({ id: rejectingItem.id, note: rejectReason.trim() });
    }
  };

  const volunteerList = volunteersData?.results || [];
  const pendingVolCount = (volunteersData?.results || []).filter((v) => v.approval_status === 'pending').length;

  const securityList = (securityData || []).filter((s) => {
    if (!secSearch.trim()) return true;
    const q = secSearch.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      s.phone.toLowerCase().includes(q) ||
      s.post_label.toLowerCase().includes(q)
    );
  });
  const pendingSecCount = (securityData || []).filter((s) => s.approval_status === 'pending').length;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1020px] mx-auto pb-12">
      {/* Header */}
      <div>
        <h1 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Staff &amp; Responder Approvals
        </h1>
        <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
          Review and approve community volunteer responders, gate security guards, and cross-society dispatch policies.
        </p>
      </div>

      {/* Top Level Staff Type Switcher */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '2px solid #E2E2E8',
          paddingBottom: '2px',
        }}
      >
        <button
          type="button"
          onClick={() => setStaffType('volunteers')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            font: '700 15px Inter',
            color: staffType === 'volunteers' ? '#D9381E' : '#5B5B6B',
            borderBottom: staffType === 'volunteers' ? '3px solid #D9381E' : '3px solid transparent',
            marginBottom: '-2px',
            cursor: 'pointer',
            transition: 'color .2s',
          }}
        >
          <Users className="w-4 h-4" />
          <span>Volunteers</span>
          {pendingVolCount > 0 && (
            <span
              style={{
                background: '#D92D20',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: '99px',
              }}
            >
              {pendingVolCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setStaffType('security')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            font: '700 15px Inter',
            color: staffType === 'security' ? '#D9381E' : '#5B5B6B',
            borderBottom: staffType === 'security' ? '3px solid #D9381E' : '3px solid transparent',
            marginBottom: '-2px',
            cursor: 'pointer',
            transition: 'color .2s',
          }}
        >
          <Shield className="w-4 h-4" />
          <span>Security Guards</span>
          {pendingSecCount > 0 && (
            <span
              style={{
                background: '#D92D20',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: '99px',
              }}
            >
              {pendingSecCount}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: VOLUNTEERS ── */}
      {staffType === 'volunteers' && (
        <div className="flex flex-col gap-6">
          {/* Society Cross-Dispatch Policy Card */}
          <div className="card" style={{ padding: '24px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Sliders className="w-5 h-5 text-[#D9381E]" />
              <h2 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                Cross-Society Dispatch Policy
              </h2>
            </div>
            <p style={{ font: '500 13.5px Inter', color: '#5B5B6B', marginBottom: '20px' }}>
              Configure whether volunteers from neighbouring societies can be alerted for unassigned emergencies in your community.
            </p>

            {policyLoading ? (
              <div style={{ padding: '16px', color: '#8E8E9E' }}>Loading policy...</div>
            ) : policy ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                {/* Toggle: include_neighbour_societies */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '16px',
                    background: '#F9F9FB',
                    borderRadius: '10px',
                    border: '1px solid #E2E2E8',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={policy.include_neighbour_societies}
                    onChange={(e) =>
                      updatePolicyMutation.mutate({ include_neighbour_societies: e.target.checked })
                    }
                    style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#D9381E' }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                      Enable Neighbouring Society Volunteers (Tier 3)
                    </div>
                    <div style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '2px' }}>
                      Allows approved volunteers from nearby communities to receive privacy-protected emergency dispatches.
                    </div>
                  </div>
                </label>

                {/* Radius input: neighbour_radius_km */}
                <div
                  style={{
                    padding: '16px',
                    background: '#F9F9FB',
                    borderRadius: '10px',
                    border: '1px solid #E2E2E8',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <label style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                    Neighbour Search Radius: {policy.neighbour_radius_km} km
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="5.0"
                    step="0.5"
                    value={policy.neighbour_radius_km}
                    onChange={(e) =>
                      updatePolicyMutation.mutate({ neighbour_radius_km: Number(e.target.value) })
                    }
                    style={{ accentColor: '#D9381E', width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#8E8E9E' }}>
                    <span>0.5 km (Immediate)</span>
                    <span>2.5 km</span>
                    <span>5.0 km (Wide)</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Tabs & Search */}
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setVolTab('pending')}
                className={`cat ${volTab === 'pending' ? 'on' : ''}`}
              >
                Pending Approvals
              </button>
              <button
                type="button"
                onClick={() => setVolTab('approved')}
                className={`cat ${volTab === 'approved' ? 'on' : ''}`}
              >
                Approved Volunteers
              </button>
              <button
                type="button"
                onClick={() => setVolTab('rejected')}
                className={`cat ${volTab === 'rejected' ? 'on' : ''}`}
              >
                Rejected
              </button>
              <button
                type="button"
                onClick={() => setVolTab('')}
                className={`cat ${volTab === '' ? 'on' : ''}`}
              >
                All Volunteers
              </button>
            </div>

            <div style={{ position: 'relative', minWidth: '240px' }}>
              <Search className="w-4 h-4 text-[#8E8E9E]" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                className="fld"
                style={{ paddingLeft: '34px', fontSize: '13px' }}
                placeholder="Search volunteers by name..."
                value={volSearch}
                onChange={(e) => setVolSearch(e.target.value)}
              />
            </div>
          </div>

          {volunteersError && (
            <ErrorBanner
              message="Failed to load volunteer applications. Please refresh."
              onRetry={() => refetchVolunteers()}
            />
          )}

          {volunteersLoading ? (
            <SkeletonCard count={3} />
          ) : volunteerList.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<ShieldCheck className="w-6 h-6 text-[#166534]" />}
                title="No volunteers found"
                description={
                  volTab === 'pending'
                    ? 'All volunteer applications have been reviewed. No pending approvals.'
                    : 'No volunteer records match the selected filter.'
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {volunteerList.map((v) => {
                const isPending = v.approval_status === 'pending';
                const isApproved = v.approval_status === 'approved';
                const isRejected = v.approval_status === 'rejected';

                return (
                  <div
                    key={v.id}
                    className="card"
                    style={{
                      padding: '22px 26px',
                      borderLeft: `5px solid ${isApproved ? '#166534' : isRejected ? '#DC2626' : '#D97706'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                            {v.name || v.user_name || 'Volunteer Applicant'}
                          </span>
                          <span
                            className={`chip ${isApproved ? 'ok' : isRejected ? 'bad' : 'warn'}`}
                            style={{ fontWeight: 700 }}
                          >
                            {isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending Approval'}
                          </span>
                          {v.pin_far_from_society && (
                            <span
                              className="chip bad"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}
                              title="Base pin is > 3.0 km from society center"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Far Pin ({v.pin_distance_from_society_km} km away)
                            </span>
                          )}
                        </div>

                        <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                          {v.society_name} {v.block_name ? `· Block ${v.block_name}` : ''}
                          {v.phone ? ` · ${v.phone}` : ''}
                          {v.email ? ` · ${v.email}` : ''}
                          {v.area_label ? ` · ${v.area_label}` : ''}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {isPending && (
                          <>
                            <button
                              type="button"
                              disabled={approveVolMutation.isPending}
                              onClick={() => approveVolMutation.mutate(v.id)}
                              className="btn"
                              style={{
                                background: '#166534',
                                padding: '8px 16px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Check className="w-4 h-4" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingItem({
                                  type: 'volunteer',
                                  id: v.id,
                                  name: v.name || v.user_name || 'Volunteer',
                                });
                                setRejectReason('');
                                setRejectError('');
                                setRejectModalOpen(true);
                              }}
                              className="ghost"
                              style={{
                                color: '#DC2626',
                                borderColor: '#FCA5A5',
                                padding: '8px 14px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <X className="w-4 h-4" />
                              Reject
                            </button>
                          </>
                        )}

                        {isApproved && (
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingItem({
                                type: 'volunteer',
                                id: v.id,
                                name: v.name || v.user_name || 'Volunteer',
                              });
                              setRejectReason('');
                              setRejectError('');
                              setRejectModalOpen(true);
                            }}
                            className="ghost"
                            style={{ color: '#DC2626', padding: '6px 12px', fontSize: '12px' }}
                          >
                            Revoke Approval
                          </button>
                        )}

                        {isRejected && (
                          <button
                            type="button"
                            onClick={() => approveVolMutation.mutate(v.id)}
                            className="btn"
                            style={{ background: '#166534', padding: '6px 14px', fontSize: '12px' }}
                          >
                            Re-Approve
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div
                      style={{
                        background: '#F9F9FB',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '10px',
                        fontSize: '12.5px',
                      }}
                    >
                      <div>
                        <span style={{ color: '#5B5B6B' }}>Base Pin: </span>
                        <strong style={{ color: '#1A1A2E' }}>
                          {v.latitude && v.longitude
                            ? `${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}`
                            : 'Not set'}
                        </strong>
                        {v.pin_label && <span style={{ color: '#8E8E9E' }}> ({v.pin_label})</span>}
                      </div>

                      <div>
                        <span style={{ color: '#5B5B6B' }}>Max Travel: </span>
                        <strong style={{ color: '#1A1A2E' }}>{v.max_travel_km} km</strong>
                      </div>

                      <div>
                        <span style={{ color: '#5B5B6B' }}>Cross-Society Dispatch: </span>
                        <strong style={{ color: v.serves_nearby_societies ? '#166534' : '#5B5B6B' }}>
                          {v.serves_nearby_societies ? 'Yes (Cross-Society)' : 'No (Home Society Only)'}
                        </strong>
                      </div>
                    </div>

                    {/* Far Pin Warning Banner */}
                    {v.pin_far_from_society && (
                      <div
                        style={{
                          background: '#FEF2F2',
                          border: '1px solid #FCA5A5',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          color: '#991B1B',
                          fontSize: '12.5px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>
                          <strong>Warning:</strong> Registered base pin is <strong>{v.pin_distance_from_society_km} km</strong> away from the society center (exceeds the 3.0 km threshold). Verify response viability before approving.
                        </span>
                      </div>
                    )}

                    {isRejected && v.approval_note && (
                      <div style={{ fontSize: '13px', color: '#991B1B', background: '#FEE2E2', padding: '8px 12px', borderRadius: '6px' }}>
                        <strong>Rejection reason:</strong> {v.approval_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: SECURITY GUARDS ── */}
      {staffType === 'security' && (
        <div className="flex flex-col gap-6">
          {/* Sub tabs & Search */}
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setSecTab('pending')}
                className={`cat ${secTab === 'pending' ? 'on' : ''}`}
              >
                Pending Approvals ({pendingSecCount})
              </button>
              <button
                type="button"
                onClick={() => setSecTab('approved')}
                className={`cat ${secTab === 'approved' ? 'on' : ''}`}
              >
                Approved Guards
              </button>
              <button
                type="button"
                onClick={() => setSecTab('rejected')}
                className={`cat ${secTab === 'rejected' ? 'on' : ''}`}
              >
                Rejected
              </button>
              <button
                type="button"
                onClick={() => setSecTab('')}
                className={`cat ${secTab === '' ? 'on' : ''}`}
              >
                All Security Staff
              </button>
            </div>

            <div style={{ position: 'relative', minWidth: '240px' }}>
              <Search className="w-4 h-4 text-[#8E8E9E]" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                className="fld"
                style={{ paddingLeft: '34px', fontSize: '13px' }}
                placeholder="Search guards by name, post, phone..."
                value={secSearch}
                onChange={(e) => setSecSearch(e.target.value)}
              />
            </div>
          </div>

          {securityError && (
            <ErrorBanner
              message="Failed to load security staff roster. Please refresh."
              onRetry={() => refetchSecurity()}
            />
          )}

          {securityLoading ? (
            <SkeletonCard count={3} />
          ) : securityList.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<ShieldCheck className="w-6 h-6 text-[#166534]" />}
                title="No security staff found"
                description={
                  secTab === 'pending'
                    ? 'All security staff registrations have been reviewed. No pending approvals.'
                    : 'No security staff match the selected filter.'
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {securityList.map((sec) => {
                const isPending = sec.approval_status === 'pending';
                const isApproved = sec.approval_status === 'approved';
                const isRejected = sec.approval_status === 'rejected';

                return (
                  <div
                    key={sec.id}
                    className="card"
                    style={{
                      padding: '22px 26px',
                      borderLeft: `5px solid ${isApproved ? '#166534' : isRejected ? '#DC2626' : '#D97706'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div className="flex flex-wrap justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                            {sec.name}
                          </span>
                          <span
                            className={`chip ${isApproved ? 'ok' : isRejected ? 'bad' : 'warn'}`}
                            style={{ fontWeight: 700 }}
                          >
                            {isApproved ? 'Approved · Active' : isRejected ? 'Rejected' : 'Pending Approval'}
                          </span>
                          <span className="chip" style={{ background: '#EFF6FF', color: '#1E40AF', fontWeight: 600 }}>
                            {sec.post_label || 'Gate Guard'}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginTop: '6px',
                            font: '500 13px Inter',
                            color: '#5B5B6B',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span>Username: <strong>@{sec.username}</strong></span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-[#166534]" />
                            {sec.phone}
                          </span>
                          <span>·</span>
                          <span>Society: {sec.society_name}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-[#8E8E9E]" />
                            Registered {formatDistanceToNow(sec.created_at)}
                          </span>
                        </div>
                      </div>

                      {/* Security Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {isPending && (
                          <>
                            <button
                              type="button"
                              disabled={approveSecMutation.isPending}
                              onClick={() => approveSecMutation.mutate(sec.id)}
                              className="btn"
                              style={{
                                background: '#166534',
                                padding: '8px 16px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Check className="w-4 h-4" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingItem({
                                  type: 'security',
                                  id: sec.id,
                                  name: sec.name,
                                });
                                setRejectReason('');
                                setRejectError('');
                                setRejectModalOpen(true);
                              }}
                              className="ghost"
                              style={{
                                color: '#DC2626',
                                borderColor: '#FCA5A5',
                                padding: '8px 14px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <X className="w-4 h-4" />
                              Reject
                            </button>
                          </>
                        )}

                        {isApproved && (
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingItem({
                                type: 'security',
                                id: sec.id,
                                name: sec.name,
                              });
                              setRejectReason('');
                              setRejectError('');
                              setRejectModalOpen(true);
                            }}
                            className="ghost"
                            style={{ color: '#DC2626', padding: '6px 12px', fontSize: '12px' }}
                          >
                            Revoke Approval
                          </button>
                        )}

                        {isRejected && (
                          <button
                            type="button"
                            onClick={() => approveSecMutation.mutate(sec.id)}
                            className="btn"
                            style={{ background: '#166534', padding: '6px 14px', fontSize: '12px' }}
                          >
                            Re-Approve
                          </button>
                        )}
                      </div>
                    </div>

                    {isRejected && sec.approval_note && (
                      <div style={{ fontSize: '13px', color: '#991B1B', background: '#FEE2E2', padding: '8px 12px', borderRadius: '6px' }}>
                        <strong>Rejection reason:</strong> {sec.approval_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalOpen && rejectingItem && (
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
              maxWidth: '460px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                Reject {rejectingItem.type === 'volunteer' ? 'Volunteer' : 'Security Guard'} Application
              </h3>
              <button
                type="button"
                onClick={closeRejectModal}
                className="cursor-pointer text-[#5B5B6B] hover:text-[#1A1A2E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p style={{ fontSize: '13.5px', color: '#5B5B6B' }}>
              Provide a reason for rejecting <strong>{rejectingItem.name}</strong>.
            </p>

            {rejectError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                {rejectError}
              </div>
            )}

            <form onSubmit={handleConfirmReject} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="lbl">Rejection Reason (Required)</label>
                <textarea
                  className="fld"
                  rows={3}
                  placeholder="e.g. Unverified credentials, invalid assignment, or location mismatch."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={closeRejectModal}
                  className="ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejectVolMutation.isPending || rejectSecMutation.isPending}
                  className="btn"
                  style={{ background: '#DC2626' }}
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
