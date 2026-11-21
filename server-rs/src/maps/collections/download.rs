//! Downloading every map of a collection as one zip archive.
//!
//! A browser can't attach the session JWT to a plain navigation, so a download takes two requests:
//! the client asks for a short-lived download token with its session (`POST .../download-url`),
//! then navigates to the archive with that token in the URL (`GET .../download`). The token
//! carries what the viewer was allowed to see when it was issued.
//!
//! Archives are streamed: map files are read from the file store one at a time and written as
//! stored (uncompressed) entries, since map files are already compressed. Archives over 4 GB use
//! Zip64. A file is held in memory from when it's read until its entry is written, so how many
//! files all archive builds together hold at once is bounded, and a client that stops reading
//! fails its download rather than holding a file forever.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::future::Future;
use std::io;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use async_graphql::futures_util::{StreamExt, future, stream};
use async_zip::base::write::ZipFileWriter;
use async_zip::error::ZipError;
use async_zip::{Compression, ZipDateTime, ZipDateTimeBuilder, ZipEntryBuilder};
use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::Response;
use axum_client_ip::ClientIp;
use chrono::{DateTime, Datelike, Timelike, Utc};
use color_eyre::eyre::{self, WrapErr};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::sync::Semaphore;
use tokio_util::io::ReaderStream;
use tokio_util::task::AbortOnDropHandle;
use tracing::error;
use typeshare::typeshare;
use uuid::Uuid;

use crate::file_store::FileStore;
use crate::maps::api::{MapApiError, Throttle};
use crate::maps::collections::{self, Viewer};
use crate::maps::ingest::map_file_path;
use crate::maps::search::{COLLECTION_JOINS, push_collection_entries_condition};
use crate::maps::{MapHash, SbMapId};
use crate::state::AppState;
use crate::users::{CurrentUser, SbUserId};

/// The `purpose` claim of a download token, which no other token the server reads carries.
const TOKEN_PURPOSE: &str = "collection-download";
/// How long a download token can be used for. The client uses it right after it gets it.
const TOKEN_LIFETIME_SECS: u64 = 60;
/// How many download tokens each user (or, logged out, each IP address) can get per window.
const DOWNLOADS_PER_WINDOW: u32 = 6;
const DOWNLOAD_WINDOW: Duration = Duration::from_secs(10 * 60);
/// How many map files (up to 100 MB each) all archive builds together can hold in memory at once.
/// A build holds one from reading it until its entry is written.
const MAX_FILES_IN_MEMORY: usize = 4;
/// How long writing an archive entry may take regardless of its size, and the rate its bytes must
/// be sent at beyond that, before the client counts as stalled.
const ENTRY_WRITE_GRACE: Duration = Duration::from_secs(30);
const MIN_ENTRY_WRITE_BYTES_PER_SEC: u64 = 50 * 1000;
/// How much of an archive is buffered between writing it and sending it.
const ARCHIVE_BUFFER_BYTES: usize = 256 * 1024;
/// The longest a file name in or of an archive can be, in characters, before its extension.
const MAX_FILE_NAME_CHARS: usize = 100;
/// The name of an archive whose requested name has nothing usable left after sanitizing.
const FALLBACK_ARCHIVE_NAME: &str = "maps";
/// The name of an archive entry whose map name has nothing usable left after sanitizing.
const FALLBACK_ENTRY_NAME: &str = "map";

/// Characters that are left out of file names: path separators, double quotes and the rest of the
/// characters Windows doesn't allow in file names.
const FORBIDDEN_FILE_NAME_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
/// Unicode direction controls, which can make a name display with a different extension than it
/// has.
const BIDI_CONTROL_CHARS: &[char] = &[
    '\u{200e}', '\u{200f}', '\u{202a}', '\u{202b}', '\u{202c}', '\u{202d}', '\u{202e}', '\u{2066}',
    '\u{2067}', '\u{2068}', '\u{2069}',
];
/// Device names Windows reserves, which can't be used as a file name with any extension.
const RESERVED_WINDOWS_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct CollectionDownloadTokenResponse {
    /// Passed as the `token` query parameter of the collection's download URL.
    pub token: String,
}

