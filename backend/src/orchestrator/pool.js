import { getDocker } from './dockerClient.js';
import { buildContainerConfig } from './containerConfig.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class PoolExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoolExhaustedError';
  }
}

export class SandboxPool {
  constructor({
    minSize = config.sandboxPoolMin,
    lowWatermark = config.sandboxPoolLowWatermark,
    maxConcurrent = config.sandboxMaxConcurrent,
    docker, // injectable для тестів (test/pool.test.js) — за замовчуванням реальний dockerode
  } = {}) {
    this.minSize = minSize;
    this.lowWatermark = lowWatermark;
    this.maxConcurrent = maxConcurrent;
    this.docker = docker ?? getDocker();
    this.idle = [];
    // idle.length + число выданных под exec контейнеров — реальный
    // потолок нагрузки на хост, не только "нормальный" размер пула.
    this.liveCount = 0;
    this.refilling = false;
  }

  async start() {
    await this._refillTo(this.minSize);
  }

  async _createOne() {
    const container = await this.docker.createContainer(buildContainerConfig());
    await container.start();
    this.liveCount += 1;
    return container;
  }

  async _refillTo(target) {
    if (this.refilling) return;
    this.refilling = true;
    try {
      while (this.idle.length < target && this.liveCount < this.maxConcurrent) {
        const container = await this._createOne();
        this.idle.push(container);
      }
    } finally {
      this.refilling = false;
    }
  }

  async acquire() {
    if (this.idle.length === 0 && this.liveCount >= this.maxConcurrent) {
      // Раніше тут беззастережно створювався ad-hoc контейнер — жодного
      // ліміту на сумарну кількість sandbox одночасно (docs/architecture/
      // orchestrator.md). Тепер над minSize/lowWatermark стоїть жорсткий
      // потолок maxConcurrent, а не тільки неявний ліміт памʼяті хоста.
      throw new PoolExhaustedError('sandbox capacity exhausted, try again shortly');
    }

    const container = this.idle.pop() ?? (await this._createOne());

    if (this.idle.length < this.lowWatermark) {
      // Фоновая доливка — не блокирует уже выданный контейнер.
      this._refillTo(this.minSize).catch((err) => {
        logger.error('sandbox pool refill failed:', err);
      });
    }

    return container;
  }

  async destroy(container) {
    try {
      await container.kill();
    } catch {
      // Контейнер уже мог остановиться сам — ниже всё равно force-remove.
    }
    await container.remove({ force: true });
    this.liveCount -= 1;
  }

  async drain() {
    const containers = this.idle.splice(0);
    await Promise.all(containers.map((c) => this.destroy(c)));
  }
}
