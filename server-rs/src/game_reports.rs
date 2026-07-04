use std::collections::HashMap;
use std::time::Duration;

use async_graphql::connection::{Connection, Edge, query};
use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{
    ComplexObject, Context, InputObject, Object, Result, SchemaBuilder, SimpleObject,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr, eyre};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use typeshare::typeshare;
use uuid::Uuid;

use crate::file_store::FileStore;
use crate::games::{Game, GamesLoader};
use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::users::permissions::RequiredPermission;
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader};

/// The most reports a single user can file in a rolling hour. This exists only to stop outright
/// spam (e.g. reporting every player in one's match history); it's sized so the worst honest case —
/// a fully cursed 3v3, five reports — fits comfortably.
const MAX_REPORTS_PER_HOUR: i64 = 10;

/// How long a minted replay-download URL stays valid. Generous enough that an admin can open it a
/// while after loading the report.
const REPLAY_URL_EXPIRY: Duration = Duration::from_secs(60 * 60);

pub struct GameReportsModule {
    db_pool: PgPool,
}

impl GameReportsModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for GameReportsModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder
            .data(GameReportsRepo::new(self.db_pool.clone()))
            .data(DataLoader::new(
                GameReportStatsLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                BestReplayLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
    }
}

/// Why a player was reported. Stored in the `reason` TEXT column (not a PG enum) so the vocabulary
/// stays a code-only change; the DB string form is defined by [`GameReportReason::to_db`].
#[derive(Copy, Clone, Debug, PartialEq, Eq, async_graphql::Enum)]
pub enum GameReportReason {
    /// Any mechanism of unfair advantage: hacks, third-party tools, or game/map exploit abuse.
    Cheating,
    /// Left the game mid-match (mostly relevant for allies in team games). Note this is distinct
    /// from queue dodging, which is handled automatically by matchmaking bans.
    Abandoning,
    /// Stayed in the game but sabotaged it: feeding, intentional losing, AFK, refusing to play.
    Griefing,
    /// Harassment, hate speech, or toxicity in game chat.
    AbusiveChat,
    /// Anything else; the details field is required for this reason.
    Other,
}

impl GameReportReason {
    fn to_db(self) -> &'static str {
        match self {
            Self::Cheating => "cheating",
            Self::Abandoning => "abandoning",
            Self::Griefing => "griefing",
            Self::AbusiveChat => "abusive_chat",
            Self::Other => "other",
        }
    }

    fn from_db(value: &str) -> eyre::Result<Self> {
        Ok(match value {
            "cheating" => Self::Cheating,
            "abandoning" => Self::Abandoning,
            "griefing" => Self::Griefing,
            "abusive_chat" => Self::AbusiveChat,
            "other" => Self::Other,
            other => return Err(eyre!("unknown game report reason: {other}")),
        })
    }
}

/// The outcome of resolving a report. `Dismissed` (unfounded / insufficient evidence) is kept
/// distinct from `Abusive` (the report itself was bad-faith) so the two never get conflated in the
/// reporter-credibility stats. Stored in the `resolution` TEXT column.
#[derive(Copy, Clone, Debug, PartialEq, Eq, async_graphql::Enum)]
pub enum GameReportResolution {
    /// The report was valid and action was taken.
    Actioned,
    /// Unfounded or insufficient evidence.
    Dismissed,
    /// The report itself was bad-faith (false reporting, harassment-by-report).
    Abusive,
    /// A valid duplicate of another report for the same target/game.
    Duplicate,
}

impl GameReportResolution {
    fn to_db(self) -> &'static str {
        match self {
            Self::Actioned => "actioned",
            Self::Dismissed => "dismissed",
            Self::Abusive => "abusive",
            Self::Duplicate => "duplicate",
        }
    }

    fn from_db(value: &str) -> eyre::Result<Self> {
        Ok(match value {
            "actioned" => Self::Actioned,
            "dismissed" => Self::Dismissed,
            "abusive" => Self::Abusive,
            "duplicate" => Self::Duplicate,
            other => return Err(eyre!("unknown game report resolution: {other}")),
        })
    }
}

