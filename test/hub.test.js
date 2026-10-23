// The hub against the fake Unbound and the SDK's fake Gladys: states,
// transitions and their scene events, the commands, the widget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, formatUptime } from '../src/widgets.js';
import { FEATURE_KEYS } from '../src/devices.js';
import {
  FakeUnbound,
  TLS_CONFIG,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
  warmUp,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('the readings become states: rates, cache, recursion, uptime, version', async (t) => {
  const w = await world(t);
  await warmUp(w);
  const state = (key) => w.fake.lastState(featureId(w.gladys, key));
  assert.equal(state(FEATURE_KEYS.REACHABLE), 1);
  assert.equal(state(FEATURE_KEYS.QUERIES), 300);
  assert.equal(state(FEATURE_KEYS.SERVFAIL), 3);
  assert.equal(state(FEATURE_KEYS.NXDOMAIN), 12);
  // Window = both readings: 240 hits, 60 misses.
  assert.equal(state(FEATURE_KEYS.CACHE_HIT_RATE), 80);
  assert.equal(state(FEATURE_KEYS.RECURSION_TIME), 35);
  assert.equal(state(FEATURE_KEYS.UPTIME), 3);
  assert.equal(state(FEATURE_KEYS.VERSION), '1.25.2');
  assert.deepEqual(w.unbound.commands.slice(0, 2).sort(), ['stats_noreset', 'status']);
  assert.ok(!w.unbound.commands.includes('stats'), 'never the resetting command');
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false);
});

test('down after two failed reads, back with the minutes without answer', async (t) => {
  const w = await world(t);
  w.unbound.online = false;
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 0, 'one failure is a blip');
  w.clock.advance(15_000);
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.REACHABLE)), 0);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.clock.advance(4 * 60_000);
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 1, 'once');
  w.unbound.online = true;
  await w.hub.pollNow();
  const [back] = events(w, TRIGGERS.RECOVERED);
  assert.equal(back.data.down_minutes, 4);
  assert.equal(back.data.device, deviceId(w.gladys));
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('SERVFAIL and query thresholds fire once, then re-arm below', async (t) => {
  const w = await world(t, { config: { ...TLS_CONFIG, servfail_alert: 10, queries_alert: 1000 } });
  await warmUp(w, { queries: 100, hits: 50, misses: 50, servfail: 20 });
  await warmUp(w, { queries: 100, hits: 50, misses: 50, servfail: 30 });
  assert.equal(events(w, TRIGGERS.SERVFAIL_HIGH).length, 1);
  assert.deepEqual(events(w, TRIGGERS.SERVFAIL_HIGH)[0].data.threshold, 10);
  await warmUp(w, { queries: 100, hits: 50, misses: 50, servfail: 1 });
  await warmUp(w, { queries: 2000, hits: 50, misses: 50, servfail: 15 });
  assert.equal(events(w, TRIGGERS.SERVFAIL_HIGH).length, 2);
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE).length, 1);
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE)[0].data.queries_per_minute, 2000);
});

test('a threshold at 0 is off; no SERVFAIL event without extended statistics', async (t) => {
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now, extended: false });
  const w = await world(t, { clock, server, config: { ...TLS_CONFIG, queries_alert: 0 } });
  await warmUp(w, { queries: 99999, servfail: 0 });
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.equal(w.fake.discoveredDevices[0].features.length, 6);
});

test('turning extended statistics on republishes the device with SERVFAIL/NXDOMAIN', async (t) => {
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now, extended: false });
  const w = await world(t, { clock, server });
  assert.equal(w.fake.discoveredDevices[0].features.length, 6);
  server.extended = true;
  await warmUp(w);
  assert.equal(w.fake.discoveredDevices[0].features.length, 8);
});

test('a restart of Unbound drops the rates, without a false surge', async (t) => {
  const w = await world(t, { config: { ...TLS_CONFIG, queries_alert: 100 } });
  await warmUp(w, { queries: 10 });
  w.unbound.restart();
  await warmUp(w, { queries: 5 });
  await warmUp(w, { queries: 20 });
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.QUERIES)), 20);
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE).length, 0);
});

