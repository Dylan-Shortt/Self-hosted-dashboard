import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import { SqliteSessionStore } from './sqliteStore.js';

export interface SessionUser {
  id: number;
  login: string;
  avatarUrl: string;
}

export interface GithubUserTokens {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  accessTokenExpiresAt: number;
  refreshToken: string;
  /** Epoch ms when the refresh token expires. */
  refreshTokenExpiresAt: number;
}

declare module 'fastify' {
  interface Session {
    user?: SessionUser;
    githubTokens?: GithubUserTokens;
    /** One-time value that ties the OAuth callback to the login that started it. */
    oauthState?: string;
  }
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function registerSession(app: FastifyInstance, config: Config, db: Database): void {
  const store = new SqliteSessionStore(db);

  app.register(cookie);
  app.register(session, {
    secret: config.sessionSecret,
    cookieName: 'dashboard_sid',
    store,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    },
  });

  const purgeTimer = setInterval(() => store.purgeExpired(), 60 * 60 * 1000);
  purgeTimer.unref();
  app.addHook('onClose', async () => clearInterval(purgeTimer));
}
