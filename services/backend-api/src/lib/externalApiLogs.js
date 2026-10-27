'use strict';

/** Cloud Run services that are public APIs for systems outside Notification Engine. */
const EXTERNAL_API_SERVICES = {
  'keyword-matching': 'keyword-matching-api',
  'comment-mail': 'refex-comment-mail',
  'policy-sender': 'policy-sender',
  'whatsapp-ingress': 'refex-wa-ingress',
  'maps-proxy': 'refex-google-maps-proxy',
  'bulk-bill-ocr': 'bulk-bill-ocr-ingress',
  'travel-ocr': 'travel-ocr-ingress',
  'unfyd-ocr': 'refex-unfyd-ocr-prod',
  'tally-voucher': 'refex-ems-tally-voucher-posting',
};

function redactText(value) {
  return String(value || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|x-api-key|authorization)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[redacted]')
    .replace(/\bcmk_[a-z0-9]+\b/gi, '[redacted]')
    .slice(0, 400);
}

function pathOnly(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).pathname || '/';
  } catch {
    return raw.split('?')[0];
  }
}

function logMessage(entry) {
  if (typeof entry?.textPayload === 'string' && entry.textPayload.trim()) {
    return redactText(entry.textPayload);
  }
  const json = entry?.jsonPayload;
  if (json && typeof json === 'object') {
    const message = json.message || json.msg || json.error || '';
    if (message) return redactText(message);
  }
  return '';
}

function mapLogEntry(entry) {
  const http = entry?.httpRequest || {};
  return {
    timestamp: entry?.timestamp || '',
    severity: entry?.severity || '',
    method: http.requestMethod || '',
    status: http.status == null ? null : Number(http.status),
    path: pathOnly(http.requestUrl),
    latency: http.latency || '',
    message: logMessage(entry),
  };
}

async function listExternalApiLogs(id) {
  const service = EXTERNAL_API_SERVICES[id];
  if (!service) {
    const err = new Error('Unknown external API');
    err.status = 404;
    throw err;
  }
  const project = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'master-diorama-489103-u2';
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/logging.read'] });
  const client = await auth.getClient();
  const res = await client.request({
    url: 'https://logging.googleapis.com/v2/entries:list',
    method: 'POST',
    data: {
      resourceNames: [`projects/${project}`],
      filter: [
        'resource.type="cloud_run_revision"',
        `resource.labels.service_name="${service}"`,
        'httpRequest.requestUrl!=""',
      ].join(' AND '),
      orderBy: 'timestamp desc',
      pageSize: 40,
    },
  });
  const entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
  return {
    service,
    logs: entries.map(mapLogEntry),
  };
}

module.exports = {
  EXTERNAL_API_SERVICES,
  redactText,
  pathOnly,
  mapLogEntry,
  listExternalApiLogs,
};
