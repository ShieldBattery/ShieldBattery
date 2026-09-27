use async_graphql::dataloader::DataLoader;
use async_graphql::{Context, Enum, Object, Result, SchemaBuilder, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use typeshare::typeshare;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader, increment_commend_count};

/// How long after a game ends (its start time plus its length) its players can commend or report
/// each other.
pub const FEEDBACK_WINDOW: chrono::Duration = chrono::Duration::hours(24);
/// The rolling window both commend limits are measured over.
const COMMEND_LIMIT_WINDOW: chrono::Duration = chrono::Duration::hours(24);
/// The most commends one user can give within [`COMMEND_LIMIT_WINDOW`].
const MAX_COMMENDS_PER_WINDOW: i64 = 10;

pub struct GameCommendsModule {
    db_pool: PgPool,
}

impl GameCommendsModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for GameCommendsModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder.data(GameCommendsRepo::new(self.db_pool.clone()))
    }
}

/// Messages published to Node (via Redis pub/sub) about commends. Node relays them to the
/// commended player's client, which shows them as a local (never stored) notification.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedGameCommendMessage {
    #[serde(rename_all = "camelCase")]
    CommendReceived {
        game_id: Uuid,
        commender_id: SbUserId,
        commended_user_id: SbUserId,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Enum)]
pub enum GameFeedbackKind {
    Commend,
    Report,
}

/// Something the current user has already given another player in a game.
#[derive(SimpleObject, Clone, Debug)]
pub struct GivenGameFeedback {
    pub user_id: SbUserId,
    pub kind: GameFeedbackKind,
}

/// A player the current user commended within the last day, in any game, who can't be commended
/// again until `availableAt`.
#[derive(SimpleObject, Clone, Debug)]
pub struct RecentCommend {
    pub user_id: SbUserId,
    pub available_at: DateTime<Utc>,
}

/// The current user's ability to commend or report the other players of one game.
#[derive(SimpleObject, Clone, Debug)]
pub struct GameFeedback {
    /// The game's id, which clients can cache this by. Everything else here is about the current
    /// user.
    pub id: Uuid,
    /// When commending and reporting close for this game (its end plus 24 hours). Null when the game
    /// has no results yet, was canceled, or the current user didn't play in it.
    pub closes_at: Option<DateTime<Utc>>,
    /// What the current user has already given in this game.
    pub given: Vec<GivenGameFeedback>,
    /// How many more commends the current user can give right now.
    pub commends_remaining: i32,
    /// When `commendsRemaining` is 0: when the oldest commend in the window ages out.
    pub commends_available_at: Option<DateTime<Utc>>,
    /// Players in this game the current user commended within the last day (in any game).
    pub recent_commends: Vec<RecentCommend>,
}

#[derive(SimpleObject)]
pub struct CommendPlayerPayload {
    pub feedback: GameFeedback,
    /// The commended player, with their updated `commendCount`.
    pub commended_user: SbUser,
}

#[derive(Default)]
pub struct GameCommendsQuery;

#[Object]
impl GameCommendsQuery {
    /// What the current user can still commend or report in a game, and what they already have.
    async fn game_feedback(&self, ctx: &Context<'_>, game_id: Uuid) -> Result<GameFeedback> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };
        Ok(ctx
            .data::<GameCommendsRepo>()?
            .load_feedback(game_id, user.id)
            .await?)
    }
}

#[derive(Default)]
pub struct GameCommendsMutation;

