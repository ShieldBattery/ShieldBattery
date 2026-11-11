//! The stats the overlay shows from what the app answers with: the card answering a `/stats`
//! command, and the roster of the other players that the roster's key holds up.

use hashbrown::HashMap;
use overlay_ui::observer::RaceView;
use overlay_ui::stats_card::{
    Division, MatchmakingMode, ModeStanding, Rank, RosterGroup, RosterPlayer, RosterRecord,
    RosterSide, RosterStats, RosterView, StatsCardContent, StatsCardView,
};

use crate::app_messages::{
    GameSetupInfo, MatchmakingDivision, MatchmakingType, StatsRace, UserStanding, UserStats,
    UserStatsPurpose, UserStatsResult,
};
use crate::bw_scr::chat::OtherPlayer;
use crate::game_thread::{GameThreadMessage, send_game_msg_to_async};

use super::{BwVars, alliances, is_active_player, player_teams, stats};

/// The card answering a `/stats` command.
pub(super) fn card_content(result: UserStatsResult) -> StatsCardContent {
    match result {
        UserStatsResult::Found(stats) => StatsCardContent::Stats(card_view(stats)),
        UserStatsResult::NotFound { name } => StatsCardContent::NotFound { name },
        UserStatsResult::Error { name } => StatsCardContent::Failed {
            name: (!name.is_empty()).then_some(name),
        },
    }
}

fn card_view(stats: UserStats) -> StatsCardView {
    StatsCardView {
        name: stats.name,
        main_race: stats.main_race.map(race_view),
        wins: stats.wins,
        losses: stats.losses,
        best: stats.best.and_then(mode_standing),
        current: stats.current.and_then(mode_standing),
    }
}

/// A standing the overlay can show, or `None` for one in a mode this build doesn't know.
fn mode_standing(standing: UserStanding) -> Option<ModeStanding> {
    Some(ModeStanding {
        mode: matchmaking_mode(standing.matchmaking_type)?,
        // A rating without a division is one whose division the app couldn't work out, which the
        // unrated emblem stands in for beside the rating.
        rank: standing.rating.map(|rating| Rank {
            division: standing.division.map_or(Division::Unrated, division),
            rating,
        }),
    })
}

fn matchmaking_mode(kind: MatchmakingType) -> Option<MatchmakingMode> {
    Some(match kind {
        MatchmakingType::OneVOne => MatchmakingMode::OneVOne,
        MatchmakingType::OneVOneFastest => MatchmakingMode::OneVOneFastest,
        MatchmakingType::TwoVTwo => MatchmakingMode::TwoVTwo,
        MatchmakingType::TwoVTwoBgh => MatchmakingMode::TwoVTwoBgh,
        MatchmakingType::TwoVTwoHunters => MatchmakingMode::TwoVTwoHunters,
        MatchmakingType::TwoVTwoFastest => MatchmakingMode::TwoVTwoFastest,
        MatchmakingType::ThreeVThreeBgh => MatchmakingMode::ThreeVThreeBgh,
        MatchmakingType::ThreeVThreeHunters => MatchmakingMode::ThreeVThreeHunters,
        MatchmakingType::ThreeVThreeFastest => MatchmakingMode::ThreeVThreeFastest,
        MatchmakingType::Unknown => return None,
    })
}

fn division(division: MatchmakingDivision) -> Division {
    match division {
        MatchmakingDivision::Unrated | MatchmakingDivision::Unknown => Division::Unrated,
        MatchmakingDivision::Bronze1 => Division::Bronze1,
        MatchmakingDivision::Bronze2 => Division::Bronze2,
        MatchmakingDivision::Bronze3 => Division::Bronze3,
        MatchmakingDivision::Silver1 => Division::Silver1,
        MatchmakingDivision::Silver2 => Division::Silver2,
        MatchmakingDivision::Silver3 => Division::Silver3,
        MatchmakingDivision::Gold1 => Division::Gold1,
        MatchmakingDivision::Gold2 => Division::Gold2,
        MatchmakingDivision::Gold3 => Division::Gold3,
        MatchmakingDivision::Platinum1 => Division::Platinum1,
        MatchmakingDivision::Platinum2 => Division::Platinum2,
        MatchmakingDivision::Platinum3 => Division::Platinum3,
        MatchmakingDivision::Diamond1 => Division::Diamond1,
        MatchmakingDivision::Diamond2 => Division::Diamond2,
        MatchmakingDivision::Diamond3 => Division::Diamond3,
        MatchmakingDivision::Champion => Division::Champion,
    }
}

