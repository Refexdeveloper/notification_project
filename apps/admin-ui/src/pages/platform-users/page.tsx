import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil, Plus, Shield, Users } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { EmptyState } from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { springSnappy } from '@/lib/motion';
import { isBackendApiMode } from '@/services/backendApi';
import {
  createPlatformUser,
  deactivatePlatformUser,
  loadPlatformUsers,
  PLATFORM_ROLES,
  updatePlatformUser,
  type PlatformUser,
} from '@/services/platformUsersApi';

export default function PlatformUsersPage() {
  const backendMode = isBackendApiMode();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(backendMode);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    display_name: '',
    email: '',
    role: 'OPERATOR' as (typeof PLATFORM_ROLES)[number],
  });
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '',
    role: 'OPERATOR' as (typeof PLATFORM_ROLES)[number],
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
    if (result.error) setError(result.error);
    setLoading(false);
  }, [backendMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await createPlatformUser({
      display_name: form.display_name.trim(),
      email: form.email.trim(),
      role: form.role,
    });
    if (!res.ok) {
      setError(res.error || 'Could not create user');
      return;
    }
    setMessage(`${form.display_name} was added`);
    setForm({ display_name: '', email: '', role: 'OPERATOR' });
    await load();
  };

  const openEdit = (user: PlatformUser) => {
    setEditing(user);
    setEditForm({
      display_name: user.display_name,
      role: (user.roles[0] as (typeof PLATFORM_ROLES)[number]) || 'OPERATOR',
      is_active: user.is_active,
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    setMessage('');
    const res = await updatePlatformUser(editing.id, {
      display_name: editForm.display_name.trim(),
      role: editForm.role,
      is_active: editForm.is_active,
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
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Admin users' }]}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-primary-600" />
              <h1 className="text-2xl font-heading font-semibold text-foreground-950">Admin users</h1>
            </div>
            <p className="text-sm text-foreground-500">
              Portal access for this application — separate from Kissflow workspace users on the Users page.
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <GlassCard className="lg:col-span-2 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-foreground-900">Add admin user</h2>
            </div>
            <form onSubmit={createUser} className="space-y-3">
              <Input
                label="Display name"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                required
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
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
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm" className="w-full">
                Create user
              </Button>
            </form>
          </GlassCard>

          <GlassCard className="lg:col-span-3 p-5">
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
                {users.map((user) => (
                  <motion.div
                    key={user.id}
                    layout
                    transition={springSnappy}
                    className="flex items-center justify-between gap-3 rounded-xl border border-background-200/80 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground-900 truncate">{user.display_name}</p>
                      <p className="text-xs text-foreground-500 truncate">{user.email}</p>
                      <p className="text-[11px] text-foreground-400 mt-0.5">
                        {(user.roles || []).join(', ') || '—'} · {user.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-background-100 text-foreground-500"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {user.is_active && (
                        <button
                          type="button"
                          onClick={() => void deactivate(user)}
                          className="h-8 px-2 rounded-lg text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)}>
        <form onSubmit={saveEdit} className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-foreground-900">Edit admin user</h3>
          <Input
            label="Display name"
            value={editForm.display_name}
            onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
            required
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
                  {role}
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
