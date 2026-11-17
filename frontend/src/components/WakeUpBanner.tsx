import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { subscribeWakeUp } from '../api/client';

export default function WakeUpBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => subscribeWakeUp(setWaking), []);

  if (!waking) return null;

  return (
    <div
      role="status"
      style={{
        background: '#DBEAFE',
        border: '1px solid #93C5FD',
        color: '#1E40AF',
        borderRadius: '14px',
        padding: '10px 16px',
        font: '600 13px Inter',
      }}
      className="flex items-center gap-2.5"
    >
      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      <span>Waking up the server, this can take up to a minute. Retrying automatically...</span>
    </div>
  );
}

