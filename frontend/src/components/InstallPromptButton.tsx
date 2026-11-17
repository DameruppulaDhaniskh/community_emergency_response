import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
  return isIos && isWebkit;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export default function InstallPromptButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (installed) return null;

  if (!deferredPrompt) {
    if (!isIosSafari()) return null;
    return (
      <div style={{ marginTop: '8px' }}>
        <button
          type="button"
          onClick={() => setShowIosHint((v) => !v)}
          className="ghost w-full justify-center"
          style={{ fontSize: '12px', padding: '8px 12px' }}
        >
          <Share className="w-3.5 h-3.5" />
          Install SafeCircle App
        </button>
        {showIosHint && (
          <p
            style={{
              marginTop: '6px',
              padding: '8px 10px',
              borderRadius: '10px',
              background: '#FFEDE5',
              color: '#B93412',
              font: '600 11px Inter',
              lineHeight: 1.4,
            }}
          >
            Tap <strong>Share</strong> in Safari, then choose <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
    );
  }

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <button
      type="button"
      onClick={handleInstall}
      className="ghost w-full justify-center"
      style={{ fontSize: '12px', padding: '9px 12px', borderColor: '#D9381E', color: '#B93412' }}
    >
      <Download className="w-3.5 h-3.5" />
      Install SafeCircle App
    </button>
  );
}

