import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/Toast';
import StatusStepper from '../components/StatusStepper';
import ReportIncidentPage from '../features/incidents/ReportIncidentPage';
import IncidentDetailPage from '../features/incidents/IncidentDetailPage';
import AdminIncidentDetail from '../features/admin/AdminIncidentDetail';
import VolunteerAssignmentDetail from '../features/volunteers/VolunteerAssignmentDetail';
import NotificationBell from '../components/NotificationBell';
import NotificationsPage from '../features/notifications/NotificationsPage';
import * as incidentsApi from '../api/incidents';
import * as notificationsApi from '../api/notifications';
import * as authCtx from '../features/auth/AuthContext';
import type { Incident, Notification, UserProfile } from '../api/types';

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/incidents', async () => {
  const actual = await vi.importActual<typeof import('../api/incidents')>('../api/incidents');
  return {
    ...actual,
    createIncident: vi.fn(),
    getIncident: vi.fn(),
    getAvailableVolunteers: vi.fn(),
    updateIncidentStatus: vi.fn(),
    assignVolunteer: vi.fn(),
    uploadEvidence: vi.fn(),
    escalateIncident: vi.fn(),
  };
});

vi.mock('../api/notifications', async () => {
  const actual = await vi.importActual<typeof import('../api/notifications')>('../api/notifications');
  return {
    ...actual,
    getUnreadCount: vi.fn(),
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    getIncidentNotifications: vi.fn(),
    retryIncidentNotifications: vi.fn(),
  };
});

function renderWithProviders(ui: ReactNode, initialPath = '/') {
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

const sampleIncident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 42,
  resident: 2,
  resident_name: 'Asha Rao',
  flat_number: 'Flat 101, Block A',
  reported_by: 2,
  reporter: { id: 2, name: 'Asha Rao', phone: '9876543210' },
  title: 'Sparking transformer box',
  category: 'fire',
  emergency_type: 'fire',
  description: 'Visible sparks in basement B1',
  latitude: '12.971600',
  longitude: '77.594600',
  location_available: true,
  location_captured_at: '2026-11-11T10:00:00Z',
  location_accuracy: 10,
  location: {
    available: true,
    latitude: '12.971600',
    longitude: '77.594600',
    accuracy: 10,
    captured_at: '2026-11-11T10:00:00Z',
  },
  status: 'REPORTED',
  is_escalated: false,
  escalated_at: null,
  assigned_to_id: null,
  assigned_to: null,
  assigned_at: null,
  acknowledged_at: null,
  in_progress_at: null,
  resolved_at: null,
  closed_at: null,
  close_reason: '',
  evidence: [],
  evidence_urls: [],
  history: [
    {
      id: 1,
      incident: 42,
      changed_by: 2,
      changed_by_name: 'Asha Rao',
      event_type: 'created',
      from_status: '',
      to_status: 'REPORTED',
      note: 'Incident reported',
      created_at: '2026-11-11T10:00:00Z',
    },
  ],
  history_summary: {
    total_events: 1,
    latest_event_type: 'created',
    latest_note: 'Incident reported',
    latest_event_at: '2026-11-11T10:00:00Z',
  },
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
  ...overrides,
});

function mockAuthUser(role: UserProfile['role'], id = 2) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: {
      id,
      username: `${role}_u`,
      email: `${role}@example.com`,
      first_name: role,
      last_name: 'Test',
      phone: '9999999999',
      role,
      address: 'Green Meadows',
      profile_image_url: null,
    },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

