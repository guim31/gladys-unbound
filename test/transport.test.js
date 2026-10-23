// The remote control protocol, against a local TCP server speaking like
// Unbound with control-use-cert: no (loopback only). The TLS side was tested
// against a real Unbound 1.25.2 (see docs/en.md, "Tested").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { checkServerIdentity, exchange } from '../src/unbound/transport.js';
import { UnboundClient, isZoneName } from '../src/unbound/client.js';
import { REAL } from './helpers/fakeUnbound.js';

async function server(t, onLine) {
  const srv = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        onLine(buffer.slice(0, buffer.indexOf('\n')), socket);
      }
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  return srv.address().port;
}

test('sends "UBCT1 <command>" and reads until Unbound closes', async (t) => {
  const lines = [];
  const port = await server(t, (line, socket) => {
    lines.push(line);
    socket.end(REAL.status);
  });
  const answer = await exchange({ host: '127.0.0.1', port, tls: null, command: 'status' });
  assert.equal(answer, REAL.status);
  assert.deepEqual(lines, ['UBCT1 status']);
});

test('an "error" answer is a command error', async (t) => {
  const port = await server(t, (_line, socket) => socket.end(REAL.unknownCommand));
  const client = new UnboundClient({ host: '127.0.0.1', port, tls: null });
  await assert.rejects(client.getStats(), { kind: 'command' });
});

test('a closed port is unreachable, a silent server times out', async (t) => {
  const port = await server(t, () => {});
  await assert.rejects(
    exchange({ host: '127.0.0.1', port, tls: null, command: 'status', timeoutMs: 200 }),
    { kind: 'unreachable', message: /no answer/ },
  );
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const freePort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(
    exchange({ host: '127.0.0.1', port: freePort, tls: null, command: 'status' }),
    { kind: 'unreachable' },
  );
});

test('the server certificate must be named "unbound"', () => {
  assert.equal(checkServerIdentity('192.0.2.53', { subject: { CN: 'unbound' } }), undefined);
  assert.ok(checkServerIdentity('192.0.2.53', { subject: { CN: 'evil' } }) instanceof Error);
});

test('flush_zone only takes a DNS name: no command injection', async () => {
  for (const name of ['.', 'example.com', 'example.com.', '_tcp.example.com', 'a-b.c']) {
    assert.ok(isZoneName(name), name);
  }
  for (const name of ['', 'a b', 'example.com\nstop', 'a;b', '..', 'a..b', 'x'.repeat(254)]) {
    assert.ok(!isZoneName(name), JSON.stringify(name));
  }
  const client = new UnboundClient({
    host: '127.0.0.1',
    port: 1,
    tls: null,
    exchange: () => assert.fail('nothing sent'),
  });
  await assert.rejects(client.flushZone('example.com\nstop'), { kind: 'command' });
});
