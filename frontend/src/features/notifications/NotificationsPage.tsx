import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { format, formatDistanceToNow, mapApiError } from '../../lib/formatters';
import { SkeletonCard } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import { Bell, CheckCheck } from 'lucide-react';

type FilterTab = 'All' | 'Unread' | 'Alerts' | 'Updates';

export default function NotificationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('All');

  const queryParams =
    filter === 'Unread'
      ? { is_read: false, channel: 'in_app' }
      : filter === 'Alerts'
      ? { type: 'alerts' as const, channel: 'in_app' }
      : filter === 'Updates'
      ? { type: 'updates' as const, channel: 'in_app' }
      : { channel: 'in_app' };

  const {
    data: notifications,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => getNotifications(queryParams),
    refetchInterval: 10_000,
  });

  const invalidateNotifs = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markOneMut = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => {
      invalidateNotifs();
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not mark notification read.')),
  });

  const markAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: (res) => {
      invalidateNotifs();
      toast.success(
        res.marked_read > 0
          ? `Marked ${res.marked_read} notification(s) as read.`
          : 'All notifications are already read.'
      );
    },
    onError: (err) => toast.error(mapApiError(err, 'Could not mark all notifications read.')),
  });

  // Deduplicate notifications so that identical alerts are never shown more than once
  const seenKeys = new Set<string>();
  const list = (notifications || []).filter((n) => {
    const idKey = `id:${n.id}`;
    if (seenKeys.has(idKey)) return false;
    seenKeys.add(idKey);

    const contentKey = `${n.event_type}:${n.incident ?? 'no-inc'}:${n.title.trim()}:${n.message.trim()}`;
    if (seenKeys.has(contentKey)) return false;
    seenKeys.add(contentKey);

    return true;
  });

  const targetPathForNotification = (eventType: string, incidentId: number | null) => {
    if (eventType === 'GUARDIAN_REQUEST') return '/guardian/alerts';
    if (eventType === 'GUARDIAN_ACCEPTED' || eventType === 'GUARDIAN_DECLINED') return '/resident/contacts';
    if (incidentId) {
      if (user?.role === 'admin') return `/admin/incidents/${incidentId}`;
      if (user?.role === 'volunteer') return `/volunteer/incidents/${incidentId}`;
      return `/incidents/${incidentId}`;
    }
    return null;
  };

  const chipFor = (eventType: string, deliveryStatus: string, channel: string) => {
    if (deliveryStatus === 'FAILED') return { label: 'Failed', cls: 'bad' };
    if (eventType === 'ESCALATED') return { label: 'Escalated', cls: 'bad' };
    if (eventType === 'INCIDENT_REPORTED') return { label: 'Alert', cls: 'warn' };
    if (eventType === 'INCIDENT_ASSIGNED') return { label: 'Assigned', cls: 'info' };
    if (eventType === 'STATUS_CHANGED') return { label: 'Update', cls: 'ok' };
    if (eventType === 'EVIDENCE_ADDED') return { label: 'Evidence', cls: 'info' };
    if (eventType === 'GUARDIAN_REQUEST') return { label: 'Guardian Request', cls: 'warn' };
    if (eventType === 'GUARDIAN_ACCEPTED') return { label: 'Accepted', cls: 'ok' };
    if (eventType === 'GUARDIAN_DECLINED') return { label: 'Declined', cls: 'bad' };
    return { label: channel.toUpperCase(), cls: 'info' };
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1020px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 style={{ font: '800 34px Inter', color: '#1A1A2E', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Notifications
          </h1>
          <p style={{ font: '500 15px Inter', color: '#5B5B6B', marginTop: '4px' }}>
            Real-time alerts, assignment updates, and status changes across your society.
          </p>
        </div>

        <button
          type="button"
          disabled={!isOnline || markAllMut.isPending}
          title={!isOnline ? 'Unavailable while offline' : undefined}
          onClick={() => markAllMut.mutate()}
          className="ghost"
        >
          <CheckCheck className="w-4 h-4" />
          {markAllMut.isPending ? 'Marking...' : 'Mark all as read'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['All', 'Unread', 'Alerts', 'Updates'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`cat ${filter === tab ? 'on' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isError && (
        <ErrorBanner
          message={mapApiError(error, 'Failed to load notifications.')}
          onRetry={() => refetch()}
        />
      )}

      {isLoading ? (
        <SkeletonCard count={4} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bell className="w-5 h-5 text-[#B93412]" />}
            title={filter === 'Unread' ? 'You are all caught up' : 'No notifications yet'}
            description={
              filter === 'Unread'
                ? 'All of your in-app notifications have been read.'
                : 'Alerts, volunteer assignments, and incident status updates appear here.'
            }
            action={
              filter !== 'All' ? (
                <button type="button" onClick={() => setFilter('All')} className="ghost">
                  Show All Notifications
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((item) => {
            const chip = chipFor(item.event_type, item.delivery_status, item.channel);
            const isUnreadInApp = item.channel === 'in_app' && !item.is_read;

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isUnreadInApp && isOnline) {
                    markOneMut.mutate(item.id);
                  }
                  const dest = targetPathForNotification(item.event_type, item.incident);
                  if (dest) {
                    navigate(dest);
                  }
                }}
                className="card cursor-pointer hover:shadow-md transition-shadow flex justify-between items-start gap-4"
                style={{
                  padding: '16px 20px',
                  borderLeft: isUnreadInApp ? '4px solid #D9381E' : '4px solid transparent',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`chip ${chip.cls}`}>{chip.label}</span>
                    <span style={{ font: '800 15px Inter', color: '#1A1A2E' }}>{item.title}</span>
                    {isUnreadInApp && (
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: '#D9381E',
                          display: 'inline-block',
                        }}
                      />
                    )}
                  </div>
                  <p style={{ font: '500 13px/1.5 Inter', color: '#5B5B6B', marginTop: '4px' }}>
                    {item.message}
                  </p>
                  <div style={{ font: '500 12px Inter', color: '#717184', marginTop: '6px' }}>
                    {item.incident ? `Incident #${item.incident}` : 'Safety Circle'} · {item.channel.toUpperCase()}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span
                    title={format(item.created_at)}
                    style={{ font: '600 12px Inter', color: '#5B5B6B' }}
                  >
                    {formatDistanceToNow(item.created_at)}
                  </span>
                  {isUnreadInApp && (
                    <button
                      type="button"
                      disabled={!isOnline || markOneMut.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        markOneMut.mutate(item.id);
                      }}
                      className="ghost"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
