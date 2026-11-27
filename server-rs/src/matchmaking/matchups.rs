//! Ranked records by race matchup, for a player and for the whole ladder.
//!
//! Both read tables the Node server rebuilds from `games` every hour (see
//! `server/lib/matchmaking/matchup-stats-models.ts`), so each request is a primary key prefix
//! scan over a handful of rows, however many games the player has.

use async_graphql::{Context, Object, Result, SimpleObject};
use color_eyre::eyre::Context as _;
use sqlx::PgPool;

use crate::matchmaking::MatchmakingType;
use crate::users::SbUserId;

#[derive(Default)]
pub struct MatchupsQuery;

#[Object]
impl MatchupsQuery {
    /// A player's record in each matchup they've played in a mode, from their own team's side,
    /// in one season or summed over all of them (`season_id` of `None`). Most played first.
    async fn user_matchups(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
        matchmaking_type: MatchmakingType,
        season_id: Option<i32>,
    ) -> Result<Vec<MatchupRecord>> {
        let db = ctx.data::<PgPool>()?;
        let rows = sqlx::query_as!(
            RecordRow,
            r#"
                SELECT races, opponent_races,
                    sum(wins)::integer AS "wins!", sum(losses)::integer AS "losses!"
                FROM user_matchup_stats
                WHERE user_id = $1 AND matchmaking_type = $2
                    AND ($3::integer IS NULL OR season_id = $3)
                GROUP BY races, opponent_races
            "#,
            user_id.0,
            matchmaking_type as MatchmakingType,
            season_id,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load user matchup stats")?;

        Ok(to_records(
            &format!("user:{}", user_id.0),
            matchmaking_type,
            season_id,
            rows,
        ))
    }

    /// The whole ladder's record in each matchup of a mode, in one season or summed over all of
    /// them. Every game counts once from each team's side, so `p` against `z` and `z` against `p`
    /// are both present, and a mirror's wins always equal its losses (each is its game count).
    /// Most played first.
    async fn ladder_matchups(
        &self,
        ctx: &Context<'_>,
        matchmaking_type: MatchmakingType,
        season_id: Option<i32>,
    ) -> Result<Vec<MatchupRecord>> {
        let db = ctx.data::<PgPool>()?;
        let rows = sqlx::query_as!(
            RecordRow,
            r#"
                SELECT races, opponent_races,
                    sum(wins)::integer AS "wins!", sum(losses)::integer AS "losses!"
                FROM ladder_matchup_stats
                WHERE matchmaking_type = $1 AND ($2::integer IS NULL OR season_id = $2)
                GROUP BY races, opponent_races
            "#,
            matchmaking_type as MatchmakingType,
            season_id,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load ladder matchup stats")?;

        Ok(to_records("ladder", matchmaking_type, season_id, rows))
    }
}

/// A record in one matchup: `races` against `opponent_races`, each one team's races sorted
/// (e.g. `p`, `pt`). Counts ranked games of at least 2 minutes with a clear winner.
#[derive(SimpleObject, Debug, Clone, PartialEq, Eq)]
pub struct MatchupRecord {
    /// Unique across every scope, mode, season and matchup.
    pub id: String,
    pub races: String,
    pub opponent_races: String,
    pub wins: i32,
    pub losses: i32,
}

#[derive(Debug, Clone)]
struct RecordRow {
    races: String,
    opponent_races: String,
    wins: i32,
    losses: i32,
}

fn to_records(
    scope: &str,
    matchmaking_type: MatchmakingType,
    season_id: Option<i32>,
    rows: Vec<RecordRow>,
) -> Vec<MatchupRecord> {
    let season = season_id.map_or_else(|| "all".to_string(), |s| s.to_string());
    let mode = matchmaking_type.as_str();
    let mut records = rows
        .into_iter()
        .map(|row| MatchupRecord {
            id: format!(
                "{scope}:{mode}:{season}:{}-{}",
                row.races, row.opponent_races
            ),
            races: row.races,
            opponent_races: row.opponent_races,
            wins: row.wins,
            losses: row.losses,
        })
        .collect::<Vec<_>>();
    records.sort_by(|a, b| {
        (b.wins + b.losses)
            .cmp(&(a.wins + a.losses))
            .then_with(|| a.races.cmp(&b.races))
            .then_with(|| a.opponent_races.cmp(&b.opponent_races))
    });
    records
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(races: &str, opponent_races: &str, wins: i32, losses: i32) -> RecordRow {
        RecordRow {
            races: races.to_string(),
            opponent_races: opponent_races.to_string(),
            wins,
            losses,
        }
    }

    #[test]
    fn records_are_most_played_first_with_stable_ids() {
        let records = to_records(
            "ladder",
            MatchmakingType::Match1v1,
            Some(4),
            vec![
                row("p", "t", 1, 1),
                row("p", "z", 3, 2),
                row("p", "p", 1, 1),
            ],
        );
        let order = records
            .iter()
            .map(|r| (r.races.as_str(), r.opponent_races.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(order, vec![("p", "z"), ("p", "p"), ("p", "t")]);
        assert_eq!(records[0].id, "ladder:1v1:4:p-z");
    }

    #[test]
    fn summed_seasons_are_marked_in_the_id() {
        let records = to_records(
            "user:7",
            MatchmakingType::Match2v2,
            None,
            vec![row("pt", "zz", 2, 0)],
        );
        assert_eq!(records[0].id, "user:7:2v2:all:pt-zz");
    }
}
