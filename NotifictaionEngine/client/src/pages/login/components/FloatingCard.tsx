import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

interface FloatingCardProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: string;
  iconBg: string;
  className?: string;
  floatDelay?: number;
}

export default function FloatingCard({
  title,
  subtitle,
  icon: Icon,
  accent,
  iconBg,
  className = '',
  floatDelay = 0,
}: FloatingCardProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={`absolute z-20 w-[140px] xl:w-[158px] rounded-[14px] border border-white/70 bg-white/70 px-2.5 py-2 shadow-[0_6px_20px_rgba(15,108,189,0.1)] backdrop-blur-md ${className}`}
      style={{ boxShadow: `0 6px 20px rgba(15,108,189,0.1), 0 0 0 1px ${accent}22` }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={
        reduce
          ? { opacity: 1, scale: 1 }
          : { opacity: 1, scale: 1, y: [0, -5, 0] }
      }
      transition={
        reduce
          ? { duration: 0.3, delay: floatDelay * 0.08 }
          : {
              opacity: { duration: 0.35, delay: floatDelay * 0.1 },
              scale: { duration: 0.35, delay: floatDelay * 0.1 },
              y: {
                duration: 4 + floatDelay * 0.25,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: floatDelay * 0.15,
              },
            }
      }
      whileHover={reduce ? undefined : { y: -6, scale: 1.03 }}
    >
      <div className="flex items-center gap-2">
        <motion.span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: iconBg, color: accent }}
          whileHover={reduce ? undefined : { rotate: -8 }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </motion.span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[#1E293B] leading-tight">{title}</p>
          <p className="truncate text-[10px] text-[#64748B]">{subtitle}</p>
        </div>
      </div>
    </motion.div>
  );
}
