import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { RequireAuth, RedirectIfAuth, roleHome } from './routes/guards';
import AppShell from './routes/AppShell';
import UnauthorizedPage from './routes/UnauthorizedPage';

// ── Auth ──
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';

// ── Resident ──
import ResidentHomePage from './features/sos/ResidentHomePage';
import ReportIncidentPage from './features/incidents/ReportIncidentPage';
import ResidentIncidentListPage from './features/incidents/ResidentIncidentListPage';
import ContactsPage from './features/contacts/ContactsPage';

// ── Incidents (shared) ──
import IncidentDetailPage from './features/incidents/IncidentDetailPage';

// ── Guardian ──
import GuardianIncidentsPage from './features/incidents/GuardianIncidentsPage';

// ── Volunteer ──
import VolunteerAssignmentList from './features/volunteers/VolunteerAssignmentList';
import VolunteerAssignmentDetail from './features/volunteers/VolunteerAssignmentDetail';

// ── Security ──
import LiveDashboardPage from './features/incidents/LiveDashboardPage';
import SecurityAlertsPage from './features/security/SecurityAlertsPage';

// ── Admin ──
import AdminIncidentDashboard from './features/admin/AdminIncidentDashboard';
import AdminIncidentDetail from './features/admin/AdminIncidentDetail';
import SocietyManagementPage from './features/society/SocietyManagementPage';
import UserManagementPage from './features/admin/UserManagementPage';
import VolunteerApprovalsPage from './features/admin/VolunteerApprovalsPage';
import ReportsPage from './features/reports/ReportsPage';

// ── Shared ──
import NotificationsPage from './features/notifications/NotificationsPage';
import ProfilePage from './features/profile/ProfilePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

function RootRedirect() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              {/* ── Public routes ── */}
              <Route element={<RedirectIfAuth />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>

              <Route path="/unauthorized" element={<UnauthorizedPage />} />

              {/* ── Root redirect ── */}
              <Route path="/" element={<RootRedirect />} />

              {/* ── Shared incident detail and common authenticated pages ── */}
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route path="/incidents/:id" element={<IncidentDetailPage />} />
                  <Route path="/resident/incidents/:id" element={<IncidentDetailPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Resident routes ── */}
              <Route element={<RequireAuth allowed={['resident']} />}>
                <Route element={<AppShell />}>
                  <Route path="/resident/home" element={<ResidentHomePage />} />
                  <Route path="/resident/report" element={<ReportIncidentPage />} />
                  <Route path="/resident/incidents" element={<ResidentIncidentListPage />} />
                  <Route path="/resident/contacts" element={<ContactsPage />} />
                  <Route path="/resident/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Guardian routes ── */}
              <Route element={<RequireAuth allowed={['guardian']} />}>
                <Route element={<AppShell />}>
                  <Route path="/guardian/alerts" element={<GuardianIncidentsPage />} />
                  <Route path="/guardian/residents" element={<GuardianIncidentsPage />} />
                  <Route path="/guardian/incidents" element={<GuardianIncidentsPage />} />
                  <Route path="/guardian/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Volunteer routes ── */}
              <Route element={<RequireAuth allowed={['volunteer']} />}>
                <Route element={<AppShell />}>
                  <Route path="/volunteer/incidents" element={<VolunteerAssignmentList />} />
                  <Route path="/volunteer/incidents/:id" element={<VolunteerAssignmentDetail />} />
                  <Route path="/volunteer/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Security routes ── */}
              <Route element={<RequireAuth allowed={['security']} />}>
                <Route element={<AppShell />}>
                  <Route path="/security/alerts" element={<SecurityAlertsPage />} />
                  <Route path="/security/dashboard" element={<SecurityAlertsPage />} />
                  <Route path="/security/operations" element={<LiveDashboardPage />} />
                  <Route path="/security/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Admin routes ── */}
              <Route element={<RequireAuth allowed={['admin']} />}>
                <Route element={<AppShell />}>
                  <Route path="/admin/dashboard" element={<AdminIncidentDashboard />} />
                  <Route path="/admin/incidents/:id" element={<AdminIncidentDetail />} />
                  <Route path="/admin/societies" element={<SocietyManagementPage />} />
                  <Route path="/admin/users" element={<UserManagementPage />} />
                  <Route path="/admin/volunteers" element={<VolunteerApprovalsPage />} />
                  <Route path="/admin/reports" element={<ReportsPage />} />
                  <Route path="/admin/notifications" element={<NotificationsPage />} />
                </Route>
              </Route>

              {/* ── Catch-all ── */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
