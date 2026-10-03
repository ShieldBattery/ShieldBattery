/// Returns the FontFamily used for Display text.
pub fn display_family() -> egui::FontFamily {
    egui::FontFamily::Name("display".into())
}

/// Inter at weight 500, for small labels that sit beside a value.
pub fn body_medium() -> egui::FontFamily {
    egui::FontFamily::Name("body-medium".into())
}

/// Sofia Sans Condensed at weight 400, for numerals that have to fit a narrow fixed slot.
pub fn condensed() -> egui::FontFamily {
    egui::FontFamily::Name("condensed".into())
}
