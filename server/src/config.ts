import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// server/src (tsx) and server/dist (built) are both two levels below the repo root
const repoRoot = resolve(import.meta.dirname, '../..');

export interface GithubAppConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKeyPath: string;
}

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  appUrl: string;
  sessionSecret: string;
  databasePath: string;
  github: GithubAppConfig;
  allowedUsers: string[];
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.string().default('development'),
  APP_URL: z.url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DATABASE_PATH: z.string().default('./data/dashboard.sqlite'),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1),
  ALLOWED_GITHUB_USERS: z.string().min(1, 'list at least one GitHub username'),
});

/** Loads the repo-root .env into process.env without overriding existing variables. */
export function loadEnvFile(path = resolve(repoRoot, '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;

  const allowedUsers = e.ALLOWED_GITHUB_USERS.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (allowedUsers.length === 0) {
    throw new Error(
      'Invalid environment configuration:\n  ALLOWED_GITHUB_USERS: no usernames found',
    );
  }

  return {
    port: e.PORT,
    host: e.HOST,
    nodeEnv: e.NODE_ENV,
    appUrl: e.APP_URL.replace(/\/$/, ''),
    sessionSecret: e.SESSION_SECRET,
    databasePath:
      e.DATABASE_PATH === ':memory:' ? e.DATABASE_PATH : resolve(repoRoot, e.DATABASE_PATH),
    github: {
      appId: e.GITHUB_APP_ID,
      clientId: e.GITHUB_APP_CLIENT_ID,
      clientSecret: e.GITHUB_APP_CLIENT_SECRET,
      privateKeyPath: resolve(repoRoot, e.GITHUB_APP_PRIVATE_KEY_PATH),
    },
    allowedUsers,
  };
}
