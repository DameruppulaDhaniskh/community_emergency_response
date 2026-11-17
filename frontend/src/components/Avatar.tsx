interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  status?: 'verified' | 'pending' | 'offline' | 'active';
  className?: string;
}

const sizeClasses = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
  xl: 'w-14 h-14 text-base font-semibold',
};

const dotColors = {
  verified: 'bg-success',
  pending: 'bg-warning',
  offline: 'bg-ink-disabled',
  active: 'bg-critical',
};

export default function Avatar({ name, size = 'md', status, className = '' }: AvatarProps) {
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`
          ${sizeClasses[size]}
          rounded-full bg-primary-light text-primary font-semibold
          flex items-center justify-center border border-primary/20
          select-none
          ${className}
        `}
        aria-label={name}
      >
        {initials}
      </div>
      {status && (
        <span
          className={`
            absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-raised
            ${dotColors[status]}
          `}
        />
      )}
    </div>
  );
}

