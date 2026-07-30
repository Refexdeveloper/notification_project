import type { Template } from '@/mocks/templates';

interface TemplateToolbarProps {
  template: Template;
  onSaveDraft: () => void;
  onPublish: () => void;
  onToggleVersionHistory: () => void;
  onToggleVariables: () => void;
  onTestEmail: () => void;
  onTogglePreview: () => void;
  showVersionHistory: boolean;
  showVariables: boolean;
  previewMode: boolean;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onSubjectChange: (subject: string) => void;
}

const statusBadge = (status: Template['status']) => {
  const config = {
    draft: 'bg-secondary-100 text-secondary-700',
    published: 'bg-primary-50 text-primary-700',
    archived: 'bg-background-200 text-foreground-500',
  };
  return config[status];
};

export default function TemplateToolbar({
  template,
  onSaveDraft,
  onPublish,
  onToggleVersionHistory,
  onToggleVariables,
  onTestEmail,
  onTogglePreview,
  showVersionHistory,
  showVariables,
  previewMode,
  onBack,
  onNameChange,
  onSubjectChange,
}: TemplateToolbarProps) {
  return (
    <div className="sticky top-0 z-30 bg-white border-b border-background-200/70">
      <div className="px-4 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-icon"
          aria-label="Back"
        >
          <i className="ri-arrow-left-line text-lg"></i>
        </button>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          <input
            type="text"
            value={template.name}
            onChange={(e) => onNameChange(e.target.value)}
            className="text-sm font-semibold text-foreground-900 bg-transparent border-b border-transparent hover:border-background-300 focus:border-primary-500 focus:outline-none px-1 py-0.5 min-w-0 max-w-[240px] transition-colors"
            placeholder="Template Name"
          />
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusBadge(template.status)}`}>
            {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleVariables}
            className={`h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
              showVariables
                ? 'bg-primary-50 text-primary-700 border-primary-200'
                : 'bg-white text-foreground-700 border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF]'
            }`}
          >
            <i className="ri-braces-line text-sm"></i>
            Variables
          </button>

          <button
            type="button"
            onClick={onToggleVersionHistory}
            className={`h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
              showVersionHistory
                ? 'bg-secondary-100 text-secondary-700 border-secondary-200'
                : 'bg-white text-foreground-700 border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF]'
            }`}
          >
            <i className="ri-history-line text-sm"></i>
            History
          </button>

          <div className="w-px h-5 bg-background-200/70 mx-1"></div>

          <button
            type="button"
            onClick={onTestEmail}
            className="h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap bg-white text-foreground-700 border border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF]"
          >
            <i className="ri-send-plane-line text-sm"></i>
            Test Email
          </button>

          <button
            type="button"
            onClick={onTogglePreview}
            className={`h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
              previewMode
                ? 'bg-foreground-900 text-white border-foreground-900'
                : 'bg-white text-foreground-700 border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF]'
            }`}
          >
            <i className="ri-eye-line text-sm"></i>
            Preview
          </button>

          <div className="w-px h-5 bg-background-200/70 mx-1"></div>

          <button
            type="button"
            onClick={onSaveDraft}
            className="h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap bg-white text-foreground-700 border border-[#D7E6F4] hover:border-primary-300 hover:bg-[#F8FBFF]"
          >
            <i className="ri-draft-line text-sm"></i>
            Save Draft
          </button>

          <button
            type="button"
            onClick={onPublish}
            className="h-8 px-3 rounded-[10px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap bg-primary-500 text-white border border-primary-500 hover:bg-primary-600"
          >
            <i className="ri-check-line text-sm"></i>
            Publish
          </button>
        </div>
      </div>

      <div className="px-4 pb-2">
        <input
          type="text"
          value={template.subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="w-full text-sm text-foreground-600 bg-background-50 border border-background-200/70 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary-500 focus:bg-white transition-colors"
          placeholder="Email subject line..."
        />
      </div>
    </div>
  );
}
