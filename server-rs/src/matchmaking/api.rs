use crate::matchmaking::matchmaker::{Match, Matchmaker, Player, QueueEntry, RandomQueueSelector};
use crate::matchmaking::{
    MatchFoundMessage, MatchedPlayer, MatchmakingType, PublishedMatchmakingMessage,
};
use crate::redis::RedisPool;
use crate::state::AppState;
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::delete;
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
struct QueueRequest {
    id: usize,
    rating: f32,
    /// Glicko-2 σ (uncertainty). None treated as 0 (fully certain).
    uncertainty: Option<f32>,
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
    rating: f32,
    /// Glicko-2 σ (uncertainty). Preserved so requeue reconstructs Player correctly.
    uncertainty: Option<f32>,
    modes: Vec<MatchmakingType>,
    queue_time: u64,
    latency_bucket: Option<u8>,
    process_token: String,
}

type SharedMatchmaker = Arc<Mutex<Matchmaker<RandomQueueSelector>>>;

#[derive(Clone)]
struct MatchmakingApiState {
    matchmaker: SharedMatchmaker,
    process_token: Uuid,
}

fn build_ticket(entry: &QueueEntry, process_token: &Uuid, matchmaker_start: Instant) -> String {
    let ticket = QueueTicket {
        id: entry.player.id,
        rating: entry.player.rating,
        uncertainty: entry.player.uncertainty,
        latency_bucket: entry.player.latency_bucket,
        modes: entry.modes.iter().collect(),
        queue_time: entry
            .queue_time
            .duration_since(matchmaker_start)
            .as_millis() as u64,
        process_token: process_token.to_string(),
    };
    let json = serde_json::to_vec(&ticket).expect("QueueTicket serialization is infallible");
    BASE64_STANDARD.encode(&json)
}

/// Filters a list of matches so no player appears in more than one match.
/// Input must be sorted with highest-quality matches first; the first match a player appears in wins.
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

async fn search_loop(state: MatchmakingApiState, redis_pool: RedisPool) {
    // Capture the epoch once — it never changes for the lifetime of this process.
    let matchmaker_start = state.matchmaker.lock().unwrap().start();

    let mut interval = tokio::time::interval(SEARCH_INTERVAL);
    // The first tick fires immediately; skip it so the first real search happens after one interval.
    interval.tick().await;

    loop {
        interval.tick().await;

        // Find matches (lock held only during the search, released before any async work)
        let matches = {
            let matchmaker = state.matchmaker.lock().unwrap();
            matchmaker.find_matches(MIN_QUALITY, Instant::now())
        };

        if matches.is_empty() {
            continue;
        }

        let selected = deduplicate_matches(matches);

        // Remove matched players from the queue
        {
            let mut matchmaker = state.matchmaker.lock().unwrap();
            for m in &selected {
                for entry in m.team_a.iter().chain(m.team_b.iter()) {
                    matchmaker.remove_player(entry.player.id);
                }
            }
        }

        // Publish one event per selected match
        for m in selected {
            let make_matched_player = |entry: &QueueEntry| MatchedPlayer {
                id: entry.player.id as i32,
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

pub fn create_matchmaking_api(redis_pool: RedisPool) -> Router<AppState> {
    let state = MatchmakingApiState {
        matchmaker: Arc::new(Mutex::new(Matchmaker::new(16))),
        process_token: Uuid::new_v4(),
    };

    // Spawn the autonomous match-finding loop. It runs for the lifetime of the process.
    tokio::spawn(search_loop(state.clone(), redis_pool));

    Router::new()
        .route("/", post(insert_player))
        .route("/requeue", post(requeue_player))
        .route("/{id}", delete(cancel))
        .with_state(state)
}

async fn insert_player(
    State(state): State<MatchmakingApiState>,
    Json(payload): Json<QueueRequest>,
) -> Result<StatusCode, MatchmakerError> {
    let modes = payload.modes.into_iter().collect::<EnumSet<_>>();
    let mut matchmaker = state.matchmaker.lock().unwrap();
    matchmaker.insert_player(
        Player {
            id: payload.id,
            rating: payload.rating,
            uncertainty: payload.uncertainty,
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

    if ticket.process_token != state.process_token.to_string() {
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

    let mut matchmaker = state.matchmaker.lock().unwrap();
    let queue_time = matchmaker.start() + Duration::from_millis(ticket.queue_time);
    match matchmaker.requeue_player(
        Player {
            id: ticket.id,
            rating: ticket.rating,
            uncertainty: ticket.uncertainty,
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
    let mut matchmaker = state.matchmaker.lock().unwrap();
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
    use crate::matchmaking::matchmaker::{Match, Player, QueueEntry};
    use std::time::Instant;

    #[test]
    fn deduplication_keeps_first_match_per_player() {
        let now = Instant::now();

        let player0 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 0,
                rating: 1000.0,
                uncertainty: None,
                latency_bucket: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player1 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 1,
                rating: 1000.0,
                uncertainty: None,
                latency_bucket: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };
        let player2 = QueueEntry {
            queue_time: now,
            player: Player {
                id: 2,
                rating: 1000.0,
                uncertainty: None,
                latency_bucket: None,
            },
            modes: MatchmakingType::Match1v1.into(),
        };

        // Two matches share player 0. The first (higher quality) should be kept,
        // the second discarded, and player 2 is also discarded (can't form a match alone).
        let matches = vec![
            Match {
                mode: MatchmakingType::Match1v1,
                team_a: vec![player0],
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
