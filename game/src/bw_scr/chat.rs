use std::ffi::CString;

use hashbrown::HashSet;

use crate::{app_messages::SbUserId, bw::get_bw, bw_scr::get_exe_build, game_state::JoinedPlayer};

pub struct ChatManager {
    players: Vec<JoinedPlayer>,
    /// Players that are blocked on ShieldBattery.
    blocked_players: HashSet<SbUserId>,
    /// Players that are temporarily muted for this game only.
    muted_players: HashSet<SbUserId>,
    local_user_id: Option<SbUserId>,
    is_chat_restricted: bool,
}

#[allow(dead_code)]
impl ChatManager {
    pub fn new() -> Self {
        Self {
            players: Vec::new(),
            blocked_players: HashSet::new(),
            muted_players: HashSet::new(),
            local_user_id: None,
            is_chat_restricted: false,
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
        debug!("ChatManager handling message: '{_message}' from player {player_id}");
        if player_id >= 12 && !(125..=128).contains(&player_id) {
            // We don't deal with any non-player messages (0-11 is players, 125-128 is observers)
            return false;
        }

        let player = self
            .players
            .iter()
            .find(|p| p.player_id.is_some_and(|id| id.0 as u32 == player_id));
        if let Some(player) = player {
            if self.blocked_players.contains(&player.sb_user_id)
                || self.muted_players.contains(&player.sb_user_id)
            {
                return true;
            }
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
