//! Map ingestion: storing uploaded map files with their parsed data and images, re-rendering
//! images, and keeping every map's parsed data at the current parser version.

use std::collections::HashSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::Duration;

use async_graphql::futures_util::{StreamExt, stream};
use broodmap::Chk;
use color_eyre::eyre::{self, WrapErr, eyre};
use data_encoding::HEXLOWER;
use sqlx::types::Json;
use sqlx::{PgPool, Postgres, Transaction};
use tokio::sync::Semaphore;
use tracing::{error, info, warn};

use crate::async_rayon::spawn_rayon;
use crate::configuration::Settings;
use crate::file_store::{FileStore, WriteOptions};
use crate::maps::catalog::resolve_map_id;
use crate::maps::parse::{
    AnalysisTables, FINGERPRINT_VERSION, MAP_PARSER_VERSION, MapAnalysis, MapExtension,
    MapParseError, ParsedMap, ParsedMapFile, is_mojibake_of, map_file_hash, parse_map,
};
use crate::maps::render::{MapImage, MapRenderAssets, render_map_images};
use crate::maps::{MapHash, SbMapId};
use crate::users::SbUserId;

/// How long rejected uploads (and their files) are kept for reproducing parser bugs.
const REJECTION_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Delay before the first reparse run after startup, so it doesn't compete with startup work.
const REPARSE_STARTUP_DELAY: Duration = Duration::from_secs(2 * 60);
const REPARSE_INTERVAL: Duration = Duration::from_secs(60 * 60);
const REPARSE_BATCH_SIZE: i64 = 20;
/// Session-level advisory lock held while reparsing, so only one server reparses at a time.
const REPARSE_LOCK_KEY: i64 = 0x5342_4d41_5052_5345; // "SBMAPRSE"

#[derive(Debug, thiserror::Error)]
pub enum MapIngestError {
    #[error("the map file couldn't be parsed")]
    InvalidMapFile,
    #[error("the map has no player slots")]
    NoPlayerSlots,
    #[error("map not found")]
    NotFound,
    #[error("map images can't be rendered on this server")]
    RenderingUnavailable,
    #[error(transparent)]
    Internal(#[from] eyre::Report),
}

/// The file store path of a map file.
pub fn map_file_path(hash: &MapHash, extension: &str) -> String {
    let hash = HEXLOWER.encode(&hash.0);
    format!("maps/{}/{}/{hash}.{extension}", &hash[0..2], &hash[2..4])
}

/// The file store path of one size of a map's image.
pub fn map_image_path(hash: &MapHash, size: u32) -> String {
    let hash = HEXLOWER.encode(&hash.0);
    format!(
        "map_images/{}/{}/{hash}-{size}.jpg",
        &hash[0..2],
        &hash[2..4]
    )
}

fn map_reject_path(hash: &MapHash, extension: &str) -> String {
    format!("map_rejects/{}.{extension}", HEXLOWER.encode(&hash.0))
}

pub struct MapIngester {
    db: PgPool,
    file_store: FileStore,
    analysis_tables: Option<Arc<AnalysisTables>>,
    render_assets: Option<Arc<MapRenderAssets>>,
    /// Limits how many maps are parsed or rendered at once, across uploads and the reparse job.
    parse_permits: Arc<Semaphore>,
    parse_concurrency: usize,
}

struct Processed {
    parsed: ParsedMap,
    images: Option<Vec<MapImage>>,
}

impl MapIngester {
    pub fn new(db: PgPool, file_store: FileStore, settings: &Settings) -> Self {
        let (analysis_tables, render_assets) = match &settings.map_assets {
            Some(dir) => {
                let tables = AnalysisTables::load(dir)
                    .inspect_err(|e| error!("Loading map analysis tables failed: {e:?}"))
                    .ok()
                    .map(Arc::new);
                let assets = MapRenderAssets::new(dir)
                    .inspect_err(|e| error!("Loading map render assets failed: {e:?}"))
                    .ok()
                    .map(Arc::new);
                (tables, assets)
            }
            None => {
                warn!("SB_MAP_ASSETS isn't set: uploaded maps get no images or terrain analysis");
                (None, None)
            }
        };
        Self {
            db,
            file_store,
            analysis_tables,
            render_assets,
            parse_permits: Arc::new(Semaphore::new(settings.map_parser_max_concurrent)),
            parse_concurrency: settings.map_parser_max_concurrent,
        }
    }

