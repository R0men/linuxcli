import { ValidationError } from './errors.js';

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t';
}

// Бэкслеш нарочно не имеет escape-семантики: любые метасимволы (`;`, `&&`,
// `|`, обратные кавычки, `$()`) остаются буквальными символами внутри
// токена — интерпретатор команд здесь не вызывается вообще, поэтому у них
// просто нет синтаксического значения.
export function tokenize(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    while (i < n && isWhitespace(line[i])) i++;
    if (i >= n) break;

    let token = '';
    let quoteChar = null;

    while (i < n) {
      const ch = line[i];

      if (quoteChar) {
        if (ch === quoteChar) {
          quoteChar = null;
          i++;
          continue;
        }
        token += ch;
        i++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quoteChar = ch;
        i++;
        continue;
      }

      if (isWhitespace(ch)) break;

      token += ch;
      i++;
    }

    if (quoteChar) {
      throw new ValidationError(`unterminated quote (${quoteChar}) in command`);
    }

    tokens.push(token);
  }

  return tokens;
}
