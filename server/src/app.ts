import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { openDatabase } from './db.js';
import { createGithubOAuthClient, type GithubOAuthClient } from './github/oauth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { registerSession } from './session/register.js';

export interface AppDependencies {
  /** Replace the GitHub client, e.g. with a fake in tests. */
  github?: GithubOAuthClient;
}

export function buildApp(config: Config, deps: AppDependencies = {}): FastifyInstance {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
  });

  const db = openDatabase(config.databasePath);
  app.addHook('onClose', async () => db.close());

  registerSession(app, config, db);
  app.register(healthRoutes);
  app.register(authRoutes, {
    config,
    github: deps.github ?? createGithubOAuthClient(config),
  });

  return app;
}
