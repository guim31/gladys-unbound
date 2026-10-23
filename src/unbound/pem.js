// -----------------------------------------------------------------------------
// The certificates and the key of the remote control, as the user gives them:
// the content of the file pasted in a Gladys field, or the path of a file the
// container can read.
//
// A Gladys text field is a single-line input: the browser drops the line
// breaks of a pasted PEM file ("-----BEGIN CERTIFICATE-----MIID...-----END
// CERTIFICATE-----"), which OpenSSL then refuses. The blocks are rebuilt here:
// header, base64 body wrapped at 64 characters, footer.
//
// Never log what this module reads: the control key is a secret.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { X509Certificate, createPrivateKey } from 'node:crypto';

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

export class PemError extends Error {
  /** @param {'missing'|'unreadable'|'invalid'} reason */
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Rebuild the PEM blocks of a text whose line breaks may have been lost.
 * @returns {string|null} the blocks, one per line group; null when there is none
 */
export function normalizePem(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const blocks = [];
  for (const [, label, body] of text.matchAll(BLOCK)) {
    // Headers of encrypted legacy keys ("Proc-Type: ...") are not supported:
    // unbound-control-setup writes plain keys.
    const base64 = body.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
      return null;
    }
    const lines = base64.match(/.{1,64}/g) ?? [];
    blocks.push([`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join('\n'));
  }
  return blocks.length ? `${blocks.join('\n')}\n` : null;
}

/**
 * The PEM text of a configuration field: pasted content, or a file path.
 * @param {string} value
 * @param {{ readFile?: (path: string) => string }} [io]
 */
export function readPem(value, { readFile = (path) => readFileSync(path, 'utf8') } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new PemError('missing', 'missing');
  }
  if (text.includes('-----BEGIN')) {
    const pem = normalizePem(text);
    if (!pem) {
      throw new PemError('invalid', 'not a PEM block');
    }
    return pem;
  }
  if (!text.startsWith('/')) {
    throw new PemError('invalid', 'neither a PEM block nor an absolute path');
  }
  let content;
  try {
    content = readFile(text);
  } catch (err) {
    throw new PemError('unreadable', `cannot read the file (${err.code ?? err.message})`);
  }
  const pem = normalizePem(content);
  if (!pem) {
    throw new PemError('invalid', 'the file holds no PEM block');
  }
  return pem;
}

/** Check that a PEM text is a certificate (throws a PemError). */
export function checkCertificate(pem) {
  try {
    new X509Certificate(pem);
  } catch {
    throw new PemError('invalid', 'not a certificate');
  }
  return pem;
}

/** Check that a PEM text is a private key, without saying anything about it. */
export function checkPrivateKey(pem) {
  try {
    createPrivateKey(pem);
  } catch {
    throw new PemError('invalid', 'not a private key');
  }
  return pem;
}
