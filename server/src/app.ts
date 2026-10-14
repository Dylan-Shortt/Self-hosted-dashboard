import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { openDatabase } from './db.js';
import { healthRoutes } from './routes/health.js';
import { registerSession } from './session/register.js';

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
  });

  const db = openDatabase(config.databasePath);
  app.addHook('onClose', async () => db.close());

  registerSession(app, config, db);
  app.register(healthRoutes);

  return app;
}
