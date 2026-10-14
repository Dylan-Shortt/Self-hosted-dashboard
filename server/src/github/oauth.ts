import { z } from 'zod';
import type { Config } from '../config.js';
import type { GithubUserTokens, SessionUser } from '../session/register.js';

export class GithubAuthError extends Error {}

export interface GithubOAuthClient {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<GithubUserTokens>;
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
  const body = tokenResponseSchema.parse(raw);
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

  /** Network failures (DNS, timeout, connection reset) become a GithubAuthError. */
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new GithubAuthError(`Could not reach GitHub: ${(err as Error).message}`);
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
      if (!res.ok) throw new GithubAuthError(`Token exchange failed: HTTP ${res.status}`);
      return parseTokenResponse(await res.json());
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
      if (!res.ok) throw new GithubAuthError(`Fetching the user failed: HTTP ${res.status}`);
      const user = userSchema.parse(await res.json());
      return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
    },
  };
}
