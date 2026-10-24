use std::fmt::Display;

use async_graphql::futures_util::TryStreamExt;
use async_graphql::{
    ComplexObject, SchemaBuilder, SimpleObject,
    dataloader::{DataLoader, Loader},
    scalar,
};
use chrono::{DateTime, Utc};
use data_encoding::BASE64;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use typeshare::typeshare;
use uuid::Uuid;

use crate::file_store::FileStore;
use crate::maps::analysis::{MapAnalysisLoader, MapFileAnalysis};
use crate::maps::catalog::{SbMapLoader, ViewerMapFlagsLoader};
use crate::maps::families::graphql::{MapFamilyLoader, MapLineStatsLoader};
use crate::maps::ingest::map_image_path;
use crate::maps::parse::MapStartLocation;
use crate::maps::render::{MAP_JPEG_SIZE, MapImageFormat};
use crate::maps::search::MapSearchRepo;
use crate::{
    graphql::{errors::graphql_error, schema_builder::SchemaBuilderModule},
    users::{SbUser, SbUserId, UsersLoader},
};

mod analysis;
pub mod api;
mod catalog;
mod compare;
mod credits;
pub mod families;
pub mod ingest;
pub mod parse;
pub mod render;
pub mod search;
mod stats;

pub use catalog::{
    FavoriteMapConnection, MapLibraryConnection, MapsMutation, MapsQuery, SbMap,
    load_favorite_maps, load_map_library,
};
pub use families::graphql::{MapFamiliesMutation, MapFamiliesQuery};

pub struct MapsModule {
    db_pool: PgPool,
}

