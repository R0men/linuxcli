import { ValidationError } from '../errors.js';
import { isSafeHeaderValue } from '../net.js';
import { config } from '../../config.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD', 'PUT', 'DELETE']);
// Схема ограничена http/https нарочно: file://, gopher://, dict:// и т.п.
// curl выполнит без единой ошибки — это не "невалидный ввод" для самого
// тула, а SSRF/чтение локальных файлов через штатное поведение curl.
const URL_RE = /^https?:\/\/\S+$/i;
const HEADER_RE = /^[\w-]+:\s?.+$/;

export const curl = {
  binary: 'curl',
  timeoutMs: config.commandTimeoutMs,

  parse(tokens) {
    const args = [];
    let url = null;
    let i = 0;

    while (i < tokens.length) {
      const t = tokens[i];

      if (t === '-I' || t === '-i' || t === '-L') {
        args.push(t);
        i++;
        continue;
      }

      if (t === '-X') {
        const method = tokens[i + 1]?.toUpperCase();
        if (!method || !ALLOWED_METHODS.has(method)) {
          throw new ValidationError(`curl: unsupported -X method: ${tokens[i + 1] ?? ''}`);
        }
        args.push('-X', method);
        i += 2;
        continue;
      }

      if (t === '-H') {
        const header = tokens[i + 1];
        if (!header || !isSafeHeaderValue(header) || !HEADER_RE.test(header)) {
          throw new ValidationError(`curl: invalid -H header: ${header ?? ''}`);
        }
        args.push('-H', header);
        i += 2;
        continue;
      }

      if (t === '-A' || t === '--user-agent') {
        const ua = tokens[i + 1];
        if (!ua || !isSafeHeaderValue(ua)) {
          throw new ValidationError(`curl: invalid -A value: ${ua ?? ''}`);
        }
        args.push('-A', ua);
        i += 2;
        continue;
      }

      if (t === '-d' || t === '--data') {
        const data = tokens[i + 1];
        // '@' в начале значения — это curl'овский синтаксис "читать из
        // файла", тот же вектор, что и запрещённый --data-binary @file.
        if (data === undefined || !isSafeHeaderValue(data) || data.startsWith('@')) {
          throw new ValidationError('curl: invalid -d value');
        }
        args.push('-d', data);
        i += 2;
        continue;
      }

      if (t.startsWith('-')) {
        // Всё остальное — deny-by-default: -o/-O/--output, -F, -K,
        // --data-binary, --unix-socket и т.д. не перечисляются отдельно,
        // они просто не попадают ни в одну разрешённую ветку выше.
        throw new ValidationError(`curl: flag not allowed: ${t}`);
      }

      if (url !== null) {
        throw new ValidationError('curl: only one URL is allowed');
      }
      if (!URL_RE.test(t)) {
        throw new ValidationError(`curl: invalid URL (only http/https allowed): ${t}`);
      }
      url = t;
      i++;
    }

    if (!url) {
      throw new ValidationError('curl: URL is required');
    }

    args.push('--max-time', String(Math.floor(config.commandTimeoutMs / 1000)));
    args.push('--max-filesize', String(config.maxOutputBytes));
    args.push('-sS', url);

    return args;
  },
};
