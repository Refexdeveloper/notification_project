import { CheckCircle2, X, AlertCircle, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { springSnappy } from '@/lib/motion';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (kind: ToastKind, title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev, { id, kind, title, description }]);
      window.setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[min(100%-2rem,360px)] pointer-events-none">
        <AnimatePresence mode="popLayout">
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={springSnappy}
              className="pointer-events-auto rounded-[14px] border border-[#E5E7EB] bg-white px-4 py-3 flex items-start gap-3 shadow-[var(--shadow-lift)]"
            >
              {t.kind === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-accent-600 shrink-0 mt-0.5" />
              ) : t.kind === 'error' ? (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground-900">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-foreground-500 mt-0.5">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                className="text-foreground-400 hover:text-foreground-700 cursor-pointer transition-colors duration-150"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
