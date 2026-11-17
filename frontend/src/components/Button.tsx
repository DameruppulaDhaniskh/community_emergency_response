import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, children, disabled, className = '', style, ...props }, ref) => {
    let baseClass = 'btn';
    if (variant === 'ghost' || variant === 'secondary') {
      baseClass = 'ghost';
    } else if (variant === 'danger') {
      baseClass = 'btn';
    }

    // Size adjustments if requested
    let sizeStyle: React.CSSProperties = {};
    if (size === 'sm') {
      sizeStyle = { padding: '8px 14px', fontSize: '13px' };
    } else if (size === 'lg' || size === 'xl') {
      sizeStyle = { padding: '16px 24px', fontSize: '15px' };
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseClass} ${className}`}
        style={{ ...sizeStyle, ...style }}
        {...props}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : icon}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
