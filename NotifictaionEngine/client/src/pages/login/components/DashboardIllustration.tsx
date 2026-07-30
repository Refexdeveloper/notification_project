import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Bell, CheckCircle2 } from 'lucide-react';

const KPIS = [
  { label: 'Apps', value: '12', delta: '+2', color: '#0F6CBD' },
  { label: 'Sent', value: '1.8k', delta: '+18%', color: '#14B8A6' },
  { label: 'Delivered', value: '98%', delta: '+1%', color: '#22C55E' },
  { label: 'Schedules', value: '24', delta: 'Live', color: '#F59E0B' },
];

const RECENT = [
  { app: 'ITSM', status: 'Delivered', time: '2m' },
  { app: 'Lead Tracker', status: 'Queued', time: '5m' },
];

export default function DashboardIllustration() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="relative z-10 w-full mx-auto"
      animate={reduce ? undefined : { y: [0, -4, 0] }}
      transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="absolute -inset-4 rounded-[28px] bg-[#0F6CBD]/12 blur-xl" aria-hidden />

      <div
        className="relative overflow-hidden rounded-[22px] border border-white/80 bg-white/80 p-3.5 xl:p-4 shadow-[0_16px_40px_rgba(15,108,189,0.14)] backdrop-blur-xl"
        style={{
          boxShadow:
            '0 16px 40px rgba(15,108,189,0.12), 0 0 0 1px rgba(15,108,189,0.1), inset 0 1px 0 rgba(255,255,255,0.9)',
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#94A3B8]">Operations</p>
            <p className="text-sm font-bold text-[#1E293B]">Notification Activity</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF8F0] px-1.5 py-0.5 text-[9px] font-semibold text-[#16A34A]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
            Live
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-xl border border-[#E8EEF5] bg-white/90 px-1.5 py-1.5">
              <p className="text-[8px] font-medium text-[#64748B] truncate">{k.label}</p>
              <div className="flex items-end justify-between gap-0.5">
                <p className="text-base font-bold tracking-tight text-[#1E293B]">{k.value}</p>
                <span className="text-[8px] font-semibold hidden sm:inline" style={{ color: k.color }}>
                  {k.delta}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1.35fr_0.85fr] gap-1.5 mb-2">
          <div className="rounded-xl border border-[#E8EEF5] bg-white/90 p-2">
            <p className="text-[9px] font-semibold text-[#64748B] mb-1">Delivery trend</p>
            <svg viewBox="0 0 180 48" className="w-full h-10" aria-hidden>
              <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F6CBD" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#0F6CBD" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 36 C20 32, 30 20, 45 24 C60 28, 70 12, 90 16 C110 20, 120 8, 140 12 C155 14, 168 22, 180 18 L180 48 L0 48 Z"
                fill="url(#areaFill)"
              />
              <path
                d="M0 36 C20 32, 30 20, 45 24 C60 28, 70 12, 90 16 C110 20, 120 8, 140 12 C155 14, 168 22, 180 18"
                fill="none"
                stroke="#0F6CBD"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="rounded-xl border border-[#E8EEF5] bg-white/90 p-2 flex flex-col items-center justify-center">
            <p className="text-[9px] font-semibold text-[#64748B] mb-1 self-start">Channels</p>
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="12" fill="none" stroke="#EEF2F7" strokeWidth="4" />
              <circle cx="18" cy="18" r="12" fill="none" stroke="#0F6CBD" strokeWidth="4" strokeDasharray="48 76" strokeLinecap="round" />
              <circle cx="18" cy="18" r="12" fill="none" stroke="#14B8A6" strokeWidth="4" strokeDasharray="18 76" strokeDashoffset="-48" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="rounded-xl border border-[#E8EEF5] bg-white/90 overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#EEF2F7]">
            <p className="text-[9px] font-semibold text-[#64748B] inline-flex items-center gap-1">
              <Bell className="h-3 w-3" /> Recent
            </p>
            <span className="text-[8px] font-semibold text-[#0F6CBD] inline-flex items-center gap-0.5">
              View <ArrowUpRight className="h-2.5 w-2.5" />
            </span>
          </div>
          <ul>
            {RECENT.map((r) => (
              <li
                key={r.app}
                className="flex items-center justify-between px-2 py-1 border-b border-[#F1F5F9] last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-[#1E293B] truncate">{r.app}</p>
                  <p className="text-[8px] text-[#94A3B8]">{r.time} ago</p>
                </div>
                <span
                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${
                    r.status === 'Delivered' ? 'bg-[#EDF8F0] text-[#16A34A]' : 'bg-[#FFF7E6] text-[#D97706]'
                  }`}
                >
                  {r.status === 'Delivered' && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}
