// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeUnbound, TLS_CONFIG, createClock, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now });
  const w = await createWorld({ clock, server, ...options });
  t.after(() => w.app.stop());
  return { ...w, server };
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected')),
    'the start is logged',
  );
  logs.clear();

  for (let i = 0; i < 5; i += 1) {
    w.server.traffic({ queries: 10, hits: 7, misses: 3, servfail: 1, recursionMs: 20 });
    w.clock.advance(30_000);
    await w.hub.pollNow();
  }
  assert.deepEqual(logs.texts(), []);
});

test('a server that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.pollNow();
  }
  const down = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(down.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines.length, 1);

  logs.clear();
  w.server.online = true;
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 5 min/);
});

test('a certificate problem is logged once, without the certificate', async (t) => {
  const logs = captureLogs(t);
  const broken = {
    ...TLS_CONFIG,
    control_cert: '-----BEGIN CERTIFICATE-----bm90IGEgY2VydA==-----END CERTIFICATE-----',
  };
  const w = await createWorld({ config: broken });
  t.after(() => w.app.stop());
  await w.hub.reconfigure(w.hub.config);
  const text = logs.texts().join('\n');
  assert.equal(logs.lines.length, 1, text);
  assert.match(text, /control_cert is invalid/);
  assert.doesNotMatch(text, /BEGIN|bm90/);
  assert.doesNotMatch(text, new RegExp(TLS_CONFIG.control_key.slice(40, 70).replace(/[+/]/g, '.')));
});

test('a threshold crossed is logged once, until the rate goes back below', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...TLS_CONFIG, queries_alert: 100 } });
  logs.clear();
  for (let i = 0; i < 4; i += 1) {
    w.server.traffic({ queries: 500, hits: 500 });
    w.clock.advance(60_000);
    await w.hub.pollNow();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /queries_per_minute 500/);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.server.traffic({ queries: 10 + i, hits: 5 });
    w.clock.advance(60_000);
    await w.hub.pollNow();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('LOG_LEVEL=debug shows each reading problem', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  w.server.online = false;
  await w.hub.pollNow();
  await w.hub.pollNow();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
});
