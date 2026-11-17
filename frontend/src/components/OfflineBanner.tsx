import { PhoneCall, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      style={{
        background: '#FEF3C7',
        border: '1px solid #F59E0B',
        color: '#92400E',
        borderRadius: '14px',
        padding: '12px 16px',
      }}
      className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold"
    >
      <div className="flex items-center gap-2.5">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          You are offline · Showing saved data. Sending SOS alerts, reports, and status updates requires a connection.
        </span>
      </div>
      <a
        href="tel:112"
        style={{
          background: '#D92D20',
          color: '#fff',
          borderRadius: '10px',
          padding: '7px 14px',
          font: '700 13px Inter',
          textDecoration: 'none',
        }}
        className="inline-flex items-center gap-1.5 shrink-0"
      >
        <PhoneCall className="w-3.5 h-3.5" />
        Call 112 Now
      </a>
    </div>
  );
}
