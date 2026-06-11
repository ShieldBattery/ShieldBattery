use crate::matchmaking::matchmaker::{
    Match, Matchmaker, Player, PlayerModeRating, QueueEntry, RandomQueueSelector,
};
use crate::matchmaking::{
    MatchFoundMessage, MatchedPlayer, MatchmakingType, PublishedMatchmakingMessage,
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
use enumset::EnumSet;
use serde::{Deserialize, Serialize};
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

#[derive(Serialize)]
struct ApiError {
    code: &'static str,
    message: &'static str,
}

impl IntoResponse for MatchmakerError {
    fn into_response(self) -> axum::response::Response {
        let (status, error) = match self {
            MatchmakerError::AlreadyInQueue(_) => (
                StatusCode::CONFLICT,
                ApiError {
                    code: "alreadyInQueue",
                    message: "Player is already in the queue",
                },
            ),
            MatchmakerError::NoModesSelected => (
                StatusCode::BAD_REQUEST,
                ApiError {
                    code: "noModesSelected",
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueRequest {
    id: usize,
    /// Per-mode ratings. One entry per queued mode.
    mode_ratings: Vec<PlayerModeRatingDto>,
    modes: Vec<MatchmakingType>,
    latency_bucket: Option<u8>,
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
    /// Per-mode ratings preserved from queue time; used to reconstruct Player on requeue.
    mode_ratings: Vec<PlayerModeRatingDto>,
    modes: Vec<MatchmakingType>,
    queue_time: u64,
    latency_bucket: Option<u8>,
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
            })
            .collect(),
        latency_bucket: entry.player.latency_bucket,
        modes: entry.modes.iter().collect(),
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
            });

            if let Err(e) = redis_pool.publish(event).await {
                tracing::error!("Failed to publish match event to Redis: {e:?}");
                // The match is already removed from the Rust queue but was never delivered to
                // Node.js. Affected players will appear stuck: they believe they're still
                // searching but are no longer in the queue. This is an unresolved gap — Phase 3
                // must define a recovery path. One option: treat a Redis publish error as fatal
                // and restart the process so the process fingerprint changes; Node.js then detects
                // the restart via the stale-ticket path and surfaces "matchmaking failed" to the
                // affected players.
            }
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
    let modes = payload.modes.into_iter().collect::<EnumSet<_>>();
    let ratings = payload
        .mode_ratings
        .into_iter()
        .map(|r| {
            (
                r.mode,
                PlayerModeRating {
                    rating: r.rating,
                    uncertainty: r.uncertainty,
                },
            )
        })
        .collect();
    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    matchmaker.insert_player(
        Player {
            id: payload.id,
            ratings,
            latency_bucket: payload.latency_bucket,
        },
        modes,
    )?;
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
                    code: "invalidTicket",
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
                    code: "invalidTicket",
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
                code: "staleTicket",
                message: "Server restarted since ticket was issued",
            }),
        )
            .into_response();
    }

    let modes = ticket.modes.into_iter().collect::<EnumSet<_>>();

    let mut matchmaker = lock_matchmaker(&state.matchmaker);
    let queue_time = matchmaker.start() + Duration::from_millis(ticket.queue_time);
    match matchmaker.requeue_player(
        Player {
            id: ticket.id,
            ratings: ticket
                .mode_ratings
                .into_iter()
                .map(|r| {
                    (
                        r.mode,
                        PlayerModeRating {
                            rating: r.rating,
                            uncertainty: r.uncertainty,
                        },
                    )
                })
                .collect(),
            latency_bucket: ticket.latency_bucket,
        },
        modes,
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
                code: "notFound",
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
                    PlayerModeRating { rating: 1000.0, uncertainty: None },
                )]),
                latency_bucket: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player1 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 1,
                ratings: HashMap::from([(
                    MatchmakingType::Match1v1,
                    PlayerModeRating { rating: 1000.0, uncertainty: None },
                )]),
                latency_bucket: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player2 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 2,
                ratings: HashMap::from([(
                    MatchmakingType::Match1v1,
                    PlayerModeRating { rating: 1000.0, uncertainty: None },
                )]),
                latency_bucket: None,
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
            },
            Match {
                mode: MatchmakingType::Match1v1,
                team_a: vec![player0],
                team_b: vec![player2],
                quality: 5.0,
            },
        ];

        let result = deduplicate_matches(matches);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].team_a[0].player.id, 0);
        assert_eq!(result[0].team_b[0].player.id, 1);
    }
}