    /// Parses a map file (and renders its images, if `render` is set and rendering is configured)
    /// on the Rayon pool. A render failure leaves the map without images rather than failing.
    async fn process(&self, bytes: Arc<Vec<u8>>, render: bool) -> Result<Processed, MapParseError> {
        let _permit = self
            .parse_permits
            .acquire()
            .await
            .expect("parse semaphore is never closed");
        let tables = self.analysis_tables.clone();
        let assets = if render {
            self.render_assets.clone()
        } else {
            None
        };
        spawn_rayon(move || {
            catch_unwind(AssertUnwindSafe(|| {
                let ParsedMapFile { parsed, chk } = parse_map(&bytes, tables.as_deref())?;
                let images = assets.and_then(|assets| render_images(&chk, &assets));
                Ok(Processed { parsed, images })
            }))
            .unwrap_or_else(|_| Err(MapParseError::InvalidFile("the parser panicked".into())))
        })
        .await
    }

    /// Stores an uploaded map and adds it to the uploader's library, or publishes it as an
    /// official map. A file that's already stored isn't parsed again.
    pub async fn upload(
        &self,
        bytes: Vec<u8>,
        extension: MapExtension,
        uploaded_by: SbUserId,
        official: bool,
    ) -> Result<SbMapId, MapIngestError> {
        let hash = MapHash(map_file_hash(extension, &bytes));
        let existing = sqlx::query_scalar!(
            r#"SELECT id as "id: SbMapId" FROM maps WHERE hash = $1"#,
            hash as _,
        )
        .fetch_optional(&self.db)
        .await
        .wrap_err("Failed to look up map by hash")?;

        let map_id = match existing {
            Some(map_id) => map_id,
            None => {
                self.store_new_map(bytes, extension, hash, uploaded_by)
                    .await?
            }
        };

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        if official {
            sqlx::query!(
                r#"
                    UPDATE maps
                    SET official = true, published_by = $2, published_at = now(),
                        delisted_by = NULL, delisted_at = NULL
                    WHERE id = $1 AND NOT (listed AND official)
                "#,
                map_id as _,
                uploaded_by as _,
            )
            .execute(&mut *tx)
            .await
            .wrap_err("Failed to publish map")?;
        } else {
            sqlx::query!(
                r#"
                    INSERT INTO map_library (user_id, map_id, added_at)
                    VALUES ($1, $2, now())
                    ON CONFLICT (user_id, map_id) DO UPDATE SET added_at = now()
                "#,
                uploaded_by as _,
                map_id as _,
            )
            .execute(&mut *tx)
            .await
            .wrap_err("Failed to add map to library")?;
        }
        tx.commit().await.wrap_err("Failed to commit map upload")?;

        Ok(map_id)
    }

    async fn store_new_map(
        &self,
        bytes: Vec<u8>,
        extension: MapExtension,
        hash: MapHash,
        uploaded_by: SbUserId,
    ) -> Result<SbMapId, MapIngestError> {
        let bytes = Arc::new(bytes);
        let Processed { parsed, images } = match self.process(bytes.clone(), true).await {
            Ok(processed) => processed,
            Err(MapParseError::InvalidFile(reason)) => {
                warn!(
                    hash = HEXLOWER.encode(&hash.0),
                    "Rejected map upload: {reason}"
                );
                if let Err(e) = self
                    .record_rejection(&bytes, extension, &hash, &reason, uploaded_by)
                    .await
                {
                    error!("Failed to record rejected map upload: {e:?}");
                }
                return Err(MapIngestError::InvalidMapFile);
            }
        };
        if !parsed.has_player_slots() {
            return Err(MapIngestError::NoPlayerSlots);
        }

        // Files go first, so a map row never points at missing files.
        if let Some(images) = images {
            self.write_images(&hash, images).await?;
        }
        let bytes = Arc::try_unwrap(bytes).unwrap_or_else(|bytes| (*bytes).clone());
        self.file_store
            .write(
                &map_file_path(&hash, extension.as_str()),
                bytes,
                &WriteOptions::default(),
            )
            .await
            .wrap_err("Failed to store map file")?;

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        let inserted = sqlx::query_scalar!(
            r#"
                INSERT INTO maps (hash, extension, title, description, width, height, tileset,
                    players_melee, players_ums, lobby_init_data, is_eud, parser_version,
                    image_version, start_locations, ums_content)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14)
                ON CONFLICT (hash) DO NOTHING
                RETURNING id as "id: SbMapId"
            "#,
            hash as _,
            extension.as_str(),
            parsed.title,
            parsed.description,
            parsed.width,
            parsed.height,
            parsed.tileset,
            parsed.players_melee,
            parsed.players_ums,
            Json(&parsed.lobby_init_data) as _,
            parsed.is_eud,
            MAP_PARSER_VERSION,
            Json(&parsed.start_locations) as _,
            parsed.ums_content,
        )
        .fetch_optional(&mut *tx)
        .await
        .wrap_err("Failed to insert map")?;
        let map_id = match inserted {
            Some(map_id) => {
                write_analysis(&mut tx, map_id, &parsed.analysis).await?;
                map_id
            }
            // Stored by a concurrent upload of the same file.
            None => sqlx::query_scalar!(
                r#"SELECT id as "id: SbMapId" FROM maps WHERE hash = $1"#,
                hash as _,
            )
            .fetch_one(&mut *tx)
            .await
            .wrap_err("Failed to look up concurrently inserted map")?,
        };
        tx.commit().await.wrap_err("Failed to commit new map")?;

