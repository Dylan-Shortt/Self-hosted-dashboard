import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GithubAuthError, GithubUnreachableError } from '../github/oauth.js';
import {
  cookieHeader,
  createTestApp,
  freshTokens,
  signIn,
  type FakeGithub,
} from '../test/helpers.js';

describe('requireGithubToken', () => {
  let app: FastifyInstance;
  let github: FakeGithub;

  beforeEach(() => {
    const created = createTestApp();
    app = created.app;
    github = created.github;
  });

  afterEach(async () => {
    await app.close();
  });

  /** Makes the next sign-in store an access token that has already expired. */
  function expireAccessToken(): void {
    github.loginTokens = { ...freshTokens(), accessTokenExpiresAt: Date.now() - 1000 };
  }

  function getProtected(cookie: string) {
    return app.inject({ url: '/test/protected', headers: { cookie } });
  }

  it('rejects a request with no session cookie', async () => {
    const res = await app.inject('/test/protected');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('uses the stored access token when it is still fresh', async () => {
    const cookie = await signIn(app);
    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'OLD-ACCESS' });
    expect(github.calls.refreshTokens).toEqual([]);
  });

  it('refreshes an expired access token and uses the new one', async () => {
    expireAccessToken();
    const cookie = await signIn(app);
    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'NEW-ACCESS' });
    expect(github.calls.refreshTokens).toEqual(['OLD-REFRESH']);
  });

  it('keeps the renewed token in the session for later requests', async () => {
    expireAccessToken();
    const cookie = await signIn(app);

    const first = await getProtected(cookie);
    expect(first.json()).toEqual({ token: 'NEW-ACCESS' });

    // Use any cookie the refresh response set, otherwise the one from sign-in.
    const latestCookie = first.cookies.length > 0 ? cookieHeader(first) : cookie;
    const second = await getProtected(latestCookie);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ token: 'NEW-ACCESS' });
    expect(github.calls.refreshTokens).toEqual(['OLD-REFRESH']);
  });

  it('refreshes when the access token expires within the 60 second skew window', async () => {
    github.loginTokens = { ...freshTokens(), accessTokenExpiresAt: Date.now() + 30_000 };
    const cookie = await signIn(app);
    const res = await getProtected(cookie);
    expect(res.json()).toEqual({ token: 'NEW-ACCESS' });
    expect(github.calls.refreshTokens).toEqual(['OLD-REFRESH']);
  });

  it('does not refresh when the access token expires after the skew window', async () => {
    github.loginTokens = { ...freshTokens(), accessTokenExpiresAt: Date.now() + 120_000 };
    const cookie = await signIn(app);
    const res = await getProtected(cookie);
    expect(res.json()).toEqual({ token: 'OLD-ACCESS' });
    expect(github.calls.refreshTokens).toEqual([]);
  });

  it('never refreshes a token that has no expiry and returns it as is', async () => {
    github.loginTokens = { accessToken: 'OLD-ACCESS' };
    const cookie = await signIn(app);
    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'OLD-ACCESS' });
    expect(github.calls.refreshTokens).toEqual([]);
  });

  it('shares one refresh call between parallel requests', async () => {
    // Refresh tokens are single-use, so a second use of the same token must fail.
    const spent = new Set<string>();
    github.refreshTokens = async (refreshToken) => {
      github.calls.refreshTokens.push(refreshToken);
      if (spent.has(refreshToken)) throw new GithubAuthError('refresh token already used');
      spent.add(refreshToken);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return github.renewed;
    };

    expireAccessToken();
    const cookie = await signIn(app);
    const responses = await Promise.all(Array.from({ length: 5 }, () => getProtected(cookie)));

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ token: 'NEW-ACCESS' });
    }
    expect(github.calls.refreshTokens).toEqual(['OLD-REFRESH']);
  });

  it('ends the session when GitHub rejects the refresh token', async () => {
    expireAccessToken();
    github.refreshTokens = async () => {
      throw new GithubAuthError('bad_refresh_token');
    };
    const cookie = await signIn(app);

    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'session_expired' });

    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('ends the session without calling GitHub when the refresh token has expired', async () => {
    github.loginTokens = {
      ...freshTokens(),
      accessTokenExpiresAt: Date.now() - 1000,
      refreshTokenExpiresAt: Date.now() - 1000,
    };
    const cookie = await signIn(app);

    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'session_expired' });
    expect(github.calls.refreshTokens).toEqual([]);
  });

  it('ends the session without calling GitHub when there is no refresh token', async () => {
    github.loginTokens = { accessToken: 'OLD-ACCESS', accessTokenExpiresAt: Date.now() - 1000 };
    const cookie = await signIn(app);

    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'session_expired' });
    expect(github.calls.refreshTokens).toEqual([]);
  });

  it('returns 503 and keeps the session when GitHub is unreachable', async () => {
    expireAccessToken();
    github.refreshTokens = async () => {
      throw new GithubUnreachableError('down');
    };
    const cookie = await signIn(app);

    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'github_unreachable' });

    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { login: 'octocat' } });
  });

  it('returns 500 for an unexpected error during refresh', async () => {
    expireAccessToken();
    github.refreshTokens = async () => {
      throw new Error('boom');
    };
    const cookie = await signIn(app);

    const res = await getProtected(cookie);
    expect(res.statusCode).toBe(500);
  });
});
