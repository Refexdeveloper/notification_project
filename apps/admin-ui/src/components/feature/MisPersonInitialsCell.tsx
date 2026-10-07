import { getPersonAvatarTone, getPersonInitials, splitPersonNames } from '@/lib/personName';

/**
 * Compact person cell — same as aasik_ITSM newceo (MA for Mohamed Aasik).
 * Hover shows the full name. Filters still use the full name.
 */
export default function MisPersonInitialsCell({ name }: { name?: string | null }) {
  const names = splitPersonNames(name);
  if (!names.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 leading-none">
      {names.map((person) => {
        const initials = getPersonInitials(person) || person.slice(0, 2).toUpperCase();
        const tone = getPersonAvatarTone(person);
        return (
          <span key={person} className="group/misrel relative inline-flex leading-none">
            <span
              className={`inline-flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-full text-[10px] font-bold leading-none ${tone.bg} ${tone.text}`}
            >
              {initials}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-40 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-black shadow-lg group-hover/misrel:block"
            >
              {person}
            </span>
          </span>
        );
      })}
    </span>
  );
}
