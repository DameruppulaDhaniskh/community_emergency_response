import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/Toast';
import ContactsPage from '../features/contacts/ContactsPage';
import GuardianIncidentsPage from '../features/incidents/GuardianIncidentsPage';
import RegisterPage from '../features/auth/RegisterPage';
import NotificationsPage from '../features/notifications/NotificationsPage';
import * as contactsApi from '../api/contacts';
import * as usersApi from '../api/users';
import * as guardianApi from '../api/guardianRequests';
import * as incidentsApi from '../api/incidents';
import * as authApi from '../api/auth';
import * as notifApi from '../api/notifications';
import * as authCtx from '../features/auth/AuthContext';
import type { EmergencyContact, UserProfile } from '../api/types';

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/contacts', () => ({
  getContacts: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  cancelContactRequest: vi.fn(),
  resendContactRequest: vi.fn(),
  getResidentSecurityGuards: vi.fn().mockResolvedValue([]),
  getResidentSocietySecurity: vi.fn().mockResolvedValue([]),
  createResidentSecurityGuard: vi.fn(),
  deleteResidentSecurityGuard: vi.fn(),
}));

vi.mock('../api/users', () => ({
  lookupUser: vi.fn(),
}));

vi.mock('../api/guardianRequests', () => ({
  getGuardianIncomingRequests: vi.fn(),
  acceptGuardianRequest: vi.fn(),
  declineGuardianRequest: vi.fn(),
  getGuardianDependents: vi.fn(),
}));

vi.mock('../api/incidents', async () => {
  const actual = await vi.importActual<typeof import('../api/incidents')>('../api/incidents');
  return {
    ...actual,
    getIncidents: vi.fn(),
  };
});

vi.mock('../api/notifications', () => ({
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getUnreadCount: vi.fn(),
}));

vi.mock('../api/auth', () => ({
  register: vi.fn(),
}));

