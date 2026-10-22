//! The language SC:R is running in, which the overlay follows where it has a translation for it, so
//! the overlay's own text reads in the same language as the game's text it shows beside it (unit
//! names, the console's status lines).
//!
//! The game picks its language at startup from a `--locale` argument, a `Starcraft.ini` beside the
//! exe, the Battle.net launch options in the registry, or the Windows locale, in that order, taking
//! the first it has installed. It can also switch languages from its options menu while running,
//! reloading its string tables as it does. Reading the game's own choice rather than any of those
//! sources is what keeps the overlay in step with the strings the game actually loaded.

use overlay_ui::i18n::Locale;

/// Where in the game's locale state the selected locale sits, past two of the game's vectors of
/// three words each: a Windows locale id, or 0 for none selected, which the game reads as US
/// English.
#[cfg(target_pointer_width = "64")]
const SELECTED_LOCALE_OFFSET: usize = 0x30;
#[cfg(target_pointer_width = "32")]
const SELECTED_LOCALE_OFFSET: usize = 0x18;

/// The Windows locale id the game falls back to when none is selected.
const LOCALE_EN_US: u32 = 0x409;

/// SC:R's `get_locales`, which returns its locale state.
pub struct GameLocale {
    get_locales: unsafe extern "C" fn() -> *const u8,
}

impl GameLocale {
    pub fn new(get_locales: usize) -> GameLocale {
        GameLocale {
            get_locales: unsafe { std::mem::transmute::<usize, _>(get_locales) },
        }
    }

    /// The overlay locale for the language the game is running in, or `None` where the overlay has
    /// no translation for it.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread, after the game has picked its language.
    pub unsafe fn overlay_locale(&self) -> Option<Locale> {
        let lcid = unsafe {
            let locales = (self.get_locales)();
            if locales.is_null() {
                return None;
            }
            locales
                .add(SELECTED_LOCALE_OFFSET)
                .cast::<u32>()
                .read_unaligned()
        };
        overlay_locale_for(if lcid == 0 { LOCALE_EN_US } else { lcid })
    }
}

/// The overlay locale for a Windows locale id the game runs in, or `None` where the overlay has no
/// translation for that language. Each of the game's variants of a language maps to the overlay's
/// one translation of it: Singapore English, Mexican Spanish, and the game's "koUS" Korean, which
/// reads the Korean files.
///
/// Traditional Chinese has no translation of its own and is not given the Simplified one, which a
/// reader of Traditional may not have chosen for themselves.
fn overlay_locale_for(lcid: u32) -> Option<Locale> {
    match lcid {
        0x409 | 0x4809 => Some(Locale::En),
        0x40a | 0x80a => Some(Locale::Es),
        0x412 | 0x812 => Some(Locale::Ko),
        0x419 => Some(Locale::Ru),
        0x804 => Some(Locale::ZhHans),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_variant_of_a_translated_language() {
        assert_eq!(overlay_locale_for(0x409), Some(Locale::En));
        assert_eq!(overlay_locale_for(0x4809), Some(Locale::En));
        assert_eq!(overlay_locale_for(0x40a), Some(Locale::Es));
        assert_eq!(overlay_locale_for(0x80a), Some(Locale::Es));
        assert_eq!(overlay_locale_for(0x412), Some(Locale::Ko));
        assert_eq!(overlay_locale_for(0x812), Some(Locale::Ko));
        assert_eq!(overlay_locale_for(0x419), Some(Locale::Ru));
        assert_eq!(overlay_locale_for(0x804), Some(Locale::ZhHans));
    }

    #[test]
    fn leaves_untranslated_languages_to_the_setting() {
        // Traditional Chinese, German, Japanese.
        assert_eq!(overlay_locale_for(0x404), None);
        assert_eq!(overlay_locale_for(0x407), None);
        assert_eq!(overlay_locale_for(0x411), None);
    }
}
