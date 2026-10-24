//! Map ingestion: storing uploaded map files with their parsed data and images, and keeping every
//! map's parsed data and images at the current parser and render versions.

use std::collections::HashSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::Duration;

use async_graphql::futures_util::{StreamExt, stream};
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
use crate::maps::families::FamilyDetector;
use crate::maps::parse::{
    AnalysisTables, FINGERPRINT_VERSION, MAP_PARSER_VERSION, MapAnalysis, MapExtension,
    MapParseError, ParsedMap, ParsedMapFile, is_mojibake_of, map_file_hash, parse_map,
};
use crate::maps::render::{
    MAP_IMAGE_SIZES, MAP_JPEG_SIZE, MAP_RENDER_VERSION, MapImageFormat, MapImages, MapRenderAssets,
    render_map_images,
};
use crate::maps::{MapHash, SbMapId};
use crate::users::SbUserId;

/// How long rejected uploads (and their files) are kept for reproducing parser bugs.
const REJECTION_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// How long the files of superseded map images are kept, so clients that loaded their URLs before
/// the newer render can still show them.
const SUPERSEDED_IMAGE_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Delay before the first maintenance run after startup, so it doesn't compete with startup work.
const MAINTENANCE_STARTUP_DELAY: Duration = Duration::from_secs(2 * 60);
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(60 * 60);
const MAINTENANCE_BATCH_SIZE: i64 = 20;
/// Session-level advisory lock held while reparsing and re-rendering, so only one server does it
/// at a time.
const MAINTENANCE_LOCK_KEY: i64 = 0x5342_4d41_5052_5345; // "SBMAPRSE"
/// Map images are never overwritten (every render is a new generation), so they can be cached
/// forever.
const IMAGE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

