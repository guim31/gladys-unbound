// -----------------------------------------------------------------------------
// One exchange on the Unbound remote control (unbound-control's protocol): a
// TCP connection, wrapped in TLS with the client certificate unless the
// server runs with `control-use-cert: no`, the line `UBCT1 <command>\n`, then
// everything Unbound writes until it closes the connection.
//
// TLS: the server certificate of unbound-control-setup is self-signed, with
// the common name "unbound" and no host name: it is checked against the
// certificate given in the configuration (pinned), and its name must be
// "unbound", as unbound-control does. The address typed by the user plays no
// part in the check (an IP is the common case).
// -----------------------------------------------------------------------------

import net from 'node:net';
import tls from 'node:tls';

export const PROTOCOL_PREFIX = 'UBCT1 ';
export const SERVER_NAME = 'unbound';

// What a statistics answer can weigh: a few hundred lines with the extended
// statistics; refuse a stream that never ends.
const MAX_ANSWER_BYTES = 1024 * 1024;

export class TransportError extends Error {
  /**
   * @param {'unreachable'|'tls'|'closed'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const TLS_CODES = new Set([
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
]);

function classify(err, phase) {
  const code = err.code ?? '';
  if (err instanceof TransportError) {
    return err;
  }
  if (TLS_CODES.has(code) || code.startsWith('ERR_SSL_') || /ssl|tls|certificate/i.test(code)) {
    return new TransportError('tls', `TLS: ${code || err.message}`);
  }
  if (code === 'ECONNRESET' && phase === 'handshake') {
    // Unbound drops the handshake of a client certificate it did not sign.
    return new TransportError('tls', 'TLS: connection reset during the handshake');
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return new TransportError('closed', `connection closed (${code})`);
  }
  return new TransportError('unreachable', code || err.message);
}

/** Check the server certificate the way unbound-control does: its name is "unbound". */
export function checkServerIdentity(_host, cert) {
  if (cert?.subject?.CN === SERVER_NAME) {
    return undefined;
  }
  const error = new Error(`server certificate name ${cert?.subject?.CN ?? '?'}, not unbound`);
  error.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
  return error;
}

/**
 * Send one command and read the whole answer.
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {{ ca: string, cert: string, key: string }|null} options.tls null: plain TCP
 * @param {string} options.command e.g. "stats_noreset"
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string>}
 */
export function exchange({ host, port, tls: credentials, command, timeoutMs = 10_000 }) {
  return new Promise((resolve, reject) => {
    let phase = 'connect';
    let settled = false;
    const chunks = [];
    let size = 0;
    const socket = credentials
      ? tls.connect({
          host,
          port,
          ca: credentials.ca,
          cert: credentials.cert,
          key: credentials.key,
          servername: SERVER_NAME,
          checkServerIdentity,
          minVersion: 'TLSv1.2',
        })
      : net.connect({ host, port });
    phase = credentials ? 'handshake' : 'connect';

    const finish = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) {
        reject(classify(err, phase));
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => finish(new TransportError('unreachable', `no answer in ${timeoutMs} ms`)),
      timeoutMs,
    );

    socket.once(credentials ? 'secureConnect' : 'connect', () => {
      phase = 'exchange';
      socket.write(`${PROTOCOL_PREFIX}${command}\n`);
    });
    socket.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_ANSWER_BYTES) {
        finish(new TransportError('closed', 'answer too large'));
        return;
      }
      chunks.push(chunk);
    });
    socket.on('error', (err) => finish(err));
    socket.on('close', () => {
      if (phase !== 'exchange') {
        finish(new TransportError(credentials ? 'tls' : 'closed', 'connection closed early'));
        return;
      }
      finish(null, Buffer.concat(chunks).toString('utf8'));
    });
  });
}
