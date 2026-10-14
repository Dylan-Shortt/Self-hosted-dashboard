import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/requireAuth.js';
import type { Config } from '../config.js';
import { GithubAuthError, type GithubOAuthClient } from '../github/oauth.js';

export interface AuthRoutesOptions {
  config: Config;
  github: GithubOAuthClient;
}

const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  { config, github },
) => {
  const failRedirect = (reason: string) => `${config.appUrl}/?auth_error=${reason}`;

  app.get('/api/auth/login', async (request, reply) => {
    const state = randomBytes(24).toString('base64url');
    request.session.oauthState = state;
    return reply.redirect(github.buildAuthorizeUrl(state));
  });

  app.get('/api/auth/callback', async (request, reply) => {
    const query = callbackQuery.safeParse(request.query);
    const expectedState = request.session.oauthState;
    // The state is single-use: drop it whatever happens next.
    request.session.oauthState = undefined;

    if (!query.success || !query.data.state || !expectedState) {
      return reply.redirect(failRedirect('invalid_request'));
    }
    if (!statesMatch(expectedState, query.data.state)) {
      return reply.redirect(failRedirect('invalid_state'));
    }
    if (query.data.error || !query.data.code) {
      return reply.redirect(failRedirect('denied'));
    }

    try {
      const tokens = await github.exchangeCode(query.data.code);
      const user = await github.fetchUser(tokens.accessToken);

      if (!config.allowedUsers.includes(user.login.toLowerCase())) {
        request.log.warn({ login: user.login }, 'sign-in rejected: user not in allowlist');
        await request.session.destroy();
        return reply.redirect(failRedirect('not_allowed'));
      }

      // New session id on sign-in, so an id planted before login is useless.
      await request.session.regenerate();
      request.session.user = user;
      request.session.githubTokens = tokens;
      return reply.redirect(`${config.appUrl}/`);
    } catch (err) {
      if (!(err instanceof GithubAuthError) && !(err instanceof z.ZodError)) throw err;
      request.log.error({ err }, 'GitHub sign-in failed');
      return reply.redirect(failRedirect('github_error'));
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: request.session.user,
  }));
};
