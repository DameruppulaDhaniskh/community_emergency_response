import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'normal' | 'stat' | 'activity';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = '', padding = 'normal', style, ...props }, ref) => {
    let paddingStyle: React.CSSProperties = { padding: '22px' };
    if (padding === 'none') paddingStyle = { padding: '0px' };
    else if (padding === 'sm') paddingStyle = { padding: '16px 20px' };
    else if (padding === 'stat') paddingStyle = { padding: '18px' };
    else if (padding === 'activity') paddingStyle = { padding: '16px 22px' };

    return (
      <div
        ref={ref}
        className={`card ${className}`}
        style={{
          ...paddingStyle,
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export function CardHeader({
  title,
  subtitle,
  description,
  action,
  icon,
}: {
  title: string | ReactNode;
  subtitle?: string | ReactNode;
  description?: string | ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  const sub = subtitle ?? description;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {icon && (
          <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#FFEDE5', color: '#B93412', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon}
          </div>
        )}
        <div>
          <h3 style={{ font: '800 16px Inter', color: '#1A1A2E', margin: 0, marginBottom: sub ? '2px' : '0' }}>{title}</h3>
          {sub && <p style={{ font: '500 13px Inter', color: '#5B5B6B', margin: 0 }}>{sub}</p>}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

export default Card;
