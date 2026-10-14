import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/** An explicit env object. loadConfig never reads the real .env when given one. */
const validEnv: NodeJS.ProcessEnv = {
  SESSION_SECRET: 'x'.repeat(40),
  DATABASE_PATH: ':memory:',
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  GITHUB_APP_ID: '1',
  GITHUB_APP_CLIENT_ID: 'cid',
  GITHUB_APP_CLIENT_SECRET: 'csecret',
  GITHUB_APP_PRIVATE_KEY_PATH: 'k.pem',
  ALLOWED_GITHUB_USERS: 'octocat',
};

function load(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({ ...validEnv, ...overrides });
}

const requiredVars = [
  'SESSION_SECRET',
  'GITHUB_APP_ID',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'ALLOWED_GITHUB_USERS',
];

describe('loadConfig', () => {
  it('parses a valid env object', () => {
    const config = load();
    expect(config.sessionSecret).toBe('x'.repeat(40));
    expect(config.github).toMatchObject({
      appId: '1',
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    expect(config.allowedUsers).toEqual(['octocat']);
    expect(config.nodeEnv).toBe('test');
  });

  it('applies defaults for PORT and HOST when they are unset', () => {
    const config = load();
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
  });

  it('lowercases, trims and splits ALLOWED_GITHUB_USERS', () => {
    expect(load({ ALLOWED_GITHUB_USERS: ' Me , YOU ' }).allowedUsers).toEqual(['me', 'you']);
  });

  it('removes a trailing slash from APP_URL', () => {
    expect(load({ APP_URL: 'http://localhost:5173/' }).appUrl).toBe('http://localhost:5173');
  });

  it.each(requiredVars)('throws an error naming %s when it is missing', (name) => {
    expect(() => load({ [name]: undefined })).toThrow(name);
  });

  it('throws an error naming SESSION_SECRET when it is shorter than 32 characters', () => {
    expect(() => load({ SESSION_SECRET: 'x'.repeat(31) })).toThrow('SESSION_SECRET');
  });

  it.each(['abc', '70000'])('rejects PORT %s', (port) => {
    expect(() => load({ PORT: port })).toThrow('PORT');
  });

  it('rejects ALLOWED_GITHUB_USERS that contains no usernames', () => {
    expect(() => load({ ALLOWED_GITHUB_USERS: ' , ' })).toThrow('ALLOWED_GITHUB_USERS');
  });

  it('passes DATABASE_PATH :memory: through unchanged', () => {
    expect(load({ DATABASE_PATH: ':memory:' }).databasePath).toBe(':memory:');
  });

  it('resolves a relative DATABASE_PATH to an absolute path', () => {
    const { databasePath } = load({ DATABASE_PATH: 'data/test.sqlite' });
    expect(isAbsolute(databasePath)).toBe(true);
    expect(databasePath.replace(/\\/g, '/')).toMatch(/data\/test\.sqlite$/);
  });
});
