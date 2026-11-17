import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getUnreadCount } from '../api/notifications';
import { useAuth } from '../features/auth/AuthContext';

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 15_000,
    enabled: !!user,
  });

  const count = data?.unread_count ?? 0;

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      aria-label={`Notifications (${count} unread)`}
      className="ghost relative"
      style={{
        padding: '9px 12px',
        borderRadius: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <Bell className="w-4 h-4" style={{ color: count > 0 ? '#D9381E' : '#4A4A5A' }} />
      <span style={{ font: '700 13px Inter', color: '#1A1A2E' }}>Notifications</span>
      {count > 0 && (
        <span
          data-testid="unread-badge"
          style={{
            background: '#D92D20',
            color: '#fff',
            font: '700 11px Inter',
            padding: '2px 7px',
            borderRadius: '99px',
            lineHeight: 1.2,
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

