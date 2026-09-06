# VERIFY.md — як перевірити все, що потребує перевірки

Виконується **на самому Linux-сервері** (після `SETUP.md`), не на
дев-машині — саме там актуальні sysctl/iptables/cgroups-поведінка,
яку і треба перевірити.

Після кожного розділу онови "Критерії готовності"/"Перевірка" у
відповідному `docs/tasks/11-08-2026/NN-*.md` і статус у
`docs/tasks/PLAN.md` — коротко, що саме пройшло і коли.

---

## 1. Sandbox Docker-образ (задача 2)

```bash
cd /opt/linuxcli-backend
docker build -f docker/sandbox.Dockerfile -t linuxcli-sandbox:latest .

docker network inspect linuxcli-sandbox-net >/dev/null 2>&1 || \
  docker network create --driver bridge --subnet 172.30.0.0/24 linuxcli-sandbox-net

CID=$(docker run -d \
  --network linuxcli-sandbox-net \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --pids-limit=64 \
  --memory=128m \
  --sysctl net.ipv4.ping_group_range="0 2147483647" \
  linuxcli-sandbox:latest)

echo "container: $CID"
```

Далі — кожен тул окремо, точно в тій security-конфігурації, в якій
його запускатиме Orchestrator (`docker exec` без `-i`/`-t`, тобто
без stdin — так само, як `sandbox.js`):

```bash
docker exec "$CID" dig example.com
docker exec "$CID" whois example.com
docker exec "$CID" host example.com
docker exec "$CID" curl -sS -I https://example.com
docker exec "$CID" openssl s_client -connect example.com:443 -servername example.com
docker exec "$CID" nc -zv example.com 443
```

Усі мають відпрацювати без permission-помилок.

**Ping (unprivileged через sysctl, без `CAP_NET_RAW`):**

```bash
docker exec "$CID" ping -c 3 example.com
```

Якщо впаде з `Operation not permitted`/`socket: Permission denied` —
sysctl `net.ipv4.ping_group_range` не підхопився. Перевір, що Docker
daemon дозволяє цей sysctl без `--privileged` (`docker version` ≥
20.10 — має бути ОК за замовчуванням, це namespaced sysctl).

**mtr (відкрите питання з `docs/tasks/02-sandbox-image.md`):**

```bash
docker exec "$CID" mtr -r -c 3 example.com
```

Два можливі результати:
- **Спрацював** — унеси в `02-sandbox-image.md` факт, що того самого
  ping-socket шляху mtr вистачило, закрий питання.
- **Впав з permission-помилкою** — підтверджує, що mtr таки потребує
  `CAP_NET_RAW` окремо. **Не вирішуй сам додавати
  `--cap-add=NET_RAW`** — це порушує правило з `docs/CLAUDE.md` про
  незняття `cap-drop=ALL` без явного дозволу користувача. Задокументуй
  результат у файлі задачі й піднімай питання користувачу: прибрати
  `mtr` з MVP чи погодити виняток.

Прибери тестовий контейнер:

```bash
docker rm -f "$CID"
```

---

## 2. Egress-фільтрація мережі (задача 4, §5.5)

```bash
CID=$(docker run -d \
  --network linuxcli-sandbox-net \
  --cap-drop=ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --pids-limit=64 \
  linuxcli-sandbox:latest)
```

**Має заблокуватись** (timeout — це очікуваний результат, не баг):

```bash
docker exec "$CID" curl -sS --max-time 5 http://169.254.169.254/ \
  && echo "FAIL: metadata endpoint reachable" \
  || echo "OK: metadata endpoint blocked"

docker exec "$CID" curl -sS --max-time 5 http://10.0.0.1/ \
  && echo "FAIL: private range reachable" \
  || echo "OK: private range blocked"

docker exec "$CID" nc -zv -w 3 192.168.1.1 22 \
  && echo "FAIL: private range reachable via nc" \
  || echo "OK: blocked"
```

**Має пройти** (звичайний інтернет + DNS):

```bash
docker exec "$CID" curl -sS --max-time 5 -o /dev/null -w "%{http_code}\n" https://example.com
docker exec "$CID" dig +short example.com @8.8.8.8
```

