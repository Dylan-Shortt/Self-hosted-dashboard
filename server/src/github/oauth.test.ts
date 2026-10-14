import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../test/helpers.js';
import {
  createGithubOAuthClient,
  GithubAuthError,
  GithubUnreachableError,
  parseTokenResponse,
  type GithubOAuthClient,
} from './oauth.js';

const NOW = 1_000_000;

/** A minimal stand-in for a fetch Response. */
function fakeResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A 200 response whose body is not JSON, like an HTML page from a proxy. */
function notJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

function clientWith(fetchMock: ReturnType<typeof vi.fn>): GithubOAuthClient {
  return createGithubOAuthClient(testConfig(), fetchMock as unknown as typeof fetch);
}

describe('parseTokenResponse', () => {
  it('maps a full response, computing expiry times from now', () => {
    expect(
      parseTokenResponse(
        {
          access_token: 'at',
          expires_in: 3600,
          refresh_token: 'rt',
          refresh_token_expires_in: 15_811_200,
        },
        NOW,
      ),
    ).toEqual({
      accessToken: 'at',
      accessTokenExpiresAt: NOW + 3600 * 1000,
      refreshToken: 'rt',
      refreshTokenExpiresAt: NOW + 15_811_200 * 1000,
    });
  });

  it('leaves expiry and refresh fields undefined when GitHub omits them', () => {
    const tokens = parseTokenResponse({ access_token: 'at' }, NOW);
    expect(tokens.accessToken).toBe('at');
    expect(tokens.accessTokenExpiresAt).toBeUndefined();
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.refreshTokenExpiresAt).toBeUndefined();
  });

  it('throws GithubAuthError when GitHub reports an error', () => {
    expect(() => parseTokenResponse({ error: 'bad_verification_code' }, NOW)).toThrow(
      GithubAuthError,
    );
  });

  it('throws GithubAuthError when the response has no token', () => {
    expect(() => parseTokenResponse({}, NOW)).toThrow(GithubAuthError);
  });

  it('throws GithubUnreachableError when the response has the wrong shape', () => {
    expect(() => parseTokenResponse({ access_token: 123 }, NOW)).toThrow(GithubUnreachableError);
  });
});

describe('createGithubOAuthClient', () => {
  describe('buildAuthorizeUrl', () => {
    it('builds the GitHub authorize URL with client id, state and redirect uri', () => {
      const url = new URL(clientWith(vi.fn()).buildAuthorizeUrl('S'));
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('cid');
      expect(url.searchParams.get('state')).toBe('S');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/callback');
    });
  });

  describe('exchangeCode', () => {
    it('POSTs the code as JSON to the GitHub token endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { access_token: 'at' }));
      const tokens = await clientWith(fetchMock).exchangeCode('the-code');

      expect(tokens.accessToken).toBe('at');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://github.com/login/oauth/access_token');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({
        client_id: 'cid',
        client_secret: 'csecret',
        code: 'the-code',
        redirect_uri: 'http://localhost:5173/api/auth/callback',
      });
    });
  });

  describe('refreshTokens', () => {
    it('POSTs a refresh_token grant to the GitHub token endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse(200, { access_token: 'new-at', refresh_token: 'new-rt' }));
      const tokens = await clientWith(fetchMock).refreshTokens('old-rt');

      expect(tokens.accessToken).toBe('new-at');
      expect(tokens.refreshToken).toBe('new-rt');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://github.com/login/oauth/access_token');
      expect(JSON.parse(String(init.body))).toEqual({
        client_id: 'cid',
        client_secret: 'csecret',
        grant_type: 'refresh_token',
        refresh_token: 'old-rt',
      });
    });
  });

  describe('fetchUser', () => {
    it('sends the bearer token and maps avatar_url to avatarUrl', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          fakeResponse(200, { id: 7, login: 'octocat', avatar_url: 'https://a.test/7.png' }),
        );
      const user = await clientWith(fetchMock).fetchUser('t');

      expect(user).toEqual({ id: 7, login: 'octocat', avatarUrl: 'https://a.test/7.png' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.github.com/user');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    });

    it('throws GithubAuthError on HTTP 401, not GithubUnreachableError', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse(401));
      const client = clientWith(fetchMock);
      await expect(client.fetchUser('t')).rejects.toBeInstanceOf(GithubAuthError);
      await expect(client.fetchUser('t')).rejects.not.toBeInstanceOf(GithubUnreachableError);
    });

    it('throws GithubUnreachableError when the user has the wrong shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { id: 'x' }));
      await expect(clientWith(fetchMock).fetchUser('t')).rejects.toBeInstanceOf(
        GithubUnreachableError,
      );
    });
  });

  describe.each([
    ['exchangeCode', (client: GithubOAuthClient) => client.exchangeCode('code')],
    ['refreshTokens', (client: GithubOAuthClient) => client.refreshTokens('rt')],
  ] as const)('%s failure classification', (_name, call) => {
    it.each([500, 503, 429])('HTTP %i is transient (GithubUnreachableError)', async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse(status));
      await expect(call(clientWith(fetchMock))).rejects.toBeInstanceOf(GithubUnreachableError);
    });

    it.each([400, 401])(
      'HTTP %i is a rejection (GithubAuthError, not unreachable)',
      async (status) => {
        const fetchMock = vi.fn().mockResolvedValue(fakeResponse(status));
        const client = clientWith(fetchMock);
        await expect(call(client)).rejects.toBeInstanceOf(GithubAuthError);
        await expect(call(client)).rejects.not.toBeInstanceOf(GithubUnreachableError);
      },
    );

    it('a non-JSON 200 body is treated as an outage', async () => {
      const fetchMock = vi.fn().mockResolvedValue(notJsonResponse());
      await expect(call(clientWith(fetchMock))).rejects.toBeInstanceOf(GithubUnreachableError);
    });

    it('an error field in a 200 body is a rejection (GithubAuthError, not unreachable)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse(200, { error: 'bad_refresh_token' }));
      const client = clientWith(fetchMock);
      await expect(call(client)).rejects.toBeInstanceOf(GithubAuthError);
      await expect(call(client)).rejects.not.toBeInstanceOf(GithubUnreachableError);
    });

    it('a network failure (fetch throwing) is GithubUnreachableError', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      await expect(call(clientWith(fetchMock))).rejects.toBeInstanceOf(GithubUnreachableError);
    });
  });
});
