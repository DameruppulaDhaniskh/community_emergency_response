import type { HTMLAttributes, ReactNode } from 'react';

export type ChipVariant = 'ok' | 'warn' | 'bad' | 'info';

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

export function Chip({ variant = 'ok', children, className = '', ...props }: ChipProps) {
  return (
    <span className={`chip ${variant} ${className}`} {...props}>
      {children}
    </span>
  );
}

export default Chip;
