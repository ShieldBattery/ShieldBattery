//! The overlay's font families, and the large faces it loads from disk rather than embedding.
//!
//! Every family is a fallback chain: a Latin/Cyrillic face of one weight, then the Korean and
//! Simplified Chinese faces, then egui's own defaults. Weight is a property of the family rather
//! than of a call site, because egui picks faces per family: the same variable font file is
//! registered once per weight the design uses, with the `wght` axis pinned, and a call site asks
//! for the weight it wants by naming that family.

use std::path::Path;

use egui::FontFamily;

/// Name the Korean face takes in the dynamic font directory.
const KOREAN_FILE: &str = "NotoSansKR-Hangul.ttf";

/// Name the Simplified Chinese face takes in the dynamic font directory.
const SIMPLIFIED_CHINESE_FILE: &str = "NotoSansSC-GB2312.ttf";

/// Directory name the dynamic faces are read from, relative to whoever hosts the overlay.
pub const DYNAMIC_FONT_DIR: &str = "fonts";

// The names each registered face and named family goes by. A named family reuses its face's name
// where it holds exactly one face, so a family and its face never drift apart.
pub(crate) const INTER_400: &str = "inter-400";
pub(crate) const INTER_500: &str = "inter-500";
pub(crate) const INTER_550: &str = "inter-550";
pub(crate) const INTER_600: &str = "inter-600";
pub(crate) const SOFIA_600: &str = "sofia-600";
pub(crate) const CONDENSED_400: &str = "condensed-400";
pub(crate) const DO_HYEON: &str = "do-hyeon";
pub(crate) const NOTO_KR: &str = "noto-kr";
pub(crate) const NOTO_SC: &str = "noto-sc";
pub(crate) const DISPLAY_FAMILY: &str = "display";
pub(crate) const CONDENSED_FAMILY: &str = "condensed";

/// The faces that are too large to embed and are read from disk at startup instead.
///
/// A missing file is not an error. The embedded faces already cover Latin, Cyrillic and the common
/// Korean syllables, so an install without these renders everything except rare Hangul and every
/// hanzi, and is still worth showing.
#[derive(Default)]
pub struct DynamicFonts {
    pub(crate) korean: Option<Vec<u8>>,
    pub(crate) simplified_chinese: Option<Vec<u8>>,
}

impl DynamicFonts {
    /// Whether any face was found, which is what decides if a CJK-capable chain exists beyond the
    /// embedded Korean face.
    pub fn is_empty(&self) -> bool {
        self.korean.is_none() && self.simplified_chinese.is_none()
    }
}

/// Reads whichever dynamic faces `dir` holds.
///
/// Both hosts load them the same way — the game DLL from the directory beside itself, the preview
/// from the checkout — so a face that renders in one renders in the other.
pub fn load_dynamic_fonts(dir: &Path) -> DynamicFonts {
    DynamicFonts {
        korean: std::fs::read(dir.join(KOREAN_FILE)).ok(),
        simplified_chinese: std::fs::read(dir.join(SIMPLIFIED_CHINESE_FILE)).ok(),
    }
}

/// Body text at weight 400.
pub fn body() -> FontFamily {
    FontFamily::Proportional
}

/// Body text at weight 500, for column labels and text that has to hold its own next to a numeral.
pub fn body_medium() -> FontFamily {
    FontFamily::Name(INTER_500.into())
}

/// Body text at weight 550, the heaviest body weight the design uses inline.
pub fn body_strong() -> FontFamily {
    FontFamily::Name(INTER_550.into())
}

/// Body text at weight 600, for short emphatic runs inside body copy.
pub fn body_semibold() -> FontFamily {
    FontFamily::Name(INTER_600.into())
}

/// Sofia Sans 600: titles, player names and button labels.
pub fn display() -> FontFamily {
    FontFamily::Name(DISPLAY_FAMILY.into())
}

/// Sofia Sans Condensed 400: every numeral, so columns of numbers stay narrow and aligned.
pub fn condensed() -> FontFamily {
    FontFamily::Name(CONDENSED_FAMILY.into())
}
