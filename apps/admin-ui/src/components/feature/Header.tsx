import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Search, Settings } from 'lucide-react';
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
  const { user, logout } = useAuth();
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotificationsOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = (user?.name || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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

      <div ref={notifRef} className="relative">
        <button
          type="button"
          onClick={() => setNotificationsOpen(!notificationsOpen)}
          className="relative w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-[#E8F3FC] cursor-pointer text-[#64748B]"
          aria-label="Notifications"
        >
          <Bell className="w-[18px] h-[18px]" />
          <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
        </button>

        {notificationsOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.08)] z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EEF2F7] flex items-center justify-between">
              <span className="text-sm font-semibold text-[#1E293B]">Updates</span>
            </div>
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-[#334155]">You're all caught up</p>
              <p className="text-xs text-[#94A3B8] mt-1">Activity will appear here.</p>
            </div>
          </div>
        )}
      </div>

      <div ref={userRef} className="relative">
        <button
          type="button"
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="h-10 pl-1.5 pr-2.5 rounded-[10px] hover:bg-[#E8F3FC] cursor-pointer inline-flex items-center gap-2"
        >
          <span className="w-8 h-8 rounded-[10px] bg-[#E8F3FC] flex items-center justify-center text-[#0A5A9E] text-xs font-bold">
            {initials}
          </span>
          <span className="hidden sm:block text-sm font-semibold text-[#1E293B] max-w-[100px] truncate">
            {user?.name || 'Account'}
          </span>
          <ChevronDown className="w-4 h-4 text-[#94A3B8]" />
        </button>

        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.08)] z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EEF2F7]">
              <p className="text-sm font-semibold text-[#1E293B]">{user?.name}</p>
              <p className="text-xs text-[#64748B] truncate">{user?.email}</p>
            </div>
            <div className="py-1.5">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className="w-full px-4 py-2.5 text-sm text-[#334155] hover:bg-[#F8FAFC] text-left cursor-pointer font-medium inline-flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Settings & users
              </button>
            </div>
            <div className="border-t border-[#EEF2F7] py-1.5">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="w-full px-4 py-2.5 text-sm text-[#DC3545] hover:bg-[#FDECEC] text-left cursor-pointer font-semibold inline-flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
