# Sandbox Orchestrator — `src/orchestrator/`

Docker-пул одноразових контейнерів + життєвий цикл виконання однієї
команди. `dockerClient.js` — синглтон `dockerode`-клієнта;
`containerConfig.js` — security-конфігурація контейнера;
`pool.js` — pre-warmed pool; `sandbox.js` — сам запуск команди.

## `containerConfig.js` — security-конфігурація

```js
CapDrop: ['ALL'],
SecurityOpt: ['no-new-privileges'],
ReadonlyRootfs: true,
Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=16m' },
NetworkMode: config.sandboxNetwork,
PidsLimit: 64,
Memory: 128 * 1024 * 1024,      // 128MB
NanoCpus: 500_000_000,           // 0.5 CPU
Sysctls: { 'net.ipv4.ping_group_range': '0 2147483647' },
AutoRemove: false,               // пул сам вирішує, коли знищувати
```

Кастомний seccomp-профіль НЕ задається (використовується вбудований
дефолтний Docker-профіль) — свідоме рішення, обґрунтування в
`docs/tasks/02-sandbox-image.md`, не в цьому коді. `ping_group_range`
дозволяє unprivileged ICMP через sysctl (не capability, тому не
конфліктує з `CapDrop: ['ALL']`) — чи вистачає цього для `mtr`, теж
не покриває raw sockets гарантовано — відкрите питання, задокументоване
в тому самому файлі задачі, потребує перевірки на реальному Linux-хості.

Контейнер стартує як `sleep 2147483647` (Dockerfile) — довгоживучий
no-op, поки пул не віддасть його під конкретний `exec`.

## `pool.js` — pre-warmed pool

```js
acquire() {
  if (idle.length === 0 && liveCount >= maxConcurrent) throw new PoolExhaustedError(...);
  container = idle.pop() ?? await _createOne();   // fallback, якщо пул порожній
  if (idle.length < lowWatermark) _refillTo(minSize);  // фонова доливка, не блокує
  return container;
}
```

### Фікс (13-08-2026): глобальна стеля на одночасні sandbox

Раніше, якщо `idle` був порожній, `acquire()` створював контейнер
ad-hoc без жодного ліміту на те, скільки таких ad-hoc-контейнерів може
існувати одночасно — стримувало тільки памʼять/CPU хоста de facto, не
явний кодовий ліміт.

Тепер пул рахує `liveCount` (idle + видані під `exec` контейнери,
інкремент у `_createOne()`, декремент у `destroy()`) і порівнює з
`config.sandboxMaxConcurrent` (`SANDBOX_MAX_CONCURRENT`, дефолт `3 ×
SANDBOX_POOL_MIN`). Фонова доливка (`_refillTo`) теж зупиняється на
цій стелі, не тільки на `minSize`. При вичерпанні `acquire()` кидає
`PoolExhaustedError`, яку `wsHandler.js` перетворює на
`{type:'error', message:'sandbox capacity exhausted...'}` користувачу
(і insert-only audit-запис `rejected:true`) замість необмеженого
росту кількості контейнерів.

### `destroy()` — завжди force-remove

```js
async destroy(container) {
  try { await container.kill(); } catch { /* міг вже зупинитись сам */ }
  await container.remove({ force: true });
}
```

Викликається в `sandbox.js`'s `finally` — незалежно від того, чим
завершилась команда (успіх/помилка/timeout/abort), контейнер завжди
знищується повністю, ніколи не переюзається (`Sandbox = одна
команда` — `../../TECH.md` §5.4).

## `sandbox.js` — `runCommand`

```
container.exec({ Cmd: [binary, ...args], AttachStdout, AttachStderr, Tty: false })
  → exec.start({ hijack: true, stdin: false })   // non-interactive: stdin закритий одразу
  → demuxStream → stdout/stderr PassThrough → onChunk() стрімом
  → Promise.race([finished, stopEarly])           // stopEarly = timeout АБО AbortSignal
  → якщо timedOut/aborted: container.kill()
  → exec.inspect() → exitCode (null, якщо timedOut/aborted)
  → finally: pool.destroy(container)              // завжди, у будь-якому випадку
```

`stdin: false` — те, що робить `openssl s_client` (та будь-який
інший інтерактивний бінарник) non-interactive за задумом (`../../TECH.md`
§5.3): stdin миттєво закритий, будь-яке очікування вводу з stdin
одразу отримує EOF.

Timeout і зовнішній `AbortSignal` (обрив WS-з'єднання, `gateway.md`)
гоняться на рівних — обидва зупиняють очікування й вбивають
контейнер, різняться лише прапорцем у результаті (`timedOut` vs
`aborted`).

### Фікс (06-09-2026): ліміт виводу тепер гасить контейнер одразу

```js
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
```

Раніше при перевищенні `outputBytes` над лімітом код просто переставав
ЗБИРАТИ й пересилати чанки — сам процес усередині sandbox продовжував
виконуватись (і споживати CPU/час sandbox-у) до природного завершення
або до `timeoutMs` (дефолт 20с), без раннього kill. Найбільше це било
по тулах без власного ліміту виводу (`ping`/`mtr`/`nc`/`whois`/
`openssl s_client` — на відміну від `curl`, у якого вже є
`--max-filesize`, `validator/tools/curl.js`).

Тепер `outputLimitExceeded` — третій тригер у тому самому
`stopEarly`-race, що й `timedOut`/`aborted` (`stopEarlyResolve`
дістали з `stopEarly`-промиса в змінну, як уже було для `timer`/
`onAbort`): перше перевищення ліміту одразу резолвить race, контейнер
гаситься тим самим `container.kill()`, `exec.inspect()` так само не
викликається (exit code невідомий, як і при timeout/abort). WS-
контракт не змінився — `outputTruncated` у `done`-фреймі й audit-логу
означає те саме, що й раніше, просто тепер завжди супроводжується
раннім killʼом, а не до 20с зайвого виконання.

### Фікс (13-08-2026): `outputTruncated` і `sandboxId` тепер доходять далі

`runCommand` тепер повертає ще й `sandboxId: container.id`.
`wsHandler.js` передає обидва значення далі: `outputTruncated` — у
`done`-фрейм клієнту (раніше рахувалось і відкидалось мовчки), і разом
з `sandboxId` — в `logCommand()` для audit-запису (`audit.md`).
Користувач, чий вивід обрізаний по `MAX_OUTPUT_BYTES`, тепер бачить це
явно замість "команда просто так закінчилась".
