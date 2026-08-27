import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Search, X } from 'lucide-react';
import { useAuth } from '@/hooks/AuthContext';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
  subtitle?: string;
  /** Optional third line under subtitle (embed: Good morning) */
  eyebrow?: string;
  onMenuClick?: () => void;
  menuOpen?: boolean;
  /** Refexone embed shell — no sidebar menu / lighter chrome */
  embed?: boolean;
  actions?: ReactNode;
}

export default function Header({
  breadcrumbs = [],
  title,
  subtitle,
  eyebrow,
  onMenuClick,
  menuOpen,
  embed = false,
  actions,
}: HeaderProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 flex items-center gap-2 border-b border-[#D7E6F4]/80 bg-white/80 px-3 backdrop-blur-md sm:gap-3 sm:px-6 ${
        embed ? 'min-h-[4.5rem] py-2.5 sm:min-h-[5.25rem]' : 'h-14 sm:h-16'
      }`}
    >
      {onMenuClick ? (
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[#64748B] hover:bg-[#E8F3FC] hover:text-[#0F6CBD] md:hidden"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      ) : null}

      <div className="min-w-0 flex-1">
        {!embed && breadcrumbs.length > 0 ? (
          <nav className="flex min-w-0 items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="hidden text-xs text-[#CBD5E1] sm:inline">/</span>}
                {crumb.path && i < breadcrumbs.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.path!)}
                    className={`cursor-pointer truncate text-[13px] font-medium text-[#64748B] hover:text-[#1E293B] ${
                      i < breadcrumbs.length - 1 ? 'hidden sm:inline' : ''
                    }`}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="truncate text-[13px] font-semibold text-[#1E293B]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : embed ? (
          <div className="min-w-0">
            <p className="truncate text-lg font-bold tracking-tight text-[#1E293B] sm:text-2xl">
              {title || 'Engagement overview'}
            </p>
          </div>
        ) : (
          <div>
            <p className="truncate text-[13px] font-semibold text-[#1E293B] sm:text-[15px]">
              {title || 'Notification Engine'}
            </p>
            <p className="hidden text-[11px] text-[#64748B] sm:block">
              {subtitle || 'Templates · Schedules · Delivery'}
            </p>
          </div>
        )}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}

      {!embed ? (
        <div ref={searchRef} className="relative hidden md:block">
          <div
            className={`flex h-10 items-center gap-2.5 rounded-[10px] border px-3.5 transition-colors ${
              searchFocused
                ? 'w-[280px] border-[#0F6CBD] bg-white shadow-[0_0_0_3px_rgba(15,108,189,0.12)]'
                : 'w-[220px] border-[#E5E7EB] bg-[#F8FAFC]'
            }`}
          >
            <Search className="h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search workspace…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              className="min-w-0 flex-1 border-none bg-transparent text-sm text-[#1E293B] outline-none placeholder:text-[#94A3B8]"
              aria-label="Search workspace"
            />
          </div>
        </div>
      ) : null}

      {!embed ? (
        <button
          type="button"
          onClick={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] text-[#64748B] hover:bg-[#FDECEC] hover:text-[#DC3545]"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      ) : null}
    </header>
  );
}
