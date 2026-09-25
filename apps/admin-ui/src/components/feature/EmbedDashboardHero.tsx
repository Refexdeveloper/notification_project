import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveDashboardIdentity } from '@/lib/embedMode';
import { useAuth } from '@/hooks/AuthContext';
import { personalGreeting } from '@/lib/timeGreeting';

type Props = {
  actions?: ReactNode;
  filters: ReactNode;
};

export default function EmbedDashboardHero({ actions, filters }: Props) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const identity = resolveDashboardIdentity(searchParams, user);

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 shrink">
        {identity.name ? (
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.65rem]">
            {identity.name}
          </h2>
        ) : null}
        <p className={`${identity.name ? 'mt-1' : ''} text-sm font-medium text-[#3977BE]`}>{personalGreeting()}</p>
        {identity.title ? <p className="mt-0.5 text-sm text-slate-500">{identity.title}</p> : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="w-full min-w-0 lg:flex-1">{filters}</div>
    </div>
  );
}
