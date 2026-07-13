# coordinator

The netcode-v2 coordinator box (rally-point2): session placement, the relay
identity ledger, and on-demand Fargate relay provisioning. Runs beside the app
servers on DigitalOcean as a single restart-tolerant instance — running games
survive a coordinator outage (relays run the live game); create/re-home pause
until it returns and relays re-enroll on their own.

## Layout

- `docker-compose.yml` — coordinator (built from the rally-point2 repo at the
  `RP2_REV` pin, no registry), certbot (cert renewal), tailscale (admin access).
- `sample.env` — copy to `.env` and fill in.
- `config/` — mounted read-only into the coordinator: `regions.json` (region
  registry) and `ecs.json` (per-region Fargate launch config). Samples included.
- `tailscale/serve.json` — which services the tailnet can reach. One entry per
  service; the proxy dials the compose service name per connection, so container
  restarts need no re-plumbing (there are no manual iptables rules anywhere in
  this setup, and the node keeps its identity across recreates via the state
  volume).

## First-time setup

1. Copy this directory to the box, `cp sample.env .env`, fill it in; write
   `config/regions.json` and `config/ecs.json` from the samples.
2. Issue the first certificate (the certbot container only *renews*):
   `docker-compose run --rm -p 80:80 certbot certonly --standalone -d <domain> -m <email> --agree-tos -n`
3. `docker-compose build coordinator && docker-compose up -d`

## Not yet deployable — two coordinator pieces pending

This directory is ahead of the coordinator binary in two places; both are
tracked in `netcode-v2-build-plan.md` §Phase 5:

- **Native TLS**: the coordinator currently listens plain HTTP. It must
  terminate TLS itself (`COORDINATOR_TLS_CERT`/`_KEY` in `sample.env` are
  placeholders for that) rather than sit behind a TLS proxy, because relay
  enrollment checks the transport-level peer address against the addresses
  recorded at task launch — a proxy would replace every peer with itself.
- **Tenant registry config**: production tenants (per-tenant signing keys,
  current/next for rotation) need a config file; today only the dev tenant flag
  exists.

## The direct-exposure rule

Nothing may sit between the public port and the coordinator (no nginx, no DO
load balancer): the enrollment ledger's expected-address gate reads the real
peer address. If a proxy ever becomes necessary, that gate has to be
re-designed first, not worked around.
