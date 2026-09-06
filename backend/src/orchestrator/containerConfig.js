import { config } from '../config.js';

// Диапазон "0 2147483647" разрешает unprivileged ICMP ping-сокеты
// (SOCK_DGRAM+IPPROTO_ICMP) любому gid в контейнере — это sysctl, а не
// capability, поэтому не конфликтует с CapDrop: ['ALL']. См. docs/tasks
// 02-sandbox-image.md про то, почему mtr этим сysctl'ом не гарантированно
// покрывается (открытый вопрос, требует проверки на целевом Linux-хосте).
const PING_GROUP_RANGE = '0 2147483647';

export function buildContainerConfig() {
  return {
    Image: config.sandboxImage,
    Cmd: ['sleep', '2147483647'],
    Tty: false,
    HostConfig: {
      CapDrop: ['ALL'],
      // Кастомный seccomp-профиль намеренно не задаём — используется
      // встроенный дефолтный профиль Docker (обоснование в
      // docs/tasks/02-sandbox-image.md).
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Tmpfs: {
        '/tmp': 'rw,noexec,nosuid,size=16m',
      },
      NetworkMode: config.sandboxNetwork,
      PidsLimit: 64,
      Memory: 128 * 1024 * 1024,
      NanoCpus: 500_000_000,
      Sysctls: {
        'net.ipv4.ping_group_range': PING_GROUP_RANGE,
      },
      // Пул сам решает, когда уничтожать контейнер (Sandbox = одна
      // команда) — не полагаемся на AutoRemove при выходе процесса.
      AutoRemove: false,
    },
  };
}
