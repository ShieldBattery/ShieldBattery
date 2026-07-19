use crate::matchmaking::backbone::{BackboneRttTable, ServedPairRtt, parse_served_backbone_rtts};
use crate::matchmaking::config::MatchmakerConfig;
use crate::matchmaking::matchmaker::{
    Match, Matchmaker, Player, PlayerModeRating, QueueEntry, RandomQueueSelector,
};
use crate::matchmaking::{
    MatchFoundMessage, MatchedPlayer, MatchmakingType, PublishedMatchmakingMessage,
    RsMatchmakerErrorCode, metrics,
};
use crate::redis::RedisPool;
use crate::state::AppState;
use crate::users::SbUserId;
use arc_swap::ArcSwap;
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router, extract::State, routing::post};
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use color_eyre::eyre::{self, Context as _, eyre};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::matchmaker::MatchmakerError;

/// How many times to attempt publishing a formed match to Redis before treating the failure as
/// fatal. A formed match has already been removed from the queue, so a few quick retries are worth
/// it to ride out a transient Redis blip before resorting to the process exit in
/// [publish_match_or_exit].
const MAX_PUBLISH_ATTEMPTS: u32 = 3;

/// Delay between the publish attempts counted by [MAX_PUBLISH_ATTEMPTS].
const PUBLISH_RETRY_DELAY: Duration = Duration::from_millis(200);

/// How often [run_backbone_fetch_loop] polls the coordinator's `GET /regions` for the served backbone
/// RTT table. Backbone RTTs are stable, so a coarse cadence is plenty.
const BACKBONE_FETCH_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Per-request timeout for the coordinator `GET /regions` fetch, so a hung coordinator can't stall a
/// fetch (and therefore the loop) indefinitely.
const BACKBONE_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
struct ApiError {
    code: RsMatchmakerErrorCode,
    message: &'static str,
}

