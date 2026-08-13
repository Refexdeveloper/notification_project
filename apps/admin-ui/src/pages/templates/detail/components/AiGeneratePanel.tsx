import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type AiGeneratePanelProps = {
  busy: boolean;
  onGenerate: (prompt: string, includeCurrentHtml: boolean) => Promise<void>;
};

const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: 'KPI + table',
    prompt:
      '3 KPI cards: Total, Open, Closed, then a user table. Green Refex header with logo.',
  },
  {
    label: 'Add SLA cards',
    prompt:
      'Keep current layout but add SLA breached and Opened Today cards under the KPIs.',
  },
  {
    label: 'Simple metrics',
    prompt:
      'Keep the Project Tracker card layout: four KPI cards, today activity, then MIS user table. Use this app’s labels (claims, leads, or travel requests). Slight color tint only.',
  },
];

export default function AiGeneratePanel({ busy, onGenerate }: AiGeneratePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      await onGenerate(prompt.trim(), includeCurrent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  };

  return (
    <div className="rounded-[14px] border border-teal-200 bg-teal-50/50 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-teal-900">
            Generate with AI
          </p>
          <p className="text-[11px] text-teal-800/80 leading-relaxed mt-0.5">
            Describe the email layout. Uses your app fields and allowed pipeline placeholders.
            Result stays in the editor until you Save draft.
          </p>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        disabled={busy}
        className="field-input !h-auto py-2.5 resize-none text-xs"
        placeholder="e.g. Four metric cards + MIS user table, Refex green header…"
      />

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeCurrent}
          onChange={(e) => setIncludeCurrent(e.target.checked)}
          disabled={busy}
          className="mt-0.5 rounded border-teal-300"
        />
        <span className="text-[11px] text-teal-900 leading-snug">
          Revise current HTML (unchecked = fresh layout from prompt)
        </span>
      </label>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            disabled={busy}
            onClick={() => setPrompt(example.prompt)}
            className="text-[10px] px-2 py-1 rounded-md border border-teal-200 bg-white text-teal-800 hover:border-teal-400 cursor-pointer disabled:opacity-50"
          >
            {example.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}

      <Button
        size="sm"
        className="w-full"
        loading={busy}
        disabled={busy || prompt.trim().length < 8}
        onClick={() => void run()}
        leftIcon={!busy ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
      >
        {busy ? 'Generating…' : 'Generate HTML'}
      </Button>
    </div>
  );
}
