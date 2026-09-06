import { ValidationError } from '../errors.js';
import { isValidHost } from '../net.js';
import { config } from '../../config.js';

export const host = {
  binary: 'host',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    if (tokens.length < 1 || tokens.length > 2) {
      throw new ValidationError('host: expected a domain and an optional DNS server');
    }

    for (const t of tokens) {
      if (!isValidHost(t)) {
        throw new ValidationError(`host: invalid argument: ${t}`);
      }
    }

    return tokens;
  },
};
