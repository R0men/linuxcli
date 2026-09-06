# SETUP.md — підняти проєкт на чистому VPS

Розраховано на **порожній VPS з Ubuntu 24.04 LTS** (типовий дефолт у
Hetzner Cloud — `TECH.md` §2). Якщо ОС інша (Debian тощо) — кроки ті
самі, відрізняються тільки apt-репозиторії Docker/Node/Mongo (посилання
на офіційні інструкції дано в кожному кроці).

Усі команди виконуються по SSH на самому сервері, якщо не сказано
інше. Ніщо з цього не виконується на дев-машині — Docker Desktop там
навмисно не використовується (Windows-VM під капотом не гарантує ту
саму поведінку sysctl/iptables, що реальний Linux-хост).

> **Профіль для 2GB VPS** (напр. Netcup VPS nano G11s — KVM,
> 2 vCores, 2GB RAM, 60GB SSD — підходить: повна віртуалізація з
> власним ядром, Docker працює нативно, на відміну від
> OpenVZ/LXC-based дешевих VPS). З таким набором сервісів на одному
> хості (Docker + MongoDB + Redis + Node) 2GB — без запасу, тому в
> кроках нижче позначено окремими блоками, що саме тюнити: крок 1a
> (swap), крок 4 (**рекомендовано MongoDB Atlas** замість self-hosted
> — знімає весь тиск Mongo на памʼять хоста одним рішенням), крок 5
> (ліміт памʼяті Redis), крок 7 (менший sandbox-пул). На VPS від
> 4GB ці блоки можна пропускати — дефолти й так розраховані з запасом.

## 0. Що треба мати заздалегідь

- IP-адресу VPS і root-доступ по SSH (Hetzner видає одразу після
  створення сервера).
- (Опційно, для anti-bot) Cloudflare Turnstile site key + secret key —
  реєструється в Cloudflare dashboard, не входить у цей гайд.
- (Опційно, для TLS) домен, направлений A-записом на IP сервера.

## 1. Перше підключення і базовий хардинг

```bash
ssh root@<SERVER_IP>

apt update && apt full-upgrade -y

# Некореневий користувач для деплою — не працюємо під root надалі
adduser linuxcli
usermod -aG sudo linuxcli

# Скопіювати свій публічний SSH-ключ новому користувачу
rsync --archive --chown=linuxcli:linuxcli ~/.ssh /home/linuxcli
```

Далі перелогінься як `linuxcli` (`ssh linuxcli@<SERVER_IP>`) і продовжуй
з цього користувача (`sudo` де потрібно root).

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw enable
```

Порт застосунку (8080 за замовчуванням) в ufw **не відкривати** —
доступ ззовні йде через reverse proxy на 443 (крок 12), сам backend
слухає тільки локально.

### 1a. Swap-файл — **тільки для 2GB VPS-профілю**

Не для продуктивності, а щоб транзієнтний сплеск пам'яті (напр.
кілька команд одночасно + фонове доливання пулу) не завершився
OOM-killer'ом якогось із процесів замість плавної деградації.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Своп — крайній запобіжник, не постійна робоча пам'ять: тримаємо
# систему консервативною щодо того, як охоче вона в нього йде.
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

На VPS від 4GB — пропусти цей крок.

## 2. Docker Engine (офіційний спосіб, не Docker Desktop)

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin

sudo systemctl enable --now docker

# Щоб linuxcli міг звертатись до /var/run/docker.sock без sudo
# (Sandbox Orchestrator саме так спілкується з daemon)
sudo usermod -aG docker linuxcli
```

Перелогінься (`exit`, потім `ssh` знову), щоб членство в групі `docker`
підхопилось, і перевір:

```bash
docker run --rm hello-world
```

Офіційна довідка (якщо ОС не Ubuntu): https://docs.docker.com/engine/install/

## 3. Node.js 22.x

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node --version   # має бути v22.x
npm --version
```

## 4. MongoDB

`src/db/mongo.js` передає `MONGO_URL` напряму в офіційний драйвер
(`new MongoClient(config.mongoUrl)`) — той однаково розуміє і
`mongodb://`, і `mongodb+srv://`, без жодних змін у коді. Вибір між
варіантами нижче — суто інфраструктурний.

### Варіант A: MongoDB Atlas — рекомендовано (особливо для 2GB VPS)

