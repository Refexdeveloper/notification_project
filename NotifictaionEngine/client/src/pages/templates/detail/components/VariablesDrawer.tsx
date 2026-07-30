import { notificationVariables } from '@/mocks/dataforms';

interface VariablesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertVariable: (variable: string) => void;
  templateVariables: string[];
}

export default function VariablesDrawer({ isOpen, onClose, onInsertVariable, templateVariables }: VariablesDrawerProps) {
  if (!isOpen) return null;

  return (
    <aside className="w-[260px] shrink-0 border-l border-background-200/70 bg-white overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground-900">Variables</h3>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-background-100 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-foreground-500"></i>
          </button>
        </div>
        <p className="text-xs text-foreground-500 mb-3">
          Click a variable to insert it at cursor position in the editor.
        </p>

        <div className="space-y-3">
          {notificationVariables.length === 0 ? (
            <p className="text-xs text-foreground-500 leading-relaxed px-1">
              No variables yet. Sync fields from a Kissflow app first, then they’ll show up here.
            </p>
          ) : (
            (['primary', 'accent', 'secondary'] as const).map((colorGroup) => {
            const groupVars = notificationVariables.filter((v) => v.color === colorGroup);
            if (groupVars.length === 0) return null;
            const groupLabel = colorGroup === 'primary' ? 'Common' : colorGroup === 'accent' ? 'People & Status' : 'System';
            return (
              <div key={colorGroup}>
                <p className="text-[11px] font-medium text-foreground-400 uppercase tracking-wider mb-1.5 px-1">
                  {groupLabel}
                </p>
                <div className="space-y-0.5">
                  {groupVars.map((v) => {
                    return (
                      <button
                        key={v.id}
                        onClick={() => onInsertVariable(v.variable)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer group hover:bg-background-50"
                      >
                        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0">
                          <i className={`${v.icon} text-xs`}></i>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground-800 truncate">{v.name}</p>
                          <code className="text-[11px] text-foreground-400 font-mono">{v.variable}</code>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
          )}
        </div>
      </div>
    </aside>
  );
}
