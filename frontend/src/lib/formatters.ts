import { formatDistanceToNow, format } from './dateUtils';
import type { IncidentStatus, EmergencyType, DeliveryStatus, ContactType, Relationship } from '../api/types';

// ── Status labels (Milestone 3 official 6 statuses) ──
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  REPORTED: 'Reported',
  ACKNOWLEDGED: 'Acknowledged',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  medical: 'Medical',
  fall: 'Fall / Injury',
  fire: 'Fire',
  security: 'Security threat',
  accident: 'Accident',
  other: 'Other',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Pending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  primary_guardian: 'Primary guardian',
  secondary_guardian: 'Secondary guardian',
  emergency_contact: 'Emergency contact',
};

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  spouse: 'Spouse',
  parent: 'Parent',
  sibling: 'Sibling',
  child: 'Child',
  relative: 'Relative',
  friend: 'Friend',
  neighbor: 'Neighbour',
  colleague: 'Colleague',
  doctor: 'Doctor',
  other: 'Other',
};

export const ROLE_LABELS: Record<string, string> = {
  resident: 'Resident',
  guardian: 'Guardian',
  volunteer: 'Volunteer',
  security: 'Security',
  admin: 'Admin',
};

export function mapApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const axiosErr = err as { response?: { status?: number; data?: Record<string, unknown> }; message?: string };
  const status = axiosErr?.response?.status;
  const data = axiosErr?.response?.data;

  if (data) {
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.error === 'string') return data.error;
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val) && typeof val[0] === 'string') {
        return key === 'non_field_errors' ? val[0] : `${key}: ${val[0]}`;
      }
      if (typeof val === 'string') return `${key}: ${val}`;
    }
  }

  if (status === 400) return 'Please check the entered details and try again.';
  if (status === 401) return 'Your session has expired. Please log in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested record could not be found.';
  if (status && status >= 500) return 'The server encountered an error. Please try again shortly.';

  return axiosErr?.message || fallback;
}

// ── Re-export date utils ──
export { formatDistanceToNow, format };

// ── Full name helper ──
export function fullName(first: string, last: string, username: string): string {
  const name = [first, last].filter(Boolean).join(' ');
  return name || username;
}

// ── Initials ──
export function initials(first: string, last: string): string {
  return [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}
