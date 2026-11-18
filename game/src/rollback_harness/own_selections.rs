//! Makes the selections the replay records for the harness's stand-in player as the person's own
//! local selections, at the moment a person whose turns are `pipe` steps in flight would have made
//! them: while the frame `pipe` before the one the replay runs the command on is shown.
//!
//! A live game's local selection is what the person made, and the selection commands those make
//! are what the simulation's selection for them holds once they run. The rollback engine leans on
//! that after a rollback (see [`crate::rollback::selection::reconcile`]), estimating from the frame
//! a selection was made on when its command has run, and on the selection the person keeps to
//! decide what a restore puts back. Random selections exercise neither, since no command follows
//! them; mirroring the replay's own ones does both, with the timing the person had.
//!
//! Mirrored: plain selections, adding units to the selection and taking them out, and recalling a
//! hotkey group, which selects what the simulation holds in that group at the moment the person
//! recalls it (assigns made after it don't count, which a recall soon after an assign can differ
//! by). A command whose units the local selection already holds, exactly, is left alone: that is
//! the game catching the simulation's selection up with one of its own changes to the local one
//! (such as taking a drone that started a building out of a group), which isn't the person
//! selecting. Units the selection UI couldn't select together are left out of a group, as the UI
//! never makes one with them.

use std::sync::atomic::{AtomicU32, Ordering};

use byteorder::{ByteOrder, LittleEndian};
use parking_lot::Mutex;

use crate::bw::players::StormPlayerId;
use crate::bw::{Bw, commands};
use crate::bw_scr::BwScr;

pub(super) const ENV_VAR: &str = "SB_ROLLBACK_HARNESS_OWN_SELECTIONS";

/// The turns the person has in flight, as [`ENV_VAR`] gives them, or 0 when nothing is mirrored.
static PIPE: AtomicU32 = AtomicU32::new(0);

/// A selection command the replay records for the stand-in player.
#[derive(Clone, Debug, Eq, PartialEq)]
enum Command {
    Select(Vec<u32>),
    Add(Vec<u32>),
    Remove(Vec<u32>),
    Recall(u8),
}

struct Mirror {
    /// The stand-in player's selection commands, with the frame the replay runs each on, once read
    /// out of the replay.
    commands: Option<Vec<(u32, Command)>>,
    /// The newest frame shown that the mirror has made the selections due by, or `None` before the
    /// first since the game (or a replay seek) started.
    mirrored_through: Option<u32>,
}

static MIRROR: Mutex<Mirror> = Mutex::new(Mirror {
    commands: None,
    mirrored_through: None,
});

/// Reads [`ENV_VAR`]. `has_player` says whether the vision knob names a player to stand in for.
pub(super) fn init_from_env(has_player: bool) {
    let Ok(spec) = std::env::var(ENV_VAR) else {
        return;
    };
    match spec.parse::<u32>() {
        Ok(pipe) if pipe >= 1 && has_player => {
            info!("{ENV_VAR}: mirroring the stand-in's selections with {pipe} turns in flight");
            PIPE.store(pipe, Ordering::Release);
        }
        Ok(pipe) if pipe >= 1 => {
            error!(
                "{ENV_VAR} needs {} to name a player; ignoring it",
                super::VISION_ENV_VAR
            )
        }
        _ => error!("{ENV_VAR}={spec:?} is not a turn count of at least 1; ignoring it"),
    }
}

/// The turns the person has in flight, when the stand-in's selections are mirrored.
pub(crate) fn pipe() -> Option<u32> {
    match PIPE.load(Ordering::Relaxed) {
        0 => None,
        pipe => Some(pipe),
    }
}

/// Forgets how far the mirror got, for a game (or a replay seek) starting over.
pub(super) fn reset() {
    MIRROR.lock().mirrored_through = None;
}

