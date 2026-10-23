// -----------------------------------------------------------------------------
// The Unbound hub: the configured server, read on a timer of the container
// (the interval chosen in the configuration), its states published to Gladys
// when they change, its scene events fired on transitions, and the commands
// of the widget and the scene actions.
//
// Gladys never polls this device (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire even before the device is added.
// (Structure adapted from guim31/gladys-blocky.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressOf } from './config.js';
import { buildDevice, deviceIds, featureValues, hasExtended, serverName } from './devices.js';
import { ERROR_KINDS, UnboundClient, UnboundError, isZoneName } from './unbound/client.js';
import { Rates, parseFlush, parseStats, parseStatus } from './unbound/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  REPORT_TEXT,
  STATS_TEXT,
  errorText,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'unbound-hub' });

export const WIDGET_KEY = 'unbound';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNREACHABLE: 'resolver_unreachable',
  RECOVERED: 'resolver_recovered',
  SERVFAIL_HIGH: 'servfail_high',
  QUERIES_SURGE: 'queries_surge',
});

export const HUB_TIMINGS = {
  // An unchanged value is published again this often, so Gladys never shows
  // it as stale ("no recent value" after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the server counts as down (scene event).
  downAfterFailures: 2,
};

export class UnboundHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.exchange] transport seam (src/unbound/transport.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, exchange, timers = true, timings, now }) {
    this.gladys = gladys;
    this.exchange = exchange;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** The configured server, null when there is none. */
    this.record = null;
    this.transport = null;
    this.connection = null;
    /** Whether the published device carries the SERVFAIL/NXDOMAIN features. */
    this.extendedPublished = null;
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (server connected, lost, back, user
  // commands). A problem that repeats every cycle is logged once, then at
  // debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.transport = null;
    this.connection = null;
    await this.reconfigure(config);
    if (this.record) {
      await this.publishStates(this.record, { force: true });
    }
  }

