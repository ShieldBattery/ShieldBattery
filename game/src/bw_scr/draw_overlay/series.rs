//! The series a watched game is one of, as the observer panels show it.
//!
//! A lobby game launched while a series runs carries the series on its setup: a title, a format, the
//! game's number, and two sides naming their players by ShieldBattery user. The panels group players
//! by side, so in a series game every one of them takes the series' sides as the game's sides: the
//! matchup's halves, the scoreboard's rows, the corner cards and every panel ruled into teams follow
//! the series rather than whatever alliances the game itself has, and each side's score stands
//! beside that side's players.
//!
//! Which side each slot is on is worked out once, as soon as the game says which slot each user
//! ended up in. Whether the panels can show the series is checked each frame against the players
//! they show, which is a few comparisons over eight slots: every shown player has to be on a side,
//! and both sides have to have someone shown, or the series is left off and the game's own sides
//! stand.

use overlay_ui::observer::{SeriesFormat, SeriesView};

use super::{BwVars, is_active_player, shown_on_panels};
use crate::app_messages::{GameSetupInfo, SbUserId, SeriesOverlayFormat, SeriesOverlaySide};
use crate::bw::players::BwPlayerId;
use crate::game_thread;

/// The team number the series' first side takes, which the panels list first: on the left of the
/// bar, at the top of the scoreboard, and in the top-left card.
const FIRST_SIDE_TEAM: u8 = 1;

/// The team number a slot with no series side takes. Only a slot no panel shows is ever left
/// without one in a game whose series is shown, so it only has to be neither side's.
const NO_SIDE_TEAM: u8 = 3;

/// What the panels are told of the series for one frame.
pub(super) struct SeriesFrame {
    /// Each slot's side as the team number every panel groups by, standing in for the game's own.
    pub(super) teams: [u8; 8],
    pub(super) view: SeriesView,
}

/// The series as worked out for this game, kept for the rest of it.
#[derive(Default)]
pub(super) struct SeriesState {
    /// `None` until worked out, and then what there is to show: nothing for a game that is no
    /// series', or that is one the panels cannot show.
    resolved: Option<Option<ResolvedSeries>>,
    /// Whether the log has been told why a shown player left the series off, which it is told once
    /// a game rather than every frame.
    explained: bool,
}

struct ResolvedSeries {
    /// Which side (0 or 1) each slot is on, for the slots one could be found for.
    sides: [Option<u8>; 8],
    view: SeriesView,
}

impl SeriesState {
    /// What the panels show of the series this frame, for a client watching `bw` live. Nothing for a
    /// game that is no series', and nothing while the shown players are not two sides of it.
    pub(super) fn frame(
        &mut self,
        bw: &BwVars,
        setup: Option<&GameSetupInfo>,
    ) -> Option<SeriesFrame> {
        if self.resolved.is_none() {
            // Asked again next frame while the game has yet to say who ended up in which slot.
            self.resolved = Some(resolve(bw, setup?)?);
        }
        let resolved = self.resolved.as_ref()?.as_ref()?;
        let shown = (0..8u8)
            .filter(|&player_id| is_active_player(bw, usize::from(player_id)))
            .filter(|&player_id| shown_on_panels(bw, player_id));
        match series_teams(&resolved.sides, shown) {
            Ok(teams) => Some(SeriesFrame {
                teams,
                view: resolved.view.clone(),
            }),
            Err(why) => {
                if !self.explained {
                    self.explained = true;
                    info!("Not showing the series in the observer panels: {why}");
                }
                None
            }
        }
    }
}