/// Messages published to Node (via Redis pub/sub) about game-report events. Node turns these into
/// user-facing notifications (and later shares the same channel with the Discord webhook). This is
/// deliberately kept as pub/sub rather than a direct write so the notification/webhook machinery
/// stays in Node, where the rest of it lives.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedGameReportMessage {
    /// A new report was filed. Node fires the moderation Discord webhook (the same way bug reports
    /// do); the payload carries what the webhook message needs so Node only has to resolve the two
    /// usernames.
    #[serde(rename_all = "camelCase")]
    ReportCreated {
        report_id: Uuid,
        reporter_id: SbUserId,
        reported_user_id: SbUserId,
        /// The DB reason string (e.g. `"cheating"`); Node maps it to a label.
        reason: String,
        details: Option<String>,
    },
    /// A report was resolved as `Actioned`. The listed users — the actioned report's reporter plus
    /// the reporters of any sibling reports (same game + target) that were resolved as `Duplicate` —
    /// should be told that a player they reported was punished. Content stays deliberately vague on
    /// the Node side (no names, no game link) as an anti-retaliation measure.
    #[serde(rename_all = "camelCase")]
    ReportActioned { reporter_ids: Vec<SbUserId> },
}

#[derive(SimpleObject)]
#[graphql(complex)]
pub struct GameReport {
    pub id: Uuid,
    #[graphql(skip)]
    pub game_id: Uuid,
    #[graphql(skip)]
    pub reporter_id: SbUserId,
    #[graphql(skip)]
    pub reported_user_id: SbUserId,
    pub reason: GameReportReason,
    pub details: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    #[graphql(skip)]
    pub resolver_id: Option<SbUserId>,
    pub resolution: Option<GameReportResolution>,
    pub resolution_notes: Option<String>,
}

#[ComplexObject]
impl GameReport {
    async fn reporter(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.reporter_id)
            .await
    }

    async fn reported_user(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.reported_user_id)
            .await
    }

    async fn resolver(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let Some(resolver_id) = self.resolver_id else {
            return Ok(None);
        };
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(resolver_id)
            .await
    }

    /// The reported game, so the admin UI can show context and link to it.
    async fn game(&self, ctx: &Context<'_>) -> Result<Option<Game>> {
        // Batched via a DataLoader so a list of reports doesn't fan out one query per row.
        let game = ctx
            .data::<DataLoader<GamesLoader>>()?
            .load_one(self.game_id)
            .await?;
        Ok(game.map(|g| g.into()))
    }

    /// The best (longest) replay for this game, if one was uploaded, as a signed download URL plus
    /// the file id + hash the client needs to cache and watch it. Guarded directly (not just via
    /// the query) because `report_game` returns a `GameReport` to any logged-in user and field
    /// guards aren't transitive — without this, a non-admin could select it off the mutation
    /// response and get a signed URL that skips the per-user replay ACLs.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn replay(&self, ctx: &Context<'_>) -> Result<Option<GameReportReplay>> {
        // The replay lookup is batched via a DataLoader (like `game`); the signed-URL mint stays
        // per-row since it's local crypto, not a DB query.
        let Some((replay_file_id, hash)) = ctx
            .data::<DataLoader<BestReplayLoader>>()?
            .load_one(self.game_id)
            .await?
        else {
            return Ok(None);
        };

        let file_store = ctx.data::<FileStore>()?;
        let url = file_store
            .signed_url_with_disposition(
                &format!("replays/{replay_file_id}.rep"),
                &format!("shieldbattery-{}.rep", self.game_id),
                REPLAY_URL_EXPIRY,
            )
            .await?;

        Ok(Some(GameReportReplay {
            replay_file_id,
            hash: hex_encode(&hash),
            url,
        }))
    }

    /// Credibility context for the reporter: how their past reports have resolved. Derived stats,
    /// not a stored score. Guarded directly (see `replay`) so it isn't reachable off the
    /// unguarded `report_game` mutation response. Batched via a DataLoader so a list of reports
    /// doesn't fan out one query per row.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn reporter_stats(&self, ctx: &Context<'_>) -> Result<GameReportUserStats> {
        let stats = ctx
            .data::<DataLoader<GameReportStatsLoader>>()?
            .load_one(self.reporter_id)
            .await?
            .unwrap_or_default();
        Ok(stats.as_reporter)
    }

    /// The mirror of `reporter_stats` for the reported user — surfaces reports filed *against* them
    /// (also catches brigading, where several reporters pile onto one player). Guarded directly
    /// (see `replay`), batched via the same DataLoader.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn reported_user_stats(&self, ctx: &Context<'_>) -> Result<GameReportUserStats> {
        let stats = ctx
            .data::<DataLoader<GameReportStatsLoader>>()?
            .load_one(self.reported_user_id)
            .await?
            .unwrap_or_default();
        Ok(stats.as_reported)
    }
}

