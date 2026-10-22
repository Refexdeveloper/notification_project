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
};

export default function EmbedDashboardHero({ actions, filters }: Props) {
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
          </h1>
          {identity.title ? (
            <p className={`mt-0.5 ${NE_TYPE.pageSubtitle}`}>{identity.title}</p>
          ) : null}
        </div>
        {actions ? <div className="ne-hero-actions flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
      <div className="ne-hero-filters w-full min-w-0">{filters}</div>
    </div>
  );
}
