//! HTTP routes for uploading maps, regenerating their images and syncing the maps in an app
//! install's map folders. Uploads are plain multipart requests rather than GraphQL, since they
//! carry files of up to 100 MB.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::multipart::MultipartError;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Serialize;
use tower_http::timeout::TimeoutLayer;
use tracing::error;
use typeshare::typeshare;

use crate::maps::SbMapId;
use crate::maps::ingest::MapIngestError;
use crate::maps::local_files::{
    CheckLocalMapFilesRequest, CheckLocalMapFilesResponse, LocalMapFilesError,
    LocalMapFilesRepoError, SyncLocalMapFilesRequest, SyncLocalMapFilesResponse,
};
use crate::maps::parse::{MAX_MAP_FILE_BYTES, MapExtension};
use crate::state::AppState;
use crate::users::{CurrentUser, SbUserId};

/// Uploads, parsing and rendering a 100 MB map included, take far longer than other requests.
const MAP_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Room for the multipart framing and the other form fields around the file.
const MULTIPART_OVERHEAD_BYTES: usize = 64 * 1024;

const UPLOADS_PER_MINUTE: u32 = 20;
/// A first sync of a large map collection takes one request per 1,000 files; later syncs are a
/// request per batch of changes.
const LOCAL_FILE_REQUESTS_PER_MINUTE: u32 = 120;
/// Sync requests carry at most 1,000 entries of a hash and a short folder path each.
const LOCAL_FILES_BODY_LIMIT: usize = 512 * 1024;
/// The same as the server's default, which `/maps` routes sit outside of.
const LOCAL_FILES_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub fn create_maps_api() -> Router<AppState> {
    let local_files = Router::new()
        .route("/", post(sync_local_map_files))
        .route("/check", post(check_local_map_files))
        .layer(DefaultBodyLimit::max(LOCAL_FILES_BODY_LIMIT))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            LOCAL_FILES_REQUEST_TIMEOUT,
        ));
    Router::new()
        .route("/", post(upload_map))
        .route("/official", post(upload_official_map))
        .route("/{map_id}/regenerate", post(regenerate_map_images))
        .layer(DefaultBodyLimit::max(
            MAX_MAP_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
        ))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            MAP_REQUEST_TIMEOUT,
        ))
        .nest("/local-files", local_files)
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
enum MapApiError {
    InvalidMapFile,
    NoPlayerSlots,
    FileTooLarge,
    BadRequest(&'static str),
    Forbidden,
    NotFound,
    TooManyUploads,
    TooManyRequests,
    InvalidLocalFiles(LocalMapFilesError),
    Internal,
}

#[derive(Serialize)]
struct ApiErrorBody {
    code: &'static str,
    message: Cow<'static, str>,
}

impl IntoResponse for MapApiError {
    fn into_response(self) -> Response {
        let (status, code, message): (_, _, Cow<'static, str>) = match self {
            Self::InvalidMapFile => (
                StatusCode::BAD_REQUEST,
                "invalidMapFile",
                "The map file is invalid or couldn't be read".into(),
            ),
            Self::NoPlayerSlots => (
                StatusCode::BAD_REQUEST,
                "noPlayerSlots",
                "The map has no player slots".into(),
            ),
            Self::FileTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "MaxFileSizeExceeded",
                "The map file is too large".into(),
            ),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "badRequest", message.into()),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden", "Forbidden".into()),
            Self::NotFound => (StatusCode::NOT_FOUND, "notFound", "Map not found".into()),
            Self::TooManyUploads => (
                StatusCode::TOO_MANY_REQUESTS,
                "tooManyRequests",
                "Too many map uploads, try again later".into(),
            ),
            Self::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "tooManyRequests",
                "Too many requests, try again later".into(),
            ),
            Self::InvalidLocalFiles(e) => {
                let code = match e {
                    LocalMapFilesError::TooManyFiles => "tooManyLocalFiles",
                    _ => "badRequest",
                };
                (StatusCode::BAD_REQUEST, code, e.to_string().into())
            }
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internalServerError",
                "Internal server error".into(),
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

impl From<LocalMapFilesRepoError> for MapApiError {
    fn from(e: LocalMapFilesRepoError) -> Self {
        match e {
            LocalMapFilesRepoError::Invalid(e) => Self::InvalidLocalFiles(e),
            LocalMapFilesRepoError::Internal(e) => {
                error!("Local map files request failed: {e:?}");
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

/// Limits how many requests of one kind each user can make per minute.
pub struct UserThrottle {
    per_minute: u32,
    windows: Mutex<HashMap<SbUserId, (Instant, u32)>>,
}

impl UserThrottle {
    fn new(per_minute: u32) -> Self {
        Self {
            per_minute,
            windows: Mutex::new(HashMap::new()),
        }
    }

    pub fn for_uploads() -> Self {
        Self::new(UPLOADS_PER_MINUTE)
    }

    pub fn for_local_files() -> Self {
        Self::new(LOCAL_FILE_REQUESTS_PER_MINUTE)
    }

    fn try_acquire(&self, user_id: SbUserId) -> bool {
        const WINDOW: Duration = Duration::from_secs(60);
        let now = Instant::now();
        let mut windows = self.windows.lock().expect("throttle lock");
        windows.retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
        let (_, count) = windows.entry(user_id).or_insert((now, 0));
        if *count >= self.per_minute {
            false
        } else {
            *count += 1;
            true
        }
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
        .upload(upload.bytes, upload.extension, current_user.id, false)
        .await?;
    Ok(Json(UploadMapResponse { map_id }))
}

async fn upload_official_map(
    State(state): State<AppState>,
    current_user: CurrentUser,
    multipart: Multipart,
) -> Result<Json<UploadMapResponse>, MapApiError> {
    if !current_user.permissions.manage_maps {
        return Err(MapApiError::Forbidden);
    }
    let upload = read_upload(multipart).await?;
    let map_id = state
        .map_ingester
        .upload(upload.bytes, upload.extension, current_user.id, true)
        .await?;
    Ok(Json(UploadMapResponse { map_id }))
}

/// Brings the server's copy of the maps in one of the current user's installs up to date.
async fn sync_local_map_files(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Json(request): Json<SyncLocalMapFilesRequest>,
) -> Result<Json<SyncLocalMapFilesResponse>, MapApiError> {
    if !state.map_local_files_throttle.try_acquire(current_user.id) {
        return Err(MapApiError::TooManyRequests);
    }
    Ok(Json(
        state.local_map_files.sync(current_user.id, request).await?,
    ))
}

/// Finds which of a set of map file hashes the server already has.
async fn check_local_map_files(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Json(request): Json<CheckLocalMapFilesRequest>,
) -> Result<Json<CheckLocalMapFilesResponse>, MapApiError> {
    if !state.map_local_files_throttle.try_acquire(current_user.id) {
        return Err(MapApiError::TooManyRequests);
    }
    Ok(Json(state.local_map_files.check(request).await?))
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
