// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the sentence
// of the "Read the statistics" scene action, scene action errors. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './unbound/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Unbound server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Unbound dans la configuration.",
    de: 'Gib die Adresse deines Unbound-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Unbound en la configuración.',
  },
  invalidAddress: {
    en: 'Address not understood, e.g. 192.168.1.2 or 192.168.1.2:8953',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou 192.168.1.2:8953',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder 192.168.1.2:8953',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o 192.168.1.2:8953',
  },
};

// The certificate fields, as named in the configuration form.
export const FIELD_TEXT = {
  server_cert: {
    en: 'Server certificate',
    fr: 'Certificat du serveur',
    de: 'Serverzertifikat',
    es: 'Certificado del servidor',
  },
  control_cert: {
    en: 'Client certificate',
    fr: 'Certificat client',
    de: 'Client-Zertifikat',
    es: 'Certificado de cliente',
  },
  control_key: {
    en: 'Client key',
    fr: 'Clé client',
    de: 'Client-Schlüssel',
    es: 'Clave de cliente',
  },
};

// Why a certificate field is unusable (src/unbound/pem.js reasons).
export const PEM_TEXT = {
  missing: { en: 'empty', fr: 'vide', de: 'leer', es: 'vacío' },
  unreadable: {
    en: 'file not found in the container',
    fr: 'fichier introuvable dans le conteneur',
    de: 'Datei im Container nicht gefunden',
    es: 'archivo no encontrado en el contenedor',
  },
  mismatch: {
    en: 'does not match the client certificate',
    fr: 'ne correspond pas au certificat client',
    de: 'passt nicht zum Client-Zertifikat',
    es: 'no corresponde al certificado de cliente',
  },
  invalid: {
    en: 'paste the whole file, from -----BEGIN to -----END',
    fr: 'collez tout le fichier, de -----BEGIN à -----END',
    de: 'füge die ganze Datei ein, von -----BEGIN bis -----END',
    es: 'pegue el archivo completo, de -----BEGIN a -----END',
  },
};

// One short explanation per error kind (src/unbound/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (address, port 8953, control-interface?)',
    fr: 'ne répond pas (adresse, port 8953, control-interface ?)',
    de: 'antwortet nicht (Adresse, Port 8953, control-interface?)',
    es: 'no responde (¿dirección, puerto 8953, control-interface?)',
  },
  [ERROR_KINDS.TLS]: {
    en: 'TLS refused: check the three certificate fields',
    fr: 'TLS refusé : vérifiez les trois champs de certificats',
    de: 'TLS abgelehnt: Prüfe die drei Zertifikatsfelder',
    es: 'TLS rechazado: compruebe los tres campos de certificados',
  },
  [ERROR_KINDS.CLOSED]: {
    en: 'connection closed: TLS expected? (control-use-cert)',
    fr: 'connexion fermée : TLS attendu ? (control-use-cert)',
    de: 'Verbindung geschlossen: TLS erwartet? (control-use-cert)',
    es: 'conexión cerrada: ¿se espera TLS? (control-use-cert)',
  },
  [ERROR_KINDS.COMMAND]: {
    en: 'command refused by Unbound, see the logs',
    fr: 'commande refusée par Unbound, voir les logs',
    de: 'Befehl von Unbound abgelehnt, sieh in den Protokollen nach',
    es: 'orden rechazada por Unbound, consulte los registros',
  },
  [ERROR_KINDS.CERTIFICATES]: {
    en: 'certificates of the configuration unusable',
    fr: 'certificats de la configuration inutilisables',
    de: 'Zertifikate der Konfiguration unbrauchbar',
    es: 'certificados de la configuración inutilizables',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    tls: 'TLS',
    plain: 'plain TCP',
    up: (hours) => `up for ${hours} h`,
    extended: 'extended statistics on',
    noExtended: 'no SERVFAIL/NXDOMAIN (extended-statistics: no)',
  },
  fr: {
    ok: 'OK',
    tls: 'TLS',
    plain: 'TCP sans chiffrement',
    up: (hours) => `démarré depuis ${hours} h`,
    extended: 'statistiques étendues actives',
    noExtended: 'pas de SERVFAIL/NXDOMAIN (extended-statistics: no)',
  },
  de: {
    ok: 'OK',
    tls: 'TLS',
    plain: 'TCP unverschlüsselt',
    up: (hours) => `läuft seit ${hours} h`,
    extended: 'erweiterte Statistiken aktiv',
    noExtended: 'kein SERVFAIL/NXDOMAIN (extended-statistics: no)',
  },
  es: {
    ok: 'OK',
    tls: 'TLS',
    plain: 'TCP sin cifrar',
    up: (hours) => `en marcha desde hace ${hours} h`,
    extended: 'estadísticas ampliadas activas',
    noExtended: 'sin SERVFAIL/NXDOMAIN (extended-statistics: no)',
  },
};

