//! The game's side of the alliances screen: what the screen shows, read out of the game and the chat
//! settings, and what the player does on it turned into game commands, chat settings and requests
//! to the app.

use std::time::{Duration, Instant};

use byteorder::{ByteOrder, LittleEndian};
use hashbrown::HashSet;
use overlay_ui::alliances::{
    AlliancePlayerView, AllianceState, AlliancesAction, AlliancesView, ChatTargetChoice,
    ChatTargetOption, PlayerNote, RecipientName,
};
use parking_lot::Mutex;

use crate::app_messages::SbUserId;
use crate::bw::commands;
use crate::bw_scr::chat::{ChatManager, OtherPlayer};
use crate::game_thread::{GameThreadMessage, send_game_msg_to_async};

use super::{BwVars, stats};

/// How long the screen keeps showing an alliance or vision the player set before the game has
/// carried it out. A command takes a few turns to come back around, and a switch that sprang back
/// in the meantime would read as the change having failed; one the game never carries out (a game
/// that ignores it) springs back once this has passed.
const SENT_HOLD: Duration = Duration::from_secs(3);

/// How many players the game keeps alliances between, neutral slots included.
const ALLIANCE_SLOTS: usize = 12;

/// The players who take part in a game and can have alliances: the first eight. The rest are
/// neutral slots and observers.
const PLAYER_SLOTS: usize = 8;

/// `game.chat_dialog_recipient`'s value for everyone, and for the player's allies.
const RECIPIENT_EVERYONE: u8 = 8;
const RECIPIENT_ALLIES: u8 = 9;

/// The alliance levels the game keeps in `game.alliances`.
const ENEMY: u8 = 0;
const ALLIED: u8 = 1;
const ALLIED_VICTORY: u8 = 2;

/// What the game's rules allow of alliances and chat recipients this game.
#[derive(Copy, Clone, Default, Debug)]
pub struct AllianceRules {
    /// Whether players may change their alliances and shared vision: the game type allows allies,
    /// and ShieldBattery has not fixed them for this game. The game ignores either command
    /// otherwise.
    pub alliances_open: bool,
    /// Whether chat can go to allies, which the game type decides even where ShieldBattery has fixed
    /// the alliances themselves.
    pub allies_chat: bool,
    /// Whether the lobby's teams are the game's forces: the team game types and Top vs Bottom.
    pub team_forces: bool,
    /// Whether a team's players share control of one set of units: the team game types. Chat there
    /// goes to a team rather than to one player.
    pub shared_control: bool,
}

/// The screen's state that lives between frames.
#[derive(Default)]
pub(super) struct AlliancesState {
    /// The alliances the player last set, and when, until the game holds them.
    sent_alliances: Option<([u8; ALLIANCE_SLOTS], Instant)>,
    /// The shared vision the player last set, and when, until the game holds it.
    sent_vision: Option<(u16, Instant)>,
    /// Who the player has asked to report once the game is over.
    reported: HashSet<SbUserId>,
}

impl AlliancesState {
    /// Builds the screen from the game and the chat settings.
    pub(super) fn build_view(
        &mut self,
        bw: &BwVars,
        rules: AllianceRules,
        chat: &Mutex<ChatManager>,
        now: Instant,
    ) -> AlliancesView {
        let others = chat.lock().others();
        let local = bw.local_player_id;
        let alliances = self.shown_alliances(bw, now);
        let vision = self.shown_vision(bw, now);
        let players = others
            .iter()
            .filter_map(|other| self.player_view(bw, rules, other, &alliances, vision))
            .collect::<Vec<_>>();
        let mut chat_targets = vec![ChatTargetOption {
            choice: ChatTargetChoice::All,
            recipient: None,
            color: None,
            muted: false,
        }];
        if rules.allies_chat {
            chat_targets.push(ChatTargetOption {
                choice: ChatTargetChoice::Allies,
                recipient: None,
                color: None,
                muted: false,
            });
        }
        if rules.shared_control {
            chat_targets.extend(team_targets(bw, &others));
        } else {
            chat_targets.extend(
                players
                    .iter()
                    .filter(|player| player.note != Some(PlayerNote::Left))
                    .filter_map(|player| {
                        let player_id = player_id_of(&others, player.user_id)?;
                        Some(ChatTargetOption {
                            choice: ChatTargetChoice::Recipient(player_id),
                            recipient: Some(RecipientName::Player(player.name.clone())),
                            color: Some(player.color),
                            muted: player.muted,
                        })
                    }),
            );
        }
        // SAFETY: the game struct is the game's own, and read on the thread that runs it.
        let recipient = unsafe { (**bw.game).chat_dialog_recipient };
        let chat_target = match recipient {
            RECIPIENT_EVERYONE => ChatTargetChoice::All,
            RECIPIENT_ALLIES if rules.allies_chat => ChatTargetChoice::Allies,
            value => ChatTargetChoice::Recipient(value),
        };
        let chat_target = match chat_targets
            .iter()
            .any(|option| option.choice == chat_target)
        {
            true => chat_target,
            false => ChatTargetChoice::All,
        };
        AlliancesView {
            players,
            alliances_open: rules.alliances_open,
            allied_victory: usize::from(local) < ALLIANCE_SLOTS
                && alliances[usize::from(local)] == ALLIED_VICTORY,
            chat_target,
            chat_targets,
        }
    }

