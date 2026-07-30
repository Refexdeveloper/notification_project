import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  backdropVariants,
  duration,
  easeOutExpo,
  sheetPanelVariants,
  springSnappy,
} from '@/lib/motion';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  onExitComplete?: () => void;
}

/** Right-edge sheet with spring slide — for drill-downs and drawers. */
export default function Sheet({
  open,
  onClose,
  children,
  className = 'max-w-md',
  onExitComplete,
}: SheetProps) {
  const reduce = useReducedMotion();

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-foreground-950/30 cursor-pointer border-0"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={
              reduce
                ? { duration: 0.01 }
                : { duration: duration.fast, ease: easeOutExpo }
            }
            onClick={onClose}
          />
          <motion.aside
            className={`relative w-full h-full bg-white border-l border-background-300/60 overflow-y-auto shadow-[var(--shadow-lift)] ${className}`}
            variants={sheetPanelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduce ? { duration: 0.01 } : springSnappy}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