impl MapsModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for MapsModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder
            .data(DataLoader::new(
                MapsLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                SbMapLoader::new(MapSearchRepo::new(self.db_pool.clone())),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                ViewerMapFlagsLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                MapAnalysisLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                MapFamilyLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                MapLineStatsLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(MapSearchRepo::new(self.db_pool.clone()))
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Deserialize, Serialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct SbMapId(pub Uuid);

scalar!(SbMapId, "SbMapId", "A map ID in the ShieldBattery system.");

impl From<Uuid> for SbMapId {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl From<&Uuid> for SbMapId {
    fn from(value: &Uuid) -> Self {
        Self(*value)
    }
}

impl From<SbMapId> for Uuid {
    fn from(value: SbMapId) -> Self {
        value.0
    }
}

impl From<&SbMapId> for Uuid {
    fn from(value: &SbMapId) -> Self {
        value.0
    }
}

impl Display for SbMapId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct MapHash(pub [u8; 32]);

#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct UploadedMap {
    pub id: SbMapId,
    #[graphql(skip)]
    pub map_hash: MapHash,
    pub name: String,
    pub description: String,
    #[graphql(skip)]
    pub published_by: Option<SbUserId>,
    pub published_at: Option<DateTime<Utc>>,
    pub visibility: MapVisibility,
}

#[ComplexObject]
impl UploadedMap {
    /// The user who listed this map, if it has been published.
    async fn publisher(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<SbUser>> {
        let Some(published_by) = self.published_by else {
            return Ok(None);
        };
        let loader = ctx.data_unchecked::<DataLoader<UsersLoader>>();
        loader.load_one(published_by).await
    }

    async fn map_file(&self, ctx: &async_graphql::Context<'_>) -> async_graphql::Result<MapFile> {
        let loader = ctx.data_unchecked::<DataLoader<MapsLoader>>();
        let map_file = loader.load_one(self.map_hash).await?;
        map_file
            .map(|m| m.into())
            .ok_or_else(|| graphql_error("NOT_FOUND", "Map file not found"))
    }
}

/// Which map listings a map appears in. Visibility never restricts access: any map can be viewed,
/// downloaded and played by anyone who has its id.
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, sqlx::Type)]
#[serde(rename_all = "UPPERCASE")]
#[sqlx(type_name = "map_visibility", rename_all = "UPPERCASE")]
pub enum MapVisibility {
    /// Listed only for its uploader, the only user who can edit or remove it.
    Unlisted,
    /// Listed for everyone in the community maps.
    Public,
    /// Listed for everyone in the official maps.
    Official,
}

scalar!(
    MapVisibility,
    "MapVisibility",
    "Which map listings a map appears in. Visibility never restricts access: any map can be viewed, downloaded and played by anyone who has its id."
);

#[derive(Debug, Clone)]
pub struct DbMapFile {
    pub hash: MapHash,
    pub extension: String,
    pub title: String,
    pub description: String,
    pub width: i32,
    pub height: i32,
    pub tileset: i32,
    pub players_melee: i32,
    pub players_ums: i32,
    pub lobby_init_data: sqlx::types::Json<LobbyInitData>,
    pub is_eud: bool,
    pub parser_version: i32,
    pub image_version: i32,
    pub render_version: i32,
    pub start_locations: sqlx::types::Json<Vec<MapStartLocation>>,
    pub ums_content: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyInitData {
    pub forces: Vec<MapForce>,
}

#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct MapFile {
    #[graphql(skip)]
    pub hash: MapHash,
    pub format: String,
    pub tileset: i32,
    pub original_name: String,
    pub original_description: String,
    pub slots: i32,
    pub ums_slots: i32,
    pub ums_forces: Vec<MapForce>,
    pub width: i32,
    pub height: i32,
    pub is_eud: bool,
    pub parser_version: i32,
    pub image_version: i32,
    pub render_version: i32,
    #[graphql(skip)]
    pub start_locations: Vec<MapStartLocation>,
    /// Whether the map has UMS content: trigger actions that melee games don't use, more than 8
    /// preplaced player-owned units, or EUDs. Null until the map file has been analyzed.
    pub ums_content: Option<bool>,
}

#[ComplexObject]
impl MapFile {
    async fn id(&self, _ctx: &async_graphql::Context<'_>) -> async_graphql::Result<String> {
        Ok(BASE64.encode(&self.hash.0)) // Return Base64-encoded hash as ID
    }

    #[graphql(skip)]
    fn image_url(
        &self,
        ctx: &async_graphql::Context<'_>,
        size: u32,
        format: MapImageFormat,
    ) -> async_graphql::Result<String> {
        let file_store = ctx.data::<FileStore>()?;
        let path = map_image_path(
            &self.hash,
            self.image_version,
            self.render_version,
            size,
            format,
        );
        let url = file_store.url(&path)?;
        // Images from before render versions are overwritten in place when re-rendered
        Ok(if self.render_version == 0 {
            format!("{url}?v={}", self.image_version)
        } else {
            url
        })
    }

    async fn image_256_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        self.image_url(ctx, 256, MapImageFormat::Avif)
    }

    async fn image_512_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        self.image_url(ctx, 512, MapImageFormat::Avif)
    }

    async fn image_1024_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        self.image_url(ctx, 1024, MapImageFormat::Avif)
    }

    async fn image_2048_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        self.image_url(ctx, 2048, MapImageFormat::Avif)
    }

    /// A 1024px JPEG of the map, for consumers that can't decode the other images' format.
    async fn jpeg_image_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        self.image_url(ctx, MAP_JPEG_SIZE, MapImageFormat::Jpeg)
    }

    /// The start location placed for each player slot, at most one per slot. Empty until the map
    /// file has been analyzed.
    async fn start_locations(&self) -> Vec<MapFileStartLocation> {
        let hash = BASE64.encode(&self.hash.0);
        self.start_locations
            .iter()
            .map(|s| MapFileStartLocation {
                id: format!("{hash}:{}", s.slot),
                slot: s.slot.into(),
                x: s.x.into(),
                y: s.y.into(),
            })
            .collect()
    }

    /// What analyzing the map file found about how it plays. Null until the map file has been
    /// analyzed.
    async fn analysis(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<MapFileAnalysis>> {
        ctx.data::<DataLoader<MapAnalysisLoader>>()?
            .load_one(self.hash)
            .await
    }

    /// Whether the map's images have its start locations drawn in. Images without them are meant
    /// to have start locations drawn on top.
    async fn image_spawns_baked(&self) -> bool {
        self.render_version == 0
    }
}

