// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2.0 never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the server must be read
// by the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeUnbound,
  TLS_CONFIG,
  createAll,
  createClock,
  createWorld,
  featureId,
} from './helpers/world.js';

/** Let the timer callback and the fake server settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const reads = (server) => server.commands.filter((c) => c === 'stats_noreset').length;

test('the internal timer reads the server without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now });
  const w = await createWorld({
    clock,
    server,
    config: { ...TLS_CONFIG, poll_interval: '60' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');
  const before = reads(server);

  for (const queries of [80, 100, 120]) {
    server.traffic({ queries });
    clock.advance(60_000);
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(w.fake.lastState(featureId(w.gladys, 'queries_per_minute')), 120);
  assert.equal(reads(server) - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now });
  const w = await createWorld({ clock, server, timers: true });
  await w.app.stop();
  const before = server.commands.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(server.commands.length, before);
});