/// Who asked for a download token, for throttling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum DownloadRequester {
    User(SbUserId),
    Ip(IpAddr),
}

/// What collection downloads share across requests.
pub struct CollectionDownloads {
    tokens: DownloadTokens,
    throttle: Throttle<DownloadRequester>,
    /// One permit per map file an archive build holds in memory.
    files_in_memory: Arc<Semaphore>,
}

impl CollectionDownloads {
    /// `jwt_secret` signs download tokens. A download token can't be used as a session token, nor
    /// the reverse.
    pub fn new(jwt_secret: &[u8]) -> Self {
        Self {
            tokens: DownloadTokens::new(jwt_secret),
            throttle: Throttle::new(DOWNLOADS_PER_WINDOW, DOWNLOAD_WINDOW),
            files_in_memory: Arc::new(Semaphore::new(MAX_FILES_IN_MEMORY)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadClaims {
    purpose: String,
    collection_id: Uuid,
    /// Whether the archive holds every entry of the collection, rather than only the entries whose
    /// map is listed.
    all_entries: bool,
    /// When the token expires, in seconds since the Unix epoch.
    exp: u64,
}

/// What a valid download token allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DownloadGrant {
    /// Whether the archive holds every entry of the collection, rather than only the entries whose
    /// map is listed.
    pub all_entries: bool,
}

/// Issues and checks download tokens: JWTs that let their holder download one collection's archive
/// for [`TOKEN_LIFETIME_SECS`].
pub(crate) struct DownloadTokens {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    validation: Validation,
}

impl DownloadTokens {
    pub(crate) fn new(secret: &[u8]) -> Self {
        let mut validation = Validation::new(Algorithm::HS256);
        // The lifetime is short enough that the default leeway would more than double it
        validation.leeway = 0;
        validation.set_required_spec_claims(&["exp"]);
        Self {
            encoding_key: EncodingKey::from_secret(secret),
            decoding_key: DecodingKey::from_secret(secret),
            validation,
        }
    }

    pub(crate) fn issue(&self, collection_id: Uuid, all_entries: bool) -> eyre::Result<String> {
        self.issue_expiring_at(
            collection_id,
            all_entries,
            jsonwebtoken::get_current_timestamp() + TOKEN_LIFETIME_SECS,
        )
    }

    fn issue_expiring_at(
        &self,
        collection_id: Uuid,
        all_entries: bool,
        exp: u64,
    ) -> eyre::Result<String> {
        let claims = DownloadClaims {
            purpose: TOKEN_PURPOSE.to_string(),
            collection_id,
            all_entries,
            exp,
        };
        jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &self.encoding_key)
            .wrap_err("Failed to sign download token")
    }

    /// Returns what `token` allows for the collection `collection_id`, or `None` if it isn't a valid,
    /// unexpired download token for that collection.
    pub(crate) fn verify(&self, token: &str, collection_id: Uuid) -> Option<DownloadGrant> {
        let claims =
            jsonwebtoken::decode::<DownloadClaims>(token, &self.decoding_key, &self.validation)
                .ok()?
                .claims;
        (claims.purpose == TOKEN_PURPOSE && claims.collection_id == collection_id).then_some(
            DownloadGrant {
                all_entries: claims.all_entries,
            },
        )
    }
}

/// A map file a collection archive holds.
#[derive(Debug, Clone, FromRow)]
struct ArchiveFile {
    id: SbMapId,
    hash: MapHash,
    extension: String,
    name: String,
}

/// Loads the files of a collection's entries, as a viewer who sees every entry (`all_entries`) or
/// only the entries whose map is listed sees them, in the collection's order. A file that more than
/// one entry shows is only included once, for its first entry.
async fn load_archive_files(
    db: &PgPool,
    collection_id: Uuid,
    all_entries: bool,
    limit: Option<i64>,
) -> eyre::Result<Vec<ArchiveFile>> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT m.id, m.hash, m.extension::text AS extension, COALESCE(m.name, '') AS name \
         FROM collection_maps cm",
    );
    query.push(COLLECTION_JOINS).push(" WHERE ");
    push_collection_entries_condition(&mut query, collection_id, !all_entries);
    // The collection's order, as `COLLECTION_ORDER` sorts a collection's maps
    query.push(
        " ORDER BY cm.position, \
         CASE WHEN isfinite(cm.added_at) THEN cm.added_at END DESC NULLS LAST, m.id",
    );
    if let Some(limit) = limit {
        query.push(" LIMIT ").push_bind(limit);
    }
    let files = query
        .build_query_as::<ArchiveFile>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load the collection's files")?;
    let mut seen = HashSet::new();
    Ok(files.into_iter().filter(|f| seen.insert(f.id)).collect())
}

