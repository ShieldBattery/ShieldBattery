use crate::matchmaking::matchmaker::{
    Match, Matchmaker, Player, PlayerModeRating, QueueEntry, RandomQueueSelector,
};
use crate::matchmaking::{
    MatchFoundMessage, MatchedPlayer, MatchmakingType, PublishedMatchmakingMessage,
    RsMatchmakerErrorCode,
};
use crate::redis::RedisPool;
use crate::state::AppState;
use crate::users::SbUserId;
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router, extract::State, routing::post};
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::matchmaker::MatchmakerError;

/// Minimum quality score a match must reach before it is published. The matchmaker applies an
/// adaptive threshold that lowers this automatically when the queue is below a comfortable size,
/// so matches can still form during low-population periods.
const MIN_QUALITY: f32 = -30.0;

/// How often the matchmaker searches for new matches.
const SEARCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6);

/// How many times to attempt publishing a formed match to Redis before treating the failure as
/// fatal. A formed match has already been removed from the queue, so a few quick retries are worth
/// it to ride out a transient Redis blip before resorting to the process exit in
/// [publish_match_or_exit].
const MAX_PUBLISH_ATTEMPTS: u32 = 3;

/// Delay between the publish attempts counted by [MAX_PUBLISH_ATTEMPTS].
const PUBLISH_RETRY_DELAY: Duration = Duration::from_millis(200);

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
    /// The player's most recent round-trip pings (ms) to each rally-point server, as
    /// `[server_id, ping]` pairs. Used to estimate a candidate match's latency (see
    /// [`crate::matchmaking::matchmaker::match_latency`]). The Node.js side waits for the client to
    /// measure its pings before enqueuing, so this is normally populated; an empty list is tolerated
    /// and yields no latency penalty.
    #[serde(default)]
    server_pings: Vec<(u32, f32)>,
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
    /// Per-server pings preserved from queue time, as `[server_id, ping]` pairs. Reused as-is on
    /// requeue rather than re-measured (a requeue is rare and the pings are still a good estimate).
    server_pings: Vec<(u32, f32)>,
    process_token: Uuid,
}

type SharedMatchmaker = Arc<Mutex<Matchmaker<RandomQueueSelector>>>;

#[derive(Clone)]
struct MatchmakingApiState {
    matchmaker: SharedMatchmaker,
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
    server_pings: Vec<(u32, f32)>,
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
        server_pings: server_pings.into_iter().collect(),
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
        server_pings: entry
            .player
            .server_pings
            .iter()
            .map(|(&server, &ping)| (server, ping))
            .collect(),
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

    let mut interval = tokio::time::interval(SEARCH_INTERVAL);
    // The first tick fires immediately; skip it so the first real search happens after one interval.
    interval.tick().await;

    loop {
        interval.tick().await;

        // Find matches and immediately remove matched players while still holding the lock,
        // eliminating the window where a cancel+requeue could slip in between the two operations
        // and have the fresh queue entry incorrectly removed.
        let selected = {
            let mut matchmaker = lock_matchmaker(&state.matchmaker);
            let matches = matchmaker.find_matches(MIN_QUALITY, Instant::now());
            let selected = deduplicate_matches(matches);
            for m in &selected {
                for entry in m.team_a.iter().chain(m.team_b.iter()) {
                    matchmaker.remove_player(entry.player.id);
                }
            }
            selected
        };

        if selected.is_empty() {
            continue;
        }

        // Publish one event per selected match
        for m in selected {
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

pub fn create_matchmaking_api(redis_pool: RedisPool) -> Router<AppState> {
    let state = MatchmakingApiState {
        matchmaker: Arc::new(Mutex::new(Matchmaker::new(16))),
        process_token: Uuid::new_v4(),
    };

    // Spawn the autonomous match-finding loop. It runs for the lifetime of the process, and is
    // supervised so a panic restarts it rather than silently stopping all matchmaking.
    tokio::spawn(supervise_search_loop(state.clone(), redis_pool));

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
    let player = build_player(payload.id, payload.mode_ratings, payload.server_pings);
    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    matchmaker.insert_player(player)?;
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

    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    let queue_time = matchmaker.start() + Duration::from_millis(ticket.queue_time);
    match matchmaker.requeue_player(
        build_player(ticket.id, ticket.mode_ratings, ticket.server_pings),
        queue_time,
    ) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
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
    use super::deduplicate_matches;
    use crate::matchmaking::MatchmakingType;
    use crate::matchmaking::matchmaker::{Match, Player, PlayerModeRating, QueueEntry};
    use std::collections::HashMap;
    use std::time::Instant;

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
                server_pings: HashMap::new(),
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
                server_pings: HashMap::new(),
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
                server_pings: HashMap::new(),
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
}
