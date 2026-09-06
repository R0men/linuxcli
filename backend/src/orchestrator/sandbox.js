import { PassThrough } from 'node:stream';
import { config } from '../config.js';

const MAX_OUTPUT_BYTES = config.maxOutputBytes;

// pool.acquire()/destroy() — Sandbox тут строго одноразовый: одна команда
// на контейнер, независимо от результата (успех/ошибка/таймаут/abort).
export async function runCommand(pool, { binary, args, timeoutMs }, { onChunk, signal } = {}) {
  const container = await pool.acquire();
  const startedAt = Date.now();
  let timedOut = false;
  let aborted = false;
  let outputLimitExceeded = false;
  let timer;
  let onAbort;
  let stopEarlyResolve;

  try {
    const exec = await container.exec({
      Cmd: [binary, ...args],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;

    // Перевищення MAX_OUTPUT_BYTES гасить контейнер тим самим шляхом, що й
    // timeout/abort — без цього процес без власного ліміту виводу
    // (ping/mtr/nc/whois/openssl s_client) молотив би дарма до timeoutMs,
    // навіть коли клієнту вже давно нічого не шлють.
    const collect = (chunks, streamName) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        chunks.push(chunk);
        onChunk?.(streamName, chunk);
      } else if (!outputLimitExceeded) {
        outputLimitExceeded = true;
        stopEarlyResolve();
      }
    };
    stdout.on('data', collect(stdoutChunks, 'stdout'));
    stderr.on('data', collect(stderrChunks, 'stderr'));

    container.modem.demuxStream(stream, stdout, stderr);

    const finished = new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    // Если гонку ниже выигрывает таймаут/abort, finished может отклониться
    // уже после того, как мы перестали её ждать — помечаем обработанной,
    // чтобы не словить unhandledRejection.
    finished.catch(() => {});

    // Таймаут и внешний abort (обрыв WS-соединения, wsHandler.js) гонятся
    // с завершением команды на равных — обе причины останавливают ожидание
    // и убивают контейнер, различаются только флагом в результате.
    const stopEarly = new Promise((resolve) => {
      stopEarlyResolve = resolve;
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);

      if (signal) {
        if (signal.aborted) {
          aborted = true;
          resolve();
          return;
        }
        onAbort = () => {
          aborted = true;
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    await Promise.race([finished, stopEarly]);
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);

    if (timedOut || aborted || outputLimitExceeded) {
      try {
        await container.kill();
      } catch {
        // Контейнер міг завершитись сам між рішенням зупинити і kill.
      }
    }

    const inspect = timedOut || aborted || outputLimitExceeded ? null : await exec.inspect();

    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      exitCode: inspect ? inspect.ExitCode : null,
      timedOut,
      aborted,
      durationMs: Date.now() - startedAt,
      outputTruncated: outputBytes > MAX_OUTPUT_BYTES,
      sandboxId: container.id,
    };
  } finally {
    clearTimeout(timer);
    await pool.destroy(container);
  }
}
