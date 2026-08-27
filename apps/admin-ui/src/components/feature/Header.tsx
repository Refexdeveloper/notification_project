import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Search } from 'lucide-react';
import { useAuth } from '@/hooks/AuthContext';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
}

export default function Header({ breadcrumbs = [], title }: HeaderProps) {
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
    <header className="sticky top-0 z-30 h-14 sm:h-16 border-b border-[#D7E6F4]/80 bg-white/80 backdrop-blur-md px-4 sm:px-6 flex items-center gap-3">
      <div className="min-w-0">
        {breadcrumbs.length > 0 ? (
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <span className="text-[#CBD5E1] text-xs">/</span>}
                {crumb.path && i < breadcrumbs.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.path!)}
                    className="text-[#64748B] hover:text-[#1E293B] truncate cursor-pointer text-[13px] font-medium"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="text-[#1E293B] font-semibold truncate text-[13px]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : (
          <div>
            <p className="text-[13px] font-semibold text-[#1E293B]">{title || 'Notification Engine'}</p>
            <p className="text-[11px] text-[#64748B] hidden sm:block">Templates · Schedules · Delivery</p>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div ref={searchRef} className="relative hidden md:block">
        <div
          className={`flex items-center gap-2.5 px-3.5 h-10 rounded-[10px] border transition-colors ${
            searchFocused
              ? 'border-[#0F6CBD] bg-white shadow-[0_0_0_3px_rgba(15,108,189,0.12)] w-[280px]'
              : 'border-[#E5E7EB] bg-[#F8FAFC] w-[220px]'
          }`}
        >
          <Search className="w-4 h-4 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Search workspace…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            className="bg-transparent border-none outline-none text-sm text-[#1E293B] placeholder:text-[#94A3B8] flex-1 min-w-0"
            aria-label="Search workspace"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          void logout().then(() => navigate('/login', { replace: true }));
        }}
        className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-[#FDECEC] cursor-pointer text-[#64748B] hover:text-[#DC3545]"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="w-[18px] h-[18px]" />
      </button>
    </header>
  );
}