Знімає з хоста весь клас проблем із памʼяттю MongoDB (не треба ні
`cacheSizeGB`-тюнінгу, ні патчів/бекапів self-hosted інстансу) —
безкоштовний M0-тір (512MB, постійний, не триальний) з запасом
вистачає під MVP-обсяг (`audit_logs` з TTL 90 днів невеликий,
`api_keys` — тим паче).

1. Реєстрація на https://cloud.mongodb.com, створити безкоштовний
   **M0**-кластер (обери регіон, найближчий до регіону VPS — впливає
   на latency кожного audit-запису).
2. **Database Access** → Add New Database User → `linuxcli_app`,
   згенерований пароль, **Grant specific privileges** → `readWrite`
   лише на базу `linuxcli` (не вбудована роль на всі бази — той самий
   принцип найменших прав, що й у self-hosted варіанті нижче).
3. **Network Access** → Add IP Address → саме дедиковану IPv4-адресу
   VPS (Netcup видає статичну — це є в специфікації плану), **не**
   `0.0.0.0/0`.
4. **Connect** → **Drivers** → скопіювати рядок вигляду
   `mongodb+srv://linuxcli_app:<пароль>@cluster0.xxxxx.mongodb.net/linuxcli?retryWrites=true&w=majority`
   — це і є значення `MONGO_URL` для `.env` (крок 7).

Кроки 5+ (self-hosted-специфічні) у цьому розділі більше не
потрібні — переходь одразу до `## 5. Redis`.

### Варіант B: Self-hosted (усе на одному хості, без зовнішньої залежності)

```bash
sudo apt install -y gnupg curl
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

За замовчуванням `mongod` слухає тільки `127.0.0.1` — так і лишити,
зовнішній доступ не потрібен (backend і Mongo на одному хості).

> Якщо обрав цей варіант (self-hosted), а не Atlas — онови
> `deploy/linuxcli-backend.service` **перед кроком 10**: додай
> `mongod.service` назад у рядок `After=` (у файлі є коментар з
> поясненням чому його там немає за замовчуванням). Без цього
> застосунок технічно все одно підніметься (`mongod` вже запущений і
> буде готовий до моменту старту `linuxcli-backend.service` в
> переважній більшості випадків), але без явного `After=` порядок
> старту при одночасному ребуті хоста не гарантований.

Створи БД і користувача застосунку з обмеженими правами (тільки на
`linuxcli`, не адмінський):

```bash
mongosh --eval '
db = db.getSiblingDB("linuxcli");
db.createUser({
  user: "linuxcli_app",
  pwd: passwordPrompt(),
  roles: [{ role: "readWrite", db: "linuxcli" }]
});
'
```

Введи пароль, коли попросить (`passwordPrompt()` не показує його в
історії команд). Потім увімкни авторизацію:

```bash
sudo sed -i '/^#security:/a security:\n  authorization: enabled' /etc/mongod.conf
sudo systemctl restart mongod
```

**2GB VPS-профіль (якщо все ж self-hosted):** без обмеження WiredTiger
сам собі візьме `(RAM-1GB)/2` ≈ 512MB кешу — забагато для 2GB-хоста
разом з Docker+Redis+Node. Обмеж явно:

```bash
sudo tee -a /etc/mongod.conf > /dev/null <<'EOF'

storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25
EOF
sudo systemctl restart mongod
```

(На VPS від 4GB — пропусти, дефолтний розрахунок вже адекватний.)

Значення для `.env` (крок 7):
`MONGO_URL=mongodb://linuxcli_app:<пароль>@127.0.0.1:27017/linuxcli?authSource=linuxcli`

## 5. Redis

```bash
sudo apt install -y redis-server

REDIS_PASSWORD=$(openssl rand -hex 24)
echo "Redis password: $REDIS_PASSWORD"   # збережи — знадобиться для .env

sudo sed -i "s/^# requirepass foobared/requirepass $REDIS_PASSWORD/" /etc/redis/redis.conf
sudo sed -i "s/^bind .*/bind 127.0.0.1 -::1/" /etc/redis/redis.conf
```

**2GB VPS-профіль:** Redis тут — лише rate-limit лічильники й
ефемерний session state, не джерело правди, тому безпечно обмежити
й дозволити витіснення старих ключів замість необмеженого росту:

```bash
sudo sed -i "s/^# maxmemory <bytes>/maxmemory 200mb/" /etc/redis/redis.conf
sudo sed -i "s/^# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/" /etc/redis/redis.conf
```

