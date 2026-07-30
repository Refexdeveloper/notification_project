import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteApplication,
  updateApplicationFromForm,
  type KissflowApplication,
} from '@/mocks/applications';

interface SettingsTabProps {
  app: KissflowApplication;
  onSaved?: () => void;
}

function toRows(ids: string[] | undefined): string[] {
  return ids?.length ? [...ids] : [''];
}

export default function SettingsTab({ app, onSaved }: SettingsTabProps) {
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState(app.accountId);
  const [appId, setAppId] = useState(app.appId || '');
  const [subdomain, setSubdomain] = useState(app.subdomain);
  const [name, setName] = useState(app.displayName || app.name);
  const [description, setDescription] = useState(app.description);
  const [region, setRegion] = useState(app.region);
  const [environment, setEnvironment] = useState(app.environment);
  const [status, setStatus] = useState(app.status);
  const [processIds, setProcessIds] = useState(() => toRows(app.processIds));
  const [dataformIds, setDataformIds] = useState(() => toRows(app.dataformIds));
  const [boardIds, setBoardIds] = useState(() => toRows(app.boardIds));
  const [datasetIds, setDatasetIds] = useState(() => toRows(app.datasetIds));
  const [accessKeyId, setAccessKeyId] = useState(app.accessKeyId);
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setAccountId(app.accountId);
    setAppId(app.appId || '');
    setSubdomain(app.subdomain);
    setName(app.displayName || app.name);
    setDescription(app.description);
    setRegion(app.region);
    setEnvironment(app.environment);
    setStatus(app.status);
    setProcessIds(toRows(app.processIds));
    setDataformIds(toRows(app.dataformIds));
    setBoardIds(toRows(app.boardIds));
    setDatasetIds(toRows(app.datasetIds));
    setAccessKeyId(app.accessKeyId);
    setAccessKeySecret('');
    setError('');
    setSaved(false);
    setConfirmDelete(false);
  }, [app.id, app.lastSync]);

  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!accountId.trim()) {
      setError('Account ID is required.');
      return;
    }
    if (!appId.trim()) {
      setError('App ID is required (e.g. Lead_tracker_1_A00).');
      return;
    }
    if (!subdomain.trim()) {
      setError('Subdomain is required.');
      return;
    }
    if (!accessKeyId.trim()) {
      setError('Access Key ID is required.');
      return;
    }
    if (!accessKeySecret.trim() && !app.accessKeySecret) {
      setError('Access Key Secret is required.');
      return;
    }

    const updated = updateApplicationFromForm(app.id, {
      accountId,
      appId,
      subdomain,
      name,
      description,
      region,
      environment,
      status,
      processIds: processIds.filter((id) => id.trim()).join(','),
      dataformIds: dataformIds.filter((id) => id.trim()).join(','),
      boardIds: boardIds.filter((id) => id.trim()).join(','),
      datasetIds: datasetIds.filter((id) => id.trim()).join(','),
      accessKeyId,
      accessKeySecret,
    });

    if (!updated) {
      setError('Could not save application.');
      return;
    }

    setError('');
    setAccessKeySecret('');
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2500);
  };

  const remove = () => {
    deleteApplication(app.id);
    navigate('/applications');
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-primary-50 border border-primary-100 rounded-xl px-4 py-3">
        <p className="text-xs text-primary-800">
          Edit the Kissflow account, resource IDs, and access keys registered for this application.
          Changes apply to API Explorer, User Engagement, and Connection.
        </p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <section className="bg-white border border-background-300/60 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground-900">Kissflow account</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Account ID" required>
              <input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input font-mono text-xs" />
            </Field>
            <Field label="App ID" required>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="e.g. Lead_tracker_1_A00"
                className="input font-mono text-xs"
              />
            </Field>
          </div>
          <p className="text-[11px] text-foreground-400 -mt-1">
            App ID is used on Sync to call Admin Get-all-items and discover fields.
          </p>
          <Field label="Subdomain" required>
            <input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} className="input" />
          </Field>
          <Field label="Application name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input resize-none h-auto py-2"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Region">
              <select value={region} onChange={(e) => setRegion(e.target.value as 'com' | 'eu')} className="input">
                <option value="com">kissflow.com</option>
                <option value="eu">kissflow.eu</option>
              </select>
            </Field>
            <Field label="Environment">
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as KissflowApplication['environment'])}
                className="input"
              >
                <option value="Development">Development</option>
                <option value="UAT">UAT</option>
                <option value="Staging">Staging</option>
                <option value="Production">Production</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as KissflowApplication['status'])}
                className="input"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="bg-white border border-background-300/60 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground-900">Resource IDs</h3>
          <p className="text-[11px] text-foreground-400 -mt-1">Add one ID per row. Use + to add more.</p>
          <IdRowList
            label="Process IDs"
            icon="ri-git-branch-line"
            placeholder="e.g. Lead_tracker_1_A00"
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
        </section>

        <section className="bg-white border border-background-300/60 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground-900">API authentication</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Access Key ID" required>
              <input
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                className="input font-mono text-xs"
              />
            </Field>
            <Field label="Access Key Secret">
              <input
                type="password"
                value={accessKeySecret}
                onChange={(e) => setAccessKeySecret(e.target.value)}
                placeholder={app.accessKeySecret ? '••••••••  (leave blank to keep)' : 'Required'}
                className="input font-mono text-xs"
              />
            </Field>
          </div>
          <p className="text-[11px] text-foreground-400">
            Leave secret blank to keep the existing value. Used as{' '}
            <code className="font-mono">X-Access-Key-Id</code> /{' '}
            <code className="font-mono">X-Access-Key-Secret</code>.
          </p>
        </section>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="h-9 px-3.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <i className="ri-save-line"></i>
            Save changes
          </button>
          {saved && <span className="text-xs text-accent-700 font-medium">Application updated</span>}
        </div>
      </form>

      <section className="bg-white border border-red-100 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-red-700">Danger zone</h3>
        <p className="text-xs text-foreground-500">
          Remove this application from the portal. This does not delete anything in Kissflow.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-9 px-3.5 rounded-lg border border-red-200 text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer"
          >
            Delete application
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-red-600">Delete “{app.displayName || app.name}”?</span>
            <button
              type="button"
              onClick={remove}
              className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 cursor-pointer"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-8 px-3 rounded-[10px] text-xs font-semibold text-foreground-700 bg-white border border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </section>

      <style>{`
        .input {
          width: 100%;
          height: 2.25rem;
          padding: 0 0.75rem;
          font-size: 0.875rem;
          border-radius: 0.5rem;
          border: 1px solid oklch(var(--background-300) / 0.6);
          outline: none;
          background: white;
        }
        .input:focus {
          border-color: oklch(var(--primary-300));
          box-shadow: 0 0 0 2px oklch(var(--primary-100));
        }
      `}</style>
    </div>
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
              className="input font-mono text-xs flex-1"
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
