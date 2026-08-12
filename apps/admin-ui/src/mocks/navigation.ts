import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  LayoutGrid,
  Users,
  Shield,
  Mail,
  CalendarClock,
  History,
  Settings,
  KeyRound,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  path: string;
}

/** Product nav: Dashboard → Applications → … */
export const navigationItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Metrics & recent sends', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'applications', label: 'Applications', hint: 'Connect Kissflow apps', icon: LayoutGrid, path: '/applications' },
  { id: 'users', label: 'Users', hint: 'Full account directory', icon: Users, path: '/users' },
  { id: 'platform-users', label: 'Admin users', hint: 'Portal access & roles', icon: Shield, path: '/platform-users' },
  { id: 'templates', label: 'Report templates', hint: 'HTML emails per app', icon: Mail, path: '/templates' },
  { id: 'schedulers', label: 'Schedules', hint: 'When & who to send', icon: CalendarClock, path: '/schedulers' },
  { id: 'history', label: 'Sent history', hint: 'What went out', icon: History, path: '/history' },
  { id: 'email-settings', label: 'Email settings', hint: 'SMTP login & app password', icon: KeyRound, path: '/email-settings' },
  { id: 'settings', label: 'Settings', hint: 'Users & email setup', icon: Settings, path: '/settings' },
];
