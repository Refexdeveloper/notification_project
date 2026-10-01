'use strict';

/** Main Lead Tracker Kissflow app + Venwind sales process folded into it. */
const LEAD_APP_ID = 'Lead_Trcaker_A00';
const LEAD_PROCESS_ID = 'Lead_tracker_1_A00';
const LEAD_VENWIND_APP_ID = 'Vindview_Sales_Management_A00';
const LEAD_VENWIND_PROCESS_ID = 'Vindview_Sales_Management_A00';

function isHiddenNeApplication(applicationId, applicationName) {
  const hay = `${applicationId || ''} ${applicationName || ''}`.toLowerCase();
  return hay.includes('vindview') || /lead\s*tracker\s*venwind/i.test(String(applicationName || ''));
}

function extraProcessIdsForApplication(applicationId) {
  if (String(applicationId || '') === LEAD_APP_ID) return [LEAD_VENWIND_PROCESS_ID];
  return [];
}

function mergeProcessIds(applicationId, processIds) {
  const seen = new Set();
  const out = [];
  for (const id of [...(processIds || []), ...extraProcessIdsForApplication(applicationId)]) {
    const pid = String(id || '').trim();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
  }
  return out;
}

function isVenwindLeadProcess(processId) {
  return String(processId || '').toLowerCase().includes('vindview');
}

module.exports = {
  LEAD_APP_ID,
  LEAD_PROCESS_ID,
  LEAD_VENWIND_APP_ID,
  LEAD_VENWIND_PROCESS_ID,
  isHiddenNeApplication,
  extraProcessIdsForApplication,
  mergeProcessIds,
  isVenwindLeadProcess,
};
