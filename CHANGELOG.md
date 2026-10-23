# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device for the Unbound server, read over its remote control (TLS with
  the certificates of `unbound-control-setup`, or plain TCP): reachable, DNS
  queries per minute, cache hit rate and average recursion time (last 15
  minutes), SERVFAIL and NXDOMAIN per minute (with `extended-statistics`),
  uptime and version. Read-only by default: `status` and `stats_noreset`
  only, never the resetting `stats`.
- An "Unbound" dashboard widget: queries per minute, cache hit rate,
  recursion time, state of the resolver, SERVFAIL, NXDOMAIN, uptime and
  version, and a "Flush the cache" button when allowed.
- Scene triggers: Unbound no longer answers, Unbound answers again, SERVFAIL
  above the threshold, queries surging (thresholds in the configuration).
- Scene actions: read the statistics into a sentence, and flush the cache
  (one domain or all of it), off until "Allow flushing the cache" is turned
  on.
- A "Test the connection" button, and texts in English, French, German and
  Spanish.
