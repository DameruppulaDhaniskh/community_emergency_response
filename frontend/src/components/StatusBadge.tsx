import type { IncidentStatus, DeliveryStatus } from '../api/types';
import Chip, { type ChipVariant } from './Chip';

export type BadgeVariant =
  | 'reported'
  | 'acknowledged'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'info'
  | 'verified'
  | 'unverified'
  | 'declined';

const variantToChip: Record<BadgeVariant, ChipVariant> = {
  reported: 'warn',
  acknowledged: 'info',
  assigned: 'info',
  in_progress: 'bad',
  resolved: 'ok',
  closed: 'ok',
  pending: 'warn',
  sent: 'ok',
  delivered: 'ok',
  failed: 'bad',
  info: 'info',
  verified: 'ok',
  unverified: 'warn',
  declined: 'bad',
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  className?: string;
}

export default function StatusBadge({ variant, label, className = '' }: StatusBadgeProps) {
  const chipVariant = variantToChip[variant] || 'info';
  return (
    <Chip variant={chipVariant} className={className}>
      {label}
    </Chip>
  );
}

export function incidentStatusVariant(status: IncidentStatus): BadgeVariant {
  switch (status) {
    case 'REPORTED':
      return 'reported';
    case 'ACKNOWLEDGED':
      return 'acknowledged';
    case 'ASSIGNED':
      return 'assigned';
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'RESOLVED':
      return 'resolved';
    case 'CLOSED':
      return 'closed';
    default:
      return 'info';
  }
}

export function deliveryStatusVariant(status: DeliveryStatus): BadgeVariant {
  switch (status) {
    case 'SENT':
      return 'sent';
    case 'DELIVERED':
      return 'delivered';
    case 'FAILED':
      return 'failed';
    default:
      return 'pending';
  }
}
