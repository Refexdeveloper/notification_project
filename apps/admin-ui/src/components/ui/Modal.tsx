import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  backdropVariants,
  duration,
  easeOutExpo,
  modalPanelVariants,
  springSnappy,
} from '@/lib/motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Max width class, default max-w-[680px] */
  className?: string;
  /** Close when backdrop clicked (default true) */
  closeOnBackdrop?: boolean;
  zIndexClass?: string;
}

/** Centered modal with spring enter/exit — GPU opacity + transform only. */
export default function Modal({
  open,
  onClose,
  children,
  className = 'max-w-[680px]',
  closeOnBackdrop = true,
  zIndexClass = 'z-50',
}: ModalProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Unmount immediately when closed. AnimatePresence exit can linger in a portal
  // and leave the dialog blocking the page after Cancel.
  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <AnimatePresence>
      <div
        className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 sm:p-6`}
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          className="absolute inset-0 bg-[#0f172a]/40"
          variants={backdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={
            reduce
              ? { duration: 0.01 }
              : { duration: duration.fast, ease: easeOutExpo }
          }
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <motion.div
          className={`relative w-full max-h-[90vh] overflow-y-auto glass-strong rounded-[24px] flex flex-col ${className}`}
          style={{ boxShadow: 'var(--shadow-lift)' }}
          variants={modalPanelVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={reduce ? { duration: 0.01 } : springSnappy}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