(Прапорці `-o`/`nc` без `-z` тут — це прямий `docker exec` в обхід
Command Validator, тільки для перевірки самої мережі. Застосунок
ніколи не формує такі команди сам — дивись §3 нижче.)

```bash
docker rm -f "$CID"
```

Якщо будь-який "має заблокуватись" кейс пройшов — перевір, що
`deploy/setup-sandbox-network.sh` реально відпрацював
(`sudo iptables -L DOCKER-USER -n --line-numbers`) і що контейнер
запущено саме в мережі `linuxcli-sandbox-net`, а не в `bridge` за
замовчуванням.

---

## 3. Command Validator (задача 3 — регресія)

Уже пройдено локально при реалізації; тут — як перепрогнати після
будь-яких майбутніх змін у `src/validator/`:

```bash
cd /opt/linuxcli-backend
cat > /tmp/verify-validator.mjs <<'EOF'
import { validateCommand, ValidationError } from './src/validator/validate.js';

const cases = [
  ['dig google.com', true],
  ['curl -o /etc/passwd https://example.com', false],
  ['curl file:///etc/passwd', false],
  ['nc -zv example.com 20-30000', false],
  ['dig google.com; rm -rf /', false],
  ['rm -rf /', false],
];

let failed = 0;
for (const [line, expectOk] of cases) {
  try {
    validateCommand(line);
    if (!expectOk) { failed++; console.log('FAIL (should reject):', line); }
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    if (expectOk) { failed++; console.log('FAIL (should accept):', line, e.message); }
  }
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
EOF
node /tmp/verify-validator.mjs
rm /tmp/verify-validator.mjs
```

(Повний набір із 22 кейсів — у git-історії задачі 3, цей скорочений
для швидкої регресії.)

---

## 4. Sandbox Orchestrator (задача 4 — pool + one-shot lifecycle)

Проти живого Docker daemon, з реальним образом із §1:

```bash
cd /opt/linuxcli-backend
mkdir -p verify
cat > verify/orchestrator.mjs <<'EOF'
import { SandboxPool } from '../src/orchestrator/pool.js';
import { runCommand } from '../src/orchestrator/sandbox.js';
import { validateCommand } from '../src/validator/validate.js';

const pool = new SandboxPool({ minSize: 3, lowWatermark: 1 });
await pool.start();
console.log('pool started, idle:', pool.idle.length); // очікується 3

const { binary, args, timeoutMs } = validateCommand('dig example.com +short');
const result = await runCommand(pool, { binary, args, timeoutMs });
console.log('exitCode:', result.exitCode, 'stdout:', result.stdout.trim());

await new Promise((r) => setTimeout(r, 500)); // дати фоновій доливці відпрацювати
console.log('pool idle after run:', pool.idle.length); // знову має бути ~3

await pool.drain();
console.log('drained, idle:', pool.idle.length); // 0
EOF

node verify/orchestrator.mjs
```

Паралельно в іншому SSH-сеансі спостерігай:

```bash
watch -n1 'docker ps -a --filter ancestor=linuxcli-sandbox:latest'
```

**Критерій**: контейнер, що виконав `dig`, зникає одразу після
завершення команди (не лишається ні `Exited`, ні `running` — рядок
`destroy()` завжди викликає `remove({force:true})`). Після
`pool.drain()` контейнерів з цим ancestor не лишається взагалі.

Приберіть тестовий скрипт після перевірки:

```bash
rm verify/orchestrator.mjs
```

---

## 5. MongoDB (задача 1 — з'єднання + TTL-індекс)

Спершу дай застосунку створити індекси (викликає `connectMongo()` з
`src/db/mongo.js`, той самий код, що виконається при старті сервера):

```bash
cd /opt/linuxcli-backend
node -e "import('./src/db/mongo.js').then(m => m.connectMongo()).then(() => { console.log('indexes ensured'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
```

Перевір індекси й запис/видалення через `mongosh` — підстав те саме
значення, що в `MONGO_URL` з `.env` (self-hosted `mongodb://...` чи
Atlas `mongodb+srv://...`, `SETUP.md` §4 — команда однакова для
обох варіантів):

