import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';
import PageMotion from '@/components/ui/PageMotion';
import { useAuth } from '@/hooks/AuthContext';
import { duration, easeOutExpo } from '@/lib/motion';
import { apiV1Fetch, isBackendApiMode } from '@/services/backendApi';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface LayoutProps {
  children: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
}

const SIDEBAR_KEY = 'ne_sidebar_collapsed';
const SIDEBAR_EXPANDED = 264;
const SIDEBAR_COLLAPSED = 72;
const HOURLY_SYNC_MS = 60 * 60 * 1000;

/** Weekdays Mon–Fri, 09:00–18:59 Asia/Kolkata (matches Cloud Scheduler window). */
function isWeekdayBusinessHoursIst(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value || '0';
  const hour = Number(hourRaw === '24' ? '0' : hourRaw);
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  return isWeekday && hour >= 9 && hour <= 18;
}

export default function Layout({ children, breadcrumbs, title }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate, location.pathname]);

  // Hourly background sync: in-progress + newly modified fields (and stale engagement).
  useEffect(() => {
    if (!isAuthenticated || !isBackendApiMode()) return;

    const run = () => {
      if (!isWeekdayBusinessHoursIst()) return;
      void apiV1Fetch('/ops/incremental-sync?environment=production', {
        method: 'POST',
        body: JSON.stringify({ refresh_engagement: true }),
      });
    };

    const initial = window.setTimeout(run, 15_000);
    const interval = window.setInterval(run, HOURLY_SYNC_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) return null;

  const marginLeft = sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <div className="min-h-screen app-canvas">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <motion.div
        className="min-h-screen"
        initial={false}
        animate={{ marginLeft }}
        transition={{ duration: duration.base, ease: easeOutExpo }}
      >
        <Header breadcrumbs={breadcrumbs} title={title} />
        <main className="px-4 sm:px-6 py-5 max-w-[1440px]">
          <PageMotion>{children}</PageMotion>
        </main>
      </motion.div>
    </div>
  );
}
