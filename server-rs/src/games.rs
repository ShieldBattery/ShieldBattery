use async_graphql::{
    dataloader::DataLoader, scalar, ComplexObject, Object, OutputType, SchemaBuilder, SimpleObject,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    graphql::{errors::graphql_error, schema_builder::SchemaBuilderModule},
    maps::{MapsLoader, UploadedMap},
    matchmaking::MatchmakingType,
    users::{SbUser, SbUserId, UsersLoader},
};

pub struct GamesModule {
    db_pool: PgPool,
}

impl GamesModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for GamesModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder.data(GamesRepo::new(self.db_pool.clone()))
    }
}

#[derive(Default)]
pub struct GamesQuery;

#[Object]
impl GamesQuery {
    async fn game(
        &self,
        ctx: &async_graphql::Context<'_>,
        id: Uuid,
    ) -> async_graphql::Result<Option<Game>> {
        let repo = ctx.data::<GamesRepo>()?;
        let game = repo.load_one(id).await?;
        Ok(game.map(|g| g.into()))
    }

    async fn live_games(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Vec<Game>> {
        let repo = ctx.data::<GamesRepo>()?;
        let games = repo.load_live_games().await?;
        Ok(games.into_iter().map(|g| g.into()).collect())
    }
}

#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct Game {
    pub id: Uuid,
    pub start_time: DateTime<Utc>,
    #[graphql(skip)]
    pub map_id: Uuid,
    pub config: GameConfig,
    pub disputable: bool,
    pub dispute_requested: bool,
    pub dispute_reviewed: bool,
    pub game_length: Option<i32>,
    pub results: Option<Vec<ReconciledPlayerResultEntry>>,
    pub routes: Option<Vec<GameRoute>>,
}

#[ComplexObject]
impl Game {
    async fn map(&self, ctx: &async_graphql::Context<'_>) -> async_graphql::Result<UploadedMap> {
        let maps_loader = ctx.data::<DataLoader<MapsLoader>>()?;
        let map = maps_loader.load_one(self.map_id).await?;
        map.ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
    }
}

