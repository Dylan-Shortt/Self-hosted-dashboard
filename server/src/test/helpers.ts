import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import type { GithubOAuthClient } from '../github/oauth.js';
import type { GithubUserTokens, SessionUser } from '../session/register.js';

const HOUR = 60 * 60 * 1000;

/** A valid config built from fake values. Never reads the real .env. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    SESSION_SECRET: 'x'.repeat(40),
    DATABASE_PATH: ':memory:',
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:5173',
    GITHUB_APP_ID: '1',
    GITHUB_APP_CLIENT_ID: 'cid',
    GITHUB_APP_CLIENT_SECRET: 'csecret',
    GITHUB_APP_PRIVATE_KEY_PATH: 'k.pem',
    ALLOWED_GITHUB_USERS: 'octocat',
    ...overrides,
  });
}

export function freshTokens(): GithubUserTokens {
  return {
    accessToken: 'OLD-ACCESS',
    accessTokenExpiresAt: Date.now() + HOUR,
    refreshToken: 'OLD-REFRESH',
    refreshTokenExpiresAt: Date.now() + 24 * HOUR,
  };
}

export function renewedTokens(): GithubUserTokens {
  return {
    accessToken: 'NEW-ACCESS',
    accessTokenExpiresAt: Date.now() + HOUR,
    refreshToken: 'NEW-REFRESH',
    refreshTokenExpiresAt: Date.now() + 24 * HOUR,
  };
}

/**
 * A GitHub client that never touches the network. Tests change behaviour by reassigning
 * its fields, e.g. `github.user = {...}`, `github.loginTokens = {...}`, or by replacing a
 * method: `github.refreshTokens = async () => { throw new GithubAuthError('x') }`.
 */
export interface FakeGithub extends GithubOAuthClient {
  /** Arguments of every call, in order. */
  calls: { exchangeCode: string[]; refreshTokens: string[]; fetchUser: string[] };
  /** What exchangeCode resolves with (the tokens a user gets at sign-in). */
  loginTokens: GithubUserTokens;
  /** What fetchUser resolves with. */
  user: SessionUser;
  /** What refreshTokens resolves with. */
  renewed: GithubUserTokens;
}

export function createFakeGithub(): FakeGithub {
  const fake: FakeGithub = {
    calls: { exchangeCode: [], refreshTokens: [], fetchUser: [] },
    loginTokens: freshTokens(),
    user: { id: 1, login: 'octocat', avatarUrl: 'https://example.test/a.png' },
    renewed: renewedTokens(),
    buildAuthorizeUrl: (state) => `https://github.test/authorize?state=${state}`,
    async exchangeCode(code) {
      fake.calls.exchangeCode.push(code);
      return fake.loginTokens;
    },
    async refreshTokens(refreshToken) {
      fake.calls.refreshTokens.push(refreshToken);
      return fake.renewed;
    },
    async fetchUser(accessToken) {
      fake.calls.fetchUser.push(accessToken);
      return fake.user;
    },
  };
  return fake;
}

/**
 * Builds the real app around a fake GitHub client, plus a GET /test/protected route guarded
 * by app.requireGithubToken that returns { token } so tests can see which token was used.
 * The caller must `await app.close()` when done (use afterEach).
 */
export function createTestApp(options: { config?: Config; github?: FakeGithub } = {}) {
  const github = options.github ?? createFakeGithub();
  const app = buildApp(options.config ?? testConfig(), { github });
  app.get('/test/protected', { preHandler: app.requireGithubToken }, async (request) => ({
    token: request.githubToken,
  }));
  return { app, github };
}

/** The Cookie request header for the cookies set by a response ('' if it set none). */
export function cookieHeader(res: LightMyRequestResponse): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Starts a login and returns the session cookie and the OAuth state the server issued. */
export async function startLogin(app: FastifyInstance) {
  const res = await app.inject('/api/auth/login');
  const location = new URL(String(res.headers.location));
  return { res, cookie: cookieHeader(res), state: location.searchParams.get('state') ?? '' };
}

/** Completes the OAuth callback and returns the callback response and the resulting cookie. */
export async function finishLogin(app: FastifyInstance, cookie: string, state: string) {
  const res = await app.inject({
    url: `/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    headers: { cookie },
  });
  return { res, cookie: cookieHeader(res) };
}

/** Full sign-in through the real routes. Returns the signed-in session cookie. */
export async function signIn(app: FastifyInstance): Promise<string> {
  const started = await startLogin(app);
  const finished = await finishLogin(app, started.cookie, started.state);
  expect(finished.res.statusCode).toBe(302);
  expect(finished.res.headers.location).toBe('http://localhost:5173/');
  return finished.cookie;
}
