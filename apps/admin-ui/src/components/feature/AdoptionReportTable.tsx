import { useMemo } from 'react';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import { NE_TYPE } from '@/lib/neDashType';
import {
  adoptionCounts,
  adoptionRows,
  type AdoptionFocus,
  type AdoptionStatus,
  type AdoptionUser,
} from '@/lib/adoptionReport';

const FOCUS_TABS: Array<{ id: AdoptionFocus; label: string }> = [
  { id: 'all', label: 'All users' },
  { id: 'today', label: 'Signed in today' },
  { id: 'ever', label: 'Ever signed in' },
  { id: 'never', label: 'Never signed in' },
];

const STATUS_BADGE: Record<AdoptionStatus, { label: string; className: string }> = {
  today: { label: 'Signed in today', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  earlier: { label: 'Signed in earlier', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  never: { label: 'Never signed in', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

function StatusBadge({ status }: { status: AdoptionStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badge.className}`}>
      {badge.label}
    </span>
  );
}

/** App roster sign-in report. Users card count = this table's "All users". */
export default function AdoptionReportTable({
  users,
  focus,
  onFocusChange,
  formatWhen,
}: {
  users: AdoptionUser[];
  focus: AdoptionFocus;
  onFocusChange: (next: AdoptionFocus) => void;
  formatWhen: (value: string) => string;
}) {
  const counts = useMemo(() => adoptionCounts(users), [users]);
  const rows = useMemo(() => adoptionRows(users, focus), [focus, users]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 px-1" role="tablist" aria-label="Adoption filter">
        {FOCUS_TABS.map((tab) => {
          const active = focus === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFocusChange(tab.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                active
                  ? 'border-[#2B5AED] bg-[#2B5AED] text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              <span className={`tabular-nums ${active ? 'text-white/90' : 'text-slate-400'}`}>{counts[tab.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5 px-1 pb-3 lg:hidden">
        {rows.map(({ user, status }, index) => (
          <MisMobileRecordCard
            key={`${user.user_id || user.email || user.user_name}-${index}`}
            index={index}
            title={user.user_name || user.email || '—'}
            subtitle={user.email && user.email !== user.user_name ? user.email : undefined}
            badge={<StatusBadge status={status} />}
            fields={[{ label: 'Last sign-in', value: user.last_sign_in ? formatWhen(user.last_sign_in) : '—' }]}
          />
        ))}
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No users for this filter.</p>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto px-1 lg:block">
        <table className="ne-mis-table text-sm">
          <thead className={NE_TYPE.tableHead}>
            <tr>
              <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">User</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">Email</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">Last sign-in</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, status }, index) => (
              <tr key={`${user.user_id || user.email || user.user_name}-${index}`} className="border-t border-slate-200">
                <td className="whitespace-nowrap px-5 py-3.5 font-medium text-slate-900">{user.user_name || '—'}</td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{user.email || '—'}</td>
                <td className={`px-5 py-3.5 text-sm tabular-nums ${status === 'today' ? 'font-semibold text-[#287B5D]' : 'text-slate-600'}`}>
                  {user.last_sign_in ? formatWhen(user.last_sign_in) : '—'}
                </td>
                <td className="px-5 py-3.5"><StatusBadge status={status} /></td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">No users for this filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
