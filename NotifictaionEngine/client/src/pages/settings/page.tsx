import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Users,
} from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { apiFetch, type ApiRole, type ApiUser } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { EmptyState } from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { springSnappy } from '@/lib/motion';

type Tab = 'users' | 'smtp';

type SmtpForm = {
  host: string;
  port: string;
  secure: boolean;
  auth_user: string;
  auth_pass: string;
  from_email: string;
  from_name: string;
};

const emptySmtp: SmtpForm = {
  host: '',
  port: '465',
  secure: true,
  auth_user: '',
  auth_pass: '',
  from_email: '',
  from_name: 'Notification Engine',
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [smtpForm, setSmtpForm] = useState<SmtpForm>(emptySmtp);
  const [smtpHasSecret, setSmtpHasSecret] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role_id: '',
    is_active: true,
  });
  const [editing, setEditing] = useState<ApiUser | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    password: '',
    role_id: '',
    is_active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [usersRes, rolesRes, smtpRes] = await Promise.all([
      apiFetch<ApiUser[]>('/api/users'),
      apiFetch<ApiRole[]>('/api/roles'),
      apiFetch<Record<string, unknown>>('/api/smtp-config'),
    ]);
    if (!usersRes.ok) setError(usersRes.error || 'Could not load users. Is the server running?');
    else setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
    if (rolesRes.ok && Array.isArray(rolesRes.data)) {
      setRoles(rolesRes.data);
      setForm((f) => (f.role_id ? f : { ...f, role_id: String(rolesRes.data[0]?.id || '') }));
    }
    if (smtpRes.ok && smtpRes.data) {
      const s = smtpRes.data;
      setSmtpHasSecret(Boolean(s.auth_pass));
      setSmtpForm({
        host: String(s.host || ''),
        port: String(s.port ?? '465'),
        secure: Boolean(s.secure) || Number(s.port) === 465,
        auth_user: String(s.auth_user || ''),
        auth_pass: '',
        from_email: String(s.from_email || ''),
        from_name: String(s.from_name || 'Notification Engine'),
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await apiFetch<ApiUser>('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        password: form.password,
        role_id: Number(form.role_id),
        is_active: form.is_active,
      }),
    });
    if (!res.ok) {
      setError(res.error || 'Could not create user');
      return;
    }
    setMessage(`${res.data.name} was added successfully`);
    setForm((f) => ({ ...f, name: '', email: '', password: '' }));
    await load();
  };

  const openEdit = (user: ApiUser) => {
    setEditing(user);
    setEditForm({
      name: user.name,
      email: user.email,
      password: '',
      role_id: String(user.role_id || user.role?.id || ''),
      is_active: user.is_active,
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    setMessage('');
    const body: Record<string, unknown> = {
      name: editForm.name,
      email: editForm.email,
      role_id: Number(editForm.role_id),
      is_active: editForm.is_active,
    };
    if (editForm.password.trim()) body.password = editForm.password;
    const res = await apiFetch(`/api/users/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error || 'Update failed');
      return;
    }
    setMessage(`${editForm.name} was updated`);
    setEditing(null);
    await load();
  };

  const toggleActive = async (user: ApiUser) => {
    setError('');
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (!res.ok) {
      setError(res.error || 'Update failed');
      return;
    }
    setMessage(user.is_active ? `${user.name} is now inactive` : `${user.name} is active again`);
    await load();
  };

  const removeUser = async (user: ApiUser) => {
    if (!confirm(`Remove ${user.name} (${user.email})? They will no longer be able to sign in.`)) return;
    setError('');
    const res = await apiFetch(`/api/users/${user.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(res.error || 'Delete failed');
      return;
    }
    setMessage(`${user.name} was removed`);
    await load();
  };

  const saveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    const res = await apiFetch('/api/smtp-config', {
      method: 'POST',
      body: JSON.stringify({
        host: smtpForm.host,
        port: Number(smtpForm.port),
        secure: smtpForm.secure,
        auth_user: smtpForm.auth_user,
        auth_pass: smtpForm.auth_pass || undefined,
        from_email: smtpForm.from_email,
        from_name: smtpForm.from_name,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error || 'Could not save SMTP');
      return;
    }
    setMessage('Email server settings saved');
    setSmtpForm((f) => ({ ...f, auth_pass: '' }));
    setSmtpHasSecret(true);
    await load();
  };

  const testSmtp = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    const res = await apiFetch<{ success?: boolean; message?: string; error?: string }>(
      '/api/smtp-config/test',
      {
        method: 'POST',
        body: JSON.stringify({ to: testTo || undefined }),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const detail =
        (res.data && typeof res.data === 'object' && (res.data.message || res.data.error)) ||
        res.error ||
        'SMTP test failed';
      setError(String(detail));
      return;
    }
    setMessage(res.data?.message || `Test email sent${testTo ? ` to ${testTo}` : ''}`);
  };

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Settings' }]}>
      <div className="mb-7">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage people, access, and how email gets delivered.</p>
      </div>

      <div className="mb-6 flex items-center gap-1.5 glass rounded-[16px] p-1.5 w-fit">
        {(
          [
            ['users', 'People', Users],
            ['smtp', 'Email sending', Mail],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`relative h-10 px-4 rounded-[12px] text-sm font-semibold cursor-pointer inline-flex items-center gap-2 transition-colors ${
              tab === id ? 'text-white' : 'text-foreground-600 hover:bg-background-100'
            }`}
          >
            {tab === id && (
              <motion.span
                layoutId="settings-tab"
                className="absolute inset-0 rounded-[12px] bg-primary-600 shadow-[var(--shadow-glow)]"
                transition={springSnappy}
              />
            )}
            <Icon className="w-4 h-4 relative z-10" />
            <span className="relative z-10">{label}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[14px] bg-red-50 border border-red-200 text-sm text-red-800 font-medium">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 px-4 py-3 rounded-[14px] bg-accent-50 border border-accent-200 text-sm text-accent-900 font-medium">
          {message}
        </div>
      )}

      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
          <GlassCard className="p-5 h-fit">
            <div className="flex items-center gap-3 mb-4">
              <span className="icon-well">
                <Plus className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-base font-heading font-semibold text-foreground-950">Add a person</h3>
                <p className="text-xs text-foreground-500">They sign in with email & password</p>
              </div>
            </div>
            <form onSubmit={createUser} className="space-y-3.5">
              <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
              <Input label="Work email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
              <Input label="Temporary password" required type="password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" />
              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Access level</label>
                <select
                  required
                  value={form.role_id}
                  onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                  className="field-input"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2.5 text-sm text-foreground-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-background-400"
                />
                Allow them to sign in right away
              </label>
              <Button type="submit" className="w-full" leftIcon={<Plus className="w-4 h-4" />}>
                Add person
              </Button>
            </form>
          </GlassCard>

          <GlassCard className="overflow-hidden p-0">
            <div className="px-5 py-4 border-b border-background-200/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="icon-well">
                  <Users className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-950">Team</h3>
                  <p className="text-xs text-foreground-500">
                    {users.length} {users.length === 1 ? 'person' : 'people'}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
                Refresh
              </Button>
            </div>
            {loading ? (
              <div className="px-5 py-14 text-center text-sm text-foreground-500">Loading people…</div>
            ) : users.length === 0 ? (
              <div className="p-4">
                <EmptyState variant="generic" title="No people yet" description="Add someone on the left to grant access." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-background-100 bg-background-50/80">
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Person</th>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Role</th>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Status</th>
                      <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-background-100/80 last:border-0 hover:bg-background-50/60"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className="w-9 h-9 rounded-[12px] bg-primary-100 text-primary-800 text-xs font-bold flex items-center justify-center">
                              {u.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground-900">{u.name}</p>
                              <p className="text-xs text-foreground-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="chip-muted inline-flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            {u.role?.name || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={u.is_active ? 'chip-success' : 'chip-muted'}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(u)} leftIcon={<Pencil className="w-3.5 h-3.5" />}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void toggleActive(u)}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => void removeUser(u)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {tab === 'smtp' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl">
          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <span className="icon-well">
                <Mail className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-base font-heading font-semibold text-foreground-950">SMTP server</h3>
                <p className="text-xs text-foreground-500">Used for scheduled reports and test emails</p>
              </div>
            </div>
            <form onSubmit={saveSmtp} className="space-y-3.5">
              <Input
                label="Host"
                required
                value={smtpForm.host}
                onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
                placeholder="smtp.zoho.in"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Port"
                  required
                  value={smtpForm.port}
                  onChange={(e) =>
                    setSmtpForm({
                      ...smtpForm,
                      port: e.target.value,
                      secure: Number(e.target.value) === 465,
                    })
                  }
                  placeholder="465"
                />
                <label className="flex items-end gap-2.5 text-sm text-foreground-700 cursor-pointer pb-2.5">
                  <input
                    type="checkbox"
                    checked={smtpForm.secure}
                    onChange={(e) => setSmtpForm({ ...smtpForm, secure: e.target.checked })}
                    className="rounded border-background-400"
                  />
                  Use TLS / SSL
                </label>
              </div>
              <Input
                label="Login user"
                required
                value={smtpForm.auth_user}
                onChange={(e) => setSmtpForm({ ...smtpForm, auth_user: e.target.value })}
                placeholder="noreply@company.com"
              />
              <Input
                label="Password"
                type="password"
                value={smtpForm.auth_pass}
                onChange={(e) => setSmtpForm({ ...smtpForm, auth_pass: e.target.value })}
                placeholder={smtpHasSecret ? '••••••••  (leave blank to keep)' : 'SMTP password'}
                required={!smtpHasSecret}
              />
              <Input
                label="From email"
                required
                type="email"
                value={smtpForm.from_email}
                onChange={(e) => setSmtpForm({ ...smtpForm, from_email: e.target.value })}
                placeholder="Must match SMTP login (or an allowed Zoho alias)"
              />
              <p className="text-[11px] text-foreground-400 -mt-2">
                Providers like Zoho reject sends when From differs from the login mailbox.
              </p>              <Input
                label="From name"
                value={smtpForm.from_name}
                onChange={(e) => setSmtpForm({ ...smtpForm, from_name: e.target.value })}
                placeholder="Notification Engine"
              />
              <Button type="submit" className="w-full" loading={saving}>
                Save email settings
              </Button>
            </form>
          </GlassCard>

          <GlassCard className="p-6 h-fit space-y-4">
            <div>
              <h3 className="text-base font-heading font-semibold text-foreground-950">Send a test</h3>
              <p className="text-xs text-foreground-500 mt-1">
                Verifies the active SMTP config can deliver mail.
              </p>
            </div>
            <Input
              label="Recipient (optional)"
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="Defaults to your login email"
            />
            <Button
              variant="secondary"
              className="w-full"
              loading={saving}
              onClick={() => void testSmtp()}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Send test email
            </Button>
          </GlassCard>
        </div>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} className="max-w-md">
        <form onSubmit={saveEdit}>
          <div className="px-5 py-4 border-b border-background-200/70">
            <h2 className="text-lg font-heading font-semibold text-foreground-950">Edit person</h2>
            <p className="text-xs text-foreground-500 mt-0.5">{editing?.email}</p>
          </div>
          <div className="px-5 py-4 space-y-3.5">
            <Input
              label="Full name"
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
            <Input
              label="Work email"
              required
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            />
            <Input
              label="New password"
              type="password"
              minLength={6}
              value={editForm.password}
              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              placeholder="Leave blank to keep current"
            />
            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Access level</label>
              <select
                required
                value={editForm.role_id}
                onChange={(e) => setEditForm({ ...editForm, role_id: e.target.value })}
                className="field-input"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2.5 text-sm text-foreground-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                className="rounded border-background-400"
              />
              Active (can sign in)
            </label>
          </div>
          <div className="px-5 py-4 border-t border-background-200/70 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