/// Makes the selections the person `player` would have made by the time `frame` is shown. The
/// first call starts the local selection off as the simulation's selection for them.
pub(super) unsafe fn mirror_due(bw: &BwScr, player: u8, frame: u32) {
    unsafe {
        let Some(pipe) = pipe() else {
            return;
        };
        let mut mirror = MIRROR.lock();
        let mirror = &mut *mirror;
        let commands = mirror
            .commands
            .get_or_insert_with(|| read_commands(bw, player));
        let through = match mirror.mirrored_through {
            Some(through) if through <= frame => through,
            _ => {
                let selected = bw.rollback_select_simulated_for_harness();
                debug!("{ENV_VAR}: frame {frame} starts the local selection as {selected}");
                mirror.mirrored_through = Some(frame);
                return;
            }
        };
        mirror.mirrored_through = Some(frame);
        let due = commands
            .iter()
            .filter(|(run_on, _)| (through + 1..=frame).contains(&run_on.saturating_sub(pipe)));
        for (run_on, command) in due {
            let units = match command {
                Command::Select(tags) => bw.rollback_units_by_tag(tags),
                Command::Add(tags) => {
                    let mut units = bw.rollback_local_selection_units();
                    for unit in bw.rollback_units_by_tag(tags) {
                        if !units.contains(&unit) {
                            units.push(unit);
                        }
                    }
                    units
                }
                Command::Remove(tags) => {
                    let removed = bw.rollback_units_by_tag(tags);
                    let mut units = bw.rollback_local_selection_units();
                    units.retain(|x| !removed.contains(x));
                    units
                }
                Command::Recall(group) => bw.rollback_hotkey_group_units(player, *group),
            };
            match bw.rollback_select_as_person_for_harness(player, &units) {
                Some(selected) => debug!(
                    "{ENV_VAR}: frame {frame} selected {selected} as the person, for {command:?} \
                     run on frame {run_on}"
                ),
                None => debug!(
                    "{ENV_VAR}: frame {frame} left the local selection as it was for \
                     {command:?} run on frame {run_on}"
                ),
            }
        }
    }
}

/// The selection commands of the storm player that `player` is, from the whole replay.
unsafe fn read_commands(bw: &BwScr, player: u8) -> Vec<(u32, Command)> {
    unsafe {
        let storm = StormPlayerId((*bw.players().add(usize::from(player))).storm_id as u8);
        let replay = bw.replay_data();
        if replay.is_null() || (*replay).data_start.is_null() {
            error!("{ENV_VAR}: the replay's commands aren't loaded");
            return Vec::new();
        }
        let data = std::slice::from_raw_parts((*replay).data_start, (*replay).data_length as usize);
        let commands = crate::game_thread::replay_commands(data, bw.game_command_lengths())
            .into_iter()
            .filter(|&(_, from, _)| from == storm)
            .filter_map(|(frame, _, command)| Some((frame, parse(command)?)))
            .collect::<Vec<_>>();
        info!(
            "{ENV_VAR}: player {player} (storm id {}) has {} selection commands",
            storm.0,
            commands.len(),
        );
        commands
    }
}

/// The selection a command makes, if it is one the mirror makes.
fn parse(command: &[u8]) -> Option<Command> {
    use commands::id;
    let short_tags = |tags: &[u8]| {
        tags.as_chunks::<2>()
            .0
            .iter()
            .map(|x| u32::from(LittleEndian::read_u16(x)))
            .collect::<Vec<_>>()
    };
    let long_tags = |tags: &[u8]| {
        tags.as_chunks::<4>()
            .0
            .iter()
            .map(|x| LittleEndian::read_u32(x))
            .collect::<Vec<_>>()
    };
    match command {
        [id::SELECT, _, tags @ ..] => Some(Command::Select(short_tags(tags))),
        [id::SELECT_ADD, _, tags @ ..] => Some(Command::Add(short_tags(tags))),
        [id::SELECT_REMOVE, _, tags @ ..] => Some(Command::Remove(short_tags(tags))),
        [id::SELECT_EXTENDED, _, tags @ ..] => Some(Command::Select(long_tags(tags))),
        [id::SELECT_ADD_EXTENDED, _, tags @ ..] => Some(Command::Add(long_tags(tags))),
        [id::SELECT_REMOVE_EXTENDED, _, tags @ ..] => Some(Command::Remove(long_tags(tags))),
        // { u8 id, u8 kind, u8 group }, where kind 1 selects the group; 0 and 2 assign and add to
        // it, leaving the selection alone.
        [id::HOTKEY, 1, group] => Some(Command::Recall(*group)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_commands_parse() {
        assert_eq!(
            parse(&[0x09, 2, 0x7e, 0x2c, 0x85, 0x2c]),
            Some(Command::Select(vec![11390, 11397]))
        );
        assert_eq!(
            parse(&[0x0a, 1, 0x85, 0x2c]),
            Some(Command::Add(vec![11397]))
        );
        assert_eq!(
            parse(&[0x65, 1, 0x7e, 0x2c, 0, 0]),
            Some(Command::Remove(vec![11390]))
        );
        assert_eq!(parse(&[0x13, 1, 5]), Some(Command::Recall(5)));
        assert_eq!(parse(&[0x13, 0, 5]), None);
        assert_eq!(parse(&[0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0]), None);
    }
}
