import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApplicationFromForm, type AddApplicationInput } from '@/mocks/applications';
import Modal from '@/components/ui/Modal';

interface AddApplicationFormProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type AccountForm = Omit<
  AddApplicationInput,
  'processIds' | 'dataformIds' | 'boardIds' | 'datasetIds'
>;

const emptyAccount: AccountForm = {
  accountId: '',
  appId: '',
  subdomain: '',
  name: '',
  description: '',
  region: 'com',
  environment: 'Development',
  accessKeyId: '',
  accessKeySecret: '',
};

export default function AddApplicationForm({ open, onClose, onCreated }: AddApplicationFormProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<AccountForm>(emptyAccount);
  const [processIds, setProcessIds] = useState<string[]>(['']);
  const [dataformIds, setDataformIds] = useState<string[]>(['']);
  const [boardIds, setBoardIds] = useState<string[]>(['']);
  const [datasetIds, setDatasetIds] = useState<string[]>(['']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError('');
  };

  const resetIds = () => {
    setProcessIds(['']);
    setDataformIds(['']);
    setBoardIds(['']);
    setDatasetIds(['']);
  };

  const handleClose = () => {
    setForm(emptyAccount);
    resetIds();
    setError('');
    setSaving(false);
    onClose();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.accountId.trim()) {
      setError('Account ID is required.');
      return;
    }
    if (!form.appId.trim()) {
      setError('App ID is required (Kissflow process ID for Admin APIs, e.g. Lead_tracker_1_A00).');
      return;
    }
    if (!form.subdomain.trim()) {
      setError('Subdomain is required.');
      return;
    }
    if (!form.accessKeyId.trim() || !form.accessKeySecret.trim()) {
      setError('Access Key ID and Secret are required.');
      return;
    }

    setSaving(true);
    const app = createApplicationFromForm({
      ...form,
      processIds: processIds.filter((id) => id.trim()).join(','),
      dataformIds: dataformIds.filter((id) => id.trim()).join(','),
      boardIds: boardIds.filter((id) => id.trim()).join(','),
      datasetIds: datasetIds.filter((id) => id.trim()).join(','),
    });
    setSaving(false);
    handleClose();
    onCreated?.();
    navigate(`/applications/${app.id}?tab=overview`);
  };

  return (
    <Modal open={open} onClose={handleClose}>
          <div className="px-6 py-5 border-b border-background-200/70 flex items-start justify-between shrink-0 bg-gradient-to-r from-primary-50/40 to-transparent">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="chip-primary">Step 1 of 1</span>
              </div>
              <h2 className="text-xl font-heading font-semibold text-foreground-950">Connect application</h2>
              <p className="text-sm text-foreground-500 mt-1 leading-relaxed max-w-md">
                Enter your Kissflow account details. We’ll sync fields and unlock templates & schedules.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-9 h-9 rounded-[12px] flex items-center justify-center hover:bg-background-100 cursor-pointer text-foreground-500 transition-colors duration-150 active:scale-95"
              aria-label="Close"
            >
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Kissflow account">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Account ID" required>
                  <input
                    value={form.accountId}
                    onChange={(e) => update('accountId', e.target.value)}
                    placeholder="e.g. AcCMptp3yqcn"
                    className="field font-mono text-xs"
                  />
                </Field>
                <Field label="App ID" required>
                  <input
                    value={form.appId}
                    onChange={(e) => update('appId', e.target.value)}
                    placeholder="e.g. Lead_tracker_1_A00"
                    className="field font-mono text-xs"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-foreground-400 -mt-1">
                App ID is the Kissflow process ID used for Admin Get-all-items and field sync.
              </p>
              <Field label="Subdomain" required>
                <input
                  value={form.subdomain}
                  onChange={(e) => update('subdomain', e.target.value)}
                  placeholder="e.g. development-refexgroup"
                  className="field"
                />
              </Field>
              <Field label="Application name">
                <input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Display name (optional)"
                  className="field"
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={2}
                  placeholder="Optional notes"
                  className="field h-auto py-2 resize-none"
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Region">
                  <select
                    value={form.region}
                    onChange={(e) => update('region', e.target.value as 'com' | 'eu')}
                    className="field"
                  >
                    <option value="com">kissflow.com</option>
                    <option value="eu">kissflow.eu</option>
                  </select>
                </Field>
                <Field label="Environment">
                  <select
                    value={form.environment}
                    onChange={(e) =>
                      update('environment', e.target.value as AccountForm['environment'])
                    }
                    className="field"
                  >
                    <option value="Development">Development</option>
                    <option value="UAT">UAT</option>
                    <option value="Production">Production</option>
                    <option value="Staging">Staging</option>
                  </select>
                </Field>
              </div>
            </Section>

            <Section title="Resource IDs">
              <p className="text-[11px] text-foreground-400 -mt-1 mb-1">
                Add one ID per row. Use + to add more.
              </p>
              <IdRowList
                label="Process IDs"
                icon="ri-git-branch-line"
                placeholder="e.g. Proc_Onboarding"
                values={processIds}
                onChange={setProcessIds}
              />
              <IdRowList
                label="Dataform IDs"
                icon="ri-survey-line"
                placeholder="e.g. DF_EmployeeInfo"
                values={dataformIds}
                onChange={setDataformIds}
              />
              <IdRowList
                label="Board IDs"
                icon="ri-kanban-view"
                placeholder="e.g. Board_NewHire"
                values={boardIds}
                onChange={setBoardIds}
              />
              <IdRowList
                label="Dataset IDs"
                icon="ri-database-2-line"
                placeholder="e.g. DS_Employees"
                values={datasetIds}
                onChange={setDatasetIds}
              />
            </Section>

            <Section title="API authentication">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Access Key ID" required>
                  <input
                    value={form.accessKeyId}
                    onChange={(e) => update('accessKeyId', e.target.value)}
                    placeholder="X-Access-Key-Id"
                    className="field font-mono text-xs"
                  />
                </Field>
                <Field label="Access Key Secret" required>
                  <input
                    type="password"
                    value={form.accessKeySecret}
                    onChange={(e) => update('accessKeySecret', e.target.value)}
                    placeholder="X-Access-Key-Secret"
                    className="field font-mono text-xs"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-foreground-400">
                Used as <code className="font-mono">X-Access-Key-Id</code> /{' '}
                <code className="font-mono">X-Access-Key-Secret</code> headers per Kissflow API docs.
              </p>
            </Section>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
                {error}
              </div>
            )}
          </form>

          <div className="px-6 py-4 border-t border-background-200/70 flex items-center justify-end gap-2.5 shrink-0 bg-background-50/40">
            <button type="button" onClick={handleClose} className="btn-ghost">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => handleSubmit()} className="btn-primary">
              {saving ? 'Connecting…' : 'Connect application'}
            </button>
          </div>

          <style>{`
            .field {
              width: 100%;
              height: 2.25rem;
              padding: 0 0.75rem;
              font-size: 0.875rem;
              border-radius: 0.5rem;
              border: 1px solid oklch(var(--background-300) / 0.6);
              background: white;
              color: oklch(var(--foreground-900));
              outline: none;
            }
            .field:focus {
              border-color: oklch(var(--primary-300));
              box-shadow: 0 0 0 2px oklch(var(--primary-100));
            }
          `}</style>
    </Modal>
  );
}

function IdRowList({
  label,
  icon,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  icon: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const updateRow = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };

  const addRow = () => onChange([...values, '']);

  const removeRow = (index: number) => {
    if (values.length === 1) {
      onChange(['']);
      return;
    }
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-lg border border-background-200/70 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <i className={`${icon} text-foreground-500 text-sm`}></i>
          <span className="text-xs font-medium text-foreground-700">{label}</span>
          <span className="text-[10px] text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded">
            {values.filter((v) => v.trim()).length}
          </span>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="h-7 px-2.5 rounded-md text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
        >
          <i className="ri-add-line"></i>
          Add
        </button>
      </div>

      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-5 text-[11px] text-foreground-400 text-right shrink-0 tabular-nums">
              {index + 1}
            </span>
            <input
              value={value}
              onChange={(e) => updateRow(index, e.target.value)}
              placeholder={placeholder}
              className="field font-mono text-xs flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (index === values.length - 1) addRow();
                }
              }}
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-red-50 hover:text-red-600 cursor-pointer shrink-0"
              title="Remove"
            >
              <i className="ri-close-line"></i>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