/// Works out what there is to show of `setup`'s series, or `None` while the game has yet to say
/// which slot each user ended up in.
fn resolve(bw: &BwVars, setup: &GameSetupInfo) -> Option<Option<ResolvedSeries>> {
    let Some(series) = setup.series_overlay.as_ref().filter(|_| !setup.is_replay()) else {
        return Some(None);
    };
    let format = match series.format {
        SeriesOverlayFormat::BestOf { length } => SeriesFormat::BestOf { length },
        SeriesOverlayFormat::Unknown => {
            warn!("The game's series is in a format this build doesn't know; not showing it");
            return Some(None);
        }
    };
    let mapping = game_thread::player_id_mapping_if_set()?;
    let slots: Vec<Slot> = (0..8u8)
        .filter(|&player_id| is_active_player(bw, usize::from(player_id)))
        .map(|player_id| {
            let player = unsafe { &*bw.players.add(usize::from(player_id)) };
            Slot {
                player_id,
                computer: player.player_type == 1,
                game_team: player.team,
                user: mapping
                    .iter()
                    .find(|mapping| mapping.game_id == Some(BwPlayerId(player_id)))
                    .map(|mapping| mapping.sb_user_id),
            }
        })
        .collect();
    let sides = resolve_sides(&series.sides, &slots);
    info!(
        "Series for the observer panels: {:?}, {:?}, game {}, scores {}-{}, captions {:?}/{:?}, \
         slot sides {:?}",
        series.title,
        series.format,
        series.game_number,
        series.sides[0].score,
        series.sides[1].score,
        series.sides[0].caption,
        series.sides[1].caption,
        sides,
    );
    Some(Some(ResolvedSeries {
        sides,
        view: SeriesView {
            title: series.title.clone().filter(|title| !title.is_empty()),
            format,
            game_number: series.game_number,
            scores: series.sides.each_ref().map(|side| side.score),
        },
    }))
}

/// One of the game's active slots, as the series' sides are matched against it.
#[derive(Copy, Clone, Debug)]
struct Slot {
    player_id: u8,
    /// Whether the slot is played by the computer, which no series side names.
    computer: bool,
    /// The team the game type puts the slot on, which is zero in every slot of a game type that has
    /// no teams.
    game_team: u8,
    /// The ShieldBattery user playing the slot, where the game knows one.
    user: Option<SbUserId>,
}

/// Which side (0 or 1) each of `slots` is on.
///
/// A person is on the side that names them, and on no side where neither or both do. A computer is
/// named by no side, so it takes the side of the people its game type puts on its team, where the
/// game type has teams and those people are all on one side; anywhere else it is on no side.
fn resolve_sides(sides: &[SeriesOverlaySide; 2], slots: &[Slot]) -> [Option<u8>; 8] {
    let side_of = |user: SbUserId| {
        let mut naming = (0..2u8).filter(|&side| sides[usize::from(side)].players.contains(&user));
        match (naming.next(), naming.next()) {
            (Some(side), None) => Some(side),
            _ => None,
        }
    };
    let mut resolved = [None; 8];
    for slot in slots.iter().filter(|slot| !slot.computer) {
        if let Some(entry) = resolved.get_mut(usize::from(slot.player_id)) {
            *entry = slot.user.and_then(side_of);
        }
    }
    let game_has_teams = slots.iter().any(|slot| slot.game_team != 0);
    for slot in slots.iter().filter(|slot| slot.computer && game_has_teams) {
        let mut teammates = slots
            .iter()
            .filter(|other| !other.computer && other.game_team == slot.game_team)
            .map(|other| {
                resolved
                    .get(usize::from(other.player_id))
                    .copied()
                    .flatten()
            });
        let Some(first) = teammates.next().flatten() else {
            continue;
        };
        if teammates.all(|side| side == Some(first))
            && let Some(entry) = resolved.get_mut(usize::from(slot.player_id))
        {
            *entry = Some(first);
        }
    }
    resolved
}

/// Each slot's team for the panels in a game whose slots are on `sides`, given the slots the panels
/// `shown` this frame; or why the series cannot be shown, where a shown slot is on neither side or a
/// side has nobody shown.
fn series_teams(
    sides: &[Option<u8>; 8],
    shown: impl Iterator<Item = u8>,
) -> Result<[u8; 8], Unshowable> {
    let mut represented = [false; 2];
    for player_id in shown {
        match sides.get(usize::from(player_id)).copied().flatten() {
            Some(side) => represented[usize::from(side)] = true,
            None => return Err(Unshowable::PlayerOnNoSide { player_id }),
        }
    }
    if let Some(side) = represented.iter().position(|&shown| !shown) {
        return Err(Unshowable::SideUnshown {
            side: side as u8 + 1,
        });
    }
    Ok(sides.map(|side| side.map_or(NO_SIDE_TEAM, |side| FIRST_SIDE_TEAM + side)))
}

/// Why the panels cannot show a game's series this frame. Worded only when it is logged, which is
/// once a game, while the check that finds it runs every frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Unshowable {
    /// A slot the panels show is on neither of the series' sides.
    PlayerOnNoSide { player_id: u8 },
    /// One of the series' sides, counting from one, has nobody the panels show.
    SideUnshown { side: u8 },
}

