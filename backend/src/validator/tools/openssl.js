import { ValidationError } from '../errors.js';
import { isValidHost, isValidPort } from '../net.js';
import { config } from '../../config.js';

// target.split(':') ламається на IPv6 — кожен ':' усередині адреси стає
// окремим роздільником. Реальний openssl-синтаксис для IPv6 —
// -connect [::1]:443 (брекети), тому парсимо саме so: brackets навколо
// хоста явно, інакше — останній ':' як роздільник host/port (hostname
// та IPv4 самі колонів не містять, тому lastIndexOf безпечний).
function parseConnectTarget(target) {
  if (target.startsWith('[')) {
    const closeIdx = target.indexOf(']');
    if (closeIdx === -1 || target[closeIdx + 1] !== ':') return null;
    return { host: target.slice(1, closeIdx), port: target.slice(closeIdx + 2) };
  }

  const lastColon = target.lastIndexOf(':');
  if (lastColon === -1) return null;
  return { host: target.slice(0, lastColon), port: target.slice(lastColon + 1) };
}

export const openssl = {
  binary: 'openssl',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    if (tokens[0] !== 's_client') {
      throw new ValidationError('openssl: only the s_client subcommand is allowed');
    }

    const args = ['s_client'];
    let connectSeen = false;
    let i = 1;

    while (i < tokens.length) {
      const t = tokens[i];

      if (t === '-connect') {
        const target = tokens[i + 1] ?? '';
        const parsed = parseConnectTarget(target);
        if (
          !parsed ||
          !parsed.host ||
          !parsed.port ||
          !isValidHost(parsed.host) ||
          !isValidPort(parsed.port)
        ) {
          throw new ValidationError(`openssl: invalid -connect target: ${target}`);
        }
        args.push('-connect', target);
        connectSeen = true;
        i += 2;
        continue;
      }

      if (t === '-servername') {
        const name = tokens[i + 1];
        if (!name || !isValidHost(name)) {
          throw new ValidationError(`openssl: invalid -servername: ${name ?? ''}`);
        }
        args.push('-servername', name);
        i += 2;
        continue;
      }

      if (t === '-showcerts') {
        args.push('-showcerts');
        i++;
        continue;
      }

      // -cert/-key/-engine/-rand и всё остальное — deny-by-default.
      throw new ValidationError(`openssl: flag not allowed: ${t}`);
    }

    if (!connectSeen) {
      throw new ValidationError('openssl: -connect host:port is required');
    }

    // Non-interactive режим (закрытый stdin) обеспечивает Sandbox
    // Orchestrator при запуске exec — здесь только валидация аргументов.
    return args;
  },
};