        Ok(map_id)
    }

    async fn write_images(&self, hash: &MapHash, images: Vec<MapImage>) -> eyre::Result<()> {
        let options = WriteOptions {
            content_type: Some("image/jpeg".into()),
            public: true,
            cache_control: None,
        };
        for image in images {
            self.file_store
                .write(&map_image_path(hash, image.size), image.jpeg, &options)
                .await
                .wrap_err("Failed to store map image")?;
        }
        Ok(())
    }

    async fn record_rejection(
        &self,
        bytes: &[u8],
        extension: MapExtension,
        hash: &MapHash,
        reason: &str,
        uploaded_by: SbUserId,
    ) -> eyre::Result<()> {
        self.file_store
            .write(
                &map_reject_path(hash, extension.as_str()),
                bytes.to_vec(),
                &WriteOptions::default(),
            )
            .await?;
        sqlx::query!(
            r#"
                INSERT INTO map_parse_rejections (hash, extension, error, uploaded_by, rejected_at)
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (hash) DO UPDATE
                SET error = $3, uploaded_by = $4, rejected_at = now()
            "#,
            hash as _,
            extension.as_str(),
            reason,
            uploaded_by as _,
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Renders a map's images again from its stored file, replacing the current ones.
    pub async fn regenerate_images(&self, map_id: SbMapId) -> Result<(), MapIngestError> {
        if self.render_assets.is_none() {
            return Err(MapIngestError::RenderingUnavailable);
        }
        let map_id = resolve_map_id(&self.db, map_id)
            .await?
            .ok_or(MapIngestError::NotFound)?;
        let map = sqlx::query!(
            r#"SELECT hash as "hash: MapHash", extension FROM maps WHERE id = $1"#,
            map_id as _,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to load map")?;
        let bytes = self
            .file_store
            .read(&map_file_path(&map.hash, map.extension.trim()))
            .await
            .wrap_err("Failed to read map file")?;

        let images = match self.process(Arc::new(bytes), true).await {
            Ok(Processed {
                images: Some(images),
                ..
            }) => images,
            Ok(Processed { images: None, .. }) => {
                return Err(eyre!("Rendering the map's images failed").into());
            }
            Err(MapParseError::InvalidFile(reason)) => {
                return Err(eyre!("Stored map file couldn't be parsed: {reason}").into());
            }
        };
        self.write_images(&map.hash, images).await?;
        sqlx::query!(
            "UPDATE maps SET image_version = image_version + 1 WHERE id = $1",
            map_id as _,
        )
        .execute(&self.db)
        .await
        .wrap_err("Failed to update image version")?;
        Ok(())
    }

    /// Reparses stored maps below the current parser version, then deletes expired rejected
    /// uploads; once soon after startup, then every hour.
    pub async fn maintenance_loop(self: Arc<Self>) {
        tokio::time::sleep(REPARSE_STARTUP_DELAY).await;
        let mut interval = tokio::time::interval(REPARSE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(e) = self.reparse_outdated_maps().await {
                error!("Reparsing maps failed: {e:?}");
            }
            if let Err(e) = self.delete_expired_rejections().await {
                error!("Deleting expired map rejections failed: {e:?}");
            }
        }
    }

    /// Brings every stored map to the current parser version, most-played maps first. A map that
    /// fails to parse keeps its old values and isn't retried until the parser version changes.
    pub async fn reparse_outdated_maps(&self) -> eyre::Result<()> {
        // The lock is held by this connection's session, so it's released if the process dies.
        let mut lock_conn = self.db.acquire().await?;
        let locked = sqlx::query_scalar!("SELECT pg_try_advisory_lock($1)", REPARSE_LOCK_KEY)
            .fetch_one(&mut *lock_conn)
            .await?
            .unwrap_or(false);
        if !locked {
            return Ok(());
        }

        let result = self.reparse_batches().await;

        sqlx::query_scalar!("SELECT pg_advisory_unlock($1)", REPARSE_LOCK_KEY)
            .fetch_one(&mut *lock_conn)
            .await?;
        result
    }

    async fn reparse_batches(&self) -> eyre::Result<()> {
        let mut attempted = HashSet::new();
        let mut updated = 0;
        let mut failed = 0;
        loop {
            let batch = sqlx::query!(
                r#"
                    SELECT m.id as "id: SbMapId", m.hash as "hash: MapHash", m.extension,
                        m.title, m.public_name
                    FROM maps m
                    WHERE m.parser_version < $1
                        AND m.parse_failed_version IS DISTINCT FROM $1
                    ORDER BY
                        (SELECT s.games_90d FROM map_stats s WHERE s.map_id = m.id)
                            DESC NULLS LAST,
                        m.hash
                    LIMIT $2
                "#,
                MAP_PARSER_VERSION,
                REPARSE_BATCH_SIZE,
            )
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load maps to reparse")?;
            // Every map in a batch either reaches the current version or is marked failed, so a
            // map coming back means its result couldn't be written.
            if batch.is_empty() || batch.iter().all(|m| attempted.contains(&m.id)) {
                break;
            }

            let results: Vec<_> = stream::iter(batch)
                .map(|map| async move {
                    let outcome = self
                        .reparse_map(
                            map.id,
                            &map.hash,
                            map.extension.trim(),
                            map.public_name.as_deref(),
                        )
                        .await;
                    (map.id, outcome)
                })
                .buffer_unordered(self.parse_concurrency)
                .collect()
                .await;
            for (map_id, outcome) in results {
                attempted.insert(map_id);
                match outcome {
                    Ok(true) => updated += 1,
                    Ok(false) => failed += 1,
                    Err(e) => return Err(e),
                }
            }
        }
        if updated > 0 || failed > 0 {
            info!(
                updated,
                failed,
                parser_version = MAP_PARSER_VERSION,
                "Reparsed maps"
            );
        }
        Ok(())
    }

    /// Reparses one stored map. Returns whether it parsed; failures to parse are recorded on the
    /// map, while failures to write are returned as errors.
    async fn reparse_map(
        &self,
        map_id: SbMapId,
        hash: &MapHash,
        extension: &str,
        public_name: Option<&str>,
    ) -> eyre::Result<bool> {
        let parsed = match self.file_store.read(&map_file_path(hash, extension)).await {
            Ok(bytes) => self
                .process(Arc::new(bytes), false)
                .await
                .map(|processed| processed.parsed)
                .map_err(|MapParseError::InvalidFile(reason)| reason),
            Err(e) => Err(format!("map file unavailable: {e:#}")),
        };
        let parsed = match parsed {
            Ok(parsed) => parsed,
            Err(reason) => {
                warn!(
                    hash = HEXLOWER.encode(&hash.0),
                    "Reparsing map failed: {reason}"
                );
                sqlx::query!(
                    r#"
                        UPDATE maps SET parse_failed_version = $2, parse_error = $3
                        WHERE id = $1
                    "#,
                    map_id as _,
                    MAP_PARSER_VERSION,
                    reason,
                )
                .execute(&self.db)
                .await
                .wrap_err("Failed to record map parse failure")?;
                return Ok(false);
            }
        };

        // Older parsers stored some names decoded with the wrong code page, and those names were
        // carried over as public names; the file's own title is the correct one.
        let clear_public_name = public_name.is_some_and(|name| is_mojibake_of(name, &parsed.title));

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        let updated = sqlx::query!(
            r#"
                UPDATE maps
                SET title = $2, description = $3, width = $4, height = $5, tileset = $6,
                    players_melee = $7, players_ums = $8, lobby_init_data = $9, is_eud = $10,
                    parser_version = $11, start_locations = $12, ums_content = $13,
                    parse_failed_version = NULL, parse_error = NULL,
                    public_name = CASE WHEN $14 THEN NULL ELSE public_name END
                WHERE id = $1 AND parser_version < $11
            "#,
            map_id as _,
            parsed.title,
            parsed.description,
            parsed.width,
            parsed.height,
            parsed.tileset,
            parsed.players_melee,
            parsed.players_ums,
            Json(&parsed.lobby_init_data) as _,
            parsed.is_eud,
            MAP_PARSER_VERSION,
            Json(&parsed.start_locations) as _,
            parsed.ums_content,
            clear_public_name,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to update reparsed map")?
        .rows_affected();
        if updated > 0 {
            write_analysis(&mut tx, map_id, &parsed.analysis).await?;
        }
        tx.commit()
            .await
            .wrap_err("Failed to commit reparsed map")?;
        Ok(true)
    }

    async fn delete_expired_rejections(&self) -> eyre::Result<()> {
        let cutoff = chrono::Utc::now()
            - chrono::Duration::from_std(REJECTION_RETENTION).expect("retention fits a Duration");
        let expired = sqlx::query!(
            r#"
                SELECT hash as "hash: MapHash", extension
                FROM map_parse_rejections
                WHERE rejected_at < $1
            "#,
            cutoff,
        )
        .fetch_all(&self.db)
        .await?;
        for rejection in expired {
            self.file_store
                .delete(&map_reject_path(
                    &rejection.hash,
                    rejection.extension.trim(),
                ))
                .await?;
            sqlx::query!(
                "DELETE FROM map_parse_rejections WHERE hash = $1 AND rejected_at < $2",
                rejection.hash as _,
                cutoff,
            )
            .execute(&self.db)
            .await?;
        }
        Ok(())
    }
}

fn render_images(chk: &Chk, assets: &MapRenderAssets) -> Option<Vec<MapImage>> {
    render_map_images(chk, assets)
        .inspect_err(|e| error!("Rendering map images failed: {e:?}"))
        .ok()
}

async fn write_analysis(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
    analysis: &MapAnalysis,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO map_analysis (map_id, format_version, string_encoding, trigger_count,
                briefing_count, ums_action_kinds, placed_units, player_units, mineral_fields,
                mineral_total, geysers, bases, author_suggestions, anomalies, protection_detected,
                terrain_fingerprint, fingerprint_version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (map_id) DO UPDATE
            SET format_version = $2, string_encoding = $3, trigger_count = $4, briefing_count = $5,
                ums_action_kinds = $6, placed_units = $7, player_units = $8, mineral_fields = $9,
                mineral_total = $10, geysers = $11, bases = $12, author_suggestions = $13,
                anomalies = $14, protection_detected = $15, terrain_fingerprint = $16,
                fingerprint_version = $17
        "#,
        map_id as _,
        analysis.format_version,
        analysis.string_encoding,
        analysis.trigger_count,
        analysis.briefing_count,
        &analysis.ums_action_kinds,
        analysis.placed_units,
        analysis.player_units,
        analysis.mineral_fields,
        analysis.mineral_total,
        analysis.geysers,
        analysis.bases.as_ref().map(Json) as _,
        &analysis.author_suggestions,
        &analysis.anomalies,
        analysis.protection_detected,
        analysis.terrain_fingerprint.as_deref(),
        analysis
            .terrain_fingerprint
            .as_ref()
            .map(|_| FINGERPRINT_VERSION),
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to write map analysis")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_file_store_paths_like_the_node_server() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xab;
        bytes[1] = 0xcd;
        let hash = MapHash(bytes);
        let hex = HEXLOWER.encode(&bytes);
        assert_eq!(map_file_path(&hash, "scx"), format!("maps/ab/cd/{hex}.scx"));
        assert_eq!(
            map_image_path(&hash, 512),
            format!("map_images/ab/cd/{hex}-512.jpg")
        );
        assert_eq!(
            map_reject_path(&hash, "scm"),
            format!("map_rejects/{hex}.scm")
        );
    }
}
