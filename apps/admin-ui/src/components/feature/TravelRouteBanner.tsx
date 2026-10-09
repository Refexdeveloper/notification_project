import { ArrowLeftRight, ArrowRight } from 'lucide-react';

export type TravelRouteSummary = {
  from: string;
  to: string;
  tripType: string;
  roundTrip: boolean;
};

export default function TravelRouteBanner({ from, to, tripType, roundTrip }: TravelRouteSummary) {
  const Icon = roundTrip ? ArrowLeftRight : ArrowRight;
  return (
    <div className="w-full border-b border-slate-200/90 bg-white px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex w-full items-center gap-3 sm:gap-5">
        <p className="min-w-0 flex-1 text-right text-base font-semibold leading-snug text-slate-800 sm:text-lg">
          {from}
        </p>
        <div className="flex min-w-[8.5rem] shrink-0 flex-col items-center gap-1.5 sm:min-w-[11rem]">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#2B5AED] sm:text-xs">
            {tripType}
          </span>
          <span className="flex w-full items-center text-[#2B5AED]">
            <span className="h-px flex-1 bg-[#2B5AED]/40" />
            <Icon className="mx-1.5 h-5 w-5" strokeWidth={2.25} />
            <span className="h-px flex-1 bg-[#2B5AED]/40" />
          </span>
        </div>
        <p className="min-w-0 flex-1 text-left text-base font-semibold leading-snug text-slate-800 sm:text-lg">
          {to}
        </p>
      </div>
    </div>
  );
}
