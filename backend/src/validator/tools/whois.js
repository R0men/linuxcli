import { ValidationError } from '../errors.js';
import { isValidHost } from '../net.js';
import { config } from '../../config.js';

export const whois = {
  binary: 'whois',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    if (tokens.length !== 1 || !isValidHost(tokens[0])) {
      throw new ValidationError('whois: expected exactly one domain or IP argument');
    }
    return [tokens[0]];
  },
};
