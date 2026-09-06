import { tokenize } from './tokenize.js';
import { registry } from './registry.js';
import { ValidationError } from './errors.js';

export function validateCommand(rawLine) {
  const tokens = tokenize(rawLine.trim());

  if (tokens.length === 0) {
    throw new ValidationError('empty command');
  }

  const [binary, ...rest] = tokens;
  const tool = registry.get(binary);

  if (!tool) {
    throw new ValidationError(`command not allowed: ${binary}`);
  }

  const args = tool.parse(rest);

  return { binary: tool.binary, args, timeoutMs: tool.timeoutMs };
}

export { ValidationError };
