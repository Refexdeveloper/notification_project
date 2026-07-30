import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid,
  Users,
  Shield,
  Mail,
  CalendarClock,
  History,
  Settings,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  path: string;
}

/** Product nav: Connect → Templates → Schedules → Sent → Settings */
export const navigationItems: NavItem[] = [
  { id: 'applications', label: 'Applications', hint: 'Connect Kissflow apps', icon: LayoutGrid, path: '/applications' },
  { id: 'users', label: 'Users', hint: 'Full account directory', icon: Users, path: '/users' },
  { id: 'platform-users', label: 'Admin users', hint: 'Portal access & roles', icon: Shield, path: '/platform-users' },
  { id: 'templates', label: 'Report templates', hint: 'HTML emails per app', icon: Mail, path: '/templates' },
  { id: 'schedulers', label: 'Schedules', hint: 'When & who to send', icon: CalendarClock, path: '/schedulers' },
  { id: 'history', label: 'Sent history', hint: 'What went out', icon: History, path: '/history' },
  { id: 'settings', label: 'Settings', hint: 'Users & email setup', icon: Settings, path: '/settings' },
];