impl IntoResponse for MatchmakerError {
    fn into_response(self) -> axum::response::Response {
        let (status, error) = match self {
            MatchmakerError::AlreadyInQueue(_) => (
                StatusCode::CONFLICT,
                ApiError {
                    code: RsMatchmakerErrorCode::AlreadyInQueue,
                    message: "Player is already in the queue",
                },
            ),
            MatchmakerError::NoModesSelected => (
                StatusCode::BAD_REQUEST,
                ApiError {
                    code: RsMatchmakerErrorCode::NoModesSelected,
                    message: "Must queue for at least one mode",
                },
            ),
        };
        (status, Json(error)).into_response()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerModeRatingDto {
    mode: MatchmakingType,
    rating: f32,
    uncertainty: Option<f32>,
    /// Positive map selections for this mode, present only for "pick" modes. Used by the matchmaker
    /// to require that matched players share at least one map. `None`/absent for veto/fixed modes.
    #[serde(default)]
    map_selections: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueRequest {
    id: usize,
    /// Per-mode ratings. One entry per queued mode; the set of modes the player queues for is
    /// derived from these entries.
    mode_ratings: Vec<PlayerModeRatingDto>,
    /// The game server region this player asked to home in, if any. Combined with `rtt_ms` and the
    /// backbone table to estimate a candidate match's latency. Absent for players with no
    /// coordinator-configured regions (dev loopback), which contribute no latency signal.
    #[serde(default)]
    region: Option<String>,
    /// The player's measured round-trip time (ms) to `region`. Present only alongside `region`.
    #[serde(default)]
    rtt_ms: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequeueRequest {
    ticket: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueTicket {
    id: usize,
    /// Per-mode ratings preserved from queue time; used to reconstruct Player (and its queued
    /// modes) on requeue.
    mode_ratings: Vec<PlayerModeRatingDto>,
    queue_time: u64,
    /// Region and measured rtt preserved from queue time. Reused as-is on requeue rather than
    /// re-measured (a requeue is rare and the values are still a good estimate).
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    rtt_ms: Option<f32>,
    process_token: Uuid,
}

type SharedMatchmaker = Arc<Mutex<Matchmaker<RandomQueueSelector>>>;

#[derive(Clone)]
struct MatchmakingApiState {
    matchmaker: SharedMatchmaker,
    /// The live, swappable matchmaker configuration. The search loop reads it each tick and pushes
    /// it into the matchmaker, so an admin edit (which replaces the pointee — separate change) takes
    /// effect without a restart.
    config: Arc<ArcSwap<MatchmakerConfig>>,
    /// The live, swappable backbone RTT table, refreshed by [run_backbone_fetch_loop] when a
    /// coordinator is configured. The search loop reads it each tick and pushes it into the
    /// matchmaker (mirroring `config`), so a refreshed served table takes effect without a restart.
    backbone: Arc<ArcSwap<BackboneRttTable>>,
    process_token: Uuid,
}

/// Locks the shared matchmaker, recovering the guard even if a previous holder panicked and
/// poisoned the mutex. A poisoned lock means some operation panicked mid-mutation, but the queue's
/// data is still structurally valid (worst case one queue entry is in an odd state), so it's far
/// better to keep matching than to cascade a single panic into every future request.
fn lock_matchmaker(
    matchmaker: &SharedMatchmaker,
) -> std::sync::MutexGuard<'_, Matchmaker<RandomQueueSelector>> {
    matchmaker
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Builds a [`Player`] from the per-mode DTOs received over the wire (or restored from a ticket),
/// splitting them into the rating map and the positive-map-selection map.
fn build_player(
    id: usize,
    mode_ratings: Vec<PlayerModeRatingDto>,
    region: Option<String>,
    rtt_ms: Option<f32>,
) -> Player {
    let mut ratings = HashMap::new();
    let mut map_selections = HashMap::new();
    for r in mode_ratings {
        ratings.insert(
            r.mode,
            PlayerModeRating {
                rating: r.rating,
                uncertainty: r.uncertainty,
            },
        );
        if let Some(maps) = r.map_selections {
            map_selections.insert(r.mode, maps);
        }
    }
    Player {
        id,
        ratings,
        map_selections,
        region,
        rtt_ms,
    }
}

fn build_ticket(entry: &QueueEntry, process_token: &Uuid, matchmaker_start: Instant) -> String {
    let ticket = QueueTicket {
        id: entry.player.id,
        mode_ratings: entry
            .player
            .ratings
            .iter()
            .map(|(&mode, &r)| PlayerModeRatingDto {
                mode,
                rating: r.rating,
                uncertainty: r.uncertainty,
                map_selections: entry.player.map_selections.get(&mode).cloned(),
            })
            .collect(),
        region: entry.player.region.clone(),
        rtt_ms: entry.player.rtt_ms,
        queue_time: entry
            .queue_time
            .duration_since(matchmaker_start)
            .as_millis() as u64,
        process_token: *process_token,
    };
    let json = serde_json::to_vec(&ticket).expect("QueueTicket serialization is infallible");
    BASE64_STANDARD.encode(&json)
}

/// Filters a list of matches so no player appears in more than one match: the first match a player
/// appears in (in iteration order) wins, and any later match containing them is dropped.
///
/// Note that [`Matchmaker::find_matches`] sorts by quality only *within* each mode and then
/// concatenates the modes (in shuffled order), so the input is not globally highest-quality-first.
/// For a player queued in several modes this means "best match within the first mode they appear
/// in", not their globally-best match; the per-call mode shuffle keeps that fair across calls.
fn deduplicate_matches(matches: Vec<Match>) -> Vec<Match> {
    let mut claimed = std::collections::HashSet::new();
    matches
        .into_iter()
        .filter(|m| {
            let ids: Vec<usize> = m
                .team_a
                .iter()
                .chain(m.team_b.iter())
                .map(|e| e.player.id)
                .collect();
            if ids.iter().any(|id| claimed.contains(id)) {
                return false;
            }
            claimed.extend(ids);
            true
        })
        .collect()
}

/// Supervises [search_loop], restarting it if it ever panics. The search loop is the only thing
/// that forms matches, so if it died silently the `/matchmaker/token` endpoint would keep answering
/// and Node.js would never notice that matches had stopped forming.
async fn supervise_search_loop(state: MatchmakingApiState, redis_pool: RedisPool) {
    loop {
        let handle = tokio::spawn(search_loop(state.clone(), redis_pool.clone()));
        match handle.await {
            Ok(()) => {
                // search_loop never returns under normal operation, so reaching here is unexpected.
                tracing::error!("matchmaker search loop exited unexpectedly; not restarting");
                break;
            }
            Err(e) if e.is_panic() => {
                tracing::error!("matchmaker search loop panicked, restarting: {e:?}");
                // Brief delay so a tight panic loop can't peg the CPU.
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => {
                // Task was cancelled — nothing more we can do.
                tracing::error!("matchmaker search loop task failed: {e:?}");
                break;
            }
        }
    }
}

async fn search_loop(state: MatchmakingApiState, redis_pool: RedisPool) {
    // Capture the epoch once — it never changes for the lifetime of this process.
    let matchmaker_start = lock_matchmaker(&state.matchmaker).start();

    // The search cadence starts from the current config and hot-reloads like the other knobs: the
    // timer is rebuilt below whenever an admin changes `search_interval`.
    let mut search_interval = state.config.load().search_interval;
    let mut interval = tokio::time::interval(search_interval);
    // The first tick fires immediately; skip it so the first real search happens after one interval.
    interval.tick().await;

    loop {
        interval.tick().await;

        let tick_start = Instant::now();

        // Load the config once for this tick. If the cadence changed, rebuild the timer so
        // `searchIntervalSeconds` takes effect without a restart, like the formula/threshold knobs.
        let config = state.config.load_full();
        if config.search_interval != search_interval {
            search_interval = config.search_interval;
            interval = tokio::time::interval(search_interval);
            // Drop the immediate first tick so the new cadence applies from the next iteration.
            interval.tick().await;
        }

        // Find matches and immediately remove matched players while still holding the lock,
        // eliminating the window where a cancel+requeue could slip in between the two operations
        // and have the fresh queue entry incorrectly removed.
        let selected = {
            let mut matchmaker = lock_matchmaker(&state.matchmaker);
            // Push the latest config and backbone table into the matchmaker so an admin edit or a
            // coordinator refresh takes effect this tick.
            matchmaker.set_config(config);
            matchmaker.set_backbone(state.backbone.load().as_ref().clone());
            // Roll the population estimate forward before searching so the adaptive quality threshold
            // reflects recent population rather than the post-drain residual queue size.
            matchmaker.update_population_estimates(tick_start);
            // Sample the per-mode gauges here — after the population roll-forward, before the drain
            // below — so they reflect everyone waiting this tick rather than the unmatched residual.
            metrics::sample_queue_state(&matchmaker);
            let matches = matchmaker.find_matches(tick_start);
            let selected = deduplicate_matches(matches);
            for m in &selected {
                for entry in m.team_a.iter().chain(m.team_b.iter()) {
                    matchmaker.remove_player(entry.player.id);
                }
            }
            selected
        };

        metrics::record_search_tick_duration(tick_start.elapsed());

        if selected.is_empty() {
            continue;
        }

        // Publish one event per selected match
        for m in selected {
            metrics::record_match_formed(&m, tick_start);

            let make_matched_player = |entry: &QueueEntry| MatchedPlayer {
                id: SbUserId::from(entry.player.id as i32),
                ticket: build_ticket(entry, &state.process_token, matchmaker_start),
            };

            let event = PublishedMatchmakingMessage::MatchFound(MatchFoundMessage {
                mode: m.mode,
                team_a: m.team_a.iter().map(make_matched_player).collect(),
                team_b: m.team_b.iter().map(make_matched_player).collect(),
                quality: m.quality,
                skill_variance: m.skill_variance,
                win_probability: m.win_probability,
                team_a_rating: m.team_a_rating,
                team_b_rating: m.team_b_rating,
                max_latency: m.max_latency,
            });

            publish_match_or_exit(&redis_pool, event).await;
        }
    }
}

/// Publishes a formed-match event to Redis, retrying briefly before giving up. If every attempt
/// fails, the match is irrecoverably lost: its players were already removed from the queue (so the
/// search loop won't re-form their match) but Node.js never learned of the match, so they would
/// believe they are still searching forever.
///
/// Rather than strand them, we exit the process. The `restart: unless-stopped` policy brings
/// server-rs back with a fresh `process_token`, which the Node.js watchdog detects (token change,
/// or the unreachable window during the restart) and uses to eject — and surface a failure to —
/// every searching player, including the ones from this lost match. They can then immediately
/// requeue. This is drastic, but a persistent inability to reach Redis means matchmaking can't
/// function anyway, and a clean restart is the only way to restore consistency between the Rust
/// queue and Node.js.
///
/// NOTE: this must exit the *process*, not panic. A panic here is caught by [supervise_search_loop]
/// and only restarts the search task within the same process, leaving `process_token` unchanged —
/// so the watchdog would never fire and the stranded players would stay stranded.
async fn publish_match_or_exit(redis_pool: &RedisPool, event: PublishedMatchmakingMessage) {
    for attempt in 1..=MAX_PUBLISH_ATTEMPTS {
        match redis_pool.publish(event.clone()).await {
            Ok(()) => return,
            Err(e) => {
                metrics::record_publish_failure();
                tracing::error!(
                    "Failed to publish match event to Redis \
                     (attempt {attempt}/{MAX_PUBLISH_ATTEMPTS}): {e:?}"
                );
                if attempt < MAX_PUBLISH_ATTEMPTS {
                    tokio::time::sleep(PUBLISH_RETRY_DELAY).await;
                }
            }
        }
    }

    tracing::error!(
        "Exhausted all attempts to publish a formed match to Redis; exiting so the process \
         restarts with a fresh token and stranded players are ejected by the Node.js watchdog."
    );
    // std::process::exit skips the periodic/Drop-based Datadog flush, so force the log above out to
    // Datadog (stdout already has it synchronously) before terminating.
    crate::telemetry::flush_datadog_logs().await;
    std::process::exit(1);
}

/// Periodically fetches the rp2 coordinator's served backbone RTT table and swaps the composed
/// (served-base + operator-override) table into `backbone`. Runs an immediate fetch at startup, then
/// one every [BACKBONE_FETCH_INTERVAL]. A failed fetch keeps the current table; the error is logged
/// only when the loop transitions between working and failing (tracked by `was_failing`), so a
/// sustained outage doesn't spam a line per tick. Only spawned when a coordinator URL is configured;
/// it runs for the lifetime of the process (dropped when the process exits, like the search loop).
async fn run_backbone_fetch_loop(
    coordinator_url: String,
    override_table: BackboneRttTable,
    backbone: Arc<ArcSwap<BackboneRttTable>>,
) {
    let client = reqwest::Client::new();
    let regions_url = format!("{}/regions", coordinator_url.trim_end_matches('/'));
    // The first tick of a fresh interval fires immediately, giving the startup fetch for free.
    let mut interval = tokio::time::interval(BACKBONE_FETCH_INTERVAL);
    let mut was_failing = false;
    loop {
        interval.tick().await;
        let result = fetch_served_backbone_rtts(&client, &regions_url).await;
        was_failing = apply_backbone_fetch_result(result, &override_table, &backbone, was_failing);
    }
}

/// Fetches and parses the coordinator's served backbone RTT pairs from `GET <regions_url>`, applying a
/// [BACKBONE_FETCH_TIMEOUT] request timeout. Returns the served pairs on success; any transport,
/// HTTP-status, or parse failure is surfaced as an error for [apply_backbone_fetch_result] to handle.
async fn fetch_served_backbone_rtts(
    client: &reqwest::Client,
    regions_url: &str,
) -> eyre::Result<Vec<ServedPairRtt>> {
    let resp = client
        .get(regions_url)
        .timeout(BACKBONE_FETCH_TIMEOUT)
        .send()
        .await
        .wrap_err("backbone RTT request to the coordinator failed")?;
    let status = resp.status();
    if !status.is_success() {
        return Err(eyre!("coordinator /regions returned HTTP {status}"));
    }
    let body = resp
        .text()
        .await
        .wrap_err("failed to read the coordinator /regions body")?;
    parse_served_backbone_rtts(&body).wrap_err("failed to parse the coordinator /regions response")
}

/// Applies the outcome of one backbone fetch to the shared table. On success it recomposes the table
/// (served base + operator override) and swaps it in; on failure it keeps the current table. Logs a
/// single line on each transition — an error on working→failing and an info notice on failing→working
/// — so a sustained outage doesn't log every tick. Returns the `was_failing` state for the next call.
fn apply_backbone_fetch_result(
    result: eyre::Result<Vec<ServedPairRtt>>,
    override_table: &BackboneRttTable,
    backbone: &ArcSwap<BackboneRttTable>,
    was_failing: bool,
) -> bool {
    match result {
        Ok(served) => {
            let pair_count = served.len();
            backbone.store(Arc::new(BackboneRttTable::compose(&served, override_table)));
            if was_failing {
                tracing::info!(
                    "backbone RTT fetch recovered; refreshed the served table ({pair_count} pairs)"
                );
            }
            false
        }
        Err(e) => {
            if !was_failing {
                tracing::error!("backbone RTT fetch failed, keeping the current table: {e:?}");
            }
            true
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessTokenResponse {
    process_token: Uuid,
}

async fn get_process_token(State(state): State<MatchmakingApiState>) -> Json<ProcessTokenResponse> {
    Json(ProcessTokenResponse {
        process_token: state.process_token,
    })
}

pub fn create_matchmaking_api(
    redis_pool: RedisPool,
    config: Arc<ArcSwap<MatchmakerConfig>>,
    coordinator_url: Option<String>,
) -> Router<AppState> {
    metrics::describe_metrics();

    // The operator override (`SB_REGION_BACKBONE_RTT_JSON`), read once at startup and overlaid on top
    // of the coordinator-served table on every refresh (see `BackboneRttTable::compose`).
    let backbone_override = BackboneRttTable::from_env();
    // The live, swappable backbone table. Seeded override-only (no served pairs yet); this is also its
    // permanent state when no coordinator is configured. When one is, the fetch loop below refreshes
    // it; the search loop reads it each tick, like `config`.
    let initial_backbone = BackboneRttTable::compose(&[], &backbone_override);
    let backbone = Arc::new(ArcSwap::from_pointee(initial_backbone.clone()));

    let state = MatchmakingApiState {
        matchmaker: Arc::new(Mutex::new(Matchmaker::new(
            config.load_full(),
            initial_backbone,
        ))),
        config,
        backbone: backbone.clone(),
        process_token: Uuid::new_v4(),
    };

    // Spawn the autonomous match-finding loop. It runs for the lifetime of the process, and is
    // supervised so a panic restarts it rather than silently stopping all matchmaking.
    tokio::spawn(supervise_search_loop(state.clone(), redis_pool));

    // When a coordinator URL is configured, keep the backbone table refreshed from its `GET /regions`.
    // Without one (dev loopback) the table stays override-only and no fetch task is spawned.
    if let Some(coordinator_url) = coordinator_url {
        tokio::spawn(run_backbone_fetch_loop(
            coordinator_url,
            backbone_override,
            backbone,
        ));
    }

    Router::new()
        .route("/", post(insert_player))
        .route("/requeue", post(requeue_player))
        .route("/token", get(get_process_token))
        .route("/{id}", delete(cancel))
        .with_state(state)
}

async fn insert_player(
    State(state): State<MatchmakingApiState>,
    Json(payload): Json<QueueRequest>,
) -> Result<StatusCode, MatchmakerError> {
    let modes: Vec<MatchmakingType> = payload.mode_ratings.iter().map(|r| r.mode).collect();
    let player = build_player(
        payload.id,
        payload.mode_ratings,
        payload.region,
        payload.rtt_ms,
    );
    {
        let mut matchmaker = lock_matchmaker(&state.matchmaker);
        matchmaker.insert_player(player)?;
    }
    for mode in modes {
        metrics::record_player_queued(mode);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn requeue_player(
    State(state): State<MatchmakingApiState>,
    Json(payload): Json<RequeueRequest>,
) -> impl IntoResponse {
    let ticket_json = match BASE64_STANDARD.decode(payload.ticket.as_bytes()) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiError {
                    code: RsMatchmakerErrorCode::InvalidTicket,
                    message: "Ticket is malformed",
                }),
            )
                .into_response();
        }
    };
    let ticket: QueueTicket = match serde_json::from_slice(&ticket_json) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiError {
                    code: RsMatchmakerErrorCode::InvalidTicket,
                    message: "Ticket is malformed",
                }),
            )
                .into_response();
        }
    };

    if ticket.process_token != state.process_token {
        return (
            StatusCode::GONE,
            Json(ApiError {
                code: RsMatchmakerErrorCode::StaleTicket,
                message: "Server restarted since ticket was issued",
            }),
        )
            .into_response();
    }

    let modes: Vec<MatchmakingType> = ticket.mode_ratings.iter().map(|r| r.mode).collect();
    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    let queue_time = matchmaker.start() + Duration::from_millis(ticket.queue_time);
    match matchmaker.requeue_player(
        build_player(ticket.id, ticket.mode_ratings, ticket.region, ticket.rtt_ms),
        queue_time,
    ) {
        Ok(_) => {
            for mode in modes {
                metrics::record_player_requeued(mode);
            }
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => e.into_response(),
    }
}

async fn cancel(
    State(state): State<MatchmakingApiState>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    if matchmaker.remove_player(id).is_some() {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(ApiError {
                code: RsMatchmakerErrorCode::NotFound,
                message: "Player is not in the queue",
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_backbone_fetch_result, deduplicate_matches, fetch_served_backbone_rtts};
    use crate::matchmaking::MatchmakingType;
    use crate::matchmaking::backbone::{BackboneRttTable, ServedPairRtt};
    use crate::matchmaking::matchmaker::{Match, Player, PlayerModeRating, QueueEntry};
    use arc_swap::ArcSwap;
    use color_eyre::eyre::eyre;
    use std::collections::HashMap;
    use std::time::Instant;

    fn served(a: &str, b: &str, rtt_ms: f32) -> ServedPairRtt {
        ServedPairRtt {
            a: a.to_string(),
            b: b.to_string(),
            rtt_ms,
        }
    }

    #[test]
    fn deduplication_keeps_first_match_per_player() {
        let now = Instant::now();

        let player0 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 0,
                ratings: HashMap::from([(
                    MatchmakingType::Match1v1,
                    PlayerModeRating {
                        rating: 1000.0,
                        uncertainty: None,
                    },
                )]),
                map_selections: HashMap::new(),
                region: None,
                rtt_ms: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player1 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 1,
                ratings: HashMap::from([(
                    MatchmakingType::Match1v1,
                    PlayerModeRating {
                        rating: 1000.0,
                        uncertainty: None,
                    },
                )]),
                map_selections: HashMap::new(),
                region: None,
                rtt_ms: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player2 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 2,
                ratings: HashMap::from([(
                    MatchmakingType::Match1v1,
                    PlayerModeRating {
                        rating: 1000.0,
                        uncertainty: None,
                    },
                )]),
                map_selections: HashMap::new(),
                region: None,
                rtt_ms: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };

        // Two matches share player 0. The first (higher quality) should be kept,
        // the second discarded, and player 2 is also discarded (can't form a match alone).
        let matches = vec![
            Match {
                mode: MatchmakingType::Match1v1,
                team_a: vec![player0.clone()],
                team_b: vec![player1],
                quality: 10.0,
                skill_variance: 0.0,
                win_probability: 0.5,
                team_a_rating: 1000.0,
                team_b_rating: 1000.0,
                max_latency: 0.0,
            },
            Match {
                mode: MatchmakingType::Match1v1,
                team_a: vec![player0],
                team_b: vec![player2],
                quality: 5.0,
                skill_variance: 0.0,
                win_probability: 0.5,
                team_a_rating: 1000.0,
                team_b_rating: 1000.0,
                max_latency: 0.0,
            },
        ];

        let result = deduplicate_matches(matches);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].team_a[0].player.id, 0);
        assert_eq!(result[0].team_b[0].player.id, 1);
    }

    #[test]
    fn fetch_success_swaps_in_composed_table() {
        // An operator override that wins over a served pair of the same key.
        let override_table = BackboneRttTable::new([("eu-west|us-east".to_string(), 55.0)]);
        let backbone = ArcSwap::from_pointee(BackboneRttTable::compose(&[], &override_table));

        let served_pairs = vec![
            served("us-east", "eu-west", 90.0),
            served("ap-south", "us-east", 200.0),
        ];
        let was_failing =
            apply_backbone_fetch_result(Ok(served_pairs), &override_table, &backbone, false);

        assert!(!was_failing);
        let table = backbone.load();
        // Override wins for the pair it names; the other served pair is applied as-is.
        assert_eq!(table.rtt("us-east", "eu-west"), 55.0);
        assert_eq!(table.rtt("ap-south", "us-east"), 200.0);
    }

    #[test]
    fn fetch_failure_keeps_current_table() {
        let override_table = BackboneRttTable::new([("eu-west|us-east".to_string(), 55.0)]);
        // Seed with a previously-fetched served value so we can prove a failure leaves it intact.
        let seeded =
            BackboneRttTable::compose(&[served("ap-south", "us-east", 200.0)], &override_table);
        let backbone = ArcSwap::from_pointee(seeded);

        let was_failing =
            apply_backbone_fetch_result(Err(eyre!("boom")), &override_table, &backbone, false);

        assert!(was_failing);
        let table = backbone.load();
        assert_eq!(table.rtt("ap-south", "us-east"), 200.0);
        assert_eq!(table.rtt("eu-west", "us-east"), 55.0);
    }

    #[test]
    fn fetch_result_tracks_was_failing_transitions() {
        let override_table = BackboneRttTable::default();
        let backbone = ArcSwap::from_pointee(BackboneRttTable::default());

        // working -> failing, then failing -> failing (stays failing).
        assert!(apply_backbone_fetch_result(
            Err(eyre!("x")),
            &override_table,
            &backbone,
            false
        ));
        assert!(apply_backbone_fetch_result(
            Err(eyre!("y")),
            &override_table,
            &backbone,
            true
        ));
        // failing -> working (recovery), then working -> working.
        assert!(!apply_backbone_fetch_result(
            Ok(vec![]),
            &override_table,
            &backbone,
            true
        ));
        assert!(!apply_backbone_fetch_result(
            Ok(vec![]),
            &override_table,
            &backbone,
            false
        ));
    }

    #[tokio::test]
    async fn fetch_served_backbone_rtts_parses_success() {
        let mut server = mockito::Server::new_async().await;
        let body = serde_json::json!({
            "regions": [],
            "backbone_rtts": [
                {"a": "eu-central", "b": "us-east", "rtt_ms": 87, "measured_at": 1752555555}
            ]
        });
        let route = server
            .mock("GET", "/regions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let url = format!("{}/regions", server.url());
        let served = fetch_served_backbone_rtts(&client, &url).await.unwrap();

        route.assert_async().await;
        assert_eq!(served.len(), 1);
        assert_eq!(served[0].a, "eu-central");
        assert_eq!(served[0].rtt_ms, 87.0);
    }

    #[tokio::test]
    async fn fetch_served_backbone_rtts_errors_on_http_failure() {
        let mut server = mockito::Server::new_async().await;
        let route = server
            .mock("GET", "/regions")
            .with_status(500)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let url = format!("{}/regions", server.url());
        let result = fetch_served_backbone_rtts(&client, &url).await;

        route.assert_async().await;
        assert!(result.is_err());
    }
}
