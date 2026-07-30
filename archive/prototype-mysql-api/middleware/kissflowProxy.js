const http = require('http');
const https = require('https');

const PROXY_PREFIX = '/api/kissflow-proxy';

function forwardRequest(targetUrl, req, res) {
  const url = new URL(targetUrl);
  const lib = url.protocol === 'https:' ? https : http;

  const forwardHeaders = {
    Accept: req.headers.accept || 'application/json',
  };
  if (req.headers['x-access-key-id']) {
    forwardHeaders['X-Access-Key-Id'] = String(req.headers['x-access-key-id']);
  }
  if (req.headers['x-access-key-secret']) {
    forwardHeaders['X-Access-Key-Secret'] = String(req.headers['x-access-key-secret']);
  }
  if (req.headers['content-type']) {
    forwardHeaders['Content-Type'] = String(req.headers['content-type']);
  }

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: req.method,
    headers: forwardHeaders,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    res.setHeader('X-Proxy-Target', targetUrl);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({
      error: 'Kissflow proxy request failed',
      message: err.message,
      target: targetUrl,
    });
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

/** Express middleware — same contract as Vite kissflow-proxy plugin. */
function kissflowProxyMiddleware(req, res, next) {
  const rawPath = req.originalUrl || req.url || '';
  if (!rawPath.startsWith(PROXY_PREFIX)) {
    next();
    return;
  }

  const hostHeader = req.headers['x-kissflow-host'];
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host || !/^https:\/\/[a-z0-9.-]+\.kissflow\.(com|eu)$/i.test(host)) {
    res.status(400).json({
      error: 'Invalid or missing X-Kissflow-Host. Expected https://{subdomain}.kissflow.com|eu',
    });
    return;
  }

  const pathAndQuery = rawPath.slice(PROXY_PREFIX.length) || '/';
  const targetUrl = `${host.replace(/\/$/, '')}${pathAndQuery}`;
  forwardRequest(targetUrl, req, res);
}

module.exports = { kissflowProxyMiddleware, PROXY_PREFIX };
