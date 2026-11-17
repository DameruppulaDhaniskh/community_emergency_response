import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import type { UserRole } from '../api/types';
import { Loader2 } from 'lucide-react';

interface GuardProps {
  allowed?: UserRole[];
}

export function RequireAuth({ allowed }: GuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowed && user && !allowed.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}

export function RedirectIfAuth() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    const home = roleHome(user.role);
    return <Navigate to={home} replace />;
  }

  return <Outlet />;
}

export function roleHome(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin/dashboard';
    case 'security':
      return '/security/dashboard';
    case 'guardian':
      return '/guardian/incidents';
    case 'volunteer':
      return '/volunteer/incidents';
    case 'resident':
    default:
      return '/resident/home';
  }
}
