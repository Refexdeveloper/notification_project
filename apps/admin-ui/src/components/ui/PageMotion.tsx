import { motion, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { duration, easeOutSoft, pageVariants } from '@/lib/motion';

interface PageMotionProps {
  children: React.ReactNode;
  className?: string;
}

/** Subtle enter animation on route / content key changes. */
export default function PageMotion({ children, className }: PageMotionProps) {
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={location.pathname}
      className={className}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={
        reduce
          ? { duration: 0.01 }
          : { duration: duration.base, ease: easeOutSoft }
      }
    >
      {children}
    </motion.div>
  );
}
