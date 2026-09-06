import { dig } from './tools/dig.js';
import { whois } from './tools/whois.js';
import { host } from './tools/host.js';
import { curl } from './tools/curl.js';
import { openssl } from './tools/openssl.js';
import { mtr } from './tools/mtr.js';
import { ping } from './tools/ping.js';
import { nc } from './tools/nc.js';

const tools = [dig, whois, host, curl, openssl, mtr, ping, nc];

export const registry = new Map(tools.map((tool) => [tool.binary, tool]));