impl From<DbMapFile> for MapFile {
    fn from(db_map_file: DbMapFile) -> Self {
        Self {
            hash: db_map_file.hash,
            format: db_map_file.extension,
            tileset: db_map_file.tileset,
            original_name: db_map_file.title,
            original_description: db_map_file.description,
            slots: db_map_file.players_melee,
            ums_slots: db_map_file.players_ums,
            ums_forces: db_map_file.lobby_init_data.0.forces,
            width: db_map_file.width,
            height: db_map_file.height,
            is_eud: db_map_file.is_eud,
            parser_version: db_map_file.parser_version,
            image_version: db_map_file.image_version,
            render_version: db_map_file.render_version,
            start_locations: db_map_file.start_locations.0,
            ums_content: db_map_file.ums_content,
        }
    }
}

/// A start location placed for a player slot.
#[derive(Debug, Clone, SimpleObject)]
pub struct MapFileStartLocation {
    /// The map file's hash and the slot, unique across all map files.
    pub id: String,
    /// The player slot (0-7) the start location belongs to.
    pub slot: i32,
    /// The center of the start location, in map pixels (32 per tile).
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, SimpleObject, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapForce {
    pub name: String,
    pub team_id: i32,
    pub players: Vec<MapForcePlayer>,
}

#[derive(Debug, Clone, SimpleObject, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapForcePlayer {
    #[serde(rename = "id")]
    pub player_id: i32,
    pub race: MapForcePlayerRace,
    pub type_id: i32,
    #[serde(rename = "computer")]
    pub is_computer: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum MapForcePlayerRace {
    #[serde(rename = "r")]
    Random,
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
    #[serde(rename = "any")]
    Any,
}

scalar!(
    MapForcePlayerRace,
    "MapForcePlayerRace",
    "The race configuration for a player in a map force (either a preset race or 'any' for selectable)."
);

pub struct MapsLoader {
    db: PgPool,
}

impl MapsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbMapId> for MapsLoader {
    type Value = UploadedMap;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[SbMapId],
    ) -> Result<std::collections::HashMap<SbMapId, Self::Value>, Self::Error> {
        Ok(sqlx::query_as!(
            UploadedMap,
            r#"
                SELECT id as "id: _", hash as "map_hash: _", name as "name!",
                    COALESCE(public_description, description) as "description!",
                    CASE WHEN listed THEN published_by END as "published_by: _",
                    CASE WHEN listed THEN published_at END as published_at,
                    (CASE
                        WHEN NOT listed THEN 'UNLISTED'
                        WHEN official THEN 'OFFICIAL'
                        ELSE 'PUBLIC'
                    END)::map_visibility as "visibility!: _"
                FROM maps
                WHERE id = ANY($1)
            "#,
            keys as _
        )
        .fetch(&self.db)
        .map_ok(|um| (um.id, um))
        .try_collect()
        .await?)
    }
}

impl Loader<MapHash> for MapsLoader {
    type Value = DbMapFile;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[MapHash],
    ) -> Result<std::collections::HashMap<MapHash, Self::Value>, Self::Error> {
        Ok(sqlx::query_as!(
            DbMapFile,
            r#"
                SELECT hash as "hash: _", extension, title, description,
                    width, height, tileset, players_melee, players_ums,
                    lobby_init_data as "lobby_init_data: _", is_eud, parser_version, image_version,
                    render_version, start_locations as "start_locations: _", ums_content
                FROM maps
                WHERE hash = ANY($1)
            "#,
            keys as _
        )
        .fetch(&self.db)
        .map_ok(|um| (um.hash, um))
        .try_collect()
        .await?)
    }
}
