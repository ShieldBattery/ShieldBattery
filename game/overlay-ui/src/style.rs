use std::sync::{Arc, LazyLock};

use egui::epaint::text::VariationCoords;
use egui::style::{ScrollStyle, TextStyle};
use egui::{FontData, FontDefinitions, FontFamily, FontTweak};

use crate::fonts::{self, DynamicFonts};
use crate::kit::theme;

// Latin and Cyrillic faces ship inside the binary: they are small, and the overlay must render
// even when nothing was installed beside it.
const INTER: &[u8] = include_bytes!("../../files/fonts/Inter-Variable.ttf");
const SOFIA_SANS: &[u8] = include_bytes!("../../files/fonts/SofiaSans-Variable.ttf");
const SOFIA_SANS_CONDENSED: &[u8] =
    include_bytes!("../../files/fonts/SofiaSansCondensed-Variable.ttf");
const DO_HYEON: &[u8] = include_bytes!("../../files/fonts/DoHyeon-Regular.ttf");

/// Installs the overlay's fonts and base style onto `ctx`.
///
/// Both the injected game DLL and the preview host call this, so egui lays the overlay out with the
/// same faces at the same weights, the same translucent windows, non-selectable labels and the same
/// default text sizes — the parity a host preview is worth anything for.
///
/// `dynamic` carries the faces that were found on disk; the families fall back to the embedded ones
/// for whatever is absent.
pub fn install_fonts_and_style(ctx: &egui::Context, dynamic: &DynamicFonts) {
    let mut fonts = FontDefinitions::default();
    // egui's own faces stay at the end of every family, so emoji and anything our faces miss still
    // resolves to a glyph rather than to a box.
    let default_tail = fonts
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();

    // The same file registered once per weight. `FontData` holds a `Cow`, so every weight borrows
    // the one autohinted copy instead of copying it again.
    insert(
        &mut fonts,
        fonts::INTER_400,
        embedded(&INTER_AUTOHINTED, 400.0),
    );
    insert(
        &mut fonts,
        fonts::INTER_500,
        embedded(&INTER_AUTOHINTED, 500.0),
    );
    insert(
        &mut fonts,
        fonts::INTER_550,
        embedded(&INTER_AUTOHINTED, 550.0),
    );
    insert(
        &mut fonts,
        fonts::INTER_600,
        embedded(&INTER_AUTOHINTED, 600.0),
    );
    insert(
        &mut fonts,
        fonts::SOFIA_600,
        embedded(&SOFIA_SANS_AUTOHINTED, 600.0),
    );
    insert(
        &mut fonts,
        fonts::CONDENSED_400,
        embedded(&SOFIA_SANS_CONDENSED_AUTOHINTED, 400.0),
    );
    insert(&mut fonts, fonts::DO_HYEON, FontData::from_static(DO_HYEON));

    // The CJK fallbacks are registered at one weight for every family: they are megabytes each, and
    // a second weight would be a second copy in memory for text that is rarely the focus of a
    // screen. Their `wght` axis defaults to 100, which is far too light to read over a game, so the
    // coordinate has to be set explicitly.
    //
    // Korean text takes one of two faces depending on what it is set in. Do Hyeon is a display face,
    // dense and blocky like Sofia Sans, which suits titles, names and buttons but turns small body
    // text and labels into dark smudges; Noto Sans KR is the plain face for those. Do Hyeon is
    // embedded and Noto Sans KR is not, so each chain ends in the other, and Korean renders in
    // something however much of the install is missing.
    let korean_display = [fonts::DO_HYEON, fonts::NOTO_KR];
    let korean_body = [fonts::NOTO_KR, fonts::DO_HYEON];
    if let Some(korean) = &dynamic.korean {
        insert(&mut fonts, fonts::NOTO_KR, loaded(korean.clone(), 400.0));
    }
    if let Some(chinese) = &dynamic.simplified_chinese {
        insert(&mut fonts, fonts::NOTO_SC, loaded(chinese.clone(), 400.0));
    }

    let registered = fonts.font_data.keys().cloned().collect::<Vec<_>>();
    let chain = |faces: &[&str], korean: &[&str]| -> Vec<String> {
        faces
            .iter()
            .chain(korean)
            .chain(&[fonts::NOTO_SC])
            .filter(|face| registered.iter().any(|name| name == **face))
            .map(|face| face.to_string())
            .chain(default_tail.iter().cloned())
            .collect()
    };
    let families = [
        (
            FontFamily::Proportional,
            chain(&[fonts::INTER_400], &korean_body),
        ),
        (
            fonts::body_medium(),
            chain(&[fonts::INTER_500], &korean_body),
        ),
        (
            fonts::body_strong(),
            chain(&[fonts::INTER_550], &korean_body),
        ),
        (
            fonts::body_semibold(),
            chain(&[fonts::INTER_600], &korean_body),
        ),
        (
            fonts::display(),
            chain(&[fonts::SOFIA_600], &korean_display),
        ),
        // Condensed carries numerals only; anything else typed in it borrows Inter's shapes rather
        // than falling all the way back to egui's default face.
        (
            fonts::condensed(),
            chain(&[fonts::CONDENSED_400, fonts::INTER_400], &korean_body),
        ),
    ];
    fonts.families.extend(families);
    ctx.set_fonts(fonts);

    let mut style_arc = ctx.global_style();
    let style = Arc::make_mut(&mut style_arc);
    // Make windows transparent
    style.visuals.window_fill = style.visuals.window_fill.gamma_multiply(0.7);
    // Don't want select/copy on text labels
    style.interaction.selectable_labels = false;

    // Scrollbars are the one stock egui control the overlay draws, so they are the one place its
    // widget palette shows. egui's default bar is a thin floating line that paints its handle in
    // the text color when hovered, which over a dark log flashes white; the overlay's is a solid
    // rail in the app's scrollbar greys, always visible where there is more to scroll to.
    style.visuals.extreme_bg_color = theme::SCROLLBAR_RAIL;
    style.visuals.widgets.inactive.bg_fill = theme::SCROLLBAR_HANDLE;
    style.visuals.widgets.hovered.bg_fill = theme::SCROLLBAR_HANDLE_HOVER;
    style.visuals.widgets.active.bg_fill = theme::SCROLLBAR_HANDLE_DRAG;
    let handle_radius = theme::radius(theme::SCROLLBAR_RADIUS);
    style.visuals.widgets.inactive.corner_radius = handle_radius;
    style.visuals.widgets.hovered.corner_radius = handle_radius;
    style.visuals.widgets.active.corner_radius = handle_radius;
    style.spacing.scroll = ScrollStyle {
        bar_width: theme::SCROLLBAR_WIDTH,
        bar_inner_margin: theme::SPACE_XS,
        bar_outer_margin: theme::SCROLLBAR_INSET,
        dormant_background_opacity: 1.0,
        active_background_opacity: 1.0,
        interact_background_opacity: 1.0,
        dormant_handle_opacity: 1.0,
        active_handle_opacity: 1.0,
        interact_handle_opacity: 1.0,
        ..ScrollStyle::solid()
    };

    // Increase default font sizes a bit.
    // 16.0 seems to give a size that roughly matches with the smallest text size BW uses.
    let text_styles = [
        (TextStyle::Small, 12.0),
        (TextStyle::Body, 16.0),
        (TextStyle::Button, 16.0),
        (TextStyle::Monospace, 16.0),
    ];
    for &(ref text_style, size) in &text_styles {
        if let Some(font) = style.text_styles.get_mut(text_style) {
            font.size = size;
        }
    }
    // Glyphs start on whole pixels. Binning places each one at a quarter-pixel offset instead, which
    // evens out spacing but smears every stem across two pixel columns.
    style.visuals.text_options.subpixel_binning = false;
    ctx.set_global_style(style_arc);
}

