import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { sidebarNavigationItems } from '@/config/backendSurface';
import { useAuth } from '@/hooks/AuthContext';
import refexLogo from '@/assets/refex-logo.png';
import { duration, easeOutExpo } from '@/lib/motion';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function SidebarToggleButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-9 h-9 rounded-lg border border-[#E5E7EB] text-[#64748B] hover:bg-[#E8F3FC] hover:text-[#0F6CBD] cursor-pointer active:scale-95 transition-colors flex items-center justify-center shrink-0"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
    </button>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [hovered, setHovered] = useState<string | null>(null);

  const isActive = useCallback(
    (path: string) => {
      if (path === '/' || path === '/applications') {
        return location.pathname === '/' || location.pathname.startsWith('/applications');
      }
      return location.pathname.startsWith(path);
    },
    [location.pathname],
  );

  const initials = (user?.name || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <motion.aside
      className="fixed left-0 top-0 bottom-0 z-40 flex flex-col overflow-hidden border-r border-[#D7E6F4]/90 bg-white/90 backdrop-blur-md"
      initial={false}
      animate={{ width: collapsed ? 72 : 264 }}
      transition={{ duration: duration.base, ease: easeOutExpo }}
    >
      <div
        className={`flex items-center h-14 shrink-0 border-b border-[#EEF2F7] ${
          collapsed ? 'justify-center px-2' : 'px-4'
        }`}
      >
        <img
          src={refexLogo}
          alt="Refex"
          className={`object-contain transition-[width,height] duration-200 ${
            collapsed ? 'h-7 w-7' : 'h-8 w-auto max-w-[132px]'
          }`}
        />
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
        {!collapsed && (
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
            Workspace
          </p>
        )}

        {sidebarNavigationItems().map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              className={`relative w-full flex items-center rounded-[10px] transition-[background-color,color] duration-150 ease-out cursor-pointer active:scale-[0.98] ${
                collapsed ? 'justify-center h-11' : 'gap-3 px-3 py-2.5 min-h-[44px]'
              } ${
                active
                  ? 'bg-[#E8F3FC] text-[#0A5A9E]'
                  : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F8FAFC]'
              }`}
            >
              {active && (
                <span
                  className={`absolute w-[3px] rounded-r-full bg-[#0F6CBD] ${
                    collapsed
                      ? 'left-0 top-[10px] bottom-[10px]'
                      : 'left-0 top-2 bottom-2'
                  }`}
                  aria-hidden
                />
              )}
              <Icon
                className={`shrink-0 ${collapsed ? 'w-5 h-5' : 'w-5 h-5'}`}
                strokeWidth={active ? 2.2 : 1.85}
              />
              {!collapsed && (
                <span className="text-left min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight truncate">
                    {item.label}
                  </span>
                  <span className="block text-[10px] text-[#94A3B8] font-medium leading-tight mt-0.5 truncate">
                    {item.hint}
                  </span>
                </span>
              )}
              {collapsed && hovered === item.id && (
                <div
                  className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-[#1E293B] text-white text-xs font-medium whitespace-nowrap z-50 shadow-md pointer-events-none"
                  role="tooltip"
                >
                  {item.label}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 mt-auto border-t border-[#EEF2F7]">
        {collapsed ? (
          <>
            <div className="h-[52px] flex items-center justify-center">
              <div
                className="w-10 h-10 rounded-xl bg-[#E8F3FC] flex items-center justify-center text-[#0A5A9E] text-[11px] font-bold"
                title={user?.name || 'User'}
              >
                {initials}
              </div>
            </div>
            <div className="h-12 flex items-center justify-center border-t border-[#EEF2F7]">
              <SidebarToggleButton collapsed={collapsed} onToggle={onToggle} />
            </div>
          </>
        ) : (
          <div className="h-[52px] flex items-center px-2.5">
            <div className="flex items-center gap-3 w-full min-w-0">
              <div className="w-9 h-9 rounded-[10px] bg-[#E8F3FC] flex items-center justify-center text-[#0A5A9E] text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#1E293B] truncate">{user?.name || 'User'}</p>
                <p className="text-[11px] text-[#64748B] truncate">{user?.role || 'Member'}</p>
              </div>
              <SidebarToggleButton collapsed={collapsed} onToggle={onToggle} />
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
