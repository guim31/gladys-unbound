// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Unbound and a manual
// clock, with the integration wired on top through registerHandlers. No timer
// runs unless `timers: true` (with node:test mock timers): the tests read the
// server with `world.hub.pollNow()`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakeUnbound } from './fakeUnbound.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

const real = (name) =>
  readFileSync(new URL(`../fixtures/unbound/real/${name}`, import.meta.url), 'utf8');

// The certificates of a real unbound-control-setup (public parts). The key
// is made here: no private key in the repository.
export const SERVER_CERT = real('unbound_server.pem');
export const CONTROL_CERT = real('unbound_control.pem');
export const CONTROL_KEY = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

/** A PEM as a single-line input leaves it: no line breaks. */
export const oneLine = (pem) => pem.replace(/\r?\n/g, '');

export const HOST = '192.0.2.53';

export const TLS_CONFIG = {
  host: HOST,
  name: 'Unbound',
  connection: 'tls',
  server_cert: oneLine(SERVER_CERT),
  control_cert: oneLine(CONTROL_CERT),
  control_key: oneLine(CONTROL_KEY),
  language: 'en',
};

/** A manual clock, shared by the hub and the fake server. */
export function createClock(start = Date.UTC(2026, 9, 24, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  server,
  config = TLS_CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
} = {}) {
  const unbound = server ?? new FakeUnbound({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    exchange: unbound.exchange,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, app, hub: app.hub, clock, unbound };
}

export const deviceId = (gladys) => gladys.externalIds('unbound', 'server').device;
export const featureId = (gladys, key) => gladys.externalIds('unbound', 'server').feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** One minute of traffic, then a reading: the rates need two readings. */
export async function warmUp(
  world,
  traffic = { queries: 300, hits: 240, misses: 60, servfail: 3, nxdomain: 12, recursionMs: 35 },
) {
  world.clock.advance(60_000);
  world.unbound.traffic(traffic);
  await world.hub.pollNow();
}

export { FakeUnbound };
