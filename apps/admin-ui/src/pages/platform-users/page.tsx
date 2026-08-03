import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Shield, Users } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { EmptyState } from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/hooks/AuthContext';
import { isBackendApiMode } from '@/services/backendApi';
import {
  createPlatformUser,
  deactivatePlatformUser,
  loadPlatformUsers,
  PLATFORM_ROLES,
  updatePlatformUser,
  type PlatformUser,
} from '@/services/platformUsersApi';

const EMPTY_CREATE = {
  display_name: '',
  email: '',
  password: '',
  role: 'VIEWER' as (typeof PLATFORM_ROLES)[number],
};

export default function PlatformUsersPage() {
  const backendMode = isBackendApiMode();
  const { isAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(backendMode);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(EMPTY_CREATE);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '',
    password: '',
    role: 'VIEWER' as (typeof PLATFORM_ROLES)[number],
    is_active: true,
  });

  const load = useCallback(async () => {
    if (!backendMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const result = await loadPlatformUsers();
    setUsers(result.users);
    setCanManage(result.canManage || isAdmin);
    if (result.error) setError(result.error);
    setLoading(false);
  }, [backendMode, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  // Chrome autofills login credentials into this create form — force-clear after mount.
  useEffect(() => {
    setForm(EMPTY_CREATE);
    const t = window.setTimeout(() => setForm(EMPTY_CREATE), 100);
    return () => window.clearTimeout(t);
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setError('');
    setMessage('');
    const email = form.email.trim().toLowerCase();
    if (users.some((u) => u.email.toLowerCase() === email)) {
      setError('This email already exists. Click Edit on that user to change password or role.');
      return;
    }
    if (form.password.trim().length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const res = await createPlatformUser({
      display_name: form.display_name.trim(),
      email,
      role: form.role,
      password: form.password,
    });
    if (!res.ok) {
      setError(res.error || 'Could not create user');
      return;
    }
    setMessage(`${form.display_name} was added`);
    setForm(EMPTY_CREATE);
    await load();
  };

  const openEdit = (user: PlatformUser) => {
    if (!canManage) return;
    setEditing(user);
    setEditForm({
      display_name: user.display_name,
      password: '',
      role: (user.roles[0] as (typeof PLATFORM_ROLES)[number]) || 'VIEWER',
      is_active: user.is_active,
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !canManage) return;
    setError('');
    setMessage('');
    if (editForm.password && editForm.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const res = await updatePlatformUser(editing.id, {
      display_name: editForm.display_name.trim(),
      role: editForm.role,
      is_active: editForm.is_active,
      ...(editForm.password ? { password: editForm.password } : {}),
    });
    if (!res.ok) {
      setError(res.error || 'Could not update user');
      return;
    }
    setMessage(`${editForm.display_name} was updated`);
    setEditing(null);
    await load();
  };

  const deactivate = async (user: PlatformUser) => {
    if (!canManage) return;
    if (currentUser?.email && user.email.toLowerCase() === currentUser.email.toLowerCase()) {
      setError('You cannot deactivate your own account while signed in.');
      return;
    }
    if (!window.confirm(`Deactivate ${user.display_name}?`)) return;
    const res = await deactivatePlatformUser(user.id);
    if (!res.ok) {
      setError(res.error || 'Could not deactivate user');
      return;
    }
    setMessage(`${user.display_name} was deactivated`);
    await load();
  };

  if (!backendMode) {
    return (
      <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Admin users' }]}>
        <EmptyState
          variant="users"
          title="Admin users require backend mode"
          description="Set VITE_USE_BACKEND_API=true to manage portal users in PostgreSQL."
        />
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/dashboard' }, { label: 'Admin users' }]}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-primary-600" />
              <h1 className="text-2xl font-heading font-semibold text-foreground-950">Admin users</h1>
            </div>
            <p className="text-sm text-foreground-500">
              Portal login accounts (Admin / Viewer). To change an existing password, click Edit — do not
              create the same email again.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </div>
        )}

        {!canManage && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Viewer access — you can see users but cannot create, edit, or deactivate accounts.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {canManage && (
            <GlassCard className="lg:col-span-2 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Plus className="w-4 h-4 text-primary-600" />
                <h2 className="text-sm font-semibold text-foreground-900">Add new user</h2>
              </div>
              <p className="text-[11px] text-foreground-500 mb-4">
                For a new email only. Your account is already listed on the right.
              </p>
              <form
                onSubmit={createUser}
                className="space-y-3"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              >
                {/* honeypot-ish names so password managers skip this form */}
                <Input
                  label="Display name"
                  name="ne_new_display_name"
                  autoComplete="off"
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  name="ne_new_user_email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="new.user@refex.co.in"
                />
                <Input
                  label="Password"
                  type="password"
                  name="ne_new_user_password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  hint="Minimum 8 characters"
                />
                <label className="block text-xs font-medium text-foreground-700">
                  Role
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, role: e.target.value as (typeof PLATFORM_ROLES)[number] }))
                    }
                    className="mt-1.5 w-full h-9 px-3 rounded-lg border border-background-300/70 bg-white text-sm"
                  >
                    {PLATFORM_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role === 'ADMIN' ? 'Admin' : 'Viewer'}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm" className="w-full">
                  Create user
                </Button>
              </form>
            </GlassCard>
          )}

          <GlassCard className={`${canManage ? 'lg:col-span-3' : 'lg:col-span-5'} p-5`}>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-foreground-900">Active directory</h2>
              <span className="text-xs text-foreground-400">({users.length})</span>
            </div>

            {loading ? (
              <p className="text-sm text-foreground-500 py-8 text-center">Loading users…</p>
            ) : users.length === 0 ? (
              <EmptyState variant="users" title="No admin users yet" description="Create the first portal user." />
            ) : (
              <div className="space-y-2">
                {users.map((user) => {
                  const isYou =
                    Boolean(currentUser?.email) &&
                    user.email.toLowerCase() === currentUser!.email.toLowerCase();
                  return (
                    <div
                      key={user.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                        isYou ? 'border-primary-200 bg-primary-50/40' : 'border-background-200/80'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground-900 truncate">
                          {user.display_name}
                          {isYou ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
                              You
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-foreground-500 truncate">{user.email}</p>
                        <p className="text-[11px] text-foreground-400 mt-0.5">
                          {(user.roles || []).map((r) => (r === 'ADMIN' ? 'Admin' : 'Viewer')).join(', ') ||
                            '—'}{' '}
                          · {user.is_active ? 'Active' : 'Inactive'}
                          {user.has_password === false ? ' · No password' : ''}
                        </p>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-background-100 text-foreground-500"
                            title="Edit password or role"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {user.is_active && !isYou && (
                            <button
                              type="button"
                              onClick={() => void deactivate(user)}
                              className="h-8 px-2 rounded-lg text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)}>
        <form onSubmit={saveEdit} className="p-6 space-y-4" autoComplete="off">
          <h3 className="text-lg font-semibold text-foreground-900">Edit admin user</h3>
          <p className="text-xs text-foreground-500">{editing?.email}</p>
          <Input
            label="Display name"
            name="ne_edit_display_name"
            autoComplete="off"
            value={editForm.display_name}
            onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
            required
          />
          <Input
            label="New password (optional)"
            type="password"
            name="ne_edit_password"
            autoComplete="new-password"
            value={editForm.password}
            onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
            hint="Leave blank to keep the current password"
          />
          <label className="block text-xs font-medium text-foreground-700">
            Role
            <select
              value={editForm.role}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, role: e.target.value as (typeof PLATFORM_ROLES)[number] }))
              }
              className="mt-1.5 w-full h-9 px-3 rounded-lg border border-background-300/70 bg-white text-sm"
            >
              {PLATFORM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role === 'ADMIN' ? 'Admin' : 'Viewer'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground-700">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
