import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

interface FeatureChipProps {
  label: string;
  icon: LucideIcon;
  delay?: number;
}

export default function FeatureChip({ label, icon: Icon, delay = 0 }: FeatureChipProps) {
  const reduce = useReducedMotion();

  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      whileHover={reduce ? undefined : { y: -2, scale: 1.03 }}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[12px] font-semibold text-[#334155] shadow-[0_2px_10px_rgba(15,108,189,0.08)] backdrop-blur-sm cursor-default"
    >
      <Icon className="h-3.5 w-3.5 text-[#0F6CBD]" strokeWidth={2.4} />
      {label}
    </motion.span>
  );
}
