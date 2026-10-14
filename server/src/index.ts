import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
