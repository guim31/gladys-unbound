// -----------------------------------------------------------------------------
// Reading the answers of Unbound, and turning its counters into rates.
//
// `stats_noreset` gives counters since the start of Unbound (or since the
// last `stats`, which resets them): `key=value` lines. The rates per minute
// are the difference between two readings, divided by the time between them,
// measured by Unbound itself (`time.now`). The cache hit rate and the average
// recursion time are computed over a sliding window of 15 minutes: over one
// reading of 30 s they would jump with each query. At the first reading, they
// are the values since the start of Unbound.
//
// A counter going down means Unbound restarted, or something ran
// `unbound-control stats` (reset): the history is dropped, and rates come
// back at the next reading.
//
// The answer codes (SERVFAIL, NXDOMAIN) are extended statistics: present
// only with `extended-statistics: yes` in unbound.conf.
// -----------------------------------------------------------------------------

export const WINDOW_MS = 15 * 60_000;
export const MIN_SPAN_MS = 20_000;

const number = (value) => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * @param {string} text the answer of `stats_noreset`
 * @returns {object|null} the figures this integration uses; null when the
 *   text is not a statistics answer
 */
export function parseStats(text) {
  const values = new Map();
  for (const line of String(text).split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) {
      values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
    }
  }
  const queries = number(values.get('total.num.queries'));
  const now = number(values.get('time.now'));
  if (queries === null || now === null) {
    return null;
  }
  const extended = values.has('num.answer.rcode.SERVFAIL');
  return {
    at: Math.round(now * 1000),
    uptimeSeconds: number(values.get('time.up')),
    queries,
    cacheHits: number(values.get('total.num.cachehits')) ?? 0,
    cacheMisses: number(values.get('total.num.cachemiss')) ?? 0,
    prefetch: number(values.get('total.num.prefetch')) ?? 0,
    recursiveReplies: number(values.get('total.num.recursivereplies')) ?? 0,
    recursionAvgSeconds: number(values.get('total.recursion.time.avg')) ?? 0,
    recursionMedianSeconds: number(values.get('total.recursion.time.median')),
    servfail: extended ? (number(values.get('num.answer.rcode.SERVFAIL')) ?? 0) : null,
    nxdomain: extended ? (number(values.get('num.answer.rcode.NXDOMAIN')) ?? 0) : null,
    extended,
  };
}

/**
 * @param {string} text the answer of `status`
 * @returns {{ version: string|null, uptimeSeconds: number|null, threads: number|null }|null}
 */
export function parseStatus(text) {
  const read = (name) =>
    String(text)
      .match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]
      .trim();
  const version = read('version') ?? null;
  if (!version && !/is running/.test(String(text))) {
    return null;
  }
  return {
    version: version ? version.slice(0, 40) : null,
    uptimeSeconds: number(read('uptime')?.match(/^\d+/)?.[0]),
    threads: number(read('threads')),
  };
}

/** Parse the answer of `flush_zone`: the number of entries removed. */
export function parseFlush(text) {
  const match = String(text).match(/removed (\d+) rrsets, (\d+) messages and (\d+) key entries/);
  if (!match) {
    return null;
  }
  const [rrsets, messages, keys] = match.slice(1).map(Number);
  return { rrsets, messages, keys, removed: rrsets + messages + keys };
}

const perMinute = (delta, ms) => (ms > 0 ? Math.round((delta * 60_000) / ms) : null);

/** The figures that went down between two readings (a restart, or a reset). */
function wentDown(older, newer) {
  return (
    newer.queries < older.queries ||
    newer.cacheHits < older.cacheHits ||
    newer.cacheMisses < older.cacheMisses ||
    newer.recursiveReplies < older.recursiveReplies ||
    (newer.servfail ?? 0) < (older.servfail ?? 0) ||
    (newer.nxdomain ?? 0) < (older.nxdomain ?? 0) ||
    (older.uptimeSeconds !== null &&
      newer.uptimeSeconds !== null &&
      newer.uptimeSeconds < older.uptimeSeconds)
  );
}

/**
 * The readings of the last 15 minutes, and the rates they give.
 */
export class Rates {
  constructor({ windowMs = WINDOW_MS } = {}) {
    this.windowMs = windowMs;
    /** @type {object[]} parsed statistics, oldest first */
    this.samples = [];
  }

  reset() {
    this.samples = [];
  }

  /**
   * Add a reading; returns the rates.
   * @param {object} stats parseStats() output
   * @returns {{ queriesPerMinute: number|null, servfailPerMinute: number|null,
   *   nxdomainPerMinute: number|null, cacheHitRate: number|null,
   *   recursionTimeMs: number|null, restarted: boolean }}
   */
  add(stats) {
    let last = this.samples.at(-1);
    let restarted = false;
    if (last && (stats.at <= last.at || wentDown(last, stats))) {
      restarted = stats.at > last.at;
      this.samples = [];
      last = undefined;
    }
    this.samples.push(stats);
    // Keep the oldest reading still in the window, plus the one just before
    // it, so the window spans 15 minutes once the integration runs that long.
    while (this.samples.length > 2 && this.samples[1].at <= stats.at - this.windowMs) {
      this.samples.shift();
    }

    const rates = {
      queriesPerMinute: null,
      servfailPerMinute: null,
      nxdomainPerMinute: null,
      cacheHitRate: null,
      recursionTimeMs: null,
      restarted,
    };
    if (last) {
      // A reading asked by a scene a few seconds after the timer's would
      // turn a burst into a huge rate: measure from a reading at least
      // MIN_SPAN_MS older when there is one.
      const older = this.samples.slice(0, -1);
      const base =
        older.findLast((sample) => sample.at <= stats.at - MIN_SPAN_MS) ?? older[0] ?? last;
      const ms = stats.at - base.at;
      rates.queriesPerMinute = perMinute(stats.queries - base.queries, ms);
      if (stats.extended && base.extended) {
        rates.servfailPerMinute = perMinute(stats.servfail - base.servfail, ms);
        rates.nxdomainPerMinute = perMinute(stats.nxdomain - base.nxdomain, ms);
      }
    }

    // Over the window, or since the start of Unbound at the first reading.
    const first = this.samples.length > 1 ? this.samples[0] : null;
    const hits = stats.cacheHits - (first?.cacheHits ?? 0);
    const misses = stats.cacheMisses - (first?.cacheMisses ?? 0);
    if (hits + misses > 0) {
      rates.cacheHitRate = Math.round((100 * hits) / (hits + misses));
    }
    const replies = stats.recursiveReplies - (first?.recursiveReplies ?? 0);
    if (replies > 0) {
      const total =
        stats.recursionAvgSeconds * stats.recursiveReplies -
        (first ? first.recursionAvgSeconds * first.recursiveReplies : 0);
      // The averages are printed with 6 decimals: never below zero.
      rates.recursionTimeMs = Math.max(0, Math.round((1000 * total) / replies));
    }
    return rates;
  }
}
