import { useState, useMemo } from 'react';
import { notificationVariables } from '@/mocks/dataforms';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

const deviceWidths: Record<PreviewDevice, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export default function LivePreview() {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [subject] = useState('{{Employee Name}} - Onboarding Notification');

  const previewContent = `
    <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff;">
      <div style="border-bottom: 2px solid #2563EB; padding-bottom: 16px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 600; color: #111827;">Welcome to the Team, {{Employee Name}}!</h2>
        <p style="margin: 0; font-size: 13px; color: #6B7280;">Employee Onboarding &bull; Notification Engine</p>
      </div>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 16px;">
        We are excited to have you join <strong style="color: #111827;">{{Department}}</strong> as our new <strong style="color: #111827;">{{Job Title}}</strong>.
      </p>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin-bottom: 16px;">
        Your start date is <strong style="color: #111827;">{{Start Date}}</strong> and your reporting manager will be <strong style="color: #111827;">{{Reporting Manager}}</strong>.
      </p>

      <div style="background: #F3F4F6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #111827;">Key Information</h4>
        <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #6B7280; width: 130px;">Employee Name</td>
            <td style="padding: 6px 0; color: #111827; font-weight: 500;">{{Employee Name}}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6B7280;">Department</td>
            <td style="padding: 6px 0; color: #111827; font-weight: 500;">{{Department}}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6B7280;">Start Date</td>
            <td style="padding: 6px 0; color: #111827; font-weight: 500;">{{Start Date}}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6B7280;">Office Location</td>
            <td style="padding: 6px 0; color: #111827; font-weight: 500;">{{Office Location}}</td>
          </tr>
        </table>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="#" style="display: inline-block; background: #2563EB; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500;">
          Complete Your Onboarding
        </a>
      </div>

      <div style="border-top: 1px solid #E5E7EB; margin: 20px 0;"></div>

      <p style="font-size: 12px; color: #6B7280; line-height: 1.5; margin-bottom: 6px;">
        This is an automated notification from the Employee Onboarding system.
      </p>
      <p style="font-size: 12px; color: #6B7280; line-height: 1.5;">
        If you have any questions, please contact <a href="#" style="color: #2563EB;">{{HR Business Partner}}</a>.
      </p>
    </div>
  `;

  const processedPreview = useMemo(() => {
    let html = previewContent;
    notificationVariables.forEach((v) => {
      const escaped = v.variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(
        new RegExp(escaped, 'g'),
        '<span style="background: #EFF6FF; color: #2563EB; padding: 1px 4px; border-radius: 3px; font-weight: 500;">' + v.variable + '</span>'
      );
    });
    return html;
  }, [previewContent]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-background-200/70 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground-900">Live Preview</h3>
          <div className="flex items-center bg-background-100 rounded-md p-0.5">
            <button
              onClick={() => setDevice('desktop')}
              className="w-7 h-7 flex items-center justify-center rounded transition-all cursor-pointer bg-white text-foreground-900 shadow-sm"
              title="Desktop"
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                <i className="ri-computer-line text-xs"></i>
              </span>
            </button>
            <button
              onClick={() => setDevice('tablet')}
              className="w-7 h-7 flex items-center justify-center rounded transition-all cursor-pointer text-foreground-400 hover:text-foreground-600"
              title="Tablet"
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                <i className="ri-tablet-line text-xs"></i>
              </span>
            </button>
            <button
              onClick={() => setDevice('mobile')}
              className="w-7 h-7 flex items-center justify-center rounded transition-all cursor-pointer text-foreground-400 hover:text-foreground-600"
              title="Mobile"
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center">
                <i className="ri-smartphone-line text-xs"></i>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-background-50 p-4 flex items-start justify-center">
        <div
          style={{ width: deviceWidths[device], maxWidth: '100%' }}
          className="transition-all duration-300"
        >
          <div className="bg-white rounded-lg border border-background-300/60 overflow-hidden shadow-sm">
            <div className="bg-background-50 px-4 py-3 border-b border-background-200/70">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-foreground-500 font-medium">From:</span>
                <span className="text-xs text-foreground-700">notifications@enterprise.com</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-foreground-500 font-medium">To:</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 text-xs">
                  {'{{Reporting Manager}}'}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 text-xs">
                  {'{{HR Business Partner}}'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground-500 font-medium">Subject:</span>
                <span className="text-xs text-foreground-900 font-medium">{subject}</span>
              </div>
            </div>

            <div
              className="p-0"
              dangerouslySetInnerHTML={{ __html: processedPreview }}
            />

            <div className="bg-background-50 px-4 py-2 border-t border-background-200/70 flex items-center gap-3">
              <span className="text-[10px] text-foreground-400">Sent via Notification Engine</span>
              <span className="text-[10px] text-foreground-300">|</span>
              <span className="text-[10px] text-foreground-400">Powered by Kissflow</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}