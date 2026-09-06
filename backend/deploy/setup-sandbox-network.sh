#!/usr/bin/env bash
# Створює ізольовану Docker-мережу для sandbox-пулу і додає egress-блок
# на приватні/link-local діапазони (TECH.md §5.5). Ідемпотентний —
# безпечно запускати повторно (напр. після ребута через systemd-юніт
# deploy/sandbox-network.service).
set -euo pipefail

NETWORK_NAME="${SANDBOX_NETWORK:-linuxcli-sandbox-net}"
SUBNET="${SANDBOX_SUBNET:-172.30.0.0/24}"

# Заблоковані напрямки з sandbox-мережі: RFC1918 приватні діапазони,
# loopback, link-local (включно з cloud metadata 169.254.169.254).
# Власна підмережа sandbox теж під цим правилом навмисно — контейнери
# не повинні бачити один одного чи gateway напряму, кожен sandbox
# ізольований і живе рівно одну команду.
BLOCKED_RANGES=(
  "169.254.0.0/16"
  "127.0.0.0/8"
  "10.0.0.0/8"
  "172.16.0.0/12"
  "192.168.0.0/16"
)

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Creating Docker network $NETWORK_NAME ($SUBNET)..."
  # Без --ipv6: IPv6 на sandbox-мережі свідомо не вмикається, це прибирає
  # цілий клас egress-правил (ip6tables), які інакше довелось би дублювати.
  docker network create --driver bridge --subnet "$SUBNET" "$NETWORK_NAME"
else
  echo "Docker network $NETWORK_NAME already exists, skipping create."
fi

# DOCKER-USER — єдина ланцюжок, яку Docker гарантовано не перезаписує
# при рестарті демона чи перестворенні мереж, тому правила саме сюди.
iptables -N DOCKER-USER 2>/dev/null || true

for range in "${BLOCKED_RANGES[@]}"; do
  if iptables -C DOCKER-USER -s "$SUBNET" -d "$range" -j DROP 2>/dev/null; then
    echo "Rule for $range already present, skipping."
  else
    echo "Blocking $SUBNET -> $range"
    iptables -I DOCKER-USER -s "$SUBNET" -d "$range" -j DROP
  fi
done

echo "Done. Current DOCKER-USER rules for $SUBNET:"
iptables -L DOCKER-USER -n --line-numbers | grep -F "$SUBNET" || true