  async reconfigure(config) {
    this.config = config;
    const signature = JSON.stringify([config.server?.host, config.server?.port, config.tls]);
    if (!config.server || config.credentialsProblem) {
      this.dropRecord();
    } else if (this.record?.signature !== signature) {
      this.dropRecord();
      this.record = this.newRecord(config, signature);
    } else {
      this.record.server = config.server; // a new name: same readings
    }
    for (const key of [...this.warned]) {
      if (key.startsWith('certificates:') && key !== `certificates:${config.credentialsProblem}`) {
        this.warned.delete(key);
      }
    }
    if (config.credentialsProblem) {
      const [field, reason] = config.credentialsProblem.split(':');
      this.problem(
        `certificates:${config.credentialsProblem}`,
        `Certificates: ${field} is ${reason}`,
      );
    }
    try {
      await this.publishDevices();
    } catch (err) {
      // Gladys refused the discovery: keep reading the server anyway (scene
      // events, widget); the device goes again at the next structure change,
      // search or reconnection.
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
    await this.pollNow();
    this.schedulePoll();
  }

  newRecord(config, signature) {
    return {
      server: config.server,
      signature,
      client: new UnboundClient({
        host: config.server.host,
        port: config.server.port,
        tls: config.connection === 'tls' ? config.tls : null,
        exchange: this.exchange,
      }),
      snapshot: { reachable: null, stats: null, status: null, rates: null },
      rates: new Rates(),
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      // Thresholds crossed: an event fires once, then again after a return below.
      above: { servfail: false, queries: false },
      polling: null,
      retryTimer: null,
    };
  }

  dropRecord() {
    if (this.record) {
      this.record.dropped = true;
      clearTimeout(this.record.retryTimer);
    }
    this.record = null;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.record?.retryTimer);
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.record) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Poll failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  label() {
    return `Unbound (${this.record ? addressOf(this.record.server) : '-'})`;
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [];
    if (this.config.server) {
      const snapshot = this.record?.snapshot ?? {};
      this.extendedPublished = hasExtended(snapshot);
      devices.push(buildDevice(this.gladys, this.config.server, this.config.language, snapshot));
    }
    // Even an empty list: the Discovery tab then shows no stale server.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: read the server, publish the device again. */
  async rediscover() {
    await this.pollNow();
    await this.publishDevices();
  }

  /** The user added the device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.record || device.external_id !== deviceIds(this.gladys).device) {
      return;
    }
    await this.publishStates(this.record, { force: true });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the server ----------------------------------------------------

  /** Read the server now (if any), then publish the transport and status. */
  async pollNow() {
    const changed = this.record ? await this.poll(this.record) : false;
    await this.afterChanges(changed);
  }

  /** Gladys asks for a refresh (onPoll): read the server now. */
  async pollDevice(device) {
    if (device.external_id === deviceIds(this.gladys).device) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    try {
      const [statusText, statsText] = await Promise.all([
        record.client.getStatus(),
        record.client.getStats(),
      ]);
      const status = parseStatus(statusText);
      const stats = parseStats(statsText);
      if (!status || !stats) {
        throw new UnboundError(ERROR_KINDS.COMMAND, 'unexpected answer to status or stats_noreset');
      }
      return await this.applySuccess(record, status, stats);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  async applySuccess(record, status, stats) {
    if (record.dropped) {
      return false;
    }
    const previous = record.snapshot;
    const wasDown = record.down;
    const downSince = record.downSince;
    const hadError = record.error;
    const rates = record.rates.add(stats);
    // Set before any await: a command running while an event is sent sees it.
    record.snapshot = { reachable: true, status, stats, rates };
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    record.error = null;
    if (wasDown) {
      const downMinutes = Math.round((this.now() - downSince) / 60_000);
      logger.info(`${this.label()} answers again after ${downMinutes} min`);
      await this.fire(record, TRIGGERS.RECOVERED, { down_minutes: downMinutes });
    } else if (hadError) {
      logger.info(`${this.label()}: connection restored`);
    } else if (previous.reachable === null) {
      logger.info(`${this.label()}: connected, Unbound ${status.version ?? '?'}`);
    }
    if (rates.restarted) {
      logger.info(`${this.label()}: counters went down (Unbound restarted, or stats reset)`);
    }

    await this.thresholds(record, rates);
    if (record.dropped) {
      return false;
    }
    if (this.extendedPublished !== stats.extended) {
      // extended-statistics was turned on or off: the device gains or loses
      // SERVFAIL/NXDOMAIN (Gladys proposes "Update" in the Discovery tab).
      try {
        await this.publishDevices();
      } catch (err) {
        this.problem('devices', `Discovered devices refused: ${err.message}`);
      }
    }
    await this.publishStates(record);
    return true;
  }

  /** Fire the threshold events on the way up, re-arm them on the way down. */
  async thresholds(record, rates) {
    const checks = [
      {
        key: 'servfail',
        trigger: TRIGGERS.SERVFAIL_HIGH,
        value: rates.servfailPerMinute,
        threshold: this.config.servfailAlert,
        variable: 'servfail_per_minute',
      },
      {
        key: 'queries',
        trigger: TRIGGERS.QUERIES_SURGE,
        value: rates.queriesPerMinute,
        threshold: this.config.queriesAlert,
        variable: 'queries_per_minute',
      },
    ];
    for (const check of checks) {
      if (!check.threshold) {
        record.above[check.key] = false;
        continue;
      }
      if (check.value === null) {
        continue; // no rate yet (first reading, restart), or the alert is off
      }
      const above = check.value >= check.threshold;
      if (above && !record.above[check.key]) {
        record.above[check.key] = true;
        logger.info(`${this.label()}: ${check.variable} ${check.value} ≥ ${check.threshold}`);
        await this.fire(record, check.trigger, {
          [check.variable]: check.value,
          threshold: check.threshold,
        });
      } else if (!above) {
        record.above[check.key] = false;
      }
    }
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.snapshot = { ...record.snapshot, reachable: false };
    if (wasError !== err.kind) {
      logger.warn(`${this.label()}: ${err.message}`);
    } else {
      logger.debug(`${this.label()}: ${err.message} (again)`);
    }
    // A failed reading leaves a hole: the rates start again afterwards.
    record.rates.reset();
    await this.publishStates(record);
    if (record.dropped) {
      return false;
    }
    // Only silence counts as down: certificates or a closed connection are a
    // configuration problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return true;
    }
    record.failures += 1;
    if (record.failures === 1) {
      if (!record.down) {
        record.downSince = this.now();
      }
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fire(record, TRIGGERS.UNREACHABLE, {
        error: errorText(err, this.config.language),
      });
    }
    return true;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  async fire(record, key, data) {
    if (record.dropped) {
      return;
    }
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys).device,
        server: serverName(record.server),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  async publishStates(record, { force = false } = {}) {
    if (!record || record.dropped) {
      return;
    }
    const states = [];
    for (const { externalId, value } of featureValues(this.gladys, record.snapshot)) {
      if (value === null) {
        continue;
      }
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    try {
      // The SDK keeps the last value per feature: only changes leave, plus
      // the heartbeat. A forced publication (device just added, Gladys
      // restarted) forgets them first, so everything is sent.
      if (force) {
        this.gladys.forgetPublishedStates(deviceIds(this.gladys).device);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransport();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransport() {
    if (!this.record || this.record.snapshot.reachable === null) {
      return;
    }
    const transport = this.record.snapshot.reachable
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
    if (this.transport === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([
        { external_id: deviceIds(this.gladys).device, transport },
      ]);
      this.transport = transport;
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The current problem, as `{ kind, field?, reason? }`, or null. */
  currentError() {
    if (this.config.credentialsProblem) {
      const [field, reason] = this.config.credentialsProblem.split(':');
      return { kind: ERROR_KINDS.CERTIFICATES, field, reason };
    }
    return this.record?.error ?? null;
  }

  /** The status under the integration name. */
  connectionStatus() {
    const { server, invalidAddress } = this.config;
    if (!server) {
      return {
        connected: false,
        message: invalidAddress ? CONNECTION_TEXT.invalidAddress : CONNECTION_TEXT.noServer,
      };
    }
    const error = this.currentError();
    if (!error) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = labelled(serverName(server), errorText(error, language), language).slice(
        0,
        200,
      );
    }
    return { connected: false, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------

  requireServer() {
    if (!this.record) {
      const error = this.currentError();
      throw new Error(
        error && this.config.server
          ? labelled(
              serverName(this.config.server),
              errorText(error, this.config.language),
              this.config.language,
            )
          : pick(ACTION_TEXT.noServer, this.config?.language),
      );
    }
    return this.record;
  }

  /**
   * Flush the cache: `name` and everything below it, or all of it.
   * Off unless "Allow flushing the cache" is on.
   * @param {string} [name] empty: the whole cache
   * @returns {Promise<{ removed: number, name: string }>}
   */
  async flushCache(name, language = this.config?.language) {
    if (!this.config?.allowFlush) {
      throw new Error(pick(ACTION_TEXT.flushDisabled, language));
    }
    const record = this.requireServer();
    const zone = typeof name === 'string' && name.trim() ? name.trim().toLowerCase() : '.';
    if (!isZoneName(zone)) {
      throw new Error(pick(ACTION_TEXT.invalidName, language));
    }
    try {
      const answer = await record.client.flushZone(zone);
      const result = parseFlush(answer);
      if (!result) {
        throw new UnboundError(ERROR_KINDS.COMMAND, `unexpected answer to flush_zone`);
      }
      logger.info(`${this.label()}: cache flushed (${zone}), ${result.removed} entries`);
      return { removed: result.removed, name: zone };
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.label()}: flush failed: ${err.message}`);
      throw new Error(labelled(serverName(record.server), errorText(err, language), language), {
        cause: err,
      });
    }
  }

  /** Device features are all read-only. */
  async setValue(_device, feature) {
    throw new Error(`Feature ${feature.external_id} cannot be controlled`);
  }

  // --- Reports ---------------------------------------------------------------

  /** "Test the connection": read the server now, one line. */
  async testConnection() {
    await this.pollNow();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const error = this.currentError();
      if (!this.config.server) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const name = serverName(this.config.server);
      if (error) {
        message[language] = labelled(name, errorText(error, language), language);
        continue;
      }
      const { status, stats } = this.record.snapshot;
      const parts = [text.ok, `Unbound ${status.version ?? '?'}`];
      parts.push(this.config.connection === 'tls' ? text.tls : text.plain);
      if (typeof status.uptimeSeconds === 'number') {
        parts.push(text.up(Math.floor(status.uptimeSeconds / 3600)));
      }
      parts.push(stats.extended ? text.extended : text.noExtended);
      message[language] = labelled(name, parts.join(', '), language);
    }
    return message;
  }

  /** "Read the statistics" scene action: read the server now. */
  async statistics() {
    const record = this.requireServer();
    await this.pollNow();
    if (record.error || this.record !== record) {
      throw new Error(
        labelled(
          serverName(record.server),
          errorText(record.error ?? { kind: ERROR_KINDS.UNREACHABLE }, this.config.language),
          this.config.language,
        ),
      );
    }
    const { rates } = record.snapshot;
    const figures = {
      queries: rates.queriesPerMinute,
      cache: rates.cacheHitRate,
      recursion: rates.recursionTimeMs,
      servfail: rates.servfailPerMinute,
    };
    const text = STATS_TEXT[this.config.language] ?? STATS_TEXT.en;
    return {
      sentence: text.sentence(figures),
      queries_per_minute: figures.queries ?? 0,
      cache_hit_rate: figures.cache ?? 0,
      recursion_time_ms: figures.recursion ?? 0,
      servfail_per_minute: figures.servfail ?? 0,
    };
  }
}
