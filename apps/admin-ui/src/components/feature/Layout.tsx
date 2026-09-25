import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';
import PageMotion from '@/components/ui/PageMotion';
import { useAuth } from '@/hooks/AuthContext';
import { duration, easeOutExpo } from '@/lib/motion';
import { readEmbedFromSearch, resolveEmbedReturnUrl } from '@/lib/embedMode';

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
const MOBILE_MQ = '(max-width: 767px)';

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

  useEffect(() => {
    if (!embed) return undefined;
    document.body.classList.add('embed-shell');
    const returnTo = resolveEmbedReturnUrl(searchParams);
    // One guard entry so the first browser Back always fires popstate (even on direct/new-tab opens).
    window.history.pushState({ refexEmbedBack: true }, '');
    const onPopState = () => {
      window.location.replace(returnTo);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.body.classList.remove('embed-shell');
    };
  }, [embed, searchParams]);

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

  // Incremental sync runs on Cloud Scheduler (runbook 36) — do not trigger from the browser;
  // it competes with dashboard queries for DB pool connections and Kissflow API quota.

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
