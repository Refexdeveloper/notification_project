import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';
import PageMotion from '@/components/ui/PageMotion';
import { useAuth } from '@/hooks/AuthContext';
import { duration, easeOutExpo } from '@/lib/motion';

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