#[derive(SimpleObject)]
pub struct GameReportReplay {
    pub replay_file_id: Uuid,
    /// Hex-encoded SHA-256 of the replay file; matches `GameReplayInfo.hash` on the client.
    pub hash: String,
    /// Signed URL for downloading the replay.
    pub url: String,
}

/// A count of how a user's reports (as reporter or as reported) have resolved.
#[derive(SimpleObject, Clone, Default)]
pub struct GameReportUserStats {
    pub total: i64,
    pub actioned: i64,
    pub dismissed: i64,
    pub abusive: i64,
    pub duplicate: i64,
    pub pending: i64,
}

#[derive(InputObject)]
pub struct ReportGameInput {
    pub game_id: Uuid,
    pub reported_user_id: SbUserId,
    pub reason: GameReportReason,
    pub details: Option<String>,
}

#[derive(InputObject, Default)]
pub struct GameReportFilter {
    /// Include already-resolved reports. Defaults to false (unresolved queue only).
    pub include_resolved: Option<bool>,
    /// Restrict to reports filed against this user (the "reports against" moderation view).
    pub reported_user_id: Option<SbUserId>,
}

/// Maximum length of the free-text details field in Unicode chars (not bytes — the client
/// validates in UTF-16 code units, which is always >= the char count, so counting chars here
/// guarantees anything the client accepts is accepted server-side too). The number matches the
/// bug-report limit.
const MAX_DETAILS_LEN: usize = 5000;

#[derive(Default)]
pub struct GameReportsQuery;

#[Object]
impl GameReportsQuery {
    /// Fetches a single report by id, for the admin detail view.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn game_report(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<GameReport>> {
        Ok(ctx.data::<GameReportsRepo>()?.load_one(id).await?)
    }

    /// Lists game reports for moderation. Unresolved-only by default (newest first); pass
    /// `includeResolved` to see everything, or `reportedUserId` to see reports against one player.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn game_reports(
        &self,
        ctx: &Context<'_>,
        filter: Option<GameReportFilter>,
        after: Option<String>,
        before: Option<String>,
        first: Option<i32>,
        last: Option<i32>,
    ) -> Result<Connection<Uuid, GameReport>> {
        let repo = ctx.data::<GameReportsRepo>()?;
        let filter = filter.unwrap_or_default();
        let include_resolved = filter.include_resolved.unwrap_or(false);
        let reported_user_id = filter.reported_user_id;

        query(
            after,
            before,
            first,
            last,
            |after, before, first, last| async move {
                let first = first.map(|f| f.clamp(1, 100));
                let last = last.map(|l| l.clamp(1, 100));
                let count = first.or(last).unwrap_or(25);

                let (has_prev_page, has_next_page, reports) = repo
                    .load_many(
                        include_resolved,
                        reported_user_id,
                        after,
                        before,
                        count,
                        last.is_some() && first.is_none(),
                    )
                    .await?;

                let mut connection = Connection::new(has_prev_page, has_next_page);
                connection
                    .edges
                    .extend(reports.into_iter().map(|r| Edge::new(r.id, r)));
                Ok::<_, async_graphql::Error>(connection)
            },
        )
        .await
    }
}

