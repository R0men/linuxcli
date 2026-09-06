#!/usr/bin/env bash
# Одноразовий (але ідемпотентний — безпечно перезапускати) скрипт, що
# добиває незавершену серверну частину задачі 8
# (docs/tasks/12-08-2026/08-cicd-deploy.md, "Залишилось") і одразу
# викочує поточний main напряму, не чекаючи полагодження GitHub
# Actions CI/CD (той зараз падає з startup_failure ще до старту job —
# судячи з усього, білінг/spending limit Actions на приватному репо,
# перевіряється й лагодиться тільки в github.com/settings/billing,
# скриптом це не автоматизується).
#
# Виконувати на самому VPS, від користувача linuxcli
# (SETUP.md §1: не root), з каталогу репозиторію:
#   cd /opt/linuxcli-backend && ./deploy/finish-server-setup.sh
set -euo pipefail

REPO_DIR=/opt/linuxcli-backend
CI_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMabQyPj9yYUvns33slHUVT5p/0Vp4Zq+VvYmRjYQh6t github-actions-deploy@linuxcli-backend"
SUDOERS_FILE=/etc/sudoers.d/linuxcli-deploy
SUDOERS_LINE='linuxcli ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload, /usr/bin/systemctl restart linuxcli-backend.service, /usr/bin/systemctl restart sandbox-network.service'

echo "== 1. Перевірка репозиторію =="
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "ПОМИЛКА: $REPO_DIR ще не git-репозиторій."
  echo "Спочатку пройди SETUP.md §6 (deploy key + git clone), потім перезапусти цей скрипт."
  exit 1
fi
cd "$REPO_DIR"

echo "== 2. Підтягнути актуальний main =="
git fetch origin main
git reset --hard origin/main
echo "Тепер на коміті: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

echo "== 3. Залежності =="
npm ci --omit=dev

echo "== 4. Sandbox-образ =="
docker build -f docker/sandbox.Dockerfile -t linuxcli-sandbox:latest .

echo "== 5. Sandbox-мережа + egress-фільтрація =="
chmod +x deploy/setup-sandbox-network.sh
sudo ./deploy/setup-sandbox-network.sh

echo "== 6. systemd-юніти (включно зі свіжим хардингом linuxcli-backend.service) =="
sudo cp deploy/linuxcli-backend.service /etc/systemd/system/linuxcli-backend.service
sudo cp deploy/sandbox-network.service /etc/systemd/system/sandbox-network.service
sudo systemctl daemon-reload
sudo systemctl enable sandbox-network.service
sudo systemctl enable linuxcli-backend.service

echo "== 7. CI (GitHub Actions) -> сервер SSH-ключ =="
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
if grep -qF "$CI_PUBKEY" ~/.ssh/authorized_keys 2>/dev/null; then
  echo "вже додано, пропускаю"
else
  echo "$CI_PUBKEY" >> ~/.ssh/authorized_keys
  echo "додано"
fi

echo "== 8. sudoers — вузький NOPASSWD тільки на рестарт двох сервісів =="
echo "$SUDOERS_LINE" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 440 "$SUDOERS_FILE"
sudo visudo -cf "$SUDOERS_FILE"

echo "== 9. Рестарт сервісів =="
sudo systemctl restart sandbox-network.service
sudo systemctl restart linuxcli-backend.service
sleep 2

echo "== 10. Smoke-перевірка =="
systemctl is-active linuxcli-backend.service
curl -sS http://127.0.0.1:8080/health && echo
echo "--- останні логи ---"
journalctl -u linuxcli-backend.service -n 20 --no-pager

echo
echo "== ГОТОВО =="
echo "Сервер тепер на $(git rev-parse --short HEAD), сервіси активні, CI-ключ і sudoers на місці."
echo "Залишається тільки полагодити білінг Actions на GitHub (github.com/settings/billing) —"
echo "після цього push у main вже сам буде довозити наступні коміти без цього скрипта."