(На VPS від 4GB — можна пропустити або поставити ліміт вищим.)

```bash
sudo systemctl restart redis-server
redis-cli -a "$REDIS_PASSWORD" ping   # має відповісти PONG
```

Значення для `.env`: `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379`

## 6. Код проєкту на сервер

Репозиторій: `git@github.com:R0MEN/linuxcli-backend.git` (приватний).
Клонування приватного репо на VPS вимагає окремого read-only
SSH-ключа, зареєстрованого в GitHub як **Deploy Key** — це інший
напрямок довіри, ніж ключ для автодеплою в §6a (той дозволяє GitHub
Actions заходити НА сервер, цей дозволяє серверу читати З GitHub).

**На сервері:**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key -N "" -C "linuxcli-backend-vps-readonly"
cat ~/.ssh/github_deploy_key.pub
```

Додай виведений публічний ключ тут:
https://github.com/R0MEN/linuxcli-backend/settings/keys → **Add deploy
key** → встав ключ, **не** вмикай "Allow write access" (сервер тільки
читає код, не пушить).

Скажи git використовувати саме цей ключ для `github.com`:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy_key
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Клонуй і постав залежності:

```bash
sudo mkdir -p /opt/linuxcli-backend
sudo chown linuxcli:linuxcli /opt/linuxcli-backend
git clone git@github.com:R0MEN/linuxcli-backend.git /opt/linuxcli-backend
cd /opt/linuxcli-backend
npm ci
```

> **Якщо `/opt/linuxcli-backend` вже наповнений через старий
> `rsync`-підхід** (перший підйом до появи git-репозиторію) — не
> видаляй каталог, retrofit git на місці. `.env` не постраждає (він у
> `.gitignore`, `git checkout -f`/`reset --hard` чіпають тільки
> tracked-файли, не untracked):
> ```bash
> cd /opt/linuxcli-backend
> git init
> git remote add origin git@github.com:R0MEN/linuxcli-backend.git
> git fetch origin main
> git checkout -f main
> git branch --set-upstream-to=origin/main main
> ls -la .env   # переконайся, що він на місці й не зник
> npm ci
> ```

## 6a. Автодеплой з GitHub (CI/CD)

`.github/workflows/deploy.yml` у репозиторії: при кожному push у
`main` GitHub Actions заходить на сервер по SSH і сам виконує
`git fetch`+`reset --hard`, `npm ci`, перезбірку sandbox-образу й
рестарт сервісів. Секрети (`DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY`) вже виставлені в GitHub → Settings → Secrets →
Actions. Щоб сервер прийняв ці підключення, потрібно ще двоє:

**1. Дозволити GitHub Actions заходити на сервер** (публічна половина
ключа, приватна — вже в секреті `DEPLOY_SSH_KEY`):

```bash
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMabQyPj9yYUvns33slHUVT5p/0Vp4Zq+VvYmRjYQh6t github-actions-deploy@linuxcli-backend" >> ~/.ssh/authorized_keys
```

**2. Дозволити `linuxcli` рестартувати сервіс без пароля** — вузько,
тільки ці три команди, не повний `sudo`:

```bash
echo 'linuxcli ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload, /usr/bin/systemctl restart linuxcli-backend.service, /usr/bin/systemctl restart sandbox-network.service' | \
  sudo tee /etc/sudoers.d/linuxcli-deploy
sudo chmod 440 /etc/sudoers.d/linuxcli-deploy
sudo visudo -cf /etc/sudoers.d/linuxcli-deploy   # має вивести "parsed OK"
```

(`docker build` sudo не потребує — `linuxcli` вже в групі `docker`,
крок 2.)

**Перевірка:** пуш будь-якої зміни в `main` (або вкладка **Actions**
в репозиторії → цей workflow → "Run workflow" для ручного запуску) —
прогрес видно у вкладці Actions на GitHub.

**На сервері:**

```bash
cd /opt/linuxcli-backend
npm ci
```

## 7. Конфігурація `.env`

```bash
cp .env.example .env
```

Заповни `.env` вручну (`nano .env` чи інший редактор — **не через
Claude**, `.env` для нього ні читати, ні писати заборонено, дивись
`docs/CLAUDE.md`):

| Змінна | Значення |
|---|---|
| `MONGO_URL` | з кроку 4 |
| `REDIS_URL` | з кроку 5 |
| `SANDBOX_IMAGE` | `linuxcli-sandbox:latest` (збереш образ на кроці 8) |
| `SANDBOX_NETWORK` | `linuxcli-sandbox-net` (створиться на кроці 9) |
| `IP_HASH_SECRET` | `openssl rand -hex 32` |
| `TURNSTILE_SECRET_KEY` | secret key з Cloudflare Turnstile dashboard |
| `ALLOWED_ORIGINS` | домен фронтенда (крок 13), напр. `https://app.example.com`; порожньо = дозволити будь-який `Origin` (ок для першого тесту, **не для проду**) |
| `PUBLIC_API_URL`, `FRONTEND_URL` | публічні URL бекенда/фронтенда — потрібні для OAuth redirect'ів (`OAUTH_SETUP.md`), можна виставити вже зараз навіть без OAuth |