#[derive(Default)]
pub struct GameReportsMutation;

#[Object]
impl GameReportsMutation {
    /// Files a report against another player from a game both users participated in. Any logged-in
    /// user may call this (subject to the reporting restriction and the per-hour cap).
    async fn report_game(&self, ctx: &Context<'_>, input: ReportGameInput) -> Result<GameReport> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };
        let reporter_id = user.id;

        if input.reported_user_id == reporter_id {
            return Err(graphql_error("BAD_REQUEST", "You can't report yourself"));
        }

        // Normalize details up front — trim, then treat whitespace-only as absent — so validation
        // sees exactly what gets stored and the column is consistently NULL vs non-empty text.
        let details = input
            .details
            .map(|d| d.trim().to_owned())
            .filter(|d| !d.is_empty());

        if matches!(input.reason, GameReportReason::Other) && details.is_none() {
            return Err(graphql_error(
                "BAD_REQUEST",
                "Details are required when the reason is Other",
            ));
        }
        if let Some(details) = &details
            && details.chars().count() > MAX_DETAILS_LEN
        {
            return Err(graphql_error("BAD_REQUEST", "Details are too long"));
        }

        let repo = ctx.data::<GameReportsRepo>()?;

        if repo.is_reporting_restricted(reporter_id).await? {
            return Err(graphql_error(
                "RESTRICTED",
                "You are currently restricted from reporting",
            ));
        }

        let (reporter_played, reported_played) = repo
            .check_participation(input.game_id, reporter_id, input.reported_user_id)
            .await?;
        if !reporter_played {
            return Err(graphql_error(
                "FORBIDDEN",
                "You can only report players from a game you participated in",
            ));
        }
        if !reported_played {
            return Err(graphql_error(
                "BAD_REQUEST",
                "The reported player wasn't in that game",
            ));
        }

        if repo.recent_report_count(reporter_id).await? >= MAX_REPORTS_PER_HOUR {
            return Err(graphql_error(
                "RATE_LIMITED",
                "You've filed too many reports recently. Please try again later.",
            ));
        }

        let report = repo
            .create_report(
                input.game_id,
                reporter_id,
                input.reported_user_id,
                input.reason,
                details,
            )
            .await?;

        let report = report.ok_or_else(|| {
            graphql_error(
                "ALREADY_REPORTED",
                "You've already reported this player for this game",
            )
        })?;

        // Let Node fire the moderation Discord webhook (the webhook notifier lives there). Best-
        // effort: a failed publish shouldn't fail the report.
        if let Err(err) = ctx
            .data::<RedisPool>()?
            .publish(PublishedGameReportMessage::ReportCreated {
                report_id: report.id,
                reporter_id: report.reporter_id,
                reported_user_id: report.reported_user_id,
                reason: report.reason.to_db().to_owned(),
                details: report.details.clone(),
            })
            .await
        {
            tracing::error!("failed to publish game report created message: {err:?}");
        }

        Ok(report)
    }

