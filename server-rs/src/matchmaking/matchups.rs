//! Race-matchup records for a user in a solo matchmaking mode, for the profile stats page.
//!
//! `games.assigned_matchup` is canonical and side-agnostic — [`computeMatchupString`] sorts the
//! races within each team and then sorts the teams, so `p-z` and `z-p` are the same string. That
//! makes it useless on its own for "how do *I* do against Zerg": it says which two races met, not
//! which side the viewer was on.
//!
//! For a solo mode that ambiguity resolves completely: `games_users.assigned_race` is the viewer's
//! race, and the other letter of the pair is necessarily the opponent's. For a team mode it does
//! not — in `pt-pz` a player who went Protoss could be on either team — which needs team membership
//! that `games_users` doesn't record. So this serves solo modes only and rejects the rest rather
//! than guessing.
//!
//! The set of games comes from `matchmaking_rating_changes` rather than from `games.config`.
//! Its primary key is `(user_id, matchmaking_type, game_id)`, so "this user's games in this mode"
//! is an index prefix scan; identifying matchmaking games through the config jsonb instead would
//! mean fetching a wide row for every game the user has ever played.

use std::collections::HashMap;

use async_graphql::{Context, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::Context as _;
use sqlx::PgPool;

use crate::games::AssignedRace;
use crate::maps::SbMapId;
use crate::matchmaking::MatchmakingType;
use crate::matchmaking::history::{MatchmakingSeason, fetch_seasons, season_for};
use crate::users::SbUserId;

#[derive(Default)]
pub struct MatchmakingMatchupsQuery;

#[Object]
impl MatchmakingMatchupsQuery {
    /// A user's record split by race matchup, for one solo matchmaking mode.
    ///
    /// Returned as flat buckets keyed by season, map and the two races rather than as a
    /// pre-aggregated matrix: the page filters by season and by map, and every such filter is a
    /// sum over a subset of these buckets. Sending them once lets the filters resolve locally
    /// instead of re-querying, and the bucket count is bounded by seasons x maps x 9 rather than
    /// by games played, so it doesn't grow with the length of an account's history.
    ///
    /// Errors for team modes, whose matchup strings can't say which side the player was on.
    async fn user_matchup_stats(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
        matchmaking_type: MatchmakingType,
    ) -> Result<MatchupStats> {
        if matchmaking_type.team_size() != 1 {
            return Err(async_graphql::Error::new(format!(
                "{} is a team mode; matchup stats are only available for solo modes",
                matchmaking_type.as_str()
            )));
        }

        let db = ctx.data::<PgPool>()?;
        let seasons = fetch_seasons(db)
            .await
            .wrap_err("Failed to fetch matchmaking seasons")?;

        // `assigned_race` and `assigned_matchup` are both written at result reconciliation, so a
        // game that has one has the other. They're filtered in SQL anyway rather than left to the
        // parsing below, so an unreconciled or pre-backfill game never reaches `total_games` --
        // a game nobody can attribute to a matchup shouldn't be counted in the denominator.
        let rows = sqlx::query!(
            r#"
                SELECT
                    g.map_id AS "map_id!: SbMapId",
                    m.name AS "map_name!",
                    mrc.change_date AT TIME ZONE 'UTC' AS "change_date!: DateTime<Utc>",
                    gu.assigned_race::text AS "assigned_race!",
                    g.assigned_matchup AS "assigned_matchup!",
                    mrc.outcome::text AS "outcome!"
                FROM matchmaking_rating_changes mrc
                JOIN games g ON g.id = mrc.game_id
                JOIN games_users gu ON gu.game_id = mrc.game_id AND gu.user_id = mrc.user_id
                JOIN uploaded_maps m ON m.id = g.map_id
                WHERE mrc.user_id = $1
                    AND mrc.matchmaking_type = $2
                    AND gu.assigned_race IS NOT NULL
                    AND g.assigned_matchup IS NOT NULL
            "#,
            user_id.0,
            matchmaking_type as MatchmakingType,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch matchup stats")?;

        let rows = rows
            .into_iter()
            .map(|row| MatchupRow {
                map_id: row.map_id,
                map_name: row.map_name,
                change_date: row.change_date,
                assigned_race: row.assigned_race,
                assigned_matchup: row.assigned_matchup,
                outcome: row.outcome,
            })
            .collect();

        Ok(aggregate(rows, &seasons, matchmaking_type))
    }
}

/// One reconciled game, as the aggregation reads it. Values stay as the database spelled them so
/// that parsing — and the decisions about what to drop — all happen in one tested place.
#[derive(Debug, Clone)]
struct MatchupRow {
    map_id: SbMapId,
    map_name: String,
    change_date: DateTime<Utc>,
    assigned_race: String,
    assigned_matchup: String,
    outcome: String,
}

/// Folds per-game rows into per-(season, map, matchup) buckets.
///
/// A row whose race and matchup can't be reconciled is dropped rather than counted, including
/// from `total_games`: it can't be placed in any cell, so counting it would make the buckets
/// fail to sum to the total the page displays.
fn aggregate(
    rows: Vec<MatchupRow>,
    seasons: &[MatchmakingSeason],
    matchmaking_type: MatchmakingType,
) -> MatchupStats {
    let mut counts: HashMap<BucketKey, MutableBucket> = HashMap::new();
    let mut map_names: HashMap<SbMapId, String> = HashMap::new();
    let mut total_games = 0i32;

    for row in rows {
        let Some(race) = parse_race(&row.assigned_race) else {
            continue;
        };
        let Some(opponent_race) = solo_opponent(&row.assigned_matchup, race) else {
            continue;
        };

        total_games += 1;
        map_names.entry(row.map_id).or_insert(row.map_name);

        let bucket = counts
            .entry(BucketKey {
                season_id: season_for(seasons, row.change_date),
                map_id: row.map_id,
                race,
                opponent_race,
            })
            .or_default();
        bucket.games += 1;
        if row.outcome == "win" {
            bucket.wins += 1;
        }
    }

    let mut buckets: Vec<MatchupBucket> = counts
        .into_iter()
        .map(|(key, value)| MatchupBucket {
            season_id: key.season_id,
            map_id: key.map_id,
            race: key.race,
            opponent_race: key.opponent_race,
            games: value.games,
            wins: value.wins,
        })
        .collect();
    // A stable order so the payload doesn't churn between requests for the same data, which
    // would defeat client-side caching and make responses pointlessly hard to diff. HashMap
    // iteration order is arbitrary and varies run to run, so this isn't cosmetic.
    buckets.sort_unstable_by_key(|b| {
        (
            b.season_id,
            b.map_id.0,
            race_order(b.race),
            race_order(b.opponent_race),
        )
    });

    // By name, since that's how the map filter lists them.
    let mut maps: Vec<MatchupMap> = map_names
        .into_iter()
        .map(|(id, name)| MatchupMap { id, name })
        .collect();
    maps.sort_unstable_by(|a, b| a.name.cmp(&b.name).then(a.id.0.cmp(&b.id.0)));

    MatchupStats {
        matchmaking_type,
        total_games,
        buckets,
        maps,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct BucketKey {
    season_id: i32,
    map_id: SbMapId,
    race: AssignedRace,
    opponent_race: AssignedRace,
}

#[derive(Debug, Default, Clone, Copy)]
struct MutableBucket {
    games: i32,
    wins: i32,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct MatchupBucket {
    /// The season the games fell in, derived from each game's `change_date` the same way the
    /// rating history derives it.
    pub season_id: i32,
    pub map_id: SbMapId,
    /// The race the viewed player was assigned, after random is resolved.
    pub race: AssignedRace,
    pub opponent_race: AssignedRace,
    pub games: i32,
    /// Wins out of `games`. Matchmaking records only wins and losses, so `games - wins` is the
    /// loss count exactly.
    pub wins: i32,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct MatchupMap {
    pub id: SbMapId,
    pub name: String,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct MatchupStats {
    pub matchmaking_type: MatchmakingType,
    /// Games attributed to a matchup, which is the sum of every bucket's `games`. Lower than the
    /// mode's total game count where a game predates the matchup backfill.
    pub total_games: i32,
    pub buckets: Vec<MatchupBucket>,
    /// Every map appearing in `buckets`, so the page's map filter can label itself without a
    /// second request and without the name being repeated on each bucket.
    pub maps: Vec<MatchupMap>,
}

fn parse_race(race: &str) -> Option<AssignedRace> {
    match race {
        "z" => Some(AssignedRace::Zerg),
        "t" => Some(AssignedRace::Terran),
        "p" => Some(AssignedRace::Protoss),
        // 'r' is never stored here -- `assigned_race` is written at reconciliation and is the
        // race actually played -- so this is unreachable rather than a case with a meaning.
        _ => None,
    }
}

/// Display and sort order for the matrix axes: Terran, Protoss, Zerg, the conventional listing
/// for Brood War rather than alphabetical.
fn race_order(race: AssignedRace) -> u8 {
    match race {
        AssignedRace::Terran => 0,
        AssignedRace::Protoss => 1,
        AssignedRace::Zerg => 2,
    }
}

/// The opponent's race in a solo game, given the canonical matchup string and the viewer's own
/// assigned race.
///
/// Returns `None` when the pair doesn't contain the viewer's race, which would mean
/// `assigned_matchup` and `assigned_race` disagree about the same game. That shouldn't happen —
/// both are written from the same reconciled results — but a mismatch is better dropped than
/// attributed to whichever race happens to be on the left.
fn solo_opponent(assigned_matchup: &str, race: AssignedRace) -> Option<AssignedRace> {
    let (left, right) = assigned_matchup.split_once('-')?;
    let left = parse_race(left)?;
    let right = parse_race(right)?;

    // Mirrors take the first branch and yield the same race, which is correct: in `p-p` the
    // opponent is Protoss.
    if left == race {
        Some(right)
    } else if right == race {
        Some(left)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    const MAP_A: Uuid = Uuid::from_u128(0x1111_1111);
    const MAP_B: Uuid = Uuid::from_u128(0x2222_2222);

    fn seasons() -> Vec<MatchmakingSeason> {
        vec![
            MatchmakingSeason {
                id: 1,
                name: "Season 1".into(),
                start_date: DateTime::from_timestamp(0, 0).unwrap(),
                reset_mmr: true,
            },
            MatchmakingSeason {
                id: 2,
                name: "Season 2".into(),
                start_date: DateTime::from_timestamp(10_000, 0).unwrap(),
                reset_mmr: false,
            },
        ]
    }

    fn row(secs: i64, map: Uuid, race: &str, matchup: &str, outcome: &str) -> MatchupRow {
        MatchupRow {
            map_id: SbMapId(map),
            map_name: if map == MAP_A { "Zzz A" } else { "Aaa B" }.into(),
            change_date: DateTime::from_timestamp(secs, 0).unwrap(),
            assigned_race: race.into(),
            assigned_matchup: matchup.into(),
            outcome: outcome.into(),
        }
    }

    #[test]
    fn aggregate_groups_by_season_map_and_matchup() {
        // Mirrors the fixture used to check the SQL: the same PvZ cell twice on one map, the
        // reverse cell from the other side, a mirror, and a game in a later season on a
        // different map.
        let stats = aggregate(
            vec![
                row(100, MAP_A, "p", "p-z", "win"),
                row(200, MAP_A, "z", "p-z", "loss"),
                row(300, MAP_A, "p", "p-z", "loss"),
                row(400, MAP_A, "p", "p-p", "win"),
                row(20_000, MAP_B, "t", "t-z", "win"),
            ],
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 5);
        assert_eq!(stats.buckets.len(), 4);

        let find = |season: i32, race, opponent| {
            stats
                .buckets
                .iter()
                .find(|b| b.season_id == season && b.race == race && b.opponent_race == opponent)
                .unwrap_or_else(|| panic!("no bucket for season {season} {race:?}v{opponent:?}"))
        };

        // The two PvZ games collapse into one cell; the ZvP game is a different cell, not the
        // same one counted from the other side.
        let pvz = find(1, AssignedRace::Protoss, AssignedRace::Zerg);
        assert_eq!((pvz.games, pvz.wins), (2, 1));
        let zvp = find(1, AssignedRace::Zerg, AssignedRace::Protoss);
        assert_eq!((zvp.games, zvp.wins), (1, 0));
        let mirror = find(1, AssignedRace::Protoss, AssignedRace::Protoss);
        assert_eq!((mirror.games, mirror.wins), (1, 1));

        // Later season, and its own map.
        let tvz = find(2, AssignedRace::Terran, AssignedRace::Zerg);
        assert_eq!((tvz.games, tvz.wins), (1, 1));
        assert_eq!(tvz.map_id, SbMapId(MAP_B));
    }

    #[test]
    fn aggregate_drops_rows_it_cannot_place_including_from_the_total() {
        // The page shows `totalGames` above a matrix built from the buckets. If a row that no
        // cell can hold still counted toward the total, the matrix would silently fail to sum
        // to the number printed above it.
        let stats = aggregate(
            vec![
                row(100, MAP_A, "p", "p-z", "win"),
                // Race and matchup disagree -- belongs to no cell.
                row(200, MAP_A, "t", "p-z", "win"),
                // A team matchup, which shouldn't reach here at all.
                row(300, MAP_A, "p", "pt-pz", "win"),
                // 'r' is never stored as an assigned race.
                row(400, MAP_A, "r", "p-z", "win"),
            ],
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 1);
        assert_eq!(stats.buckets.len(), 1);
        assert_eq!(stats.buckets[0].games, 1);
    }

    #[test]
    fn aggregate_orders_buckets_and_maps_deterministically() {
        // HashMap iteration order varies between runs, so without the sorts the payload would
        // differ for identical data.
        let rows = vec![
            row(20_000, MAP_B, "z", "p-z", "win"),
            row(100, MAP_A, "z", "z-z", "win"),
            row(100, MAP_A, "t", "t-z", "win"),
            row(100, MAP_A, "p", "p-z", "loss"),
        ];
        let first = aggregate(rows.clone(), &seasons(), MatchmakingType::Match1v1);
        let second = aggregate(rows, &seasons(), MatchmakingType::Match1v1);

        let key = |s: &MatchupStats| {
            s.buckets
                .iter()
                .map(|b| (b.season_id, b.map_id.0, race_order(b.race)))
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&first), key(&second));

        // Seasons ascending, then TPZ within a season rather than alphabetical.
        assert_eq!(
            key(&first),
            vec![
                (1, MAP_A, race_order(AssignedRace::Terran)),
                (1, MAP_A, race_order(AssignedRace::Protoss)),
                (1, MAP_A, race_order(AssignedRace::Zerg)),
                (2, MAP_B, race_order(AssignedRace::Zerg)),
            ]
        );

        // Maps are listed by name, which is not their insertion or id order here.
        assert_eq!(
            first
                .maps
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Aaa B", "Zzz A"]
        );
    }

    #[test]
    fn aggregate_handles_an_empty_history() {
        let stats = aggregate(Vec::new(), &seasons(), MatchmakingType::Match1v1);
        assert_eq!(stats.total_games, 0);
        assert!(stats.buckets.is_empty());
        assert!(stats.maps.is_empty());
    }

    #[test]
    fn solo_opponent_reads_the_other_side() {
        assert_eq!(
            solo_opponent("p-z", AssignedRace::Protoss),
            Some(AssignedRace::Zerg)
        );
        // The viewer is on the right of the canonical string here, since it sorts its teams.
        assert_eq!(
            solo_opponent("p-z", AssignedRace::Zerg),
            Some(AssignedRace::Protoss)
        );
        assert_eq!(
            solo_opponent("t-z", AssignedRace::Terran),
            Some(AssignedRace::Zerg)
        );
    }

    #[test]
    fn solo_opponent_handles_mirrors() {
        assert_eq!(
            solo_opponent("p-p", AssignedRace::Protoss),
            Some(AssignedRace::Protoss)
        );
        assert_eq!(
            solo_opponent("z-z", AssignedRace::Zerg),
            Some(AssignedRace::Zerg)
        );
    }

    #[test]
    fn solo_opponent_rejects_a_matchup_the_player_isnt_in() {
        // `assigned_matchup` and `assigned_race` disagreeing means one of them is wrong about
        // this game; attributing it to Protoss or Zerg would invent a record either way.
        assert_eq!(solo_opponent("p-z", AssignedRace::Terran), None);
    }

    #[test]
    fn solo_opponent_rejects_team_and_malformed_matchups() {
        // A team matchup reaching here would be a mode-filtering bug, and `pt` is not a race.
        assert_eq!(solo_opponent("pt-pz", AssignedRace::Protoss), None);
        assert_eq!(solo_opponent("p", AssignedRace::Protoss), None);
        assert_eq!(solo_opponent("", AssignedRace::Protoss), None);
        assert_eq!(solo_opponent("p-", AssignedRace::Protoss), None);
        assert_eq!(solo_opponent("p-r", AssignedRace::Protoss), None);
    }

    #[test]
    fn every_race_pairing_resolves() {
        // Each of the nine cells the matrix draws has to be reachable, mirrors included.
        let races = [
            AssignedRace::Terran,
            AssignedRace::Protoss,
            AssignedRace::Zerg,
        ];
        let letter = |r: AssignedRace| match r {
            AssignedRace::Terran => "t",
            AssignedRace::Protoss => "p",
            AssignedRace::Zerg => "z",
        };

        for mine in races {
            for theirs in races {
                // Canonical form sorts the two races, which is what the column stores.
                let mut pair = [letter(mine), letter(theirs)];
                pair.sort_unstable();
                let matchup = format!("{}-{}", pair[0], pair[1]);
                assert_eq!(
                    solo_opponent(&matchup, mine),
                    Some(theirs),
                    "{matchup} from {mine:?} should face {theirs:?}",
                );
            }
        }
    }
}
