//! Names the local user has given other players on ShieldBattery (see [`GameUserAlias`]), shown in
//! place of those players' names by what this DLL displays: its overlays, and the lines BW prints
//! to the chat area. Aliases are display-only and local: the names BW stores for players (which go
//! into replays, results, and everything other players see) are never touched.

use std::borrow::Cow;

use parking_lot::RwLock;

use crate::app_messages::{GameUserAlias, SbUserId};
use crate::bw::players::BwPlayerId;
use crate::game_thread;

static ALIASES: RwLock<Vec<GameUserAlias>> = RwLock::new(Vec::new());

pub fn set_aliases(aliases: Vec<GameUserAlias>) {
    // The aliases themselves stay out of the log, which can end up attached to bug reports.
    debug!("Received {} user aliases", aliases.len());
    *ALIASES.write() = aliases;
}

/// The alias the local user gave the player `user_id`, if they gave them one and `name` (the name
/// the game knows the player by) is that player's actual name.
pub fn alias_for(user_id: SbUserId, name: &str) -> Option<String> {
    ALIASES
        .read()
        .iter()
        .find(|a| a.user_id == user_id && a.name.eq_ignore_ascii_case(name))
        .map(|a| a.alias.clone())
}

/// The name to show for the player `user_id`, whose actual name is `name`.
pub fn display_name(user_id: SbUserId, name: &str) -> Cow<'_, str> {
    match alias_for(user_id, name) {
        Some(alias) => Cow::Owned(format!("{alias} ({name})")),
        None => Cow::Borrowed(name),
    }
}

/// The name to show for the player in BW player slot `player_id`, whose in-game name is `name`.
pub fn player_display_name(player_id: BwPlayerId, name: Cow<'_, str>) -> Cow<'_, str> {
    if ALIASES.read().is_empty() {
        return name;
    }
    match game_thread::sb_user_id_for_player(player_id).and_then(|id| alias_for(id, &name)) {
        Some(alias) => Cow::Owned(format!("{alias} ({name})")),
        None => name,
    }
}

/// Rewrites a confirmed sender prefix, or an exact leave announcement. Other system text and
/// everything typed after the sender prefix are preserved, including names that are ordinary words.
pub fn replace_names_in_chat_line(
    line: &str,
    replacements: &[(&str, &str)],
    sender: bool,
) -> Option<String> {
    let start = line.bytes().take_while(|byte| *byte < 0x20).count();
    let content = &line[start..];
    for &(name, alias) in replacements {
        let Some(tail) = content.strip_prefix(name) else {
            continue;
        };
        let tail_without_color = tail.trim_start_matches(|c: char| (c as u32) < 0x20);
        if (sender && tail_without_color.starts_with(':'))
            || (!sender && tail_without_color == " has left the game.")
        {
            return Some(format!("{}{alias} ({name}){tail}", &line[..start]));
        }
    }
    None
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn only_identified_prefixes_are_rewritten() {
        let replacements = [("the", "Bob"), ("Foo", "Bar"), ("Objective", "Player")];
        assert_eq!(
            replace_names_in_chat_line("Foo has left the game.", &replacements, false).as_deref(),
            Some("Bar (Foo) has left the game.")
        );
        assert_eq!(
            replace_names_in_chat_line("Someone has left the game.", &replacements, false),
            None
        );
        assert_eq!(
            replace_names_in_chat_line("Objective: survive", &replacements, false),
            None
        );
        assert_eq!(
            replace_names_in_chat_line("The map says Foo", &replacements, false),
            None
        );
        assert_eq!(
            replace_names_in_chat_line("\x03Foo: \x02the game", &replacements, true).as_deref(),
            Some("\x03Bar (Foo): \x02the game")
        );
    }
}
