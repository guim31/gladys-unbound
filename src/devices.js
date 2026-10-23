// -----------------------------------------------------------------------------
// One Gladys device: the Unbound server.
//
// Identity: a fixed id ("server"), not the address: moving Unbound to another
// IP, or switching from plain TCP to TLS, keeps the device and its history.
// Unbound exposes no instance id to use instead.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - reachable: input/binary, 1 when the remote control answers;
//   - queries per minute, SERVFAIL and NXDOMAIN answers per minute:
//     counter-sensor/integer, between two readings. SERVFAIL and NXDOMAIN
//     need `extended-statistics: yes`: without it, the device does not have
//     them, and gains them once it is on ("Update" in the Discovery tab);
//   - cache hit rate: counter-sensor/integer in % (Gladys has no decimal
//     percentage sensor), over the last 15 minutes;
//   - average recursion time: duration/integer in ms, over the last 15 minutes;
//   - uptime: duration/integer in hours;
//   - version: text/text.
//
// The devices are published with should_poll: false: the integration reads
// the server on its own timer (src/hub.js), at the interval chosen in the
// configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { addressOf } from './config.js';

export const DEVICE_TYPE = 'unbound';
export const DEVICE_ID = 'server';
export const ADDRESS_PARAM = 'UNBOUND_ADDRESS';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  QUERIES: 'queries_per_minute',
  CACHE_HIT_RATE: 'cache_hit_rate',
  RECURSION_TIME: 'recursion_time',
  SERVFAIL: 'servfail_per_minute',
  NXDOMAIN: 'nxdomain_per_minute',
  UPTIME: 'uptime',
  VERSION: 'version',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.REACHABLE]: 'Reachable',
    [FEATURE_KEYS.QUERIES]: 'DNS queries per minute',
    [FEATURE_KEYS.CACHE_HIT_RATE]: 'Cache hit rate',
    [FEATURE_KEYS.RECURSION_TIME]: 'Average recursion time',
    [FEATURE_KEYS.SERVFAIL]: 'SERVFAIL per minute',
    [FEATURE_KEYS.NXDOMAIN]: 'NXDOMAIN per minute',
    [FEATURE_KEYS.UPTIME]: 'Uptime',
    [FEATURE_KEYS.VERSION]: 'Version',
  },
  fr: {
    [FEATURE_KEYS.REACHABLE]: 'Joignable',
    [FEATURE_KEYS.QUERIES]: 'Requêtes DNS par minute',
    [FEATURE_KEYS.CACHE_HIT_RATE]: 'Taux de réponse du cache',
    [FEATURE_KEYS.RECURSION_TIME]: 'Temps de récursion moyen',
    [FEATURE_KEYS.SERVFAIL]: 'SERVFAIL par minute',
    [FEATURE_KEYS.NXDOMAIN]: 'NXDOMAIN par minute',
    [FEATURE_KEYS.UPTIME]: 'Temps de fonctionnement',
    [FEATURE_KEYS.VERSION]: 'Version',
  },
  de: {
    [FEATURE_KEYS.REACHABLE]: 'Erreichbar',
    [FEATURE_KEYS.QUERIES]: 'DNS-Anfragen pro Minute',
    [FEATURE_KEYS.CACHE_HIT_RATE]: 'Cache-Trefferquote',
    [FEATURE_KEYS.RECURSION_TIME]: 'Mittlere Rekursionszeit',
    [FEATURE_KEYS.SERVFAIL]: 'SERVFAIL pro Minute',
    [FEATURE_KEYS.NXDOMAIN]: 'NXDOMAIN pro Minute',
    [FEATURE_KEYS.UPTIME]: 'Betriebszeit',
    [FEATURE_KEYS.VERSION]: 'Version',
  },
  es: {
    [FEATURE_KEYS.REACHABLE]: 'Accesible',
    [FEATURE_KEYS.QUERIES]: 'Consultas DNS por minuto',
    [FEATURE_KEYS.CACHE_HIT_RATE]: 'Tasa de aciertos de caché',
    [FEATURE_KEYS.RECURSION_TIME]: 'Tiempo medio de recursión',
    [FEATURE_KEYS.SERVFAIL]: 'SERVFAIL por minuto',
    [FEATURE_KEYS.NXDOMAIN]: 'NXDOMAIN por minuto',
    [FEATURE_KEYS.UPTIME]: 'Tiempo de funcionamiento',
    [FEATURE_KEYS.VERSION]: 'Versión',
  },
};

