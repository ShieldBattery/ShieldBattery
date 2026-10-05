use std::ffi::CString;

use hashbrown::HashSet;

use crate::{
    app_messages::{BlockFailureReason, BlockRequestFailed, SbUserId},
    bw::get_bw,
    bw_scr::get_exe_build,
    game_state::JoinedPlayer,
    game_thread::{GameThreadMessage, send_game_msg_to_async},
};

pub struct ChatManager {
    players: Vec<JoinedPlayer>,
    /// Players that are blocked on ShieldBattery.
    blocked_players: HashSet<SbUserId>,
    /// Players that are temporarily muted for this game only.
    muted_players: HashSet<SbUserId>,
    local_user_id: Option<SbUserId>,
    is_chat_restricted: bool,
    /// Text to print in the game's chat area, queued by code running off the game thread (which
    /// can't print directly). Drained by [`Self::take_pending_notices`] on the game thread.
    pending_notices: Vec<CString>,
}

/// What a `/block` or `/unblock` command did to the block list.
#[derive(Debug, PartialEq, Eq)]
enum BlockCommandOutcome {
    /// The block list changed; the app needs to save the change to the server.
    Changed {
        user_id: SbUserId,
        name: String,
    },
    AlreadyInState {
        name: String,
    },
    IsLocalUser,
    PlayerNotFound,
}

impl ChatManager {
    pub fn new() -> Self {
        Self {
            players: Vec::new(),
            blocked_players: HashSet::new(),
            muted_players: HashSet::new(),
            local_user_id: None,
            is_chat_restricted: false,
            pending_notices: Vec::new(),
        }
    }

