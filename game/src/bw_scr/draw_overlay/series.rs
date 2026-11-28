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
//!
//! The series' lines for the casters travel with the rest of it, and its logo is loaded from its
//! URL the first frame the series is shown (see [`series_logo`](super::series_logo)): never for a
//! game whose series is not shown, so a player's client and a replay never fetch it.
//!
//! So do the names its host gave its sides, which the panels label the sides with while the series
//! is shown, and the names they gave its players to be shown under. Those are worked out with the
//! sides, once, and every observer panel names a player by theirs for the whole of a game watched
//! live, whether or not the series itself can be shown on a given frame: a name that went back to
//! the account's halfway through a game would read as a different player.

use overlay_ui::observer::{SeriesFormat, SeriesView};

use super::series_logo::SeriesLogoLoader;
use super::{BwVars, is_active_player, shown_on_panels};
use crate::app_messages::{
    GameSetupInfo, SbUserId, SeriesOverlayDisplayName, SeriesOverlayFormat, SeriesOverlaySide,
};
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
    /// series'.
    resolved: Option<Option<Resolved>>,
    /// Whether the log has been told why a shown player left the series off, which it is told once
    /// a game rather than every frame.
    explained: bool,
}

/// What there is to show of a game's series.
struct Resolved {
    /// The names its players are shown under.
    display_names: DisplayNames,
    /// The series as the panels show it, or `None` for one in a format this build cannot word.
    series: Option<ResolvedSeries>,
}

/// The name each slot's player is shown under on the observer panels in place of their account
/// name, where the series gives them one.
#[derive(Default, Debug, PartialEq, Eq)]
pub(super) struct DisplayNames([Option<String>; 8]);

impl DisplayNames {
    /// The names `entries` give the people in `slots`. A person is shown under the first name
    /// `entries` give their account that says anything once trimmed; one they give no such name,
    /// and every computer, under their own. Entries for accounts that play no slot are left out.
    fn resolve(entries: &[SeriesOverlayDisplayName], slots: &[Slot]) -> DisplayNames {
        let mut names = DisplayNames::default();
        for slot in slots.iter().filter(|slot| !slot.computer) {
            let Some(user) = slot.user else {
                continue;
            };
            let name = entries
                .iter()
                .filter(|entry| entry.user_id == user)
                .map(|entry| entry.name.trim())
                .find(|name| !name.is_empty());
            if let (Some(name), Some(entry)) = (name, names.0.get_mut(usize::from(slot.player_id)))
            {
                *entry = Some(name.to_string());
            }
        }
        names
    }

    fn get(&self, player_id: u8) -> Option<&str> {
        self.0.get(usize::from(player_id))?.as_deref()
    }
}

/// What an observer panel calls the player in `player_id`'s slot: the name `display_names` show them
/// under where they give them one, and `account`, the name they play under, everywhere else.
pub(super) fn panel_name(
    display_names: Option<&DisplayNames>,
    player_id: u8,
    account: String,
) -> String {
    match display_names.and_then(|names| names.get(player_id)) {
        Some(name) => name.to_string(),
        None => account,
    }
}

struct ResolvedSeries {
    /// Which side (0 or 1) each slot is on, for the slots one could be found for.
    sides: [Option<u8>; 8],
    /// Everything the panels show of the series but its logo.
    view: SeriesView,
    logo: Option<SeriesLogoLoader>,
}

