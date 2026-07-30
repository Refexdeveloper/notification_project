import { motion, useReducedMotion } from 'framer-motion';

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: `${(i * 37) % 100}%`,
  top: `${(i * 53) % 100}%`,
  size: 2 + (i % 2),
  delay: (i % 7) * 0.35,
  duration: 9 + (i % 4) * 1.2,
  opacity: 0.12 + (i % 4) * 0.06,
}));

/** Soft glows + particles on top of `.app-canvas` grid */
export default function BackgroundEffects() {
  const reduce = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -left-20 top-[18%] h-56 w-56 rounded-full bg-[#0F6CBD]/18 blur-[90px]" />
      <div className="absolute right-[-30px] top-8 h-48 w-48 rounded-full bg-[#14B8A6]/16 blur-[80px]" />
      <div className="absolute bottom-8 left-[35%] h-40 w-40 rounded-full bg-[#0F6CBD]/10 blur-[70px]" />

      {PARTICLES.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full bg-[#0F6CBD]"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
          }}
          animate={
            reduce
              ? undefined
              : {
                  y: [0, -14, 0],
                  x: [0, p.id % 2 === 0 ? 6 : -6, 0],
                  opacity: [p.opacity, p.opacity + 0.2, p.opacity],
                }
          }
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
