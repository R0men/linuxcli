import { connectMongo, closeMongo } from './db/mongo.js';
import { getRedis, closeRedis } from './db/redis.js';
import { SandboxPool } from './orchestrator/pool.js';
import { createServer } from './gateway/server.js';
import { config } from './config.js';
import { logger } from './logger.js';

const DEFAULT_IP_HASH_SECRET = 'dev-secret-change-me';

function warnInsecureDefaults() {
  if (config.allowedOrigins.length === 0) {
    logger.warn(
      'ALLOWED_ORIGINS is empty — any Origin can open a WS session. ' +
        'OK for local dev, NOT OK for production (see docs/SETUP.md §7).'
    );
  }

  if (config.ipHashSecret === DEFAULT_IP_HASH_SECRET) {
    // Публично відомий секрет: HMAC однонаправлений, але простір IPv4
    // скінченний (~4 млрд) — з відомим секретом можна пере-хешувати всі
    // можливі адреси й зіставити з audit_logs, знявши "приватність"
    // псевдонімізації повністю (docs/architecture/abuse.md).
    logger.warn(
      'IP_HASH_SECRET is left at the default dev value — audit log ipHash ' +
        'pseudonymization is trivially reversible. Set a real secret (see .env.example).'
    );
  }
}

async function main() {
  warnInsecureDefaults();

  await connectMongo();
  getRedis(); // лениво подключается сам при первом реальном обращении

  const pool = new SandboxPool();
  await pool.start();
  logger.info(`sandbox pool ready: ${pool.idle.length} containers`);

  const server = createServer({ pool });

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  logger.info(`listening on ${config.host}:${config.port}`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received, shutting down...`);
    server.close();
    await pool.drain();
    await closeRedis();
    await closeMongo();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('fatal startup error:', err);
  process.exit(1);
});
