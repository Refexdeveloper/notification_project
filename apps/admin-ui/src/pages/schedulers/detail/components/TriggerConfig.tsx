import { useState } from 'react';
import { triggerTypeOptions } from '@/mocks/schedulers';
import type { SchedulerTrigger } from '@/mocks/schedulers';

interface TriggerConfigProps {
  triggers: SchedulerTrigger[];
  onChange: (triggers: SchedulerTrigger[]) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const triggerIconMap: Record<string, string> = {
  before_due_date: 'ri-timer-flash-line',
  after_due_date: 'ri-alarm-warning-line',
  status_changed: 'ri-flag-line',
  field_changed: 'ri-edit-line',
  on_create: 'ri-add-circle-line',
  on_update: 'ri-refresh-line',
  on_submit: 'ri-send-plane-line',
};

const triggerColorMap: Record<string, string> = {
  before_due_date: 'bg-accent-50 text-accent-600',
  after_due_date: 'bg-red-50 text-red-600',
  status_changed: 'bg-primary-50 text-primary-600',
  field_changed: 'bg-secondary-50 text-secondary-600',
  on_create: 'bg-emerald-50 text-emerald-600',
  on_update: 'bg-amber-50 text-amber-600',
  on_submit: 'bg-sky-50 text-sky-600',
};

export default function TriggerConfig({ triggers, onChange, isOpen, onToggle }: TriggerConfigProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const activeTriggers = triggers.filter((t) => t.enabled);
  const inactiveTriggers = triggers.filter((t) => !t.enabled);

  const addTrigger = (type: SchedulerTrigger['type']) => {
    const option = triggerTypeOptions.find((o) => o.type === type);
    if (!option) return;
    const newTrigger: SchedulerTrigger = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      label: option.label,
      config: {},
      enabled: true,
    };
    if (type === 'before_due_date' || type === 'after_due_date') {
      newTrigger.config = { days: 3 };
    }
    if (type === 'status_changed') {
      newTrigger.config = { status: 'Approved' };
    }
    if (type === 'field_changed') {
      newTrigger.config = { fieldName: 'status' };
    }
    onChange([...triggers, newTrigger]);
    setShowAddMenu(false);
  };

  const removeTrigger = (id: string) => {
    onChange(triggers.filter((t) => t.id !== id));
  };

