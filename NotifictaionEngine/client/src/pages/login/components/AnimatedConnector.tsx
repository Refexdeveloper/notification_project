import { motion, useReducedMotion } from 'framer-motion';

interface AnimatedConnectorProps {
  d: string;
  delay?: number;
  color?: string;
}

/** Curved glowing SVG path — information-flow dash animation */
export default function AnimatedConnector({
  d,
  delay = 0,
  color = '#0F6CBD',
}: AnimatedConnectorProps) {
  const reduce = useReducedMotion();

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 560 420"
      fill="none"
      aria-hidden
    >
      <defs>
        <filter id={`glow-${delay}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={d} stroke={color} strokeOpacity={0.15} strokeWidth={1.5} fill="none" />
      <motion.path
        d={d}
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        fill="none"
        strokeDasharray="6 10"
        filter={`url(#glow-${delay})`}
        initial={{ strokeDashoffset: 0, opacity: 0.35 }}
        animate={
          reduce
            ? { opacity: 0.45 }
            : { strokeDashoffset: [-64, 0], opacity: [0.35, 0.85, 0.35] }
        }
        transition={{
          duration: 3.2,
          delay,
          repeat: Infinity,
          ease: 'linear',
        }}
      />
    </svg>
  );
}