    fn player_view(
        &self,
        bw: &BwVars,
        rules: AllianceRules,
        other: &OtherPlayer,
        alliances: &[u8; ALLIANCE_SLOTS],
        vision: u16,
    ) -> Option<AlliancePlayerView> {
        let player_id = other.player_id?.0;
        if usize::from(player_id) >= PLAYER_SLOTS {
            return None;
        }
        let local = bw.local_player_id;
        // SAFETY: the player table is the game's, with a slot for every player id, and the game
        // struct is read on the thread that runs it.
        let (player, local_team, victory_state) = unsafe {
            (
                *bw.players.add(usize::from(player_id)),
                (usize::from(local) < PLAYER_SLOTS)
                    .then(|| (*bw.players.add(usize::from(local))).team),
                (**bw.game).victory_state[usize::from(player_id)],
            )
        };
        // The game marks a player who has left by their slot's type, and one it has beaten by their
        // victory state.
        let left = matches!(player.player_type, 10 | 11);
        let defeated = !left && matches!(victory_state, 1 | 2);
        let teammate = rules.team_forces && player.team != 0 && Some(player.team) == local_team;
        let note = match () {
            _ if left => Some(PlayerNote::Left),
            _ if defeated => Some(PlayerNote::Defeated),
            _ if teammate => Some(PlayerNote::Teammate),
            _ => None,
        };
        // A teammate sharing the player's units is the player as far as the game is concerned, and
        // someone out of the game has nothing left to ally with.
        let has_alliance = !left
            && !defeated
            && player_id != local
            && !(rules.shared_control && teammate)
            && usize::from(local) < PLAYER_SLOTS;
        Some(AlliancePlayerView {
            user_id: other.user_id.0,
            name: other.name.clone(),
            color: stats::player_color(bw, player_id),
            race: stats::player_race(bw, player_id).1,
            alliance: has_alliance.then(|| AllianceState {
                player_id,
                allied: alliances[usize::from(player_id)] != ENEMY,
                vision: vision & (1 << player_id) != 0,
            }),
            note,
            muted: other.muted,
            blocked: other.blocked,
            report_requested: self.reported.contains(&other.user_id),
        })
    }