#[Object]
impl GameCommendsMutation {
    /// Commends another player from a game both users played in.
    async fn commend_player(
        &self,
        ctx: &Context<'_>,
        game_id: Uuid,
        user_id: SbUserId,
    ) -> Result<CommendPlayerPayload> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };
        let commender_id = user.id;
        let repo = ctx.data::<GameCommendsRepo>()?;

        let mut tx = repo
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        lock_and_check_feedback(&mut tx, game_id, commender_id, user_id).await?;

        let limits = load_commend_limits(&mut tx, commender_id, Some(user_id)).await?;
        if let Some(last) = limits.last_to_target {
            return Err(graphql_error(
                "COMMENDED_RECENTLY",
                format!(
                    "You already commended this player recently. You can commend them again at {}.",
                    (last + COMMEND_LIMIT_WINDOW).to_rfc3339()
                ),
            ));
        }
        if limits.given >= MAX_COMMENDS_PER_WINDOW {
            let available_at = limits
                .oldest
                .map(|o| (o + COMMEND_LIMIT_WINDOW).to_rfc3339());
            return Err(graphql_error(
                "RATE_LIMITED",
                format!(
                    "You've given {MAX_COMMENDS_PER_WINDOW} commends today. You can commend again \
                     at {}.",
                    available_at.unwrap_or_default()
                ),
            ));
        }

        sqlx::query!(
            r#"
                INSERT INTO game_commends (game_id, commender_id, commended_user_id)
                VALUES ($1, $2, $3)
            "#,
            game_id,
            commender_id.0,
            user_id.0,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to insert commend")?;
        increment_commend_count(&mut tx, user_id).await?;

        tx.commit().await.wrap_err("Failed to commit commend")?;

        // Best-effort: the commend is saved, so a failed publish only costs the recipient their
        // notification.
        if let Err(err) = ctx
            .data::<RedisPool>()?
            .publish(PublishedGameCommendMessage::CommendReceived {
                game_id,
                commender_id,
                commended_user_id: user_id,
            })
            .await
        {
            tracing::error!("failed to publish commend received message: {err:?}");
        }

        let feedback = repo.load_feedback(game_id, commender_id).await?;
        let commended_user = ctx
            .data::<DataLoader<UsersLoader>>()?
            .load_one(user_id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "User not found"))?;

        Ok(CommendPlayerPayload {
            feedback,
            commended_user,
        })
    }
}

