import { AlertTriangle, Users } from 'lucide-react';
import { NE_TYPE } from '@/lib/neDashType';
import type { ItsmIssueFace, ItsmTopIssueUser } from '@/lib/itsmTopIssueUsers';

export const ITSM_TOP_ISSUE_USERS_ID = 'ne-itsm-top-issue-users';
export const ITSM_TOP_SR_USERS_ID = 'ne-itsm-top-sr-users';
export const ITSM_TOP_INCIDENT_USERS_ID = 'ne-itsm-top-incident-users';

export type ItsmIssueDrillMetric = 'open' | 'closed' | 'sla_breached';

/** Overall-tickets drill key for a requester (not scoped to one issue type). */
export function itsmTopUserOverallKey(userKey: string): string {
  return `user::${userKey}`;
}

export default function ItsmTopIssueUsersCard({
  users,
  open = true,
  onSelectUser,
  onSelectUserMetric,
  onSelectIssue,
  onSelectIssueMetric,
  activeIssueKey = null,
  activeMetric = null,
  title = 'Top users facing issues',
  hint = 'Click user for all-tickets Open / Closed / SLA · click ×count for one issue type',
  sectionId = ITSM_TOP_ISSUE_USERS_ID,
}: {
  users: ItsmTopIssueUser[];
  /** When false, the detail list is hidden (opened from the KPI card). */
  open?: boolean;
  /** Drill into all tickets for this requester — Open / Closed / SLA Breached. */
  onSelectUser?: (user: ItsmTopIssueUser) => void;
  /** Filter Records to Open / Closed / SLA Breached across all tickets for this requester. */
  onSelectUserMetric?: (user: ItsmTopIssueUser, metric: ItsmIssueDrillMetric) => void;
  /** Drill into an issue type for a requester — shows Open / Closed / SLA Breached. */
  onSelectIssue?: (userName: string, issue: ItsmIssueFace) => void;
  /** Filter Records to Open / Closed / SLA Breached within the drilled issue type. */
  onSelectIssueMetric?: (userName: string, issue: ItsmIssueFace, metric: ItsmIssueDrillMetric) => void;
  activeIssueKey?: string | null;
  activeMetric?: ItsmIssueDrillMetric | null;
  title?: string;
  hint?: string;
  sectionId?: string;
}) {
  if (!open) return null;

  return (
    <section
      id={sectionId}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0">
          <h3 className={NE_TYPE.sectionTitle}>{title}</h3>
          <p className={`mt-0.5 ${NE_TYPE.meta}`}>{hint}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
          <Users className="h-3.5 w-3.5" />
          Top {users.length || 10}
        </span>
      </div>

      {!users.length ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          No requester issues in this filter
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {users.map((user, index) => {
            const overallKey = itsmTopUserOverallKey(user.key);
            const userActive = activeIssueKey === overallKey;
            return (
              <li key={user.key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectUser?.(user)}
                    className={`min-w-0 rounded-lg px-1.5 py-1 text-left transition ${
                      userActive ? 'bg-[#EEF4FF]' : 'hover:bg-slate-50'
                    }`}
                    title={onSelectUser
                      ? `Drill into all ${user.total} tickets for ${user.name}`
                      : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold tabular-nums text-slate-600">
                        {index + 1}
                      </span>
                      <span className={`truncate text-sm font-semibold ${
                        userActive ? 'text-[#2B5AED]' : 'text-slate-900'
                      }`}
                      >
                        {user.name}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectUser?.(user)}
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ${
                      userActive
                        ? 'bg-[#2B5AED] text-white ring-[#2B5AED]'
                        : 'bg-[#FFF4E5] text-[#A96A20] ring-[#F5D9A8]'
                    }`}
                    title={`All tickets for ${user.name}`}
                  >
                    {user.total} ticket{user.total === 1 ? '' : 's'}
                  </button>
                </div>

                {userActive ? (
                  <div className="mt-2 ml-8 rounded-xl border border-[#D6E2FF] bg-[#F7F9FF] px-3 py-2.5">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#2B5AED]">
                      {user.name} · all tickets · status breakdown
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectUserMetric?.(user, 'open');
                        }}
                        className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                          activeMetric === 'open'
                            ? 'bg-[#FFF4E5] ring-[#F5D9A8]'
                            : 'bg-white ring-slate-200 hover:bg-[#FFF4E5]'
                        }`}
                        title="Filter Records to all Open tickets for this user"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#A96A20]">Open</div>
                        <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{user.open}</div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectUserMetric?.(user, 'closed');
                        }}
                        className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                          activeMetric === 'closed'
                            ? 'bg-[#E8F7F0] ring-[#CDEBD9]'
                            : 'bg-white ring-slate-200 hover:bg-[#E8F7F0]'
                        }`}
                        title="Filter Records to all Closed tickets for this user"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#287B5D]">Closed</div>
                        <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{user.closed}</div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectUserMetric?.(user, 'sla_breached');
                        }}
                        className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                          activeMetric === 'sla_breached'
                            ? 'bg-[#FCECEF] ring-[#F0D4DB]'
                            : 'bg-white ring-slate-200 hover:bg-[#FCECEF]'
                        }`}
                        title="Filter Records to all SLA Breached tickets for this user"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#B24E66]">SLA Breached</div>
                        <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{user.slaBreached}</div>
                      </button>
                    </div>
                  </div>
                ) : null}

                <ul className="mt-2 space-y-1.5 pl-8">
                  {user.issues.slice(0, 5).map((issue) => {
                    const active = activeIssueKey === `${user.key}::${issue.key}`;
                    return (
                      <li key={issue.key} className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectIssue?.(user.name, issue)}
                          className={`flex w-full items-start justify-between gap-3 rounded-lg px-1.5 py-1 text-left text-xs transition ${
                            active ? 'bg-[#EEF4FF]' : 'hover:bg-slate-50'
                          }`}
                          title={onSelectIssue
                            ? `Drill into ${issue.count} tickets — Open / Closed / SLA Breached`
                            : undefined}
                        >
                          <span className="min-w-0 text-slate-600">
                            <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-500" />
                            <span className="font-medium text-slate-700">{issue.label}</span>
                          </span>
                          <span className={`shrink-0 font-semibold tabular-nums ${
                            active ? 'text-[#2B5AED]' : 'text-slate-900'
                          }`}
                          >
                            ×{issue.count}
                          </span>
                        </button>
                        {active ? (
                          <div className="ml-1 rounded-xl border border-[#D6E2FF] bg-[#F7F9FF] px-3 py-2.5">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#2B5AED]">
                              {issue.label} · status breakdown
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectIssueMetric?.(user.name, issue, 'open');
                                }}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'open'
                                    ? 'bg-[#FFF4E5] ring-[#F5D9A8]'
                                    : 'bg-white ring-slate-200 hover:bg-[#FFF4E5]'
                                }`}
                                title="Filter Records to Open for this issue type"
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#A96A20]">Open</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{issue.open}</div>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectIssueMetric?.(user.name, issue, 'closed');
                                }}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'closed'
                                    ? 'bg-[#E8F7F0] ring-[#CDEBD9]'
                                    : 'bg-white ring-slate-200 hover:bg-[#E8F7F0]'
                                }`}
                                title="Filter Records to Closed for this issue type"
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#287B5D]">Closed</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{issue.closed}</div>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectIssueMetric?.(user.name, issue, 'sla_breached');
                                }}
                                className={`rounded-lg px-2 py-2 text-center ring-1 transition ${
                                  activeMetric === 'sla_breached'
                                    ? 'bg-[#FCECEF] ring-[#F0D4DB]'
                                    : 'bg-white ring-slate-200 hover:bg-[#FCECEF]'
                                }`}
                                title="Filter Records to SLA Breached for this issue type"
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#B24E66]">SLA Breached</div>
                                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{issue.slaBreached}</div>
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {user.issues.length > 5 ? (
                    <li className="text-[11px] text-slate-400">
                      +{user.issues.length - 5} more issue type{user.issues.length - 5 === 1 ? '' : 's'}
                    </li>
                  ) : null}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
