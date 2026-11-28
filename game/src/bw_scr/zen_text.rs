//! Display-only name resolution. Account identities and recorded game commands remain intact.

use std::borrow::Cow;
use std::ffi::{CStr, CString};

use crate::app_messages::SbUserId;
use crate::bw::players::BwPlayerId;
use crate::{game_thread, zen_mode};

fn player_user_id(player_id: u8) -> Option<SbUserId> {
    game_thread::player_id_mapping()
        .iter()
        .find(|mapping| mapping.game_id == Some(BwPlayerId(player_id)))
        .map(|mapping| mapping.sb_user_id)
}

pub(super) fn player_name(player_id: u8, original: &str) -> String {
    player_user_id(player_id)
        .map_or(Cow::Borrowed(original), |id| {
            zen_mode::display_name(id, original)
        })
        .into_owned()
}

/// Supplies the complete line for PrintText's no-sender path. The recorded command retains
/// the original sender and text.
pub(super) fn format_chat_line(player: u32, text: &CStr) -> Option<CString> {
    if !zen_mode::anonymizes_players() || player >= 12 {
        return None;
    }
    let user_id = player_user_id(player as u8)?;
    let alias = zen_mode::player_alias(user_id)?;
    let mut line = alias.into_bytes();
    line.extend_from_slice(b": ");
    line.extend_from_slice(text.to_bytes());
    CString::new(line).ok()
}

/// Replaces names in preformatted notices in one pass, so aliases cannot match another account.
pub(super) fn anonymize(text: &str) -> Cow<'_, str> {
    if !zen_mode::anonymizes_players() {
        return Cow::Borrowed(text);
    }
    let Some(setup) = game_thread::setup_info() else {
        return Cow::Borrowed(text);
    };
    let mut replacements = setup
        .users
        .iter()
        .filter_map(|user| match zen_mode::display_name(user.id, &user.name) {
            Cow::Owned(alias) => Some((user.name.as_str(), alias)),
            Cow::Borrowed(_) => None,
        })
        .collect::<Vec<_>>();
    replacements.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));
    replace_names(text, &replacements)
}

fn name_character(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn replace_names<'a>(text: &'a str, replacements: &[(&str, String)]) -> Cow<'a, str> {
    let mut result = String::new();
    let mut copied = 0;
    let mut index = 0;
    while index < text.len() {
        let matched = replacements.iter().find(|(name, _)| {
            !name.is_empty()
                && text[index..].starts_with(name)
                && text[..index]
                    .chars()
                    .next_back()
                    .is_none_or(|c| !name_character(c))
                && text[index + name.len()..]
                    .chars()
                    .next()
                    .is_none_or(|c| !name_character(c))
        });
        if let Some((name, alias)) = matched {
            result.push_str(&text[copied..index]);
            result.push_str(alias);
            index += name.len();
            copied = index;
        } else {
            index += text[index..].chars().next().unwrap().len_utf8();
        }
    }
    if copied == 0 {
        Cow::Borrowed(text)
    } else {
        result.push_str(&text[copied..]);
        Cow::Owned(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_keep_colors_and_replace_each_name_without_reprocessing_aliases() {
        let replacements = [("Ann", "Ben".into()), ("Ben", "Keen Kakaru".into())];
        assert_eq!(
            replace_names("\x07Ann\x04 has left. Ben wins.", &replacements),
            "\x07Ben\x04 has left. Keen Kakaru wins.",
        );
        assert_eq!(
            replace_names("Annabelle and banner", &replacements),
            "Annabelle and banner"
        );
        assert_eq!(replace_names("Ann: 안녕", &replacements), "Ben: 안녕");
    }
}
