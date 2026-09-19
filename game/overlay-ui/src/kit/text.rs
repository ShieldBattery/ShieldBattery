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

    /// The same style tracked differently, for a label set tighter or looser than its style's own.
    pub fn with_letter_spacing(mut self, letter_spacing: f32) -> TextSpec {
        self.letter_spacing = letter_spacing;
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

    /// The text as a job that wraps at `wrap_width` with its lines centred on each other.
    ///
    /// The job's origin is then the middle of the block rather than its left edge, which is what a
    /// caller painting the galley has to place it by.
    pub fn job_centered(&self, text: &str, wrap_width: f32) -> LayoutJob {
        let mut job = self.job_wrapped(text, wrap_width);
        job.halign = Align::Center;
        job
    }

    /// The text as a single-line job that elides with an ellipsis rather than growing past
    /// `max_width`.
    ///
    /// What a translated or player-chosen string may not do is push a layout wider than the space
    /// it was given: a name column that grows with its longest name moves every column beside it.
    pub fn job_truncated(&self, text: &str, max_width: f32) -> LayoutJob {
        let mut job = self.job(text);
        job.wrap = TextWrapping {
            max_width,
            max_rows: 1,
            break_anywhere: true,
            overflow_character: Some('\u{2026}'),
        };
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

/// How many control characters BW's text encoding reserves. A byte below this is a directive to
/// the renderer rather than a character to draw.
pub const BW_CONTROL_CODE_COUNT: usize = 0x20;

/// The text color each of BW's inline control characters selects, indexed by the control character's
/// own value. `None` marks a code that selects no color — an alignment or visibility directive, or
/// a value the renderer ignores — and such a code is dropped from the text rather than drawn.
///
/// The hues are BW's; the lightness is not. BW draws chat over the game's own console band, and
/// several of its codes (player 6's brown, player 9's green, player 2's blue) are dark enough that a
/// literal copy would be unreadable on the overlay's surfaces. Each is lifted to a value that reads
/// at body size while staying the color the sender picked.
pub fn bw_chat_colors() -> [Option<Color32>; BW_CONTROL_CODE_COUNT] {
    BW_CHAT_COLORS
}

const BW_CHAT_COLORS: [Option<Color32>; BW_CONTROL_CODE_COUNT] = {
    let mut colors = [None; BW_CONTROL_CODE_COUNT];
    colors[0x02] = Some(Color32::from_rgb(0x9A, 0xB2, 0xFF)); // pale blue
    colors[0x03] = Some(Color32::from_rgb(0xFC, 0xFC, 0x5C)); // yellow
    colors[0x04] = Some(Color32::from_rgb(0xED, 0xF7, 0xFE)); // white
    colors[0x05] = Some(Color32::from_rgb(0x91, 0x98, 0xA1)); // grey
    colors[0x06] = Some(Color32::from_rgb(0xFF, 0x5E, 0x5E)); // red
    colors[0x07] = Some(Color32::from_rgb(0x6A, 0xE3, 0x7E)); // green
    colors[0x08] = Some(Color32::from_rgb(0xF4, 0x4A, 0x4A)); // player 1, red
    colors[0x0E] = Some(Color32::from_rgb(0x58, 0x8C, 0xFF)); // player 2, blue
    colors[0x0F] = Some(Color32::from_rgb(0x3C, 0xD0, 0xAC)); // player 3, teal
    colors[0x10] = Some(Color32::from_rgb(0xB0, 0x74, 0xC8)); // player 4, purple
    colors[0x11] = Some(Color32::from_rgb(0xF8, 0x96, 0x28)); // player 5, orange
    colors[0x15] = Some(Color32::from_rgb(0xBA, 0x7A, 0x54)); // player 6, brown
    colors[0x16] = Some(Color32::from_rgb(0xCC, 0xE0, 0xD0)); // player 7, white
    colors[0x17] = Some(Color32::from_rgb(0xFC, 0xFC, 0x5C)); // player 8, yellow
    colors[0x18] = Some(Color32::from_rgb(0x4C, 0xC4, 0x4C)); // player 9, green
    colors[0x19] = Some(Color32::from_rgb(0xFC, 0xFC, 0x94)); // player 10, pale yellow
    colors[0x1B] = Some(Color32::from_rgb(0x8C, 0xEC, 0x98)); // pale green
    colors[0x1C] = Some(Color32::from_rgb(0x96, 0xA0, 0xC8)); // blue-grey
    colors[0x1D] = Some(Color32::from_rgb(0x3C, 0xDC, 0xF4)); // cyan
    colors[0x1E] = Some(Color32::from_rgb(0x48, 0xD4, 0xC4)); // turquoise
    colors[0x1F] = Some(Color32::from_rgb(0xA0, 0xE8, 0xE0)); // pale turquoise
    colors
};

/// Lays `text` out in `spec`, reading BW's inline color codes the way the game does: a control
/// character colors everything after it, and the control characters themselves never draw. Wraps at
/// `wrap_width`.
///
/// A run before any code takes the spec's own color, so text that selects none reads as the style
/// meant it to. The spec's capitalization is deliberately not applied: this is text a player typed,
/// and shouting it back at them is not the overlay's to do.
pub fn bw_colored_job(spec: &TextSpec, text: &str, wrap_width: f32) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap_width;
    append_bw_colored(&mut job, spec, text, 0.0);
    job
}

/// Appends `text` to `job` the way [`bw_colored_job`] lays it out, for a line that carries
/// something in front of the player's words. `leading_space` is the gap before the first run,
/// and only the first: a color code changes nothing about where the words sit.
pub fn append_bw_colored(job: &mut LayoutJob, spec: &TextSpec, text: &str, leading_space: f32) {
    let colors = bw_chat_colors();
    let mut format = spec.format();
    let mut run = String::new();
    let mut leading_space = leading_space;
    for c in text.chars() {
        let code = c as usize;
        if code >= BW_CONTROL_CODE_COUNT {
            run.push(c);
            continue;
        }
        if let Some(color) = colors[code] {
            if !run.is_empty() {
                job.append(&run, leading_space, format.clone());
                leading_space = 0.0;
                run.clear();
            }
            format.color = color;
        }
    }
    if !run.is_empty() {
        job.append(&run, leading_space, format);
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

    /// The text of every section of `job`, paired with the color it is drawn in.
    fn sections(job: &LayoutJob) -> Vec<(String, Color32)> {
        job.sections
            .iter()
            .map(|section| {
                (
                    job.text[section.byte_range.start.0..section.byte_range.end.0].to_string(),
                    section.format.color,
                )
            })
            .collect()
    }

    fn body_spec() -> TextSpec {
        body(13.0, BodyWeight::Regular)
    }

    #[test]
    fn text_without_codes_stays_one_run_in_the_specs_own_color() {
        let spec = body_spec();
        let job = bw_colored_job(&spec, "gl hf", f32::INFINITY);
        assert_eq!(sections(&job), vec![("gl hf".to_string(), spec.color)]);
    }

    #[test]
    fn a_color_code_colors_everything_after_it_and_never_draws() {
        let spec = body_spec();
        let job = bw_colored_job(&spec, "gg \x06wp \x07nice", f32::INFINITY);
        let red = bw_chat_colors()[0x06].unwrap();
        let green = bw_chat_colors()[0x07].unwrap();
        assert_eq!(
            sections(&job),
            vec![
                ("gg ".to_string(), spec.color),
                ("wp ".to_string(), red),
                ("nice".to_string(), green),
            ]
        );
        assert!(!job.text.contains('\x06'));
    }

    #[test]
    fn codes_that_select_no_color_are_dropped_without_splitting_the_run() {
        let spec = body_spec();
        // 0x0b/0x0c are BW's invisible codes and 0x12/0x13 its alignment marks: none of them is a
        // color, and none of them is text.
        let job = bw_colored_job(&spec, "\x13cen\x0btred\x12", f32::INFINITY);
        assert_eq!(sections(&job), vec![("centred".to_string(), spec.color)]);
    }

    #[test]
    fn a_line_of_nothing_but_codes_lays_out_empty() {
        let job = bw_colored_job(&body_spec(), "\x06\x07\x04", f32::INFINITY);
        assert!(job.sections.is_empty());
        assert!(job.text.is_empty());
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
