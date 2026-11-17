import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 60,
        background: '#1A1A2E',
        color: '#fff',
        borderRadius: '14px',
        padding: '12px 16px',
        boxShadow: '0 8px 24px rgba(20,20,40,.22)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        font: '600 13px Inter',
      }}
    >
      <span>New version available</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        style={{
          background: '#D9381E',
          color: '#fff',
          border: 0,
          borderRadius: '10px',
          padding: '6px 12px',
          font: '700 12px Inter',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Refresh
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss update notification"
        style={{ background: 'transparent', border: 0, color: '#D5D5DE', cursor: 'pointer', padding: '2px' }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

