// -----------------------------------------------------------------------------
// A fake Unbound remote control, behind the transport seam of the client
// (src/unbound/transport.js `exchange`). Its answers are the real ones of
// Unbound 1.25.2 (test/fixtures/unbound/real/), with the counters this
// integration reads replaced by the fake's own.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { TransportError } from '../../src/unbound/transport.js';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/unbound/real/${name}`, import.meta.url), 'utf8');

export const REAL = {
  stats: fixture('stats-noreset-extended.txt'),
  status: fixture('status.txt'),
  flush: fixture('flush-zone-root.txt'),
  unknownCommand: fixture('error-unknown-command.txt'),
};

// Keys of the extended statistics (extended-statistics: yes).
const EXTENDED = /^(num\.|unwanted\.|msg\.cache|rrset\.cache|infra\.cache|key\.cache|mem\.)/;

export class FakeUnbound {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now] the clock (ms)
   * @param {boolean} [options.extended] extended-statistics
   * @param {'tls'|'plain'} [options.mode] what the server expects
   */
  constructor({ now = () => Date.now(), extended = true, mode = 'tls' } = {}) {
    this.now = now;
    this.extended = extended;
    this.mode = mode;
    this.online = true;
    this.startedAt = now() - 3 * 3600_000 - 120_000;
    this.counters = {
      queries: 1000,
      cachehits: 600,
      cachemiss: 400,
      recursivereplies: 400,
      recursionAvg: 0.04,
      servfail: 5,
      nxdomain: 50,
    };
    /** Commands received, in order. */
    this.commands = [];
  }

  /** Some traffic: counters go up. */
  traffic({ queries = 0, hits = 0, misses = 0, servfail = 0, nxdomain = 0, recursionMs } = {}) {
    const c = this.counters;
    const replies = c.recursivereplies + misses;
    if (misses > 0 && recursionMs !== undefined) {
      c.recursionAvg =
        (c.recursionAvg * c.recursivereplies + (recursionMs / 1000) * misses) / replies;
    }
    c.queries += queries;
    c.cachehits += hits;
    c.cachemiss += misses;
    c.recursivereplies = replies;
    c.servfail += servfail;
    c.nxdomain += nxdomain;
  }

  /** Unbound restarts: counters back to zero. */
  restart() {
    this.startedAt = this.now();
    Object.assign(this.counters, {
      queries: 0,
      cachehits: 0,
      cachemiss: 0,
      recursivereplies: 0,
      recursionAvg: 0,
      servfail: 0,
      nxdomain: 0,
    });
  }

  statsText() {
    const c = this.counters;
    const now = this.now() / 1000;
    const up = (this.now() - this.startedAt) / 1000;
    const values = {
      'total.num.queries': c.queries,
      'total.num.cachehits': c.cachehits,
      'total.num.cachemiss': c.cachemiss,
      'total.num.recursivereplies': c.recursivereplies,
      'total.recursion.time.avg': c.recursionAvg.toFixed(6),
      'time.now': now.toFixed(6),
      'time.up': up.toFixed(6),
      'time.elapsed': up.toFixed(6),
      'num.answer.rcode.SERVFAIL': c.servfail,
      'num.answer.rcode.NXDOMAIN': c.nxdomain,
    };
    return (
      REAL.stats
        .split('\n')
        .filter((line) => line && (this.extended || !EXTENDED.test(line)))
        .map((line) => {
          const key = line.slice(0, line.indexOf('='));
          return key in values ? `${key}=${values[key]}` : line;
        })
        .join('\n') + '\n'
    );
  }

  statusText() {
    const up = Math.floor((this.now() - this.startedAt) / 1000);
    return REAL.status.replace(/^uptime: \d+ seconds$/m, `uptime: ${up} seconds`);
  }

  /** The transport seam: one command, one answer. */
  exchange = async ({ tls, command }) => {
    if (!this.online) {
      throw new TransportError('unreachable', 'ECONNREFUSED');
    }
    if (this.mode === 'tls' && !tls) {
      throw new TransportError('closed', 'connection closed (ECONNRESET)');
    }
    if (this.mode === 'plain' && tls) {
      throw new TransportError('tls', 'TLS: ERR_SSL_WRONG_VERSION_NUMBER');
    }
    this.commands.push(command);
    if (command === 'stats_noreset') {
      return this.statsText();
    }
    if (command === 'status') {
      return this.statusText();
    }
    if (command.startsWith('flush_zone ')) {
      return REAL.flush;
    }
    return REAL.unknownCommand.replace('bogus_cmd', command);
  };
}
