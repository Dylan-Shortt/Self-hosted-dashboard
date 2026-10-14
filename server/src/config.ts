export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    nodeEnv: env.NODE_ENV ?? 'development',
  };
}