    /// Carries out what the player did on the screen, returning the game command it takes, if it
    /// takes one.
    pub(super) fn apply(
        &mut self,
        action: AlliancesAction,
        bw: &BwVars,
        rules: AllianceRules,
        chat: &Mutex<ChatManager>,
        now: Instant,
    ) -> Option<Vec<u8>> {
        let local = usize::from(bw.local_player_id);
        // Only a player in the game has alliances to set: the game would write an observer's
        // command past the end of its alliance table.
        let can_set_alliances =
            rules.alliances_open && !bw.is_replay_or_obs && local < PLAYER_SLOTS;
        match action {
            AlliancesAction::SetAllied { player_id, allied } => {
                if !can_set_alliances || usize::from(player_id) >= PLAYER_SLOTS {
                    return None;
                }
                let mut alliances = self.shown_alliances(bw, now);
                set_allied(&mut alliances, local, usize::from(player_id), allied);
                Some(self.send_alliances(alliances, now))
            }
            AlliancesAction::SetAlliedVictory(shared) => {
                if !can_set_alliances {
                    return None;
                }
                let mut alliances = self.shown_alliances(bw, now);
                set_allied_victory(&mut alliances, shared);
                Some(self.send_alliances(alliances, now))
            }
            AlliancesAction::SetSharedVision { player_id, shared } => {
                if !can_set_alliances || usize::from(player_id) >= PLAYER_SLOTS {
                    return None;
                }
                let mut vision = self.shown_vision(bw, now) | 1 << local;
                match shared {
                    true => vision |= 1 << player_id,
                    false => vision &= !(1 << player_id),
                }
                self.sent_vision = Some((vision, now));
                Some(vision_command(vision).to_vec())
            }
            AlliancesAction::SetChatTarget(choice) => {
                let recipient = match choice {
                    ChatTargetChoice::All => RECIPIENT_EVERYONE,
                    ChatTargetChoice::Allies => RECIPIENT_ALLIES,
                    ChatTargetChoice::Recipient(value) => value,
                };
                // SAFETY: the game struct is the game's own, and written on the thread that runs
                // it, the way the game's own recipient dialog writes it.
                unsafe {
                    (**bw.game).chat_dialog_recipient = recipient;
                }
                None
            }
            AlliancesAction::SetMuted { user_id, muted } => {
                let mut chat = chat.lock();
                match muted {
                    true => chat.add_muted_player(SbUserId(user_id)),
                    false => chat.remove_muted_player(SbUserId(user_id)),
                }
                None
            }
            AlliancesAction::SetAllMuted(muted) => {
                let mut chat = chat.lock();
                match muted {
                    true => chat.mute_all(),
                    false => chat.unmute_all(),
                }
                None
            }
            AlliancesAction::SetBlocked { user_id, blocked } => {
                chat.lock().set_blocked(SbUserId(user_id), blocked);
                None
            }
            AlliancesAction::Report { user_id } => {
                if self.reported.insert(SbUserId(user_id)) {
                    send_game_msg_to_async(GameThreadMessage::ReportPlayer {
                        user_id: SbUserId(user_id),
                    });
                }
                None
            }
            AlliancesAction::ViewProfile { user_id } => {
                send_game_msg_to_async(GameThreadMessage::ViewProfile {
                    user_id: SbUserId(user_id),
                });
                None
            }
        }
    }

    fn send_alliances(&mut self, alliances: [u8; ALLIANCE_SLOTS], now: Instant) -> Vec<u8> {
        self.sent_alliances = Some((alliances, now));
        alliance_command(&alliances).to_vec()
    }

    /// The local player's alliances as the screen shows them: what they last set, until the game
    /// holds it or the hold runs out, and the game's own otherwise.
    fn shown_alliances(&mut self, bw: &BwVars, now: Instant) -> [u8; ALLIANCE_SLOTS] {
        let local = usize::from(bw.local_player_id);
        let held = match local < ALLIANCE_SLOTS {
            // SAFETY: the game struct is read on the thread that runs it.
            true => unsafe { (**bw.game).alliances[local] },
            false => [ENEMY; ALLIANCE_SLOTS],
        };
        match self.sent_alliances {
            Some((sent, at)) if sent != held && now.duration_since(at) < SENT_HOLD => sent,
            _ => {
                self.sent_alliances = None;
                held
            }
        }
    }

    /// The local player's shared vision as the screen shows it, the same way.
    fn shown_vision(&mut self, bw: &BwVars, now: Instant) -> u16 {
        let local = usize::from(bw.local_player_id);
        let held = match local < ALLIANCE_SLOTS {
            // SAFETY: the game struct is read on the thread that runs it. Only the players' bits
            // are a player's to set, which a vision command carries in its low byte.
            true => unsafe { (**bw.game).visions[local] as u16 & 0xff },
            false => 0,
        };
        match self.sent_vision {
            Some((sent, at)) if sent & 0xff != held && now.duration_since(at) < SENT_HOLD => {
                sent & 0xff
            }
            _ => {
                self.sent_vision = None;
                held
            }
        }
    }
}

/// The game player id of a listed person.
fn player_id_of(others: &[OtherPlayer], user_id: u32) -> Option<u8> {
    others
        .iter()
        .find(|other| other.user_id.0 == user_id)
        .and_then(|other| other.player_id)
        .map(|id| id.0)
}

/// The teams chat can go to in a game whose teams share control: every team with a person on it,
/// the player's own included, as the game's own recipient dialog lists them.
fn team_targets(bw: &BwVars, others: &[OtherPlayer]) -> Vec<ChatTargetOption> {
    let mut teams = others
        .iter()
        .filter_map(|other| other.player_id)
        .map(|id| id.0)
        .chain(std::iter::once(bw.local_player_id))
        .filter(|&id| usize::from(id) < PLAYER_SLOTS)
        // SAFETY: the player table is the game's, with a slot for every player id.
        .map(|id| unsafe { (*bw.players.add(usize::from(id))).team })
        .filter(|&team| team != 0)
        .collect::<Vec<_>>();
    teams.sort_unstable();
    teams.dedup();
    teams
        .into_iter()
        .map(|team| ChatTargetOption {
            choice: ChatTargetChoice::Recipient(team),
            recipient: Some(RecipientName::Team(team)),
            color: None,
            muted: false,
        })
        .collect()
}

