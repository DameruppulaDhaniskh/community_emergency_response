import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

export default function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center text-center
        bg-surface-sunken/40 border border-dashed border-border rounded-[14px]
        ${compact ? 'py-4 px-3' : 'py-6 px-4'}
      `}
    >
      <div className="w-10 h-10 rounded-[10px] bg-surface-sunken flex items-center justify-center mb-2.5 text-ink-tertiary shrink-0">
        {icon || <ShieldAlert className="w-5 h-5 text-ink-tertiary" />}
      </div>
      <h3 className="text-sm font-semibold text-ink leading-tight">{title}</h3>
      <p className="text-xs text-ink-secondary max-w-sm mt-1 mb-3">{description}</p>
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