    fn player_by_name(&self, name: &str) -> Option<&JoinedPlayer> {
        self.players
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn set_local_player_info(&mut self, id: SbUserId, is_chat_restricted: bool) {
        self.local_user_id = Some(id);
        self.is_chat_restricted = is_chat_restricted;
    }

    pub fn set_players(&mut self, players: &[JoinedPlayer]) {
        self.players.clear();
        self.players.extend_from_slice(players);
        debug!("ChatManager initialized with players: {:?}", self.players);
    }

    /// Replaces the set of players blocked on ShieldBattery. Should be called after
    /// [`Self::set_local_player_info`] so the local user is never blocked.
    pub fn set_blocked_players(&mut self, player_ids: &[SbUserId]) {
        self.blocked_players.clear();
        self.blocked_players.extend(
            player_ids
                .iter()
                .filter(|&&id| self.local_user_id != Some(id)),
        );
        debug!("ChatManager blocked players: {:?}", self.blocked_players);
    }

    pub fn add_blocked_player(&mut self, player_id: SbUserId) {
        if self.local_user_id == Some(player_id) {
            // Don't allow blocking yourself
            return;
        }
        self.blocked_players.insert(player_id);
    }

    pub fn remove_blocked_player(&mut self, player_id: SbUserId) {
        self.blocked_players.remove(&player_id);
    }

    /// Blocks or unblocks the player named `name` (one of this game's players) locally, leaving
    /// it to the caller to have the change saved.
    fn set_player_blocked(&mut self, name: &str, blocked: bool) -> BlockCommandOutcome {
        let Some(player) = self.player_by_name(name) else {
            return BlockCommandOutcome::PlayerNotFound;
        };
        let user_id = player.sb_user_id;
        let name = player.name.clone();
        if self.local_user_id == Some(user_id) {
            return BlockCommandOutcome::IsLocalUser;
        }
        if self.blocked_players.contains(&user_id) == blocked {
            return BlockCommandOutcome::AlreadyInState { name };
        }

        if blocked {
            self.add_blocked_player(user_id);
        } else {
            self.remove_blocked_player(user_id);
        }
        BlockCommandOutcome::Changed { user_id, name }
    }

    /// Undoes a block or unblock made in game that the app couldn't save, and queues a notice
    /// telling the user it didn't stick.
    pub fn block_request_failed(&mut self, failure: &BlockRequestFailed) {
        if failure.blocked {
            self.remove_blocked_player(failure.user_id);
        } else {
            self.add_blocked_player(failure.user_id);
        }

        let name = self
            .players
            .iter()
            .find(|p| p.sb_user_id == failure.user_id)
            .map(|p| p.name.as_str())
            .unwrap_or("player");
        let action = if failure.blocked { "block" } else { "unblock" };
        let detail = match failure.reason {
            BlockFailureReason::LimitReached => ": you've reached the limit of blocked users",
            BlockFailureReason::Error => "",
        };
        let msg = CString::new(format!("\x06Couldn't {action} \x07{name}\x06{detail}"))
            .unwrap_or_default();
        self.pending_notices.push(msg);
    }

    pub fn take_pending_notices(&mut self) -> Vec<CString> {
        std::mem::take(&mut self.pending_notices)
    }

    pub fn add_muted_player(&mut self, player_id: SbUserId) {
        self.muted_players.insert(player_id);
    }

    pub fn remove_muted_player(&mut self, player_id: SbUserId) {
        self.muted_players.remove(&player_id);
    }

    pub fn mute_all(&mut self) {
        self.muted_players
            .extend(self.players.iter().filter_map(|p| {
                if Some(p.sb_user_id) == self.local_user_id {
                    None
                } else {
                    Some(p.sb_user_id)
                }
            }));
    }

    pub fn unmute_all(&mut self) {
        self.muted_players.clear();
    }

    /// Returns true if the message was handled (e.g. the original function should not be called).
    pub fn handle_message(&mut self, _message: &str, player_id: u32) -> bool {
        // Chat senders arrive as game player ids: 0-11 for players, 0x80-0x83 for observers.
        // The roster below keys players by their `players[]` index (observers at 12-15), so
        // observer ids are mapped back to indexes before the lookup. Anything else (system
        // messages etc.) isn't ours to handle.
        let player_index = match player_id {
            0..=11 => player_id,
            128..=131 => player_id - 128 + 12,
            _ => return false,
        };

        let player = self
            .players
            .iter()
            .find(|p| p.player_id.is_some_and(|id| id.0 as u32 == player_index));
        if let Some(player) = player
            && (self.blocked_players.contains(&player.sb_user_id)
                || self.muted_players.contains(&player.sb_user_id))
        {
            return true;
        }

        false
    }

    pub fn handle_send_chat(&mut self, text: &str) -> bool {
        if !text.starts_with("/") {
            if self.is_chat_restricted {
                let msg = CString::new("\x06You are currently restricted from sending messages.")
                    .unwrap();
                get_bw().print_centered_text(&msg);
                return true;
            }
            return false;
        }

        let mut tokens = text.split(' ');
        let command = tokens.next().unwrap();
        match command {
            "/version" => {
                let msg = CString::new(format!(
                    "\x04ShieldBattery \x07{}, \x04SC:R \x07{}",
                    env!("SHIELDBATTERY_VERSION"),
                    get_exe_build()
                ))
                .unwrap();
                get_bw().print_text(&msg);
            }
            "/muteall" | "/mall" => {
                self.mute_all();
                let msg = CString::new("\x04All players muted").unwrap();
                get_bw().print_text(&msg);
            }
            "/unmuteall" | "/umall" => {
                self.unmute_all();
                let msg = CString::new("\x04All players unmuted").unwrap();
                get_bw().print_text(&msg);
            }
            "/mute" | "/m" => {
                let mut to_mute = None;
                if let Some(player) = tokens.next() {
                    if let Some(player) = self.player_by_name(player) {
                        to_mute = Some(player.sb_user_id);
                        // TODO(tec27): Use team color for player name
                        let msg =
                            CString::new(format!("\x04Muted player: \x07{}", player.name)).unwrap();
                        get_bw().print_text(&msg);
                    } else {
                        let msg = CString::new("\x06Player not found").unwrap();
                        get_bw().print_centered_text(&msg);
                    }
                } else {
                    let msg = CString::new("\x03Usage: \x04/mute \x07<name>").unwrap();
                    get_bw().print_centered_text(&msg);
                }

                if let Some(player_id) = to_mute {
                    self.add_muted_player(player_id);
                }
            }
            "/block" | "/unblock" => {
                let blocked = command == "/block";
                let Some(name) = tokens.next() else {
                    let msg = CString::new(format!("\x03Usage: \x04{command} \x07<name>")).unwrap();
                    get_bw().print_centered_text(&msg);
                    return true;
                };

                match self.set_player_blocked(name, blocked) {
                    BlockCommandOutcome::Changed { user_id, name } => {
                        let action = if blocked { "Blocked" } else { "Unblocked" };
                        let msg = CString::new(format!("\x04{action} player: \x07{name}")).unwrap();
                        get_bw().print_text(&msg);
                        send_game_msg_to_async(GameThreadMessage::SetUserBlocked {
                            user_id,
                            blocked,
                        });
                    }
                    BlockCommandOutcome::AlreadyInState { name } => {
                        let state = if blocked {
                            "already blocked"
                        } else {
                            "not blocked"
                        };
                        let msg = CString::new(format!("\x07{name} \x04is {state}")).unwrap();
                        get_bw().print_centered_text(&msg);
                    }
                    BlockCommandOutcome::IsLocalUser => {
                        let msg = CString::new("\x06You can't block yourself").unwrap();
                        get_bw().print_centered_text(&msg);
                    }
                    BlockCommandOutcome::PlayerNotFound => {
                        let msg = CString::new("\x06Player not found").unwrap();
                        get_bw().print_centered_text(&msg);
                    }
                }
            }
            "/unmute" | "/um" => {
                let mut to_unmute = None;
                if let Some(player) = tokens.next() {
                    if let Some(player) = self.player_by_name(player) {
                        to_unmute = Some(player.sb_user_id);
                        // TODO(tec27): Use team color for player name
                        let msg = CString::new(format!("\x04Unmuted player: \x07{}", player.name))
                            .unwrap();
                        get_bw().print_text(&msg);
                    } else {
                        let msg = CString::new("\x06Player not found").unwrap();
                        get_bw().print_centered_text(&msg);
                    }
                } else {
                    let msg = CString::new("\x03Usage: \x04/unmute \x07<name>").unwrap();
                    get_bw().print_centered_text(&msg);
                }

                if let Some(player_id) = to_unmute {
                    self.remove_muted_player(player_id);
                }
            }
            _ => {
                let msg = CString::new(format!("\x06Unknown command: \x04{command}")).unwrap();
                get_bw().print_centered_text(&msg);
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bw::players::{BwPlayerId, StormPlayerId};

    fn joined(name: &str, index: u8, user: u32) -> JoinedPlayer {
        JoinedPlayer {
            name: name.into(),
            storm_id: StormPlayerId(index),
            player_id: Some(BwPlayerId(index)),
            sb_user_id: SbUserId(user),
        }
    }

    fn manager_with_players() -> ChatManager {
        let mut manager = ChatManager::new();
        manager.set_local_player_info(SbUserId(1), false);
        manager.set_players(&[
            joined("player-a", 0, 1),
            joined("player-b", 3, 2),
            joined("watcher", 12, 3),
            joined("watcher-2", 15, 4),
        ]);
        manager
    }

    #[test]
    fn messages_from_unmuted_senders_pass_through() {
        let mut manager = manager_with_players();
        assert!(!manager.handle_message("hi", 0));
        assert!(!manager.handle_message("hi", 3));
        assert!(!manager.handle_message("hi", 128));
        assert!(!manager.handle_message("hi", 131));
    }

    #[test]
    fn muted_player_messages_are_swallowed() {
        let mut manager = manager_with_players();
        manager.add_muted_player(SbUserId(2));
        assert!(manager.handle_message("hi", 3));
        assert!(!manager.handle_message("hi", 0));
    }

    #[test]
    fn observer_sender_ids_map_to_their_roster_indexes() {
        let mut manager = manager_with_players();
        manager.add_muted_player(SbUserId(3));
        manager.add_blocked_player(SbUserId(4));
        // Observers at players[] indexes 12 and 15 send as game player ids 0x80 and 0x83.
        assert!(manager.handle_message("hi", 128));
        assert!(manager.handle_message("hi", 131));
        assert!(!manager.handle_message("hi", 129));
    }

    #[test]
    fn non_chat_sender_ids_are_not_handled() {
        let mut manager = manager_with_players();
        manager.add_muted_player(SbUserId(3));
        // Neutral slots, raw observer indexes, and out-of-range ids are not chat senders this
        // manager deals with, even when the id could alias a muted roster entry.
        for id in [12, 15, 16, 125, 127, 132, 255] {
            assert!(!manager.handle_message("hi", id));
        }
    }

    #[test]
    fn block_command_blocks_and_unblocks_by_name() {
        let mut manager = manager_with_players();
        assert_eq!(
            manager.set_player_blocked("PLAYER-B", true),
            BlockCommandOutcome::Changed {
                user_id: SbUserId(2),
                name: "player-b".into(),
            },
        );
        assert!(manager.handle_message("hi", 3));

        assert_eq!(
            manager.set_player_blocked("player-b", false),
            BlockCommandOutcome::Changed {
                user_id: SbUserId(2),
                name: "player-b".into(),
            },
        );
        assert!(!manager.handle_message("hi", 3));
    }

    #[test]
    fn block_command_rejects_no_op_and_invalid_targets() {
        let mut manager = manager_with_players();
        manager.add_blocked_player(SbUserId(2));
        assert_eq!(
            manager.set_player_blocked("player-b", true),
            BlockCommandOutcome::AlreadyInState {
                name: "player-b".into()
            },
        );
        assert_eq!(
            manager.set_player_blocked("watcher", false),
            BlockCommandOutcome::AlreadyInState {
                name: "watcher".into()
            },
        );
        assert_eq!(
            manager.set_player_blocked("player-a", true),
            BlockCommandOutcome::IsLocalUser,
        );
        assert_eq!(
            manager.set_player_blocked("nobody", true),
            BlockCommandOutcome::PlayerNotFound,
        );
        assert!(!manager.handle_message("hi", 0));
    }

    #[test]
    fn failed_block_requests_are_undone_with_a_notice() {
        let mut manager = manager_with_players();
        manager.set_player_blocked("player-b", true);
        manager.block_request_failed(&BlockRequestFailed {
            user_id: SbUserId(2),
            blocked: true,
            reason: BlockFailureReason::LimitReached,
        });
        assert!(!manager.handle_message("hi", 3));

        manager.add_blocked_player(SbUserId(3));
        manager.set_player_blocked("watcher", false);
        manager.block_request_failed(&BlockRequestFailed {
            user_id: SbUserId(3),
            blocked: false,
            reason: BlockFailureReason::Error,
        });
        assert!(manager.handle_message("hi", 128));

        let notices = manager.take_pending_notices();
        assert_eq!(notices.len(), 2);
        assert!(notices[0].to_str().unwrap().contains("block \x07player-b"));
        assert!(notices[1].to_str().unwrap().contains("unblock \x07watcher"));
        assert!(manager.take_pending_notices().is_empty());
    }
}