function renderUI(ui: ReactNode, initialPath = '/') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockUser(role: UserProfile['role'] = 'resident', id = 2) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: {
      id,
      username: role === 'guardian' ? 'ravikumar' : 'asharao',
      email: `${role}@example.com`,
      first_name: role === 'guardian' ? 'Ravi' : 'Asha',
      last_name: role === 'guardian' ? 'Kumar' : 'Rao',
      phone: '+919876543210',
      role,
      address: 'Flat 101, Block A',
      profile_image_url: null,
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

describe('Guardian & Unique Contact End-to-End Frontend Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires exact lookup confirmation before Send request enables and removes legacy 6-digit code UI', async () => {
    mockUser('resident', 2);
    const pendingContact: EmergencyContact = {
      id: 10,
      resident: 2,
      linked_user: 5,
      linked_username: 'ravikumar',
      contact_type: 'primary_guardian',
      relationship: 'spouse',
      name: 'Ravi Kumar',
      phone: '+919800000005',
      masked_phone: '+91 ******0005',
      email: 'ravi@example.com',
      priority: 1,
      status: 'pending',
      is_verified: false,
      created_at: new Date().toISOString(),
      is_active: true,
    };

    vi.mocked(contactsApi.getContacts).mockResolvedValue([]);
    vi.mocked(usersApi.lookupUser).mockResolvedValue({
      id: 5,
      name: 'Ravi Kumar',
      username: 'ravikumar',
      masked_phone: '+91 ******0005',
      role: 'guardian',
    });
    vi.mocked(contactsApi.createContact).mockResolvedValue(pendingContact);

    renderUI(<ContactsPage />);

    // Warning shown when no verified guardian, and old 6-digit code UI must not exist
    expect(await screen.findByText(/No primary guardian set/i)).toBeInTheDocument();
    expect(screen.queryByText(/Enter the 6-digit code/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Add Contact/i })[0]);

    // Send request button stays disabled before lookup succeeds
    const sendBtn = screen.getByRole('button', { name: /Send invitation|Send request/i });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/ravikumar or \+91/i), {
      target: { value: 'ravikumar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Find$/i }));

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText(/@ravikumar · \+91 \*\*\*\*\*\*0005/)).toBeInTheDocument();
    expect(sendBtn).toBeEnabled();

    fireEvent.click(sendBtn);
    await waitFor(() =>
      expect(contactsApi.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_type: 'primary_guardian',
          identifier: 'ravikumar',
        })
      )
    );
  });

  it('shows inline backend duplicate errors for username and phone on RegisterPage', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      response: {
        status: 400,
        data: {
          username: ['This username is taken.'],
          phone: ['This phone number is already registered.'],
        },
      },
    });

    renderUI(<RegisterPage />);

    // Select Guardian role to test general username and phone duplicate errors
    fireEvent.click(screen.getByRole('button', { name: 'Guardian' }));

    fireEvent.change(screen.getByPlaceholderText('Asha'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('Rao'), { target: { value: 'User' } });
    fireEvent.change(screen.getByPlaceholderText('asha.rao'), { target: { value: 'asharao' } });
    fireEvent.change(screen.getByPlaceholderText('asha@example.com'), { target: { value: 'dup@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('+91 98765 43210'), { target: { value: '9876543210' } });
    const pwInputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pwInputs[0], { target: { value: 'Password123!' } });
    fireEvent.change(pwInputs[1], { target: { value: 'Password123!' } });

    fireEvent.click(screen.getByRole('button', { name: /Create account/i }));

    expect(await screen.findByText('This username is taken.')).toBeInTheDocument();
    expect(screen.getByText('This phone number is already registered.')).toBeInTheDocument();
  });

  it('renders Guardian requests and My Residents from real endpoints and sends Accept mutation', async () => {
    mockUser('guardian', 5);
    vi.mocked(incidentsApi.getIncidents).mockResolvedValue([]);
    vi.mocked(guardianApi.getGuardianIncomingRequests).mockResolvedValue([
      {
        id: 21,
        contact_id: 21,
        resident_id: 2,
        resident_name: 'Asha Rao',
        resident_phone: '+919876543210',
        flat: '101',
        block: 'A',
        society: 'Green Meadows',
        contact_type: 'primary_guardian',
        relationship: 'spouse',
        priority: 1,
        status: 'pending',
        created_at: new Date().toISOString(),
        responded_at: null,
      },
    ]);
    vi.mocked(guardianApi.getGuardianDependents).mockResolvedValue([
      {
        id: 3,
        contact_id: 19,
        name: 'Kiran Rao',
        phone: '+919876543211',
        flat: 'Block A · Flat 204',
        society: 'Green Meadows',
        contact_type: 'secondary_guardian',
        relationship: 'sibling',
        verified_at: new Date().toISOString(),
        has_active_incident: false,
        active_incident_id: null,
      },
    ]);
    vi.mocked(guardianApi.acceptGuardianRequest).mockResolvedValue({
      id: 21,
      contact_id: 21,
      resident_id: 2,
      resident_name: 'Asha Rao',
      resident_phone: '+919876543210',
      flat: '101',
      block: 'A',
      society: 'Green Meadows',
      contact_type: 'primary_guardian',
      relationship: 'spouse',
      priority: 1,
      status: 'accepted',
      created_at: new Date().toISOString(),
      responded_at: new Date().toISOString(),
    });

    renderUI(<GuardianIncidentsPage />);

    expect(await screen.findByText(/Asha Rao/i)).toBeInTheDocument();
    expect(screen.getByText('Kiran Rao')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Accept$/i }));
    await waitFor(() => expect(guardianApi.acceptGuardianRequest).toHaveBeenCalledWith(21, expect.anything()));
  });

  it('displays non-incident Guardian Notifications cleanly as Safety Circle without Incident #null', async () => {
    mockUser('resident', 2);
    vi.mocked(notifApi.getNotifications).mockResolvedValue([
      {
        id: 99,
        incident: null,
        event_type: 'GUARDIAN_ACCEPTED',
        recipient_type: 'resident',
        channel: 'in_app',
        title: 'Ravi Kumar accepted your guardian request',
        message: 'Ravi Kumar accepted your Primary Guardian invitation.',
        delivery_status: 'SENT',
        is_simulated: true,
        is_read: false,
        read_at: null,
        created_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        delivered_at: null,
      },
    ]);

    renderUI(<NotificationsPage />);

    expect(await screen.findByText('Ravi Kumar accepted your guardian request')).toBeInTheDocument();
    expect(screen.getByText(/Safety Circle · IN_APP/i)).toBeInTheDocument();
    expect(screen.queryByText(/Incident #null/i)).not.toBeInTheDocument();
  });
});
