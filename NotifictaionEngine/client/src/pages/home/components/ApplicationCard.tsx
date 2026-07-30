import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import { catalogEntryForApp } from '@/seeds/refexAppCatalog';
import { fadeUpItem, springSoft } from '@/lib/motion';

interface ApplicationCardProps {
  application: KissflowApplication;
}

export default function ApplicationCard({ application }: ApplicationCardProps) {
  const navigate = useNavigate();
  const catalog = catalogEntryForApp(application);
  const icon = catalog?.icon || application.icon || 'ri-apps-line';
  const tint = catalog?.tint || 'bg-[#E8F3FC] text-[#0F6CBD]';
  const processName =
    catalog?.processName ||
    application.description ||
    application.processIds?.[0] ||
    application.appId;
  const healthy = application.connected;

  return (
    <motion.button
      type="button"
      variants={fadeUpItem}
      transition={springSoft}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      className="surface text-left p-4 w-full cursor-pointer group hover:border-[#0F6CBD]/35 transition-[border-color,box-shadow] duration-200 ease-out hover:shadow-[var(--shadow-lift)]"
      onClick={() => navigate(`/applications/${application.id}`)}
    >
      <div className="flex items-center gap-3.5">
        <div
          className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${tint}`}
        >
          <i className={`${icon} text-[22px] leading-none`} aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[15px] font-heading font-semibold text-foreground-950 truncate group-hover:text-[#0A5A9E] transition-colors duration-150">
              {application.displayName || application.name}
            </h3>
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${healthy ? 'bg-accent-500' : 'bg-secondary-500'}`}
              title={healthy ? 'Connected' : 'Needs setup'}
            />
          </div>
          <p className="text-xs text-foreground-500 truncate mt-0.5">{processName}</p>
        </div>

        <ArrowRight className="w-4 h-4 text-foreground-300 group-hover:text-[#0F6CBD] group-hover:translate-x-0.5 transition-all duration-200 ease-out shrink-0" />
      </div>
    </motion.button>
  );
}
