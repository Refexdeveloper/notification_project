import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';
import PageMotion from '@/components/ui/PageMotion';
import { useAuth } from '@/hooks/AuthContext';
import { duration, easeOutExpo } from '@/lib/motion';
import { apiV1Fetch, isBackendApiMode } from '@/services/backendApi';
import { readEmbedFromSearch } from '@/lib/embedMode';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface LayoutProps {
  children: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
  /** Application / page title shown at top in embed mode */
  embedAppTitle?: string;
  /** Force embed shell even if URL has no embed=1 (rare). */
  embed?: boolean;
  /** Extra right-side header actions (normal mode only). */
  headerActions?: React.ReactNode;
}

const SIDEBAR_KEY = 'ne_sidebar_collapsed';
const SIDEBAR_EXPANDED = 264;
const SIDEBAR_COLLAPSED = 72;
const HOURLY_SYNC_MS = 60 * 60 * 1000;
const MOBILE_MQ = '(max-width: 767px)';

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

export default function Layout({ children, breadcrumbs, title, embedAppTitle, embed: embedProp, headerActions }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_MQ).matches;
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const embed = embedProp ?? readEmbedFromSearch(searchParams);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setMobileNavOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileNavOpen((v) => !v);
      return;
    }
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [isMobile]);

  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate, location.pathname]);

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

  const desktopMargin = embed ? 0 : sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <div className="min-h-screen app-canvas">
      {!embed ? (
        <>
          <div className="hidden md:block">
            <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          </div>

          <AnimatePresence>
            {isMobile && mobileNavOpen ? (
              <>
                <motion.button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] md:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setMobileNavOpen(false)}
                />
                <motion.div
                  className="fixed inset-y-0 left-0 z-50 w-[min(280px,86vw)] md:hidden"
                  initial={{ x: -288 }}
                  animate={{ x: 0 }}
                  exit={{ x: -288 }}
                  transition={{ duration: duration.base, ease: easeOutExpo }}
                >
                  <Sidebar collapsed={false} onToggle={() => setMobileNavOpen(false)} />
                </motion.div>
              </>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}

      <motion.div
        className="min-h-screen"
        initial={false}
        animate={{ marginLeft: isMobile || embed ? 0 : desktopMargin }}
        transition={{ duration: duration.base, ease: easeOutExpo }}
      >
        <Header
          breadcrumbs={embed ? [] : breadcrumbs}
          title={embed ? embedAppTitle || title || 'Engagement overview' : title}
          onMenuClick={embed ? undefined : toggleSidebar}
          menuOpen={embed ? false : isMobile ? mobileNavOpen : !sidebarCollapsed}
          embed={embed}
          actions={embed ? undefined : headerActions}
        />
        <main className={`w-full max-w-[1600px] px-3 py-3 sm:px-5 sm:py-5 lg:px-6 ${embed ? 'max-w-none' : ''}`}>
          <PageMotion>{children}</PageMotion>
        </main>
      </motion.div>
    </div>
  );
}