Решта значень з `.env.example` — робочі дефолти з `TECH.md` §8, можна
не чіпати для першого запуску.

**GitHub/Google OAuth (опційно, поза цим гайдом)** — `docs/
OAUTH_SETUP.md`, окремий покроковий гайд. Без нього email+пароль
реєстрація/логін працюють повністю, OAuth-кнопки на `/login` просто не
з'являються, поки `GITHUB_CLIENT_ID`/`GOOGLE_CLIENT_ID` не заповнені.

**2GB VPS-профіль:** дефолтний `SANDBOX_POOL_MIN=10` тримає 10 живих
standby-контейнерів одночасно — з запасом для 2GB-хоста. Зменш:

```
SANDBOX_POOL_MIN=4
SANDBOX_POOL_LOW_WATERMARK=2
```

Менший пул = трохи більша затримка видачі sandbox під пікове
навантаження, але для MVP-трафіку різниця непомітна. На VPS від
4GB — лишай дефолти з `.env.example`.

## 8. Sandbox Docker-образ

```bash
cd /opt/linuxcli-backend
docker build -f docker/sandbox.Dockerfile -t linuxcli-sandbox:latest .
```

Перевірка збірки й самих тулів усередині — детально в `VERIFY.md`
§1, не дублюю тут.

## 9. Sandbox-мережа + egress-фільтрація

```bash
cd /opt/linuxcli-backend
chmod +x deploy/setup-sandbox-network.sh
sudo ./deploy/setup-sandbox-network.sh
```

Щоб правила відновлювались після ребута сервера (iptables-правила самі
по собі не переживають рестart):

```bash
sudo cp deploy/sandbox-network.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable sandbox-network.service
```

Перевірка, що фільтрація реально блокує потрібне — `VERIFY.md` §2.

## 10. Запуск самого backend-застосунку

```bash
cd /opt/linuxcli-backend
sudo cp deploy/linuxcli-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now linuxcli-backend.service
sudo systemctl status linuxcli-backend.service
```

Юніт (`deploy/linuxcli-backend.service`) піднімає `node src/index.js`
під користувачем `linuxcli` (не root), читає `.env`, рестартує сам
себе при падінні (`Restart=on-failure`). Очікуваний статус —
`active (running)`.

Якщо не піднявся — логи:

```bash
journalctl -u linuxcli-backend.service -n 50 --no-pager
```

Найчастіші причини падіння на старті: неправильний `MONGO_URL`/
`REDIS_URL` в `.env` (крок 7), `linuxcli` не в групі `docker` (крок 2
— тоді помилка буде про `/var/run/docker.sock`), `SANDBOX_IMAGE` з
кроку 8 не зібраний під тим самим тегом, що в `.env`.

## 11. Перший запуск — smoke-тест

Перевір застосунок наскрізно (HTTP → WS → реальна команда в
sandbox → відповідь), перш ніж підключати reverse proxy й фронтенд.

**1. Health-check:**

```bash
curl http://127.0.0.1:8080/health
```
Очікується `{"status":"ok"}`.

**2. Видача API key** (опційний шлях застосунку, не обов'язковий для
самого тесту):

```bash
curl -X POST http://127.0.0.1:8080/api-key
```
Очікується `{"apiKey":"<64 hex символи>"}`.

**3. Реальна команда через WebSocket.** Без фронтенда немає живого
Turnstile-віджета, щоб отримати справжній токен — Cloudflare для
таких випадків офіційно публікує тестовий secret key, який завжди
проходить перевірку незалежно від токена. **Тимчасово**, тільки для
цього smoke-тесту, постав у `.env`:

