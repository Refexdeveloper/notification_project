/**
 * Project Management portfolio — FE helpers that must stay aligned with:
 * - db/seeds/pm-engagement-template.html
 * - services/backend-api reportStarters `pm`
 * - schedule-runner count-pm-portfolio-kpis.js / 14-render-pm-html-report.sh
 */

import {
  PM_PORTFOLIO_PROCESS_IDS,
  PM_PROJECT_BOARD_ID,
  isPmApp,
} from '@/lib/processLabels';
import type { KissflowApplication } from '@/mocks/applications';

export const PM_STARTER_ID = 'pm';

/** Placeholders the portfolio email must include (pipeline fills these). */
export const PM_PORTFOLIO_REQUIRED_PLACEHOLDERS = [
  'TotalProjects',
  'OpenProjects',
  'CompletedProjects',
  'TotalTasks',
  'PendingTasks',
  'CompletedTasks',
  'IndividualTasks',
  'TotalSubTasks',
  'OpenedToday',
  'ClosedToday',
] as const;

/** Friendly chip labels — keep in sync with seed HTML card titles. */
export const PM_PLACEHOLDER_LABELS: Record<string, string> = {
  OpenedToday: 'Opened Today',
  ClosedToday: 'Closed Today',
  TotalProjects: 'Total Projects',
  OpenProjects: 'In Progress (Projects)',
  CompletedProjects: 'Completed Projects',
  TotalTasks: 'Total Tasks',
  PendingTasks: 'In Progress (Tasks)',
  CompletedTasks: 'Completed Tasks',
  LinkedTasks: 'Project-linked Tasks',
  IndividualTasks: 'Individual Tasks',
  IndividualPending: 'In Progress (Individual)',
  IndividualCompleted: 'Completed (Individual)',
  TotalSubTasks: 'Total Sub-tasks',
  PendingSubTasks: 'In Progress (Sub-tasks)',
  CompletedSubTasks: 'Completed Sub-tasks',
  TotalUsers: 'Total Users',
  SignedInToday: 'Signed In Today',
  UserTableHtml: 'User table',
  ReportBody: 'Footer note',
};

export function pmRecommendedProcessIds(): string[] {
  return [...PM_PORTFOLIO_PROCESS_IDS];
}

export function pmRecommendedBoardIds(): string[] {
  return [PM_PROJECT_BOARD_ID];
}

export function missingPmProcessIds(app: KissflowApplication): string[] {
  const have = new Set((app.processIds || []).map((id) => id.trim()).filter(Boolean));
  return pmRecommendedProcessIds().filter((id) => !have.has(id));
}

export function missingPmBoardIds(app: KissflowApplication): string[] {
  const have = new Set((app.boardIds || []).map((id) => id.trim()).filter(Boolean));
  return pmRecommendedBoardIds().filter((id) => !have.has(id));
}

export function pmPortfolioResourcesComplete(app: KissflowApplication): boolean {
  return missingPmProcessIds(app).length === 0 && missingPmBoardIds(app).length === 0;
}

export function isPmPortfolioHtml(html: string): boolean {
  const body = String(html || '');
  return (
    body.includes('{{TotalProjects}}') &&
    body.includes('{{TotalSubTasks}}') &&
    body.includes('{{IndividualTasks}}')
  );
}

export function pmPortfolioHtmlGaps(html: string): string[] {
  const body = String(html || '');
  return PM_PORTFOLIO_REQUIRED_PLACEHOLDERS.filter((key) => !body.includes(`{{${key}}}`));
}

export function shouldShowPmSetup(app: KissflowApplication): boolean {
  return isPmApp(app.appId, app.displayName || app.name);
}

/** After attach — sync field catalogs for every registered PM process (not boards). */
export async function syncPmPortfolioProcessFields(
  app: KissflowApplication,
): Promise<{ ok: boolean; message: string }> {
  const { syncAllFieldsOnBackend } = await import('@/services/fieldsApi');
  const result = await syncAllFieldsOnBackend(app);
  if (!result.ok) {
    return { ok: false, message: result.error || 'Field sync failed' };
  }
  const synced = result.syncedProcesses ?? 0;
  const failed = result.failedProcesses?.length ?? 0;
  if (failed > 0) {
    return {
      ok: true,
      message: `Synced fields for ${synced} process(es). ${failed} failed — retry in Field sync tab.`,
    };
  }
  return {
    ok: true,
    message: `Synced fields for ${synced} process(es). Boards are linked for project counts (no field catalog).`,
  };
}
