import { describe, expect, it } from 'vitest';
import {
  applyTemplateVariables,
  buildPreviewSampleData,
  detectTemplateAppKind,
  renderPreviewHtml,
} from './templatePreview';

describe('templatePreview', () => {
  it('uses template name for ReportTitle in preview context', () => {
    const html = '<h1>{{ReportTitle}}</h1>';
    const out = renderPreviewHtml(html, {
      templateName: 'My Custom PM Report',
      kissflowAppId: 'Project_Management_Tracker_A00',
    });
    expect(out).toContain('My Custom PM Report');
    expect(out).not.toContain('{{ReportTitle}}');
  });

  it('does not force PM title when HTML uses a literal title', () => {
    const html = '<h1>Weekly Task Digest</h1><p>{{TotalTasks}} tasks</p>';
    const out = renderPreviewHtml(html, {
      templateName: 'Ignored When Literal',
      kissflowAppId: 'Project_Management_Tracker_A00',
    });
    expect(out).toContain('Weekly Task Digest');
    expect(out).not.toContain('Ignored When Literal');
    expect(out).toContain('240');
  });

  it('updates preview when HTML title placeholder changes', () => {
    const first = renderPreviewHtml('<title>{{ReportTitle}}</title>', {
      templateName: 'Alpha Report',
      kissflowAppId: 'IT_Service_Management_A00',
    });
    const second = renderPreviewHtml('<title>{{ReportTitle}}</title>', {
      templateName: 'Beta Report',
      kissflowAppId: 'IT_Service_Management_A00',
    });
    expect(first).toContain('Alpha Report');
    expect(second).toContain('Beta Report');
  });

  it('replaces legacy refex logo in preview', () => {
    const html = '<img src="https://example.com/refex-logo.png" alt="Refex">';
    const out = applyTemplateVariables(html, {});
    expect(out).toContain('refexone-logo.png');
    expect(out).toContain('alt="refexOne"');
  });

  it('merges scheduler overrides on legacy call shape', () => {
    const html = '{{ReportTitle}} — {{OpenTickets}} open';
    const out = renderPreviewHtml(html, {
      ReportTitle: 'Scheduler Name',
      OpenTickets: '12',
    });
    expect(out).toBe('Scheduler Name — 12 open');
  });

  it('detects app kind from kissflow id', () => {
    expect(detectTemplateAppKind({ kissflowAppId: 'Project_Management_Tracker_A00' })).toBe('pm');
    expect(detectTemplateAppKind({ kissflowAppId: 'IT_Service_Management_A00' })).toBe('itsm');
    expect(detectTemplateAppKind({ kissflowAppId: 'Lead_Trcaker_A00' })).toBe('lead');
    expect(detectTemplateAppKind({ kissflowAppId: 'EMS_001_A00' })).toBe('expense');
    expect(detectTemplateAppKind({ kissflowAppId: 'Expense_and_Travel_Management_A00' })).toBe('travel');
  });

  it('uses PM sample table for PM apps', () => {
    const samples = buildPreviewSampleData({ kissflowAppId: 'Project_Management_Tracker_A00' });
    expect(samples.UserTableHtml).toContain('Priya Sharma');
    expect(samples.TotalUsers).toBe('2');
    expect(samples.SignedInToday).toBe('1');
  });

  it('matches ITSM preview Total Users to the sample MIS table', () => {
    const samples = buildPreviewSampleData({ kissflowAppId: 'IT_Service_Management_A00' });
    const rows = (samples.UserTableHtml.match(/<tr\b/g) || []).length;
    expect(samples.TotalUsers).toBe(String(rows));
    expect(samples.SignedInToday).toBe('1');
  });
});
