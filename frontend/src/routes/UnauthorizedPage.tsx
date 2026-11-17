import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { roleHome } from './guards';
import Button from '../components/Button';
import { ShieldOff } from 'lucide-react';

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-full bg-warning-light flex items-center justify-center mx-auto mb-4">
          <ShieldOff className="w-7 h-7 text-warning-text" />
        </div>
        <h1 className="text-xl font-semibold text-ink mb-1">Access denied</h1>
        <p className="text-sm text-ink-secondary mb-6">
          You don't have permission to view this page. If you think this is a mistake, contact your society administrator.
        </p>
        <Button onClick={() => navigate(user ? roleHome(user.role) : '/login')}>
          Go to home
        </Button>
      </div>
    </div>
  );
}

