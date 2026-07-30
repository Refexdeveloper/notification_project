import { useNavigate } from 'react-router-dom';
import type { Scheduler } from '@/mocks/schedulers';

interface SchedulerToolbarProps {
  scheduler: Scheduler;
  onSave: () => void;
  onActivate: () => void;
  onPause: () => void;
  onDelete: () => void;
  onBack: () => void;
}

export default function SchedulerToolbar({
  scheduler,
  onSave,
  onActivate,
  onPause,
  onDelete,
  onBack,
}: SchedulerToolbarProps) {
  const navigate = useNavigate();

  const statusBadge = (status: Scheduler['status']) => {
    const config = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      paused: 'bg-amber-50 text-amber-700 border-amber-200',
      draft: 'bg-secondary-100 text-secondary-700 border-secondary-200',
    };
    return config[status];
  };

  const statusDot = (status: Scheduler['status']) => {
    const config = {
      active: 'bg-emerald-500',
      paused: 'bg-amber-500',
      draft: 'bg-foreground-400',
    };
    return config[status];
  };

  return (
    <div className="h-14 bg-white border-b border-background-200/70 flex items-center px-4 gap-3 shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="btn-icon"
        aria-label="Back"
      >
        <i className="ri-arrow-left-line"></i>
      </button>

      <div className="flex items-center gap-2 min-w-0">
        <input
          type="text"
          value={scheduler.name}
          readOnly
          className="text-sm font-semibold text-foreground-900 bg-transparent border-none outline-none truncate min-w-0 w-64"
        />
        <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${statusBadge(scheduler.status)}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(scheduler.status)}`}></span>
          {scheduler.status}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <button
          onClick={onSave}
          className="h-8 px-3 rounded-lg text-xs font-medium bg-background-100 text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
        >
          <i className="ri-save-line"></i>
          Save Draft
        </button>

        {scheduler.status === 'active' ? (
          <button
            onClick={onPause}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
          >
            <i className="ri-pause-circle-line"></i>
            Pause
          </button>
        ) : (
          <button
            onClick={onActivate}
            className="h-8 px-3 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
          >
            <i className="ri-play-circle-line"></i>
            Activate
          </button>
        )}

        <button
          onClick={onDelete}
          className="h-8 px-3 rounded-lg text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
        >
          <i className="ri-delete-bin-line"></i>
          Delete
        </button>
      </div>
    </div>
  );
}