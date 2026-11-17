import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as authApi from '../../api/auth';
import { getPublicSocieties, getPublicBlocks, getPublicFlats } from '../../api/society';
import {
  USERNAME_REGEX,
  extractDrfErrors,
  formatPhoneAsTyped,
  normalizePhoneForApi,
} from '../../lib/phone';
import { LocationPicker } from '../../components/LocationPicker';
import { Loader2, ShieldCheck, MapPin, Building, Home, Users } from 'lucide-react';

const schema = z
  .object({
    first_name: z.string().min(1, 'First name is required'),
    last_name: z.string().min(1, 'Last name is required'),
    username: z
      .string()
      .trim()
      .regex(
        USERNAME_REGEX,
        'Username must be 3-30 chars (letters, numbers, dots, underscores only)'
      ),
    email: z.string().email('Enter a valid email'),
    phone: z
      .string()
      .refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a valid 10-digit phone number'),
    role: z.enum(['resident', 'guardian', 'volunteer', 'security']),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),

    // Society & Flat mappings (Resident)
    society_id: z.coerce.number().optional().nullable(),
    block_id: z.coerce.number().optional().nullable(),
    flat_id: z.coerce.number().optional().nullable(),
    home_latitude: z.coerce.number().optional().nullable(),
    home_longitude: z.coerce.number().optional().nullable(),
    home_label: z.string().optional(),

    // Volunteer
    area_label: z.string().optional(),
    base_latitude: z.coerce.number().optional().nullable(),
    base_longitude: z.coerce.number().optional().nullable(),
    max_travel_km: z.coerce.number().default(3.0),
    serves_nearby_societies: z.boolean().default(false),

    // Security
    post_label: z.string().optional(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })
  .refine(
    (d) => {
      if (d.role === 'resident') {
        return Boolean(d.society_id && d.society_id > 0);
      }
      return true;
    },
    { message: 'Please select your residential society', path: ['society_id'] }
  )
  .refine(
    (d) => {
      if (d.role === 'resident') {
        return Boolean(d.block_id && d.block_id > 0);
      }
      return true;
    },
    { message: 'Please select your block or tower', path: ['block_id'] }
  )
  .refine(
    (d) => {
      if (d.role === 'resident') {
        return Boolean(d.flat_id && d.flat_id > 0);
      }
      return true;
    },
    { message: 'Please select your flat unit', path: ['flat_id'] }
  )
  .refine(
    (d) => {
      if (d.role === 'volunteer') {
        return Boolean(d.society_id && d.society_id > 0);
      }
      return true;
    },
    { message: 'Please select your primary society', path: ['society_id'] }
  )
  .refine(
    (d) => {
      if (d.role === 'volunteer') {
        return (
          d.base_latitude !== null &&
          d.base_latitude !== undefined &&
          !isNaN(d.base_latitude) &&
          d.base_longitude !== null &&
          d.base_longitude !== undefined &&
          !isNaN(d.base_longitude)
        );
      }
      return true;
    },
    { message: 'Please set your base location pin on the map', path: ['base_latitude'] }
  )
  .refine(
    (d) => {
      if (d.role === 'security') {
        return Boolean(d.society_id && d.society_id > 0);
      }
      return true;
    },
    { message: 'Please select the society you guard', path: ['society_id'] }
  )
  .refine(
    (d) => {
      if (d.role === 'security') {
        return Boolean(d.post_label && d.post_label.trim().length > 0);
      }
      return true;
    },
    { message: 'Security post label is required (e.g. Main Gate)', path: ['post_label'] }
  );

type FormData = z.infer<typeof schema>;