    /// Resolves a report with an outcome (which feeds the credibility stats). Idempotency is
    /// enforced: a report can only be resolved once.
    #[graphql(guard = RequiredPermission::ManageGameReports)]
    async fn resolve_game_report(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        resolution: GameReportResolution,
        notes: Option<String>,
    ) -> Result<GameReport> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };

        let repo = ctx.data::<GameReportsRepo>()?;
        let report = match repo.resolve_report(id, user.id, resolution, notes).await? {
            Some(report) => report,
            None => {
                return if repo.report_exists(id).await? {
                    Err(graphql_error(
                        "ALREADY_RESOLVED",
                        "That report has already been resolved",
                    ))
                } else {
                    Err(graphql_error("NOT_FOUND", "Report not found"))
                };
            }
        };

        // Notify the reporters whose report led to a punishment. This covers the report just
        // actioned, and — when this resolution is `Actioned` — the reporters of any sibling reports
        // (same game + target) already resolved as `Duplicate`, since they made an equally good
        // report. Resolving a report as `Duplicate` after its sibling was actioned notifies that
        // reporter too. This is strictly best-effort: the resolution has already committed, so
        // neither computing the recipients nor publishing must fail the mutation (otherwise the
        // client sees an error for an action that succeeded, and a retry hits ALREADY_RESOLVED).
        match repo.reporters_to_notify(&report, resolution).await {
            Ok(reporter_ids) if !reporter_ids.is_empty() => {
                if let Err(err) = ctx
                    .data::<RedisPool>()?
                    .publish(PublishedGameReportMessage::ReportActioned { reporter_ids })
                    .await
                {
                    tracing::error!("failed to publish game report notification: {err:?}");
                }
            }
            Ok(_) => {}
            Err(err) => tracing::error!("failed to compute reporters to notify: {err:?}"),
        }

        Ok(report)
    }
}

/// Row shape for `game_reports`. `reason`/`resolution` are loaded as raw strings and converted to
/// their enums in [`GameReportsRepo::to_report`].
#[derive(sqlx::FromRow)]
struct DbGameReport {
    id: Uuid,
    game_id: Uuid,
    reporter_id: SbUserId,
    reported_user_id: SbUserId,
    reason: String,
    details: Option<String>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolver_id: Option<SbUserId>,
    resolution: Option<String>,
    resolution_notes: Option<String>,
}

pub struct GameReportsRepo {
    db: PgPool,
}

