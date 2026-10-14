import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
  });

  app.register(healthRoutes);

  return app;
}
