# Unbound for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows an [Unbound](https://nlnetlabs.nl/projects/unbound/about/)
recursive DNS resolver over its remote control, the channel of
`unbound-control`: statistics, alerts, and a cache flush you can turn on.

Unbound often sits behind Pi-hole, AdGuard Home or Blocky, as the resolver
they ask. Those have their own integrations for the blocking
([Blocky](https://github.com/guim31/gladys-blocky),
[Technitium](https://github.com/guim31/gladys-technitium),
[AdGuard Home](https://github.com/cicoub13/gladys-adguard-home)); this one
watches the resolver upstream.

## Features

- **One device** for the server: reachable, DNS queries per minute, cache hit
  rate and average recursion time (last 15 minutes), SERVFAIL and NXDOMAIN
  per minute (with `extended-statistics: yes`), uptime and version.
- **Dashboard widget**: the figures at a glance, the state of the resolver,
  and a _Flush the cache_ button when allowed.
- **Scene triggers**: Unbound no longer answers, answers again, SERVFAIL
  above a threshold, queries surging.
- **Scene actions**: read the statistics into a sentence (for a message or a
  voice announcement), and flush the cache, for one domain or all of it.
- **Read-only by default**: only `status` and `stats_noreset` are sent, never
  `stats` (which resets the counters). Flushing the cache stays off until it
  is turned on in the configuration.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Unbound with `control-enable: yes` and `control-interface` on an address
  Gladys reaches (port 8953), and either the certificates of
  `unbound-control-setup` (the default) or `control-use-cert: no`.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-unbound` (or
   install **Unbound** from the catalog once it is listed).
2. In **Configuration**, enter the address of the server, then paste the
   content of `unbound_server.pem`, `unbound_control.pem` and
   `unbound_control.key`. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## Checked on a real server, and what was not

Checked against a real **Unbound 1.25.2** (Alpine package in Docker, on an
isolated Docker network): TLS with the certificates of
`unbound-control-setup`, wrong certificates, plain TCP against a TLS port,
real `dig` queries including names that do not exist and failing lookups,
`flush_zone`, a stopped Unbound and its restart. The answers kept as
fixtures are in `test/fixtures/unbound/real/`.

Not checked: a real Gladys installation (the tests use the fake Gladys of the
SDK). Developed without a real Gladys: feedback welcome.

## Limitations

- One Unbound server per installation.
- The rates are measured between two readings (1 minute by default).
- A remote control on a Unix socket only cannot be reached from the
  container of Gladys.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Unbound (`test/helpers/fakeUnbound.js`) built from answers of
a real server. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Unbound](https://github.com/NLnetLabs/unbound) by NLnet Labs (BSD
  licence): its documentation and the protocol of `unbound-control`. No code
  was copied. Its logo
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unbound_logo_light-on-dark.svg),
  public domain, from the
  [Unbound manual](https://github.com/NLnetLabs/unbound-manual)) is used on
  the cover to say what the integration works with.
- [Blocky for Gladys](https://github.com/guim31/gladys-blocky): the
  architecture, adapted here.
- The conformity tests follow [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by NLnet Labs.
"Unbound" and its logo belong to their owners and are used here only to say
what the integration works with.

## License

Apache-2.0
