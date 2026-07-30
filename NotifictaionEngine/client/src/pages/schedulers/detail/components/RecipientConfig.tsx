import { useState } from 'react';
import type { SchedulerRecipient } from '@/mocks/schedulers';

interface RecipientConfigProps {
  recipients: SchedulerRecipient[];
  onChange: (recipients: SchedulerRecipient[]) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const recipientTypeOptions = [
  { type: 'initiator' as const, label: 'Form Initiator', icon: 'ri-user-line', description: 'The person who submitted the form' },
  { type: 'approver' as const, label: 'Approver', icon: 'ri-user-star-line', description: 'The designated approver' },
  { type: 'manager' as const, label: 'Reporting Manager', icon: 'ri-user-settings-line', description: 'The initiator\'s reporting manager' },
  { type: 'role' as const, label: 'Role-based', icon: 'ri-shield-user-line', description: 'Users with a specific role' },
  { type: 'email' as const, label: 'Static Email', icon: 'ri-mail-line', description: 'A fixed email address' },
];

export default function RecipientConfig({ recipients, onChange, isOpen, onToggle }: RecipientConfigProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const addRecipient = (type: SchedulerRecipient['type']) => {
    const option = recipientTypeOptions.find((o) => o.type === type);
    if (!option) return;
    const newRecipient: SchedulerRecipient = {
      type,
      label: option.label,
      value: type === 'email' ? 'team@enterprise.com' : type,
    };
    onChange([...recipients, newRecipient]);
    setShowAddMenu(false);
  };

  const removeRecipient = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
  };

  const updateRecipientValue = (index: number, value: string) => {
    onChange(recipients.map((r, i) => (i === index ? { ...r, value } : r)));
  };

  const count = recipients.length;

  return (
    <div className="border border-background-200/70 rounded-xl bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-background-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary-50 flex items-center justify-center">
            <i className="ri-group-line text-secondary-600"></i>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground-900">Recipients</h3>
            <p className="text-xs text-foreground-500 mt-0.5">
              {count === 0 ? 'No recipients configured' : `${count} recipient${count !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-foreground-400"></i>
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 border-t border-background-100">
          <div className="pt-4 space-y-2">
            {recipients.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-background-50 rounded-lg p-2.5"
              >
                <div className="w-7 h-7 rounded-md bg-secondary-100 flex items-center justify-center shrink-0">
                  <i className={`${r.type === 'email' ? 'ri-mail-line' : 'ri-user-line'} text-secondary-600 text-xs`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground-900">{r.label}</div>
                  {r.type === 'email' ? (
                    <input
                      type="email"
                      value={r.value}
                      onChange={(e) => updateRecipientValue(i, e.target.value)}
                      className="w-full h-7 mt-0.5 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500"
                      placeholder="email@example.com"
                    />
                  ) : (
                    <div className="text-[11px] text-foreground-400 mt-0.5">
                      {recipientTypeOptions.find((o) => o.type === r.type)?.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeRecipient(i)}
                  className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors shrink-0"
                >
                  <i className="ri-close-line text-xs text-foreground-400 hover:text-red-500"></i>
                </button>
              </div>
            ))}

            {recipients.length === 0 && (
              <div className="text-center py-3">
                <p className="text-xs text-foreground-400">No recipients configured yet. Add at least one recipient to receive notifications.</p>
              </div>
            )}

            <div className="relative pt-1">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="h-9 w-full rounded-lg border border-dashed border-background-300 text-foreground-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-xs font-medium"
              >
                <i className="ri-add-line"></i>
                Add Recipient
              </button>

              {showAddMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-background-200/70 rounded-lg shadow-lg z-10 p-1">
                  {recipientTypeOptions.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => addRecipient(opt.type)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-background-50 transition-colors cursor-pointer text-left"
                    >
                      <div className="w-7 h-7 rounded-md bg-secondary-100 flex items-center justify-center shrink-0">
                        <i className={`${opt.icon} text-secondary-600 text-xs`}></i>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-foreground-900">{opt.label}</div>
                        <div className="text-[11px] text-foreground-400">{opt.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}