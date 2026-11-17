import type { ReactNode } from 'react';
import Card from './Card';

interface StatCardProps {
  label: string;
  value: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, className = '', onClick }: StatCardProps) {
  return (
    <Card
      padding="stat"
      className={`flex-1 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${className}`}
      onClick={onClick}
    >
      <div style={{ font: '700 12px Inter', color: '#5B5B6B', letterSpacing: '.05em' }}>
        {label}
      </div>
      <div style={{ font: '800 30px Inter', marginTop: '6px', color: '#1A1A2E' }}>
        {value}
      </div>
    </Card>
  );
}

export default StatCard;