fn race_view(race: StatsRace) -> RaceView {
    match race {
        StatsRace::Zerg => RaceView::Zerg,
        StatsRace::Terran => RaceView::Terran,
        StatsRace::Protoss => RaceView::Protoss,
        StatsRace::Random => RaceView::Random,
    }
}

/// The other players' stats, asked for the first time the roster is held up and kept for the rest
/// of the game: a player who never looks costs the server nothing, and one who looks again sees
/// them at once.
#[derive(Default)]
pub(super) struct RosterStatsCache {
    requested: bool,
    /// By name, lowercased: the app answers with the name as the user has it, which may differ in
    /// case from how it was asked for.
    stats: HashMap<String, RosterStats>,
    /// The game's matchmaking mode, as the first answer that had a standing in it said.
    mode: Option<MatchmakingMode>,
}

impl RosterStatsCache {
    /// Asks the app for the stats of each of `others`, unless it has been asked already.
    pub(super) fn request(&mut self, others: &[OtherPlayer]) {
        if std::mem::replace(&mut self.requested, true) {
            return;
        }
        for other in others {
            self.stats
                .insert(other.name.to_lowercase(), RosterStats::Loading);
            send_game_msg_to_async(GameThreadMessage::RequestUserStats {
                name: Some(other.name.clone()),
                purpose: UserStatsPurpose::Roster,
            });
        }
    }

    pub(super) fn received(&mut self, result: UserStatsResult) {
        let (name, stats) = match result {
            UserStatsResult::Found(stats) => {
                let current = stats.current.and_then(mode_standing);
                if let Some(current) = current {
                    self.mode = Some(current.mode);
                }
                // In a matchmaking game a row is about its mode, even for a player unranked in
                // it; outside one, about the player's best.
                let standing = current.or_else(|| stats.best.and_then(mode_standing));
                let record = RosterRecord {
                    main_race: stats.main_race.map(race_view),
                    wins: stats.wins,
                    losses: stats.losses,
                    standing,
                };
                (stats.name, RosterStats::Loaded(record))
            }
            UserStatsResult::NotFound { name } | UserStatsResult::Error { name } => {
                (name, RosterStats::Unavailable)
            }
        };
        self.stats.insert(name.to_lowercase(), stats);
    }

    fn stats_of(&self, name: &str) -> RosterStats {
        self.stats
            .get(&name.to_lowercase())
            .cloned()
            .unwrap_or(RosterStats::Loading)
    }
}

