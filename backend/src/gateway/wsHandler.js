import { randomBytes } from 'node:crypto';
import { validateCommand, ValidationError } from '../validator/validate.js';
import { runCommand } from '../orchestrator/sandbox.js';
import { PoolExhaustedError } from '../orchestrator/pool.js';
import { checkRateLimit, RateLimitError } from '../abuse/rateLimiter.js';
import { verifyTurnstile } from '../abuse/turnstile.js';
import { lookupApiKey } from '../abuse/apiKey.js';
import { hmacIp } from '../abuse/ipHash.js';
import { logCommand } from '../audit/logger.js';
import { getClientIp } from './clientIp.js';
import { isOriginAllowed } from './origin.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

function send(ws, frame) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

// Фронтенд і backend навмисно на різних доменах (SETUP.md §12) — без
// перевірки Origin будь-який сторонній сайт міг би відкрити WS-сесію
// в обхід фронтенда і паразитувати на чужому rate-limit/anti-bot.
async function checkOrigin(ws, req) {
  const origin = req.headers.origin ?? '';
  if (isOriginAllowed(origin)) return true;

  send(ws, { type: 'error', message: 'origin not allowed' });
  ws.close();
  return false;
}

export async function handleConnection(ws, req, { pool }) {
  if (!(await checkOrigin(ws, req))) return;

  // Один короткий id на все WS-з'єднання — дозволяє відфільтрувати
  // логи саме цього з'єднання серед інших без ручного зіставлення за
  // часом (docs/architecture/README.md, наскрізна проблема логування).
  const connId = randomBytes(4).toString('hex');
  const log = createLogger(connId);

  const url = new URL(req.url, 'http://localhost');
  const rawIp = getClientIp(req);
  const ipHash = hmacIp(rawIp);
  const apiKeyToken = url.searchParams.get('apiKey');
  const apiKeyId = apiKeyToken ? (await lookupApiKey(apiKeyToken))?.keyId ?? null : null;
  const rateLimitId = apiKeyId ?? ipHash;

  log.info(`connection opened, ipHash=${ipHash.slice(0, 12)} apiKey=${Boolean(apiKeyId)}`);

  let turnstilePassedAt = 0;
  let commandsSinceChallenge = 0;
  let running = false;
  let activeAbort = null;

  async function ensureChallenge(token) {
    const stale =
      Date.now() - turnstilePassedAt > config.turnstile.requiredEveryMs ||
      commandsSinceChallenge >= config.turnstile.requiredEveryNCommands;

    if (!stale) return true;

    const ok = await verifyTurnstile(token, rawIp, log);
    if (ok) {
      turnstilePassedAt = Date.now();
      commandsSinceChallenge = 0;
    }
    return ok;
  }

  async function execCommand(frame) {
    const challengeOk = await ensureChallenge(frame.turnstileToken);
    if (!challengeOk) {
      send(ws, { type: 'challenge-required' });
      return;
    }

    try {
      await checkRateLimit({ id: rateLimitId, isApiKey: Boolean(apiKeyId) });
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err;
      send(ws, { type: 'error', message: err.message });
      return;
    }

    let parsed;
    try {
      parsed = validateCommand(frame.command);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      send(ws, { type: 'error', message: err.message });
      await logCommand({
        ipHash,
        apiKeyId,
        rawCommand: frame.command,
        rejected: true,
        rejectionReason: err.message,
      });
      return;
    }

    commandsSinceChallenge += 1;

    const controller = new AbortController();
    activeAbort = controller;

    let result;
    try {
      result = await runCommand(pool, parsed, {
        signal: controller.signal,
        onChunk: (stream, chunk) => {
          send(ws, { type: 'chunk', stream, data: chunk.toString('utf8') });
        },
      });
    } catch (err) {
      activeAbort = null;
      if (!(err instanceof PoolExhaustedError)) throw err;
      send(ws, { type: 'error', message: err.message });
      await logCommand({
        ipHash,
        apiKeyId,
        binary: parsed.binary,
        args: parsed.args,
        rejected: true,
        rejectionReason: err.message,
      });
      return;
    }

    activeAbort = null;

    send(ws, {
      type: 'done',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      aborted: result.aborted,
      outputTruncated: result.outputTruncated,
    });

    await logCommand({
      ipHash,
      apiKeyId,
      binary: parsed.binary,
      args: parsed.args,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      outputBytes: result.stdout.length + result.stderr.length,
      timedOut: result.timedOut,
      outputTruncated: result.outputTruncated,
      sandboxId: result.sandboxId,
    });
  }

  ws.on('message', async (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'invalid frame: not JSON' });
      return;
    }

    if (frame.type !== 'exec' || typeof frame.command !== 'string') {
      send(ws, { type: 'error', message: 'invalid frame: expected {type:"exec", command}' });
      return;
    }

    if (running) {
      send(ws, { type: 'error', message: 'a command is already running on this connection' });
      return;
    }

    running = true;
    try {
      await execCommand(frame);
    } catch (err) {
      log.error('unexpected error handling exec frame:', err);
      send(ws, { type: 'error', message: 'internal error' });
    } finally {
      running = false;
    }
  });

  ws.on('close', () => {
    log.info('connection closed');
    // Обрив з'єднання під час виконання — не лишаємо sandbox довисати:
    // runCommand() сам вб'є й знищить контейнер по цьому сигналу
    // (sandbox.js, гонка stopEarly проти finished).
    activeAbort?.abort();
  });
}
