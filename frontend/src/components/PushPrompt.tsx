import { useState } from 'react';
import { BellRing } from 'lucide-react';

const WEB_PUSH_ENABLED = import.meta.env.VITE_ENABLE_WEB_PUSH === 'true';

export default function PushPrompt() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  if (!WEB_PUSH_ENABLED || typeof Notification === 'undefined' || permission !== 'default') {
    return null;
  }

  const requestPush = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      // Ignored if browser disallows prompt
    }
  };

  return (
    <button
      type="button"
      onClick={requestPush}
      className="ghost"
      style={{ fontSize: '12px', padding: '7px 12px' }}
    >
      <BellRing className="w-3.5 h-3.5" />
      Enable Web Push
    </button>
  );
}

