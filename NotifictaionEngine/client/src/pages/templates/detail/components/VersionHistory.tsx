import type { TemplateVersion } from '@/mocks/templates';

interface VersionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  versions: TemplateVersion[];
  currentVersion: number;
  onRestoreVersion: (version: TemplateVersion) => void;
}

export default function VersionHistory({
  isOpen,
  onClose,
  versions,
  currentVersion,
  onRestoreVersion,
}: VersionHistoryProps) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <aside className="w-[300px] shrink-0 border-l border-background-200/70 bg-white overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">Version History</h3>
            <p className="text-xs text-foreground-500 mt-0.5">{versions.length} version{versions.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-background-100 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-foreground-500"></i>
          </button>
        </div>

        <div className="space-y-0">
          {sorted.map((version, idx) => {
            const isLatest = version.version === currentVersion;

            return (
              <div key={version.id} className="relative">
                <div className="flex gap-3 pb-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${
                      isLatest ? 'bg-primary-500 ring-2 ring-primary-100' : 'bg-background-300'
                    }`} />
                    {idx < sorted.length - 1 && (
                      <div className="w-px flex-1 bg-background-200/70 mt-1"></div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold whitespace-nowrap ${
                        isLatest ? 'text-primary-700' : 'text-foreground-700'
                      }`}>
                        v{version.version}
                      </span>
                      {isLatest && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 font-medium whitespace-nowrap">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground-600 leading-relaxed mb-1.5">{version.message}</p>
                    <div className="flex items-center gap-2 text-[11px] text-foreground-400">
                      <span>{version.author}</span>
                      <span>&middot;</span>
                      <span>{formatDate(version.timestamp)}</span>
                      <span>{formatTime(version.timestamp)}</span>
                    </div>
                    {!isLatest && (
                      <button
                        onClick={() => onRestoreVersion(version)}
                        className="mt-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 cursor-pointer flex items-center gap-1"
                      >
                        <i className="ri-arrow-go-back-line"></i>
                        Restore this version
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
