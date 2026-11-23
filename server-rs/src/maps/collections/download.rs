//! The list of map files a collection download fetches.
//!
//! A collection is downloaded by the client, which fetches each map file from the file store and
//! builds the archive itself. This module answers which files a viewer's download holds: each
//! one's name in the archive and a signed file store URL to fetch it from.

use std::collections::HashSet;
use std::net::IpAddr;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum_client_ip::ClientIp;
use color_eyre::eyre::{self, WrapErr};
use serde::Serialize;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use tracing::error;
use typeshare::typeshare;
use uuid::Uuid;

use crate::maps::api::{MapApiError, Throttle};
use crate::maps::collections::{self, Viewer};
use crate::maps::ingest::map_file_path;
use crate::maps::search::{COLLECTION_JOINS, push_collection_entries_condition};
use crate::maps::{MapHash, SbMapId};
use crate::state::AppState;
use crate::users::{CurrentUser, SbUserId};

/// How many file lists each user (or, logged out, each IP address) can get per window.
const DOWNLOADS_PER_WINDOW: u32 = 6;
const DOWNLOAD_WINDOW: Duration = Duration::from_secs(10 * 60);
/// How long the signed URLs of a file list can be used for. A download fetches the files one after
/// another, so the last URL is used long after the first.
const FILE_URL_LIFETIME: Duration = Duration::from_secs(60 * 60);
/// The longest a file name in an archive can be, in characters, before its extension.
const MAX_FILE_NAME_CHARS: usize = 100;

/// Characters that are left out of file names: path separators, double quotes and the rest of the
/// characters Windows doesn't allow in file names.
const FORBIDDEN_FILE_NAME_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct CollectionDownloadFilesResponse {
    /// The files to download, in the collection's order.
    pub files: Vec<CollectionDownloadFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct CollectionDownloadFile {
    /// The file's name in the archive, unique within it.
    pub name: String,
    /// A signed URL to fetch the file from.
    pub url: String,
}

/// Who asked for a file list, for throttling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum DownloadRequester {
    User(SbUserId),
    Ip(IpAddr),
}

/// What collection downloads share across requests.
pub struct CollectionDownloads {
    throttle: Throttle<DownloadRequester>,
}

impl Default for CollectionDownloads {
    fn default() -> Self {
        Self {
            throttle: Throttle::new(DOWNLOADS_PER_WINDOW, DOWNLOAD_WINDOW),
        }
    }
}

/// A map file a collection archive holds.
#[derive(Debug, FromRow)]
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

/// Lists the files of a collection's download. Fails with `CollectionNotFound` when the collection
/// doesn't exist, the viewer can't see it, or it holds no maps the viewer sees.
pub(crate) async fn list_download_files(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    current_user: Option<CurrentUser>,
    Path(collection_id): Path<Uuid>,
) -> Result<Response, MapApiError> {
    let requester = match &current_user {
        Some(user) => DownloadRequester::User(user.id),
        None => DownloadRequester::Ip(ip),
    };
    if !state.collection_downloads.throttle.try_acquire(requester) {
        return Err(MapApiError::TooManyDownloads);
    }

    let viewer = Viewer::of(current_user.as_ref());
    let row = collections::load(&state.db_pool, collection_id)
        .await
        .map_err(internal_error)?
        .filter(|row| row.can_read(viewer))
        .ok_or(MapApiError::CollectionNotFound)?;
    let files = load_archive_files(&state.db_pool, collection_id, row.sees_all_entries(viewer))
        .await
        .map_err(internal_error)?;
    if files.is_empty() {
        return Err(MapApiError::CollectionNotFound);
    }

    let mut download_files = Vec::new();
    for entry in archive_entries(&files) {
        let url = state
            .file_store
            .signed_url_with_expiry(&entry.path, FILE_URL_LIFETIME)
            .await
            .wrap_err_with(|| format!("Failed to sign the URL of {}", entry.path))
            .map_err(internal_error)?;
        download_files.push(CollectionDownloadFile {
            name: entry.name,
            url,
        });
    }
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(CollectionDownloadFilesResponse {
            files: download_files,
        }),
    )
        .into_response())
}

/// Something a collection archive holds: the name it has in the archive, and where to read it from.
#[derive(Debug)]
struct ArchiveEntry {
    name: String,
    path: String,
}

/// Names the entries of an archive of `files`, in order: each is its map's name with its file's
/// extension, as a single map's download is named, made unique within the archive.
fn archive_entries(files: &[ArchiveFile]) -> Vec<ArchiveEntry> {
    let names = unique_file_names(files.iter().map(|f| {
        (
            sanitize_file_name(&f.name, "map"),
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

/// Makes `name` safe to use as a file name (without its extension) on any OS: leaves out control
/// characters, double quotes, path separators and the other characters Windows doesn't allow,
/// trims it, and caps its length. Returns `fallback` if nothing is left.
fn sanitize_file_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && !FORBIDDEN_FILE_NAME_CHARS.contains(c))
        .collect();
    let capped: String = cleaned.trim().chars().take(MAX_FILE_NAME_CHARS).collect();
    // Windows drops trailing dots and spaces from file names
    let trimmed = capped.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(sanitize_file_name("투혼 1.3", "map"), "투혼 1.3");
        assert_eq!(sanitize_file_name("trailing... ", "map"), "trailing");
        assert_eq!(sanitize_file_name("", "map"), "map");
        assert_eq!(sanitize_file_name(" /\\?* ", "maps"), "maps");

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
}
