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

function redactText(value, limit = 400) {
  return String(value || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|x-api-key|authorization)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[redacted]')
    .replace(/\bcmk_[a-z0-9]+\b/gi, '[redacted]')
    .slice(0, limit);
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

const DETAIL_LIMIT = 8000;
const REQUEST_BODY_KEYS = ['requestBody', 'request_body', 'body', 'reqBody', 'payload', 'mail_body', 'request'];
const RESPONSE_BODY_KEYS = ['responseBody', 'response_body', 'response', 'resBody', 'result'];

function asObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function detailText(value) {
  if (value == null || value === '') return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return redactText(raw, DETAIL_LIMIT);
}

function firstDetail(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    if (source[key] != null && source[key] !== '') return detailText(source[key]);
  }
  return '';
}

function traceId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text.split('/');
  return parts[parts.length - 1] || text;
}

function addressList(value) {
  if (value == null || value === '') return '';
  const list = Array.isArray(value) ? value : String(value).split(/[,;]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const email = String(item || '').trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out.join(', ');
}

function mapLogEntry(entry) {
  const http = entry?.httpRequest || {};
  const json = asObject(entry?.jsonPayload) || {};
  const textObject = asObject(entry?.textPayload) || {};
  const source = { ...textObject, ...json };
  const labels = entry?.resource?.labels || {};
  return {
    timestamp: entry?.timestamp || '',
    severity: entry?.severity || '',
    method: http.requestMethod || '',
    status: http.status == null ? null : Number(http.status),
    path: pathOnly(http.requestUrl),
    latency: http.latency || '',
    message: logMessage(entry),
    protocol: http.protocol || '',
    requestSize: http.requestSize == null ? '' : String(http.requestSize),
    responseSize: http.responseSize == null ? '' : String(http.responseSize),
    remoteIp: http.remoteIp || '',
    userAgent: redactText(http.userAgent || '', 300),
    revision: labels.revision_name || '',
    trace: traceId(entry?.trace),
    requestBody: firstDetail(source, REQUEST_BODY_KEYS),
    responseBody: firstDetail(source, RESPONSE_BODY_KEYS),
    mailFrom: addressList(source.from || source.displayFrom || source.mailFrom),
    mailTo: addressList(source.to),
    mailCc: addressList(source.cc),
    replyTo: addressList(source.replyTo || source.reply_to),
  };
}

function hasMailAddresses(row) {
  return Boolean(row?.mailFrom || row?.mailTo || row?.mailCc || row?.replyTo);
}

function isRequestRow(row) {
  return Boolean(row?.method || row?.path);
}

const MAIL_MATCH_MS = 45000;

function rowTime(row) {
  const value = Date.parse(row?.timestamp || '');
  return Number.isFinite(value) ? value : null;
}

function copyMail(target, extra) {
  return {
    ...target,
    mailFrom: target.mailFrom || extra.mailFrom || '',
    mailTo: target.mailTo || extra.mailTo || '',
    mailCc: target.mailCc || extra.mailCc || '',
    replyTo: target.replyTo || extra.replyTo || '',
  };
}

/** Fold a send log onto the HTTP row that shares its trace, or the closest call in time. */
function mergeMailOntoRequests(rows) {
  const byTrace = new Map();
  for (const row of rows) {
    if (!row.trace || !hasMailAddresses(row) || isRequestRow(row)) continue;
    const prev = byTrace.get(row.trace) || {};
    byTrace.set(row.trace, {
      mailFrom: prev.mailFrom || row.mailFrom || '',
      mailTo: prev.mailTo || row.mailTo || '',
      mailCc: prev.mailCc || row.mailCc || '',
      replyTo: prev.replyTo || row.replyTo || '',
    });
  }
  const traced = rows.map((row) => {
    if (!isRequestRow(row) || !row.trace) return row;
    const extra = byTrace.get(row.trace);
    return extra ? copyMail(row, extra) : row;
  });
  const consumedTraces = new Set(
    traced.filter((row) => isRequestRow(row) && row.trace && hasMailAddresses(row)).map((row) => row.trace),
  );
  const openRequests = traced
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isRequestRow(row) && !hasMailAddresses(row));
  const usedRequests = new Set();
  const hidden = new Set();
  traced.forEach((row, index) => {
    if (isRequestRow(row) || !hasMailAddresses(row)) return;
    if (row.trace && consumedTraces.has(row.trace)) {
      hidden.add(index);
      return;
    }
    const mailTime = rowTime(row);
    if (mailTime == null) return;
    let best = null;
    let bestDelta = MAIL_MATCH_MS + 1;
    for (const candidate of openRequests) {
      if (usedRequests.has(candidate.index)) continue;
      const requestTime = rowTime(candidate.row);
      if (requestTime == null) continue;
      const delta = Math.abs(mailTime - requestTime);
      if (delta <= MAIL_MATCH_MS && delta < bestDelta) {
        best = candidate.index;
        bestDelta = delta;
      }
    }
    if (best == null) return;
    usedRequests.add(best);
    hidden.add(index);
    traced[best] = copyMail(traced[best], row);
  });
  return traced.filter((row, index) => {
    if (hidden.has(index)) return false;
    if (!isRequestRow(row) && !hasMailAddresses(row)) return false;
    return true;
  }).slice(0, 40);
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
        '(httpRequest.requestUrl!="" OR jsonPayload.to:* OR jsonPayload.from:* OR jsonPayload.cc:* OR jsonPayload.replyTo:* OR textPayload:"comment-mail sent" OR textPayload:"comment-mail send failed")',
      ].join(' AND '),
      orderBy: 'timestamp desc',
      pageSize: 80,
    },
  });
  const entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
  return {
    service,
    logs: mergeMailOntoRequests(entries.map(mapLogEntry)),
  };
}

module.exports = {
  EXTERNAL_API_SERVICES,
  redactText,
  pathOnly,
  mapLogEntry,
  mergeMailOntoRequests,
  listExternalApiLogs,
};
