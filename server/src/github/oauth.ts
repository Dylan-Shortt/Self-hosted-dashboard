import { z } from 'zod';
import type { Config } from '../config.js';
import type { GithubUserTokens, SessionUser } from '../session/register.js';

export class GithubAuthError extends Error {}

/** GitHub could not be reached at all. Transient, so callers should not end the session. */
export class GithubUnreachableError extends GithubAuthError {}

export interface GithubOAuthClient {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<GithubUserTokens>;
  /** Refresh tokens are single-use: a successful call invalidates the one passed in. */
  refreshTokens(refreshToken: string): Promise<GithubUserTokens>;
  fetchUser(accessToken: string): Promise<SessionUser>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  error: z.string().optional(),
});

const userSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string(),
});

/**
 * Turns GitHub's token endpoint response into our token shape.
 * GitHub reports failures with HTTP 200 and an `error` field, so both are handled here.
 * The same response shape is used for the code exchange and for refreshing.
 */
export function parseTokenResponse(raw: unknown, now = Date.now()): GithubUserTokens {
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GithubUnreachableError('Unexpected token response from GitHub');
  }
  const body = parsed.data;
  if (body.error || !body.access_token) {
    throw new GithubAuthError(`GitHub rejected the token request: ${body.error ?? 'no token'}`);
  }

  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: body.expires_in === undefined ? undefined : now + body.expires_in * 1000,
    refreshToken: body.refresh_token,
    refreshTokenExpiresAt:
      body.refresh_token_expires_in === undefined
        ? undefined
        : now + body.refresh_token_expires_in * 1000,
  };
}

export function createGithubOAuthClient(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): GithubOAuthClient {
  const { clientId, clientSecret } = config.github;
  const redirectUri = `${config.appUrl}/api/auth/callback`;

  /** Network failures (DNS, timeout, connection reset) become a GithubUnreachableError. */
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new GithubUnreachableError(`Could not reach GitHub: ${(err as Error).message}`);
    }
  };

  /** A GitHub outage or rate limit is transient. Any other failure status is a rejection. */
  const failedStatus = (what: string, res: Response): GithubAuthError => {
    const message = `${what} failed: HTTP ${res.status}`;
    return res.status >= 500 || res.status === 429
      ? new GithubUnreachableError(message)
      : new GithubAuthError(message);
  };

  /** A body that is not JSON (e.g. an HTML error page from a proxy) is treated as an outage. */
  const readJson = async (res: Response): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      throw new GithubUnreachableError('GitHub returned a response that is not JSON');
    }
  };

  return {
    buildAuthorizeUrl(state) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
      }).toString();
      return url.toString();
    },

    async exchangeCode(code) {
      const res = await send('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw failedStatus('Token exchange', res);
      return parseTokenResponse(await readJson(res));
    },

    async refreshTokens(refreshToken) {
      const res = await send('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) throw failedStatus('Token refresh', res);
      return parseTokenResponse(await readJson(res));
    },

    async fetchUser(accessToken) {
      const res = await send('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'self-hosted-dashboard',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) throw failedStatus('Fetching the user', res);
      const parsed = userSchema.safeParse(await readJson(res));
      if (!parsed.success) throw new GithubUnreachableError('Unexpected user response from GitHub');
      const user = parsed.data;
      return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
    },
  };
}