/// The roster of every other person playing the game, the local player's side first.
pub(super) fn build_roster(
    bw: &BwVars,
    setup: Option<&GameSetupInfo>,
    others: &[OtherPlayer],
    cache: &RosterStatsCache,
) -> RosterView {
    let teams = player_teams(bw);
    let local_team = teams
        .get(usize::from(bw.local_player_id))
        .copied()
        .unwrap_or(0);
    let mut allies = Vec::new();
    let mut opponents = Vec::new();
    for other in others {
        let Some(player_id) = other.player_id.map(|id| id.0) else {
            continue;
        };
        if usize::from(player_id) >= teams.len() || !is_active_player(bw, usize::from(player_id)) {
            continue;
        }
        let player = RosterPlayer {
            name: other.name.clone(),
            color: stats::player_color(bw, player_id),
            race: alliances::chosen_race(bw, setup, player_id),
            stats: cache.stats_of(&other.name),
        };
        if local_team != 0 && teams[usize::from(player_id)] == local_team {
            allies.push(player);
        } else {
            opponents.push(player);
        }
    }
    // By name rather than by slot: in melee a player's slot is their start location's index in
    // the map, so ordering by it would tell the player where each opponent spawned.
    for side in [&mut allies, &mut opponents] {
        side.sort_by_cached_key(|player| player.name.to_lowercase());
    }
    let groups = [
        (RosterSide::Allies, allies),
        (RosterSide::Opponents, opponents),
    ]
    .into_iter()
    .filter(|(_, players)| !players.is_empty())
    .map(|(side, players)| RosterGroup { side, players })
    .collect();
    RosterView {
        mode: cache.mode,
        groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standing(
        matchmaking_type: MatchmakingType,
        division: Option<MatchmakingDivision>,
        rating: Option<u32>,
    ) -> UserStanding {
        UserStanding {
            matchmaking_type,
            division,
            rating,
        }
    }

    fn found(name: &str, best: Option<UserStanding>, current: Option<UserStanding>) -> UserStats {
        UserStats {
            name: name.into(),
            main_race: Some(StatsRace::Zerg),
            wins: 10,
            losses: 4,
            best,
            current,
        }
    }

    #[test]
    fn a_failure_for_the_local_user_names_nobody() {
        assert_eq!(
            card_content(UserStatsResult::Error {
                name: String::new()
            }),
            StatsCardContent::Failed { name: None },
        );
        assert_eq!(
            card_content(UserStatsResult::Error {
                name: "tec27".into()
            }),
            StatsCardContent::Failed {
                name: Some("tec27".into())
            },
        );
    }

    #[test]
    fn a_rating_without_a_division_shows_as_unrated() {
        let StatsCardContent::Stats(view) = card_content(UserStatsResult::Found(found(
            "tec27",
            Some(standing(MatchmakingType::TwoVTwo, None, Some(1820))),
            None,
        ))) else {
            panic!("expected stats");
        };
        assert_eq!(
            view.best,
            Some(ModeStanding {
                mode: MatchmakingMode::TwoVTwo,
                rank: Some(Rank {
                    division: Division::Unrated,
                    rating: 1820,
                }),
            }),
        );
    }

    #[test]
    fn a_mode_this_build_does_not_know_is_left_out() {
        let StatsCardContent::Stats(view) = card_content(UserStatsResult::Found(found(
            "tec27",
            Some(standing(
                MatchmakingType::Unknown,
                Some(MatchmakingDivision::Gold1),
                Some(1700),
            )),
            None,
        ))) else {
            panic!("expected stats");
        };
        assert_eq!(view.best, None);
    }

    #[test]
    fn roster_rows_follow_the_games_mode_and_match_names_in_any_case() {
        let mut cache = RosterStatsCache::default();
        cache.received(UserStatsResult::Found(found(
            "Tec27",
            Some(standing(
                MatchmakingType::TwoVTwo,
                Some(MatchmakingDivision::Gold1),
                Some(1700),
            )),
            Some(standing(MatchmakingType::OneVOne, None, None)),
        )));
        assert_eq!(cache.mode, Some(MatchmakingMode::OneVOne));
        let RosterStats::Loaded(record) = cache.stats_of("tec27") else {
            panic!("expected stats");
        };
        assert_eq!(
            record.standing,
            Some(ModeStanding {
                mode: MatchmakingMode::OneVOne,
                rank: None,
            }),
        );
        assert_eq!(cache.stats_of("someone"), RosterStats::Loading);
    }

    #[test]
    fn roster_rows_outside_matchmaking_show_the_best_mode() {
        let mut cache = RosterStatsCache::default();
        let best = standing(
            MatchmakingType::TwoVTwo,
            Some(MatchmakingDivision::Gold1),
            Some(1700),
        );
        cache.received(UserStatsResult::Found(found("tec27", Some(best), None)));
        assert_eq!(cache.mode, None);
        let RosterStats::Loaded(record) = cache.stats_of("tec27") else {
            panic!("expected stats");
        };
        assert_eq!(record.standing, mode_standing(best));
        cache.received(UserStatsResult::NotFound {
            name: "ghost".into(),
        });
        assert_eq!(cache.stats_of("ghost"), RosterStats::Unavailable);
    }
}
