import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

export interface ToastFn {
  (type: ToastType, message: string): void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

interface ToastContextType {
  toast: ToastFn;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const icons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const styles: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
  error: { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' },
  info: { bg: '#FFEDE5', border: '#FDBA74', text: '#B93412' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const toastFn = useMemo<ToastFn>(() => {
    const fn = ((type: ToastType, message: string) => addToast(type, message)) as ToastFn;
    fn.success = (msg: string) => addToast('success', msg);
    fn.error = (msg: string) => addToast('error', msg);
    fn.info = (msg: string) => addToast('info', msg);
    return fn;
  }, [addToast]);

  const removeToast = useCallback((id: string) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: toastFn }}>
      {children}
      {/* Toast container */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      >
        {toasts.map((t) => {
          const Icon = icons[t.type];
          const s = styles[t.type];
          return (
            <div
              key={t.id}
              style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                color: s.text,
                borderRadius: '14px',
                padding: '12px 14px',
                boxShadow: '0 6px 20px rgba(20,20,40,.12)',
              }}
              className="flex items-start gap-3 animate-[slideIn_0.2s_ease-out]"
              role="alert"
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-sm font-medium flex-1">{t.message}</p>
              <button
                onClick={() => removeToast(t.id)}
                className="p-0.5 hover:opacity-70 cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
