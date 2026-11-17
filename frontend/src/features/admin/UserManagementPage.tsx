import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsers, updateUser, deleteUser } from '../../api/users';
import { useToast } from '../../components/Toast';
import { fullName } from '../../lib/formatters';
import type { UserProfile, UserRole } from '../../api/types';
import { X } from 'lucide-react';

export default function UserManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('resident');

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UserProfile> }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated');
      setEditingUser(null);
    },
    onError: () => toast.error('Could not update user'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deleted');
    },
    onError: () => toast.error('Could not delete user'),
  });

  const filtered = (users || []).filter((u) => {
    const matchSearch =
      !search ||
      fullName(u.first_name, u.last_name, u.username).toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div>
        <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          User Directory &amp; Roles
        </h1>
        <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
          Manage residents, guardians, volunteers, and security personnel.
        </p>
      </div>

      {/* Search & Filter */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone..."
          className="fld"
          style={{ maxWidth: '320px' }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['all', 'resident', 'guardian', 'volunteer', 'security'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`cat ${roleFilter === r ? 'on' : ''}`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* User Table Card */}
      <div className="card" style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', padding: '16px 0', borderBottom: '1px solid #F0F0F4', font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
          <div style={{ flex: 1.5 }}>NAME</div>
          <div style={{ flex: 1.5 }}>EMAIL</div>
          <div style={{ flex: 1 }}>ROLE</div>
          <div style={{ flex: 1 }}>STATUS</div>
          <div style={{ width: '120px', textAlign: 'right' }}>ACTIONS</div>
        </div>

        {filtered.map((u, idx) => {
          const roleClass = u.role === 'resident' ? 'ok' : u.role === 'guardian' ? 'info' : u.role === 'volunteer' ? 'ok' : 'warn';
          return (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 0',
                borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid #F0F0F4',
                font: '500 14px Inter',
                color: '#1A1A2E',
              }}
            >
              <div style={{ flex: 1.5, fontWeight: 700 }}>
                {fullName(u.first_name, u.last_name, u.username)}
              </div>
              <div style={{ flex: 1.5, color: '#5B5B6B' }}>{u.email}</div>
              <div style={{ flex: 1 }}>
                <span className={`chip ${roleClass}`}>{u.role}</span>
              </div>
              <div style={{ flex: 1 }}>
                <span className={`chip ${u.is_active ? 'ok' : 'bad'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={{ width: '120px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingUser(u);
                    setEditRole(u.role);
                  }}
                  className="ghost"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Remove user ${u.email}?`)) {
                      deleteMutation.mutate(u.id);
                    }
                  }}
                  className="ghost"
                  style={{ padding: '4px 10px', fontSize: '12px', color: '#D9381E' }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Role Modal */}
      {editingUser && (
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
          <div className="card" style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ font: '800 18px Inter' }}>Edit User Role</h3>
              <button onClick={() => setEditingUser(null)} className="cursor-pointer text-[#5B5B6B]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <div className="lbl">User</div>
              <div style={{ font: '700 14px Inter', marginTop: '2px' }}>
                {fullName(editingUser.first_name, editingUser.last_name, editingUser.username)} ({editingUser.email})
              </div>
            </div>
            <div>
              <div className="lbl">Assign Role</div>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
                className="fld"
                style={{ marginTop: '4px' }}
              >
                <option value="resident">Resident</option>
                <option value="guardian">Guardian</option>
                <option value="volunteer">Volunteer</option>
                <option value="security">Security</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button onClick={() => setEditingUser(null)} className="ghost">Cancel</button>
              <button
                onClick={() => updateMutation.mutate({ id: editingUser.id, data: { role: editRole } })}
                className="btn"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