/// The Latin faces as egui reads them: with their TrueType `prep` program emptied, so they are
/// autohinted.
///
/// Inter and Sofia Sans carry no hinting of their own, only a `prep` that sets dropout control,
/// which matters to 1-bit rendering alone. Its presence is still enough for the rasterizer
/// (following FreeType) to run the TrueType interpreter instead of its autohinter, so their outlines
/// would be drawn unhinted, with x-heights and horizontal stems straddling pixel rows: soft at every
/// size the overlay is drawn at, and softest at the fractional ones 1440p gives. Emptied, the faces
/// are autohinted and those edges land on whole pixels.
static INTER_AUTOHINTED: LazyLock<Vec<u8>> = LazyLock::new(|| without_prep_program(INTER));
static SOFIA_SANS_AUTOHINTED: LazyLock<Vec<u8>> =
    LazyLock::new(|| without_prep_program(SOFIA_SANS));
static SOFIA_SANS_CONDENSED_AUTOHINTED: LazyLock<Vec<u8>> =
    LazyLock::new(|| without_prep_program(SOFIA_SANS_CONDENSED));

/// A copy of the TrueType font `font` whose `prep` table is zero bytes long. The table's bytes stay
/// where they are; only its directory record stops pointing at them.
fn without_prep_program(font: &[u8]) -> Vec<u8> {
    const TABLE_RECORDS: usize = 12;
    const TABLE_RECORD_LEN: usize = 16;
    const RECORD_LENGTH_FIELD: usize = 12;
    let mut font = font.to_vec();
    let table_count = font
        .get(4..6)
        .map(|count| usize::from(u16::from_be_bytes([count[0], count[1]])))
        .unwrap_or(0);
    for index in 0..table_count {
        let record = TABLE_RECORDS + index * TABLE_RECORD_LEN;
        if font.get(record..record + 4) == Some(b"prep") {
            let length = record + RECORD_LENGTH_FIELD;
            if let Some(field) = font.get_mut(length..length + 4) {
                field.copy_from_slice(&0u32.to_be_bytes());
            }
        }
    }
    font
}

