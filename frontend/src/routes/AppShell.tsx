import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUnreadCount } from '../api/notifications';
import { getIncidents, getVolunteerIncidents } from '../api/incidents';
import { getGuardianIncomingRequests } from '../api/guardianRequests';
import { getSecurityDuty, setSecurityDuty } from '../api/society';
import { fullName } from '../lib/formatters';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useToast } from '../components/Toast';
import SOSFlow from '../features/sos/SOSFlow';
import OfflineBanner from '../components/OfflineBanner';
import WakeUpBanner from '../components/WakeUpBanner';
import InstallPromptButton from '../components/InstallPromptButton';
import PwaUpdatePrompt from '../components/PwaUpdatePrompt';
import NotificationBell from '../components/NotificationBell';
import PushPrompt from '../components/PushPrompt';
import {
  Home,
  List,
  Bell,
  Users,
  User,
  Shield,
  Activity,
  Building2,
  FilePlus2,
  ClipboardCheck,
  LogOut,
  PhoneCall,
  Radio,
} from 'lucide-react';

interface NavItemDef {
  to: string;
  label: string;
  icon: typeof Home;
  badgeCount?: number;
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sosModalOpen, setSosModalOpen] = useState(false);

  const role = user?.role || 'resident';

  // Live unread count (polled every 15s)
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 15_000,
    enabled: !!user,
  });
  const unreadCount = unreadData?.unread_count ?? 0;

  // Role-appropriate incident count for badges
  const { data: incidents } = useQuery({
    queryKey: ['incidents', role],
    queryFn: () => (role === 'volunteer' ? getVolunteerIncidents() : getIncidents()),
    refetchInterval: 10_000,
    enabled: !!user,
  });

  const activeIncidents = (incidents || []).filter(
    (i) => !['RESOLVED', 'CLOSED'].includes(i.status)
  );
  const activeAlert = activeIncidents[0];

  // Pending guardian requests count (guardian role only)
  const { data: pendingGuardianReqs } = useQuery({
    queryKey: ['guardian-incoming-requests', 'pending'],
    queryFn: () => getGuardianIncomingRequests('pending'),
    refetchInterval: 10_000,
    enabled: role === 'guardian',
  });
  const pendingReqCount = pendingGuardianReqs?.length ?? 0;

  // Security staff duty status & mutation
  const { data: securityDuty } = useQuery({
    queryKey: ['security', 'duty'],
    queryFn: getSecurityDuty,
    refetchInterval: 12_000,
    enabled: role === 'security',
  });

  const dutyMutation = useMutation({
    mutationFn: (onDuty: boolean) => setSecurityDuty(onDuty),
    onSuccess: (data) => {
      queryClient.setQueryData(['security', 'duty'], data);
      toast.success(data.on_duty ? 'Duty status: ON DUTY' : 'Duty status: OFF DUTY');
      queryClient.invalidateQueries({ queryKey: ['security-incidents'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to update duty status.');
    },
  });

  // Role subtitle line
  let roleSubtitle = 'Resident · Verified';
  if (role === 'resident') {
    const flatStr = user?.address ? ` · ${user.address}` : '';
    roleSubtitle = `Resident${flatStr}`;
  } else if (role === 'guardian') {
    roleSubtitle = 'Guardian · Verified';
  } else if (role === 'volunteer') {
    roleSubtitle = 'Volunteer Responder';
  } else if (role === 'security') {
    roleSubtitle = securityDuty?.on_duty ? 'Security · On Duty' : 'Security · Off Duty';
  } else if (role === 'admin') {
    roleSubtitle = 'Society Administrator';
  }

  // Navigation items by role
  let navItems: NavItemDef[] = [];
  if (role === 'resident') {
    navItems = [
      { to: '/resident/home', label: 'Dashboard', icon: Home },
      { to: '/resident/report', label: 'Report Incident', icon: FilePlus2 },
      { to: '/resident/incidents', label: 'My Incidents', icon: List, badgeCount: activeIncidents.length },
      { to: '/notifications', label: 'Notifications', icon: Bell, badgeCount: unreadCount },
      { to: '/resident/contacts', label: 'Emergency Contacts', icon: Users },
      { to: '/profile', label: 'Profile', icon: User },
    ];
  } else if (role === 'guardian') {
    navItems = [
      { to: '/guardian/alerts', label: 'Guardian Requests', icon: Users, badgeCount: pendingReqCount },
      { to: '/guardian/incidents', label: 'Live Alerts', icon: Shield, badgeCount: activeIncidents.length },
      { to: '/guardian/residents', label: 'My Residents', icon: List },
      { to: '/notifications', label: 'Notifications', icon: Bell, badgeCount: unreadCount },
      { to: '/profile', label: 'Profile', icon: User },
    ];
  } else if (role === 'volunteer') {
    navItems = [
      { to: '/volunteer/incidents', label: 'My Assignments', icon: ClipboardCheck, badgeCount: activeIncidents.length },
      { to: '/notifications', label: 'Notifications', icon: Bell, badgeCount: unreadCount },
      { to: '/profile', label: 'Profile', icon: User },
    ];
  } else if (role === 'security') {
    navItems = [
      { to: '/security/alerts', label: 'Emergency Alerts', icon: Shield, badgeCount: activeIncidents.length },
      { to: '/notifications', label: 'Notifications', icon: Bell, badgeCount: unreadCount },
      { to: '/profile', label: 'Profile', icon: User },
    ];
  } else {
    navItems = [
      { to: '/admin/dashboard', label: 'Incident Queue', icon: Activity, badgeCount: activeIncidents.length },
      { to: '/admin/societies', label: 'Societies', icon: Building2 },
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/volunteers', label: 'Staff Approvals', icon: ClipboardCheck },
      { to: '/admin/reports', label: 'Analytics', icon: List },
      { to: '/notifications', label: 'Notifications', icon: Bell, badgeCount: unreadCount },
      { to: '/profile', label: 'Profile', icon: User },
    ];
  }

  const handleHomeNav = () => {
    if (role === 'resident') navigate('/resident/home');
    else if (role === 'guardian') navigate('/guardian/alerts');
    else if (role === 'volunteer') navigate('/volunteer/incidents');
    else if (role === 'security') navigate('/security/alerts');
    else navigate('/admin/dashboard');
  };

  const handleSidebarButtonClick = () => {
    if (role === 'guardian' && activeAlert) {
      const phone = activeAlert.reporter?.phone;
      if (phone) {
        window.location.href = `tel:${phone}`;
      } else {
        navigate(`/incidents/${activeAlert.id}`);
      }
    } else if (role === 'resident') {
      if (!isOnline) {
        window.location.href = 'tel:112';
      } else {
        setSosModalOpen(true);
      }
    } else {
      handleHomeNav();
    }
  };

  const displayName = user ? fullName(user.first_name, user.last_name, user.username) : 'SafeCircle User';

  const mobileHomePath =
    role === 'resident'
      ? '/resident/home'
      : role === 'guardian'
      ? '/guardian/alerts'
      : role === 'volunteer'
      ? '/volunteer/incidents'
      : role === 'security'
      ? '/security/alerts'
      : '/admin/dashboard';

  const mobileSecondPath =
    role === 'resident'
      ? '/resident/incidents'
      : role === 'admin'
      ? '/admin/dashboard'
      : mobileHomePath;

  return (
    <div className="min-h-screen flex w-full" style={{ background: 'linear-gradient(135deg, #FFF1EA, #F5F5F7 55%, #E9E9EE)' }}>
      {/* ── Desktop Sidebar (260px wide, sticky) ── */}
      <aside
        className="hidden lg:flex flex-col shrink-0 sticky top-0 h-screen"
        style={{
          width: '260px',
          padding: '24px 18px',
          background: '#ffffff',
          borderRight: '1px solid #ECECF1',
          gap: '20px',
          zIndex: 30,
        }}
      >
        {/* Brand */}
        <div
          onClick={handleHomeNav}
          className="cursor-pointer select-none"
          style={{ font: '800 24px Inter', color: '#B93412', letterSpacing: '-0.02em' }}
        >
          SafeCircle
        </div>

        {/* User Block */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="min-w-0">
            <div className="truncate" style={{ font: '700 16px Inter', color: '#1A1A2E' }}>
              {displayName}
            </div>
            <div className="truncate" style={{ font: '600 12px Inter', color: role === 'guardian' ? '#1E40AF' : '#166534', marginTop: '2px' }}>
              {roleSubtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            title="Log out"
            aria-label="Log out"
            className="p-1.5 rounded-lg text-[#5B5B6B] hover:text-[#D9381E] hover:bg-[#FFF1EA] transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Security On-Duty Toggle (Desktop) */}
        {role === 'security' && (
          <div
            style={{
              background: securityDuty?.on_duty ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${securityDuty?.on_duty ? '#BBF7D0' : '#FECACA'}`,
              borderRadius: '12px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: securityDuty?.on_duty ? '#16A34A' : '#DC2626',
                  boxShadow: securityDuty?.on_duty ? '0 0 6px rgba(22, 163, 74, 0.6)' : 'none',
                }}
              />
              <span style={{ font: '700 12px Inter', color: securityDuty?.on_duty ? '#166534' : '#991B1B' }}>
                {securityDuty?.on_duty ? 'ON DUTY' : 'OFF DUTY'}
              </span>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '42px', height: '22px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!securityDuty?.on_duty}
                disabled={dutyMutation.isPending || !isOnline}
                onChange={(e) => dutyMutation.mutate(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: securityDuty?.on_duty ? '#16A34A' : '#CBD5E1',
                  transition: '.2s',
                  borderRadius: '22px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    height: '16px',
                    width: '16px',
                    left: securityDuty?.on_duty ? '22px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.2s',
                    borderRadius: '50%',
                  }}
                />
              </span>
            </label>
          </div>
        )}

        {/* Navigation items */}
        <nav className="nav flex flex-col overflow-y-auto" style={{ gap: '6px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.to ||
              (item.to === '/resident/home' && location.pathname === '/') ||
              (item.to === '/resident/incidents' && (location.pathname.startsWith('/resident/incidents') || location.pathname.startsWith('/incidents/'))) ||
              (item.to === '/admin/dashboard' && location.pathname.startsWith('/admin/incidents')) ||
              (item.to === '/volunteer/incidents' && location.pathname.startsWith('/volunteer/incidents')) ||
              (item.to === '/security/alerts' && (location.pathname.startsWith('/security/alerts') || location.pathname.startsWith('/security/dashboard')));

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={isActive ? 'on' : ''}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '11px 14px',
                  borderRadius: '14px',
                  font: '600 14px Inter',
                  textDecoration: 'none',
                  color: isActive ? '#B93412' : '#4A4A5A',
                  background: isActive ? '#FFEDE5' : 'transparent',
                }}
              >
                <Icon
                  style={{
                    width: '18px',
                    height: '18px',
                    strokeWidth: 2,
                    stroke: 'currentColor',
                    flexShrink: 0,
                  }}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badgeCount != null && item.badgeCount > 0 && (
                  <span
                    style={{
                      background: '#D92D20',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: '99px',
                    }}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom PWA install & Emergency CTA */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <InstallPromptButton />
          {role === 'resident' && (
            <button
              type="button"
              onClick={handleSidebarButtonClick}
              title={!isOnline ? 'Offline — taps will call 112 directly' : 'Raise emergency SOS'}
              className="sos-emergency-sidebar-btn"
              style={{
                border: 0,
                borderRadius: '14px',
                padding: '15px',
                background: '#D92D20',
                color: '#fff',
                font: '800 13px Inter',
                letterSpacing: '.06em',
              }}
            >
              {isOnline ? 'SOS EMERGENCY' : 'CALL 112 NOW'}
            </button>
          )}
          {role === 'guardian' && (
            <button
              type="button"
              onClick={handleSidebarButtonClick}
              className="sos-emergency-sidebar-btn"
              style={{
                border: 0,
                borderRadius: '14px',
                padding: '15px',
                background: '#D92D20',
                color: '#fff',
                font: '800 13px Inter',
                letterSpacing: '.06em',
              }}
            >
              {activeAlert
                ? `CALL ${(activeAlert.resident_name || 'RESIDENT').split(' ')[0].toUpperCase()} NOW`
                : 'EMERGENCY ALERTS'}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Area ── */}
      <main
        className="flex-1 flex flex-col min-w-0 pb-[96px] lg:pb-8"
        style={{
          padding: '24px 28px',
          gap: '18px',
        }}
      >
        {/* Top Utility Bar: Cold start / Offline + Notification Bell */}
        <div className="w-full max-w-[1020px] mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="lg:hidden flex items-center gap-2">
              <span style={{ font: '800 20px Inter', color: '#B93412', letterSpacing: '-0.02em' }}>
                SafeCircle
              </span>
              <InstallPromptButton />
            </div>
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2">
              {role === 'security' && (
                <button
                  type="button"
                  disabled={dutyMutation.isPending || !isOnline}
                  onClick={() => dutyMutation.mutate(!securityDuty?.on_duty)}
                  className={`chip ${securityDuty?.on_duty ? 'ok' : 'bad'}`}
                  style={{
                    cursor: 'pointer',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '6px 12px',
                  }}
                  title="Toggle Security Duty Status"
                >
                  <Radio className={`w-3.5 h-3.5 ${securityDuty?.on_duty ? 'animate-pulse' : ''}`} />
                  <span>{securityDuty?.on_duty ? 'DUTY: ON' : 'DUTY: OFF'}</span>
                </button>
              )}
              <PushPrompt />
              <NotificationBell />
            </div>
          </div>

          <OfflineBanner />
          <WakeUpBanner />
        </div>

        <Outlet />
      </main>

      {/* ── Mobile Bottom Tab Bar (<1024px) ── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around z-40 bg-white"
        style={{
          height: '76px',
          borderTop: '1px solid #ECECF1',
        }}
      >
        <NavLink
          to={mobileHomePath}
          className="flex flex-col items-center justify-center"
          style={({ isActive }) => ({
            gap: '3px',
            font: '700 11px Inter',
            textDecoration: 'none',
            color: isActive ? '#B93412' : '#5B5B6B',
          })}
        >
          <Home style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
          <span>Home</span>
        </NavLink>

        <NavLink
          to={role === 'resident' ? '/resident/report' : mobileSecondPath}
          className="flex flex-col items-center justify-center"
          style={({ isActive }) => ({
            gap: '3px',
            font: '700 11px Inter',
            textDecoration: 'none',
            color: isActive ? '#B93412' : '#5B5B6B',
          })}
        >
          {role === 'resident' ? (
            <FilePlus2 style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
          ) : (
            <List style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
          )}
          <span>{role === 'resident' ? 'Report' : 'Queue'}</span>
        </NavLink>

        {role === 'resident' ? (
          <button
            type="button"
            onClick={() => (isOnline ? setSosModalOpen(true) : (window.location.href = 'tel:112'))}
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: '#D92D20',
              color: '#fff',
              font: '800 14px Inter',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '-28px',
              border: '4px solid #fff',
              boxShadow: '0 4px 12px rgba(217, 45, 32, 0.3)',
              cursor: 'pointer',
            }}
            aria-label={isOnline ? 'Trigger SOS' : 'Call 112 Offline'}
          >
            {isOnline ? 'SOS' : <PhoneCall className="w-5 h-5" />}
          </button>
        ) : (
          <NavLink
            to={mobileSecondPath}
            className="flex flex-col items-center justify-center"
            style={({ isActive }) => ({
              gap: '3px',
              font: '700 11px Inter',
              textDecoration: 'none',
              color: isActive ? '#B93412' : '#5B5B6B',
            })}
          >
            <Activity style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
            <span>Active</span>
          </NavLink>
        )}

        <NavLink
          to="/notifications"
          className="flex flex-col items-center justify-center relative"
          style={({ isActive }) => ({
            gap: '3px',
            font: '700 11px Inter',
            textDecoration: 'none',
            color: isActive ? '#B93412' : '#5B5B6B',
          })}
        >
          <Bell style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
          <span>Alerts</span>
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-2px',
                right: '4px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#D92D20',
              }}
            />
          )}
        </NavLink>

        <NavLink
          to="/profile"
          className="flex flex-col items-center justify-center"
          style={({ isActive }) => ({
            gap: '3px',
            font: '700 11px Inter',
            textDecoration: 'none',
            color: isActive ? '#B93412' : '#5B5B6B',
          })}
        >
          <User style={{ width: '20px', height: '20px', strokeWidth: 2 }} />
          <span>Profile</span>
        </NavLink>
      </nav>

      {/* ── Global SOS Modal (Residents) ── */}
      {sosModalOpen && role === 'resident' && (
        <SOSFlow onClose={() => setSosModalOpen(false)} />
      )}

      {/* ── PWA Service Worker Update Prompt ── */}
      <PwaUpdatePrompt />
    </div>
  );
}
