import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveDashboardIdentity } from '@/lib/embedMode';
import { useAuth } from '@/hooks/AuthContext';
import { personalGreeting } from '@/lib/timeGreeting';
import { NE_TYPE } from '@/lib/neDashType';

type Props = {
  actions?: ReactNode;
  filters: ReactNode;
};

export default function EmbedDashboardHero({ actions, filters }: Props) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const identity = resolveDashboardIdentity(searchParams, user);
  const greeting = personalGreeting();
  const title = identity.name
    ? `${greeting}, ${identity.name}`
    : greeting;

  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className={NE_TYPE.pageTitle}>{title}</h1>
          {identity.title ? (
            <p className={`mt-0.5 ${NE_TYPE.pageSubtitle}`}>{identity.title}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex w-full min-w-0 justify-end">{filters}</div>
    </div>
  );
}