test('the device added in Gladys gets every state again, and the widget a refresh', async (t) => {
  const w = await world(t);
  await warmUp(w);
  const before = w.fake.states.length;
  await createAll(w);
  assert.equal(w.fake.states.length - before, 8);
  assert.ok(w.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('flushing is refused until allowed, then sends flush_zone', async (t) => {
  const off = await world(t);
  const refused = await off.fake.sceneAction('flush_cache', {});
  assert.equal(refused.success, false);
  assert.match(refused.error, /Allow flushing the cache/);
  assert.ok(!off.unbound.commands.some((c) => c.startsWith('flush')));

  const on = await world(t, { config: { ...TLS_CONFIG, allow_flush: true } });
  const all = await on.fake.sceneAction('flush_cache', {});
  assert.equal(all.success, true, all.error);
  assert.deepEqual(all.data.outputs, { removed: 6, name: '.' });
  const one = await on.fake.sceneAction('flush_cache', { name: ' Example.COM ' });
  assert.equal(one.data.outputs.name, 'example.com');
  assert.equal(on.unbound.commands.at(-1), 'flush_zone example.com');
  const bad = await on.fake.sceneAction('flush_cache', { name: 'a b\nstop' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Invalid domain name/);
});

test('read_statistics gives a sentence and figures', async (t) => {
  const w = await world(t);
  await warmUp(w);
  w.clock.advance(60_000);
  w.unbound.traffic({ queries: 120, hits: 60, misses: 60, servfail: 2, recursionMs: 35 });
  const ack = await w.fake.sceneAction('read_statistics', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.outputs.queries_per_minute, 120);
  assert.match(ack.data.outputs.sentence, /^Unbound: 120 queries per minute, \d+ % answered/);
  w.unbound.online = false;
  const failed = await w.fake.sceneAction('read_statistics', {});
  assert.equal(failed.success, false);
  assert.match(failed.error, /does not answer/);
});

test('plain TCP against a TLS server, and the reverse, say what is wrong', async (t) => {
  const plain = await world(t, {
    config: { host: '192.0.2.53', connection: 'plain', language: 'en' },
  });
  assert.match(plain.fake.connectionStatus.message.en, /TLS expected/);
  const clock = createClock();
  const server = new FakeUnbound({ now: clock.now, mode: 'plain' });
  const tls = await world(t, { clock, server });
  assert.match(tls.fake.connectionStatus.message.en, /TLS refused/);
  assert.equal(
    events(tls, TRIGGERS.UNREACHABLE).length,
    0,
    'a configuration problem, not an outage',
  );
});

test('a broken certificate field is named in the status, nothing is sent', async (t) => {
  const w = await world(t, { config: { ...TLS_CONFIG, server_cert: 'hello' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Server certificate: paste the whole file/);
  assert.equal(w.unbound.commands.length, 0);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.fr, /Certificat du serveur : collez tout le fichier/);
});

test('no address: an empty discovery and a message', async (t) => {
  const w = await world(t, { config: {} });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  const widget = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.match(widget.data.content.components[0].text, /Saisissez l'adresse/);
});

test('"Test the connection" reports the version, the mode, the uptime', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'Unbound: OK, Unbound 1.25.2, TLS, up for 3 h, extended statistics on',
  );
});

async function widget(w, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
  assert.equal(ack.success, true, ack.error);
  const tree = ack.data.content;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

test('the widget: three tiles, a status list, the flush button only when allowed', async (t) => {
  const w = await world(t);
  await warmUp(w);
  const tree = await widget(w);
  assert.deepEqual(
    tree.components.map((c) => c.type),
    ['value', 'value', 'value', 'status'],
  );
  assert.deepEqual(
    tree.components.slice(0, 3).map((c) => c.value),
    [300, 80, 35],
  );
  const labels = tree.components[3].items.map((item) => item.label);
  assert.deepEqual(labels, ['Resolver', 'SERVFAIL/min', 'NXDOMAIN/min', 'Uptime', 'Version']);

  const on = await world(t, { config: { ...TLS_CONFIG, allow_flush: true } });
  const withButton = await widget(on, 'de');
  assert.equal(withButton.components.at(-1).type, 'button');
  assert.equal(withButton.components.at(-1).label, 'Cache leeren');
  const tap = await on.fake.widgetAction(WIDGET_KEY, ACTIONS.FLUSH, {});
  assert.equal(tap.success, true, tap.error);
  assert.equal(tap.data.message.fr, 'Cache vidé : 6 entrées supprimées.');
});

test('the widget before the rates, and when Unbound does not answer', async (t) => {
  const w = await world(t);
  const first = await widget(w);
  assert.ok(
    first.components.some((c) => c.type === 'text'),
    'waiting for the second reading',
  );
  w.unbound.online = false;
  await w.hub.pollNow();
  const down = await widget(w, 'fr');
  assert.equal(down.components.length, 1);
  assert.equal(down.components[0].items[0].value, 'Injoignable');
});

test('formatUptime', () => {
  assert.equal(formatUptime(90_000), '1 d 1 h');
  assert.equal(formatUptime(7200), '2 h');
  assert.equal(formatUptime(600), '10 min');
  assert.equal(formatUptime(null), null);
});

test('a scene action right after the start raises no false surge', async (t) => {
  const w = await world(t, { config: { ...TLS_CONFIG, queries_alert: 100 } });
  w.clock.advance(2_000);
  w.unbound.traffic({ queries: 50 });
  const ack = await w.fake.sceneAction('read_statistics', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE).length, 0);
});

test('turning an alert off re-arms it', async (t) => {
  const w = await world(t, { config: { ...TLS_CONFIG, queries_alert: 100 } });
  await warmUp(w, { queries: 500 });
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE).length, 1);
  await w.fake.configUpdated({ ...TLS_CONFIG, queries_alert: 0 });
  await warmUp(w, { queries: 500 });
  await w.fake.configUpdated({ ...TLS_CONFIG, queries_alert: 100 });
  await warmUp(w, { queries: 500 });
  assert.equal(events(w, TRIGGERS.QUERIES_SURGE).length, 2);
});

test('a key that does not match the certificate is a configuration problem', async (t) => {
  const { generateKeyPairSync } = await import('node:crypto');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const w = await world(t, { config: { ...TLS_CONFIG, control_key: key } });
  assert.match(w.fake.connectionStatus.message.en, /Client key: does not match/);
  assert.equal(w.unbound.commands.length, 0);
});
