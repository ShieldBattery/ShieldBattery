//! HTTP routes for uploading maps, regenerating their images and listing the files of a collection
//! download. Uploads are plain multipart requests rather than GraphQL, since they carry files of up
//! to 100 MB.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::multipart::MultipartError;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::timeout::TimeoutLayer;
use tracing::error;
use typeshare::typeshare;

use crate::maps::SbMapId;
use crate::maps::collections::download::list_download_files;
use crate::maps::ingest::MapIngestError;
use crate::maps::parse::{MAX_MAP_FILE_BYTES, MapExtension};
use crate::state::AppState;
use crate::users::{CurrentUser, SbUserId};

/// Uploads, parsing and rendering a 100 MB map included, take far longer than other requests.
const MAP_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Room for the multipart framing and the other form fields around the file.
const MULTIPART_OVERHEAD_BYTES: usize = 64 * 1024;

const UPLOADS_PER_WINDOW: u32 = 20;
const UPLOAD_WINDOW: Duration = Duration::from_secs(60);

pub fn create_maps_api() -> Router<AppState> {
    Router::new()
        .route("/", post(upload_map))
        .route("/{map_id}/regenerate", post(regenerate_map_images))
        .route(
            "/collections/{collection_id}/download-files",
            get(list_download_files),
        )
        .layer(DefaultBodyLimit::max(
            MAX_MAP_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
        ))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            MAP_REQUEST_TIMEOUT,
        ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct UploadMapResponse {
    pub map_id: SbMapId,
}

/// Error codes match the ones the client already handles for map uploads
/// (`MapServiceErrorCode` and `FilesErrorCode`).
#[derive(Debug)]
pub(crate) enum MapApiError {
    InvalidMapFile,
    NoPlayerSlots,
    FileTooLarge,
    BadRequest(&'static str),
    Forbidden,
    NotFound,
    CollectionNotFound,
    TooManyUploads,
    TooManyDownloads,
    Internal,
}

#[derive(Serialize)]
struct ApiErrorBody {
    code: &'static str,
    message: &'static str,
}

impl IntoResponse for MapApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::InvalidMapFile => (
                StatusCode::BAD_REQUEST,
                "invalidMapFile",
                "The map file is invalid or couldn't be read",
            ),
            Self::NoPlayerSlots => (
                StatusCode::BAD_REQUEST,
                "noPlayerSlots",
                "The map has no player slots",
            ),
            Self::FileTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "MaxFileSizeExceeded",
                "The map file is too large",
            ),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "badRequest", message),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden", "Forbidden"),
            Self::NotFound => (StatusCode::NOT_FOUND, "notFound", "Map not found"),
            Self::CollectionNotFound => (StatusCode::NOT_FOUND, "notFound", "Collection not found"),
            Self::TooManyUploads => (
                StatusCode::TOO_MANY_REQUESTS,
                "tooManyRequests",
                "Too many map uploads, try again later",
            ),
            Self::TooManyDownloads => (
                StatusCode::TOO_MANY_REQUESTS,
                "tooManyRequests",
                "Too many collection downloads, try again later",
            ),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalServerError",
                "Internal server error",
            ),
        };
        (status, Json(ApiErrorBody { code, message })).into_response()
    }
}

impl From<MapIngestError> for MapApiError {
    fn from(e: MapIngestError) -> Self {
        match e {
            MapIngestError::InvalidMapFile => Self::InvalidMapFile,
            MapIngestError::NoPlayerSlots => Self::NoPlayerSlots,
            MapIngestError::NotFound => Self::NotFound,
            MapIngestError::Internal(e) => {
                error!("Map request failed: {e:?}");
                Self::Internal
            }
        }
    }
}

impl From<MultipartError> for MapApiError {
    fn from(e: MultipartError) -> Self {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            Self::FileTooLarge
        } else {
            Self::BadRequest("Invalid multipart body")
        }
    }
}

/// Limits how many requests each key (a user, an IP address, ...) can make in a fixed window that
/// starts with its first request.
pub struct Throttle<K> {
    limit: u32,
    window: Duration,
    windows: Mutex<HashMap<K, (Instant, u32)>>,
}

impl<K: Eq + Hash> Throttle<K> {
    pub fn new(limit: u32, window: Duration) -> Self {
        Self {
            limit,
            window,
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Counts a request from `key`, returning whether it is within the limit.
    pub fn try_acquire(&self, key: K) -> bool {
        let now = Instant::now();
        let mut windows = self.windows.lock().expect("throttle lock");
        windows.retain(|_, (start, _)| now.duration_since(*start) < self.window);
        let (_, count) = windows.entry(key).or_insert((now, 0));
        if *count >= self.limit {
            false
        } else {
            *count += 1;
            true
        }
    }
}

/// Limits how many maps each user can upload per minute.
pub type UploadThrottle = Throttle<SbUserId>;

impl UploadThrottle {
    pub fn for_uploads() -> Self {
        Self::new(UPLOADS_PER_WINDOW, UPLOAD_WINDOW)
    }
}

struct MapUpload {
    extension: MapExtension,
    bytes: Vec<u8>,
}

/// Reads the `extension` and `file` fields of an upload.
async fn read_upload(mut multipart: Multipart) -> Result<MapUpload, MapApiError> {
    let mut extension = None;
    let mut bytes = None;
    while let Some(field) = multipart.next_field().await? {
        match field.name() {
            Some("extension") => {
                let value = field.text().await?;
                extension = Some(
                    MapExtension::parse(value.trim())
                        .ok_or(MapApiError::BadRequest("Unsupported map extension"))?,
                );
            }
            Some("file") => {
                if bytes.is_some() {
                    return Err(MapApiError::BadRequest(
                        "A single map file must be provided",
                    ));
                }
                let data = field.bytes().await?;
                if data.len() > MAX_MAP_FILE_BYTES {
                    return Err(MapApiError::FileTooLarge);
                }
                bytes = Some(data.to_vec());
            }
            _ => {}
        }
    }
    Ok(MapUpload {
        extension: extension.ok_or(MapApiError::BadRequest("extension must be specified"))?,
        bytes: bytes.ok_or(MapApiError::BadRequest(
            "A single map file must be provided",
        ))?,
    })
}

async fn upload_map(
    State(state): State<AppState>,
    current_user: CurrentUser,
    multipart: Multipart,
) -> Result<Json<UploadMapResponse>, MapApiError> {
    if !state.map_upload_throttle.try_acquire(current_user.id) {
        return Err(MapApiError::TooManyUploads);
    }
    let upload = read_upload(multipart).await?;
    let map_id = state
        .map_ingester
        .upload(upload.bytes, upload.extension, current_user.id)
        .await?;
    Ok(Json(UploadMapResponse { map_id }))
}

async fn regenerate_map_images(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(map_id): Path<SbMapId>,
) -> Result<StatusCode, MapApiError> {
    if !current_user.permissions.manage_maps {
        return Err(MapApiError::Forbidden);
    }
    state.map_ingester.regenerate_images(map_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_limits_each_key_separately() {
        let throttle = Throttle::new(2, Duration::from_secs(60));
        assert!(throttle.try_acquire("a"));
        assert!(throttle.try_acquire("a"));
        assert!(!throttle.try_acquire("a"));
        assert!(throttle.try_acquire("b"));
    }

    #[test]
    fn throttle_resets_after_its_window() {
        let throttle = Throttle::new(1, Duration::ZERO);
        assert!(throttle.try_acquire("a"));
        assert!(throttle.try_acquire("a"));
    }
}