const format = (value, locale) => new Intl.NumberFormat(locale).format(value);

// The sentence of the "Read the statistics" scene action (a message, a TTS).
// Figures may be missing right after a start: the clause is then left out.
export const STATS_TEXT = {
  en: {
    sentence: ({ queries, cache, recursion, servfail }) =>
      [
        'Unbound:',
        [
          queries === null ? null : `${format(queries, 'en')} queries per minute`,
          cache === null ? null : `${cache} % answered from the cache`,
          recursion === null ? null : `${format(recursion, 'en')} ms per recursion`,
          servfail === null ? null : `${format(servfail, 'en')} SERVFAIL per minute`,
        ]
          .filter(Boolean)
          .join(', ') || 'no figures yet',
      ].join(' ') + '.',
  },
  fr: {
    sentence: ({ queries, cache, recursion, servfail }) =>
      [
        'Unbound :',
        [
          queries === null ? null : `${format(queries, 'fr')} requêtes par minute`,
          cache === null ? null : `${cache} % servies par le cache`,
          recursion === null ? null : `${format(recursion, 'fr')} ms par récursion`,
          servfail === null ? null : `${format(servfail, 'fr')} SERVFAIL par minute`,
        ]
          .filter(Boolean)
          .join(', ') || 'pas encore de chiffres',
      ].join(' ') + '.',
  },
  de: {
    sentence: ({ queries, cache, recursion, servfail }) =>
      [
        'Unbound:',
        [
          queries === null ? null : `${format(queries, 'de')} Anfragen pro Minute`,
          cache === null ? null : `${cache} % aus dem Cache beantwortet`,
          recursion === null ? null : `${format(recursion, 'de')} ms pro Rekursion`,
          servfail === null ? null : `${format(servfail, 'de')} SERVFAIL pro Minute`,
        ]
          .filter(Boolean)
          .join(', ') || 'noch keine Zahlen',
      ].join(' ') + '.',
  },
  es: {
    sentence: ({ queries, cache, recursion, servfail }) =>
      [
        'Unbound:',
        [
          queries === null ? null : `${format(queries, 'es')} consultas por minuto`,
          cache === null ? null : `${cache} % respondidas desde la caché`,
          recursion === null ? null : `${format(recursion, 'es')} ms por recursión`,
          servfail === null ? null : `${format(servfail, 'es')} SERVFAIL por minuto`,
        ]
          .filter(Boolean)
          .join(', ') || 'aún no hay cifras',
      ].join(' ') + '.',
  },
};

// Errors of the scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Unbound server is configured.',
    fr: "Aucun serveur Unbound n'est configuré.",
    de: 'Kein Unbound-Server ist konfiguriert.',
    es: 'No hay ningún servidor Unbound configurado.',
  },
  flushDisabled: {
    en: 'Flushing the cache is off: turn on "Allow flushing the cache" in the configuration.',
    fr: 'Vider le cache est désactivé : activez « Autoriser à vider le cache » dans la configuration.',
    de: 'Cache leeren ist aus: Aktiviere „Cache leeren erlauben“ in der Konfiguration.',
    es: 'Vaciar la caché está desactivado: active «Permitir vaciar la caché» en la configuración.',
  },
  invalidName: {
    en: 'Invalid domain name, e.g. example.com (empty: the whole cache).',
    fr: 'Nom de domaine invalide, ex. example.com (vide : tout le cache).',
    de: 'Ungültiger Domainname, z. B. example.com (leer: der ganze Cache).',
    es: 'Nombre de dominio no válido, p. ej. example.com (vacío: toda la caché).',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** The explanation of an error (`{ kind, field?, reason? }`) in a language. */
export function errorText(error, language) {
  if (error.kind === ERROR_KINDS.CERTIFICATES && error.field && FIELD_TEXT[error.field]) {
    return labelled(
      pick(FIELD_TEXT[error.field], language),
      pick(PEM_TEXT[error.reason] ?? PEM_TEXT.invalid, language),
      language,
    );
  }
  return pick(ERROR_TEXT[error.kind] ?? ERROR_TEXT[ERROR_KINDS.COMMAND], language);
}
