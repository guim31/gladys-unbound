// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Unbound server: its remote control address, and either the three
// files of unbound-control-setup (TLS, the default of Unbound) or nothing
// (`control-use-cert: no`, plain TCP). The certificates are read here, once:
// a problem with them is a configuration problem, reported in Gladys, never
// logged with their content.
// -----------------------------------------------------------------------------

import { PemError, checkCertificate, checkPrivateKey, readPem } from './unbound/pem.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const CONNECTION_MODES = ['tls', 'plain'];

export const DEFAULT_CONFIG = {
  host: '',
  name: '',
  connection: 'tls',
  server_cert: '',
  control_cert: '',
  control_key: '',
  poll_interval: '60',
  servfail_alert: 20,
  queries_alert: 2000,
  allow_flush: false,
  language: 'fr',
};

// The remote control port of Unbound (`control-port`).
export const DEFAULT_PORT = 8953;
export const MAX_ALERT = 1_000_000;
const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user: `192.0.2.10`, `dns.home:8953`,
 * `[2001:db8::1]:8953`. No scheme, no path.
 * @returns {{ host: string, port: number }|null}
 */
export function parseAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '');
  if (!text || /[\s/@]/.test(text)) {
    return null;
  }
  let host = text;
  let port = DEFAULT_PORT;
  const bracketed = text.match(/^\[([0-9a-f:.]+)\](?::(\d+))?$/i);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] ? Number(bracketed[2]) : DEFAULT_PORT;
  } else if ((text.match(/:/g) ?? []).length === 1) {
    const [name, typedPort] = text.split(':');
    host = name;
    port = Number(typedPort);
  } else if (text.includes(':') && !/^[0-9a-f:.]+$/i.test(text)) {
    return null; // several colons: only a bare IPv6 address
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  if (!/^[0-9a-z.:_-]+$/i.test(host)) {
    return null;
  }
  return { host, port };
}

/** Number of a threshold field: integer, 0 (off) to MAX_ALERT. */
function threshold(value, fallback) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(MAX_ALERT, Math.round(parsed));
}

/**
 * The three files of the TLS mode.
 * @returns {{ tls: object|null, problem: string|null }} `problem`: the field
 *   at fault and why (`server_cert:missing`...), never the content
 */
export function readCredentials(source, io) {
  const read = (key, check) => {
    try {
      return { pem: check(readPem(source[key], io)) };
    } catch (err) {
      if (err instanceof PemError) {
        return { problem: `${key}:${err.reason}` };
      }
      throw err;
    }
  };
  const ca = read('server_cert', checkCertificate);
  const cert = read('control_cert', checkCertificate);
  const key = read('control_key', checkPrivateKey);
  const problem = ca.problem ?? cert.problem ?? key.problem ?? null;
  return problem
    ? { tls: null, problem }
    : { tls: { ca: ca.pem, cert: cert.pem, key: key.pem }, problem: null };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @param {object} [io] file seam for the certificate paths (tests)
 */
export function normalizeConfig(raw = {}, io) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typed = text('host');
  const address = typed ? parseAddress(typed) : null;
  const connection = pick('connection', CONNECTION_MODES);
  let tls = null;
  let problem = null;
  if (address && connection === 'tls') {
    ({ tls, problem } = readCredentials(source, io));
  }

  return {
    server: address
      ? {
          host: address.host,
          port: address.port,
          name: text('name').slice(0, MAX_NAME_LENGTH) || null,
        }
      : null,
    invalidAddress: Boolean(typed) && !address,
    connection,
    tls,
    // A certificate problem: the server is configured but cannot be read.
    credentialsProblem: problem,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    servfailAlert: threshold(source.servfail_alert, DEFAULT_CONFIG.servfail_alert),
    queriesAlert: threshold(source.queries_alert, DEFAULT_CONFIG.queries_alert),
    allowFlush: source.allow_flush === true || source.allow_flush === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Host part shown to the user. */
export const addressOf = (server) =>
  server.port === DEFAULT_PORT
    ? server.host
    : `${server.host.includes(':') ? `[${server.host}]` : server.host}:${server.port}`;
