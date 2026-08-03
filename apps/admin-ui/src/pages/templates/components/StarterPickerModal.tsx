import { useEffect, useState } from 'react';
import { LayoutTemplate, Sparkles } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import {
  loadReportStarterHtmlFromBackend,
  loadReportStartersFromBackend,
  type ReportStarter,
} from '@/services/reportsApi';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Mode = 'create' | 'load';

type StarterPickerModalProps = {
  open: boolean;
  onClose: () => void;
  app: KissflowApplication;
  mode: Mode;
  defaultName?: string;
  creating?: boolean;
  onConfirmCreate?: (input: {
    starterId: string;
    name: string;
    subject: string;
    description: string;
  }) => void | Promise<void>;
  onConfirmLoad?: (html: string, starter: ReportStarter) => void | Promise<void>;
};

export default function StarterPickerModal({
  open,
  onClose,
  app,
  mode,
  defaultName,
  creating = false,
  onConfirmCreate,
  onConfirmLoad,
}: StarterPickerModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ReportStarter[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState(defaultName || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setName(
      defaultName ||
        `${app.displayName || app.name} report`,
    );
    loadReportStartersFromBackend(app).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error || 'Could not load starters');
        setItems([]);
        return;
      }
      const list = result.items || [];
      setItems(list);
      const recommended = list.find((row) => row.recommended) || list[0];
      setSelectedId(recommended?.id || '');
    });
    return () => {
      cancelled = true;
    };
  }, [open, app, defaultName]);

  const selected = items.find((row) => row.id === selectedId);

  const handleConfirm = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        if (!onConfirmCreate) return;
        const label = app.displayName || app.name;
        await onConfirmCreate({
          starterId: selectedId,
          name: name.trim() || `${label} report`,
          subject: `{{ReportTitle}} — ${label}`,
          description: selected?.description || `HTML report for ${label}`,
        });
      } else if (onConfirmLoad) {
        const result = await loadReportStarterHtmlFromBackend(app, selectedId);
        if (!result.ok || !result.item?.html) {
          setError(result.error || 'Could not load starter HTML');
          return;
        }
        await onConfirmLoad(result.item.html, result.item);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && !creating && onClose()} className="max-w-xl">
      <div className="px-5 pt-5 pb-4 border-b border-background-200/80">
        <div className="flex items-start gap-3">
          <span className="icon-well">
            <LayoutTemplate className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground-950">
              {mode === 'create' ? 'Create from starter layout' : 'Load starter layout'}
            </h2>
            <p className="text-xs text-foreground-500 mt-1 leading-relaxed">
              Pick a ready-made HTML layout (same as live ITSM / PM / Lead reports). Then edit
              labels and click placeholders — no AI required.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[60vh]">
        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        )}

        {mode === 'create' && (
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
              Template name
            </label>
            <Input
              className="mt-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Travel weekly report"
            />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-foreground-500 py-6 text-center">Loading starters…</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const active = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left rounded-xl border px-3.5 py-3 transition-colors cursor-pointer ${
                    active
                      ? 'border-primary-400 bg-primary-50/80'
                      : 'border-background-200 bg-white hover:border-primary-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground-900">{item.name}</span>
                    {item.recommended && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                        <Sparkles className="w-3 h-3" />
                        Suggested
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground-500 mt-1 leading-relaxed">
                    {item.description}
                  </p>
                  {active && item.placeholders?.length > 0 && (
                    <p className="text-[11px] font-mono text-foreground-400 mt-2 line-clamp-2">
                      {item.placeholders.map((p) => `{{${p}}}`).join(' · ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-background-200/80 flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy || creating} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!selectedId || loading || busy || creating}
          loading={busy || creating}
          onClick={() => void handleConfirm()}
        >
          {mode === 'create' ? 'Create template' : 'Replace HTML with starter'}
        </Button>
      </div>
    </Modal>
  );
}
