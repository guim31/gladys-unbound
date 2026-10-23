// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `unbound`.
//
// The use case: a glance at the resolver from the wall tablet, "is the DNS of
// the house all right?". Three tiles (queries per minute, cache hit rate,
// average recursion time) and one status list (state, SERVFAIL and NXDOMAIN
// per minute, uptime, version). When "Allow flushing the cache" is on, a
// "Flush the cache" button too. The figures are sent as values, not bound to
// device features, so the widget works before the device is added.
//
// Budget (8 components, 2 texts at most): 3 tiles + 1 status + 1 button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { serverName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_KINDS } from './unbound/client.js';
import { errorText, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ FLUSH: 'flush_cache' });

export const TEXT = {
  pick: {
    en: 'Enter the address of your Unbound server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur Unbound dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Unbound-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor Unbound en la configuración de la integración.',
  },
  waitingFigures: {
    en: 'Figures after the next reading…',
    fr: 'Chiffres après la prochaine lecture…',
    de: 'Zahlen nach der nächsten Abfrage…',
    es: 'Cifras tras la próxima lectura…',
  },
  queries: { en: 'Queries/min', fr: 'Requêtes/min', de: 'Anfragen/min', es: 'Consultas/min' },
  cache: { en: 'Cache', fr: 'Cache', de: 'Cache', es: 'Caché' },
  recursion: { en: 'Recursion', fr: 'Récursion', de: 'Rekursion', es: 'Recursión' },
  state: { en: 'Resolver', fr: 'Résolveur', de: 'Resolver', es: 'Resolutor' },
  running: { en: 'Running', fr: 'En service', de: 'In Betrieb', es: 'En servicio' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  servfail: {
    en: 'SERVFAIL/min',
    fr: 'SERVFAIL/min',
    de: 'SERVFAIL/min',
    es: 'SERVFAIL/min',
  },
  nxdomain: {
    en: 'NXDOMAIN/min',
    fr: 'NXDOMAIN/min',
    de: 'NXDOMAIN/min',
    es: 'NXDOMAIN/min',
  },
  uptime: { en: 'Uptime', fr: 'En service depuis', de: 'Betriebszeit', es: 'En marcha' },
  version: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
  flush: {
    en: 'Flush the cache',
    fr: 'Vider le cache',
    de: 'Cache leeren',
    es: 'Vaciar la caché',
  },
};

// Toast after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: { flushed: (count) => `Cache flushed: ${count} entries removed.` },
  fr: { flushed: (count) => `Cache vidé : ${count} entrées supprimées.` },
  de: { flushed: (count) => `Cache geleert: ${count} Einträge entfernt.` },
  es: { flushed: (count) => `Caché vaciada: ${count} entradas eliminadas.` },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "3 d 4 h", "5 h", "12 min". */
export function formatUptime(seconds) {
  if (typeof seconds !== 'number' || seconds < 0) {
    return null;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h`;
  }
  return `${Math.floor(seconds / 60)} min`;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

function stateRow(hub, record, language) {
  const label = t(TEXT.state, language);
  const error = hub.currentError();
  if (error) {
    return {
      label,
      icon: 'alert-triangle',
      value: fit(
        error.kind === ERROR_KINDS.UNREACHABLE
          ? t(TEXT.unreachable, language)
          : `${t(TEXT.error, language)} · ${errorText(error, language)}`,
        40,
      ),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!record || record.snapshot.reachable === null) {
    return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
  }
  return {
    label,
    icon: 'check-circle',
    value: fit(serverName(record.server), 40),
    color: WIDGET_COLORS.SUCCESS,
  };
}

async function get(hub, { language = 'en' }) {
  if (!hub.config?.server) {
    return message(TEXT.pick, language);
  }
  const record = hub.record;
  const snapshot = record && !hub.currentError() ? record.snapshot : null;
  const rates = snapshot?.rates ?? null;
  const components = [];
  if (rates && rates.queriesPerMinute !== null) {
    components.push({
      type: 'value',
      value: rates.queriesPerMinute,
      label: t(TEXT.queries, language),
      icon: 'activity',
    });
  }
  if (rates && rates.cacheHitRate !== null) {
    components.push({
      type: 'value',
      value: rates.cacheHitRate,
      unit: '%',
      label: t(TEXT.cache, language),
      icon: 'zap',
      color: WIDGET_COLORS.PRIMARY,
    });
  }
  if (rates && rates.recursionTimeMs !== null) {
    components.push({
      type: 'value',
      value: rates.recursionTimeMs,
      unit: 'ms',
      label: t(TEXT.recursion, language),
      icon: 'clock',
    });
  }
  if (snapshot && components.length < 3) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.waitingFigures, language) });
  }

  const items = [stateRow(hub, record, language)];
  if (snapshot) {
    const row = (text, icon, value, color = WIDGET_COLORS.NEUTRAL) => ({
      label: t(text, language),
      icon,
      value,
      color,
    });
    const alert = (value, threshold) =>
      threshold && value >= threshold ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL;
    if (rates?.servfailPerMinute !== null && rates?.servfailPerMinute !== undefined) {
      items.push(
        row(
          TEXT.servfail,
          'alert-circle',
          rates.servfailPerMinute,
          alert(rates.servfailPerMinute, hub.config.servfailAlert),
        ),
      );
    }
    if (rates?.nxdomainPerMinute !== null && rates?.nxdomainPerMinute !== undefined) {
      items.push(row(TEXT.nxdomain, 'help-circle', rates.nxdomainPerMinute));
    }
    const uptime = formatUptime(snapshot.status?.uptimeSeconds ?? snapshot.stats?.uptimeSeconds);
    if (uptime) {
      items.push(row(TEXT.uptime, 'power', uptime));
    }
    if (snapshot.status?.version) {
      items.push(row(TEXT.version, 'info', fit(snapshot.status.version, 40)));
    }
  }
  components.push({ type: 'status', items });
  if (hub.config.allowFlush && record) {
    components.push({
      type: 'button',
      label: t(TEXT.flush, language),
      icon: 'trash-2',
      style: 'secondary',
      action: { key: ACTIONS.FLUSH },
    });
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.FLUSH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const { removed } = await hub.flushCache('');
  return {
    message: Object.fromEntries(
      Object.entries(DONE_TEXT).map(([language, text]) => [language, text.flushed(removed)]),
    ),
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
