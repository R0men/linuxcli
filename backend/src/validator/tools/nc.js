import { ValidationError } from '../errors.js';
import { isValidHost, isValidPort } from '../net.js';
import { config } from '../../config.js';

export const nc = {
  binary: 'nc',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    // Единственная разрешённая форма — connect-check одного порта.
    // Без -l (listen) и без -e (exec) — вручную не перечисляем как
    // запрещённые, они просто не проходят проверку префикса ниже.
    const flag = tokens[0];
    if (flag !== '-zv' && flag !== '-vz') {
      throw new ValidationError('nc: only the "-zv host port" connect-check form is allowed');
    }

    if (tokens.length !== 3) {
      throw new ValidationError('nc: expected exactly "-zv host port"');
    }

    const [, host, port] = tokens;
    if (!isValidHost(host)) {
      throw new ValidationError(`nc: invalid host: ${host}`);
    }
    // Один порт, не диапазон (nc охотно просканирует "20-30000" целиком).
    if (!isValidPort(port)) {
      throw new ValidationError(`nc: invalid port: ${port}`);
    }

    return ['-zv', host, port];
  },
};
