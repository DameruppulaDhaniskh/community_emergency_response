import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface CategoryPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
  className?: string;
}

export function CategoryPill({ selected = false, children, className = '', ...props }: CategoryPillProps) {
  return (
    <button
      type="button"
      className={`cat ${selected ? 'on' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default CategoryPill;
