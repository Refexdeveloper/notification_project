import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Props = {
  show: boolean;
  label?: string;
  /** Prefer viewport centering so tall pages don't push the spinner below the fold. */
  mode?: 'fixed' | 'absolute';
  className?: string;
};

/**
 * Centered blur loading overlay for dashboard/records filter & refresh.
 * Default `fixed` keeps the spinner in the middle of the visible screen.
 */
export default function DashboardLoadingOverlay({
  show,
  label = 'Updating…',
  mode = 'fixed',
  className = '',
}: Props) {
  const positionClass =
    mode === 'fixed'
      ? 'fixed inset-0 z-[60]'
      : 'absolute inset-0 z-30';

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className={`${positionClass} flex items-center justify-center bg-slate-900/30 backdrop-blur-[2px] ${className}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          aria-busy="true"
          aria-live="polite"
        >
          <motion.div
            className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-5 shadow-2xl ring-1 ring-slate-200"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <div className="relative flex h-14 w-14 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-sky-500/15 animate-ping" />
              <span className="absolute inset-1 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
              <Loader2 className="relative h-6 w-6 text-sky-700 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">{label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Almost there</p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
