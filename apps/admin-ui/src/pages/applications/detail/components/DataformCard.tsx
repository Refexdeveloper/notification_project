import { useNavigate } from 'react-router-dom';
import type { Dataform } from '@/mocks/dataforms';

interface DataformCardProps {
  dataform: Dataform;
  index: number;
  appId: string;
}

export default function DataformCard({ dataform, index, appId }: DataformCardProps) {
  const navigate = useNavigate();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      className="bg-white border border-background-300/60 rounded-xl p-4 hover:border-primary-200/60 transition-all duration-150 group cursor-pointer"
      onClick={() => navigate(`/applications/${appId}/dataforms/${dataform.id}`)}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center shrink-0 group-hover:bg-accent-100 transition-colors">
          <span className="text-accent-600 text-lg">
            <i className={dataform.icon}></i>
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-foreground-900 truncate group-hover:text-primary-700 transition-colors">
                {dataform.name}
              </h4>
              <p className="text-xs text-foreground-500 mt-0.5">{dataform.owner}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/applications/${appId}/dataforms/${dataform.id}`);
              }}
              className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Open
            </button>
          </div>
          <p className="text-xs text-foreground-500 mt-2 line-clamp-2">{dataform.description}</p>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-background-100">
            <div className="flex items-center gap-1 text-xs text-foreground-500">
              <span className="w-3.5 h-3.5 flex items-center justify-center text-foreground-400">
                <i className="ri-text-spacing"></i>
              </span>
              <span>{dataform.fieldsCount} fields</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-foreground-500">
              <span className="w-3.5 h-3.5 flex items-center justify-center text-foreground-400">
                <i className="ri-mail-settings-line"></i>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/templates');
                }}
                className="hover:text-primary-600 transition-colors cursor-pointer"
              >
                {dataform.templatesCount} templates
              </button>
            </div>
            <div className="flex items-center gap-1 text-xs text-foreground-500">
              <span className="w-3.5 h-3.5 flex items-center justify-center text-foreground-400">
                <i className="ri-timer-line"></i>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/schedulers');
                }}
                className="hover:text-primary-600 transition-colors cursor-pointer"
              >
                {dataform.schedulersCount} schedulers
              </button>
            </div>
            <div className="flex-1" />
            <span className="text-[11px] text-foreground-400 whitespace-nowrap">{formatDate(dataform.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}