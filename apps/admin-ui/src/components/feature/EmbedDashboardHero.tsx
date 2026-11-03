import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveDashboardIdentity } from '@/lib/embedMode';
import { useAuth } from '@/hooks/AuthContext';
import { personalGreeting } from '@/lib/timeGreeting';
import { NE_TYPE } from '@/lib/neDashType';

type Props = {
  actions?: ReactNode;
  filters: ReactNode;
  /** Large dashboard name under the greeting (P2P insights). Does not replace user_name. */
  headline?: string;
  /** One-line overview under the title. */
  description?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
};

export default function EmbedDashboardHero({
  actions,
  filters,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search records...',
}: Props) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const identity = resolveDashboardIdentity(searchParams, user);
  const greeting = personalGreeting();
  const greetLine = identity.name
    ? `${greeting}, ${identity.name}`
    : greeting;

  return (
    <div className="ne-hero flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="ne-hero-copy min-w-0">
          <h1 className={`ne-hero-title ${NE_TYPE.pageTitle}`}>
            {greetLine}
            {identity.name ? <span className="ne-hi-wave" role="img" aria-label="Hi">👋</span> : null}
          </h1>
          {identity.title ? (
            <p className={`mt-0.5 ${NE_TYPE.pageSubtitle}`}>{identity.title}</p>
          ) : null}
        </div>
        {actions ? <div className="ne-hero-actions flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      {onSearchChange ? (
        <label className="relative block w-full min-w-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#0F6B7A] focus:ring-2 focus:ring-[#0F6B7A]/20"
          />
        </label>
      ) : null}
      <div className="ne-hero-filters w-full min-w-0">{filters}</div>
    </div>
  );
}
