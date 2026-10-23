// The configuration: the address, the certificates (pasted on one line, or
// a path), the thresholds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAddress } from '../src/config.js';
import { normalizePem, readPem } from '../src/unbound/pem.js';
import { CONTROL_KEY, SERVER_CERT, TLS_CONFIG, oneLine } from './helpers/world.js';

test('parseAddress: IP, name, port, IPv6', () => {
  assert.deepEqual(parseAddress('192.0.2.53'), { host: '192.0.2.53', port: 8953 });
  assert.deepEqual(parseAddress(' dns.home:9000 '), { host: 'dns.home', port: 9000 });
  assert.deepEqual(parseAddress('[2001:db8::1]:8953'), { host: '2001:db8::1', port: 8953 });
  assert.deepEqual(parseAddress('2001:db8::1'), { host: '2001:db8::1', port: 8953 });
  for (const bad of ['', 'a b', 'host:0', 'host:99999', 'user@host', 'host/path', 'a:b:c:zz']) {
    assert.equal(parseAddress(bad), null, bad);
  }
});

test('a PEM pasted on one line is rebuilt', () => {
  const rebuilt = normalizePem(oneLine(SERVER_CERT));
  assert.equal(rebuilt.trim(), SERVER_CERT.trim());
  assert.equal(normalizePem('no pem here'), null);
});

test('a certificate can be a path in the container', () => {
  const files = { '/data/unbound_server.pem': SERVER_CERT };
  const readFile = (path) => {
    if (!(path in files)) {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    }
    return files[path];
  };
  assert.equal(readPem('/data/unbound_server.pem', { readFile }).trim(), SERVER_CERT.trim());
  assert.throws(() => readPem('/data/missing.pem', { readFile }), { reason: 'unreadable' });
  assert.throws(() => readPem('relative.pem', { readFile }), { reason: 'invalid' });
  assert.throws(() => readPem('  ', { readFile }), { reason: 'missing' });
});

test('normalizeConfig: TLS with the three files', () => {
  const config = normalizeConfig(TLS_CONFIG);
  assert.deepEqual(config.server, { host: '192.0.2.53', port: 8953, name: 'Unbound' });
  assert.equal(config.connection, 'tls');
  assert.equal(config.credentialsProblem, null);
  assert.equal(config.tls.key.trim(), CONTROL_KEY.trim());
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.servfailAlert, 20);
  assert.equal(config.queriesAlert, 2000);
  assert.equal(config.allowFlush, false);
  assert.equal(config.language, 'en');
});

test('normalizeConfig names the certificate field at fault, never its content', () => {
  const swapped = normalizeConfig({ ...TLS_CONFIG, control_key: TLS_CONFIG.server_cert });
  assert.equal(swapped.credentialsProblem, 'control_key:invalid');
  assert.equal(swapped.tls, null);
  const missing = normalizeConfig({ ...TLS_CONFIG, server_cert: '' });
  assert.equal(missing.credentialsProblem, 'server_cert:missing');
  const keyAsCert = normalizeConfig({ ...TLS_CONFIG, control_cert: TLS_CONFIG.control_key });
  assert.equal(keyAsCert.credentialsProblem, 'control_cert:invalid');
});

test('normalizeConfig: plain TCP needs no certificate; defaults and bounds', () => {
  const config = normalizeConfig({ host: 'dns.home', connection: 'plain' });
  assert.equal(config.tls, null);
  assert.equal(config.credentialsProblem, null);
  assert.equal(config.language, DEFAULT_CONFIG.language);
  const odd = normalizeConfig({
    host: 'bad host',
    poll_interval: '7',
    servfail_alert: -3,
    queries_alert: '150',
    allow_flush: 'true',
  });
  assert.equal(odd.server, null);
  assert.equal(odd.invalidAddress, true);
  assert.equal(odd.pollIntervalMs, 60_000);
  assert.equal(odd.servfailAlert, 20);
  assert.equal(odd.queriesAlert, 150);
  assert.equal(odd.allowFlush, true);
  assert.equal(normalizeConfig({}).server, null);
  assert.equal(normalizeConfig({}).invalidAddress, false);
});

test('a client key that does not match the client certificate is named', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  // unbound-control-setup makes RSA keys: the key of another run.
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  assert.equal(
    normalizeConfig({ ...TLS_CONFIG, control_key: oneLine(other) }).credentialsProblem,
    'control_key:mismatch',
  );
});
