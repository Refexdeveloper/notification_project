import { blockTypeLabels } from '@/mocks/templates';
import type { TemplateBlock } from '@/mocks/templates';

interface BlockPaletteProps {
  onAddBlock: (type: TemplateBlock['type']) => void;
}

export default function BlockPalette({ onAddBlock }: BlockPaletteProps) {
  const blockTypes = Object.entries(blockTypeLabels) as [TemplateBlock['type'], typeof blockTypeLabels['header']][];

  return (
    <div className="w-[200px] shrink-0">
      <p className="text-xs font-medium text-foreground-500 uppercase tracking-wider px-3 py-3">Blocks</p>
      <div className="space-y-0.5 px-2">
        {blockTypes.map(([type, info]) => (
          <button
            key={type}
            onClick={() => onAddBlock(type)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-background-100 transition-colors cursor-pointer group"
          >
            <span className="w-7 h-7 rounded-md bg-background-100 flex items-center justify-center shrink-0 group-hover:bg-white transition-colors">
              <i className={`${info.icon} text-sm text-foreground-600`}></i>
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground-800 whitespace-nowrap">{info.label}</p>
              <p className="text-[11px] text-foreground-500 truncate">{info.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}