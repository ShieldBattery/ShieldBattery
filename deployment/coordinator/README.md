# coordinator

The netcode-v2 coordinator box (rally-point2): session placement, the relay
identity ledger, and on-demand Fargate relay provisioning. Runs beside the app
servers on DigitalOcean as a single restart-tolerant instance — running games
survive a coordinator outage (relays run the live game); create/re-home pause
until it returns and relays re-enroll on their own.

## Layout

- `docker-compose.yml` — coordinator (`shieldbattery/rp2-coordinator`, pinned by
  the `RP2_VERSION` tag — CI publishes one per rally-point2 main commit, tagged
  with the commit SHA) and tailscale (admin access).
- `sample.env` — copy to `.env` and fill in.
- `config/` — mounted read-only into the coordinator: `regions.json` (region
  registry), `ecs.json` (per-region Fargate launch config), and `tenants.json`
  (tenant registry: state, verification keys, webhook URL — no secrets; each
  tenant names the `.env` variable holding its signing key). Samples included.
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
   `config/regions.json`, `config/ecs.json`, and `config/tenants.json` from the
   samples.
2. `docker-compose pull && docker-compose up -d`

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

## Tenant operations

Rotating the app server's request key: add the new pubkey as a second entry in
the tenant's `client_pubkeys`, restart the coordinator, roll the app servers to
the new key, then remove the old entry. Suspending a tenant (`"state":
"suspended"`) refuses new game sessions while everything its running games rely
on keeps working; `"revoked"` refuses all service. State changes apply on
restart.