describe('Milestone 3 Frontend Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Report form validation
  it('validates title and image file types on ReportIncidentPage before submitting', async () => {
    mockAuthUser('resident');
    vi.mocked(incidentsApi.createIncident).mockResolvedValue({
      id: 99,
      title: 'Burst pipe',
      category: 'other',
      status: 'REPORTED',
      created_at: '2026-11-11T10:00:00Z',
      location_available: false,
      evidence_count: 0,
    });

    const { container } = renderWithProviders(<ReportIncidentPage />);

    // Submit without title -> validation message shown, API not called
    fireEvent.click(screen.getByRole('button', { name: /Submit Incident Report/i }));
    expect(await screen.findByText(/Please provide a short title/i)).toBeInTheDocument();
    expect(incidentsApi.createIncident).not.toHaveBeenCalled();

    // Unsupported image extension rejected on drop/select
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [badFile] } });
    expect(await screen.findByText(/Only JPG, PNG, or WEBP images are allowed/i)).toBeInTheDocument();

    // Fill title and select Fire category -> submits FormData cleanly
    fireEvent.change(screen.getByLabelText(/Incident Title/i), { target: { value: 'Burst pipe in hall' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Incident Report/i }));

    await waitFor(() => expect(incidentsApi.createIncident).toHaveBeenCalledTimes(1));
  });

  // 2. Status stepper
  it('renders all 6 lifecycle stages and escalated chip on StatusStepper', () => {
    renderWithProviders(<StatusStepper status="ASSIGNED" isEscalated />);

    expect(screen.getByText(/INCIDENT LIFECYCLE STAGE \(3 OF 6\)/i)).toBeInTheDocument();
    expect(screen.getByText('Reported')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText(/Escalated to Administration/i)).toBeInTheDocument();
  });

  // 3. Role-based action visibility
  it('enforces role-based action visibility for resident, volunteer, and admin', async () => {
    // A. Resident detail page: sees Add Photo & Escalate, never admin/volunteer actions
    mockAuthUser('resident', 2);
    vi.mocked(incidentsApi.getIncident).mockResolvedValue(sampleIncident());
    vi.mocked(notificationsApi.getIncidentNotifications).mockResolvedValue([]);

    const residentView = renderWithProviders(
      <Routes>
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
      </Routes>,
      '/incidents/42'
    );
    expect(await screen.findByText(/Incident #42:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Escalate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign Volunteer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close Incident/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry Failed/i })).not.toBeInTheDocument();
    residentView.unmount();

    // B. Volunteer assignment detail: sees Start Work when ASSIGNED, never Assign/Close
    mockAuthUser('volunteer', 5);
    vi.mocked(incidentsApi.getIncident).mockResolvedValue(
      sampleIncident({ status: 'ASSIGNED', assigned_to_id: 5, assigned_to: { id: 5, name: 'Priya', phone: '98000' } })
    );
    const volView = renderWithProviders(
      <Routes>
        <Route path="/volunteer/incidents/:id" element={<VolunteerAssignmentDetail />} />
      </Routes>,
      '/volunteer/incidents/42'
    );
    expect(await screen.findByRole('button', { name: /Start Work/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Resolved/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign Volunteer/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Notification Delivery/i)).not.toBeInTheDocument();
    volView.unmount();

    // C. Admin detail page: sees Acknowledge, Assign Volunteer, Close Incident
    mockAuthUser('admin', 1);
    vi.mocked(incidentsApi.getIncident).mockResolvedValue(sampleIncident({ status: 'REPORTED' }));
    renderWithProviders(
      <Routes>
        <Route path="/admin/incidents/:id" element={<AdminIncidentDetail />} />
      </Routes>,
      '/admin/incidents/42'
    );
    expect(await screen.findByRole('button', { name: /^Acknowledge$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assign Volunteer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close Incident/i })).toBeInTheDocument();
  });

  // 4. Notifications unread badge & mark-all-read logic
  it('renders unread count badge and executes mark-all-read on NotificationsPage', async () => {
    mockAuthUser('resident', 2);
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue({ unread_count: 3 });

    const sampleNotes: Notification[] = [
      {
        id: 11,
        incident: 42,
        event_type: 'STATUS_CHANGED',
        recipient_type: 'resident',
        channel: 'in_app',
        title: 'Incident #42 update: Assigned',
        message: 'Priya Sharma was assigned to your incident.',
        delivery_status: 'SENT',
        is_simulated: true,
        is_read: false,
        read_at: null,
        created_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        delivered_at: null,
      },
    ];
    vi.mocked(notificationsApi.getNotifications).mockResolvedValue(sampleNotes);
    vi.mocked(notificationsApi.markAllNotificationsRead).mockResolvedValue({ marked_read: 1 });

    renderWithProviders(
      <div>
        <NotificationBell />
        <NotificationsPage />
      </div>
    );

    const badge = await screen.findByTestId('unread-badge');
    expect(badge).toHaveTextContent('3');
    expect(await screen.findByText('Incident #42 update: Assigned')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mark all as read/i }));
    await waitFor(() => expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalledTimes(1));
  });
});

