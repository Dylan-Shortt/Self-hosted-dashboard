import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import {
  GithubAuthError,
  GithubUnreachableError,
  type GithubOAuthClient,
} from '../github/oauth.js';
import type { GithubUserTokens } from '../session/register.js';

/** The user's GitHub tokens are missing or can no longer be renewed. They must sign in again. */
export class SessionExpiredError extends Error {}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: requires a signed-in user and sets request.githubToken to a valid token. */
    requireGithubToken: preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    githubToken: string;
  }
}

type SessionLike = FastifyRequest['session'];

/** Renew this long before the token actually expires, to absorb clock skew and slow requests. */
const EXPIRY_SKEW_MS = 60_000;
/** How long a finished refresh result is shared with late-arriving parallel requests. */
const RESULT_SHARE_MS = 10_000;

export interface TokenManager {
  getAccessToken(session: SessionLike): Promise<string>;
}

export function createTokenManager(github: GithubOAuthClient, now = Date.now): TokenManager {
  // Keyed by the refresh token being spent. It is single-use, so parallel requests that
  // each see the same expiring token must share one refresh call instead of racing.
  const inflight = new Map<string, Promise<GithubUserTokens>>();

  function refreshOnce(refreshToken: string): Promise<GithubUserTokens> {
    const existing = inflight.get(refreshToken);
    if (existing) return existing;

    const promise = github.refreshTokens(refreshToken);
    inflight.set(refreshToken, promise);
    promise.then(
      () => setTimeout(() => inflight.delete(refreshToken), RESULT_SHARE_MS).unref(),
      () => inflight.delete(refreshToken),
    );
    return promise;
  }

  return {
    async getAccessToken(session) {
      const tokens = session.githubTokens;
      if (!tokens) throw new SessionExpiredError('No GitHub tokens in session');

      const expiresAt = tokens.accessTokenExpiresAt;
      if (expiresAt === undefined || expiresAt - EXPIRY_SKEW_MS > now()) {
        return tokens.accessToken;
      }

      const { refreshToken, refreshTokenExpiresAt } = tokens;
      if (
        !refreshToken ||
        (refreshTokenExpiresAt !== undefined && refreshTokenExpiresAt <= now())
      ) {
        throw new SessionExpiredError('Access token expired and cannot be refreshed');
      }

      const fresh = await refreshOnce(refreshToken);
      session.githubTokens = fresh;
      await session.save();
      return fresh.accessToken;
    },
  };
}

export function createRequireGithubToken(tokens: TokenManager): preHandlerAsyncHookHandler {
  return async function requireGithubToken(request: FastifyRequest, reply: FastifyReply) {
    if (!request.session.user) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    try {
      request.githubToken = await tokens.getAccessToken(request.session);
    } catch (err) {
      if (err instanceof GithubUnreachableError) {
        // Transient: keep the session so the user can retry.
        return reply.code(503).send({ error: 'github_unreachable' });
      }
      if (err instanceof SessionExpiredError || err instanceof GithubAuthError) {
        await request.session.destroy();
        return reply.code(401).send({ error: 'session_expired' });
      }
      throw err;
    }
  };
}
