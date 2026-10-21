use std::ffi::CString;
use std::time::{Duration, Instant};

use hashbrown::{HashMap, HashSet};

use crate::{
    app_messages::{BlockFailureReason, BlockRequestFailed, ReportOutcome, ReportResult, SbUserId},
    bw::{get_bw, players::BwPlayerId},
    bw_scr::get_exe_build,
    game_state::JoinedPlayer,
    game_thread::{GameThreadMessage, send_game_msg_to_async},
    user_aliases,
};

pub struct ChatManager {
    players: Vec<JoinedPlayer>,
    /// The aliases the local user has given this game's players, shown in place of their names.
    aliases: HashMap<SbUserId, String>,
    /// Players that are blocked on ShieldBattery.
    blocked_players: HashSet<SbUserId>,
    /// Players that are temporarily muted for this game only.
    muted_players: HashSet<SbUserId>,
    local_user_id: Option<SbUserId>,
    is_chat_restricted: bool,
    /// Text to print in the game's chat area, queued by code running off the game thread (which
    /// can't print directly). Drained by [`Self::take_pending_notices`] on the game thread.
    pending_notices: Vec<CString>,
    /// The reports the local user has made about players this game, by player.
    reports: HashMap<SbUserId, Report>,
}

/// How long a report may go unanswered before it counts as failed: the app files it, and an app
/// that never answers (closed, or cut off from the game) has not filed it.
const REPORT_ANSWER_TIMEOUT: Duration = Duration::from_secs(15);

/// A report the local user made about a player.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Report {
    /// Handed to the app at this time, with no answer yet.
    Sending(Instant),
    Sent,
    Failed,
}

/// Where a report about a player stands, as the alliances screen shows it.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReportStatus {
    Sending,
    Sent,
    Failed,
}

/// Another person in the game, as the local user's chat settings see them.
pub struct OtherPlayer {
    pub name: String,
    pub user_id: SbUserId,
    pub player_id: Option<BwPlayerId>,
    pub muted: bool,
    pub blocked: bool,
}

/// Which of the game's players a name typed into a chat command means.
#[derive(Debug)]
enum PlayerLookup<'a> {
    Found(&'a JoinedPlayer),
    NotFound,
    /// More than one player goes by the name, counting aliases. Aliases are allowed to overlap
    /// (several of one player's accounts can share one, and it can be another account's actual
    /// name), so this is an expected outcome rather than a corner case.
    Ambiguous,
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
    AmbiguousName,
}

/// Answers a chat command naming a player that `lookup` didn't find exactly one of.
fn print_lookup_failure(lookup: &PlayerLookup<'_>, name: &str) {
    let msg = match lookup {
        PlayerLookup::Found(_) => return,
        PlayerLookup::NotFound => c"\x06Player not found".to_owned(),
        PlayerLookup::Ambiguous => CString::new(format!(
            "\x06More than one player goes by \x07{name}\x06, use their actual name"
        ))
        .unwrap_or_default(),
    };
    get_bw().print_centered_text(&msg);
}

/// What a `/muteenemy` command did.
#[derive(Debug, PartialEq, Eq)]
enum MuteEnemiesOutcome {
    Muted,
    NoEnemies,
    /// The local user isn't playing (observer or replay), so nobody is their enemy.
    NotPlaying,
}

impl ChatManager {
    pub fn new() -> Self {
        Self {
            players: Vec::new(),
            aliases: HashMap::new(),
            blocked_players: HashSet::new(),
            muted_players: HashSet::new(),
            local_user_id: None,
            is_chat_restricted: false,
            pending_notices: Vec::new(),
            reports: HashMap::new(),
        }
    }

