import { createHmac } from 'node:crypto';
import { config } from '../config.js';

export function hmacIp(ip) {
  return createHmac('sha256', config.ipHashSecret).update(ip).digest('hex');
}
