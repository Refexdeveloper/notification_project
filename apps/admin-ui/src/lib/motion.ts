import type { Transition, Variants } from 'framer-motion';

/** Snappy spring — dialogs, sheets, toggles (feels native @ 120Hz) */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.78,
};

/** Softer spring — page content, list stagger */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 36,
  mass: 0.9,
};

/** Expo-ish ease for CSS / duration-based fades */
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
export const easeOutSoft = [0.22, 1, 0.36, 1] as const;

export const duration = {
  micro: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.32,
} as const;

export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const modalPanelVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 6 },
};

export const sheetPanelVariants: Variants = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
};

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const fadeUpItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.035, delayChildren: 0.02 },
  },
};

export const reducedMotionTransition: Transition = { duration: 0.01 };