const roleOptions: { value: FormData['role']; label: string }[] = [
  { value: 'resident', label: 'Resident' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'security', label: 'Security' },
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');

  // Cascading options state
  const [societies, setSocieties] = useState<Array<{ id: number; name: string; city: string; latitude: number | null; longitude: number | null }>>([]);
  const [blocks, setBlocks] = useState<Array<{ id: number; name: string; total_floors: number }>>([]);
  const [flats, setFlats] = useState<Array<{ id: number; flat_number: string; floor: number }>>([]);
  const [loadingSocieties, setLoadingSocieties] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [loadingFlats, setLoadingFlats] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      role: 'resident',
      phone: '',
      max_travel_km: 3.0,
      serves_nearby_societies: false,
    },
  });

  const selectedRole = watch('role');
  const selectedSocietyId = watch('society_id');
  const selectedBlockId = watch('block_id');
  const selectedTravelRadius = watch('max_travel_km');
  const phoneField = register('phone');

  // Load public societies on mount
  useEffect(() => {
    let active = true;
    setLoadingSocieties(true);
    getPublicSocieties()
      .then((data) => {
        if (active) setSocieties(data);
      })
      .catch((err) => console.error('Failed to load public societies:', err))
      .finally(() => {
        if (active) setLoadingSocieties(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Cascading blocks when society changes
  useEffect(() => {
    if (!selectedSocietyId || Number(selectedSocietyId) <= 0) {
      setBlocks([]);
      setFlats([]);
      setValue('block_id', null);
      setValue('flat_id', null);
      return;
    }

    let active = true;
    setLoadingBlocks(true);
    setValue('block_id', null);
    setValue('flat_id', null);
    getPublicBlocks(Number(selectedSocietyId))
      .then((data) => {
        if (active) setBlocks(data);
      })
      .catch((err) => console.error('Failed to load blocks:', err))
      .finally(() => {
        if (active) setLoadingBlocks(false);
      });

    return () => {
      active = false;
    };
  }, [selectedSocietyId, setValue]);

  // Cascading flats when block changes
  useEffect(() => {
    if (!selectedBlockId || Number(selectedBlockId) <= 0) {
      setFlats([]);
      setValue('flat_id', null);
      return;
    }

    let active = true;
    setLoadingFlats(true);
    setValue('flat_id', null);
    getPublicFlats(Number(selectedBlockId))
      .then((data) => {
        if (active) setFlats(data);
      })
      .catch((err) => console.error('Failed to load flats:', err))
      .finally(() => {
        if (active) setLoadingFlats(false);
      });

    return () => {
      active = false;
    };
  }, [selectedBlockId, setValue]);

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const payload: any = {
        ...data,
        username: data.username.trim(),
        phone: normalizePhoneForApi(data.phone),
      };

      // Clean up empty optional fields depending on role
      if (data.role === 'resident') {
        payload.society_id = Number(data.society_id);
        payload.block_id = Number(data.block_id);
        payload.flat_id = Number(data.flat_id);
        if (data.home_latitude && data.home_longitude) {
          payload.home_latitude = Number(data.home_latitude);
          payload.home_longitude = Number(data.home_longitude);
          payload.home_label = data.home_label || '';
        }
      } else if (data.role === 'volunteer') {
        payload.society_id = Number(data.society_id);
        if (data.block_id) payload.block_id = Number(data.block_id);
        payload.base_latitude = Number(data.base_latitude);
        payload.base_longitude = Number(data.base_longitude);
        payload.area_label = data.area_label || '';
        payload.max_travel_km = Number(data.max_travel_km || 3.0);
        payload.serves_nearby_societies = Boolean(data.serves_nearby_societies);
      } else if (data.role === 'security') {
        payload.society_id = Number(data.society_id);
        payload.post_label = data.post_label?.trim() || '';
      }

      await authApi.register(payload);

      // On successful registration
      if (data.role === 'volunteer' || data.role === 'security') {
        navigate('/login', {
          state: {
            registered: true,
            approvalPending: true,
            message:
              'Account created! Your registration has been submitted to your society administrator for approval.',
          },
        });
      } else {
        navigate('/login', { state: { registered: true } });
      }
    } catch (err: unknown) {
      const { fieldErrors, generalError } = extractDrfErrors(err);
      let assignedField = false;
      for (const [key, message] of Object.entries(fieldErrors)) {
        if (key in data) {
          setError(key as keyof FormData, { type: 'server', message });
          assignedField = true;
        }
      }
      if (!assignedField && generalError) {
        setServerError(generalError);
      }
    }
  };

  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row overflow-x-hidden">
      {/* ── Left Red Gradient Panel ── */}
      <section
        className="flex-1 flex flex-col justify-center gap-7 text-white"
        style={{
          background: 'linear-gradient(150deg, #C2330F, #8E1D0B)',
          padding: '72px',
          minHeight: '400px',
        }}
      >
        <div style={{ font: '800 28px Inter', letterSpacing: '-0.02em' }}>SafeCircle</div>
        <h1 style={{ font: '800 52px/1.1 Inter', letterSpacing: '-0.02em' }}>Help is one tap away.</h1>
        <p style={{ font: '500 18px/1.5 Inter', maxWidth: '460px', opacity: 0.95 }}>
          Alert your guardian, society security and nearby volunteers in seconds, and follow every step until you are safe.
        </p>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            font: '600 16px Inter',
          }}
        >
          <li className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-red-200" /> One-tap SOS with live location
          </li>
          <li className="flex items-center gap-2">
            <Users className="w-5 h-5 text-red-200" /> Verified guardians &amp; guards alerted
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-red-200" /> Precise community-based escalation
          </li>
        </ul>
      </section>

      {/* ── Right White Form Panel ── */}
      <section className="w-full lg:w-[680px] shrink-0 bg-white flex items-center justify-center p-6 sm:p-10 overflow-y-auto">
        <form
          onSubmit={handleSubmit(onSubmit)}
          style={{
            width: '100%',
            maxWidth: '520px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            paddingTop: '20px',
            paddingBottom: '30px',
          }}
        >
          <h2 style={{ font: '800 32px Inter', color: '#1A1A2E' }}>Create account</h2>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B' }}>
            Join your community's emergency response network.
          </p>

          {serverError && (
            <div
              role="alert"
              className="chip bad"
              style={{
                padding: '10px 14px',
                borderRadius: '12px',
                fontSize: '13px',
                display: 'block',
                lineHeight: 1.4,
              }}
            >
              {serverError}
            </div>
          )}

          {/* Role selector */}
          <div>
            <div className="lbl" style={{ marginBottom: '8px' }}>Select your role</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {roleOptions.map((opt) => {
                const isSelected = selectedRole === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setValue('role', opt.value)}
                    className={`cat ${isSelected ? 'on' : ''}`}
                    style={{ flex: 1, minWidth: '85px', textAlign: 'center' }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {errors.role && (
              <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                {errors.role.message}
              </p>
            )}
          </div>

          {/* First & Last Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="reg-first-name" className="lbl">First name *</label>
              <input
                id="reg-first-name"
                type="text"
                className="fld"
                placeholder="Asha"
                {...register('first_name')}
              />
              {errors.first_name && (
                <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                  {errors.first_name.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reg-last-name" className="lbl">Last name *</label>
              <input
                id="reg-last-name"
                type="text"
                className="fld"
                placeholder="Rao"
                {...register('last_name')}
              />
              {errors.last_name && (
                <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                  {errors.last_name.message}
                </p>
              )}
            </div>
          </div>

          {/* Username */}
          <div>
            <label htmlFor="reg-username" className="lbl">Username *</label>
            <input
              id="reg-username"
              type="text"
              className="fld"
              placeholder="asha.rao"
              {...register('username')}
            />
            <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
              Unique handle (3-30 chars: letters, digits, . or _) for emergency search.
            </p>
            {errors.username && (
              <p role="alert" style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                {errors.username.message}
              </p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="reg-email" className="lbl">Email address *</label>
            <input
              id="reg-email"
              type="email"
              className="fld"
              placeholder="asha@example.com"
              {...register('email')}
            />
            {errors.email && (
              <p role="alert" style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="reg-phone" className="lbl">Phone number *</label>
            <input
              id="reg-phone"
              type="tel"
              className="fld"
              placeholder="+91 98765 43210"
              name={phoneField.name}
              ref={phoneField.ref}
              onBlur={phoneField.onBlur}
              onChange={(e) => {
                const formatted = formatPhoneAsTyped(e.target.value);
                e.target.value = formatted;
                setValue('phone', formatted, { shouldValidate: Boolean(errors.phone) });
              }}
            />
            <p style={{ font: '500 12px Inter', color: '#5B5B6B', marginTop: '4px' }}>
              Required &amp; unique — contacts &amp; guards will call you here during emergencies.
            </p>
            {errors.phone && (
              <p role="alert" style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                {errors.phone.message}
              </p>
            )}
          </div>

          {/* ── ROLE-SPECIFIC SECTIONS ── */}

          {/* RESIDENT: Society -> Block -> Flat & optional home pin */}
          {selectedRole === 'resident' && (
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3.5">
              <div className="flex items-center gap-2 text-neutral-900 font-bold text-sm">
                <Building className="w-4 h-4 text-red-600" />
                <span>Your Residential Complex</span>
              </div>

              <div>
                <label className="lbl">Society *</label>
                <select
                  className="fld"
                  value={watch('society_id') || ''}
                  onChange={(e) => setValue('society_id', Number(e.target.value) || null)}
                  disabled={loadingSocieties}
                >
                  <option value="">Select your society</option>
                  {societies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.city})
                    </option>
                  ))}
                </select>
                {errors.society_id && (
                  <p className="text-xs font-semibold text-red-600 mt-1">{errors.society_id.message}</p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="lbl">Block / Tower *</label>
                  <select
                    className="fld"
                    value={watch('block_id') || ''}
                    onChange={(e) => setValue('block_id', Number(e.target.value) || null)}
                    disabled={!selectedSocietyId || loadingBlocks}
                  >
                    <option value="">Select block</option>
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {errors.block_id && (
                    <p className="text-xs font-semibold text-red-600 mt-1">{errors.block_id.message}</p>
                  )}
                </div>

                <div>
                  <label className="lbl">Flat Number *</label>
                  <select
                    className="fld"
                    value={watch('flat_id') || ''}
                    onChange={(e) => setValue('flat_id', Number(e.target.value) || null)}
                    disabled={!selectedBlockId || loadingFlats}
                  >
                    <option value="">Select flat</option>
                    {flats.map((f) => (
                      <option key={f.id} value={f.id}>
                        Flat {f.flat_number} (Floor {f.floor})
                      </option>
                    ))}
                  </select>
                  {errors.flat_id && (
                    <p className="text-xs font-semibold text-red-600 mt-1">{errors.flat_id.message}</p>
                  )}
                </div>
              </div>

              {/* Optional Home GPS Pin */}
              <div className="pt-2">
                <LocationPicker
                  label="Home GPS Pin (Optional)"
                  hint="Pin your exact flat on the map for faster responder routing."
                  height="180px"
                  value={{
                    latitude: watch('home_latitude'),
                    longitude: watch('home_longitude'),
                    label: watch('home_label'),
                  }}
                  onChange={(loc) => {
                    setValue('home_latitude', loc?.latitude ?? null);
                    setValue('home_longitude', loc?.longitude ?? null);
                    if (loc?.label) setValue('home_label', loc.label);
                  }}
                />
              </div>
            </div>
          )}

          {/* VOLUNTEER: Society, Block, Area label, Base pin, Travel radius, Cross-society */}
          {selectedRole === 'volunteer' && (
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3.5">
              <div className="flex items-center gap-2 text-neutral-900 font-bold text-sm">
                <Home className="w-4 h-4 text-red-600" />
                <span>Volunteer Coverage Area</span>
              </div>

              <div>
                <label className="lbl">Primary Society *</label>
                <select
                  className="fld"
                  value={watch('society_id') || ''}
                  onChange={(e) => setValue('society_id', Number(e.target.value) || null)}
                  disabled={loadingSocieties}
                >
                  <option value="">Select society you primarily serve</option>
                  {societies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.city})
                    </option>
                  ))}
                </select>
                {errors.society_id && (
                  <p className="text-xs font-semibold text-red-600 mt-1">{errors.society_id.message}</p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="lbl">Block (Optional)</label>
                  <select
                    className="fld"
                    value={watch('block_id') || ''}
                    onChange={(e) => setValue('block_id', Number(e.target.value) || null)}
                    disabled={!selectedSocietyId || loadingBlocks}
                  >
                    <option value="">Select block if resident</option>
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="lbl">Area / Building Label</label>
                  <input
                    type="text"
                    className="fld"
                    placeholder="e.g. Tower B, Green Meadows"
                    {...register('area_label')}
                  />
                </div>
              </div>

              {/* Base Location Pin (REQUIRED for volunteers) */}
              <div>
                <LocationPicker
                  required
                  label="Volunteer Base Location Pin *"
                  hint="Emergency alerts are routed based on proximity to this location."
                  height="200px"
                  value={{
                    latitude: watch('base_latitude'),
                    longitude: watch('base_longitude'),
                  }}
                  onChange={(loc) => {
                    setValue('base_latitude', loc?.latitude ?? null);
                    setValue('base_longitude', loc?.longitude ?? null);
                  }}
                />
                {errors.base_latitude && (
                  <p className="text-xs font-semibold text-red-600 mt-1">{errors.base_latitude.message}</p>
                )}
              </div>

              {/* Travel Radius Chips */}
              <div>
                <label className="lbl">Maximum Travel Radius</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {[1, 2, 3, 5, 10].map((km) => (
                    <button
                      key={km}
                      type="button"
                      onClick={() => setValue('max_travel_km', km)}
                      className={`cat ${Number(selectedTravelRadius) === km ? 'on' : ''}`}
                    >
                      {km} km
                    </button>
                  ))}
                </div>
              </div>

              {/* Cross-society toggle */}
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  id="serves-nearby"
                  className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500"
                  {...register('serves_nearby_societies')}
                />
                <label htmlFor="serves-nearby" className="text-xs text-neutral-700 font-medium cursor-pointer">
                  Available to assist neighbouring societies within my travel radius
                </label>
              </div>
            </div>
          )}

          {/* SECURITY: Society, Post Label */}
          {selectedRole === 'security' && (
            <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3.5">
              <div className="flex items-center gap-2 text-neutral-900 font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-red-600" />
                <span>Security Duty Assignment</span>
              </div>

              <div>
                <label className="lbl">Society *</label>
                <select
                  className="fld"
                  value={watch('society_id') || ''}
                  onChange={(e) => setValue('society_id', Number(e.target.value) || null)}
                  disabled={loadingSocieties}
                >
                  <option value="">Select your assigned society</option>
                  {societies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.city})
                    </option>
                  ))}
                </select>
                {errors.society_id && (
                  <p className="text-xs font-semibold text-red-600 mt-1">{errors.society_id.message}</p>
                )}
              </div>

              <div>
                <label className="lbl">Security Post / Gate Label *</label>
                <input
                  type="text"
                  className="fld"
                  placeholder="e.g. Main Gate, Tower A Desk, Patrol"
                  {...register('post_label')}
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Residents will see this post label on their security guard cards.
                </p>
                {errors.post_label && (
                  <p className="text-xs font-semibold text-red-600 mt-1">{errors.post_label.message}</p>
                )}
              </div>
            </div>
          )}

          {/* Passwords */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="reg-password" className="lbl">Password *</label>
              <input
                id="reg-password"
                type="password"
                className="fld"
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && (
                <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                  {errors.password.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reg-confirm-password" className="lbl">Confirm password *</label>
              <input
                id="reg-confirm-password"
                type="password"
                className="fld"
                placeholder="••••••••"
                {...register('confirm_password')}
              />
              {errors.confirm_password && (
                <p style={{ font: '600 12px Inter', color: '#D9381E', marginTop: '4px' }}>
                  {errors.confirm_password.message}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn"
            style={{
              marginTop: '8px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>

          <p style={{ font: '500 14px Inter', color: '#5B5B6B', textAlign: 'center' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#B93412', fontWeight: 700 }}>
              Log in
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
