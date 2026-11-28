use std::borrow::Cow;
use std::sync::OnceLock;

use overlay_ui::tr;

use crate::app_messages::{GameSetupInfo, SbUserId, ZenModeSettings, ZenPlayer};

#[derive(Default)]
struct ZenMode {
    local_user: Option<SbUserId>,
    settings: ZenModeSettings,
    players: Vec<ZenPlayer>,
}

impl ZenMode {
    fn player_alias(&self, user_id: SbUserId) -> Option<String> {
        if !self.settings.anonymize_players || self.local_user == Some(user_id) {
            return None;
        }
        let player = self.players.iter().find(|p| p.user_id == user_id)?;
        Some(
            player
                .localized_alias
                .clone()
                .unwrap_or_else(|| alias(player.name_index)),
        )
    }

    fn display_name<'a>(&self, user_id: SbUserId, original: &'a str) -> Cow<'a, str> {
        self.player_alias(user_id)
            .map_or(Cow::Borrowed(original), Cow::Owned)
    }

    fn is_muted(&self, user_id: SbUserId) -> bool {
        self.players
            .iter()
            .any(|p| p.user_id == user_id && p.mute_chat)
    }
}

fn alias(index: u8) -> String {
    match index {
        0 => tr!("zenMode.name0", "Rusty Rhynadon"),
        1 => tr!("zenMode.name1", "Bold Bengalaas"),
        2 => tr!("zenMode.name2", "Sneaky Scantid"),
        3 => tr!("zenMode.name3", "Keen Kakaru"),
        4 => tr!("zenMode.name4", "Ruthless Ragnasaur"),
        _ => tr!("zenMode.name5", "Unstable Ursadon"),
    }
}

static ZEN_MODE: OnceLock<ZenMode> = OnceLock::new();

/// Capture the match's launch preferences before its loading screen is drawn.
pub fn configure(setup: &GameSetupInfo, local_user_id: SbUserId) {
    let mode = if setup.is_replay() {
        ZenMode::default()
    } else {
        ZenMode {
            local_user: Some(local_user_id),
            settings: setup.zen_mode.clone().unwrap_or_default(),
            players: setup.zen_players.clone(),
        }
    };
    let _ = ZEN_MODE.set(mode);
}

pub fn display_name(user_id: SbUserId, original: &str) -> Cow<'_, str> {
    match ZEN_MODE.get() {
        Some(mode) => mode.display_name(user_id, original),
        None => Cow::Borrowed(original),
    }
}

pub fn player_alias(user_id: SbUserId) -> Option<String> {
    ZEN_MODE.get()?.player_alias(user_id)
}

pub fn is_muted(user_id: SbUserId) -> bool {
    ZEN_MODE.get().is_some_and(|mode| mode.is_muted(user_id))
}

pub fn mute_chat() -> bool {
    ZEN_MODE.get().is_some_and(|mode| mode.settings.mute_chat)
}

pub fn anonymizes_players() -> bool {
    ZEN_MODE
        .get()
        .is_some_and(|mode| mode.settings.anonymize_players)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_preserve_local_and_unknown_users() {
        let mut mode = ZenMode {
            local_user: Some(SbUserId(1)),
            settings: ZenModeSettings {
                anonymize_players: true,
                mute_chat: false,
            },
            players: vec![ZenPlayer {
                user_id: SbUserId(2),
                name_index: 0,
                mute_chat: true,
                localized_alias: None,
            }],
        };
        assert_eq!(mode.display_name(SbUserId(1), "Self"), "Self");
        assert_eq!(mode.display_name(SbUserId(2), "Other"), "Rusty Rhynadon");
        mode.players[0].localized_alias = Some("Rhynadonte oxidado".into());
        assert_eq!(
            mode.display_name(SbUserId(2), "Other"),
            "Rhynadonte oxidado"
        );
        assert_eq!(mode.display_name(SbUserId(3), "Unknown"), "Unknown");
        assert!(mode.is_muted(SbUserId(2)));
        assert!(!mode.is_muted(SbUserId(1)));
        assert_eq!(
            ZenMode::default().display_name(SbUserId(2), "Replay"),
            "Replay"
        );
    }
}
