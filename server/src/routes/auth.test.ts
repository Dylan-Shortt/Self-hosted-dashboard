import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GithubAuthError, GithubUnreachableError } from '../github/oauth.js';
import {
  cookieHeader,
  createTestApp,
  finishLogin,
  signIn,
  startLogin,
  type FakeGithub,
} from '../test/helpers.js';

type TestApp = ReturnType<typeof createTestApp>['app'];

let app: TestApp;
let github: FakeGithub;

beforeEach(() => {
  ({ app, github } = createTestApp());
});

afterEach(async () => {
  await app.close();
});

const authError = (reason: string) => `http://localhost:5173/?auth_error=${reason}`;

function me(cookie: string) {
  return app.inject({ url: '/api/auth/me', headers: { cookie } });
}

describe('login', () => {
  it('redirects to GitHub and sets an HttpOnly, SameSite=Lax cookie without Secure', async () => {
    const res = await app.inject('/api/auth/login');

    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toMatch(/^https:\/\/github\.test\/authorize\?state=/);

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^dashboard_sid=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/);
  });

  it('reports unauthenticated on /me before signing in', async () => {
    const res = await app.inject('/api/auth/me');

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });
});

describe('callback', () => {
  it('signs the user in and exposes the session user on /me', async () => {
    const cookie = await signIn(app);

    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { id: 1, login: 'octocat', avatarUrl: 'https://example.test/a.png' },
    });
    expect(github.calls.exchangeCode).toEqual(['abc']);
    expect(github.calls.fetchUser).toEqual(['OLD-ACCESS']);
  });

  it('rejects a callback whose state does not match', async () => {
    const started = await startLogin(app);

    const res = await app.inject({
      url: '/api/auth/callback?code=abc&state=wrong',
      headers: { cookie: started.cookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(authError('invalid_state'));
    expect((await me(started.cookie)).statusCode).toBe(401);
  });

  it('rejects a callback with no session cookie', async () => {
    const res = await app.inject('/api/auth/callback?code=abc&state=anything');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(authError('invalid_request'));
  });

  it('rejects a callback that has the cookie but no state parameter', async () => {
    const started = await startLogin(app);

    const res = await app.inject({
      url: '/api/auth/callback?code=abc',
      headers: { cookie: started.cookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(authError('invalid_request'));
    expect((await me(started.cookie)).statusCode).toBe(401);
  });

  it('reports denied when GitHub returns an error instead of a code', async () => {
    const started = await startLogin(app);

    const res = await app.inject({
      url: `/api/auth/callback?error=access_denied&state=${encodeURIComponent(started.state)}`,
      headers: { cookie: started.cookie },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(authError('denied'));
    expect((await me(started.cookie)).statusCode).toBe(401);
    expect(github.calls.exchangeCode).toEqual([]);
  });

  it('does not sign in twice when the callback is replayed with the pre-login cookie', async () => {
    const started = await startLogin(app);
    const first = await finishLogin(app, started.cookie, started.state);
    expect(first.res.headers.location).toBe('http://localhost:5173/');

    const replay = await finishLogin(app, started.cookie, started.state);
    expect(replay.res.statusCode).toBe(302);
    expect(String(replay.res.headers.location)).toMatch(/auth_error=/);
    expect((await me(started.cookie)).statusCode).toBe(401);
    expect(github.calls.exchangeCode).toHaveLength(1);
  });

  it('rejects a GitHub user who is not on the allowlist', async () => {
    github.user = { id: 2, login: 'stranger', avatarUrl: 'https://example.test/s.png' };
    const started = await startLogin(app);

    const finished = await finishLogin(app, started.cookie, started.state);

    expect(finished.res.statusCode).toBe(302);
    expect(finished.res.headers.location).toBe(authError('not_allowed'));
    expect((await me(finished.cookie)).statusCode).toBe(401);
  });

  it('matches the allowlist case-insensitively', async () => {
    github.user = { id: 1, login: 'OctoCat', avatarUrl: 'https://example.test/a.png' };

    const cookie = await signIn(app);

    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { login: 'OctoCat' } });
  });

  it('reports github_error when the code exchange is rejected by GitHub', async () => {
    github.exchangeCode = async () => {
      throw new GithubAuthError('x');
    };
    const started = await startLogin(app);

    const finished = await finishLogin(app, started.cookie, started.state);

    expect(finished.res.headers.location).toBe(authError('github_error'));
    expect((await me(finished.cookie)).statusCode).toBe(401);
  });

  it('reports github_error when GitHub cannot be reached for the user lookup', async () => {
    github.fetchUser = async () => {
      throw new GithubUnreachableError('x');
    };
    const started = await startLogin(app);

    const finished = await finishLogin(app, started.cookie, started.state);

    expect(finished.res.headers.location).toBe(authError('github_error'));
    expect((await me(finished.cookie)).statusCode).toBe(401);
  });

  it('does not swallow unexpected errors and returns 500', async () => {
    github.exchangeCode = async () => {
      throw new Error('boom');
    };
    const started = await startLogin(app);

    const finished = await finishLogin(app, started.cookie, started.state);

    expect(finished.res.statusCode).toBe(500);
  });

  it('issues a new session id on sign-in so the pre-login cookie is not reused', async () => {
    const started = await startLogin(app);

    const finished = await finishLogin(app, started.cookie, started.state);

    expect(finished.cookie).not.toBe(started.cookie);
    expect(finished.cookie).toMatch(/^dashboard_sid=/);
  });
});

describe('session', () => {
  it('ends the session on logout so the same cookie no longer authenticates', async () => {
    const cookie = await signIn(app);
    expect((await me(cookie)).statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const after = await me(cookie);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: 'unauthenticated' });
  });

  it('returns only the user object from /me, with exactly id, login and avatarUrl', async () => {
    const cookie = await signIn(app);

    const res = await me(cookie);
    const body = res.json() as { user: Record<string, unknown> };

    expect(Object.keys(body)).toEqual(['user']);
    expect(Object.keys(body.user).sort()).toEqual(['avatarUrl', 'id', 'login']);
  });

  it('never exposes GitHub tokens in any response body or header', async () => {
    const responses: LightMyRequestResponse[] = [];

    const started = await startLogin(app);
    responses.push(started.res);
    const finished = await finishLogin(app, started.cookie, started.state);
    responses.push(finished.res);
    const cookie = cookieHeader(finished.res);

    responses.push(await me(cookie));
    responses.push(
      await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } }),
    );

    const dump = JSON.stringify(responses.map((r) => ({ body: r.body, headers: r.headers })));
    expect(dump).not.toContain('OLD-ACCESS');
    expect(dump).not.toContain('OLD-REFRESH');
  });
});
