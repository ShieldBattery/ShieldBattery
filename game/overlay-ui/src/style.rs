use std::sync::Arc;

use egui::epaint::text::VariationCoords;
use egui::style::TextStyle;
use egui::{FontData, FontDefinitions, FontFamily, FontTweak};

use crate::fonts::{self, DynamicFonts};

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

    // The same file registered once per weight. `FontData` holds a `Cow`, so the extra weights
    // borrow the embedded bytes instead of copying them.
    insert(&mut fonts, fonts::INTER_400, embedded(INTER, 400.0));
    insert(&mut fonts, fonts::INTER_500, embedded(INTER, 500.0));
    insert(&mut fonts, fonts::INTER_550, embedded(INTER, 550.0));
    insert(&mut fonts, fonts::INTER_600, embedded(INTER, 600.0));
    insert(&mut fonts, fonts::SOFIA_600, embedded(SOFIA_SANS, 600.0));
    insert(
        &mut fonts,
        fonts::CONDENSED_400,
        embedded(SOFIA_SANS_CONDENSED, 400.0),
    );
    insert(&mut fonts, fonts::DO_HYEON, FontData::from_static(DO_HYEON));

    // The CJK fallbacks are registered at one weight for every family: they are megabytes each, and
    // a second weight would be a second copy in memory for text that is rarely the focus of a
    // screen. Their `wght` axis defaults to 100, which is far too light to read over a game, so the
    // coordinate has to be set explicitly.
    let mut cjk = vec![fonts::DO_HYEON.to_string()];
    if let Some(korean) = &dynamic.korean {
        insert(&mut fonts, fonts::NOTO_KR, loaded(korean.clone(), 400.0));
        cjk.push(fonts::NOTO_KR.to_string());
    }
    if let Some(chinese) = &dynamic.simplified_chinese {
        insert(&mut fonts, fonts::NOTO_SC, loaded(chinese.clone(), 400.0));
        cjk.push(fonts::NOTO_SC.to_string());
    }

    let chain = |faces: &[&str]| -> Vec<String> {
        faces
            .iter()
            .map(|face| face.to_string())
            .chain(cjk.iter().cloned())
            .chain(default_tail.iter().cloned())
            .collect()
    };
    fonts
        .families
        .insert(FontFamily::Proportional, chain(&[fonts::INTER_400]));
    fonts
        .families
        .insert(fonts::body_medium(), chain(&[fonts::INTER_500]));
    fonts
        .families
        .insert(fonts::body_strong(), chain(&[fonts::INTER_550]));
    fonts
        .families
        .insert(fonts::body_semibold(), chain(&[fonts::INTER_600]));
    fonts
        .families
        .insert(fonts::display(), chain(&[fonts::SOFIA_600]));
    // Condensed carries numerals only; anything else typed in it borrows Inter's shapes rather than
    // falling all the way back to egui's default face.
    fonts.families.insert(
        fonts::condensed(),
        chain(&[fonts::CONDENSED_400, fonts::INTER_400]),
    );
    ctx.set_fonts(fonts);

    let mut style_arc = ctx.global_style();
    let style = Arc::make_mut(&mut style_arc);
    // Make windows transparent
    style.visuals.window_fill = style.visuals.window_fill.gamma_multiply(0.7);
    // Don't want select/copy on text labels
    style.interaction.selectable_labels = false;

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
    ctx.set_global_style(style_arc);
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
