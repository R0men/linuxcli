// Dev-only колектор фронтенд-логів. Не частина Next.js застосунку і
// не деплоїться (static export не підтримує серверний код, TECH.md
// §2/§4) — окремий процес, який запускається вручну поряд із
// `npm run dev`: `node scripts/log-server.mjs`.
// lib/logger.js шле сюди кожен log-запис, тільки коли NODE_ENV=development.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.LOG_SERVER_PORT ? Number(process.env.LOG_SERVER_PORT) : 4319;
const ALLOWED_ORIGIN = process.env.LOG_SERVER_ALLOWED_ORIGIN || 'http://localhost:3000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');

fs.mkdirSync(LOGS_DIR, { recursive: true });

function dayFromTime(time) {
  return (typeof time === 'string' ? time : new Date().toISOString()).slice(0, 10);
}

function formatLine(entry) {
  return `${entry.time} [${entry.level || 'log'}] ${entry.message}\n`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/log') {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const entry = JSON.parse(body);
      const filePath = path.join(LOGS_DIR, `${dayFromTime(entry.time)}.log`);
      fs.appendFileSync(filePath, formatLine(entry));
    } catch {
      // Некоректне тіло запиту — ігноруємо, це dev-утиліта, не критичний шлях.
    }
    res.writeHead(204);
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[log-server] writing frontend logs to ${LOGS_DIR}`);
  console.log(`[log-server] listening on http://127.0.0.1:${PORT} (origin: ${ALLOWED_ORIGIN})`);
});
