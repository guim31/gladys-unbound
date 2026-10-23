// The parsers, on the real answers of Unbound 1.25.2, and the rates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rates, parseFlush, parseStats, parseStatus } from '../src/unbound/model.js';
import { REAL } from './helpers/fakeUnbound.js';

test('parseStats reads the real stats_noreset answer', () => {
  const stats = parseStats(REAL.stats);
  assert.equal(stats.queries, 9);
  assert.equal(stats.cacheHits, 4);
  assert.equal(stats.cacheMisses, 5);
  assert.equal(stats.recursiveReplies, 5);
  assert.equal(stats.recursionAvgSeconds, 0.016003);
  assert.equal(stats.servfail, 0);
  assert.equal(stats.nxdomain, 3);
  assert.equal(stats.extended, true);
  assert.equal(typeof stats.at, 'number');
});

test('without extended statistics, no SERVFAIL nor NXDOMAIN', () => {
  const plain = REAL.stats
    .split('\n')
    .filter((line) => !line.startsWith('num.'))
    .join('\n');
  const stats = parseStats(plain);
  assert.equal(stats.extended, false);
  assert.equal(stats.servfail, null);
  assert.equal(stats.nxdomain, null);
});

test('parseStats refuses what is not a statistics answer', () => {
  assert.equal(parseStats(REAL.status), null);
  assert.equal(parseStats(''), null);
});

test('parseStatus reads the version and the uptime', () => {
  assert.deepEqual(parseStatus(REAL.status), {
    version: '1.25.2',
    uptimeSeconds: 123,
    threads: 1,
  });
  assert.equal(parseStatus('hello'), null);
});

test('parseFlush counts the entries removed', () => {
  assert.deepEqual(parseFlush(REAL.flush), { rrsets: 4, messages: 2, keys: 0, removed: 6 });
  assert.equal(parseFlush('ok'), null);
});

const sample = (at, values = {}) => ({
  at,
  uptimeSeconds: at / 1000,
  queries: 0,
  cacheHits: 0,
  cacheMisses: 0,
  recursiveReplies: 0,
  recursionAvgSeconds: 0,
  servfail: 0,
  nxdomain: 0,
  extended: true,
  ...values,
});

test('rates per minute between two readings, cache and recursion since the start first', () => {
  const rates = new Rates();
  const first = rates.add(
    sample(600_000, {
      queries: 100,
      cacheHits: 80,
      cacheMisses: 20,
      recursiveReplies: 20,
      recursionAvgSeconds: 0.05,
    }),
  );
  assert.equal(first.queriesPerMinute, null);
  assert.equal(first.cacheHitRate, 80);
  assert.equal(first.recursionTimeMs, 50);

  const second = rates.add(
    sample(630_000, {
      queries: 200,
      cacheHits: 130,
      cacheMisses: 70,
      recursiveReplies: 70,
      // 20 replies at 50 ms, then 50 at 20 ms.
      recursionAvgSeconds: (20 * 0.05 + 50 * 0.02) / 70,
      servfail: 6,
      nxdomain: 3,
    }),
  );
  assert.equal(second.queriesPerMinute, 200); // 100 in 30 s
  assert.equal(second.servfailPerMinute, 12);
  assert.equal(second.nxdomainPerMinute, 6);
  assert.equal(second.cacheHitRate, 50); // 50 hits, 50 misses in the window
  assert.equal(second.recursionTimeMs, 20);
});

test('a reading a few seconds after the last one measures from an older one', () => {
  const rates = new Rates();
  rates.add(sample(0, { queries: 0 }));
  rates.add(sample(60_000, { queries: 600 }));
  const close = rates.add(sample(62_000, { queries: 700 }));
  // 700 queries in 62 s, not 100 in 2 s (3000 per minute).
  assert.equal(close.queriesPerMinute, 677);
});

test('a counter going down (restart, stats reset) drops the history', () => {
  const rates = new Rates();
  rates.add(sample(0, { queries: 500 }));
  const after = rates.add(sample(60_000, { queries: 10, uptimeSeconds: 5 }));
  assert.equal(after.restarted, true);
  assert.equal(after.queriesPerMinute, null);
  const next = rates.add(sample(120_000, { queries: 70, uptimeSeconds: 65 }));
  assert.equal(next.queriesPerMinute, 60);
});

test('the window keeps 15 minutes of readings', () => {
  const rates = new Rates();
  for (let minute = 0; minute <= 60; minute += 1) {
    rates.add(sample(minute * 60_000, { queries: minute * 10, cacheHits: minute * 10 }));
  }
  assert.ok(rates.samples.length <= 17, `${rates.samples.length} samples kept`);
  assert.ok(rates.samples[0].at <= 45 * 60_000);
});