fn insert(fonts: &mut FontDefinitions, name: &str, data: FontData) {
    fonts.font_data.insert(name.to_string(), Arc::new(data));
}

/// An embedded variable face with its weight axis pinned.
fn embedded(bytes: &'static [u8], weight: f32) -> FontData {
    FontData::from_static(bytes).tweak(weight_tweak(weight))
}

/// A disk-loaded variable face with its weight axis pinned.
fn loaded(bytes: Vec<u8>, weight: f32) -> FontData {
    FontData::from_owned(bytes).tweak(weight_tweak(weight))
}

fn weight_tweak(weight: f32) -> FontTweak {
    FontTweak {
        coords: VariationCoords::new([(b"wght", weight)]),
        ..FontTweak::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The length the table directory of `font` gives the table `tag`, if it has one.
    fn table_length(font: &[u8], tag: &[u8; 4]) -> Option<u32> {
        let count = usize::from(u16::from_be_bytes([font[4], font[5]]));
        (0..count).map(|index| 12 + index * 16).find_map(|record| {
            (&font[record..record + 4] == tag)
                .then(|| u32::from_be_bytes(font[record + 12..record + 16].try_into().unwrap()))
        })
    }

    #[test]
    fn latin_faces_are_left_to_the_autohinter() {
        for (shipped, read) in [
            (INTER, &*INTER_AUTOHINTED),
            (SOFIA_SANS, &*SOFIA_SANS_AUTOHINTED),
            (SOFIA_SANS_CONDENSED, &*SOFIA_SANS_CONDENSED_AUTOHINTED),
        ] {
            // A face that gained real hinting would be worth keeping: its instructions would sit in
            // `fpgm`, and emptying `prep` alone would break them rather than hand over to the
            // autohinter.
            assert_eq!(table_length(shipped, b"fpgm"), None);
            assert!(table_length(shipped, b"prep").is_some_and(|length| length > 0));
            assert_eq!(table_length(read, b"prep"), Some(0));
            assert_eq!(read.len(), shipped.len());
            assert_eq!(table_length(read, b"glyf"), table_length(shipped, b"glyf"));
        }
    }
}
