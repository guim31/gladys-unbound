// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (answers of a real Unbound 1.25.2): with and without the extended
// statistics, TLS and plain TCP, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeUnbound, TLS_CONFIG, createClock, createWorld, warmUp } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const plain = { host: 'dns.home:8953', connection: 'plain', language: 'en' };

const scenarios = [
  { label: 'TLS, extended statistics', config: TLS_CONFIG, extended: true, mode: 'tls', count: 8 },
  {
    label: 'plain TCP, no extended statistics',
    config: plain,
    extended: false,
    mode: 'plain',
    count: 6,
  },
  {
    label: 'French names',
    config: { ...TLS_CONFIG, language: 'fr' },
    extended: true,
    mode: 'tls',
    count: 8,
  },
  {
    label: 'German names',
    config: { ...TLS_CONFIG, language: 'de' },
    extended: true,
    mode: 'tls',
    count: 8,
  },
  {
    label: 'Spanish names',
    config: { ...TLS_CONFIG, language: 'es' },
    extended: true,
    mode: 'tls',
    count: 8,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const server = new FakeUnbound({
      now: clock.now,
      extended: scenario.extended,
      mode: scenario.mode,
    });
    const world = await createWorld({ clock, server, config: scenario.config });
    const { gladys, app } = world;
    try {
      await warmUp(world);
      const devices = gladys.fake.discoveredDevices;
      assert.ok(devices.length >= 1, 'no device discovered');
      assert.equal(devices.length, 1);
      assert.equal(devices[0].features.length, scenario.count);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          if (feature.category === 'text') {
            assert.equal(typeof value, 'string', `${at}: no text published`);
            assert.ok(value.length > 0, `${at}: an empty text is ignored by Gladys`);
            continue;
          }
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
