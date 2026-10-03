use std::sync::Arc;

use egui::epaint::text::VariationCoords;
use egui::style::TextStyle;
use egui::{FontData, FontDefinitions, FontTweak};

use crate::fonts::{body_medium, condensed, display_family};

/// Installs the overlay's custom fonts and base style onto `ctx`.
///
/// Both the injected game DLL and the preview host call this, so egui lays the overlay out with the
/// same faces (Inter for proportional text, Sofia Sans SemiBold for the display family, with Do
/// Hyeon as a Korean fallback), the same translucent windows, non-selectable labels, and the same
/// enlarged default text sizes — the parity the host preview depends on.
pub fn install_fonts_and_style(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    fonts.font_data.insert(
        "inter".to_string(),
        Arc::new(FontData::from_static(include_bytes!(
            "../../files/fonts/Inter-Regular.ttf"
        ))),
    );
    fonts.font_data.insert(
        "inter-medium".to_string(),
        Arc::new(FontData::from_static(include_bytes!(
            "../../files/fonts/Inter-Medium.ttf"
        ))),
    );
    // A variable face: its weight axis has to be pinned, or egui renders its default instance.
    fonts.font_data.insert(
        "Sofia Sans Condensed".to_string(),
        Arc::new(
            FontData::from_static(include_bytes!(
                "../../files/fonts/SofiaSansCondensed-Variable.ttf"
            ))
            .tweak(FontTweak {
                coords: VariationCoords::new([(b"wght", 400.0)]),
                ..FontTweak::default()
            }),
        ),
    );
    fonts.font_data.insert(
        "Sofia Sans SemiBold".to_string(),
        Arc::new(FontData::from_static(include_bytes!(
            "../../files/fonts/SofiaSans-SemiBold.ttf"
        ))),
    );
    fonts.font_data.insert(
        "Do Hyeon".to_string(),
        Arc::new(FontData::from_static(include_bytes!(
            "../../files/fonts/DoHyeon-Regular.ttf"
        ))),
    );

    fonts
        .families
        .entry(egui::FontFamily::Proportional)
        .or_default()
        .insert(0, "inter".to_string());
    let entry = fonts.families.entry(display_family()).or_default();
    entry.insert(0, "Sofia Sans SemiBold".to_string());
    // Fallback for Korean characters
    entry.insert(1, "Do Hyeon".to_string());
    fonts
        .families
        .insert(body_medium(), vec!["inter-medium".to_string()]);
    // Condensed carries numerals only; anything else typed in it borrows Inter's shapes.
    fonts.families.insert(
        condensed(),
        vec!["Sofia Sans Condensed".to_string(), "inter".to_string()],
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