    /// Finds the player a typed name means, matching their alias as well as their actual name:
    /// the alias is what the local user sees, so it's what they'll type.
    fn player_by_name(&self, name: &str) -> PlayerLookup<'_> {
        if let Some(player) = self
            .players
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
        {
            return PlayerLookup::Found(player);
        }
        let mut matches = self.players.iter().filter(|p| {
            self.aliases
                .get(&p.sb_user_id)
                .is_some_and(|alias| alias.eq_ignore_ascii_case(name))
        });
        match (matches.next(), matches.next()) {
            (Some(player), None) => PlayerLookup::Found(player),
            (None, _) => PlayerLookup::NotFound,
            (Some(_), Some(_)) => PlayerLookup::Ambiguous,
        }
    }

    /// The name to show for `player`: the alias the local user gave them, if any.
    fn shown_name(&self, player: &JoinedPlayer) -> String {
        self.aliases
            .get(&player.sb_user_id)
            .map(|alias| format!("{alias} ({})", player.name))
            .unwrap_or_else(|| player.name.clone())
    }

    /// Replaces the aliases to show for the game's players. Should be called after
    /// [`Self::set_players`]; an alias for anyone not in the game is dropped.
    pub fn set_player_aliases(&mut self, aliases: impl IntoIterator<Item = (SbUserId, String)>) {
        self.aliases.clear();
        let players = &self.players;
        self.aliases.extend(
            aliases
                .into_iter()
                .filter(|(id, _)| players.iter().any(|p| p.sb_user_id == *id)),
        );
    }

    /// Rewrites a line BW is about to print to show aliases in place of the names of the players
    /// it's from or about (see [`user_aliases::replace_names_in_chat_line`]). Returns `None` if
    /// there's nothing to change.
    pub fn alias_chat_line(&self, line: &str, sender_id: u32) -> Option<String> {
        if self.aliases.is_empty() {
            return None;
        }
        let replacements = self
            .players
            .iter()
            .filter(|p| {
                let index = match sender_id {
                    0..=11 => Some(sender_id),
                    128..=131 => Some(sender_id - 128 + 12),
                    _ => None,
                };
                index.is_none() || p.player_id.is_some_and(|id| Some(u32::from(id.0)) == index)
            })
            .filter_map(|p| {
                let alias = self.aliases.get(&p.sb_user_id)?;
                Some((p.name.as_str(), alias.as_str()))
            })
            .collect::<Vec<_>>();
        user_aliases::replace_names_in_chat_line(
            line,
            &replacements,
            matches!(sender_id, 0..=11 | 128..=131),
        )
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
        let player = match self.player_by_name(name) {
            PlayerLookup::Found(player) => player,
            PlayerLookup::NotFound => return BlockCommandOutcome::PlayerNotFound,
            PlayerLookup::Ambiguous => return BlockCommandOutcome::AmbiguousName,
        };
        let user_id = player.sb_user_id;
        let name = self.shown_name(player).to_string();
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
            .map(|p| self.shown_name(p))
            .unwrap_or_else(|| "player".to_string());
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

    /// Everyone in the game but the local user, with what the local user has chosen about hearing
    /// them.
    pub fn others(&self) -> Vec<OtherPlayer> {
        self.players
            .iter()
            .filter(|player| Some(player.sb_user_id) != self.local_user_id)
            .map(|player| OtherPlayer {
                name: self.shown_name(player),
                user_id: player.sb_user_id,
                player_id: player.player_id,
                muted: self.muted_players.contains(&player.sb_user_id),
                blocked: self.blocked_players.contains(&player.sb_user_id),
            })
            .collect()
    }

    /// Blocks or unblocks one of this game's players locally and has the app save it, returning
    /// whether anything changed.
    pub fn set_blocked(&mut self, user_id: SbUserId, blocked: bool) -> bool {
        if self.local_user_id == Some(user_id)
            || !self.players.iter().any(|p| p.sb_user_id == user_id)
            || self.blocked_players.contains(&user_id) == blocked
        {
            return false;
        }
        if blocked {
            self.add_blocked_player(user_id);
        } else {
            self.remove_blocked_player(user_id);
        }
        send_game_msg_to_async(GameThreadMessage::SetUserBlocked { user_id, blocked });
        true
    }

    /// Records a report about one of this game's players as handed to the app, returning whether
    /// it should be handed over: a report already on its way or already received isn't filed twice.
    pub fn start_report(&mut self, user_id: SbUserId, now: Instant) -> bool {
        if self.local_user_id == Some(user_id)
            || !self.players.iter().any(|p| p.sb_user_id == user_id)
        {
            return false;
        }
        match self.report_status(user_id, now) {
            Some(ReportStatus::Sending | ReportStatus::Sent) => false,
            None | Some(ReportStatus::Failed) => {
                self.reports.insert(user_id, Report::Sending(now));
                true
            }
        }
    }

    /// Where the local user's report about this player stands, if they made one.
    pub fn report_status(&self, user_id: SbUserId, now: Instant) -> Option<ReportStatus> {
        Some(match *self.reports.get(&user_id)? {
            Report::Sending(at) if now.saturating_duration_since(at) < REPORT_ANSWER_TIMEOUT => {
                ReportStatus::Sending
            }
            Report::Sending(_) | Report::Failed => ReportStatus::Failed,
            Report::Sent => ReportStatus::Sent,
        })
    }

    /// Records the app's answer to a report, and queues a notice saying why one wasn't filed.
    pub fn report_result(&mut self, result: &ReportResult) {
        let report = match result.result {
            ReportOutcome::Reported => Report::Sent,
            _ => Report::Failed,
        };
        self.reports.insert(result.user_id, report);
        let detail = match result.result {
            ReportOutcome::Reported => return,
            ReportOutcome::RateLimited => ": you've filed too many reports recently",
            ReportOutcome::Restricted => ": you're restricted from reporting",
            ReportOutcome::Error => "",
        };
        let name = self
            .players
            .iter()
            .find(|p| p.sb_user_id == result.user_id)
            .map(|p| self.shown_name(p))
            .unwrap_or_else(|| "player".to_string());
        let msg =
            CString::new(format!("\x06Couldn't report \x07{name}\x06{detail}")).unwrap_or_default();
        self.pending_notices.push(msg);
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

    /// Mutes the players `is_enemy` says the local player is currently not allied with. Observers
    /// are never enemies. This is a snapshot: later alliance changes don't update it, and the mutes
    /// are undone like any other (`/unmute`, `/unmuteall`).
    fn mute_enemies(&mut self, is_enemy: impl Fn(BwPlayerId) -> bool) -> MuteEnemiesOutcome {
        let local_player_id = self
            .players
            .iter()
            .find(|p| Some(p.sb_user_id) == self.local_user_id)
            .and_then(|p| p.player_id);
        if local_player_id.is_none_or(|id| id.is_observer()) {
            return MuteEnemiesOutcome::NotPlaying;
        }

        let enemies = self
            .players
            .iter()
            .filter(|p| {
                Some(p.sb_user_id) != self.local_user_id
                    && p.player_id
                        .is_some_and(|id| !id.is_observer() && is_enemy(id))
            })
            .map(|p| p.sb_user_id)
            .collect::<Vec<_>>();
        if enemies.is_empty() {
            return MuteEnemiesOutcome::NoEnemies;
        }
        self.muted_players.extend(enemies);
        MuteEnemiesOutcome::Muted
    }

    pub fn unmute_all(&mut self) {
        self.muted_players.clear();
    }

    /// Returns true if the message was handled (e.g. the original function should not be called).
    pub fn handle_message(&mut self, _message: &str, player_id: u32) -> bool {
        self.is_sender_filtered(player_id)
    }

    /// Whether a message from this game player id is one the local player has chosen not to see:
    /// its sender is blocked on ShieldBattery or muted for this game.
    ///
    /// Asked by the print hook, which suppresses the line, and again by anything that records what
    /// the screen showed, so the two can never disagree about which messages the player saw.
    pub fn is_sender_filtered(&self, player_id: u32) -> bool {
        // Chat senders arrive as game player ids: 0-11 for players, 0x80-0x83 for observers.
        // The roster below keys players by their `players[]` index (observers at 12-15), so
        // observer ids are mapped back to indexes before the lookup. Anything else (system
        // messages etc.) has no sender to filter on.
        let player_index = match player_id {
            0..=11 => player_id,
            128..=131 => player_id - 128 + 12,
            _ => return false,
        };

        let player = self
            .players
            .iter()
            .find(|p| p.player_id.is_some_and(|id| id.0 as u32 == player_index));
        player.is_some_and(|player| {
            self.blocked_players.contains(&player.sb_user_id)
                || self.muted_players.contains(&player.sb_user_id)
        })
    }

    /// Handles a chat message the local user is sending, returning whether it was a command (and so
    /// shouldn't be sent). `is_enemy` says whether the local player is currently not allied with a
    /// player; it's only called for commands that need it.
    pub fn handle_send_chat(&mut self, text: &str, is_enemy: impl Fn(BwPlayerId) -> bool) -> bool {
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
            "/muteenemy" | "/menemy" => match self.mute_enemies(is_enemy) {
                MuteEnemiesOutcome::Muted => {
                    get_bw().print_text(c"Enemy players muted");
                }
                MuteEnemiesOutcome::NoEnemies => {
                    get_bw().print_centered_text(c"\x06You have no enemies to mute");
                }
                MuteEnemiesOutcome::NotPlaying => {
                    get_bw().print_centered_text(c"\x06Only players in the game have enemies");
                }
            },
            "/unmuteall" | "/umall" => {
                self.unmute_all();
                let msg = CString::new("\x04All players unmuted").unwrap();
                get_bw().print_text(&msg);
            }
            "/mute" | "/m" => {
                let mut to_mute = None;
                if let Some(player) = tokens.next() {
                    match self.player_by_name(player) {
                        PlayerLookup::Found(player) => {
                            to_mute = Some(player.sb_user_id);
                            // TODO(tec27): Use team color for player name
                            let msg = CString::new(format!(
                                "\x04Muted player: \x07{}",
                                self.shown_name(player)
                            ))
                            .unwrap_or_default();
                            get_bw().print_text(&msg);
                        }
                        lookup => print_lookup_failure(&lookup, player),
                    }
                } else {
                    let msg = CString::new("\x03Usage: \x04/mute \x07<name>").unwrap();
                    get_bw().print_centered_text(&msg);
                }

                if let Some(player_id) = to_mute {
                    self.add_muted_player(player_id);
                }
            }
            // Same names and aliases as the app's chat commands
            "/block" | "/ignore" | "/squelch" | "/unblock" | "/unignore" | "/unsquelch" => {
                let blocked = matches!(command, "/block" | "/ignore" | "/squelch");
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
                        print_lookup_failure(&PlayerLookup::NotFound, name);
                    }
                    BlockCommandOutcome::AmbiguousName => {
                        print_lookup_failure(&PlayerLookup::Ambiguous, name);
                    }
                }
            }
            "/unmute" | "/um" => {
                let mut to_unmute = None;
                if let Some(player) = tokens.next() {
                    match self.player_by_name(player) {
                        PlayerLookup::Found(player) => {
                            to_unmute = Some(player.sb_user_id);
                            // TODO(tec27): Use team color for player name
                            let msg = CString::new(format!(
                                "\x04Unmuted player: \x07{}",
                                self.shown_name(player)
                            ))
                            .unwrap_or_default();
                            get_bw().print_text(&msg);
                        }
                        lookup => print_lookup_failure(&lookup, player),
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

    fn found_user(lookup: PlayerLookup<'_>) -> Option<SbUserId> {
        match lookup {
            PlayerLookup::Found(player) => Some(player.sb_user_id),
            _ => None,
        }
    }

    #[test]
    fn players_can_be_named_by_alias() {
        let mut manager = manager_with_players();
        manager.set_player_aliases([(SbUserId(2), "bob".to_string())]);
        assert_eq!(
            found_user(manager.player_by_name("BOB")),
            Some(manager.players[1].sb_user_id)
        );
        assert_eq!(
            found_user(manager.player_by_name("player-b")),
            Some(manager.players[1].sb_user_id)
        );
        assert!(matches!(
            manager.player_by_name("player-c"),
            PlayerLookup::NotFound
        ));
    }

    #[test]
    fn original_names_take_priority_over_aliases() {
        let mut manager = manager_with_players();
        manager.set_player_aliases([(SbUserId(2), "watcher".to_string())]);
        assert_eq!(
            found_user(manager.player_by_name("watcher")),
            Some(SbUserId(3))
        );
        // The aliased player's actual name still picks them out.
        assert_eq!(
            found_user(manager.player_by_name("player-b")),
            Some(manager.players[1].sb_user_id)
        );
        assert_eq!(
            manager.set_player_blocked("watcher", true),
            BlockCommandOutcome::Changed {
                user_id: SbUserId(3),
                name: "watcher".to_string()
            }
        );
    }

    #[test]
    fn an_alias_shared_by_several_players_is_ambiguous() {
        let mut manager = manager_with_players();
        manager.set_player_aliases([
            (SbUserId(2), "bob".to_string()),
            (SbUserId(3), "bob".to_string()),
        ]);
        assert!(matches!(
            manager.player_by_name("bob"),
            PlayerLookup::Ambiguous
        ));
        assert_eq!(
            found_user(manager.player_by_name("watcher")),
            Some(SbUserId(3))
        );
    }

    #[test]
    fn aliases_for_players_not_in_the_game_are_dropped() {
        let mut manager = manager_with_players();
        manager.set_player_aliases([(SbUserId(99), "bob".to_string())]);
        assert!(matches!(
            manager.player_by_name("bob"),
            PlayerLookup::NotFound
        ));
        assert_eq!(manager.alias_chat_line("player-a: hi", 0), None);
    }

    #[test]
    fn chat_lines_show_aliases_for_their_senders() {
        let mut manager = manager_with_players();
        assert_eq!(manager.alias_chat_line("player-b: hi", 3), None);
        manager.set_player_aliases([(SbUserId(2), "bob".to_string())]);
        assert_eq!(
            manager
                .alias_chat_line("\x03player-b: \x02hi player-b", 3)
                .as_deref(),
            Some("\x03bob (player-b): \x02hi player-b")
        );
        assert_eq!(manager.alias_chat_line("player-b: map objective", 0), None);
        let rewritten = manager.alias_chat_line("player-b: hello", 3).unwrap();
        assert_eq!(
            crate::bw_scr::chat_history::strip_sender_prefix(&rewritten, "bob (player-b)"),
            "hello"
        );
    }

    #[test]
    fn blocking_by_alias_reports_the_alias() {
        let mut manager = manager_with_players();
        manager.set_player_aliases([(SbUserId(2), "bob".to_string())]);
        assert_eq!(
            manager.set_player_blocked("bob", true),
            BlockCommandOutcome::Changed {
                user_id: SbUserId(2),
                name: "bob (player-b)".to_string(),
            }
        );
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
    fn mute_enemies_mutes_only_non_allied_players() {
        let mut manager = manager_with_players();
        manager.set_players(&[
            joined("player-a", 0, 1),
            joined("player-b", 3, 2),
            joined("ally", 1, 5),
            joined("watcher", 12, 3),
        ]);
        assert_eq!(
            manager.mute_enemies(|id| id.0 == 3),
            MuteEnemiesOutcome::Muted,
        );
        assert!(manager.handle_message("hi", 3));
        assert!(!manager.handle_message("hi", 1));
        assert!(!manager.handle_message("hi", 0));
        assert!(!manager.handle_message("hi", 128));

        manager.unmute_all();
        assert!(!manager.handle_message("hi", 3));
    }

    #[test]
    fn mute_enemies_never_mutes_the_local_player_or_observers() {
        let mut manager = manager_with_players();
        // Even a predicate claiming everyone is an enemy leaves the local player and observers.
        assert_eq!(manager.mute_enemies(|_| true), MuteEnemiesOutcome::Muted,);
        assert!(manager.handle_message("hi", 3));
        assert!(!manager.handle_message("hi", 0));
        assert!(!manager.handle_message("hi", 128));
        assert!(!manager.handle_message("hi", 131));
    }

    #[test]
    fn mute_enemies_with_only_allies_mutes_nobody() {
        let mut manager = manager_with_players();
        assert_eq!(
            manager.mute_enemies(|_| false),
            MuteEnemiesOutcome::NoEnemies,
        );
        assert!(!manager.handle_message("hi", 3));
    }

    #[test]
    fn mute_enemies_as_an_observer_mutes_nobody() {
        let mut manager = manager_with_players();
        manager.set_local_player_info(SbUserId(3), false);
        assert_eq!(
            manager.mute_enemies(|_| true),
            MuteEnemiesOutcome::NotPlaying,
        );
        assert!(!manager.handle_message("hi", 0));
        assert!(!manager.handle_message("hi", 3));
    }

    #[test]
    fn mute_enemies_without_a_local_roster_entry_mutes_nobody() {
        let mut manager = manager_with_players();
        manager.set_local_player_info(SbUserId(99), false);
        assert_eq!(
            manager.mute_enemies(|_| true),
            MuteEnemiesOutcome::NotPlaying,
        );
        assert!(!manager.handle_message("hi", 3));
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