```bash
mongosh "<MONGO_URL з .env>" --eval '
db.audit_logs.insertOne({ test: true, timestamp: new Date() });
print("indexes:", JSON.stringify(db.audit_logs.getIndexes()));
print("count:", db.audit_logs.countDocuments({ test: true }));
db.audit_logs.deleteMany({ test: true });
'
```

(Якщо Atlas — переконайся, що в Network Access додана саме та IPv4,
з якої йде запит; з самого VPS це вже так, якщо зроблено `SETUP.md`
§4 крок 3.)

> Жодна команда тут не сортує по `_id` — навмисно, дивись
> `docs/CLAUDE.md` ("Жорсткі заборони на дії"). Якщо потрібне
> впорядкування вибірки — по `timestamp`, не по `_id`.

**Критерій**: у виводі `getIndexes()` є запис на полі `timestamp` з
`"expireAfterSeconds": 7776000`, і окремий unique-індекс
`tokenHash` у колекції `api_keys`.

---

## 6. Redis (задача 1 — з'єднання)

```bash
redis-cli -a "$REDIS_PASSWORD" ping   # PONG
redis-cli -a "$REDIS_PASSWORD" set verify:test ok EX 10
redis-cli -a "$REDIS_PASSWORD" get verify:test   # ok
```

Або через сам застосунок:

```bash
cd /opt/linuxcli-backend
node -e "import('./src/db/redis.js').then(async m => { const r = m.getRedis(); console.log(await r.ping()); await r.quit(); })"
```

---

## 7. systemd-хардинг `linuxcli-backend.service` (13-08-2026)

Після `SETUP.md` §10 (юніт піднятий і `active (running)`), перевір, що
`ProtectSystem=strict` не заважає реальному потоку (Docker
socket/Mongo/Redis/WS):

```bash
sudo systemctl status linuxcli-backend.service   # active (running), без рестарт-циклу
curl http://127.0.0.1:8080/health                 # {"status":"ok"}
journalctl -u linuxcli-backend.service -n 50 --no-pager | grep -i denied
```

Якщо в логах є `Permission denied`/`EPERM` при спробі достукатись до
`/var/run/docker.sock` — розкоментуй `ReadWritePaths=/var/run/docker.sock`
у `deploy/linuxcli-backend.service` (коментар у файлі це вже
пояснює), потім:

```bash
sudo cp deploy/linuxcli-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart linuxcli-backend.service
```

Якщо процес падає з `SIGSYS` (kill від seccomp) — `SystemCallFilter=
@system-service` виявився занадто вузьким для якоїсь операції Node/
dockerode; задокументуй конкретний випадок і повідом користувача,
перш ніж послаблювати фільтр (той самий принцип, що й для
Docker-sandbox seccomp — `docs/CLAUDE.md`).

---

## 8. Чеклист (звести докупи)

| Задача | Перевірено | Де відмітити |
|---|---|---|
| 2 — sandbox-образ, усі тули, ping | §1 вище | `docs/tasks/11-08-2026/02-sandbox-image.md` |
| 2 — mtr (окреме рішення, якщо не запрацював) | §1 вище | там само + повідомити користувача |
| 4 — egress-фільтрація | §2 вище | `docs/tasks/11-08-2026/04-sandbox-orchestrator.md` |
| 3 — validator (регресія) | §3 вище | `docs/tasks/11-08-2026/03-command-validator.md` |
| 4 — pool lifecycle | §4 вище | `docs/tasks/11-08-2026/04-sandbox-orchestrator.md` |
| 1/7 — Mongo TTL/індекси | §5 вище | `docs/tasks/11-08-2026/01-scaffold-project.md`, `07-audit-logger.md` |
| 1/6 — Redis | §6 вище | `docs/tasks/11-08-2026/01-scaffold-project.md`, `06-anti-abuse.md` |
| 8 — systemd-хардинг (`ProtectSystem=strict` тощо) | §7 вище | `docs/tasks/12-08-2026/08-cicd-deploy.md` |

Задачі 5, 6, 7 (gateway, anti-abuse, audit) ще не реалізовані —
end-to-end перевірка (реальна WS-сесія з фронтенда) з'явиться в цьому
файлі, коли вони будуть готові.
