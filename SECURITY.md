# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration stores nothing under `/data`. Its configuration, kept by
Gladys, holds the address of Unbound and, in TLS mode, the three files of
`unbound-control-setup`: the server certificate and the client certificate
(public) and the **client key** (a `secret` field, never shown again by
Gladys). The key gives full control of Unbound (stop, reload, change zones):
the integration never logs it, nor any certificate content, and only sends
`status`, `stats_noreset` and, if you turn the option on, `flush_zone`. It
talks only to the Unbound server you configure, on your local network, and
checks that the server presents the certificate you gave (named `unbound`).
In plain TCP mode (`control-use-cert: no`) the remote control has no
authentication at all: anyone who reaches the port can control Unbound, so
keep that port closed to the rest of the network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Unbound and the other third-party services and devices the integration
talks to.
