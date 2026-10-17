//! The options screen's pages. Each is a list of rows in the order the app's own settings page
//! lists them, so the two screens read the same way down. Where the app explains a setting in a
//! tooltip, the line under the row says the same thing, since a hover is a poor thing to ask for over
//! a game in progress.

mod gameplay;
mod input;
mod network;
mod sound;
mod video;

use egui::Ui;

use super::{OptionsLists, OptionsOutcome, OptionsSection, OptionsView};

/// Draws the rows of `section`.
pub(super) fn draw(
    ui: &mut Ui,
    section: OptionsSection,
    view: &OptionsView,
    lists: &OptionsLists,
    outcome: &mut OptionsOutcome,
) {
    match section {
        OptionsSection::Input => input::draw(ui, view, outcome),
        OptionsSection::Sound => sound::draw(ui, view, outcome),
        OptionsSection::Video => video::draw(ui, view, lists, outcome),
        OptionsSection::Gameplay => gameplay::draw(ui, view, outcome),
        OptionsSection::Network => network::draw(ui, view, lists, outcome),
    }
}
