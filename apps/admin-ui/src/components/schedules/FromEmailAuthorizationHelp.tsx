import { AlertCircle, CheckCircle2, Mail } from 'lucide-react';

interface FromEmailAuthorizationHelpProps {
  /** Shown next to guidance — e.g. reports@refex.co.in */
  fromEmail?: string;
  compact?: boolean;
}

export default function FromEmailAuthorizationHelp({
  fromEmail,
  compact = false,
}: FromEmailAuthorizationHelpProps) {
  const trimmed = fromEmail?.trim().toLowerCase();
  const hasFrom = Boolean(trimmed && trimmed.includes('@'));

  if (compact) {
    return (
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-[11px] text-amber-950 space-y-1">
        <p className="font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Google Workspace must authorize this sender
        </p>
        <p>
          The address here is only the <strong>From</strong> header. Gmail SMTP still checks the mailbox
          login configured in GCP Secret Manager. They must match, or the login must have{' '}
          <strong>Send mail as</strong> verified for this address.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200/80 bg-white flex items-start gap-2.5">
        <span className="icon-well shrink-0 mt-0.5">
          <Mail className="w-4 h-4" />
        </span>
        <div>
          <h4 className="text-sm font-semibold text-foreground-900">Sender authorization (required)</h4>
          <p className="text-xs text-foreground-500 mt-0.5">
            Scheduled reports use Gmail SMTP. You cannot send from an arbitrary address without Workspace
            approval.
          </p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 text-xs text-foreground-700">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-foreground-400 mb-1">
              What you set here
            </p>
            <p className="font-mono text-foreground-900 break-all">{hasFrom ? trimmed : 'reports@refex.co.in'}</p>
            <p className="text-[11px] text-foreground-500 mt-1">Visible to recipients as the From address</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-foreground-400 mb-1">
              What Gmail checks
            </p>
            <p className="font-mono text-foreground-900">SMTP login (Secret Manager)</p>
            <p className="text-[11px] text-foreground-500 mt-1">
              App password for the mailbox that is allowed to send
            </p>
          </div>
        </div>

        <div>
          <p className="font-semibold text-foreground-800 mb-1.5">Choose one setup (ask Google Workspace admin)</p>
          <ol className="list-decimal list-inside space-y-1.5 text-foreground-600">
            <li>
              <strong>Recommended:</strong> Create mailbox{' '}
              <code className="font-mono text-[11px]">reports@refex.co.in</code>, generate an app password,
              store it in GCP as <code className="font-mono text-[11px]">engagement-report-smtp-user</code> /
              <code className="font-mono text-[11px]">-app-password</code>, then use the same address here.
            </li>
            <li>
              <strong>Alias:</strong> Keep an existing user as SMTP login and add{' '}
              <code className="font-mono text-[11px]">reports@refex.co.in</code> under Gmail →{' '}
              <strong>Send mail as</strong> (verified).
            </li>
            <li>
              <strong>Quick test:</strong> Set From to the exact SMTP login mailbox until reports@ is
              authorized.
            </li>
          </ol>
        </div>

        <div className="rounded-lg border border-accent-200/70 bg-accent-50/60 px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-accent-700 shrink-0 mt-0.5" />
          <p className="text-[11px] text-accent-900">
            After setup, send a test with runbook 33 or activate the schedule and confirm the received email
            shows the correct From — not rewritten to a personal mailbox.
          </p>
        </div>
      </div>
    </div>
  );
}