impl SeriesState {
    /// What the panels show of the series this frame, for a client watching `bw` live. Nothing for a
    /// game that is no series', and nothing while the shown players are not two sides of it.
    ///
    /// `ctx` is what the logo is loaded through, once `images_settled`: the loading screen's images
    /// are let go of on the game's first frame, which would drop a load started before it.
    pub(super) fn frame(
        &mut self,
        bw: &BwVars,
        setup: Option<&GameSetupInfo>,
        ctx: &egui::Context,
        images_settled: bool,
    ) -> Option<SeriesFrame> {
        if self.resolved.is_none() {
            // Asked again next frame while the game has yet to say who ended up in which slot.
            self.resolved = Some(resolve(bw, setup?)?);
        }
        let resolved = self.resolved.as_mut()?.as_mut()?.series.as_mut()?;
        let shown = (0..8u8)
            .filter(|&player_id| is_active_player(bw, usize::from(player_id)))
            .filter(|&player_id| shown_on_panels(bw, player_id));
        match series_teams(&resolved.sides, shown) {
            Ok(teams) => Some(SeriesFrame {
                teams,
                view: SeriesView {
                    logo: resolved
                        .logo
                        .as_mut()
                        .filter(|_| images_settled)
                        .and_then(|logo| logo.poll(ctx)),
                    ..resolved.view.clone()
                },
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

    /// The names the players of the game are shown under on the observer panels, once
    /// [`frame`](Self::frame) has worked them out: nothing for a game that is no series'.
    pub(super) fn display_names(&self) -> Option<&DisplayNames> {
        Some(&self.resolved.as_ref()?.as_ref()?.display_names)
    }
}

/// Works out what there is to show of `setup`'s series, or `None` while the game has yet to say
/// which slot each user ended up in.
fn resolve(bw: &BwVars, setup: &GameSetupInfo) -> Option<Option<Resolved>> {
    let Some(series) = setup.series_overlay.as_ref().filter(|_| !setup.is_replay()) else {
        return Some(None);
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
    let display_names = DisplayNames::resolve(&series.display_names, &slots);
    info!("Display names for the observer panels: {display_names:?}");
    let format = match series.format {
        SeriesOverlayFormat::BestOf { length } => SeriesFormat::BestOf { length },
        SeriesOverlayFormat::Unknown => {
            warn!("The game's series is in a format this build doesn't know; not showing it");
            return Some(Some(Resolved {
                display_names,
                series: None,
            }));
        }
    };
    let sides = resolve_sides(&series.sides, &slots);
    let lines = caster_lines(&series.lines);
    let side_names = series.sides.each_ref().map(side_name);
    let logo_url = series.logo_url.as_deref().filter(|url| !url.is_empty());
    info!(
        "Series for the observer panels: {:?}, {:?}, game {}, scores {}-{}, side names {:?}, \
         slot sides {:?}, caster lines {:?}, logo {:?}",
        series.title,
        series.format,
        series.game_number,
        series.sides[0].score,
        series.sides[1].score,
        side_names,
        sides,
        lines,
        logo_url,
    );
    Some(Some(Resolved {
        display_names,
        series: Some(ResolvedSeries {
            sides,
            view: SeriesView {
                title: series.title.clone().filter(|title| !title.is_empty()),
                format,
                game_number: series.game_number,
                scores: series.sides.each_ref().map(|side| side.score),
                lines,
                logo: None,
                side_names,
            },
            logo: logo_url.map(|url| SeriesLogoLoader::new(url.to_string())),
        }),
    }))
}

/// What the panels call `side`: the name its host gave it, where it says anything once trimmed.
fn side_name(side: &SeriesOverlaySide) -> Option<String> {
    let name = side.caption.as_deref()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// The caster lines of `lines` the panels show: the first two that say anything.
fn caster_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .take(2)
        .map(str::to_string)
        .collect()
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
    fn the_panels_show_the_first_two_caster_lines_that_say_anything() {
        let lines = |lines: &[&str]| {
            caster_lines(
                &lines
                    .iter()
                    .map(|line| line.to_string())
                    .collect::<Vec<_>>(),
            )
        };
        assert!(lines(&[]).is_empty());
        assert_eq!(lines(&["Casters  Alice"]), vec!["Casters  Alice"]);
        assert_eq!(
            lines(&[" ", " Stage  Final ", "", "Observer  Carol", "Extra"]),
            vec!["Stage  Final", "Observer  Carol"]
        );
    }

    fn display_name(user: u32, name: &str) -> SeriesOverlayDisplayName {
        SeriesOverlayDisplayName {
            user_id: SbUserId(user),
            name: name.to_string(),
        }
    }

    #[test]
    fn a_player_is_shown_under_the_first_display_name_given_to_their_account() {
        let slots = [
            person(0, 0, 10),
            person(1, 0, 20),
            computer(2, 0),
            person(4, 0, 30),
            person(5, 0, 40),
        ];
        let entries = [
            // Someone not in the game, who no slot is shown under.
            display_name(99, "Nobody"),
            display_name(10, "흑운장"),
            // A second name for the same account, which the first outranks.
            display_name(10, "Second"),
            display_name(20, "  星际老王 "),
            // A blank name says nothing, so the next one for the account is the one shown.
            display_name(30, "   "),
            display_name(30, "SixteenCharsLong"),
            display_name(40, ""),
        ];
        let names = DisplayNames::resolve(&entries, &slots);
        assert_eq!(
            names,
            DisplayNames([
                Some("흑운장".to_string()),
                Some("星际老王".to_string()),
                None,
                None,
                Some("SixteenCharsLong".to_string()),
                None,
                None,
                None,
            ])
        );
        assert_eq!(DisplayNames::resolve(&[], &slots), DisplayNames::default());
    }

    #[test]
    fn a_panel_names_a_player_by_their_display_name_and_by_their_account_without_one() {
        let names = DisplayNames::resolve(&[display_name(10, "Bisu [SBX]")], &[person(1, 0, 10)]);
        let account = |name: &str| name.to_string();
        assert_eq!(panel_name(Some(&names), 1, account("tec27")), "Bisu [SBX]");
        // Everyone the series gives no name keeps their own.
        assert_eq!(panel_name(Some(&names), 0, account("Rhynso")), "Rhynso");
        assert_eq!(
            panel_name(Some(&names), 9, account("Player 10")),
            "Player 10"
        );
        // As does everyone in a game that has no display names to give: one with no series, one
        // that is a replay, and every client that is playing rather than watching.
        assert_eq!(panel_name(None, 1, account("tec27")), "tec27");
    }

    #[test]
    fn a_side_is_named_by_what_its_host_called_it_once_trimmed() {
        let named = |caption: Option<&str>| {
            side_name(&SeriesOverlaySide {
                caption: caption.map(str::to_string),
                ..side(&[10])
            })
        };
        assert_eq!(
            named(Some(" Nexus Esports ")).as_deref(),
            Some("Nexus Esports")
        );
        assert_eq!(named(Some("   ")), None);
        assert_eq!(named(Some("")), None);
        assert_eq!(named(None), None);
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