impl GameReportsRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    fn to_report(db: DbGameReport) -> eyre::Result<GameReport> {
        Ok(GameReport {
            id: db.id,
            game_id: db.game_id,
            reporter_id: db.reporter_id,
            reported_user_id: db.reported_user_id,
            reason: GameReportReason::from_db(&db.reason)?,
            details: db.details,
            created_at: db.created_at,
            resolved_at: db.resolved_at,
            resolver_id: db.resolver_id,
            resolution: db
                .resolution
                .as_deref()
                .map(GameReportResolution::from_db)
                .transpose()?,
            resolution_notes: db.resolution_notes,
        })
    }

    async fn is_reporting_restricted(&self, user_id: SbUserId) -> eyre::Result<bool> {
        let row = sqlx::query_scalar!(
            r#"
                SELECT EXISTS(
                    SELECT 1 FROM user_restrictions
                    WHERE user_id = $1 AND kind = 'reporting'::restriction_kind
                        AND start_time <= NOW() AND end_time > NOW()
                ) AS "exists!"
            "#,
            user_id.0,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to check reporting restriction")?;
        Ok(row)
    }

    /// Returns `(reporter_played, reported_played)` for the given game in one query.
    async fn check_participation(
        &self,
        game_id: Uuid,
        reporter_id: SbUserId,
        reported_user_id: SbUserId,
    ) -> eyre::Result<(bool, bool)> {
        let row = sqlx::query!(
            r#"
                SELECT
                    COALESCE(bool_or(user_id = $2), false) AS "reporter_played!",
                    COALESCE(bool_or(user_id = $3), false) AS "reported_played!"
                FROM games_users
                WHERE game_id = $1 AND user_id IN ($2, $3)
            "#,
            game_id,
            reporter_id.0,
            reported_user_id.0,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to check game participation")?;
        Ok((row.reporter_played, row.reported_played))
    }

    async fn recent_report_count(&self, reporter_id: SbUserId) -> eyre::Result<i64> {
        let count = sqlx::query_scalar!(
            r#"
                SELECT COUNT(*) AS "count!"
                FROM game_reports
                WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
            "#,
            reporter_id.0,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to count recent reports")?;
        Ok(count)
    }

    async fn create_report(
        &self,
        game_id: Uuid,
        reporter_id: SbUserId,
        reported_user_id: SbUserId,
        reason: GameReportReason,
        details: Option<String>,
    ) -> eyre::Result<Option<GameReport>> {
        let row = sqlx::query_as!(
            DbGameReport,
            r#"
                INSERT INTO game_reports (game_id, reporter_id, reported_user_id, reason, details)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (reporter_id, game_id, reported_user_id) DO NOTHING
                RETURNING id, game_id, reporter_id as "reporter_id: _",
                    reported_user_id as "reported_user_id: _", reason, details, created_at,
                    resolved_at, resolver_id as "resolver_id: _", resolution, resolution_notes
            "#,
            game_id,
            reporter_id.0,
            reported_user_id.0,
            reason.to_db(),
            details,
        )
        .fetch_optional(&self.db)
        .await
        .wrap_err("Failed to create game report")?;

        row.map(Self::to_report).transpose()
    }

    async fn resolve_report(
        &self,
        id: Uuid,
        resolver_id: SbUserId,
        resolution: GameReportResolution,
        notes: Option<String>,
    ) -> eyre::Result<Option<GameReport>> {
        let row = sqlx::query_as!(
            DbGameReport,
            r#"
                UPDATE game_reports
                SET resolved_at = NOW(), resolver_id = $2, resolution = $3, resolution_notes = $4
                WHERE id = $1 AND resolved_at IS NULL
                RETURNING id, game_id, reporter_id as "reporter_id: _",
                    reported_user_id as "reported_user_id: _", reason, details, created_at,
                    resolved_at, resolver_id as "resolver_id: _", resolution, resolution_notes
            "#,
            id,
            resolver_id.0,
            resolution.to_db(),
            notes,
        )
        .fetch_optional(&self.db)
        .await
        .wrap_err("Failed to resolve game report")?;

        row.map(Self::to_report).transpose()
    }

    /// Computes which reporters should be notified that action was taken, for a report that was
    /// just resolved with `resolution`:
    /// - `Actioned`: this report's reporter, plus — only if this is the *first* actioned report for
    ///   this game + target — the reporters of any sibling reports already resolved as `Duplicate`.
    ///   The "first actioned" guard means actioning a second sibling doesn't re-notify the same
    ///   duplicate reporters (they were notified when the first sibling was actioned).
    /// - `Duplicate`: this report's reporter, but only if a sibling report was resolved as
    ///   `Actioned` (so a duplicate of an actioned report gets the same feel-good notification).
    /// - Anything else: nobody.
    ///
    /// The unique `(reporter_id, game_id, reported_user_id)` constraint guarantees each reporter
    /// appears at most once, so the returned ids are already distinct — and the guards above ensure
    /// a given reporter is notified at most once across the whole resolution sequence.
    async fn reporters_to_notify(
        &self,
        report: &GameReport,
        resolution: GameReportResolution,
    ) -> eyre::Result<Vec<SbUserId>> {
        match resolution {
            GameReportResolution::Actioned => sqlx::query_scalar!(
                r#"
                    SELECT reporter_id AS "reporter_id!: SbUserId"
                    FROM game_reports
                    WHERE game_id = $1 AND reported_user_id = $2
                        AND (
                            id = $3
                            OR (
                                resolution = 'duplicate'
                                -- Only fold in duplicate siblings when this is the first actioned
                                -- report; a later actioned sibling would otherwise re-notify them.
                                AND NOT EXISTS (
                                    SELECT 1 FROM game_reports other
                                    WHERE other.game_id = $1 AND other.reported_user_id = $2
                                        AND other.id != $3 AND other.resolution = 'actioned'
                                )
                            )
                        )
                "#,
                report.game_id,
                report.reported_user_id.0,
                report.id,
            )
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load reporters to notify"),
            GameReportResolution::Duplicate => {
                let has_actioned_sibling = sqlx::query_scalar!(
                    r#"
                        SELECT EXISTS(
                            SELECT 1 FROM game_reports
                            WHERE game_id = $1 AND reported_user_id = $2
                                AND id != $3 AND resolution = 'actioned'
                        ) AS "exists!"
                    "#,
                    report.game_id,
                    report.reported_user_id.0,
                    report.id,
                )
                .fetch_one(&self.db)
                .await
                .wrap_err("Failed to check for an actioned sibling report")?;
                Ok(if has_actioned_sibling {
                    vec![report.reporter_id]
                } else {
                    Vec::new()
                })
            }
            _ => Ok(Vec::new()),
        }
    }

    async fn load_one(&self, id: Uuid) -> eyre::Result<Option<GameReport>> {
        let row = sqlx::query_as!(
            DbGameReport,
            r#"
                SELECT id, game_id, reporter_id as "reporter_id: _",
                    reported_user_id as "reported_user_id: _", reason, details, created_at,
                    resolved_at, resolver_id as "resolver_id: _", resolution, resolution_notes
                FROM game_reports
                WHERE id = $1
            "#,
            id,
        )
        .fetch_optional(&self.db)
        .await
        .wrap_err("Failed to load game report")?;

        row.map(Self::to_report).transpose()
    }

    async fn report_exists(&self, id: Uuid) -> eyre::Result<bool> {
        let exists = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM game_reports WHERE id = $1) AS "exists!""#,
            id,
        )
        .fetch_one(&self.db)
        .await
        .wrap_err("Failed to check report existence")?;
        Ok(exists)
    }

    /// Keyset-paginated report list. Ordering is always newest-first; `inverted` (backward
    /// pagination via `last`/`before`) fetches the window closest to the `before` cursor and then
    /// re-orders it to match. Returns `(has_prev_page, has_next_page, reports)`.
    async fn load_many(
        &self,
        include_resolved: bool,
        reported_user_id: Option<SbUserId>,
        after: Option<Uuid>,
        before: Option<Uuid>,
        count: usize,
        inverted: bool,
    ) -> eyre::Result<(bool, bool, Vec<GameReport>)> {
        let mut builder = QueryBuilder::new(
            r#"
                SELECT id, game_id, reporter_id, reported_user_id, reason, details, created_at,
                    resolved_at, resolver_id, resolution, resolution_notes
                FROM game_reports
                WHERE true
            "#,
        );

        if !include_resolved {
            builder.push(" AND resolved_at IS NULL");
        }
        if let Some(reported_user_id) = reported_user_id {
            builder.push(" AND reported_user_id = ");
            builder.push_bind(reported_user_id.0);
        }
        // Keyset cursors: "after" walks to older rows, "before" to newer ones. Compared as
        // (created_at, id) tuples so identical timestamps still page deterministically.
        if let Some(after) = after {
            builder.push(
                " AND (created_at, id) < (SELECT created_at, id FROM game_reports WHERE id = ",
            );
            builder.push_bind(after);
            builder.push(")");
        }
        if let Some(before) = before {
            builder.push(
                " AND (created_at, id) > (SELECT created_at, id FROM game_reports WHERE id = ",
            );
            builder.push_bind(before);
            builder.push(")");
        }

        // For backward pagination fetch the window nearest the cursor (ASC), then re-sort below.
        if inverted {
            builder.push(" ORDER BY created_at ASC, id ASC LIMIT ");
        } else {
            builder.push(" ORDER BY created_at DESC, id DESC LIMIT ");
        }
        builder.push_bind(count as i64 + 1);

        let mut rows: Vec<DbGameReport> = builder
            .build_query_as()
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load game reports")?;

        // The extra (count + 1)th row is the sentinel telling us more exist in the fetch direction.
        let has_extra = rows.len() > count;
        if has_extra {
            rows.truncate(count);
        }
        if inverted {
            rows.reverse();
        }

        let (has_prev_page, has_next_page) = if inverted {
            (has_extra, before.is_some())
        } else {
            (after.is_some(), has_extra)
        };

        let reports = rows
            .into_iter()
            .map(Self::to_report)
            .collect::<eyre::Result<Vec<_>>>()?;
        Ok((has_prev_page, has_next_page, reports))
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
            let _ = write!(acc, "{b:02x}");
            acc
        })
}

