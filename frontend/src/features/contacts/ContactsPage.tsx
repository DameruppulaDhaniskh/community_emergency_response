import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getContacts,
  createContact,
  updateContact,
  deleteContact,
  cancelContactRequest,
  resendContactRequest,
  getResidentSecurityGuards,
  createResidentSecurityGuard,
  deleteResidentSecurityGuard,
  getResidentSocietySecurity,
  type ResidentSecurityGuardItem,
} from '../../api/contacts';
import { lookupUser } from '../../api/users';
import {
  getEscalationSettings,
  updateEscalationSettings,
} from '../../api/incidents';
import { useToast } from '../../components/Toast';
import type {
  EmergencyContact,
  ContactType,
  Relationship,
  UserLookupResult,
  ResidentEscalationSettings,
} from '../../api/types';
import {
  Users,
  AlertTriangle,
  Clock,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  X,
  Search,
  Check,
  Radio,
  Sliders,
  Shield,
  Phone,
} from 'lucide-react';

export default function ContactsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Contact modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);

  // Form state
  const [contactType, setContactType] = useState<ContactType>('primary_guardian');
  const [relationship, setRelationship] = useState<Relationship>('sibling');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<UserLookupResult | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [formError, setFormError] = useState('');

  const isGuardian = contactType === 'primary_guardian' || contactType === 'secondary_guardian';

  // Add Guard Modal state
  const [addGuardOpen, setAddGuardOpen] = useState(false);
  const [guardTab, setGuardTab] = useState<'society' | 'building'>('society');
  const [selectedStaffUser, setSelectedStaffUser] = useState<number | null>(null);
  const [buildingGuardName, setBuildingGuardName] = useState('');
  const [buildingGuardPhone, setBuildingGuardPhone] = useState('');
  const [buildingGuardPost, setBuildingGuardPost] = useState('');
  const [guardModalError, setGuardModalError] = useState('');

  // ── Queries ──
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  });

  const { data: residentGuards = [] } = useQuery({
    queryKey: ['resident-guards'],
    queryFn: getResidentSecurityGuards,
  });

  const { data: societySecurityStaff = [] } = useQuery({
    queryKey: ['society-security-staff'],
    queryFn: getResidentSocietySecurity,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['escalation-settings'],
    queryFn: getEscalationSettings,
  });

  // ── Mutations ──
  const addGuardMutation = useMutation({
    mutationFn: (data: Partial<ResidentSecurityGuardItem>) => createResidentSecurityGuard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resident-guards'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      toast.success('Security guard added to your safety circle');
      setAddGuardOpen(false);
    },
    onError: (err: any) => {
      setGuardModalError(err?.response?.data?.detail || err?.response?.data?.linked_user || 'Failed to add security guard');
    },
  });

  const deleteGuardMutation = useMutation({
    mutationFn: (id: number) => deleteResidentSecurityGuard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resident-guards'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      toast.success('Security guard removed');
    },
    onError: () => {
      toast.error('Failed to remove security guard');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      toast.success('Contact removed');
    },
    onError: () => {
      toast.error('Failed to remove contact');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelContactRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      toast.success('Guardian request cancelled');
    },
    onError: () => {
      toast.error('Failed to cancel request');
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => resendContactRequest(id),
    onSuccess: () => {
      toast.success('Guardian invitation resent');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || 'Failed to resend invitation';
      toast.error(msg);
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<ResidentEscalationSettings>) => updateEscalationSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      toast.success('Escalation settings updated');
    },
    onError: () => {
      toast.error('Failed to update escalation settings');
    },
  });

  // ── Modal Handlers ──
  const handleOpenAdd = (defaultType?: ContactType) => {
    setEditingContact(null);
    setContactType(defaultType || 'primary_guardian');
    setRelationship('sibling');
    setIdentifier('');
    setName('');
    setPhone('');
    setEmail('');
    setLookupResult(null);
    setLookupError('');
    setFormError('');
    setModalOpen(true);
  };

  const handleOpenEdit = (c: EmergencyContact) => {
    setEditingContact(c);
    setContactType(c.contact_type);
    setRelationship(c.relationship || 'sibling');
    setIdentifier(c.linked_username || c.phone || '');
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email || '');
    setLookupResult(null);
    setLookupError('');
    setFormError('');
    setModalOpen(true);
  };

  const handleLookup = async () => {
    if (!identifier.trim()) {
      setLookupError('Enter a username or 10-digit phone number');
      return;
    }
    setIsLookingUp(true);
    setLookupError('');
    setLookupResult(null);
    try {
      const res = await lookupUser(identifier.trim());
      setLookupResult(res);
      setName(res.name);
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'No account found with that username or phone.';
      setLookupError(msg);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    try {
      if (editingContact) {
        await updateContact(editingContact.id, {
          name,
          phone,
          email,
          relationship,
        });
        toast.success('Contact updated');
      } else {
        const isGuardian = contactType === 'primary_guardian' || contactType === 'secondary_guardian';
        if (isGuardian) {
          if (!identifier.trim()) {
            setFormError("Please enter the guardian's username or phone number.");
            return;
          }
          await createContact({
            contact_type: contactType,
            relationship,
            identifier: identifier.trim(),
            priority: contactType === 'primary_guardian' ? 1 : 2,
          });
          toast.success(`Guardian request sent to ${lookupResult?.name || identifier}`);
        } else {
          if (!name.trim() || !phone.trim()) {
            setFormError('Name and phone are required for emergency contacts.');
            return;
          }
          await createContact({
            contact_type: 'emergency_contact',
            relationship,
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            priority: 3,
          });
          toast.success('Emergency contact added');
        }
      }

      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-settings'] });
      setModalOpen(false);
    } catch (err: any) {
      const fieldErrors = err.response?.data;
      if (typeof fieldErrors === 'object' && fieldErrors !== null) {
        const firstKey = Object.keys(fieldErrors)[0];
        const firstVal = fieldErrors[firstKey];
        const msg = Array.isArray(firstVal) ? firstVal[0] : String(firstVal);
        setFormError(`${firstKey}: ${msg}`);
      } else {
        setFormError('Failed to save contact. Please verify details.');
      }
    }
  };

  const primary = contacts.find((c) => c.contact_type === 'primary_guardian');
  const secondary = contacts.find((c) => c.contact_type === 'secondary_guardian');
  const emergencyList = contacts.filter((c) => c.contact_type === 'emergency_contact');

  const preview = settings?.preview;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1020px] mx-auto pb-12">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ font: '800 32px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Emergency Contacts & Safety Circle
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '6px' }}>
            Choose verified guardians and customize automatic SOS escalation when you need urgent help.
          </p>
        </div>
        <button onClick={() => handleOpenAdd()} className="btn" type="button" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {/* No Verified Guardian Warning */}
      {preview && !preview.has_verified_guardian && (
        <div
          style={{
            background: '#FEF2F2',
            border: '1px solid #F87171',
            borderRadius: '12px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <AlertTriangle className="w-6 h-6 text-[#DC2626] flex-shrink-0" />
          <div style={{ fontSize: '14px', color: '#991B1B', lineHeight: '1.4' }}>
            <strong style={{ fontWeight: 700 }}>No verified guardian active.</strong> In an emergency SOS, SafeCircle will skip the guardian waiting period and immediately escalate to building security and nearby volunteers.
          </div>
        </div>
      )}

      {/* Primary & Secondary Guardians Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {/* Card 1: Primary Guardian */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            borderTop: `5px solid ${primary ? (primary.is_verified ? '#166534' : '#D97706') : '#E2E2E8'}`,
            padding: '22px',
            minHeight: '210px',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
                PRIMARY GUARDIAN
              </span>
              {primary && (
                <span className={`chip ${primary.is_verified ? 'ok' : primary.status === 'declined' ? 'danger' : 'warn'}`}>
                  {primary.is_verified ? 'Verified' : primary.status === 'declined' ? 'Declined' : 'Pending Approval'}
                </span>
              )}
            </div>

            {primary ? (
              <div style={{ marginTop: '12px' }}>
                <div style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
                  {primary.name}
                </div>
                <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                  {primary.relationship ? `${primary.relationship.charAt(0).toUpperCase() + primary.relationship.slice(1)} · ` : ''}
                  {primary.masked_phone || primary.phone}
                </div>
                {primary.linked_username && (
                  <div style={{ font: '500 12px Inter', color: '#8E8E9E', marginTop: '2px' }}>
                    @{primary.linked_username}
                  </div>
                )}
                {!primary.is_verified && primary.status === 'pending' && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#B45309', background: '#FEF3C7', padding: '6px 10px', borderRadius: '6px' }}>
                    Waiting for {primary.name} to accept invitation in their SafeCircle app.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: '16px', color: '#5B5B6B', fontSize: '14px' }}>
                No primary guardian set. The primary guardian receives instant SOS notifications with GPS coordinates.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            {primary ? (
              <>
                <button onClick={() => handleOpenEdit(primary)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                {primary.status === 'pending' && (
                  <>
                    <button onClick={() => resendMutation.mutate(primary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                      <RotateCcw className="w-3.5 h-3.5" /> Resend
                    </button>
                    <button onClick={() => cancelMutation.mutate(primary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#DC2626' }}>
                      Cancel
                    </button>
                  </>
                )}
                <button onClick={() => deleteMutation.mutate(primary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#DC2626' }}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </>
            ) : (
              <button onClick={() => handleOpenAdd('primary_guardian')} className="btn" type="button" style={{ fontSize: '13px' }}>
                + Add Primary Guardian
              </button>
            )}
          </div>
        </div>

        {/* Card 2: Secondary Guardian */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            borderTop: `5px solid ${secondary ? (secondary.is_verified ? '#166534' : '#D97706') : '#E2E2E8'}`,
            padding: '22px',
            minHeight: '210px',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
                SECONDARY GUARDIAN
              </span>
              {secondary && (
                <span className={`chip ${secondary.is_verified ? 'ok' : secondary.status === 'declined' ? 'danger' : 'warn'}`}>
                  {secondary.is_verified ? 'Verified' : secondary.status === 'declined' ? 'Declined' : 'Pending Approval'}
                </span>
              )}
            </div>

            {secondary ? (
              <div style={{ marginTop: '12px' }}>
                <div style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
                  {secondary.name}
                </div>
                <div style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '4px' }}>
                  {secondary.relationship ? `${secondary.relationship.charAt(0).toUpperCase() + secondary.relationship.slice(1)} · ` : ''}
                  {secondary.masked_phone || secondary.phone}
                </div>
                {secondary.linked_username && (
                  <div style={{ font: '500 12px Inter', color: '#8E8E9E', marginTop: '2px' }}>
                    @{secondary.linked_username}
                  </div>
                )}
                {!secondary.is_verified && secondary.status === 'pending' && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#B45309', background: '#FEF3C7', padding: '6px 10px', borderRadius: '6px' }}>
                    Waiting for {secondary.name} to accept invitation.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: '16px', color: '#5B5B6B', fontSize: '14px' }}>
                No secondary guardian set. If your primary guardian cannot be reached, escalation alerts your secondary guardian.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            {secondary ? (
              <>
                <button onClick={() => handleOpenEdit(secondary)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                {secondary.status === 'pending' && (
                  <>
                    <button onClick={() => resendMutation.mutate(secondary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                      <RotateCcw className="w-3.5 h-3.5" /> Resend
                    </button>
                    <button onClick={() => cancelMutation.mutate(secondary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#DC2626' }}>
                      Cancel
                    </button>
                  </>
                )}
                <button onClick={() => deleteMutation.mutate(secondary.id)} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: '#DC2626' }}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </>
            ) : (
              <button onClick={() => handleOpenAdd('secondary_guardian')} className="btn" type="button" style={{ fontSize: '13px' }}>
                + Add Secondary Guardian
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Contacts List */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Other Emergency Contacts</h3>
            <p style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '2px' }}>
              Doctors, neighbors, and friends listed for reference during an emergency.
            </p>
          </div>
          <button onClick={() => handleOpenAdd('emergency_contact')} className="ghost" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <Plus className="w-4 h-4" /> Add Contact
          </button>
        </div>

        {emergencyList.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#8E8E9E', fontStyle: 'italic', fontSize: '14px' }}>
            No additional emergency contacts added yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {emergencyList.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: '#F9F9FB',
                  borderRadius: '8px',
                  border: '1px solid #E2E2E8',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, color: '#1A1A2E', fontSize: '15px' }}>{c.name}</span>
                  <span style={{ color: '#5B5B6B', fontSize: '13px', marginLeft: '10px' }}>
                    {c.relationship} · {c.phone} {c.email ? `· ${c.email}` : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => handleOpenEdit(c)} className="ghost" type="button" style={{ padding: '6px 10px', fontSize: '12px' }}>
                    Edit
                  </button>
                  <button onClick={() => deleteMutation.mutate(c.id)} className="ghost" type="button" style={{ padding: '6px 10px', fontSize: '12px', color: '#DC2626' }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Guards Section */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#D9381E]" />
              <h3 style={{ font: '800 18px Inter', color: '#1A1A2E' }}>Society &amp; Building Security</h3>
            </div>
            <p style={{ font: '500 13px Inter', color: '#5B5B6B', marginTop: '2px' }}>
              Security staff who receive urgent incident alerts with your unit and coordinates.
            </p>
          </div>
          <button
            onClick={() => {
              setGuardModalError('');
              setSelectedStaffUser(null);
              setBuildingGuardName('');
              setBuildingGuardPhone('');
              setBuildingGuardPost('');
              setAddGuardOpen(true);
            }}
            className="ghost"
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
          >
            <Plus className="w-4 h-4" /> Add Guard
          </button>
        </div>

        {residentGuards.length === 0 && societySecurityStaff.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#8E8E9E', fontStyle: 'italic', fontSize: '14px' }}>
            No security guards designated yet. Click "+ Add Guard" to link your building or society guard.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {/* Society security staff */}
            {societySecurityStaff.map((staff) => (
              <div
                key={`society-staff-${staff.id}`}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-neutral-50 rounded-xl border border-neutral-200"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-neutral-900 text-sm sm:text-base">{staff.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        staff.is_on_duty
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-neutral-200 text-neutral-600'
                      }`}
                    >
                      {staff.is_on_duty ? '● On Duty' : '○ Off Duty'}
                    </span>
                    <span className="text-xs text-neutral-500 font-medium">Society Security</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {staff.post_label ? `${staff.post_label} · ` : ''}{staff.society_name} · {staff.masked_phone || staff.phone}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {staff.phone && (
                    <a
                      href={`tel:${staff.phone}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold text-xs hover:bg-red-700 transition"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                </div>
              </div>
            ))}

            {/* Resident's custom building guards */}
            {residentGuards.map((g) => (
              <div
                key={`guard-${g.id}`}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-neutral-50 rounded-xl border border-neutral-200"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-neutral-900 text-sm sm:text-base">{g.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-200 text-neutral-700">
                      {g.guard_type === 'society_security' ? 'Linked Security' : 'Building Guard'}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {g.post_label ? `${g.post_label} · ` : ''}{g.masked_phone || g.phone}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {g.phone && (
                    <a
                      href={`tel:${g.phone}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold text-xs hover:bg-red-700 transition"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteGuardMutation.mutate(g.id)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                    title="Remove Guard"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Escalation Settings Card */}
      <div className="card" style={{ padding: '24px 28px', border: '1px solid #E2E2E8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Sliders className="w-6 h-6 text-[#D9381E]" />
          <h2 style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
            Automatic SOS Escalation Settings
          </h2>
        </div>
        <p style={{ font: '500 14px Inter', color: '#5B5B6B', marginBottom: '20px' }}>
          If your primary guardian does not respond within the time window, SafeCircle automatically escalates directly and simultaneously to your enabled responders.
        </p>

        {settingsLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#8E8E9E' }}>Loading settings...</div>
        ) : settings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            {/* Toggles Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {/* Toggle 1: has_security_guard */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '14px 16px',
                  background: '#F9F9FB',
                  borderRadius: '10px',
                  border: '1px solid #E2E2E8',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.has_security_guard}
                  onChange={(e) => updateSettingsMutation.mutate({ has_security_guard: e.target.checked })}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#D9381E' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                    Home has Security Guard
                  </div>
                  <div style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '2px' }}>
                    Enable if your apartment or society has an on-duty security guard.
                  </div>
                </div>
              </label>

              {/* Toggle 2: escalate_to_security */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '14px 16px',
                  background: settings.has_security_guard ? '#F9F9FB' : '#F3F4F6',
                  borderRadius: '10px',
                  border: '1px solid #E2E2E8',
                  cursor: settings.has_security_guard ? 'pointer' : 'not-allowed',
                  opacity: settings.has_security_guard ? 1 : 0.6,
                }}
              >
                <input
                  type="checkbox"
                  disabled={!settings.has_security_guard}
                  checked={settings.escalate_to_security}
                  onChange={(e) => updateSettingsMutation.mutate({ escalate_to_security: e.target.checked })}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#D9381E' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                    Escalate to Security
                  </div>
                  <div style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '2px' }}>
                    Alert building security guard immediately upon escalation.
                  </div>
                </div>
              </label>

              {/* Toggle 3: escalate_to_volunteers */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '14px 16px',
                  background: '#F9F9FB',
                  borderRadius: '10px',
                  border: '1px solid #E2E2E8',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.escalate_to_volunteers}
                  onChange={(e) => updateSettingsMutation.mutate({ escalate_to_volunteers: e.target.checked })}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#D9381E' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                    Escalate to Nearby Volunteers
                  </div>
                  <div style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '2px' }}>
                    Dispatch to verified community volunteers matched block-first by proximity.
                  </div>
                </div>
              </label>

              {/* Toggle 4: escalate_to_secondary_guardian */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '14px 16px',
                  background: '#F9F9FB',
                  borderRadius: '10px',
                  border: '1px solid #E2E2E8',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.escalate_to_secondary_guardian}
                  onChange={(e) => updateSettingsMutation.mutate({ escalate_to_secondary_guardian: e.target.checked })}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#D9381E' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1A2E' }}>
                    Escalate to Secondary Guardian
                  </div>
                  <div style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '2px' }}>
                    Notify secondary guardian when escalation triggers.
                  </div>
                </div>
              </label>
            </div>

            {/* Timers & Radius Selectors */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
              <div>
                <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock className="w-4 h-4 text-[#5B5B6B]" />
                  Auto-Escalation Window (Countdown)
                </label>
                <select
                  className="fld"
                  value={settings.response_window_seconds}
                  onChange={(e) => updateSettingsMutation.mutate({ response_window_seconds: Number(e.target.value) })}
                >
                  <option value={60}>60 seconds (1 minute - Fast)</option>
                  <option value={120}>120 seconds (2 minutes - Default Recommended)</option>
                  <option value={180}>180 seconds (3 minutes)</option>
                  <option value={300}>300 seconds (5 minutes - Extended)</option>
                </select>
                <p style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '4px' }}>
                  If primary guardian doesn't respond within this window, auto-escalation begins.
                </p>
              </div>

              <div>
                <label className="lbl" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Radio className="w-4 h-4 text-[#5B5B6B]" />
                  Volunteer Search Radius
                </label>
                <select
                  className="fld"
                  value={settings.volunteer_radius_km}
                  onChange={(e) => updateSettingsMutation.mutate({ volunteer_radius_km: Number(e.target.value) })}
                >
                  <option value={0.5}>0.5 km (Walking distance, immediate block)</option>
                  <option value={1.0}>1.0 km (Standard - Recommended)</option>
                  <option value={2.0}>2.0 km (Extended community)</option>
                  <option value={5.0}>5.0 km (Wide area, neighbouring societies)</option>
                </select>
                <p style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '4px' }}>
                  Max straight-line distance to search for available volunteers.
                </p>
              </div>
            </div>

            {/* Live Volunteer Breakdown Preview Box */}
            {preview && (
              <div
                style={{
                  background: '#F0F9FF',
                  border: '1px solid #BAE6FD',
                  borderRadius: '12px',
                  padding: '18px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Users className="w-5 h-5 text-[#0284C7]" />
                  <span style={{ fontWeight: 800, fontSize: '15px', color: '#0369A1' }}>
                    Live Escalation Target Preview
                  </span>
                </div>
                <p style={{ fontSize: '13px', color: '#075985', marginBottom: '14px', lineHeight: 1.4 }}>
                  {preview.volunteer_breakdown?.summary || `${preview.volunteer_breakdown?.total_count ?? (preview.volunteer_breakdown as any)?.total ?? 0} volunteers reachable`}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E0F2FE' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284C7', textTransform: 'uppercase' }}>
                      Tier 1: Same Block
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0369A1', marginTop: '4px' }}>
                      {preview.volunteer_breakdown?.same_block_count ?? (preview.volunteer_breakdown as any)?.tier1 ?? 0} volunteer{(preview.volunteer_breakdown?.same_block_count ?? (preview.volunteer_breakdown as any)?.tier1) === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E0F2FE' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284C7', textTransform: 'uppercase' }}>
                      Tier 2: Same Society
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0369A1', marginTop: '4px' }}>
                      {preview.volunteer_breakdown?.same_society_count ?? (preview.volunteer_breakdown as any)?.tier2 ?? 0} volunteer{(preview.volunteer_breakdown?.same_society_count ?? (preview.volunteer_breakdown as any)?.tier2) === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E0F2FE' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284C7', textTransform: 'uppercase' }}>
                      Tier 3: Neighbours
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0369A1', marginTop: '4px' }}>
                      {preview.volunteer_breakdown?.neighbour_society_count ?? (preview.volunteer_breakdown as any)?.tier3 ?? 0} volunteer{(preview.volunteer_breakdown?.neighbour_society_count ?? (preview.volunteer_breakdown as any)?.tier3) === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid #E0F2FE' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284C7', textTransform: 'uppercase' }}>
                      Security Guard
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: preview.security_available ? '#166534' : '#6B7280', marginTop: '6px' }}>
                      {preview.security_available ? '✓ Guard on duty' : '✗ No guard on duty'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Add / Edit Contact Modal */}
      {modalOpen && (
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
              maxWidth: '500px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ font: '800 20px Inter', color: '#1A1A2E' }}>
                {editingContact ? 'Edit Contact' : 'Add Emergency Contact / Guardian'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="cursor-pointer text-[#5B5B6B] hover:text-[#1A1A2E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveContact} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {!editingContact && (
                <div>
                  <label className="lbl">Role in Safety Circle</label>
                  <select
                    className="fld"
                    value={contactType}
                    onChange={(e) => {
                      setContactType(e.target.value as ContactType);
                      setLookupResult(null);
                      setLookupError('');
                    }}
                  >
                    <option value="primary_guardian">Primary Guardian (Alerted First on SOS)</option>
                    <option value="secondary_guardian">Secondary Guardian (Auto-Escalation Target)</option>
                    <option value="emergency_contact">Emergency Contact (Reference / Call)</option>
                  </select>
                </div>
              )}

              {/* Guardian: Username or Phone lookup */}
              {(contactType === 'primary_guardian' || contactType === 'secondary_guardian') && !editingContact ? (
                <div>
                  <label className="lbl">Guardian's SafeCircle Username or Phone</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="fld"
                      placeholder="e.g. ravikumar or +91 9876543210"
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        setLookupResult(null);
                        setLookupError('');
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleLookup}
                      disabled={isLookingUp}
                      className="ghost"
                      style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                    >
                      <Search className="w-4 h-4" />
                      {isLookingUp ? 'Searching...' : 'Find'}
                    </button>
                  </div>
                  {lookupError && (
                    <p style={{ color: '#DC2626', fontSize: '12px', marginTop: '4px' }}>{lookupError}</p>
                  )}
                  {lookupResult && (
                    <div
                      style={{
                        marginTop: '8px',
                        background: '#DCFCE7',
                        border: '1px solid #86EFAC',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <Check className="w-4 h-4 text-[#166534]" />
                      <div style={{ fontSize: '13px', color: '#166534' }}>
                        <span style={{ fontWeight: 700, marginRight: '6px' }}>{lookupResult.name}</span>
                        <span>@{lookupResult.username} · {lookupResult.masked_phone}</span>
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: '12px', color: '#5B5B6B', marginTop: '6px' }}>
                    The guardian will receive an invitation in their SafeCircle app to accept or decline.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="lbl">Full Name</label>
                    <input
                      className="fld"
                      placeholder="e.g. Dr. Iyer"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="lbl">Phone Number</label>
                    <input
                      className="fld"
                      placeholder="e.g. 98765 00003"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="lbl">Email (optional)</label>
                    <input
                      type="email"
                      className="fld"
                      placeholder="e.g. iyer@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="lbl">Relationship</label>
                <select
                  className="fld"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value as Relationship)}
                >
                  <option value="sibling">Sibling</option>
                  <option value="spouse">Spouse</option>
                  <option value="parent">Parent</option>
                  <option value="child">Child</option>
                  <option value="relative">Relative</option>
                  <option value="friend">Friend</option>
                  <option value="neighbor">Neighbor</option>
                  <option value="doctor">Doctor</option>
                  <option value="colleague">Colleague</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setModalOpen(false)} className="ghost">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGuardian && !lookupResult && !editingContact}
                  className="btn"
                >
                  {editingContact ? 'Save Changes' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Add Security Guard Modal */}
      {addGuardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95 duration-150"
            style={{ borderRadius: '20px' }}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-600" />
                <h3 className="font-extrabold text-neutral-900 text-lg">Add Security Guard</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddGuardOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {guardModalError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                {guardModalError}
              </div>
            )}

            {/* Tabs */}
            <div className="flex rounded-xl bg-neutral-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setGuardTab('society')}
                className={`flex-1 py-1.5 rounded-lg transition cursor-pointer ${
                  guardTab === 'society' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
                }`}
              >
                Society Security
              </button>
              <button
                type="button"
                onClick={() => setGuardTab('building')}
                className={`flex-1 py-1.5 rounded-lg transition cursor-pointer ${
                  guardTab === 'building' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
                }`}
              >
                My Building Guard
              </button>
            </div>

            {guardTab === 'society' ? (
              <div className="space-y-3">
                <p className="text-xs text-neutral-500">
                  Select an approved security guard from your residential society.
                </p>
                {societySecurityStaff.length === 0 ? (
                  <div className="p-4 rounded-xl bg-neutral-50 text-center text-xs text-neutral-500 italic border border-neutral-200">
                    No approved security staff found in your society.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {societySecurityStaff.map((staff) => (
                      <label
                        key={staff.id}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                          selectedStaffUser === staff.user_id
                            ? 'border-red-500 bg-red-50/50'
                            : 'border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="selectedStaff"
                            checked={selectedStaffUser === staff.user_id}
                            onChange={() => setSelectedStaffUser(staff.user_id)}
                            className="w-4 h-4 text-red-600 focus:ring-red-500"
                          />
                          <div>
                            <div className="text-xs font-bold text-neutral-900">{staff.name}</div>
                            <div className="text-[11px] text-neutral-500">{staff.post_label || 'Security Desk'}</div>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            staff.is_on_duty ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-600'
                          }`}
                        >
                          {staff.is_on_duty ? 'On duty' : 'Off duty'}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-neutral-500">
                  Add a private or lobby security guard. SafeCircle will send them simulated SMS alerts during an emergency.
                </p>
                <div>
                  <label className="lbl">Guard Name *</label>
                  <input
                    type="text"
                    className="fld"
                    placeholder="e.g. Bahadur Singh"
                    value={buildingGuardName}
                    onChange={(e) => setBuildingGuardName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="lbl">Phone Number *</label>
                  <input
                    type="tel"
                    className="fld"
                    placeholder="+91 98765 43210"
                    value={buildingGuardPhone}
                    onChange={(e) => setBuildingGuardPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="lbl">Post / Location Label</label>
                  <input
                    type="text"
                    className="fld"
                    placeholder="e.g. Block A Lobby Guard"
                    value={buildingGuardPost}
                    onChange={(e) => setBuildingGuardPost(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setAddGuardOpen(false)}
                className="px-4 py-2 rounded-xl border border-neutral-300 text-neutral-700 hover:bg-neutral-50 font-semibold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (guardTab === 'society') {
                    if (!selectedStaffUser) {
                      setGuardModalError('Please select a security personnel');
                      return;
                    }
                    const staff = societySecurityStaff.find((s) => s.user_id === selectedStaffUser);
                    addGuardMutation.mutate({
                      guard_type: 'society_security',
                      linked_user: selectedStaffUser,
                      name: staff?.name,
                      phone: staff?.phone,
                      post_label: staff?.post_label,
                    });
                  } else {
                    if (!buildingGuardName.trim() || !buildingGuardPhone.trim()) {
                      setGuardModalError('Guard name and phone number are required');
                      return;
                    }
                    addGuardMutation.mutate({
                      guard_type: 'building_guard',
                      name: buildingGuardName.trim(),
                      phone: buildingGuardPhone.trim(),
                      post_label: buildingGuardPost.trim(),
                    });
                  }
                }}
                disabled={addGuardMutation.isPending}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {addGuardMutation.isPending ? 'Saving...' : 'Add Guard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
