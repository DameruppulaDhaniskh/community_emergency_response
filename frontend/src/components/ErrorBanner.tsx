import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      style={{
        background: '#FEE2E2',
        border: '1px solid #FCA5A5',
        color: '#991B1B',
        borderRadius: '14px',
        padding: '14px 18px',
      }}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2.5 text-sm font-semibold">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ghost"
          style={{ padding: '6px 12px', fontSize: '12px', borderColor: '#FCA5A5', color: '#991B1B' }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

