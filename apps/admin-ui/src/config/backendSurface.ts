import type { LucideIcon } from 'lucide-react';
import {
  Home,
  LayoutDashboard,
  Radar,
  Mail,
  CalendarClock,
  History,
  Users,
  Plug,
  Layers,
  Settings,
  Table2,
} from 'lucide-react';
import { navigationItems, type NavItem } from '@/mocks/navigation';
import { isBackendApiMode } from '@/services/backendApi';

export type AppDetailTabId =
  | 'overview'
  | 'dashboard'
  | 'connection'
  | 'discovery'
  | 'resources'
  | 'records'
  | 'engagement'
  | 'templates'
  | 'schedulers'
  | 'history'
  | 'settings';

export type AppDetailTab = {
  id: AppDetailTabId;
  label: string;
  icon: LucideIcon;
  /** Hidden in backend-api mode (prototype / localStorage only). */
  prototypeOnly?: boolean;
};

/** All application detail tabs (prototype mode). */
export const APP_DETAIL_TABS: AppDetailTab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'records', label: 'Records', icon: Table2 },
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'connection', label: 'Connect', icon: Plug, prototypeOnly: true },
  { id: 'discovery', label: 'Sync fields', icon: Radar },
  { id: 'resources', label: 'Processes', icon: Layers, prototypeOnly: true },
  { id: 'engagement', label: 'Users', icon: Users },
  { id: 'templates', label: 'Templates', icon: Mail },
  { id: 'schedulers', label: 'Schedules', icon: CalendarClock },
  { id: 'history', label: 'Sent', icon: History },
  { id: 'settings', label: 'App settings', icon: Settings },
];

/** Sidebar routes hidden in backend-api mode (prototype / localStorage only, or Kissflow-owned). */
/** Keep Users (User management) visible in backend mode for CEO/CTO workload view. */
const PROTOTYPE_NAV_IDS = new Set(['templates', 'schedulers', 'settings', 'platform-users']);

export function applicationDetailTabs(): AppDetailTab[] {
  if (!isBackendApiMode()) return APP_DETAIL_TABS;
  return APP_DETAIL_TABS.filter((tab) => !tab.prototypeOnly);
}

/** Refexone embed: Dashboard + Records; Project Tracker also gets Users. */
const EMBED_TAB_IDS = new Set<AppDetailTabId>(['dashboard', 'records']);

export function applicationDetailTabsForEmbed(applicationId?: string): AppDetailTab[] {
  const ids = new Set<AppDetailTabId>(EMBED_TAB_IDS);
  const hay = String(applicationId || '').toLowerCase();
  if (hay.includes('project_management') || hay.includes('project_management_tracker')) {
    ids.add('engagement'); // Users
  }
  return APP_DETAIL_TABS.filter((tab) => ids.has(tab.id));
}

export function sidebarNavigationItems(): NavItem[] {
  if (!isBackendApiMode()) return navigationItems;
  return navigationItems.filter((item) => !PROTOTYPE_NAV_IDS.has(item.id));
}

export function isPrototypeOnlyAppTab(tabId: string): boolean {
  const tab = APP_DETAIL_TABS.find((t) => t.id === tabId);
  return Boolean(tab?.prototypeOnly);
}

export function defaultApplicationTab(): AppDetailTabId {
  return 'dashboard';
}
