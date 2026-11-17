import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import * as authApi from '../../api/auth';
import { getContacts } from '../../api/contacts';
import { getGuardianDependents } from '../../api/guardianRequests';
import {
  USERNAME_REGEX,
  extractDrfErrors,
  formatPhoneAsTyped,
  normalizePhoneForApi,
} from '../../lib/phone';
import { CONTACT_TYPE_LABELS, ROLE_LABELS, fullName } from '../../lib/formatters';
import { useToast } from '../../components/Toast';
import { SkeletonCard } from '../../components/Skeleton';
import { X, LogOut, ShieldCheck, Users } from 'lucide-react';

const profileSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(
      USERNAME_REGEX,
      'Username must be 3-30 characters (letters, numbers, dots, underscores only)'
    ),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  phone: z
    .string()
    .refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid 10-digit phone number'),
  address: z.string().optional(),
});

const passwordSchema = z
  .object({
    old_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(8, 'New password must be at least 8 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type ProfileData = z.infer<typeof profileSchema>;
type PasswordData = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, refreshProfile, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const isResident = user?.role === 'resident';
  const isGuardian = user?.role === 'guardian';

  const { data: contacts, isLoading: contactsLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
    enabled: isResident,
  });

  const { data: dependents, isLoading: dependentsLoading } = useQuery({
    queryKey: ['guardian-dependents'],
    queryFn: getGuardianDependents,
    enabled: isGuardian,
  });

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Signed out successfully');
      navigate('/login', { replace: true });
    } catch {
      navigate('/login', { replace: true });
    }
  };

  const {
    register: regProfile,
    handleSubmit: handleProfile,
    reset: resetProfile,
    setValue: setProfileValue,
    setError: setProfileError,
    formState: { errors: profileErrors, isSubmitting: profileSubmitting },
  } = useForm<ProfileData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: user?.username || '',
      first_name: user?.first_name || '',
      last_name: user?.last_name || '',
      phone: formatPhoneAsTyped(user?.phone || ''),
      address: user?.address || '',
    },
  });

  useEffect(() => {
    if (user) {
      resetProfile({
        username: user.username || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        phone: formatPhoneAsTyped(user.phone || ''),
        address: user.address || '',
      });
    }
  }, [user, resetProfile]);

  const phoneField = regProfile('phone');

  const {
    register: regPassword,
    handleSubmit: handlePassword,
    reset: resetPassword,
    formState: { errors: passwordErrors, isSubmitting: passwordSubmitting },
  } = useForm<PasswordData>({ resolver: zodResolver(passwordSchema) });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileData) =>
      authApi.updateProfile({
        ...data,
        username: data.username.trim(),
        phone: normalizePhoneForApi(data.phone),
      }),
    onSuccess: async () => {
      await refreshProfile();
      toast.success('Profile updated');
      setEditingPersonal(false);
    },
    onError: (err) => {
      const { fieldErrors, generalError } = extractDrfErrors(err);
      let matched = false;
      for (const [k, msg] of Object.entries(fieldErrors)) {
        if (['username', 'phone', 'first_name', 'last_name', 'address'].includes(k)) {
          setProfileError(k as keyof ProfileData, { type: 'server', message: msg });
          matched = true;
        }
      }
      if (!matched || generalError) {
        toast.error(generalError || 'Could not update profile');
      }
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordData) =>
      authApi.changePassword({ old_password: data.old_password, new_password: data.new_password }),
    onSuccess: () => {
      toast.success('Password changed successfully');
      resetPassword();
      setPasswordModalOpen(false);
    },
    onError: () => toast.error('Could not change password. Check your current password.'),
  });

  const displayName = user ? fullName(user.first_name, user.last_name, user.username) : 'SafeCircle User';
  const displayUsername = user?.username || '';
  const displayPhone = formatPhoneAsTyped(user?.phone || '') || user?.phone || 'Not set';
  const displayEmail = user?.email || '';
  const displayHome = user?.address || 'Not provided';

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Profile &amp; Account
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Manage your unique handle, phone number, security credentials, and session.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="ghost"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#D9381E',
            borderColor: '#FEE2E2',
            background: '#FFF1EA',
            fontWeight: 700,
            padding: '10px 18px',
            cursor: 'pointer',
          }}
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Personal information Card */}
          <div className="card flex flex-col gap-3.5">
            <div className="flex justify-between items-center">
              <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Personal information</h3>
              {!editingPersonal ? (
                <button
                  type="button"
                  onClick={() => setEditingPersonal(true)}
                  className="ghost"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Edit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPersonal(false);
                    if (user) {
                      resetProfile({
                        username: user.username || '',
                        first_name: user.first_name || '',
                        last_name: user.last_name || '',
                        phone: formatPhoneAsTyped(user.phone || ''),
                        address: user.address || '',
                      });
                    }
                  }}
                  className="ghost"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Cancel
                </button>
              )}
            </div>

            {!editingPersonal ? (
              <>
                <div>
                  <div className="lbl">Full name</div>
                  <div className="fld">{displayName}</div>
                </div>
                <div>
                  <div className="lbl">Username</div>
                  <div className="fld">@{displayUsername}</div>
                  <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    Residents &amp; family look you up by your username or phone number.
                  </p>
                </div>
                <div>
                  <div className="lbl">Phone</div>
                  <div className="fld">{displayPhone}</div>
                </div>
                <div>
                  <div className="lbl">Email</div>
                  <div className="fld">{displayEmail}</div>
                </div>
                <div>
                  <div className="lbl">Home / Unit</div>
                  <div className="fld">{displayHome}</div>
                </div>
              </>
            ) : (
              <form
                onSubmit={handleProfile((data) => profileMutation.mutate(data))}
                className="flex flex-col gap-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="prof-first" className="lbl">First name</label>
                    <input id="prof-first" {...regProfile('first_name')} className="fld" />
                    {profileErrors.first_name && (
                      <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                        {profileErrors.first_name.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="prof-last" className="lbl">Last name</label>
                    <input id="prof-last" {...regProfile('last_name')} className="fld" />
                    {profileErrors.last_name && (
                      <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                        {profileErrors.last_name.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="prof-username" className="lbl">Username</label>
                  <input id="prof-username" {...regProfile('username')} className="fld" />
                  <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    Unique handle (3-30 chars) so people on SafeCircle can find you.
                  </p>
                  {profileErrors.username && (
                    <p role="alert" style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                      {profileErrors.username.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="prof-phone" className="lbl">Phone number</label>
                  <input
                    id="prof-phone"
                    type="tel"
                    className="fld"
                    name={phoneField.name}
                    ref={phoneField.ref}
                    onBlur={phoneField.onBlur}
                    defaultValue={formatPhoneAsTyped(user?.phone || '')}
                    onChange={(e) => {
                      const formatted = formatPhoneAsTyped(e.target.value);
                      e.target.value = formatted;
                      setProfileValue('phone', formatted, {
                        shouldValidate: Boolean(profileErrors.phone),
                      });
                    }}
                  />
                  <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    Unique phone number (+91 98765 43210). Used for guardian lookup &amp; alerts.
                  </p>
                  {profileErrors.phone && (
                    <p role="alert" style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                      {profileErrors.phone.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="prof-address" className="lbl">Home / Unit</label>
                  <input id="prof-address" {...regProfile('address')} className="fld" />
                </div>

                <button
                  type="submit"
                  disabled={profileSubmitting || profileMutation.isPending}
                  className="btn self-start mt-1"
                >
                  {profileMutation.isPending ? 'Saving...' : 'Save changes'}
                </button>
              </form>
            )}
          </div>

          {/* Security Card */}
          <div className="card flex justify-between items-center gap-4">
            <div>
              <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Security</h3>
              <p style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                Change your account password
              </p>
            </div>
            <button onClick={() => setPasswordModalOpen(true)} className="btn" type="button">
              Update
            </button>
          </div>
        </div>

        {/* Right Column (5 cols): Live Safety Circle / Dependents / Role Summary */}
        <div className="lg:col-span-5 card flex flex-col gap-3">
          {isResident ? (
            <>
              <div className="flex justify-between items-center gap-2">
                <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Your Safety Circle</h3>
                <button
                  type="button"
                  onClick={() => navigate('/resident/contacts')}
                  className="ghost"
                  style={{ padding: '5px 12px', fontSize: '12px' }}
                >
                  Manage
                </button>
              </div>
              <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                Live status of your guardians and emergency contacts.
              </p>

              {contactsLoading ? (
                <SkeletonCard count={2} />
              ) : !contacts || contacts.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#FFF1EA] border border-[#FFD6C4] flex flex-col gap-2">
                  <div style={{ font: '700 14px Inter', color: '#B93412' }}>
                    No contacts added yet
                  </div>
                  <p style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                    Add a registered guardian by their username or phone number so they receive SOS alerts.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/resident/contacts')}
                    className="btn self-start"
                    style={{ padding: '8px 14px', fontSize: '13px' }}
                  >
                    Add Guardian
                  </button>
                </div>
              ) : (
                contacts.map((c, idx) => {
                  const chipCls =
                    c.status === 'accepted'
                      ? 'ok'
                      : c.status === 'declined'
                      ? 'bad'
                      : 'warn';
                  const chipLabel =
                    c.contact_type === 'emergency_contact' && !c.linked_user
                      ? 'SMS only'
                      : c.status === 'accepted'
                      ? 'Verified'
                      : c.status === 'declined'
                      ? 'Declined'
                      : 'Pending';
                  return (
                    <div
                      key={c.id}
                      className="flex justify-between items-center py-3 gap-3"
                      style={{
                        borderBottom: idx === contacts.length - 1 ? 'none' : '1px solid #F0F0F4',
                      }}
                    >
                      <div className="min-w-0">
                        <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>
                          {CONTACT_TYPE_LABELS[c.contact_type]}
                        </div>
                        <div className="truncate" style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '2px' }}>
                          {c.name} · {c.masked_phone || c.phone}
                        </div>
                      </div>
                      <span className={`chip ${chipCls}`}>{chipLabel}</span>
                    </div>
                  );
                })
              )}
            </>
          ) : isGuardian ? (
            <>
              <div className="flex justify-between items-center gap-2">
                <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Residents I Protect</h3>
                <button
                  type="button"
                  onClick={() => navigate('/guardian/alerts')}
                  className="ghost"
                  style={{ padding: '5px 12px', fontSize: '12px' }}
                >
                  View Alerts
                </button>
              </div>
              {dependentsLoading ? (
                <SkeletonCard count={2} />
              ) : !dependents || dependents.length === 0 ? (
                <p style={{ font: '500 13px Inter', color: '#5B5B6B' }}>
                  No verified dependents yet. Share your handle <strong>@{displayUsername}</strong> or phone{' '}
                  <strong>{displayPhone}</strong> so residents can send you a guardian request.
                </p>
              ) : (
                dependents.map((d, idx) => (
                  <div
                    key={d.contact_id}
                    className="flex justify-between items-center py-3 gap-2"
                    style={{ borderBottom: idx === dependents.length - 1 ? 'none' : '1px solid #F0F0F4' }}
                  >
                    <div>
                      <div style={{ font: '700 14px Inter', color: '#1A1A2E' }}>{d.name}</div>
                      <div style={{ font: '500 12px Inter', color: '#5B5B6B' }}>
                        {d.flat} {d.society ? `· ${d.society}` : ''}
                      </div>
                    </div>
                    <span className={`chip ${d.has_active_incident ? 'bad' : 'ok'}`}>
                      {d.has_active_incident ? 'SOS Active' : 'Safe'}
                    </span>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#B93412]" />
                <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>
                  {ROLE_LABELS[user?.role || 'resident'] || 'Account'} Profile
                </h3>
              </div>
              <p style={{ font: '500 13px Inter', color: '#5B5B6B', lineHeight: 1.5 }}>
                Your handle <strong>@{displayUsername}</strong> and phone <strong>{displayPhone}</strong> uniquely identify your account on SafeCircle.
              </p>
              <div className="p-3 rounded-xl bg-[#F7F7FA] flex items-center gap-2 text-xs font-semibold text-[#5B5B6B]">
                <Users className="w-4 h-4 text-[#1A1A2E]" />
                <span>Role: {ROLE_LABELS[user?.role || 'resident']}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Password Modal */}
      {passwordModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20,20,40,0.4)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '420px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ font: '800 20px Inter', color: '#1A1A2E' }}>Change Password</h3>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="cursor-pointer text-[#5B5B6B] hover:text-[#1A1A2E]"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handlePassword((data) => passwordMutation.mutate(data))}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <label className="lbl">Current password</label>
                <input {...regPassword('old_password')} type="password" className="fld" />
                {passwordErrors.old_password && (
                  <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                    {passwordErrors.old_password.message}
                  </p>
                )}
              </div>

              <div>
                <label className="lbl">New password (min 8 characters)</label>
                <input {...regPassword('new_password')} type="password" className="fld" />
                {passwordErrors.new_password && (
                  <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                    {passwordErrors.new_password.message}
                  </p>
                )}
              </div>

              <div>
                <label className="lbl">Confirm new password</label>
                <input {...regPassword('confirm_password')} type="password" className="fld" />
                {passwordErrors.confirm_password && (
                  <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                    {passwordErrors.confirm_password.message}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setPasswordModalOpen(false)} className="ghost">
                  Cancel
                </button>
                <button type="submit" disabled={passwordSubmitting} className="btn">
                  {passwordSubmitting ? 'Updating...' : 'Update password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