```
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

і перезапусти застосунок: `sudo systemctl restart linuxcli-backend.service`.

Далі — маленький WS-клієнт (той самий пакет `ws`, що вже в
залежностях проєкту):

```bash
cd /opt/linuxcli-backend
mkdir -p verify
cat > verify/ws-smoke.mjs <<'EOF'
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8080/terminal');

ws.on('open', () => {
  console.log('connected, sending command...');
  ws.send(JSON.stringify({
    type: 'exec',
    command: 'dig example.com +short',
    turnstileToken: 'test', // ігнорується тестовим secret key вище
  }));
});

ws.on('message', (raw) => {
  const frame = JSON.parse(raw.toString());
  console.log(frame);
  if (frame.type === 'done' || frame.type === 'error') ws.close();
});

ws.on('close', () => process.exit(0));
ws.on('error', (err) => { console.error(err); process.exit(1); });

setTimeout(() => { console.error('TIMEOUT — дивись journalctl -u linuxcli-backend.service'); process.exit(1); }, 15000);
EOF

node verify/ws-smoke.mjs
rm verify/ws-smoke.mjs
```

Очікуваний вивід — кілька `{ type: 'chunk', stream: 'stdout', ... }`
з IP-адресою `example.com`, потім `{ type: 'done', exitCode: 0, ... }`.

Паралельно перевір, що sandbox-контейнер, який щойно виконав команду,
не лишився висіти:

```bash
docker ps -a --filter ancestor=linuxcli-sandbox:latest
```
Має бути порожньо (або тільки живі standby-контейнери пулу, без
`Exited`).

**Після тесту — обов'язково поверни реальний `TURNSTILE_SECRET_KEY`**
(тестовий ключ пропускає взагалі будь-який токен — залишити його в
проді означає повністю вимкнений anti-bot захист):

```bash
# постав справжній TURNSTILE_SECRET_KEY в .env, потім:
sudo systemctl restart linuxcli-backend.service
```

Якщо щось із цього не пройшло — детальніша діагностика по кожному
компоненту окремо (Mongo/Redis/validator/orchestrator/egress) —
`docs/VERIFY.md`.

## 12. (Рекомендовано) Reverse proxy + TLS

Backend слухає тільки `127.0.0.1:8080`. Для доступу з браузера
(WSS) потрібен TLS-термінатор перед ним. Найпростіше — Caddy
(автоматичний Let's Encrypt):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
your-domain.example {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl restart caddy
sudo ufw allow 80,443/tcp
```

Це окремо від backend-задач (не в `docs/tasks/`) — суто інфраструктурний
крок, роби його, коли є домен і готовий приймати зовнішній трафік.

## 13. Фронтенд — окремий безкоштовний хостинг, НЕ цей VPS

Фронтенд (xterm.js, статичний білд) не ставимо на цей VPS. Причини:

- Це статичні файли (HTML/JS/CSS) — їм не потрібен Docker/Node/root,
  окремий сервер під це нема сенсу оплачувати.
- 2GB-профіль і так тісний (крок вище) — навіщо забирати ресурси в
  статики, коли backend-бокс і так розрахований впритул під
  Docker+Mongo+Redis+Node.
- Безкоштовні статичні хостинги (**Cloudflare Pages**, Netlify,
  Vercel) дають CDN на весь світ — фронтенд вантажиться швидше, ніж
  якби роздавався з одного маленького VPS.
- Turnstile (anti-bot, `TECH.md` §8) — теж від Cloudflare, природно
  лягає в ту саму екосистему, якщо фронтенд на Cloudflare Pages.

Рекомендована схема доменів: `app.example.com` → Cloudflare Pages
(фронтенд), `api.example.com` → Caddy на цьому VPS → Node backend
(крок 12, підстав `api.example.com` замість `your-domain.example` у
Caddyfile). Фронтенд ходить на `api.example.com` по WSS —
крос-доменний WebSocket не має проблеми з CORS у тому сенсі, як HTTP
fetch (не блокується браузером сам факт з'єднання), але коли дійде
задача 5 (API Gateway) — там варто звірити `Origin` заголовок на
хендшейку до `app.example.com`, щоб довільний сторонній сайт не міг
відкрити WS-сесію в обхід фронтенда.
