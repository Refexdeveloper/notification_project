import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get('/health', async () => ({
  ok: true,
  service: 'notification-engine-server',
  time: new Date().toISOString(),
}));

app.get('/api', async () => ({
  name: 'Notification Engine API',
  version: '0.1.0',
  message: 'Backend scaffold ready. Wire Kissflow proxy and persistence here next.',
}));

try {
  await app.listen({ port, host });
  app.log.info(`Server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
