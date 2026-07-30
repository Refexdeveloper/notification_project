import { Bell, Cloud, Network, Sparkles } from 'lucide-react';
import { Button } from './Button';

type EmptyVariant = 'apps' | 'templates' | 'schedules' | 'activity' | 'generic';

interface EmptyStateProps {
  variant?: EmptyVariant;
  title: string;
  description: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function EmptyState({
  variant = 'generic',
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: EmptyStateProps) {
  const Icon =
    variant === 'templates'
      ? Sparkles
      : variant === 'schedules'
        ? Cloud
        : variant === 'activity'
          ? Bell
          : Network;

  return (
    <div className="surface px-6 py-14 sm:py-16 text-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,108,189,0.06),transparent_65%)]" />
      <div className="relative">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E8F3FC] text-[#0F6CBD]">
          <Icon className="h-7 w-7" />
        </div>
        <h3 className="text-xl font-heading font-semibold text-foreground-950">{title}</h3>
        <p className="text-sm text-foreground-500 mt-2 max-w-md mx-auto leading-relaxed">{description}</p>
        {(primaryLabel || secondaryLabel) && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {primaryLabel && onPrimary && (
              <Button onClick={onPrimary} leftIcon={<Network className="w-4 h-4" />}>
                {primaryLabel}
              </Button>
            )}
            {secondaryLabel && onSecondary && (
              <Button variant="secondary" onClick={onSecondary}>
                {secondaryLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
