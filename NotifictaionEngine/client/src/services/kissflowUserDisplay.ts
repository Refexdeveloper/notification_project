/** Human-readable labels for common Kissflow user JSON keys. */
const FIELD_LABELS: Record<string, string> = {
  _id: 'User ID',
  Name: 'Display name',
  FirstName: 'First name',
  LastName: 'Last name',
  Email: 'Email',
  MailId: 'Mail ID',
  UserName: 'Username',
  Status: 'Account status',
  UserType: 'User type',
  _user_type: 'User type (system)',
  Department: 'Department',
  Dept: 'Department',
  Designation: 'Designation',
  Company: 'Company',
  Role: 'Role',
  Roles: 'Roles',
  Groups: 'Groups',
  Manager: 'Manager',
  Phone: 'Phone',
  Mobile: 'Mobile',
  EmployeeId: 'Employee ID',
  EmployeeID: 'Employee ID',
  LastLoggedInAt: 'Last signed in (API)',
  LastLogin: 'Last login',
  LastSignedIn: 'Last signed in',
  LastActive: 'Last active',
  CreatedAt: 'Created at',
  ModifiedAt: 'Modified at',
  TimeZone: 'Time zone',
  Country: 'Country',
  ProfilePicture: 'Profile picture',
  Avatar: 'Avatar',
  invited_user: 'Invited user',
  IsActive: 'Is active',
  Kind: 'Kind',
};

/** Keys already summarized in the engagement table header row. */
const TABLE_SUMMARY_KEYS = new Set([
  'Name',
  'DisplayName',
  'FullName',
  'Email',
  'MailId',
  'UserName',
  'UserType',
  '_user_type',
  'Role',
  'Department',
  'Dept',
  'Designation',
  'LastLoggedInAt',
  'LastLogin',
  'LastSignedIn',
]);

function humanizeKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/^_+/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatKissflowValue(value: unknown, depth = 0): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (!value.length) return '—';
    if (depth > 2) return JSON.stringify(value);
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          return pickDisplayName(o) || formatKissflowValue(item, depth + 1);
        }
        return formatKissflowValue(item, depth + 1);
      })
      .filter((s) => s && s !== '—')
      .join(', ');
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.v === 'string' && o.v.trim()) {
      const tz = typeof o.tz === 'string' ? ` (${o.tz})` : '';
      return `${o.v}${tz}`;
    }
    if (typeof o.dv === 'string' && o.dv.trim()) return o.dv;
    const named = pickDisplayName(o);
    if (named) return named;
    if (depth >= 2) return JSON.stringify(o);
    const parts = Object.entries(o)
      .filter(([k]) => k !== 'Kind' && k !== 'Type')
      .slice(0, 6)
      .map(([k, v]) => `${humanizeKey(k)}: ${formatKissflowValue(v, depth + 1)}`);
    return parts.length ? parts.join(' · ') : JSON.stringify(o);
  }

  return String(value);
}

function pickDisplayName(o: Record<string, unknown>): string | null {
  for (const k of ['Name', 'DisplayName', 'FullName', 'Email', 'Title']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (typeof o._id === 'string' && o._id.trim()) return o._id.trim();
  return null;
}

export interface KissflowDetailEntry {
  key: string;
  label: string;
  value: string;
  inTable: boolean;
}

/** All fields from Kissflow user JSON for the detail drawer. */
export function kissflowUserDetailEntries(
  raw?: Record<string, unknown>,
): KissflowDetailEntry[] {
  if (!raw || typeof raw !== 'object') return [];

  return Object.keys(raw)
    .sort((a, b) => {
      const pri = (k: string) => {
        if (k === '_id') return 0;
        if (TABLE_SUMMARY_KEYS.has(k)) return 1;
        return 2;
      };
      const d = pri(a) - pri(b);
      if (d !== 0) return d;
      return humanizeKey(a).localeCompare(humanizeKey(b));
    })
    .map((key) => ({
      key,
      label: humanizeKey(key),
      value: formatKissflowValue(raw[key]),
      inTable: TABLE_SUMMARY_KEYS.has(key),
    }))
    .filter((e) => e.value !== '—' || e.key === '_id' || e.key === 'Status');
}

/** Fields present in API but not shown as table columns. */
export function kissflowExtraDetailEntries(raw?: Record<string, unknown>): KissflowDetailEntry[] {
  return kissflowUserDetailEntries(raw).filter((e) => !e.inTable);
}
