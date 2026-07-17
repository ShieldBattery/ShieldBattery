# Monitoring stack

Prometheus + Grafana (+ node_exporter), reachable over Tailscale. This directory is the source of
truth for the stack's configuration; the monitoring host itself is not in source control, so deploying
a change means copying these files onto the box (see [Deploying](#deploying)).

## Layout

```
docker-compose.yml                              the stack (tailscale, grafana, prometheus, node_exporter)
prometheus/prometheus.yml                       scrape config (which targets Prometheus pulls /metrics from, incl. the rp2 coordinator's own /metrics and its node_exporter)
grafana/provisioning/datasources/*.yaml         datasources created on Grafana startup (config-as-code)
grafana/provisioning/dashboards/*.yaml          dashboard *providers* (where Grafana loads dashboards from)
grafana/dashboards/*.json                       the dashboards themselves
sample.env                                       template for the .env the box needs (Tailscale auth key, etc.)
```

## How dashboards work (provisioning)

Dashboards are **provisioned** (config-as-code), not created by hand in the UI. The `grafana` service
in `docker-compose.yml` bind-mounts two directories into the container:

- `./grafana/provisioning` → `/etc/grafana/provisioning` — datasource + dashboard-provider config,
  read once on Grafana startup.
- `./grafana/dashboards` → `/var/lib/grafana/dashboards` — the dashboard JSON, watched continuously.

The chain:

1. `provisioning/datasources/prometheus.yaml` creates a Prometheus datasource with `uid: prometheus`
   (Grafana reaches Prometheus at `localhost:9090` because both share the tailscale container's network
   namespace via `network_mode: service:tailscale`).
2. `provisioning/dashboards/dashboards.yaml` is a *file provider*: it loads every JSON under
   `/var/lib/grafana/dashboards` into a **ShieldBattery** folder and rescans every 30s.
3. Each dashboard JSON references the datasource by `uid: prometheus` and queries metric names exposed
   by the scrape targets (e.g. `matchmaker_*` from server-rs `/metrics`, scraped via the `server_rs`
   job in `prometheus/prometheus.yml`).
4. `grafana/dashboards/rally-point.json` is provisioned the same way, reading `rp2_*` series scraped
   via the `rp2_coordinator` job — see `../coordinator/README.md`'s Metrics section for what the
   coordinator's `/metrics` exposes.

Editing a dashboard in the Grafana UI works (`allowUiUpdates: true`), but the JSON file on disk wins
on the next rescan — so **export the JSON back into `grafana/dashboards/` and commit it** to persist a
change.

## Deploying

There is no automated deploy. As with the other server types (see `../README.md`), copy this directory
to the monitoring host, add the site-specific `.env`, and bring it up:

- **Config/compose/provisioning changes** (including adding/removing the bind mounts above, datasource
  YAML, or `prometheus.yml`): copy the files over and `docker compose up -d` to **recreate the
  containers**. Provisioning is only re-read on container start.
- **Dashboard JSON only** (once the bind mounts already exist on the box): just update the file under
  `grafana/dashboards/` — the file provider hot-reloads it within ~30s, no restart needed.

> The two `grafana` bind mounts were added when provisioning was introduced. If the running box predates
> that, its dashboards live only in the `grafana_data` volume (created by hand in the UI). The first
> deploy with provisioning therefore needs a `docker compose up -d` to recreate the `grafana` container
> with the new mounts. Those volume-stored dashboards are not touched (see below).

## Will provisioning overwrite existing dashboards / datasources?

- **Dashboards are keyed by `uid`.** A provisioned dashboard only replaces an existing one with the same
  `uid`; everything else is untouched. `disableDeletion: false` only governs dashboards *this provider*
  manages (the JSON files here) — it does not delete UI- or API-created dashboards.
- **Datasources are matched by name.** Provisioning a datasource named `Prometheus` will adopt/overwrite
  an existing UI-created one of the same name. `prometheus.yaml` sets `isDefault: false` so it won't
  steal "default datasource" status, and `editable: true` so it can still be tweaked. **Check this name
  collision before the first provisioned deploy** if the box already has a hand-made Prometheus
  datasource.

## Testing locally

The compose file binds `grafana`/`prometheus` to the tailscale network namespace and scrapes
`sb-staging`/`sb-prod`, which don't resolve off the monitoring host. To validate dashboards locally:

1. Temporarily remove `network_mode: service:tailscale` from the `grafana` and `prometheus` services
   and expose ports (`3000:3000`, `9090:9090`).
2. Add a local scrape target to `prometheus/prometheus.yml` for a dev server-rs `/metrics`
   (e.g. `host.docker.internal:<port>`).
3. `docker compose up -d grafana prometheus`, open `http://localhost:3000`, and confirm the dashboard
   appears in the **ShieldBattery** folder with its datasource resolved.
4. Generate matchmaking activity in the dev app (queue some accounts) to see the panels populate.

Don't commit these local-only edits to `docker-compose.yml` / `prometheus.yml`.
