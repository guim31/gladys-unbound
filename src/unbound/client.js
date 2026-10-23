// -----------------------------------------------------------------------------
// The commands this integration sends to Unbound, and nothing else:
//   - `status` and `stats_noreset`, read-only, at every reading. Never
//     `stats`: it resets the counters, under the feet of any other tool
//     reading them (and of this integration's own rates);
//   - `flush_zone <name>`, only from the "Flush the cache" action, which is
//     off until the user turns it on in the configuration.
// -----------------------------------------------------------------------------

import { TransportError, exchange } from './transport.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP answer: down, wrong address or port, firewall
  TLS: 'tls', // the TLS handshake failed: certificates, or a server in plain mode
  CLOSED: 'closed', // the connection was closed without an answer
  COMMAND: 'command', // Unbound answered "error ..."
  CERTIFICATES: 'certificates', // the certificates of the configuration are unusable
});

export class UnboundError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** A DNS name Unbound accepts in `flush_zone`: no space, no line break, no control character. */
export function isZoneName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 253 &&
    /^(\.|[A-Za-z0-9_*-]+(\.[A-Za-z0-9_-]+)*\.?)$/.test(name)
  );
}

export class UnboundClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {{ ca: string, cert: string, key: string }|null} options.tls
   * @param {Function} [options.exchange] transport seam (tests)
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, port, tls, exchange: send = exchange, timeoutMs = 10_000 }) {
    this.host = host;
    this.port = port;
    this.tls = tls;
    this.send = send;
    this.timeoutMs = timeoutMs;
  }

  async command(command) {
    let answer;
    try {
      answer = await this.send({
        host: this.host,
        port: this.port,
        tls: this.tls,
        command,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof TransportError || err.kind) {
        throw new UnboundError(err.kind, err.message);
      }
      throw err;
    }
    if (typeof answer !== 'string' || answer.trim() === '') {
      throw new UnboundError(ERROR_KINDS.CLOSED, `no answer to ${command}`);
    }
    if (answer.startsWith('error')) {
      throw new UnboundError(ERROR_KINDS.COMMAND, answer.trim().split('\n')[0].slice(0, 200));
    }
    return answer;
  }

  getStatus() {
    return this.command('status');
  }

  getStats() {
    return this.command('stats_noreset');
  }

  /** Remove `name` and everything below it from the caches ("." for all). */
  async flushZone(name) {
    if (!isZoneName(name)) {
      throw new UnboundError(ERROR_KINDS.COMMAND, 'invalid zone name');
    }
    return this.command(`flush_zone ${name}`);
  }
}
