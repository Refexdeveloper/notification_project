import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  Ban,
  CalendarCheck,
  CalendarPlus,
  CheckCheck,
  CheckCircle2,
  CircleCheckBig,
  ClipboardList,
  FileInput,
  FolderCheck,
  FolderKanban,
  FolderOpen,
  GitBranch,
  Handshake,
  Inbox,
  Layers,
  ListChecks,
  ListTree,
  Luggage,
  Plane,
  PlayCircle,
  Receipt,
  ShoppingCart,
  Sun,
  Target,
  Ticket,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';

export type NeAppKind = 'itsm' | 'pm' | 'p2p' | 'travel' | 'solar' | 'lead' | 'expense' | 'consolidated' | 'default';

/** Detect which Notification Engine project a dashboard belongs to. */
export function resolveNeAppKind(appId?: string | null, appName?: string | null): NeAppKind {
  const id = `${appId || ''} ${appName || ''}`.toLowerCase();
  if (id.includes('project_management') || id.includes('project_sub_task') || id.includes('project management')) {
    return 'pm';
  }
  if (id.includes('procurement') || id.includes('p2p') || id.includes('purchase')) return 'p2p';
  if (id.includes('solar') || id.includes('technician_reimbursement') || id.includes('reinvestment') || id.includes('site_expense')) {
    return 'solar';
  }
  if (id.includes('lead')) return 'lead';
  if (id.includes('it_service') || id.includes('itsm') || id.includes('helpdesk') || id.includes('help desk')) {
    return 'itsm';
  }
  if (id.includes('ems_001') || (id.includes('expense') && !id.includes('travel') && !id.includes('solar'))) {
    return 'expense';
  }
  if (id.includes('expense_and_travel') || id.includes('venwind') || id.includes('travel')) return 'travel';
  return 'default';
}

const APP_STATUS_ICONS: Record<Exclude<NeAppKind, 'consolidated'>, [LucideIcon, LucideIcon, LucideIcon, LucideIcon]> = {
  itsm: [Ticket, Inbox, CircleCheckBig, Ban],
  pm: [FolderKanban, FolderOpen, FolderCheck, ListChecks],
  p2p: [ShoppingCart, ClipboardList, BadgeCheck, Ban],
  travel: [Plane, Luggage, CircleCheckBig, Ban],
  solar: [Sun, Zap, CircleCheckBig, Ban],
  lead: [Target, UserPlus, Handshake, Ban],
  expense: [Receipt, Wallet, CircleCheckBig, Ban],
  default: [Layers, FolderKanban, CheckCircle2, XCircle],
};

function statusIcon(kind: NeAppKind, styleIndex: number): LucideIcon {
  const set = APP_STATUS_ICONS[kind === 'consolidated' ? 'default' : kind] || APP_STATUS_ICONS.default;
  return set[styleIndex % set.length];
}

/** Icon for a KPI card — project-specific, then label-specific. Colors stay on the theme. */
export function iconForNeKpi(kind: NeAppKind, label: string, styleIndex = 0): LucideIcon {
  const l = String(label || '').toLowerCase();

  if (l.includes('opened today') || l.includes('open today')) return CalendarPlus;
  if (l.includes('closed today')) return CalendarCheck;
  if (l.includes('adoption')) return statusIcon(kind, styleIndex);

  if (kind === 'consolidated') {
    if (l.includes('total user')) return Users;
    if (l.includes('signed in') || l.includes('active')) return UserCheck;
    if (l.includes('open item') || l.includes('open ticket')) return Inbox;
    if (l.includes('closed item') || l.includes('closed ticket')) return CircleCheckBig;
    if (l.includes('total')) return Layers;
    return statusIcon('default', styleIndex);
  }

  if (kind === 'pm') {
    if (l.includes('project')) {
      if (l.includes('progress')) return FolderOpen;
      if (l.includes('completed') || l.includes('closed')) return FolderCheck;
      return FolderKanban;
    }
    if (l.includes('sub-task') || l.includes('subtask') || l.includes('sub task')) {
      if (l.includes('progress')) return GitBranch;
      if (l.includes('completed') || l.includes('closed')) return CheckCheck;
      return ListTree;
    }
    if (l.includes('individual')) {
      if (l.includes('progress')) return UserRound;
      if (l.includes('completed') || l.includes('closed')) return UserCheck;
      return Users;
    }
    if (l.includes('task')) {
      if (l.includes('progress')) return PlayCircle;
      if (l.includes('completed') || l.includes('closed')) return CheckCheck;
      return ListChecks;
    }
  }

  if (kind === 'p2p') {
    const isPr = /\bpr\b/.test(l) || l.includes('requisition');
    if (l.includes('rejected')) return Ban;
    if (l.includes('closed')) return BadgeCheck;
    if (l.includes('open')) return ClipboardList;
    return isPr ? FileInput : ShoppingCart;
  }

  if (l.includes('rejected') || l.includes('cancelled') || l.includes('withdrawn')) {
    return APP_STATUS_ICONS[kind === 'consolidated' ? 'default' : kind]?.[3] || XCircle;
  }
  if (l.includes('closed') || l.includes('completed')) return statusIcon(kind, 2);
  if (l.includes('open') || l.includes('progress')) return statusIcon(kind, 1);
  if (l.includes('total')) return statusIcon(kind, 0);

  return statusIcon(kind, styleIndex);
}