impl std::fmt::Display for Unshowable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unshowable::PlayerOnNoSide { player_id } => {
                write!(f, "player {player_id} is on neither of its sides")
            }
            Unshowable::SideUnshown { side } => write!(f, "side {side} has no player in the game"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side(players: &[u32]) -> SeriesOverlaySide {
        SeriesOverlaySide {
            caption: None,
            score: 0,
            players: players.iter().map(|&id| SbUserId(id)).collect(),
        }
    }

    fn person(player_id: u8, game_team: u8, user: u32) -> Slot {
        Slot {
            player_id,
            computer: false,
            game_team,
            user: Some(SbUserId(user)),
        }
    }

    fn computer(player_id: u8, game_team: u8) -> Slot {
        Slot {
            player_id,
            computer: true,
            game_team,
            user: None,
        }
    }

    #[test]
    fn people_are_on_the_side_that_names_them_wherever_the_game_seated_them() {
        let sides = [side(&[10, 11]), side(&[20, 21])];
        // Seated across each other's lobby teams, which the series' sides outrank.
        let slots = [
            person(0, 0, 20),
            person(1, 0, 10),
            person(4, 0, 21),
            person(5, 0, 11),
        ];
        let resolved = resolve_sides(&sides, &slots);
        assert_eq!(
            resolved,
            [Some(1), Some(0), None, None, Some(1), Some(0), None, None]
        );
    }

    #[test]
    fn a_person_named_by_neither_side_or_by_both_is_on_no_side() {
        let sides = [side(&[10, 30]), side(&[20, 30])];
        let slots = [
            person(0, 0, 10),
            person(1, 0, 20),
            person(2, 0, 30),
            person(3, 0, 40),
        ];
        let resolved = resolve_sides(&sides, &slots);
        assert_eq!(&resolved[..4], &[Some(0), Some(1), None, None]);
    }

    #[test]
    fn a_computer_takes_the_side_of_the_people_on_its_team() {
        let sides = [side(&[10]), side(&[20])];
        let slots = [
            person(0, 1, 10),
            computer(1, 1),
            person(2, 2, 20),
            computer(3, 2),
        ];
        let resolved = resolve_sides(&sides, &slots);
        assert_eq!(&resolved[..4], &[Some(0), Some(0), Some(1), Some(1)]);
    }

    #[test]
    fn a_computer_is_on_no_side_without_teams_or_with_a_team_split_between_sides() {
        let sides = [side(&[10, 11]), side(&[20])];
        // A game type with no teams says nothing about whose side a computer is on.
        let melee = [person(0, 0, 10), computer(1, 0), person(2, 0, 20)];
        assert_eq!(resolve_sides(&sides, &melee)[1], None);
        // Nor does a team whose people are on both sides, or one with nobody on it.
        let split = [
            person(0, 1, 10),
            person(1, 1, 20),
            computer(2, 1),
            computer(3, 2),
        ];
        let resolved = resolve_sides(&sides, &split);
        assert_eq!(resolved[2], None);
        assert_eq!(resolved[3], None);
    }

    #[test]
    fn the_series_is_shown_only_while_every_shown_player_is_on_a_side_and_both_sides_are_shown() {
        let sides = [Some(1), Some(0), None, Some(0), None, None, None, None];
        assert_eq!(
            series_teams(&sides, [0, 1, 3].into_iter()),
            Ok([2, 1, 3, 1, 3, 3, 3, 3])
        );
        // A slot on no side is fine for as long as no panel shows it.
        assert!(series_teams(&sides, [0, 1].into_iter()).is_ok());
        assert_eq!(
            series_teams(&sides, [0, 1, 2].into_iter()),
            Err(Unshowable::PlayerOnNoSide { player_id: 2 })
        );
        assert_eq!(
            series_teams(&sides, [1, 3].into_iter()),
            Err(Unshowable::SideUnshown { side: 2 })
        );
        assert_eq!(
            Unshowable::PlayerOnNoSide { player_id: 2 }.to_string(),
            "player 2 is on neither of its sides"
        );
        assert_eq!(
            Unshowable::SideUnshown { side: 2 }.to_string(),
            "side 2 has no player in the game"
        );
    }
}