/// Locks `giver`'s feedback until `conn`'s transaction ends, then checks the rules commending and
/// reporting share: the target is someone else, both of them played in the game (a canceled game
/// counts as not played), the game has results and its feedback window is still open, and the giver
/// hasn't already commended or reported the target in this game.
///
/// One lock per giver serializes all of that user's commends and reports, which is what makes
/// "commend or report, never both" and the commend limits hold under concurrent requests. Locking
/// per giver rather than per user row also means two players commending each other at the same
/// moment never wait on each other.
pub(crate) async fn lock_and_check_feedback(
    conn: &mut PgConnection,
    game_id: Uuid,
    giver: SbUserId,
    target: SbUserId,
) -> Result<()> {
    if giver == target {
        return Err(graphql_error(
            "BAD_REQUEST",
            "You can't commend or report yourself",
        ));
    }

    let lock_key = format!("game-feedback:{}", giver.0);
    sqlx::query!(
        r#"SELECT 1 AS "locked!" FROM pg_advisory_xact_lock(hashtextextended($1, 0))"#,
        lock_key,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to lock game feedback")?;

    let row = sqlx::query!(
        r#"
            SELECT
                g.start_time,
                g.game_length,
                EXISTS(
                    SELECT 1 FROM games_users WHERE game_id = g.id AND user_id = $2
                ) AS "giver_played!",
                EXISTS(
                    SELECT 1 FROM games_users WHERE game_id = g.id AND user_id = $3
                ) AS "target_played!",
                EXISTS(
                    SELECT 1 FROM game_commends
                    WHERE game_id = g.id AND commender_id = $2 AND commended_user_id = $3
                ) AS "commended!",
                EXISTS(
                    SELECT 1 FROM game_reports
                    WHERE game_id = g.id AND reporter_id = $2 AND reported_user_id = $3
                ) AS "reported!"
            FROM games g
            WHERE g.id = $1 AND g.canceled_at IS NULL
        "#,
        game_id,
        giver.0,
        target.0,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to check game feedback eligibility")?;

    let Some(row) = row.filter(|r| r.giver_played) else {
        return Err(graphql_error(
            "FORBIDDEN",
            "You can only commend or report players from a game you played in",
        ));
    };
    if !row.target_played {
        return Err(graphql_error(
            "BAD_REQUEST",
            "That player wasn't in this game",
        ));
    }
    match closes_at(row.start_time, row.game_length) {
        Some(closes_at) if Utc::now() < closes_at => {}
        _ => {
            return Err(graphql_error(
                "FEEDBACK_CLOSED",
                "Commends and reports for this game are closed",
            ));
        }
    }
    if row.commended {
        return Err(graphql_error(
            "ALREADY_COMMENDED",
            "You've already commended this player for this game",
        ));
    }
    if row.reported {
        return Err(graphql_error(
            "ALREADY_REPORTED",
            "You've already reported this player for this game",
        ));
    }

    Ok(())
}

/// When a game's feedback window closes, or `None` if the game has no results yet (`game_length` is
/// written together with them).
fn closes_at(start_time: DateTime<Utc>, game_length_ms: Option<i32>) -> Option<DateTime<Utc>> {
    game_length_ms
        .map(|ms| start_time + chrono::Duration::milliseconds(i64::from(ms)) + FEEDBACK_WINDOW)
}

struct CommendLimits {
    /// Commends given within the limit window.
    given: i64,
    /// The oldest of those, which is the next to age out.
    oldest: Option<DateTime<Utc>>,
    /// The latest commend to the target within the window, if a target was given.
    last_to_target: Option<DateTime<Utc>>,
}

async fn load_commend_limits(
    conn: &mut PgConnection,
    commender: SbUserId,
    target: Option<SbUserId>,
) -> eyre::Result<CommendLimits> {
    let since = Utc::now() - COMMEND_LIMIT_WINDOW;
    let row = sqlx::query!(
        r#"
            SELECT
                COUNT(*) AS "given!",
                MIN(created_at) AS oldest,
                MAX(created_at) FILTER (WHERE commended_user_id = $3) AS last_to_target
            FROM game_commends
            WHERE commender_id = $1 AND created_at > $2
        "#,
        commender.0,
        since,
        target.map(|t| t.0),
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to load commend limits")?;

    Ok(CommendLimits {
        given: row.given,
        oldest: row.oldest,
        last_to_target: row.last_to_target,
    })
}

pub struct GameCommendsRepo {
    db: PgPool,
}

impl GameCommendsRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    async fn load_feedback(&self, game_id: Uuid, user_id: SbUserId) -> eyre::Result<GameFeedback> {
        let mut conn = self
            .db
            .acquire()
            .await
            .wrap_err("Failed to acquire connection")?;

        let game = sqlx::query!(
            r#"
                SELECT
                    g.start_time,
                    g.game_length,
                    EXISTS(
                        SELECT 1 FROM games_users WHERE game_id = g.id AND user_id = $2
                    ) AS "played!"
                FROM games g
                WHERE g.id = $1 AND g.canceled_at IS NULL
            "#,
            game_id,
            user_id.0,
        )
        .fetch_optional(&mut *conn)
        .await
        .wrap_err("Failed to load game for feedback")?;
        let closes_at = game
            .filter(|g| g.played)
            .and_then(|g| closes_at(g.start_time, g.game_length));

        let given = sqlx::query!(
            r#"
                SELECT commended_user_id AS "user_id!: SbUserId", 'commend' AS "kind!"
                FROM game_commends
                WHERE game_id = $1 AND commender_id = $2
                UNION ALL
                SELECT reported_user_id AS "user_id!: SbUserId", 'report' AS "kind!"
                FROM game_reports
                WHERE game_id = $1 AND reporter_id = $2
            "#,
            game_id,
            user_id.0,
        )
        .fetch_all(&mut *conn)
        .await
        .wrap_err("Failed to load given feedback")?
        .into_iter()
        .map(|r| GivenGameFeedback {
            user_id: r.user_id,
            kind: if r.kind == "commend" {
                GameFeedbackKind::Commend
            } else {
                GameFeedbackKind::Report
            },
        })
        .collect();

        let limits = load_commend_limits(&mut conn, user_id, None).await?;
        let commends_remaining = (MAX_COMMENDS_PER_WINDOW - limits.given).max(0);
        let commends_available_at = if commends_remaining == 0 {
            limits.oldest.map(|o| o + COMMEND_LIMIT_WINDOW)
        } else {
            None
        };

        let since = Utc::now() - COMMEND_LIMIT_WINDOW;
        let recent_commends = sqlx::query!(
            r#"
                SELECT commended_user_id AS "user_id!: SbUserId", MAX(created_at) AS "last!"
                FROM game_commends
                WHERE commender_id = $1 AND created_at > $2
                    AND commended_user_id IN (SELECT user_id FROM games_users WHERE game_id = $3)
                GROUP BY commended_user_id
            "#,
            user_id.0,
            since,
            game_id,
        )
        .fetch_all(&mut *conn)
        .await
        .wrap_err("Failed to load recent commends")?
        .into_iter()
        .map(|r| RecentCommend {
            user_id: r.user_id,
            available_at: r.last + COMMEND_LIMIT_WINDOW,
        })
        .collect();

        Ok(GameFeedback {
            id: game_id,
            closes_at,
            given,
            // Bounded by MAX_COMMENDS_PER_WINDOW, so this can't truncate.
            commends_remaining: commends_remaining as i32,
            commends_available_at,
            recent_commends,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closes_at_is_game_end_plus_window() {
        let start = DateTime::parse_from_rfc3339("2026-09-25T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let expected = DateTime::parse_from_rfc3339("2026-09-26T10:12:30Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(closes_at(start, Some(750_000)), Some(expected));
    }

    #[test]
    fn closes_at_is_none_without_results() {
        assert_eq!(closes_at(Utc::now(), None), None);
    }
}
