import { ValidationError } from '../errors.js';
import { isValidHost } from '../net.js';
import { config } from '../../config.js';

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

export const mtr = {
  binary: 'mtr',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    let ipVersionFlag = null;
    let count = DEFAULT_COUNT;
    let host = null;
    let i = 0;

    while (i < tokens.length) {
      const t = tokens[i];

      if (t === '-4' || t === '-6') {
        ipVersionFlag = t;
        i++;
        continue;
      }

      // -r от юзера игнорируется как отдельный токен — режим отчёта
      // форсируется ниже безусловно, интерактивный curses UI недопустим.
      if (t === '-r') {
        i++;
        continue;
      }

      if (t === '-c') {
        const n = Number(tokens[i + 1]);
        if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
          throw new ValidationError(`mtr: -c must be between 1 and ${MAX_COUNT}`);
        }
        count = n;
        i += 2;
        continue;
      }

      if (t.startsWith('-')) {
        throw new ValidationError(`mtr: flag not allowed: ${t}`);
      }

      if (host !== null) {
        throw new ValidationError('mtr: only one target host is allowed');
      }
      if (!isValidHost(t)) {
        throw new ValidationError(`mtr: invalid host: ${t}`);
      }
      host = t;
      i++;
    }

    if (!host) {
      throw new ValidationError('mtr: target host is required');
    }

    const args = ['-r', '-c', String(count)];
    if (ipVersionFlag) args.push(ipVersionFlag);
    args.push(host);

    return args;
  },
};