fn internal_error(e: eyre::Report) -> MapApiError {
    error!("Collection download request failed: {e:?}");
    MapApiError::Internal
}

/// Issues a token for downloading a collection's archive. Fails with `CollectionNotFound` when the
/// collection doesn't exist, the viewer can't see it, or it holds no maps the viewer sees.
pub(crate) async fn create_download_token(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    current_user: Option<CurrentUser>,
    Path(collection_id): Path<Uuid>,
) -> Result<Json<CollectionDownloadTokenResponse>, MapApiError> {
    let downloads = &state.collection_downloads;
    let requester = match &current_user {
        Some(user) => DownloadRequester::User(user.id),
        None => DownloadRequester::Ip(ip),
    };
    if !downloads.throttle.try_acquire(requester) {
        return Err(MapApiError::TooManyDownloads);
    }

    let viewer = Viewer::of(current_user.as_ref());
    let row = collections::load(&state.db_pool, collection_id)
        .await
        .map_err(internal_error)?
        .filter(|row| row.can_read(viewer))
        .ok_or(MapApiError::CollectionNotFound)?;
    let all_entries = row.sees_all_entries(viewer);
    let any_files = !load_archive_files(&state.db_pool, collection_id, all_entries, Some(1))
        .await
        .map_err(internal_error)?
        .is_empty();
    if !any_files {
        return Err(MapApiError::CollectionNotFound);
    }

    let token = downloads
        .tokens
        .issue(collection_id, all_entries)
        .map_err(internal_error)?;
    Ok(Json(CollectionDownloadTokenResponse { token }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DownloadQuery {
    #[serde(default)]
    token: String,
    /// What to name the archive (without `.zip`), sanitized before use.
    #[serde(default)]
    name: String,
}

/// Streams a collection's archive to the holder of a download token for it.
pub(crate) async fn download_collection(
    State(state): State<AppState>,
    Path(collection_id): Path<Uuid>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, MapApiError> {
    let downloads = &state.collection_downloads;
    let grant = downloads
        .tokens
        .verify(&query.token, collection_id)
        .ok_or(MapApiError::Forbidden)?;
    collections::load(&state.db_pool, collection_id)
        .await
        .map_err(internal_error)?
        .ok_or(MapApiError::CollectionNotFound)?;
    let files = load_archive_files(&state.db_pool, collection_id, grant.all_entries, None)
        .await
        .map_err(internal_error)?;
    let entries = archive_entries(&files);

    let (reader, writer) = tokio::io::duplex(ARCHIVE_BUFFER_BYTES);
    let file_store = state.file_store.clone();
    let files_in_memory = downloads.files_in_memory.clone();
    // Aborted when the response body is dropped (e.g. the client disconnected), which also
    // releases any file it holds
    let build = AbortOnDropHandle::new(tokio::spawn(async move {
        write_archive(
            writer,
            &entries,
            &file_store,
            &files_in_memory,
            zip_timestamp(Utc::now()),
        )
        .await
        .map(drop)
    }));
    // Ends the body with an error if the archive couldn't be finished, so the download fails
    // instead of ending with a truncated archive
    let finish = stream::once(async move {
        let error = match build.await {
            Ok(Ok(())) => return None,
            Ok(Err(e)) => format!("{e:?}"),
            Err(e) => format!("{e:?}"),
        };
        error!("Building collection {collection_id}'s archive failed: {error}");
        Some(Err(io::Error::other("building the archive failed")))
    })
    .filter_map(future::ready);
    let body = Body::from_stream(ReaderStream::new(reader).chain(finish));

    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            content_disposition(&query.name),
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .map_err(|e| internal_error(e.into()))
}

/// Something a collection archive holds: the name it has in the archive, and where to read it from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ArchiveEntry {
    name: String,
    path: String,
}

/// Names the entries of an archive of `files`, in order: each is its map's name with its file's
/// extension, as a single map's download is named, made unique within the archive.
fn archive_entries(files: &[ArchiveFile]) -> Vec<ArchiveEntry> {
    let names = unique_file_names(files.iter().map(|f| {
        (
            sanitize_file_name(&f.name, FALLBACK_ENTRY_NAME),
            f.extension.trim().to_lowercase(),
        )
    }));
    files
        .iter()
        .zip(names)
        .map(|(file, name)| ArchiveEntry {
            name,
            path: map_file_path(&file.hash, file.extension.trim()),
        })
        .collect()
}

/// Where the files of an archive are read from.
trait ArchiveSource: Sync {
    fn load(&self, path: &str) -> impl Future<Output = eyre::Result<Bytes>> + Send;
}

impl ArchiveSource for FileStore {
    async fn load(&self, path: &str) -> eyre::Result<Bytes> {
        self.read(path).await.map(Bytes::from)
    }
}

#[derive(Debug, thiserror::Error)]
enum ArchiveError {
    #[error(transparent)]
    Zip(#[from] ZipError),
    #[error("the client stopped reading while {0} was being written")]
    Stalled(String),
}

/// How long writing `bytes` to the client may take before it counts as stalled.
fn write_budget(bytes: usize) -> Duration {
    ENTRY_WRITE_GRACE + Duration::from_secs(bytes as u64 / MIN_ENTRY_WRITE_BYTES_PER_SEC)
}

/// Writes a zip archive of `entries` to `writer`, reading their files from `source` one at a time.
/// Entries are stored rather than compressed. A file that can't be read is logged and left out.
/// Each file takes a permit of `files_in_memory` from before it's read until its entry is written.
/// Fails with `Stalled` if `writer` stops accepting bytes for longer than [`write_budget`] allows.
/// Returns `writer` once the archive is complete and `writer` is shut down.
async fn write_archive<W: AsyncWrite + Unpin>(
    writer: W,
    entries: &[ArchiveEntry],
    source: &impl ArchiveSource,
    files_in_memory: &Semaphore,
    modified: ZipDateTime,
) -> Result<W, ArchiveError> {
    let mut zip = ZipFileWriter::with_tokio(writer);
    for entry in entries {
        let _permit = files_in_memory
            .acquire()
            .await
            .expect("the file semaphore is never closed");
        let data = match source.load(&entry.path).await {
            Ok(data) => data,
            Err(e) => {
                error!(
                    "Couldn't read {} for a collection archive, leaving it out: {e:?}",
                    entry.path
                );
                continue;
            }
        };
        let zip_entry = ZipEntryBuilder::new(entry.name.clone().into(), Compression::Stored)
            .last_modification_date(modified);
        tokio::time::timeout(
            write_budget(data.len()),
            zip.write_entry_whole(zip_entry, &data),
        )
        .await
        .map_err(|_| ArchiveError::Stalled(entry.name.clone()))??;
    }
    // The central directory holds no map file, but a stalled client would still hold the build
    // open
    tokio::time::timeout(ENTRY_WRITE_GRACE, async {
        let mut writer = zip.close().await?.into_inner();
        writer.shutdown().await?;
        Ok::<_, ZipError>(writer)
    })
    .await
    .map_err(|_| ArchiveError::Stalled("the central directory".to_string()))?
    .map_err(ArchiveError::from)
}

/// `time` as an archive entry's modification time.
fn zip_timestamp(time: DateTime<Utc>) -> ZipDateTime {
    ZipDateTimeBuilder::new()
        .year(time.year())
        .month(time.month())
        .day(time.day())
        .hour(time.hour())
        .minute(time.minute())
        .second(time.second())
        .build()
}

/// Makes `name` safe to use as a file name (without its extension) on any OS: leaves out control
/// characters, direction controls, double quotes, path separators and the other characters Windows
/// doesn't allow, trims it, and caps its length. Returns `fallback` if nothing is left.
fn sanitize_file_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| {
            !c.is_control()
                && !FORBIDDEN_FILE_NAME_CHARS.contains(c)
                && !BIDI_CONTROL_CHARS.contains(c)
        })
        .collect();
    let capped: String = cleaned.trim().chars().take(MAX_FILE_NAME_CHARS).collect();
    // Windows drops trailing dots and spaces from file names
    let trimmed = capped.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        fallback.to_string()
    } else if is_reserved_windows_name(trimmed) {
        format!("_{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Whether Windows reserves `name` (or the part of it before its first dot) for a device.
fn is_reserved_windows_name(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or(name).trim_end();
    RESERVED_WINDOWS_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(base))
}

/// Joins each name and extension into a file name, adding ` (2)`, ` (3)`, ... before the extension
/// of a name an earlier file already has (ignoring case).
fn unique_file_names(names: impl IntoIterator<Item = (String, String)>) -> Vec<String> {
    let mut taken = HashSet::new();
    names
        .into_iter()
        .map(|(name, extension)| {
            let mut copy = 1;
            loop {
                let candidate = if copy == 1 {
                    format!("{name}.{extension}")
                } else {
                    format!("{name} ({copy}).{extension}")
                };
                if taken.insert(candidate.to_lowercase()) {
                    return candidate;
                }
                copy += 1;
            }
        })
        .collect()
}

/// The `Content-Disposition` of an archive named `name` (sanitized here): an ASCII `filename` for
/// older clients, and the full name as `filename*` (RFC 5987) for the rest.
fn content_disposition(name: &str) -> String {
    let name = sanitize_file_name(name, FALLBACK_ARCHIVE_NAME);
    let ascii = name
        .chars()
        .filter(char::is_ascii)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let ascii = if ascii.chars().any(|c| c.is_ascii_alphanumeric()) {
        ascii
    } else {
        FALLBACK_ARCHIVE_NAME.to_string()
    };
    format!(
        "attachment; filename=\"{ascii}.zip\"; filename*=UTF-8''{}",
        encode_rfc5987(&format!("{name}.zip"))
    )
}

/// Percent-encodes `value` as an RFC 5987 `ext-value`, leaving only `attr-char`s as they are.
fn encode_rfc5987(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            write!(encoded, "%{byte:02X}").expect("writing to a String can't fail");
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    // The newer `read1` reader doesn't expose entry names yet
    #[allow(deprecated)]
    use async_zip::base::read::mem::ZipFileReader;

    use super::*;

    const SECRET: &[u8] = b"test-secret";

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(
            sanitize_file_name(" Fighting Spirit 1.3 ", "map"),
            "Fighting Spirit 1.3"
        );
        assert_eq!(
            sanitize_file_name("a<b>c:d\"e/f\\g|h?i*j", "map"),
            "abcdefghij"
        );
        assert_eq!(sanitize_file_name("Hunter's", "map"), "Hunter's");
        assert_eq!(
            sanitize_file_name("tab\there\nnew\u{7f}", "map"),
            "tabherenew"
        );
        assert_eq!(
            sanitize_file_name("evil\u{202e}xcs.exe", "map"),
            "evilxcs.exe"
        );
        assert_eq!(sanitize_file_name("투혼 1.3", "map"), "투혼 1.3");
        assert_eq!(sanitize_file_name("trailing... ", "map"), "trailing");
        assert_eq!(sanitize_file_name("", "map"), "map");
        assert_eq!(sanitize_file_name(" /\\?* ", "maps"), "maps");
        assert_eq!(sanitize_file_name("con", "map"), "_con");
        assert_eq!(sanitize_file_name("LPT1.backup", "map"), "_LPT1.backup");
        assert_eq!(sanitize_file_name("Console", "map"), "Console");

        let long = "한".repeat(150);
        assert_eq!(
            sanitize_file_name(&long, "map").chars().count(),
            MAX_FILE_NAME_CHARS
        );
    }

    #[test]
    fn duplicate_names_get_numbered_ignoring_case() {
        let names = unique_file_names([
            ("Lost Temple".to_string(), "scm".to_string()),
            ("lost temple".to_string(), "scm".to_string()),
            ("Lost Temple".to_string(), "scx".to_string()),
            ("LOST TEMPLE".to_string(), "scm".to_string()),
            ("Lost Temple (2)".to_string(), "scm".to_string()),
        ]);
        assert_eq!(
            names,
            [
                "Lost Temple.scm",
                "lost temple (2).scm",
                "Lost Temple.scx",
                "LOST TEMPLE (3).scm",
                "Lost Temple (2) (2).scm",
            ]
        );
    }

    #[test]
    fn entries_are_named_after_their_maps() {
        let file = |name: &str, extension: &str, byte: u8| ArchiveFile {
            id: SbMapId(Uuid::new_v4()),
            hash: MapHash([byte; 32]),
            extension: extension.to_string(),
            name: name.to_string(),
        };
        let entries = archive_entries(&[
            file("Python", "scm ", 0xab),
            file("python", "SCX", 0xcd),
            file("Python", "scm", 0xef),
            file("???", "scx", 0x01),
        ]);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            ["Python.scm", "python.scx", "Python (2).scm", "map.scx"]
        );
        assert_eq!(
            entries[0].path,
            format!("maps/ab/ab/{}.scm", "ab".repeat(32))
        );
        assert_eq!(
            entries[1].path,
            format!("maps/cd/cd/{}.SCX", "cd".repeat(32))
        );
    }

    #[test]
    fn content_disposition_has_ascii_and_utf8_names() {
        assert_eq!(
            content_disposition("My maps"),
            "attachment; filename=\"My maps.zip\"; filename*=UTF-8''My%20maps.zip"
        );
        assert_eq!(
            content_disposition("투혼 maps"),
            "attachment; filename=\"maps.zip\"; \
             filename*=UTF-8''%ED%88%AC%ED%98%BC%20maps.zip"
        );
        assert_eq!(
            content_disposition("스타"),
            "attachment; filename=\"maps.zip\"; filename*=UTF-8''%EC%8A%A4%ED%83%80.zip"
        );
        assert_eq!(
            content_disposition("\"; evil=1"),
            "attachment; filename=\"; evil=1.zip\"; filename*=UTF-8''%3B%20evil%3D1.zip"
        );
        assert_eq!(
            content_disposition("Hunter's maps"),
            "attachment; filename=\"Hunter's maps.zip\"; \
             filename*=UTF-8''Hunter%27s%20maps.zip"
        );
        assert_eq!(
            content_disposition(""),
            "attachment; filename=\"maps.zip\"; filename*=UTF-8''maps.zip"
        );
    }

    #[test]
    fn tokens_round_trip() {
        let tokens = DownloadTokens::new(SECRET);
        let id = Uuid::new_v4();
        let token = tokens.issue(id, true).unwrap();
        assert_eq!(
            tokens.verify(&token, id),
            Some(DownloadGrant { all_entries: true })
        );
        let token = tokens.issue(id, false).unwrap();
        assert_eq!(
            tokens.verify(&token, id),
            Some(DownloadGrant { all_entries: false })
        );
    }

    #[test]
    fn expired_tokens_are_rejected() {
        let tokens = DownloadTokens::new(SECRET);
        let id = Uuid::new_v4();
        let past = jsonwebtoken::get_current_timestamp() - 1;
        let token = tokens.issue_expiring_at(id, true, past).unwrap();
        assert_eq!(tokens.verify(&token, id), None);
    }

    #[test]
    fn tokens_for_other_collections_are_rejected() {
        let tokens = DownloadTokens::new(SECRET);
        let token = tokens.issue(Uuid::new_v4(), true).unwrap();
        assert_eq!(tokens.verify(&token, Uuid::new_v4()), None);
    }

    #[test]
    fn tokens_with_another_purpose_are_rejected() {
        let tokens = DownloadTokens::new(SECRET);
        let id = Uuid::new_v4();
        let claims = DownloadClaims {
            purpose: "something-else".to_string(),
            collection_id: id,
            all_entries: true,
            exp: jsonwebtoken::get_current_timestamp() + TOKEN_LIFETIME_SECS,
        };
        let token = jsonwebtoken::encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(SECRET),
        )
        .unwrap();
        assert_eq!(tokens.verify(&token, id), None);
    }

    #[test]
    fn tokens_signed_with_another_secret_are_rejected() {
        let id = Uuid::new_v4();
        let token = DownloadTokens::new(b"other-secret")
            .issue(id, true)
            .unwrap();
        assert_eq!(DownloadTokens::new(SECRET).verify(&token, id), None);
    }

    impl ArchiveSource for HashMap<String, Vec<u8>> {
        async fn load(&self, path: &str) -> eyre::Result<Bytes> {
            self.get(path)
                .map(|data| Bytes::from(data.clone()))
                .ok_or_else(|| eyre::eyre!("{path} not found"))
        }
    }

    /// A source that has the same contents at every path.
    struct RepeatedSource(Bytes);

    impl ArchiveSource for RepeatedSource {
        async fn load(&self, _path: &str) -> eyre::Result<Bytes> {
            Ok(self.0.clone())
        }
    }

    /// A writer that never accepts a byte.
    struct StalledWriter;

    impl AsyncWrite for StalledWriter {
        fn poll_write(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            _buf: &[u8],
        ) -> std::task::Poll<io::Result<usize>> {
            std::task::Poll::Pending
        }

        fn poll_flush(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<io::Result<()>> {
            std::task::Poll::Pending
        }

        fn poll_shutdown(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<io::Result<()>> {
            std::task::Poll::Pending
        }
    }

    /// A writer that discards what it's given, keeping only how many bytes it got and the last
    /// `tail_len` of them.
    struct CountingWriter {
        written: u64,
        tail: Vec<u8>,
        tail_len: usize,
    }

    impl AsyncWrite for CountingWriter {
        fn poll_write(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            buf: &[u8],
        ) -> std::task::Poll<io::Result<usize>> {
            let this = self.get_mut();
            this.written += buf.len() as u64;
            this.tail
                .extend_from_slice(&buf[buf.len().saturating_sub(this.tail_len)..]);
            if this.tail.len() > 2 * this.tail_len {
                let excess = this.tail.len() - this.tail_len;
                this.tail.drain(..excess);
            }
            std::task::Poll::Ready(Ok(buf.len()))
        }

        fn poll_flush(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<io::Result<()>> {
            std::task::Poll::Ready(Ok(()))
        }

        fn poll_shutdown(
            self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<io::Result<()>> {
            std::task::Poll::Ready(Ok(()))
        }
    }

    fn entry(name: &str, path: &str) -> ArchiveEntry {
        ArchiveEntry {
            name: name.to_string(),
            path: path.to_string(),
        }
    }

    #[test]
    fn write_budgets_grow_with_size() {
        assert_eq!(write_budget(0), ENTRY_WRITE_GRACE);
        assert_eq!(
            write_budget(100 * 1000 * 1000),
            ENTRY_WRITE_GRACE + Duration::from_secs(2000)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn builds_fail_when_the_client_stops_reading() {
        let files = HashMap::from([("a.scm".to_string(), vec![1u8; 10_000])]);
        let files_in_memory = Semaphore::new(1);

        let result = write_archive(
            StalledWriter,
            &[entry("A.scm", "a.scm")],
            &files,
            &files_in_memory,
            zip_timestamp(Utc::now()),
        )
        .await;

        assert!(
            matches!(&result, Err(ArchiveError::Stalled(name)) if name == "A.scm"),
            "{:?}",
            result.err()
        );
        assert_eq!(files_in_memory.available_permits(), 1);
    }

    #[tokio::test]
    async fn archives_over_4_gib_use_zip64() {
        const FILE_BYTES: usize = 64 * 1024 * 1024;
        const FILE_COUNT: usize = 66;
        const TAIL_BYTES: usize = 1024 * 1024;
        let source = RepeatedSource(Bytes::from(vec![0x5a; FILE_BYTES]));
        let entries: Vec<_> = (0..FILE_COUNT)
            .map(|i| entry(&format!("map-{i}.scm"), "map.scm"))
            .collect();
        let writer = CountingWriter {
            written: 0,
            tail: Vec::new(),
            tail_len: TAIL_BYTES,
        };

        let writer = write_archive(
            writer,
            &entries,
            &source,
            &Semaphore::new(1),
            zip_timestamp(Utc::now()),
        )
        .await
        .unwrap();

        assert!(
            writer.written > 4 * 1024 * 1024 * 1024,
            "{}",
            writer.written
        );
        let has = |marker: &[u8]| writer.tail.windows(marker.len()).any(|w| w == marker);
        assert!(
            has(b"PK\x06\x06"),
            "no Zip64 end of central directory record"
        );
        assert!(
            has(b"PK\x06\x07"),
            "no Zip64 end of central directory locator"
        );
    }

    #[tokio::test]
    #[allow(deprecated)]
    async fn archives_round_trip() {
        let files = HashMap::from([
            ("a.scm".to_string(), b"first map".to_vec()),
            ("b.scx".to_string(), vec![0u8; 70_000]),
            ("c.scx".to_string(), b"third".to_vec()),
        ]);
        let entries = [
            entry("투혼 1.3.scm", "a.scm"),
            entry("Big.scx", "b.scx"),
            entry("Missing.scx", "missing.scx"),
            entry("Third.scx", "c.scx"),
        ];
        let modified = zip_timestamp(Utc::now());
        let files_in_memory = Semaphore::new(1);

        let archive = write_archive(Vec::new(), &entries, &files, &files_in_memory, modified)
            .await
            .unwrap();
        assert_eq!(files_in_memory.available_permits(), 1);

        let reader = ZipFileReader::new(archive).await.unwrap();
        let mut read = Vec::new();
        for index in 0..reader.file().entries().len() {
            let mut entry_reader = reader.reader_with_entry(index).await.unwrap();
            let entry = entry_reader.entry();
            assert_eq!(entry.compression(), Compression::Stored);
            let name = entry.filename().as_str().unwrap().to_string();
            let mut data = Vec::new();
            entry_reader.read_to_end_checked(&mut data).await.unwrap();
            read.push((name, data));
        }
        assert_eq!(
            read,
            [
                ("투혼 1.3.scm".to_string(), files["a.scm"].clone()),
                ("Big.scx".to_string(), files["b.scx"].clone()),
                ("Third.scx".to_string(), files["c.scx"].clone()),
            ]
        );
    }
}