// Display bounds (the core never applies them on write).
const RATE_MAX = 1_000_000;

const sensor = (key, value, extra = {}) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: RATE_MAX,
    ...extra,
  },
  value,
});

const extended = (snapshot) => Boolean(snapshot.stats?.extended);

// Order = display order in Gladys.
const FEATURES = [
  {
    key: FEATURE_KEYS.REACHABLE,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.INPUT,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (snapshot) => (snapshot.reachable === null ? null : snapshot.reachable ? 1 : 0),
  },
  sensor(FEATURE_KEYS.QUERIES, (snapshot) => snapshot.rates?.queriesPerMinute ?? null),
  sensor(FEATURE_KEYS.CACHE_HIT_RATE, (snapshot) => snapshot.rates?.cacheHitRate ?? null, {
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    max: 100,
  }),
  {
    ...sensor(FEATURE_KEYS.RECURSION_TIME, (snapshot) => snapshot.rates?.recursionTimeMs ?? null),
    definition: {
      ...sensor().definition,
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.MILLISECONDS,
      max: 60_000,
    },
  },
  {
    ...sensor(FEATURE_KEYS.SERVFAIL, (snapshot) => snapshot.rates?.servfailPerMinute ?? null),
    when: extended,
  },
  {
    ...sensor(FEATURE_KEYS.NXDOMAIN, (snapshot) => snapshot.rates?.nxdomainPerMinute ?? null),
    when: extended,
  },
  {
    key: FEATURE_KEYS.UPTIME,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.HOURS,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 1_000_000,
    },
    value: (snapshot) => {
      const seconds = snapshot.status?.uptimeSeconds ?? snapshot.stats?.uptimeSeconds;
      return typeof seconds === 'number' ? Math.floor(seconds / 3600) : null;
    },
  },
  {
    key: FEATURE_KEYS.VERSION,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      // NOT NULL in the core, even for a text.
      min: 0,
      max: 0,
    },
    value: (snapshot) => snapshot.status?.version ?? null,
  },
];

/** External ids of the device and its features. */
export const deviceIds = (gladys) => gladys.externalIds(DEVICE_TYPE, DEVICE_ID);

/** The name shown for the server: the one typed in the configuration, else its address. */
export const serverName = (server) => server.name ?? `Unbound ${addressOf(server)}`;

const present = (feature, snapshot) => !feature.when || feature.when(snapshot ?? {});

/** Whether the device of this snapshot carries the extended features. */
export const hasExtended = (snapshot) => extended(snapshot ?? {});

/**
 * The discovery payload of the server.
 * @param {object} gladys SDK client
 * @param {{ host: string, port: number, name: string|null }} server
 * @param {string} language feature names language
 * @param {object} [snapshot] the last reading (decides the extended features)
 */
export function buildDevice(gladys, server, language = 'en', snapshot = {}) {
  const ids = deviceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(server),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: ADDRESS_PARAM, value: addressOf(server) }],
    features: FEATURES.filter((feature) => present(feature, snapshot)).map(
      ({ key, definition }) => ({
        ...definition,
        name: names[key],
        external_id: ids.feature(key),
      }),
    ),
  };
}

/**
 * The value of every feature for a snapshot (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null }>}
 */
export function featureValues(gladys, snapshot) {
  const ids = deviceIds(gladys);
  return FEATURES.map((feature) => ({
    key: feature.key,
    externalId: ids.feature(feature.key),
    value: present(feature, snapshot) ? feature.value(snapshot) : null,
  }));
}
