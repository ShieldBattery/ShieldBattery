//! The overlay's type styles.
//!
//! A [`TextSpec`] is a font, a color and its tracking together, because the design's styles are all
//! three at once: a panel title is not Sofia 13 that happens to be uppercase, it is uppercase Sofia
//! 13 tracked by 1.8. Every style hands out a [`LayoutJob`] rather than a `RichText`, since
//! `RichText` cannot carry letter spacing and silently dropping the tracking would make two call
//! sites of the same style disagree.

use std::sync::Arc;

use egui::text::{LayoutJob, TextFormat, TextWrapping};
use egui::{Align, Color32, FontFamily, FontId, Galley, Ui};

use crate::fonts;
use crate::kit::theme;

/// The smallest size anything renders at. Below this the overlay is unreadable over gameplay, so
/// sizes are clamped rather than trusted.
pub const MIN_SIZE: f32 = 11.0;

/// The weights body copy is set in.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BodyWeight {
    Regular,
    Medium,
    Strong,
    Semibold,
}

impl BodyWeight {
    fn family(self) -> FontFamily {
        match self {
            BodyWeight::Regular => fonts::body(),
            BodyWeight::Medium => fonts::body_medium(),
            BodyWeight::Strong => fonts::body_strong(),
            BodyWeight::Semibold => fonts::body_semibold(),
        }
    }
}

/// One type style: the face and size, the color, the tracking, and whether the style speaks in
/// capitals.
#[derive(Clone)]
pub struct TextSpec {
    pub font: FontId,
    pub color: Color32,
    pub letter_spacing: f32,
    pub uppercase: bool,
}

impl TextSpec {
    fn new(size: f32, family: FontFamily, color: Color32) -> TextSpec {
        TextSpec {
            font: FontId::new(size.max(MIN_SIZE), family),
            color,
            letter_spacing: 0.0,
            uppercase: false,
        }
    }

    /// The same style in another color, for the rows where a value carries its own meaning.
    pub fn with_color(mut self, color: Color32) -> TextSpec {
        self.color = color;
        self
    }

    /// The same style at another size, clamped to the readable minimum.
    pub fn with_size(mut self, size: f32) -> TextSpec {
        self.font.size = size.max(MIN_SIZE);
        self
    }

    pub fn format(&self) -> TextFormat {
        TextFormat {
            font_id: self.font.clone(),
            extra_letter_spacing: self.letter_spacing,
            color: self.color,
            valign: Align::Center,
            ..TextFormat::default()
        }
    }

    /// The text as a single-line job in this style, with the style's capitalization applied.
    pub fn job(&self, text: &str) -> LayoutJob {
        let mut job = LayoutJob::single_section(self.apply_case(text), self.format());
        job.wrap = TextWrapping::no_max_width();
        job
    }

    /// The text as a job that wraps at `wrap_width`.
    pub fn job_wrapped(&self, text: &str, wrap_width: f32) -> LayoutJob {
        let mut job = self.job(text);
        job.wrap.max_width = wrap_width;
        job
    }

    /// Lays the text out now, for widgets that paint their own label and need its size first.
    pub fn galley(&self, ui: &Ui, text: &str) -> Arc<Galley> {
        let job = self.job(text);
        ui.ctx().fonts_mut(|fonts| fonts.layout_job(job))
    }

    /// How tall one line of this style is.
    pub fn row_height(&self, ui: &Ui) -> f32 {
        let font = self.font.clone();
        ui.ctx().fonts_mut(|fonts| fonts.row_height(&font))
    }

    fn apply_case(&self, text: &str) -> String {
        if self.uppercase {
            caps(text)
        } else {
            text.to_string()
        }
    }
}

/// The title of a modal dialog.
pub fn dialog_title() -> TextSpec {
    TextSpec::new(22.0, fonts::display(), theme::ACCENT)
}

/// The title of a panel, in capitals with the tracking that keeps them from clumping.
pub fn panel_title() -> TextSpec {
    TextSpec {
        letter_spacing: 1.8,
        uppercase: true,
        ..TextSpec::new(13.0, fonts::display(), theme::TIER0_HEADER)
    }
}

/// The title of a hero panel: the panel style in the tier's own amber.
pub fn hero_title() -> TextSpec {
    panel_title().with_color(theme::TIER1_HEADER)
}

/// Any number the player reads as a quantity: resources, timers, rates, percentages.
pub fn numeral(size: f32) -> TextSpec {
    TextSpec::new(size, fonts::condensed(), theme::TEXT_PRIMARY)
}

/// A player's name, which the design sets in the display face at a size that survives a glance.
pub fn player_name(size: f32) -> TextSpec {
    TextSpec::new(size, fonts::display(), theme::TEXT_PRIMARY)
}

/// Running text.
pub fn body(size: f32, weight: BodyWeight) -> TextSpec {
    TextSpec::new(size, weight.family(), theme::TEXT_PRIMARY)
}

/// The heading over a column of values.
pub fn column_label() -> TextSpec {
    TextSpec {
        letter_spacing: 0.8,
        uppercase: true,
        ..TextSpec::new(11.0, fonts::body_medium(), theme::TEXT_LABEL)
    }
}

/// A button's single-verb label.
pub fn button_label(size: f32) -> TextSpec {
    TextSpec {
        letter_spacing: 1.8,
        uppercase: true,
        ..TextSpec::new(size, fonts::display(), theme::TEXT_PRIMARY)
    }
}

/// Uppercases `text` unless it contains CJK.
///
/// Hangul, Han and Kana have no case, and a string containing them was written the way it is meant
/// to be read: uppercasing the Latin fragments around them would leave a sentence shouting in one
/// half and speaking in the other. The tracking of a capitalized style still applies, which is what
/// keeps such a label the same shape as its siblings.
pub fn caps(text: &str) -> String {
    if text.chars().any(is_cjk) {
        text.to_string()
    } else {
        text.to_uppercase()
    }
}

/// Whether `c` belongs to a script that has no case distinction and must be left as written.
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x11FF        // Hangul jamo
        | 0x3040..=0x30FF      // Hiragana and katakana
        | 0x3130..=0x318F      // Hangul compatibility jamo
        | 0x31F0..=0x31FF      // Katakana phonetic extensions
        | 0x3400..=0x4DBF      // Han, extension A
        | 0x4E00..=0x9FFF      // Han
        | 0xA960..=0xA97F      // Hangul jamo extended-A
        | 0xAC00..=0xD7A3      // Hangul syllables
        | 0xD7B0..=0xD7FF      // Hangul jamo extended-B
        | 0xF900..=0xFAFF      // Han compatibility ideographs
        | 0x20000..=0x3FFFF    // Han, supplementary planes
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_leaves_caseless_scripts_alone() {
        assert_eq!(caps("options"), "OPTIONS");
        assert_eq!(caps("Русский текст"), "РУССКИЙ ТЕКСТ");
        assert_eq!(caps("한국어 텍스트"), "한국어 텍스트");
        assert_eq!(caps("简体中文"), "简体中文");
        // A mixed string is left as written rather than half-shouted.
        assert_eq!(caps("save 설정"), "save 설정");
    }

    #[test]
    fn sizes_never_fall_below_the_readable_minimum() {
        assert_eq!(numeral(8.0).font.size, MIN_SIZE);
        assert_eq!(
            body(9.0, BodyWeight::Regular).with_size(4.0).font.size,
            MIN_SIZE
        );
    }
}
