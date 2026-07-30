import { useState } from 'react';
import { notificationVariables } from '@/mocks/dataforms';
import Modal from '@/components/ui/Modal';

interface TestEmailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  templateName: string;
  subject: string;
  onSend: (recipient: string, overrides: Record<string, string>) => void;
}

export default function TestEmailDialog({
  isOpen,
  onClose,
  templateName,
  subject,
  onSend,
}: TestEmailDialogProps) {
  const [recipient, setRecipient] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState('');

  const handleSend = () => {
    if (!recipient.trim() || !recipient.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setError('');
    setStep('sending');

    setTimeout(() => {
      onSend(recipient, overrides);
      setStep('sent');
    }, 1500);
  };

  const handleClose = () => {
    setStep('form');
    setRecipient('');
    setOverrides({});
    setError('');
    onClose();
  };

  const relevantVars = notificationVariables.slice(0, 6);

  return (
    <Modal open={isOpen} onClose={handleClose} className="max-w-[480px] !rounded-xl">
      <div className="overflow-y-auto max-h-[600px]">
        {step === 'form' && (
          <>
            <div className="p-5 border-b border-background-200/70">
              <h3 className="text-sm font-semibold text-foreground-900">Send Test Email</h3>
              <p className="text-xs text-foreground-500 mt-0.5">
                Send a preview of "{templateName}" to a test recipient with optional variable overrides.
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground-700 mb-1.5">
                  Recipient Email
                </label>
                <input
                  type="email"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setError('');
                  }}
                  placeholder="test@company.com"
                  className={`w-full text-sm bg-background-50 border rounded-lg px-3 py-2 focus:outline-none focus:bg-white transition-colors duration-150 ${
                    error
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-background-200 focus:border-primary-500'
                  }`}
                />
                {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground-700 mb-1.5">
                  Subject Preview
                </label>
                <div className="text-sm text-foreground-600 bg-background-50 border border-background-200/70 rounded-lg px-3 py-2">
                  {subject || '(No subject)'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground-700 mb-2">
                  Variable Overrides
                  <span className="text-foreground-400 font-normal ml-1">(optional)</span>
                </label>
                <div className="space-y-2">
                  {relevantVars.map((v) => (
                    <div key={v.id} className="flex items-center gap-2">
                      <code className="text-[11px] text-foreground-500 font-mono w-[130px] shrink-0 truncate bg-background-50 rounded px-2 py-1.5 border border-background-200/50">
                        {v.variable}
                      </code>
                      <input
                        type="text"
                        value={overrides[v.variable] || ''}
                        onChange={(e) =>
                          setOverrides((prev) => ({ ...prev, [v.variable]: e.target.value }))
                        }
                        placeholder="Override value"
                        className="flex-1 text-xs bg-background-50 border border-background-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-primary-300"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-background-200/70 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="h-8 px-4 rounded-lg text-xs font-medium text-foreground-600 hover:bg-background-100 transition-colors duration-150 cursor-pointer whitespace-nowrap active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="h-8 px-4 rounded-lg text-xs font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors duration-150 cursor-pointer whitespace-nowrap active:scale-95"
              >
                <i className="ri-send-plane-line mr-1.5"></i>
                Send Test
              </button>
            </div>
          </>
        )}

        {step === 'sending' && (
          <div className="p-10 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-primary-200 border-t-primary-500 mx-auto mb-4 animate-spin" />
            <p className="text-sm font-medium text-foreground-700">Sending test email...</p>
            <p className="text-xs text-foreground-500 mt-1">to {recipient}</p>
          </div>
        )}

        {step === 'sent' && (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-xl text-primary-500"></i>
            </div>
            <h4 className="text-sm font-semibold text-foreground-900 mb-1">Test Email Sent!</h4>
            <p className="text-xs text-foreground-500 mb-4">
              The test email was sent to <strong>{recipient}</strong>. Please check the inbox.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="h-8 px-4 rounded-lg text-xs font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors duration-150 cursor-pointer whitespace-nowrap active:scale-95"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
