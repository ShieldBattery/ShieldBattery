# coordinator

The netcode-v2 coordinator box (rally-point2): session placement, the relay
identity ledger, and on-demand Fargate relay provisioning. Runs beside the app
servers on DigitalOcean as a single restart-tolerant instance — running games
survive a coordinator outage (relays run the live game); create/re-home pause
until it returns and relays re-enroll on their own.

## Layout

- `docker-compose.yml` — coordinator (built from the rally-point2 repo at the
  `RP2_REV` pin, no registry) and tailscale (admin access).
- `sample.env` — copy to `.env` and fill in.
- `config/` — mounted read-only into the coordinator: `regions.json` (region
  registry) and `ecs.json` (per-region Fargate launch config). Samples included.
- `tailscale/serve.json` — which services the tailnet can reach. One entry per
  service; the proxy dials the compose service name per connection, so container
  restarts need no re-plumbing (there are no manual iptables rules anywhere in
  this setup, and the node keeps its identity across recreates via the state
  volume).

## TLS

The coordinator terminates TLS itself and obtains/renews its Let's Encrypt
certificate in-process (ACME TLS-ALPN-01, answered on the listening port — no
certbot container, no port 80). Point DNS for `COORDINATOR_ACME_DOMAIN` at this
box before first start; use `COORDINATOR_ACME_STAGING=true` for a dry run
without spending production issuance rate limits. The account key and certs
persist on the `coordinator_data` volume, so restarts never re-issue.

## First-time setup

1. Copy this directory to the box, `cp sample.env .env`, fill it in; write
   `config/regions.json` and `config/ecs.json` from the samples.
2. `docker-compose build coordinator && docker-compose up -d`

## The direct-exposure rule

Nothing may sit between the public port and the coordinator (no nginx, no DO
load balancer): relay enrollment verifies each control connection's
transport-level peer address against the addresses recorded when the relay's
task was launched, and any proxy would replace every peer with itself. If a
proxy ever becomes necessary, that gate has to be re-designed first, not worked
around.

IPv6 corollary: if the coordinator's hostname serves an AAAA record, the Docker
daemon must NAT v6 natively (Docker ≥ 27, or `"ip6tables": true` in
`/etc/docker/daemon.json`) — older daemons route published v6 ports through the
userland proxy, which replaces peer addresses just like a reverse proxy would.

## Not yet deployable — one coordinator piece pending

**Tenant registry config**: production tenants (per-tenant signing keys,
current/next for rotation) need a config file; today only the dev tenant flag
exists. Tracked in `netcode-v2-build-plan.md` §Phase 5/6.