#[derive(Debug, Copy, Clone, SimpleObject)]
pub struct ReconciledPlayerResultEntry {
    pub id: SbUserId,
    pub result: ReconciledPlayerResult,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DbGame {
    pub id: Uuid,
    pub start_time: DateTime<Utc>,
    pub map_id: Uuid,
    pub config: sqlx::types::Json<GameConfig>,
    pub disputable: bool,
    pub dispute_requested: bool,
    pub dispute_reviewed: bool,
    pub game_length: Option<i32>,
    pub results: Option<sqlx::types::Json<Vec<(SbUserId, ReconciledPlayerResult)>>>,
    pub routes: Option<Vec<sqlx::types::Json<GameRoute>>>,
}

impl From<DbGame> for Game {
    fn from(db_game: DbGame) -> Self {
        Self {
            id: db_game.id,
            start_time: db_game.start_time,
            map_id: db_game.map_id,
            config: db_game.config.0,
            disputable: db_game.disputable,
            dispute_requested: db_game.dispute_requested,
            dispute_reviewed: db_game.dispute_reviewed,
            game_length: db_game.game_length,
            results: db_game.results.map(|r| {
                r.0.into_iter()
                    .map(|(id, result)| ReconciledPlayerResultEntry { id, result })
                    .collect()
            }),
            routes: db_game
                .routes
                .map(|r| r.into_iter().map(|route| route.0).collect()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct ReconciledPlayerResult {
    pub apm: u32,
    pub race: AssignedRace,
    pub result: ReconciledResult,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, async_graphql::Enum)]
#[serde(rename_all = "camelCase")]
pub enum ReconciledResult {
    Win,
    Loss,
    Draw,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum GameType {
    Melee,
    #[serde(rename = "ffa")]
    FreeForAll,
    #[serde(rename = "oneVOne")]
    OneVsOne,
    #[serde(rename = "topVBottom")]
    TopVsBottom,
    TeamMelee,
    #[serde(rename = "teamFfa")]
    TeamFreeForAll,
    #[serde(rename = "ums")]
    UseMapSettings,
}

scalar!(
    GameType,
    "GameType",
    "The preset game ruleset that was selected (or UMS)."
);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Race {
    #[serde(rename = "r")]
    Random,
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
}

scalar!(
    Race,
    "Race",
    "Any of the possible race choices that can be selected."
);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AssignedRace {
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
}

scalar!(
    AssignedRace,
    "AssignedRace",
    "Any of the possible race choices after random has been resolved."
);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
#[graphql(complex)]
pub struct GamePlayer {
    #[graphql(skip)]
    pub id: SbUserId,
    pub race: Race,
    pub is_computer: bool,
}

#[ComplexObject]
impl GamePlayer {
    async fn user(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<SbUser>> {
        if self.is_computer {
            return Ok(None);
        }

        let users_loader = ctx.data::<DataLoader<UsersLoader>>()?;
        users_loader.load_one(self.id).await
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
#[graphql(concrete(name = "GameConfigDataLobby", params(LobbyExtra)))]
#[graphql(concrete(name = "GameConfigDataMatchmaking", params(MatchmakingExtra)))]
#[serde(rename_all = "camelCase")]
pub struct GameConfigData<ExtraT: OutputType> {
    pub game_type: GameType,
    pub game_sub_type: u8,
    pub teams: Vec<Vec<GamePlayer>>,
    pub game_source_extra: ExtraT,
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct LobbyExtra {
    pub turn_rate: Option<u8>,
    pub use_legacy_limits: Option<bool>,
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra1v1Data {}

#[Object]
impl MatchmakingExtra1v1Data {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match1v1
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra1v1FastestData {}

#[Object]
impl MatchmakingExtra1v1FastestData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match1v1Fastest
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
#[graphql(complex)]
pub struct MatchmakingExtra2v2Data {
    /// The user Ids of players in the match, grouped into lists by party. Players not in a party
    /// will be in a list by themselves.
    parties: Vec<Vec<SbUserId>>,
}

#[ComplexObject]
impl MatchmakingExtra2v2Data {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match2v2
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::Interface)]
#[graphql(field(name = "matchmaking_type", ty = "MatchmakingType"))]
#[serde(tag = "type")]
pub enum MatchmakingExtra {
    #[serde(rename = "1v1")]
    Match1v1(MatchmakingExtra1v1Data),
    #[serde(rename = "1v1fastest")]
    Match1v1Fastest(MatchmakingExtra1v1FastestData),
    #[serde(rename = "2v2")]
    Match2v2(MatchmakingExtra2v2Data),
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::Union)]
#[serde(rename_all = "UPPERCASE", tag = "gameSource")]
pub enum GameConfig {
    Lobby(GameConfigData<LobbyExtra>),
    Matchmaking(GameConfigData<MatchmakingExtra>),
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct GameRoute {
    pub p1: i32,
    pub p2: i32,
    pub server: i32,
    pub latency: f64,
}

pub struct GamesRepo {
    db: PgPool,
}

impl GamesRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    pub async fn load_one(&self, id: Uuid) -> eyre::Result<Option<DbGame>> {
        sqlx::query_as!(
            DbGame,
            r#"
            SELECT id, start_time, map_id, config as "config: _",
                disputable, dispute_requested, dispute_reviewed,
                game_length, results as "results: _", routes as "routes: _"
            FROM games WHERE id = $1
            "#,
            id
        )
        .fetch_optional(&self.db)
        .await
        .wrap_err("Failed to load game")
    }

    pub async fn load_live_games(&self) -> eyre::Result<Vec<DbGame>> {
        sqlx::query_as!(
            DbGame,
            r#"
            SELECT id, start_time, map_id, config as "config: _",
                disputable, dispute_requested, dispute_reviewed,
                game_length, results as "results: _", routes as "routes: _"
            FROM games
            WHERE
                game_length IS NULL
                AND start_time < now() - interval '2 minutes'
                AND start_time > now() - interval '1 hour'
                AND config->>'gameSource' = 'MATCHMAKING'
            ORDER BY start_time DESC
            LIMIT 10
            "#,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load live games")
    }
}
