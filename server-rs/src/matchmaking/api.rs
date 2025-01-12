use crate::matchmaking::matchmaker::{Matchmaker, MatchmakingMode, Player, RandomQueueSelector};
use crate::state::AppState;
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::delete;
use axum::{extract::State, routing::post, Json, Router};
use base64::prelude::BASE64_STANDARD;
use base64::Engine as _;
use enumset::EnumSet;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use super::matchmaker::MatchmakerError;

pub fn create_matchmaker_api() -> Router<AppState> {
    let matchmaker = Arc::new(Mutex::new(Matchmaker::new(16)));

    Router::new()
        .route("/", post(insert_player))
        .route("/requeue", post(requeue_player))
        .route("/:id", delete(cancel))
        .with_state(matchmaker)
}

impl IntoResponse for MatchmakerError {
    fn into_response(self) -> axum::response::Response {
        // TODO(tec27): Include the MatchmakerError code in a JSON body here too?
        match self {
            MatchmakerError::AlreadyInQueue(_id) => StatusCode::CONFLICT,
            MatchmakerError::NoModesSelected => StatusCode::BAD_REQUEST,
        }
        .into_response()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueRequest {
    id: usize,
    rating: f32,
    modes: Vec<MatchmakingMode>,
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
    modes: Vec<MatchmakingMode>,
    queue_time: u64,
    // FIXME: include process ID or something to ensure the queue time is valid for this process?
}

type SharedMatchmaker = Arc<Mutex<Matchmaker<RandomQueueSelector>>>;

async fn insert_player(
    State(matchmaker): State<SharedMatchmaker>,
    Json(payload): Json<QueueRequest>,
) -> Result<StatusCode, MatchmakerError> {
    let modes = payload.modes.into_iter().collect::<EnumSet<_>>();
    let mut matchmaker = matchmaker.lock().unwrap();
    matchmaker.insert_player(
        Player {
            id: payload.id,
            rating: payload.rating,
        },
        modes,
    )?;
    Ok(StatusCode::NO_CONTENT)
}

async fn requeue_player(
    State(matchmaker): State<SharedMatchmaker>,
    Json(payload): Json<RequeueRequest>,
) -> impl IntoResponse {
    let ticket_json = match BASE64_STANDARD.decode(payload.ticket.as_bytes()) {
        Ok(t) => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid ticket").into_response(),
    };
    let ticket: QueueTicket = match serde_json::from_slice(&ticket_json) {
        Ok(t) => t,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid ticket").into_response(),
    };
    let modes = ticket.modes.into_iter().collect::<EnumSet<_>>();

    let mut matchmaker = matchmaker.lock().unwrap();
    match matchmaker.requeue_player(
        Player {
            id: ticket.id,
            rating: ticket.rating,
        },
        modes,
        // FIXME: https://github.com/serde-rs/serde/issues/1375
        ticket.queue_time,
    ) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn cancel(
    State(matchmaker): State<SharedMatchmaker>,
    Path(id): Path<usize>,
) -> impl IntoResponse {
    let mut matchmaker = matchmaker.lock().unwrap();
    if matchmaker.remove_player(id).is_some() {
        StatusCode::NO_CONTENT.into_response()
    } else {
        // FIXME: Return a Result that gets converted into a statuscode + error code for the client?
        (StatusCode::NOT_FOUND, Json(())).into_response()
    }
}