/// Allies `local` with `player`, or makes them enemies. An ally gets the level the player gives every
/// ally, which the game keeps in the player's own entry: allied, or allied with a shared victory.
fn set_allied(alliances: &mut [u8; ALLIANCE_SLOTS], local: usize, player: usize, allied: bool) {
    alliances[player] = match allied {
        true => alliances[local].max(ALLIED),
        false => ENEMY,
    };
}

/// Shares a victory with every ally, or stops sharing it, the way the game's own alliance dialog
/// does: every entry that is not an enemy moves together, the player's own among them, which is
/// where the game keeps the level a new ally gets.
fn set_allied_victory(alliances: &mut [u8; ALLIANCE_SLOTS], shared: bool) {
    for entry in alliances.iter_mut().filter(|entry| **entry != ENEMY) {
        *entry = match shared {
            true => ALLIED_VICTORY,
            false => ALLIED,
        };
    }
}

/// The game command setting the sender's alliances: two bits for each of the twelve slots.
fn alliance_command(alliances: &[u8; ALLIANCE_SLOTS]) -> [u8; 5] {
    let packed = alliances
        .iter()
        .enumerate()
        .fold(0u32, |packed, (slot, &level)| {
            packed | u32::from(level & 3) << (slot * 2)
        });
    let mut command = [commands::id::ALLIANCE, 0, 0, 0, 0];
    LittleEndian::write_u32(&mut command[1..], packed);
    command
}

/// The game command setting who the sender shares vision with: a bit for each player.
fn vision_command(vision: u16) -> [u8; 3] {
    let mut command = [commands::id::VISION, 0, 0];
    LittleEndian::write_u16(&mut command[1..], vision);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A melee game's alliances as the game starts them for player 0: allied with itself and with
    /// the neutral slot, enemies with everyone else.
    fn melee_start() -> [u8; ALLIANCE_SLOTS] {
        let mut alliances = [ENEMY; ALLIANCE_SLOTS];
        alliances[0] = ALLIED;
        alliances[11] = ALLIED;
        alliances
    }

    #[test]
    fn the_alliance_command_packs_two_bits_per_slot() {
        let mut alliances = melee_start();
        alliances[3] = ALLIED_VICTORY;
        let command = alliance_command(&alliances);
        assert_eq!(command[0], commands::id::ALLIANCE);
        let packed = LittleEndian::read_u32(&command[1..]);
        assert_eq!(packed, 1 | 2 << 6 | 1 << 22);
    }

    #[test]
    fn the_vision_command_carries_the_mask() {
        assert_eq!(vision_command(0b1001), [commands::id::VISION, 0b1001, 0]);
    }

    /// Allying gives the new ally whatever level the player gives every ally, so a player who has
    /// turned allied victory on shares it with the ally they just made.
    #[test]
    fn a_new_ally_gets_the_players_own_level() {
        let mut alliances = melee_start();
        set_allied(&mut alliances, 0, 2, true);
        assert_eq!(alliances[2], ALLIED);
        set_allied_victory(&mut alliances, true);
        set_allied(&mut alliances, 0, 4, true);
        assert_eq!(alliances[4], ALLIED_VICTORY);
        set_allied(&mut alliances, 0, 2, false);
        assert_eq!(alliances[2], ENEMY);
    }

    /// Allied victory moves every ally together and leaves enemies as they are.
    #[test]
    fn allied_victory_moves_every_ally_and_no_enemy() {
        let mut alliances = melee_start();
        alliances[5] = ALLIED;
        set_allied_victory(&mut alliances, true);
        assert_eq!(alliances[0], ALLIED_VICTORY);
        assert_eq!(alliances[5], ALLIED_VICTORY);
        assert_eq!(alliances[11], ALLIED_VICTORY);
        assert_eq!(alliances[3], ENEMY);
        set_allied_victory(&mut alliances, false);
        assert_eq!(alliances[0], ALLIED);
        assert_eq!(alliances[5], ALLIED);
    }
}
