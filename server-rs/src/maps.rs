use async_graphql::futures_util::TryStreamExt;
use async_graphql::{
    ComplexObject, SchemaBuilder, SimpleObject,
    dataloader::{DataLoader, Loader},
    scalar,
};
use chrono::{DateTime, Utc};
use data_encoding::BASE64;
use data_encoding::HEXLOWER;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use typeshare::typeshare;
use uuid::Uuid;

use crate::file_store::FileStore;
use crate::{
    graphql::{errors::graphql_error, schema_builder::SchemaBuilderModule},
    users::{SbUser, SbUserId, UsersLoader},
};

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
        builder.data(DataLoader::new(
            MapsLoader::new(self.db_pool.clone()),
            tokio::spawn,
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct MapHash(pub [u8; 32]);

#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct UploadedMap {
    pub id: Uuid,
    #[graphql(skip)]
    pub map_hash: MapHash,
    pub name: String,
    pub description: String,
    #[graphql(skip)]
    pub uploaded_by: SbUserId,
    pub upload_date: DateTime<Utc>,
    pub visibility: MapVisibility,
}

#[ComplexObject]
impl UploadedMap {
    async fn uploader(&self, ctx: &async_graphql::Context<'_>) -> async_graphql::Result<SbUser> {
        let loader = ctx.data_unchecked::<DataLoader<UsersLoader>>();
        let user = loader.load_one(self.uploaded_by).await?;
        user.ok_or_else(|| graphql_error("NOT_FOUND", "User not found"))
    }

    async fn map_file(&self, ctx: &async_graphql::Context<'_>) -> async_graphql::Result<MapFile> {
        let loader = ctx.data_unchecked::<DataLoader<MapsLoader>>();
        let map_file = loader.load_one(self.map_hash).await?;
        map_file
            .map(|m| m.into())
            .ok_or_else(|| graphql_error("NOT_FOUND", "Map file not found"))
    }
}

/// The privacy level for a map. This determines who can use the map for creating games.
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, sqlx::Type)]
#[serde(rename_all = "UPPERCASE")]
#[sqlx(type_name = "map_visibility", rename_all = "UPPERCASE")]
pub enum MapVisibility {
    Private,
    Public,
    Official,
}

scalar!(
    MapVisibility,
    "MapVisibility",
    "The privacy level for a map. This determines who can use the map for creating games."
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyInitData {
    forces: Vec<MapForce>,
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
}

#[ComplexObject]
impl MapFile {
    async fn id(&self, _ctx: &async_graphql::Context<'_>) -> async_graphql::Result<String> {
        Ok(BASE64.encode(&self.hash.0)) // Return Base64-encoded hash as ID
    }

    #[graphql(skip)]
    fn image_path(&self, size: usize) -> String {
        let hash = HEXLOWER.encode(&self.hash.0);
        format!(
            "map_images/{}/{}/{}-{size}.jpg",
            &hash[0..2],
            &hash[2..4],
            &hash
        )
    }

    async fn image_256_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        let file_store = ctx.data::<FileStore>()?;
        Ok(format!(
            "{}?v={}",
            file_store.url(&self.image_path(256))?,
            self.image_version
        ))
    }

    async fn image_512_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        let file_store = ctx.data::<FileStore>()?;
        Ok(format!(
            "{}?v={}",
            file_store.url(&self.image_path(512))?,
            self.image_version
        ))
    }

    async fn image_1024_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        let file_store = ctx.data::<FileStore>()?;
        Ok(format!(
            "{}?v={}",
            file_store.url(&self.image_path(1024))?,
            self.image_version
        ))
    }

    async fn image_2048_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<String> {
        let file_store = ctx.data::<FileStore>()?;
        Ok(format!(
            "{}?v={}",
            file_store.url(&self.image_path(2048))?,
            self.image_version
        ))
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
        }
    }
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

impl Loader<Uuid> for MapsLoader {
    type Value = UploadedMap;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[Uuid],
    ) -> Result<std::collections::HashMap<Uuid, Self::Value>, Self::Error> {
        Ok(sqlx::query_as!(
            UploadedMap,
            r#"
                SELECT id, map_hash as "map_hash: _", name, description,
                    uploaded_by as "uploaded_by: _", upload_date, visibility as "visibility: _"
                FROM uploaded_maps
                WHERE id = ANY($1)
            "#,
            keys
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
                    lobby_init_data as "lobby_init_data: _", is_eud, parser_version, image_version
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