#[derive(Debug, thiserror::Error)]
pub enum MapIngestError {
    #[error("the map file couldn't be parsed")]
    InvalidMapFile,
    #[error("the map has no player slots")]
    NoPlayerSlots,
    #[error("map not found")]
    NotFound,
    #[error(transparent)]
    Internal(#[from] eyre::Report),
}

/// The file store path of a map file.
pub fn map_file_path(hash: &MapHash, extension: &str) -> String {
    let hash = HEXLOWER.encode(&hash.0);
    format!("maps/{}/{}/{hash}.{extension}", &hash[0..2], &hash[2..4])
}

/// The file store path of one of a map's images, for the generation `image_version` rendered by
/// `render_version`. Render version 0 images are all JPEGs, at legacy paths that every generation
/// shares.
pub fn map_image_path(
    hash: &MapHash,
    image_version: i32,
    render_version: i32,
    size: u32,
    format: MapImageFormat,
) -> String {
    let hash = HEXLOWER.encode(&hash.0);
    let dir = format!("map_images/{}/{}", &hash[0..2], &hash[2..4]);
    if render_version == 0 {
        format!("{dir}/{hash}-{size}.jpg")
    } else {
        format!("{dir}/{hash}/{image_version}-{size}.{}", format.extension())
    }
}

/// The file store paths of every image in one generation of a map's images.
fn map_image_generation_paths(
    hash: &MapHash,
    image_version: i32,
    render_version: i32,
) -> Vec<String> {
    let mut paths: Vec<_> = MAP_IMAGE_SIZES
        .iter()
        .map(|&size| {
            map_image_path(
                hash,
                image_version,
                render_version,
                size,
                MapImageFormat::Avif,
            )
        })
        .collect();
    if render_version != 0 {
        paths.push(map_image_path(
            hash,
            image_version,
            render_version,
            MAP_JPEG_SIZE,
            MapImageFormat::Jpeg,
        ));
    }
    paths
}

fn map_reject_path(hash: &MapHash, extension: &str) -> String {
    format!("map_rejects/{}.{extension}", HEXLOWER.encode(&hash.0))
}

pub struct MapIngester {
    db: PgPool,
    file_store: FileStore,
    analysis_tables: Option<Arc<AnalysisTables>>,
    render_assets: Option<Arc<MapRenderAssets>>,
    families: FamilyDetector,
    /// Limits how many maps are parsed or rendered at once, across uploads and the reparse job.
    parse_permits: Arc<Semaphore>,
    parse_concurrency: usize,
}

struct Processed {
    parsed: ParsedMap,
    /// The rendered images, if rendering was requested, or why rendering failed.
    images: Option<Result<MapImages, String>>,
}

/// A stored map whose images are being rendered again.
struct RenderTarget {
    id: SbMapId,
    hash: MapHash,
    extension: String,
    image_version: i32,
    render_version: i32,
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
                warn!(
                    "SB_MAP_ASSETS isn't set: uploaded maps get minimap images and no terrain \
                    analysis"
                );
                (None, None)
            }
        };
        Self {
            families: FamilyDetector::new(db.clone()),
            db,
            file_store,
            analysis_tables,
            render_assets,
            parse_permits: Arc::new(Semaphore::new(settings.map_parser_max_concurrent)),
            parse_concurrency: settings.map_parser_max_concurrent,
        }
    }

    /// Parses a map file, and renders its images if `render` is set, on the Rayon pool. Without
    /// render assets the images are zero-asset minimaps.
    async fn process(&self, bytes: Arc<Vec<u8>>, render: bool) -> Result<Processed, MapParseError> {
        let _permit = self
            .parse_permits
            .acquire()
            .await
            .expect("parse semaphore is never closed");
        let tables = self.analysis_tables.clone();
        let assets = self.render_assets.clone();
        spawn_rayon(move || {
            catch_unwind(AssertUnwindSafe(|| {
                let ParsedMapFile { parsed, chk } = parse_map(&bytes, tables.as_deref())?;
                let images = render.then(|| {
                    catch_unwind(AssertUnwindSafe(|| {
                        render_map_images(&chk, parsed.ums_content, assets.as_deref())
                            .map_err(|e| format!("{e:#}"))
                    }))
                    .unwrap_or_else(|_| Err("the renderer panicked".into()))
                });
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
                let map_id = self
                    .store_new_map(bytes, extension, hash, uploaded_by)
                    .await?;
                // The hourly sweep scans maps this misses, so a failure here doesn't fail the upload.
                if let Err(e) = self.families.scan_map(map_id).await {
                    error!("Scanning a new map for families failed: {e:?}");
                }
                map_id
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
        let (render_version, render_fallback, render_error) =
            match images.expect("images were requested") {
                Ok(images) => {
                    let fallback = images.fallback;
                    self.write_images(&hash, 1, images).await?;
                    (MAP_RENDER_VERSION, fallback, None)
                }
                Err(reason) => {
                    error!(
                        hash = HEXLOWER.encode(&hash.0),
                        "Rendering map images failed: {reason}"
                    );
                    (0, false, Some(reason))
                }
            };
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
                    image_version, start_locations, ums_content, render_version, render_fallback,
                    render_failed_version, render_error)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14, $15, $16,
                    $17, $18)
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
            render_version,
            render_fallback,
            render_error.as_ref().map(|_| MAP_RENDER_VERSION),
            render_error,
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

    async fn write_images(
        &self,
        hash: &MapHash,
        image_version: i32,
        images: MapImages,
    ) -> eyre::Result<()> {
        for image in images.images {
            let options = WriteOptions {
                content_type: Some(image.format.content_type().into()),
                public: true,
                cache_control: Some(IMAGE_CACHE_CONTROL.into()),
            };
            let path = map_image_path(
                hash,
                image_version,
                MAP_RENDER_VERSION,
                image.size,
                image.format,
            );
            self.file_store
                .write(&path, image.data, &options)
                .await
                .wrap_err("Failed to store map image")?;
        }
        Ok(())
    }

    async fn delete_images(
        &self,
        hash: &MapHash,
        image_version: i32,
        render_version: i32,
    ) -> eyre::Result<()> {
        for path in map_image_generation_paths(hash, image_version, render_version) {
            self.file_store
                .delete(&path)
                .await
                .wrap_err("Failed to delete map image")?;
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
        let map_id = resolve_map_id(&self.db, map_id)
            .await?
            .ok_or(MapIngestError::NotFound)?;
        let target = sqlx::query_as!(
            RenderTarget,
            r#"
                SELECT id as "id: SbMapId", hash as "hash: MapHash", extension, image_version,
                    render_version
                FROM maps
                WHERE id = $1
            "#,
            map_id as _,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to load map")?;
        self.render_map(&target)
            .await?
            .map_err(|reason| eyre!("Rendering the map's images failed: {reason}").into())
    }

    /// Renders a stored map's images as a new generation and makes it the current one. Returns
    /// why rendering failed, if it did; failures to read or write are returned as errors.
    async fn render_map(&self, target: &RenderTarget) -> eyre::Result<Result<(), String>> {
        let bytes = match self
            .file_store
            .read(&map_file_path(&target.hash, target.extension.trim()))
            .await
        {
            Ok(bytes) => bytes,
            Err(e) => return Ok(Err(format!("map file unavailable: {e:#}"))),
        };
        let images = match self.process(Arc::new(bytes), true).await {
            Ok(processed) => match processed.images.expect("images were requested") {
                Ok(images) => images,
                Err(reason) => return Ok(Err(reason)),
            },
            Err(MapParseError::InvalidFile(reason)) => {
                return Ok(Err(format!("stored map file couldn't be parsed: {reason}")));
            }
        };

        let fallback = images.fallback;
        let image_version = target.image_version + 1;
        self.write_images(&target.hash, image_version, images)
            .await?;

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        // Only one render per generation takes effect. A concurrent render that started from the
        // same generation wrote the same paths (with the same images, since renders are
        // deterministic), so the losing one has nothing to clean up.
        let updated = sqlx::query!(
            r#"
                UPDATE maps
                SET image_version = $3, render_version = $4, render_fallback = $5,
                    render_failed_version = NULL, render_error = NULL
                WHERE id = $1 AND image_version = $2
            "#,
            target.id as _,
            target.image_version,
            image_version,
            MAP_RENDER_VERSION,
            fallback,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to update map images")?
        .rows_affected();
        if updated == 0 {
            return Ok(Ok(()));
        }
        sqlx::query!(
            r#"
                INSERT INTO superseded_map_images (hash, image_version, render_version,
                    superseded_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (hash, image_version) DO NOTHING
            "#,
            target.hash as _,
            target.image_version,
            target.render_version,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to record superseded map images")?;
        tx.commit().await.wrap_err("Failed to commit map images")?;
        Ok(Ok(()))
    }

    /// Reparses and re-renders outdated maps, then deletes expired superseded images and rejected
    /// uploads; once soon after startup, then every hour.
    pub async fn maintenance_loop(self: Arc<Self>) {
        tokio::time::sleep(MAINTENANCE_STARTUP_DELAY).await;
        let mut interval = tokio::time::interval(MAINTENANCE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(e) = self.update_outdated_maps().await {
                error!("Updating outdated maps failed: {e:?}");
            }
            if let Err(e) = self.delete_expired_superseded_images().await {
                error!("Deleting superseded map images failed: {e:?}");
            }
            if let Err(e) = self.delete_expired_rejections().await {
                error!("Deleting expired map rejections failed: {e:?}");
            }
        }
    }

    /// Brings every stored map to the current parser version, scans maps for families under the
    /// current rules, then (when render assets are available) brings images to the current render
    /// version, the most visible maps first. A map that fails keeps its old values and isn't
    /// retried until the version changes.
    pub async fn update_outdated_maps(&self) -> eyre::Result<()> {
        // The lock is held by this connection's session, so it's released if the process dies.
        let mut lock_conn = self.db.acquire().await?;
        let locked = sqlx::query_scalar!("SELECT pg_try_advisory_lock($1)", MAINTENANCE_LOCK_KEY)
            .fetch_one(&mut *lock_conn)
            .await?
            .unwrap_or(false);
        if !locked {
            return Ok(());
        }

        let mut result = self.reparse_batches().await;
        if result.is_ok() {
            result = self.families.scan_outdated().await;
        }
        // Zero-asset minimaps are only for maps that would otherwise have no images, so outdated
        // images are only replaced by real renders.
        if result.is_ok() && self.render_assets.is_some() {
            result = self.render_batches().await;
        }

        sqlx::query_scalar!("SELECT pg_advisory_unlock($1)", MAINTENANCE_LOCK_KEY)
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
                MAINTENANCE_BATCH_SIZE,
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

    async fn render_batches(&self) -> eyre::Result<()> {
        let mut attempted = HashSet::new();
        let mut updated = 0;
        let mut failed = 0;
        loop {
            // Maps in the current matchmaking pools go first, then the most played, then listed
            // ones, so the most visible images are replaced soonest.
            let batch = sqlx::query_as!(
                RenderTarget,
                r#"
                    WITH current_pools AS (
                        SELECT DISTINCT ON (matchmaking_type) maps
                        FROM matchmaking_map_pools
                        WHERE start_date <= now()
                        ORDER BY matchmaking_type, start_date DESC
                    ), pool_maps AS (
                        SELECT DISTINCT unnest(maps) AS map_id FROM current_pools
                    )
                    SELECT m.id as "id: SbMapId", m.hash as "hash: MapHash", m.extension,
                        m.image_version, m.render_version
                    FROM maps m
                    WHERE (m.render_version < $1 OR m.render_fallback)
                        AND m.render_failed_version IS DISTINCT FROM $1
                    ORDER BY
                        m.id IN (SELECT map_id FROM pool_maps) DESC,
                        (SELECT s.games_90d FROM map_stats s WHERE s.map_id = m.id)
                            DESC NULLS LAST,
                        m.listed DESC,
                        m.hash
                    LIMIT $2
                "#,
                MAP_RENDER_VERSION,
                MAINTENANCE_BATCH_SIZE,
            )
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load maps to render")?;
            // Every map in a batch either reaches the current version or is marked failed, so a
            // map coming back means its result couldn't be written.
            if batch.is_empty() || batch.iter().all(|m| attempted.contains(&m.id)) {
                break;
            }

            let results: Vec<_> = stream::iter(batch)
                .map(|target| async move {
                    let outcome = self.render_map(&target).await;
                    (target, outcome)
                })
                .buffer_unordered(self.parse_concurrency)
                .collect()
                .await;
            for (target, outcome) in results {
                attempted.insert(target.id);
                match outcome? {
                    Ok(()) => updated += 1,
                    Err(reason) => {
                        failed += 1;
                        warn!(
                            hash = HEXLOWER.encode(&target.hash.0),
                            "Rendering map images failed: {reason}"
                        );
                        sqlx::query!(
                            r#"
                                UPDATE maps SET render_failed_version = $2, render_error = $3
                                WHERE id = $1
                            "#,
                            target.id as _,
                            MAP_RENDER_VERSION,
                            reason,
                        )
                        .execute(&self.db)
                        .await
                        .wrap_err("Failed to record map render failure")?;
                    }
                }
            }
        }
        if updated > 0 || failed > 0 {
            info!(
                updated,
                failed,
                render_version = MAP_RENDER_VERSION,
                "Rendered map images"
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

    async fn delete_expired_superseded_images(&self) -> eyre::Result<()> {
        let cutoff = chrono::Utc::now()
            - chrono::Duration::from_std(SUPERSEDED_IMAGE_RETENTION)
                .expect("retention fits a Duration");
        let expired = sqlx::query!(
            r#"
                SELECT hash as "hash: MapHash", image_version, render_version
                FROM superseded_map_images
                WHERE superseded_at < $1
            "#,
            cutoff,
        )
        .fetch_all(&self.db)
        .await?;
        for superseded in expired {
            self.delete_images(
                &superseded.hash,
                superseded.image_version,
                superseded.render_version,
            )
            .await?;
            sqlx::query!(
                "DELETE FROM superseded_map_images WHERE hash = $1 AND image_version = $2",
                superseded.hash as _,
                superseded.image_version,
            )
            .execute(&self.db)
            .await?;
        }
        Ok(())
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
                terrain_fingerprint, fingerprint_version, chk_hash, makers, credited)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                $18, $19, $20)
            ON CONFLICT (map_id) DO UPDATE
            SET format_version = $2, string_encoding = $3, trigger_count = $4, briefing_count = $5,
                ums_action_kinds = $6, placed_units = $7, player_units = $8, mineral_fields = $9,
                mineral_total = $10, geysers = $11, bases = $12, author_suggestions = $13,
                anomalies = $14, protection_detected = $15, terrain_fingerprint = $16,
                fingerprint_version = $17, chk_hash = $18, makers = $19, credited = $20,
                family_scan_version = NULL
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
        &analysis.chk_hash,
        &analysis.makers,
        &analysis.credited,
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
            map_image_path(&hash, 3, 0, 512, MapImageFormat::Avif),
            format!("map_images/ab/cd/{hex}-512.jpg")
        );
        assert_eq!(
            map_image_path(&hash, 3, 1, 512, MapImageFormat::Avif),
            format!("map_images/ab/cd/{hex}/3-512.avif")
        );
        assert_eq!(
            map_image_path(&hash, 3, 1, 1024, MapImageFormat::Jpeg),
            format!("map_images/ab/cd/{hex}/3-1024.jpg")
        );
        assert_eq!(
            map_reject_path(&hash, "scm"),
            format!("map_rejects/{hex}.scm")
        );
    }
}
