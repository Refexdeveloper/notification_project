import type { LucideIcon } from 'lucide-react';
import {
  Home,
  Radar,
  Mail,
  CalendarClock,
  History,
  Users,
  Plug,
  Layers,
  Settings,
} from 'lucide-react';
import { navigationItems, type NavItem } from '@/mocks/navigation';
import { isBackendApiMode } from '@/services/backendApi';

export type AppDetailTabId =
  | 'overview'
  | 'connection'
  | 'discovery'
  | 'resources'
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
const PROTOTYPE_NAV_IDS = new Set(['templates', 'schedulers', 'settings', 'platform-users', 'users']);

export function applicationDetailTabs(): AppDetailTab[] {
  if (!isBackendApiMode()) return APP_DETAIL_TABS;
  return APP_DETAIL_TABS.filter((tab) => !tab.prototypeOnly);
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
  return 'overview';
}