  const toggleTrigger = (id: string) => {
    onChange(triggers.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
  };

  const updateTriggerConfig = (id: string, config: Record<string, unknown>) => {
    onChange(triggers.map((t) => (t.id === id ? { ...t, config: { ...t.config, ...config } } : t)));
  };

  const usedTypes = triggers.map((t) => t.type);
  const availableTypes = triggerTypeOptions.filter((o) => !usedTypes.includes(o.type));

  const summary = activeTriggers.length === 0
    ? 'No triggers configured'
    : `${activeTriggers.length} trigger${activeTriggers.length !== 1 ? 's' : ''} active`;

  return (
    <div className="border border-background-200/70 rounded-xl bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-background-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent-50 flex items-center justify-center">
            <i className="ri-flashlight-line text-accent-600"></i>
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground-900">Trigger Conditions</h3>
            <p className="text-xs text-foreground-500 mt-0.5">{summary}</p>
          </div>
        </div>
        <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <i className="ri-arrow-down-s-line text-foreground-400"></i>
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 border-t border-background-100">
          <div className="pt-4 space-y-2">
            {activeTriggers.map((trigger) => (
              <div
                key={trigger.id}
                className="bg-background-50 rounded-lg p-3"
              >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${triggerColorMap[trigger.type] || 'bg-background-100 text-foreground-500'}`}>
                      <i className={triggerIconMap[trigger.type] || 'ri-notification-line'}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground-900">{trigger.label}</span>
                        <button
                          onClick={() => toggleTrigger(trigger.id)}
                          className={`w-8 h-5 rounded-full relative transition-colors cursor-pointer shrink-0 ${
                            trigger.enabled ? 'bg-primary-500' : 'bg-background-300'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                              trigger.enabled ? 'left-[14px]' : 'left-[2px]'
                            }`}
                          ></span>
                        </button>
                      </div>

                      {trigger.type === 'before_due_date' && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            value={trigger.config.days || 3}
                            onChange={(e) =>
                              updateTriggerConfig(trigger.id, { days: Math.max(0, parseInt(e.target.value) || 0) })
                            }
                            min={0}
                            className="w-16 h-7 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500"
                          />
                          <span className="text-xs text-foreground-500">days before due date</span>
                          {trigger.config.hours !== undefined && (
                            <>
                              <span className="text-xs text-foreground-400">or</span>
                              <input
                                type="number"
                                value={trigger.config.hours || 0}
                                onChange={(e) =>
                                  updateTriggerConfig(trigger.id, { hours: Math.max(0, parseInt(e.target.value) || 0) })
                                }
                                min={0}
                                className="w-16 h-7 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500"
                              />
                              <span className="text-xs text-foreground-500">hours before</span>
                            </>
                          )}
                        </div>
                      )}

                      {trigger.type === 'after_due_date' && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            value={trigger.config.days || 1}
                            onChange={(e) =>
                              updateTriggerConfig(trigger.id, { days: Math.max(0, parseInt(e.target.value) || 0) })
                            }
                            min={0}
                            className="w-16 h-7 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500"
                          />
                          <span className="text-xs text-foreground-500">days after due date</span>
                        </div>
                      )}

                      {trigger.type === 'status_changed' && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-foreground-500">When status becomes</span>
                          <select
                            value={trigger.config.status || 'Approved'}
                            onChange={(e) => updateTriggerConfig(trigger.id, { status: e.target.value })}
                            className="h-7 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500 cursor-pointer"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Pending Approval">Pending Approval</option>
                            <option value="Approved">Approved</option>
                            <option value="Rejected">Rejected</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                            <option value="Resolved">Resolved</option>
                            <option value="Critical">Critical</option>
                          </select>
                        </div>
                      )}

                      {trigger.type === 'field_changed' && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-foreground-500">When</span>
                          <input
                            type="text"
                            value={trigger.config.fieldName || 'status'}
                            onChange={(e) => updateTriggerConfig(trigger.id, { fieldName: e.target.value })}
                            placeholder="field name"
                            className="w-32 h-7 px-2 text-xs bg-white border border-background-200/70 rounded-md focus:outline-none focus:border-primary-500"
                          />
                          <span className="text-xs text-foreground-500">changes</span>
                        </div>
                      )}

                      {trigger.type === 'on_create' && (
                        <p className="text-xs text-foreground-500 mt-2">Fires immediately when a new record is created</p>
                      )}

                      {trigger.type === 'on_update' && (
                        <p className="text-xs text-foreground-500 mt-2">Fires whenever the record is updated</p>
                      )}

                      {trigger.type === 'on_submit' && (
                        <p className="text-xs text-foreground-500 mt-2">Fires when the form is submitted</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeTrigger(trigger.id)}
                      className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors shrink-0"
                    >
                      <i className="ri-close-line text-xs text-foreground-400 hover:text-red-500"></i>
                    </button>
                  </div>
                </div>
              ))}

            {inactiveTriggers.length > 0 && (
              <div className="pt-2">
                <p className="text-[11px] font-medium text-foreground-400 mb-1.5 px-1">Disabled</p>
                {inactiveTriggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-50"
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${triggerColorMap[trigger.type] || 'bg-background-100 text-foreground-500'}`}>
                      <i className={`${triggerIconMap[trigger.type] || 'ri-notification-line'} text-xs`}></i>
                    </div>
                    <span className="text-xs text-foreground-700 flex-1">{trigger.label}</span>
                    <button
                      onClick={() => toggleTrigger(trigger.id)}
                      className="text-xs text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                    >
                      Enable
                    </button>
                    <button
                      onClick={() => removeTrigger(trigger.id)}
                      className="w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <i className="ri-close-line text-xs text-foreground-400 hover:text-red-500"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative pt-1">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                disabled={availableTypes.length === 0}
                className={`h-9 w-full rounded-lg border border-dashed transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-xs font-medium ${
                  availableTypes.length === 0
                    ? 'border-background-200 text-foreground-300 cursor-not-allowed'
                    : 'border-background-300 text-foreground-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50'
                }`}
              >
                <i className="ri-add-line"></i>
                Add Trigger
              </button>

              {showAddMenu && availableTypes.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-background-200/70 rounded-lg shadow-lg z-10 p-1">
                  {availableTypes.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => addTrigger(opt.type)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-background-50 transition-colors cursor-pointer text-left"
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${triggerColorMap[opt.type] || 'bg-background-100 text-foreground-500'}`}>
                        <i className={`${triggerIconMap[opt.type] || 'ri-notification-line'} text-xs`}></i>
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