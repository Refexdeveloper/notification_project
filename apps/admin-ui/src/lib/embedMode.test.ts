import { describe, expect, it } from 'vitest';
import {
  buildAppOpenPath,
  defaultEmbedAppUrl,
  KISSFLOW_PM_VIEW_URL,
  resolveEmbedOpenUrl,
  shouldOpenPmInKissflow,
} from './embedMode';

describe('shouldOpenPmInKissflow', () => {
  it('opens Kissflow only from the embed dashboard', () => {
    expect(shouldOpenPmInKissflow(true, 'Project_Management_Tracker_A00', 'Project Management')).toBe(true);
    expect(shouldOpenPmInKissflow(true, 'production-Project_Management_Tracker_A00')).toBe(true);
    expect(KISSFLOW_PM_VIEW_URL).toBe(
      'https://refexgroup.kissflow.com/view/application/Project_Management_Tracker_A00',
    );
  });

  it('keeps the normal dashboard on the Notification Engine app page', () => {
    expect(shouldOpenPmInKissflow(false, 'Project_Management_Tracker_A00', 'Project Management')).toBe(false);
    expect(
      buildAppOpenPath({
        environment: 'production',
        applicationId: 'Project_Management_Tracker_A00',
        tab: 'dashboard',
        embed: false,
      }),
    ).toBe('/applications/production-Project_Management_Tracker_A00?tab=dashboard');
  });

  it('does not send other apps or sub-tasks to Kissflow', () => {
    expect(shouldOpenPmInKissflow(true, 'IT_Service_Management_A00', 'Tech Helpdesk')).toBe(false);
    expect(shouldOpenPmInKissflow(true, 'Project_Sub_Task_A01', 'Project Tasks')).toBe(false);
  });

  it('prefills Settings embed links and uses a stored URL when present', () => {
    expect(defaultEmbedAppUrl('Project_Management_Tracker_A00')).toBe(KISSFLOW_PM_VIEW_URL);
    expect(defaultEmbedAppUrl('IT_Service_Management_A00')).toContain(
      '/applications/production-IT_Service_Management_A00?tab=dashboard&embed=1',
    );
    expect(
      resolveEmbedOpenUrl({
        embed: true,
        applicationId: 'Lead_Trcaker_A00',
        storedUrl: 'https://example.com/lead',
      }),
    ).toBe('https://example.com/lead');
    expect(
      resolveEmbedOpenUrl({
        embed: false,
        applicationId: 'Project_Management_Tracker_A00',
        storedUrl: 'https://example.com/pm',
      }),
    ).toBeNull();
  });
});
