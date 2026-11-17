import client from './client';
import type { Notification, NotificationRecord, RetryResult } from './types';

export async function getNotifications(params?: {
  is_read?: boolean;
  type?: 'alerts' | 'updates';
  channel?: string;
  delivery_status?: string;
}): Promise<Notification[]> {
  const merged = { channel: 'in_app', ...(params || {}) };
  if (merged.channel === 'all') {
    delete (merged as Record<string, unknown>).channel;
  }
  const cleanParams = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== '' && v !== undefined && v !== null)
  );
  const res = await client.get<Notification[]>('/notifications/', { params: cleanParams });
  return res.data;
}

export async function getNotification(id: number): Promise<Notification> {
  const res = await client.get<Notification>(`/notifications/${id}/`);
  return res.data;
}

export async function markNotificationRead(id: number): Promise<Notification> {
  const res = await client.patch<Notification>(`/notifications/${id}/read/`);
  return res.data;
}

export async function markAllNotificationsRead(): Promise<{ marked_read: number }> {
  const res = await client.post<{ marked_read: number }>('/notifications/read-all/');
  return res.data;
}

export async function getUnreadCount(): Promise<{ unread_count: number }> {
  const res = await client.get<{ unread_count: number }>('/notifications/unread-count/');
  return res.data;
}

export async function getIncidentNotifications(
  incidentId: number,
  params?: { delivery_status?: string; channel?: string; recipient_type?: string }
): Promise<NotificationRecord[]> {
  const res = await client.get<NotificationRecord[]>(
    `/incidents/${incidentId}/notifications/`,
    { params }
  );
  return res.data;
}

export async function retryIncidentNotifications(incidentId: number): Promise<RetryResult> {
  const res = await client.post<RetryResult>(
    `/incidents/${incidentId}/notifications/retry/`
  );
  return res.data;
}
