const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// Deliberately permissive but bounded — full RFC 4291 parsing isn't needed here,
// we only need to reject anything that isn't plausibly an IPv6 literal.
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;

export function isValidHostname(value) {
  return typeof value === 'string' && HOSTNAME_RE.test(value);
}

export function isValidIPv4(value) {
  return typeof value === 'string' && IPV4_RE.test(value);
}

export function isValidIPv6(value) {
  return typeof value === 'string' && value.includes(':') && IPV6_RE.test(value);
}

export function isValidHost(value) {
  return isValidHostname(value) || isValidIPv4(value) || isValidIPv6(value);
}

export function isValidPort(value) {
  if (!/^\d{1,5}$/.test(value)) return false;
  const n = Number(value);
  return n >= 1 && n <= 65535;
}

export function isSafeHeaderValue(value) {
  return typeof value === 'string' && !/[\r\n\0]/.test(value);
}
