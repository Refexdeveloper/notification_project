import { motion } from 'framer-motion';
import {
  BarChart3,
  CalendarClock,
  FileCode2,
  ShieldCheck,
  Sparkles,
  Zap,
  Building2,
} from 'lucide-react';
import refexLogo from '@/assets/refex-logo.png';
import DashboardIllustration from './DashboardIllustration';
import FloatingCard from './FloatingCard';
import FeatureChip from './FeatureChip';
import AnimatedConnector from './AnimatedConnector';

/** Full-bleed hero — sized to fill one viewport with the login card */
export default function HeroSection() {
  return (
    <motion.section
      className="relative flex h-full min-h-0 flex-col justify-between py-1 pr-2 xl:pr-6"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative z-10 shrink-0">
        <div className="flex items-center gap-3.5 mb-3">
          <img src={refexLogo} alt="Refex" className="h-9 xl:h-10 w-auto object-contain" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDDF0] bg-[#E8F3FC]/90 px-3 py-1 text-[11px] font-semibold text-[#0F6CBD]">
            <Sparkles className="h-3.5 w-3.5" />
            Refex AI Suite
          </span>
        </div>
        <h1 className="text-[36px] xl:text-[44px] 2xl:text-[48px] font-extrabold tracking-tight text-[#1E293B] leading-[1.08]">
          Notification Engine
        </h1>
        <p className="mt-2 text-[22px] xl:text-[26px] 2xl:text-[28px] font-extrabold tracking-tight leading-tight">
          <span className="text-[#0F6CBD]">Connect.</span>{' '}
          <span className="text-[#22C55E]">Automate.</span>{' '}
          <span className="text-[#F59E0B]">Notify.</span>
        </p>
        <p className="mt-2.5 max-w-xl text-[14px] xl:text-[15px] text-[#64748B] leading-snug line-clamp-2">
          Connect Kissflow apps, craft branded HTML reports, and schedule deliveries with enterprise polish.
        </p>
      </div>

      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center my-3 xl:my-4">
        <div className="relative w-full max-w-[640px] xl:max-w-[720px] 2xl:max-w-[780px] aspect-[560/380] max-h-full">
          <AnimatedConnector d="M 95 85 C 140 100, 170 125, 210 150" delay={0} color="#A855F7" />
          <AnimatedConnector d="M 465 85 C 420 105, 390 130, 350 155" delay={0.4} color="#22C55E" />
          <AnimatedConnector d="M 90 290 C 140 270, 175 245, 215 225" delay={0.8} color="#0F6CBD" />
          <AnimatedConnector d="M 470 295 C 420 270, 385 250, 345 225" delay={1.2} color="#14B8A6" />

          <div className="absolute left-1/2 top-1/2 w-[78%] xl:w-[80%] -translate-x-1/2 -translate-y-1/2">
            <DashboardIllustration />
          </div>

          <FloatingCard
            title="HTML Reports"
            subtitle="Branded emails"
            icon={FileCode2}
            accent="#A855F7"
            iconBg="#F3E8FF"
            className="left-0 top-0"
            floatDelay={0}
          />
          <FloatingCard
            title="Smart Scheduling"
            subtitle="Daily · Weekly"
            icon={CalendarClock}
            accent="#22C55E"
            iconBg="#DCFCE7"
            className="right-0 top-0"
            floatDelay={1}
          />
          <FloatingCard
            title="Secure Workspace"
            subtitle="RBAC ready"
            icon={ShieldCheck}
            accent="#0F6CBD"
            iconBg="#DBEAFE"
            className="left-0 bottom-0"
            floatDelay={2}
          />
          <FloatingCard
            title="Live Analytics"
            subtitle="Delivery insights"
            icon={BarChart3}
            accent="#14B8A6"
            iconBg="#CCFBF1"
            className="right-0 bottom-0"
            floatDelay={3}
          />
        </div>
      </div>

      <div className="relative z-10 shrink-0 flex flex-wrap items-center gap-2.5">
        <FeatureChip label="Real-time Analytics" icon={BarChart3} delay={0.2} />
        <FeatureChip label="Multiple Channels" icon={Zap} delay={0.28} />
        <FeatureChip label="Enterprise Ready" icon={Building2} delay={0.36} />
        <span className="ml-auto text-[11px] text-[#94A3B8] hidden xl:inline">
          Built with <span className="text-[#F43F5E]">❤️</span> by Refex AI Team
        </span>
      </div>
    </motion.section>
  );
}
