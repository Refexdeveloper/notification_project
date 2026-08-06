import { useMemo, useState } from 'react';
import {
  pipelinePlaceholdersForApp,
  unknownPlaceholders,
  type TemplateAppKind,
} from '@/lib/templatePreview';

type InsertTarget = 'html' | 'subject';

type PlaceholderPickerProps = {
  appKind: TemplateAppKind;
  usedInTemplate: string[];
  onInsert: (token: string, target: InsertTarget) => void;
};

export default function PlaceholderPicker({
  appKind,
  usedInTemplate,
  onInsert,
}: PlaceholderPickerProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const pipelineKeys = useMemo(() => pipelinePlaceholdersForApp(appKind), [appKind]);
  const unknown = useMemo(
    () => unknownPlaceholders(usedInTemplate, appKind),
    [usedInTemplate, appKind],
  );
  const usedSet = useMemo(() => new Set(usedInTemplate), [usedInTemplate]);

  const copyToken = async (key: string) => {
    const token = `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-[14px] bg-background-50 border border-background-200/80 p-3 space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400 mb-1">
          Placeholders
        </p>
        <p className="text-[11px] text-foreground-500 leading-relaxed">
          Click to insert into HTML. These are filled by the report pipeline — not AI.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pipelineKeys.map((key) => {
          const inUse = usedSet.has(key);
          return (
            <button
              key={key}
              type="button"
              title={inUse ? 'Already in template — click to insert again' : 'Insert into HTML'}
              onClick={() => onInsert(`{{${key}}}`, 'html')}
              onContextMenu={(e) => {
                e.preventDefault();
                void copyToken(key);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-mono cursor-pointer border transition-colors ${
                inUse
                  ? 'bg-primary-50 border-primary-200 text-primary-800'
                  : 'bg-white border-background-300 text-foreground-700 hover:border-primary-300 hover:text-primary-700'
              }`}
            >
              {`{{${key}}}`}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onInsert('{{ReportTitle}}', 'subject')}
          className="text-[11px] font-medium text-primary-700 hover:underline cursor-pointer"
        >
          Insert into subject
        </button>
        {copied && (
          <span className="text-[11px] text-emerald-700">Copied {`{{${copied}}}`}</span>
        )}
      </div>

      {unknown.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-900 mb-1">
            Not filled by pipeline
          </p>
          <p className="text-[11px] text-amber-800 leading-relaxed font-mono">
            {unknown.map((key) => `{{${key}}}`).join(' ')}
          </p>
          <p className="text-[10px] text-amber-700 mt-1">
            These stay as literal text in sent emails unless the render runbook is updated.
          </p>
        </div>
      )}
    </div>
  );
}
