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
//! Team support is expected once #1269 settles how team ordering is stored, so everything except
//! the one step that needs it is already size-agnostic:
//!
//! - [`parse_sides`] reads a side as a composition, so `pt-pz` parses exactly as `p-z` does.
//! - [`MatchupBucket`] carries a *list* of races per side, so a 2v2 cell needs no schema change —
//!   which also matches the client's matrix, whose axes are already keyed by composition.
//! - Bucketing, ordering, map handling and the drop rules never look at how many races a side has.
//!
//! What's left for team modes is [`viewer_sides`] — picking which side was the viewer's — plus the
//! column it would read to do so, and lifting the mode gate.
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
    /// Returned as flat buckets keyed by season, map and the two sides rather than as a
    /// pre-aggregated matrix: the page filters by season and by map, and every such filter is a
    /// sum over a subset of these buckets. Sending them once lets the filters resolve locally
    /// instead of re-querying, and the bucket count is bounded by seasons x maps x cells rather
    /// than by games played, so it doesn't grow with the length of an account's history.
    ///
    /// Errors for team modes, whose matchup strings can't say which side the player was on. The
    /// error is deliberately loud: a team mode silently returning an empty matrix would look like
    /// a player with no games rather than like a mode that isn't supported yet.
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
        let Some((races, opponent_races)) = viewer_sides(&row.assigned_matchup, race) else {
            continue;
        };

        total_games += 1;
        map_names.entry(row.map_id).or_insert(row.map_name);

        let bucket = counts
            .entry(BucketKey {
                season_id: season_for(seasons, row.change_date),
                map_id: row.map_id,
                races,
                opponent_races,
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
            races: key.races,
            opponent_races: key.opponent_races,
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
            side_order(&b.races),
            side_order(&b.opponent_races),
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BucketKey {
    season_id: i32,
    map_id: SbMapId,
    races: Vec<AssignedRace>,
    opponent_races: Vec<AssignedRace>,
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
    /// The races on the viewed player's side, after random is resolved, alphabetical within the
    /// side exactly as `assigned_matchup` stores them.
    ///
    /// A list rather than a single race because a side is a team composition in every mode but
    /// this one: 2v2 cells are `tp` against `pz` and so on, and the client's matrix already keys
    /// its axes by composition. For a solo mode it always holds exactly one race.
    pub races: Vec<AssignedRace>,
    /// The opposing side's composition, same encoding as `races`.
    pub opponent_races: Vec<AssignedRace>,
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

/// The races on one side of a matchup string, e.g. `pt` -> `[Protoss, Terran]`.
///
/// Order is left as `computeMatchupString` wrote it, which is alphabetical within a team. That's
/// what makes a side comparable to any other side by value, and it's the order the buckets carry
/// on the wire.
fn parse_side(side: &str) -> Option<Vec<AssignedRace>> {
    if side.is_empty() {
        return None;
    }
    side.chars()
        .map(|c| parse_race(c.encode_utf8(&mut [0u8; 4])))
        .collect()
}

/// Both sides of a canonical matchup string, in the order it stores them.
///
/// Size-agnostic on purpose: `pt-pz` parses here exactly as `p-z` does. Only picking *which* side
/// the viewer was on is mode-specific, and that's [`viewer_sides`].
fn parse_sides(assigned_matchup: &str) -> Option<(Vec<AssignedRace>, Vec<AssignedRace>)> {
    let (left, right) = assigned_matchup.split_once('-')?;
    // Exactly two sides. A string with a second `-` isn't a matchup this code understands.
    if right.contains('-') {
        return None;
    }
    Some((parse_side(left)?, parse_side(right)?))
}

/// The viewer's side and their opponent's, as `(own, opponent)`.
///
/// This is the one mode-specific step, and the seam team modes will extend. For a solo mode the
/// viewer's own race identifies their side, because each side holds exactly one race. For a team
/// mode it cannot — in `pt-pz` a Protoss player sits on both sides — so team membership has to
/// come from the row instead, which `games_users` does not yet record. Team support is therefore
/// an added branch here plus a column on the query, not a change to any of the parsing,
/// bucketing, or wire format around it.
///
/// Returns `None` when the viewer's race isn't in the matchup at all, which would mean
/// `assigned_matchup` and `assigned_race` disagree about the same game. That shouldn't happen —
/// both are written from the same reconciled results — but a mismatch is better dropped than
/// attributed to whichever side happens to be on the left.
fn viewer_sides(
    assigned_matchup: &str,
    race: AssignedRace,
) -> Option<(Vec<AssignedRace>, Vec<AssignedRace>)> {
    let (left, right) = parse_sides(assigned_matchup)?;
    // Solo only: a side that isn't exactly one race can't be attributed by race alone, and
    // guessing is what this returns `None` to avoid.
    if left.len() != 1 || right.len() != 1 {
        return None;
    }

    // Mirrors take the first branch and yield the same race on both sides, which is correct: in
    // `p-p` the opponent is Protoss.
    if left[0] == race {
        Some((left, right))
    } else if right[0] == race {
        Some((right, left))
    } else {
        None
    }
}

/// Sort key for a side: its races in TPZ order. Compositions of different sizes never share a
/// matrix, so comparing them by sequence is only ever exercised within one mode.
fn side_order(side: &[AssignedRace]) -> Vec<u8> {
    side.iter().copied().map(race_order).collect()
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
                .find(|b| {
                    b.season_id == season
                        && b.races == vec![race]
                        && b.opponent_races == vec![opponent]
                })
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
                .map(|b| (b.season_id, b.map_id.0, side_order(&b.races)))
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&first), key(&second));

        // Seasons ascending, then TPZ within a season rather than alphabetical.
        assert_eq!(
            key(&first),
            vec![
                (1, MAP_A, vec![race_order(AssignedRace::Terran)]),
                (1, MAP_A, vec![race_order(AssignedRace::Protoss)]),
                (1, MAP_A, vec![race_order(AssignedRace::Zerg)]),
                (2, MAP_B, vec![race_order(AssignedRace::Zerg)]),
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

    const T: AssignedRace = AssignedRace::Terran;
    const P: AssignedRace = AssignedRace::Protoss;
    const Z: AssignedRace = AssignedRace::Zerg;

    #[test]
    fn viewer_sides_reads_the_other_side() {
        assert_eq!(viewer_sides("p-z", P), Some((vec![P], vec![Z])));
        // The viewer is on the right of the canonical string here, since it sorts its teams.
        assert_eq!(viewer_sides("p-z", Z), Some((vec![Z], vec![P])));
        assert_eq!(viewer_sides("t-z", T), Some((vec![T], vec![Z])));
    }

    #[test]
    fn viewer_sides_handles_mirrors() {
        assert_eq!(viewer_sides("p-p", P), Some((vec![P], vec![P])));
        assert_eq!(viewer_sides("z-z", Z), Some((vec![Z], vec![Z])));
    }

    #[test]
    fn viewer_sides_rejects_a_matchup_the_player_isnt_in() {
        // `assigned_matchup` and `assigned_race` disagreeing means one of them is wrong about
        // this game; attributing it to Protoss or Zerg would invent a record either way.
        assert_eq!(viewer_sides("p-z", T), None);
    }

    #[test]
    fn viewer_sides_rejects_team_matchups_rather_than_guessing() {
        // A Protoss player is on both sides of `pt-pz`, so race alone can't say which. This is
        // the case that needs team membership, and until it exists the answer is no answer.
        assert_eq!(viewer_sides("pt-pz", P), None);
        assert_eq!(viewer_sides("pt-pz", T), None);
        // Not even when the viewer's race appears on exactly one side -- the shape is what's
        // unsupported, not this particular string's ambiguity.
        assert_eq!(viewer_sides("pp-tz", Z), None);
    }

    #[test]
    fn viewer_sides_rejects_malformed_matchups() {
        assert_eq!(viewer_sides("p", P), None);
        assert_eq!(viewer_sides("", P), None);
        assert_eq!(viewer_sides("p-", P), None);
        assert_eq!(viewer_sides("-p", P), None);
        // Random is never stored as an assigned race.
        assert_eq!(viewer_sides("p-r", P), None);
    }

    #[test]
    fn every_race_pairing_resolves() {
        // Each of the nine cells the matrix draws has to be reachable, mirrors included.
        let letter = |r: AssignedRace| match r {
            T => "t",
            P => "p",
            Z => "z",
        };

        for mine in [T, P, Z] {
            for theirs in [T, P, Z] {
                // Canonical form sorts the two races, which is what the column stores.
                let mut pair = [letter(mine), letter(theirs)];
                pair.sort_unstable();
                let matchup = format!("{}-{}", pair[0], pair[1]);
                assert_eq!(
                    viewer_sides(&matchup, mine),
                    Some((vec![mine], vec![theirs])),
                    "{matchup} from {mine:?} should face {theirs:?}",
                );
            }
        }
    }

    // ---- Readiness for team modes -------------------------------------------------------
    //
    // Parsing is deliberately size-agnostic, so that supporting team modes is a change to
    // `viewer_sides` (which side is the viewer's) rather than to how matchups are read at all.
    // These pin that down now, while the shape is easy to change, rather than discovering later
    // that the parsing baked in an assumption of one race per side.

    #[test]
    fn parse_sides_reads_team_compositions() {
        assert_eq!(parse_sides("pt-pz"), Some((vec![P, T], vec![P, Z])));
        assert_eq!(parse_sides("p-z"), Some((vec![P], vec![Z])));
        // 3v3, and a team mirror.
        assert_eq!(parse_sides("ptz-ptz"), Some((vec![P, T, Z], vec![P, T, Z])));
        // Uneven sides parse too: rejecting them is a mode decision, not a parsing one.
        assert_eq!(parse_sides("p-tz"), Some((vec![P], vec![T, Z])));
    }

    #[test]
    fn parse_sides_rejects_input_that_isnt_two_sides() {
        assert_eq!(parse_sides("ptz"), None);
        assert_eq!(parse_sides("p-t-z"), None);
        assert_eq!(parse_sides("pt-"), None);
        assert_eq!(parse_sides("px-tz"), None);
    }

    #[test]
    fn buckets_can_hold_team_compositions() {
        // The wire format is already a composition per side, so a 2v2 bucket needs no schema
        // change -- only a `viewer_sides` that can pick a side for a team mode.
        let bucket = MatchupBucket {
            season_id: 1,
            map_id: SbMapId(MAP_A),
            races: vec![P, T],
            opponent_races: vec![P, Z],
            games: 3,
            wins: 2,
        };
        assert_eq!(bucket.races.len(), 2);
        // Ordering generalizes to compositions rather than assuming a single race per side.
        assert_eq!(
            side_order(&bucket.races),
            vec![race_order(P), race_order(T)]
        );
    }
}