/// Batches the best-(longest-)replay lookup for the `replay` field across the reports in a
/// request, keyed by game id, so a list of reports resolves it with one grouped query instead of
/// one per row (per AGENTS.md's no-per-item-fan-out rule). Yields `(replay_file_id, hash)`.
pub struct BestReplayLoader {
    db: PgPool,
}

impl BestReplayLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for BestReplayLoader {
    type Value = (Uuid, Vec<u8>);
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>> {
        let rows = sqlx::query!(
            r#"
                SELECT DISTINCT ON (gu.game_id)
                    gu.game_id AS "game_id!", rf.id AS "id!", rf.hash AS "hash!"
                FROM replay_files rf
                JOIN games_users gu ON gu.replay_file_id = rf.id
                WHERE gu.game_id = ANY($1)
                ORDER BY gu.game_id, (rf.header->>'frames')::int DESC NULLS LAST
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| (r.game_id, (r.id, r.hash)))
            .collect())
    }
}

/// A user's report-credibility stats in both roles, loaded together.
#[derive(Clone, Default)]
pub struct UserReportStats {
    as_reporter: GameReportUserStats,
    as_reported: GameReportUserStats,
}

/// Batches `reporterStats` / `reportedUserStats` across the reports in a request so the list view
/// resolves them with two grouped queries instead of one query per row (per AGENTS.md's
/// no-per-item-fan-out rule).
pub struct GameReportStatsLoader {
    db: PgPool,
}

