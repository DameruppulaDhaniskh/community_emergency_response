import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standard PageContainer ensuring no page touches screen edges or stretches endlessly on desktop.
 * - Max-width: 1120px centered
 * - 24px side padding (16px on mobile)
 * - 24px vertical section rhythm
 */
export default function PageContainer({ children, className = '' }: PageContainerProps) {
  return (
    <div className={`w-full max-w-[1120px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-6 ${className}`}>
      {children}
    </div>
  );
}

