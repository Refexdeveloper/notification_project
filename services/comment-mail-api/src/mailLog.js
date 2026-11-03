'use strict';

/** Structured Cloud Logging line so From, To, Cc, and Reply-To stay on the request trace. */
function buildMailLog(req, parsed, message, severity = 'INFO') {
  const project = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'master-diorama-489103-u2').trim();
  const header = String(
    (req && typeof req.get === 'function' && req.get('x-cloud-trace-context'))
    || req?.headers?.['x-cloud-trace-context']
    || '',
  ).trim();
  const traceId = header.split('/')[0].trim();
  const entry = {
    severity,
    message,
    from: parsed?.displayFrom || '',
    to: Array.isArray(parsed?.to) ? parsed.to : [],
    cc: Array.isArray(parsed?.cc) ? parsed.cc : [],
    replyTo: parsed?.replyTo || '',
  };
  if (traceId && project) {
    entry['logging.googleapis.com/trace'] = `projects/${project}/traces/${traceId}`;
  }
  return entry;
}

module.exports = { buildMailLog };
