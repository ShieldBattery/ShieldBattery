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
        Some(alias) => Cow::Owned(alias),
        None => Cow::Borrowed(name),
    }
}

/// The name to show for the player in BW player slot `player_id`, whose in-game name is `name`.
pub fn player_display_name(player_id: BwPlayerId, name: Cow<'_, str>) -> Cow<'_, str> {
    if ALIASES.read().is_empty() {
        return name;
    }
    match game_thread::sb_user_id_for_player(player_id).and_then(|id| alias_for(id, &name)) {
        Some(alias) => Cow::Owned(alias),
        None => name,
    }
}

/// Whether `byte` can be part of a ShieldBattery name (`USERNAME_ALLOWED_CHARACTERS` in
/// `common/constants.ts`). Names and aliases are both limited to these.
fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"`~!$^&*()[]-_+=.{}".contains(&byte)
}

/// Returns `text` with each whole occurrence of a name in `replacements` replaced by the alias it's
/// paired with, or `None` if no name occurs in it. An occurrence that runs into other characters a
/// name could contain is part of some longer word, not the name, and is left alone. Where names
/// overlap, the longer one wins, so one name being the prefix of another can't split it.
pub fn replace_names(text: &str, replacements: &[(&str, &str)]) -> Option<String> {
    let mut replacements = replacements
        .iter()
        .filter(|(name, _)| !name.is_empty())
        .collect::<Vec<_>>();
    if replacements.is_empty() {
        return None;
    }
    replacements.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));

    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut replaced_any = false;
    // Start of the text not yet copied to `result`.
    let mut copied = 0;
    let mut pos = 0;
    while pos < bytes.len() {
        let at_boundary = pos == 0 || !is_name_byte(bytes[pos - 1]);
        let found = at_boundary
            .then(|| {
                replacements.iter().find(|(name, _)| {
                    let end = pos + name.len();
                    bytes[pos..].starts_with(name.as_bytes())
                        && (end == bytes.len() || !is_name_byte(bytes[end]))
                })
            })
            .flatten();
        match found {
            Some((name, alias)) => {
                // Names are ASCII, so both ends of a match fall on character boundaries.
                result.push_str(&text[copied..pos]);
                result.push_str(alias);
                pos += name.len();
                copied = pos;
                replaced_any = true;
            }
            None => pos += 1,
        }
    }

    replaced_any.then(|| {
        result.push_str(&text[copied..]);
        result
    })
}

/// Like [`replace_names`], but for a line BW prints to the chat area, where names only get replaced
/// in the part of the line saying who it's from or about: everything before its first `:`, which no
/// name can contain (all of a line without one, such as "<name> has left the game."). What a player
/// typed comes after that, and is theirs to have written however they wanted, so a name that happens
/// to be a common word (or a player mentioning someone by their actual name) doesn't get rewritten.
pub fn replace_names_in_chat_line(line: &str, replacements: &[(&str, &str)]) -> Option<String> {
    let (head, tail) = match line.find(':') {
        Some(colon) => line.split_at(colon),
        None => (line, ""),
    };
    replace_names(head, replacements).map(|mut head| {
        head.push_str(tail);
        head
    })
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn replaces_names_with_their_aliases() {
        assert_eq!(
            replace_names("\x03Bar: \x02hi there", &[("Bar", "Foo")]).as_deref(),
            Some("\x03Foo: \x02hi there"),
        );
        assert_eq!(
            replace_names("Bar has left the game.", &[("Bar", "Foo")]).as_deref(),
            Some("Foo has left the game."),
        );
        assert_eq!(
            replace_names("Bar and Baz", &[("Bar", "Foo"), ("Baz", "Qux")]).as_deref(),
            Some("Foo and Qux"),
        );
    }

    #[test]
    fn leaves_text_without_names_alone() {
        assert_eq!(replace_names("hello world", &[("Bar", "Foo")]), None);
        assert_eq!(replace_names("hello", &[]), None);
        assert_eq!(replace_names("", &[("Bar", "Foo")]), None);
    }

    #[test]
    fn only_replaces_whole_names() {
        assert_eq!(replace_names("Barbara Bar_ xBar", &[("Bar", "Foo")]), None);
        assert_eq!(
            replace_names("Barbara Bar", &[("Bar", "Foo")]).as_deref(),
            Some("Barbara Foo"),
        );
        // Characters a name can't contain end it.
        assert_eq!(
            replace_names("(Bar),Bar:Bar", &[("Bar", "Foo")]).as_deref(),
            Some("(Bar),Foo:Foo"),
        );
    }

    #[test]
    fn prefers_the_longer_of_overlapping_names() {
        assert_eq!(
            replace_names("a a.b", &[("a", "X"), ("a.b", "Y")]).as_deref(),
            Some("X Y"),
        );
    }

    #[test]
    fn chat_lines_only_have_their_sender_replaced() {
        assert_eq!(
            replace_names_in_chat_line("\x03gg: \x02gg wp, Bar", &[("gg", "Foo"), ("Bar", "Baz")])
                .as_deref(),
            Some("\x03Foo: \x02gg wp, Bar"),
        );
        assert_eq!(
            replace_names_in_chat_line("Bar has left the game.", &[("Bar", "Foo")]).as_deref(),
            Some("Foo has left the game."),
        );
        assert_eq!(
            replace_names_in_chat_line("\x03Baz: \x02Bar", &[("Bar", "Foo")]),
            None,
        );
    }

    #[test]
    fn keeps_non_ascii_text_intact() {
        assert_eq!(
            replace_names("Bar: 안녕 Bar", &[("Bar", "Foo")]).as_deref(),
            Some("Foo: 안녕 Foo"),
        );
    }
}
