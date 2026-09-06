import { ValidationError } from '../errors.js';
import { isValidHost } from '../net.js';
import { config } from '../../config.js';

const DEFAULT_COUNT = 4;
const MAX_COUNT = 5;

export const ping = {
  binary: 'ping',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    let count = DEFAULT_COUNT;
    let host = null;
    let i = 0;

    while (i < tokens.length) {
      const t = tokens[i];

      if (t === '-c') {
        const n = Number(tokens[i + 1]);
        if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
          throw new ValidationError(`ping: -c must be between 1 and ${MAX_COUNT}`);
        }
        count = n;
        i += 2;
        continue;
      }

      // -f (flood) и -i (interval) — вне allowlist: обход per-command
      // rate-ограничений через частоту пакетов внутри одной команды.
      if (t.startsWith('-')) {
        throw new ValidationError(`ping: flag not allowed: ${t}`);
      }

      if (host !== null) {
        throw new ValidationError('ping: only one target host is allowed');
      }
      if (!isValidHost(t)) {
        throw new ValidationError(`ping: invalid host: ${t}`);
      }
      host = t;
      i++;
    }

    if (!host) {
      throw new ValidationError('ping: target host is required');
    }

    return ['-c', String(count), host];
  },
};
