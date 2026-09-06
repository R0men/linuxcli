import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPool, PoolExhaustedError } from '../src/orchestrator/pool.js';

// Фейковий dockerode-клієнт — жодного живого Docker daemon не потрібно.
// Кожен "контейнер" — просто лічильник, id для трасування у тестах.
function makeFakeDocker() {
  let nextId = 0;
  const created = [];
  const docker = {
    async createContainer() {
      const id = `fake-${nextId++}`;
      const container = {
        id,
        started: false,
        removed: false,
        async start() {
          this.started = true;
        },
        async kill() {},
        async remove() {
          this.removed = true;
        },
      };
      created.push(container);
      return container;
    },
  };
  return { docker, created };
}

test('start() pre-warms exactly minSize containers', async () => {
  const { docker } = makeFakeDocker();
  const pool = new SandboxPool({ minSize: 3, lowWatermark: 1, maxConcurrent: 10, docker });
  await pool.start();
  assert.equal(pool.idle.length, 3);
  assert.equal(pool.liveCount, 3);
});

test('acquire() throws PoolExhaustedError instead of unbounded ad-hoc creation', async () => {
  const { docker } = makeFakeDocker();
  // minSize 0 так acquire() йде тільки ad-hoc шляхом; maxConcurrent — жорстка стеля.
  const pool = new SandboxPool({ minSize: 0, lowWatermark: 0, maxConcurrent: 2, docker });
  await pool.start();

  const c1 = await pool.acquire();
  const c2 = await pool.acquire();
  assert.equal(pool.liveCount, 2);

  await assert.rejects(() => pool.acquire(), PoolExhaustedError);

  // Звільнення контейнера повертає місце під стелею.
  await pool.destroy(c1);
  assert.equal(pool.liveCount, 1);
  const c3 = await pool.acquire();
  assert.ok(c3);
  assert.equal(pool.liveCount, 2);

  await pool.destroy(c2);
  await pool.destroy(c3);
});

test('background refill never exceeds maxConcurrent', async () => {
  const { docker } = makeFakeDocker();
  const pool = new SandboxPool({ minSize: 5, lowWatermark: 4, maxConcurrent: 3, docker });
  await pool.start(); // minSize(5) > maxConcurrent(3) — стеля має виграти

  assert.equal(pool.liveCount, 3);
  assert.equal(pool.idle.length, 3);
});

test('destroy() always force-removes and decrements liveCount', async () => {
  const { docker } = makeFakeDocker();
  const pool = new SandboxPool({ minSize: 1, lowWatermark: 0, maxConcurrent: 5, docker });
  await pool.start();
  const container = pool.idle[0];

  await pool.destroy(container);
  assert.equal(container.removed, true);
  assert.equal(pool.liveCount, 0);
});

test('drain() empties idle and destroys every container', async () => {
  const { docker } = makeFakeDocker();
  const pool = new SandboxPool({ minSize: 3, lowWatermark: 1, maxConcurrent: 5, docker });
  await pool.start();

  await pool.drain();
  assert.equal(pool.idle.length, 0);
  assert.equal(pool.liveCount, 0);
});
