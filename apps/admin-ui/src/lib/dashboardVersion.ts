/** Bump this on each dashboard KPI / MIS / filter change so we can revert by version. */
export const DASHBOARD_VERSION = '2026.09.02-d9';

export const DASHBOARD_VERSION_NOTES = [
  'ITSM always reloads from the server — browser session cache no longer keeps yesterday’s tickets after a fix.',
  'ITSM live cache is 10 minutes and mapping-versioned, so Assigned to / Company fixes apply without showing pre-fix rows.',
  'ITSM Company dropdown is the full 29-company catalog (counts overlay). User list is not rebuilt from the already-filtered tickets.',
  'Today (Period) counts tickets created or closed today. ITSM Assigned to is workflow assignee only.',
  'ITSM Entity=All Users/MIS is APP_ROLE plus assignees from both Refex and Extrovis — not the 8-person Extrovis activity list.',
  'ITSM Company = requester user_details_lookup (Company_Name), not Entity or assignee roster. Blank → Refex Industries Limited. Exact catalog match.',
  'Entity filter (esp. ITSM Extrovis): process entity_key wins over legal company text so Extrovis tickets are not misclassified as Refex.',
  'When Entity/Company/User filters are active, MIS shows ticket assignees in scope (incl. non-roster) — not the full APP_ROLE roster with zeros.',
  'Entity dropdown options stay period-scoped (not entity-scoped) so Refex/Extrovis both remain selectable.',
  'Users card, user dropdown (unfiltered), and unscoped MIS rows are the Kissflow APP_ROLE roster.',
  'Open / Closed / Rejected / Opened today / Closed today KPI clicks filter MIS + records and scroll to that section.',
  'Draft rows stay excluded. Closed today uses closed/completed timestamps, not created date.',
] as const;
