import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/gateway/server.js';

// Регрес-тест на конкретний баг (14-08-2026): бекенд відповідав коректно
// на curl (не підкоряється CORS), але браузерний fetch() з фронтенда
// мовчки провалювався — ні Access-Control-Allow-Origin на відповідях, ні
// обробки preflight OPTIONS. Симптом на фронтенді був непрямий (порожній
// список OAuth-провайдерів), тому вартий саме HTTP-раунд-тріпу, а не
// юніт-тесту внутрішньої логіки.
function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = createServer({ pool: {} });
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        await fn(port);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function request(port, { method, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

test('OPTIONS preflight gets a real response with CORS headers, not 404', async () => {
  await withServer(async (port) => {
    const res = await request(port, {
      method: 'OPTIONS',
      path: '/register',
      headers: { Origin: 'https://example.com' },
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.com');
    assert.ok(res.headers['access-control-allow-methods']);
  });
});

test('actual response echoes Access-Control-Allow-Origin when Origin is present', async () => {
  await withServer(async (port) => {
    const res = await request(port, {
      method: 'GET',
      path: '/health',
      headers: { Origin: 'https://example.com' },
    });
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.com');
  });
});

test('no Access-Control-Allow-Origin is set when the request has no Origin header', async () => {
  await withServer(async (port) => {
    const res = await request(port, { method: 'GET', path: '/health' });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});
