import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PROXY_PREFIX = '/api/kissflow-proxy';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Dev/preview proxy so the browser can call Kissflow without CORS.
 * Frontend calls: /api/kissflow-proxy/{service}/2/...
 * with header X-Kissflow-Host: https://{subdomain}.kissflow.com
 */
export function kissflowProxyPlugin(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(PROXY_PREFIX)) {
      next();
      return;
    }

    const hostHeader = req.headers['x-kissflow-host'];
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

    if (!host || !/^https:\/\/[a-z0-9.-]+\.kissflow\.(com|eu)$/i.test(host)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Invalid or missing X-Kissflow-Host. Expected https://{subdomain}.kissflow.com|eu',
        }),
      );
      return;
    }

    const pathAndQuery = req.url.slice(PROXY_PREFIX.length) || '/';
    const targetUrl = `${host.replace(/\/$/, '')}${pathAndQuery}`;

    try {
      const method = (req.method || 'GET').toUpperCase();
      const forwardHeaders: Record<string, string> = {
        Accept: (req.headers['accept'] as string) || 'application/json',
      };

      const keyId = req.headers['x-access-key-id'];
      const keySecret = req.headers['x-access-key-secret'];
      if (typeof keyId === 'string') forwardHeaders['X-Access-Key-Id'] = keyId;
      if (typeof keySecret === 'string') forwardHeaders['X-Access-Key-Secret'] = keySecret;

      const contentType = req.headers['content-type'];
      if (typeof contentType === 'string') forwardHeaders['Content-Type'] = contentType;

      let body: Buffer | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        body = await readBody(req);
      }

      const upstream = await fetch(targetUrl, {
        method,
        headers: forwardHeaders,
        body: body && body.length > 0 ? body : undefined,
      });

      const responseText = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.setHeader('X-Proxy-Target', targetUrl);
      res.end(responseText);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Kissflow proxy request failed',
          message: err instanceof Error ? err.message : String(err),
          target: targetUrl,
        }),
      );
    }
  };

  return {
    name: 'kissflow-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
