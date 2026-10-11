use std::collections::HashMap;

use async_graphql::futures_util::TryStreamExt;
use async_graphql::{
    ComplexObject, Object, OutputType, SchemaBuilder, SimpleObject,
    dataloader::{DataLoader, Loader},
    scalar,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    graphql::{errors::graphql_error, schema_builder::SchemaBuilderModule},
    maps::{MapsLoader, SbMapId, UploadedMap},
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
        builder
            .data(GamesRepo::new(self.db_pool.clone()))
            .data(DataLoader::new(
                GamesLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                GameRanksLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
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
        let game = ctx.data::<DataLoader<GamesLoader>>()?.load_one(id).await?;
        Ok(game.map(|g| g.into()))
    }

    /// A selection of the matchmaking games currently in progress: up to six, favoring games
    /// between higher-rated players while spreading the picks across matchmaking types. Ordered
    /// with the best game of each type first, so a consumer showing fewer keeps the variety.
    async fn live_games(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Vec<Game>> {
        let repo = ctx.data::<GamesRepo>()?;
        let candidates = repo.load_live_game_candidates().await?;
        Ok(pick_live_games(candidates, LIVE_GAMES_LIMIT)
            .into_iter()
            .map(|g| g.into())
            .collect())
    }
}

#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct Game {
    pub id: Uuid,
    pub start_time: DateTime<Utc>,
    #[graphql(skip)]
    pub map_id: SbMapId,
    pub config: GameConfig,
    pub disputable: bool,
    pub dispute_requested: bool,
    pub dispute_reviewed: bool,
    pub game_length: Option<i32>,
    pub results: Option<Vec<ReconciledPlayerResultEntry>>,
}

#[ComplexObject]
impl Game {
    async fn map(&self, ctx: &async_graphql::Context<'_>) -> async_graphql::Result<UploadedMap> {
        let maps_loader = ctx.data::<DataLoader<MapsLoader>>()?;
        let map = maps_loader.load_one(self.map_id).await?;
        map.ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
    }

    /// Each player's standing in the game's matchmaking mode during the season the game started
    /// in. This is their standing as of now rather than as of the game, so once the game's results
    /// are in, it includes them. Empty for games that weren't from matchmaking; a player with no
    /// rating in that mode and season is left out.
    async fn current_ranks(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Vec<GamePlayerRank>> {
        if !matches!(self.config, GameConfig::Matchmaking(_)) {
            return Ok(Vec::new());
        }

        let loader = ctx.data::<DataLoader<GameRanksLoader>>()?;
        Ok(loader.load_one(self.id).await?.unwrap_or_default())
    }
}

/// A player's standing in a matchmaking mode for a season. Carries only what's public about it
/// (points, record and placement progress), never the player's rating.
#[derive(Debug, Clone, SimpleObject)]
#[graphql(complex)]
pub struct GamePlayerRank {
    pub user_id: SbUserId,
    pub matchmaking_type: MatchmakingType,
    pub season_id: i32,
    pub points: f32,
    pub wins: i32,
    pub losses: i32,
    /// Games played since the player's last MMR reset. Below the placement match count, the
    /// player's division isn't decided yet.
    pub lifetime_games: i32,
}

#[ComplexObject]
impl GamePlayerRank {
    /// Identifies the standing itself (a player in a mode for a season), so every game that
    /// player is in shares one cached copy.
    async fn id(&self) -> String {
        format!(
            "rank:{}:{}:{}",
            self.user_id.0,
            self.matchmaking_type.as_str(),
            self.season_id
        )
    }
}

#[derive(Debug, Copy, Clone, SimpleObject)]
pub struct ReconciledPlayerResultEntry {
    pub id: SbUserId,
    pub result: ReconciledPlayerResult,
}

/// The `results` column as stored. Named so query column overrides can refer to it without
/// exceeding Postgres's 63-character identifier limit.
pub type DbGameResults = sqlx::types::Json<Vec<(SbUserId, ReconciledPlayerResult)>>;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DbGame {
    pub id: Uuid,
    pub start_time: DateTime<Utc>,
    pub map_id: SbMapId,
    pub config: sqlx::types::Json<GameConfig>,
    pub disputable: bool,
    pub dispute_requested: bool,
    pub dispute_reviewed: bool,
    pub game_length: Option<i32>,
    pub results: Option<DbGameResults>,
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
    /// Whether the game was played without the ShieldBattery game logic fixes that make replays
    /// play back differently in StarCraft: Remastered without ShieldBattery. Missing for games
    /// recorded before this setting existed, which should be treated as `false`.
    pub starcraft_compatible_replays: Option<bool>,
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

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra2v2BghData {}

#[Object]
impl MatchmakingExtra2v2BghData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match2v2Bgh
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra2v2HuntersData {}

#[Object]
impl MatchmakingExtra2v2HuntersData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match2v2Hunters
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra2v2FastestData {}

#[Object]
impl MatchmakingExtra2v2FastestData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match2v2Fastest
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra3v3BghData {}

#[Object]
impl MatchmakingExtra3v3BghData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match3v3Bgh
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra3v3HuntersData {}

#[Object]
impl MatchmakingExtra3v3HuntersData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match3v3Hunters
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchmakingExtra3v3FastestData {}

#[Object]
impl MatchmakingExtra3v3FastestData {
    async fn matchmaking_type(&self, _ctx: &async_graphql::Context<'_>) -> MatchmakingType {
        MatchmakingType::Match3v3Fastest
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
    #[serde(rename = "2v2bgh")]
    Match2v2Bgh(MatchmakingExtra2v2BghData),
    #[serde(rename = "2v2hunters")]
    Match2v2Hunters(MatchmakingExtra2v2HuntersData),
    #[serde(rename = "2v2fastest")]
    Match2v2Fastest(MatchmakingExtra2v2FastestData),
    #[serde(rename = "3v3bgh")]
    Match3v3Bgh(MatchmakingExtra3v3BghData),
    #[serde(rename = "3v3hunters")]
    Match3v3Hunters(MatchmakingExtra3v3HuntersData),
    #[serde(rename = "3v3fastest")]
    Match3v3Fastest(MatchmakingExtra3v3FastestData),
}

#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::Union)]
#[serde(rename_all = "UPPERCASE", tag = "gameSource")]
pub enum GameConfig {
    Lobby(GameConfigData<LobbyExtra>),
    Matchmaking(GameConfigData<MatchmakingExtra>),
}

pub struct GamesRepo {
    db: PgPool,
}

impl GamesRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Loads every matchmaking game that looks to be in progress (newest first), along with the
    /// mean rating of its players, for [`pick_live_games`] to choose from.
    pub async fn load_live_game_candidates(&self) -> eyre::Result<Vec<LiveGameCandidate>> {
        let rows = sqlx::query!(
            r#"
            SELECT g.id, g.start_time, g.map_id as "map_id: SbMapId",
                g.config as "config: sqlx::types::Json<GameConfig>",
                g.disputable, g.dispute_requested, g.dispute_reviewed,
                g.game_length,
                -- Some legacy rows store `results` as an empty object `{}` instead of an array (or
                -- null); coerce any non-array value to NULL so it decodes as `None` rather than
                -- erroring ("invalid type: map, expected a sequence"). Matches the Node guard in
                -- game-models.ts.
                (CASE WHEN jsonb_typeof(g.results) = 'array' THEN g.results END)
                    as "results: DbGameResults",
                -- Ratings from the season the game started in (the last one to start at or before
                -- it; season start dates are stored as UTC without a time zone). Players with no
                -- rating in the mode that season are left out of the mean.
                (
                    SELECT AVG(r.rating)::float8
                    FROM games_users gu
                    JOIN matchmaking_ratings r
                        ON r.user_id = gu.user_id
                        AND r.matchmaking_type::text = g.config->'gameSourceExtra'->>'type'
                        AND r.season_id = (
                            SELECT s.id
                            FROM matchmaking_seasons s
                            WHERE s.start_date AT TIME ZONE 'UTC' <= g.start_time
                            ORDER BY s.start_date DESC
                            LIMIT 1
                        )
                    WHERE gu.game_id = g.id
                ) as "mean_rating"
            FROM games g
            WHERE
                g.game_length IS NULL
                AND g.canceled_at IS NULL
                AND g.start_time < now() - interval '2 minutes'
                AND g.start_time > now() - interval '1 hour'
                AND g.config->>'gameSource' = 'MATCHMAKING'
            ORDER BY g.start_time DESC
            LIMIT 200
            "#,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load live games")?;

        Ok(rows
            .into_iter()
            .map(|row| LiveGameCandidate {
                game: DbGame {
                    id: row.id,
                    start_time: row.start_time,
                    map_id: row.map_id,
                    config: row.config,
                    disputable: row.disputable,
                    dispute_requested: row.dispute_requested,
                    dispute_reviewed: row.dispute_reviewed,
                    game_length: row.game_length,
                    results: row.results,
                },
                mean_rating: row.mean_rating,
            })
            .collect())
    }
}

/// The most live games [`GamesQuery::live_games`] returns: two full rows of the Games page's
/// three-column live games grid.
const LIVE_GAMES_LIMIT: usize = 6;

pub struct LiveGameCandidate {
    pub game: DbGame,
    /// The mean rating of the game's players in its matchmaking type, or `None` if none of them
    /// has one.
    pub mean_rating: Option<f64>,
}

impl LiveGameCandidate {
    /// Identifies the game's matchmaking type, for spreading picks across types. Lobby games
    /// (which never reach the live games query) all share one key.
    fn type_key(&self) -> Option<std::mem::Discriminant<MatchmakingExtra>> {
        match &self.game.config.0 {
            GameConfig::Matchmaking(data) => Some(std::mem::discriminant(&data.game_source_extra)),
            GameConfig::Lobby(_) => None,
        }
    }
}

/// Chooses up to `limit` of `candidates` (given newest first) to show as live games.
///
/// Picks are made in rounds: the first round takes the highest-rated game of each matchmaking
/// type, the second the next highest of each, and so on, with each round ordered by rating. So
/// every type with a live game gets shown before any type gets a second slot, and within those
/// constraints higher-rated games win. Games with no rated players sort below every rated game,
/// and ties keep the newer game first.
fn pick_live_games(candidates: Vec<LiveGameCandidate>, limit: usize) -> Vec<DbGame> {
    let mut by_rating = candidates;
    // A stable sort, so ties keep the newest-first order the candidates came in.
    by_rating.sort_by(|a, b| {
        b.mean_rating
            .unwrap_or(f64::NEG_INFINITY)
            .total_cmp(&a.mean_rating.unwrap_or(f64::NEG_INFINITY))
    });

    let mut picked_per_type = HashMap::new();
    let mut with_round = by_rating
        .into_iter()
        .map(|candidate| {
            let picked = picked_per_type
                .entry(candidate.type_key())
                .or_insert(0usize);
            let round = *picked;
            *picked += 1;
            (round, candidate)
        })
        .collect::<Vec<_>>();
    // Stable, so each round stays in rating order.
    with_round.sort_by_key(|&(round, _)| round);

    with_round
        .into_iter()
        .take(limit)
        .map(|(_, candidate)| candidate.game)
        .collect()
}

/// Batches by-id game loads across a request so fields that resolve a game per row (e.g. `game` on
/// a `gameReports` page) issue one grouped query instead of fanning out one query per row (per
/// AGENTS.md's no-per-item-fan-out rule).
pub struct GamesLoader {
    db: PgPool,
}

impl GamesLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for GamesLoader {
    type Value = DbGame;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, DbGame>, Self::Error> {
        Ok(sqlx::query_as!(
            DbGame,
            r#"
            SELECT id, start_time, map_id as "map_id: _", config as "config: _",
                disputable, dispute_requested, dispute_reviewed,
                game_length,
                -- Some legacy rows store `results` as an empty object `{}` instead of an array (or
                -- null); coerce any non-array value to NULL so it decodes as `None` rather than
                -- erroring ("invalid type: map, expected a sequence"). Matches the Node guard in
                -- game-models.ts.
                (CASE WHEN jsonb_typeof(results) = 'array' THEN results END) as "results: _"
            FROM games WHERE id = ANY($1)
            "#,
            keys
        )
        .fetch(&self.db)
        .map_ok(|g| (g.id, g))
        .try_collect()
        .await?)
    }
}

/// Batches [`Game::current_ranks`] lookups by game id, so a list of games resolves every player's
/// rank in one query.
pub struct GameRanksLoader {
    db: PgPool,
}

impl GameRanksLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for GameRanksLoader {
    type Value = Vec<GamePlayerRank>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Vec<GamePlayerRank>>, Self::Error> {
        // A game's season is the last one to start at or before the game did. Season start dates
        // are stored as UTC without a time zone.
        let rows = sqlx::query!(
            r#"
            SELECT
                g.id AS "game_id!",
                r.user_id AS "user_id!: SbUserId",
                r.matchmaking_type AS "matchmaking_type!: MatchmakingType",
                r.season_id AS "season_id!",
                COALESCE(r.points, 0) AS "points!",
                COALESCE(r.wins, 0) AS "wins!",
                COALESCE(r.losses, 0) AS "losses!",
                COALESCE(r.lifetime_games, 0) AS "lifetime_games!"
            FROM games g
            CROSS JOIN LATERAL (
                SELECT s.id
                FROM matchmaking_seasons s
                WHERE s.start_date AT TIME ZONE 'UTC' <= g.start_time
                ORDER BY s.start_date DESC
                LIMIT 1
            ) season
            JOIN games_users gu ON gu.game_id = g.id
            JOIN matchmaking_ratings r
                ON r.user_id = gu.user_id
                AND r.season_id = season.id
                AND r.matchmaking_type::text = g.config->'gameSourceExtra'->>'type'
            WHERE g.id = ANY($1) AND g.config->>'gameSource' = 'MATCHMAKING'
            "#,
            keys
        )
        .fetch_all(&self.db)
        .await?;

        let mut ranks: HashMap<Uuid, Vec<GamePlayerRank>> = HashMap::new();
        for row in rows {
            ranks.entry(row.game_id).or_default().push(GamePlayerRank {
                user_id: row.user_id,
                matchmaking_type: row.matchmaking_type,
                season_id: row.season_id,
                points: row.points,
                wins: row.wins,
                losses: row.losses,
                lifetime_games: row.lifetime_games,
            });
        }
        Ok(ranks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        name: u128,
        extra: MatchmakingExtra,
        mean_rating: Option<f64>,
    ) -> LiveGameCandidate {
        LiveGameCandidate {
            game: DbGame {
                id: Uuid::from_u128(name),
                start_time: DateTime::<Utc>::UNIX_EPOCH,
                map_id: SbMapId(Uuid::nil()),
                config: sqlx::types::Json(GameConfig::Matchmaking(GameConfigData {
                    game_type: GameType::OneVsOne,
                    game_sub_type: 0,
                    teams: Vec::new(),
                    game_source_extra: extra,
                })),
                disputable: false,
                dispute_requested: false,
                dispute_reviewed: false,
                game_length: None,
                results: None,
            },
            mean_rating,
        }
    }

    fn one_v_one(name: u128, mean_rating: Option<f64>) -> LiveGameCandidate {
        candidate(
            name,
            MatchmakingExtra::Match1v1(Default::default()),
            mean_rating,
        )
    }

    fn bgh(name: u128, mean_rating: Option<f64>) -> LiveGameCandidate {
        candidate(
            name,
            MatchmakingExtra::Match3v3Bgh(Default::default()),
            mean_rating,
        )
    }

    fn ids(games: &[DbGame]) -> Vec<u128> {
        games.iter().map(|g| g.id.as_u128()).collect()
    }

    #[test]
    fn shows_every_type_before_any_type_gets_a_second_slot() {
        let picked = pick_live_games(
            vec![
                one_v_one(1, Some(2000.0)),
                one_v_one(2, Some(1900.0)),
                one_v_one(3, Some(1800.0)),
                bgh(4, Some(1200.0)),
                bgh(5, Some(1100.0)),
            ],
            3,
        );
        assert_eq!(ids(&picked), vec![1, 4, 2]);
    }

    #[test]
    fn orders_each_round_by_rating() {
        let picked = pick_live_games(
            vec![
                bgh(1, Some(1500.0)),
                one_v_one(2, Some(1600.0)),
                bgh(3, Some(1700.0)),
                one_v_one(4, Some(1400.0)),
            ],
            6,
        );
        assert_eq!(ids(&picked), vec![3, 2, 1, 4]);
    }

    #[test]
    fn fills_remaining_slots_from_a_single_type() {
        let picked = pick_live_games(
            (1..=8)
                .map(|i| one_v_one(i, Some(1000.0 + i as f64)))
                .collect(),
            6,
        );
        assert_eq!(ids(&picked), vec![8, 7, 6, 5, 4, 3]);
    }

    #[test]
    fn puts_unrated_games_last_and_breaks_ties_by_recency() {
        let picked = pick_live_games(
            vec![
                one_v_one(1, None),
                one_v_one(2, Some(1500.0)),
                one_v_one(3, Some(1500.0)),
            ],
            6,
        );
        assert_eq!(ids(&picked), vec![2, 3, 1]);
    }
}
