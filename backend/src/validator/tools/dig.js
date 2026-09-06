import { ValidationError } from '../errors.js';
import { isValidHost } from '../net.js';
import { config } from '../../config.js';

const RECORD_TYPES = new Set(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR']);

export const dig = {
  binary: 'dig',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    let rest = [...tokens];
    const args = [];

    if (rest[0]?.startsWith('@')) {
      const server = rest[0].slice(1);
      if (!isValidHost(server)) {
        throw new ValidationError(`dig: invalid DNS server: ${rest[0]}`);
      }
      args.push(rest[0]);
      rest = rest.slice(1);
    }

    const domain = rest[0];
    if (!domain || !isValidHost(domain)) {
      throw new ValidationError('dig: first argument must be a valid domain or IP');
    }
    args.push(domain);
    rest = rest.slice(1);

    if (rest[0] && RECORD_TYPES.has(rest[0].toUpperCase())) {
      args.push(rest[0].toUpperCase());
      rest = rest.slice(1);
    }

    // +short и +dnssec — независимые флаги одного и того же запроса
    // (не порождают дополнительных обращений к резолверу, в отличие от
    // +trace ниже), поэтому принимаются в любом порядке и количестве.
    const FLAGS = new Set(['+short', '+dnssec']);
    while (rest[0] && FLAGS.has(rest[0])) {
      args.push(rest[0]);
      rest = rest.slice(1);
    }

    // +trace специально не в allowlist — это десятки последовательных
    // запросов на один вызов, что несовместимо с фиксированным таймаутом.
    if (rest.length > 0) {
      throw new ValidationError(`dig: unexpected arguments: ${rest.join(' ')}`);
    }

    return args;
  },
};