impl GameReportStatsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbUserId> for GameReportStatsLoader {
    type Value = UserReportStats;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, UserReportStats>> {
        let mut stats: HashMap<SbUserId, UserReportStats> = HashMap::new();

        let reporter_rows = sqlx::query!(
            r#"
                SELECT
                    reporter_id AS "user_id!: SbUserId",
                    COUNT(*) AS "total!",
                    COUNT(*) FILTER (WHERE resolution = 'actioned') AS "actioned!",
                    COUNT(*) FILTER (WHERE resolution = 'dismissed') AS "dismissed!",
                    COUNT(*) FILTER (WHERE resolution = 'abusive') AS "abusive!",
                    COUNT(*) FILTER (WHERE resolution = 'duplicate') AS "duplicate!",
                    COUNT(*) FILTER (WHERE resolved_at IS NULL) AS "pending!"
                FROM game_reports
                WHERE reporter_id = ANY($1)
                GROUP BY reporter_id
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await?;
        for row in reporter_rows {
            stats.entry(row.user_id).or_default().as_reporter = GameReportUserStats {
                total: row.total,
                actioned: row.actioned,
                dismissed: row.dismissed,
                abusive: row.abusive,
                duplicate: row.duplicate,
                pending: row.pending,
            };
        }

        let reported_rows = sqlx::query!(
            r#"
                SELECT
                    reported_user_id AS "user_id!: SbUserId",
                    COUNT(*) AS "total!",
                    COUNT(*) FILTER (WHERE resolution = 'actioned') AS "actioned!",
                    COUNT(*) FILTER (WHERE resolution = 'dismissed') AS "dismissed!",
                    COUNT(*) FILTER (WHERE resolution = 'abusive') AS "abusive!",
                    COUNT(*) FILTER (WHERE resolution = 'duplicate') AS "duplicate!",
                    COUNT(*) FILTER (WHERE resolved_at IS NULL) AS "pending!"
                FROM game_reports
                WHERE reported_user_id = ANY($1)
                GROUP BY reported_user_id
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await?;
        for row in reported_rows {
            stats.entry(row.user_id).or_default().as_reported = GameReportUserStats {
                total: row.total,
                actioned: row.actioned,
                dismissed: row.dismissed,
                abusive: row.abusive,
                duplicate: row.duplicate,
                pending: row.pending,
            };
        }

        Ok(stats)
    }
}
