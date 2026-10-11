//! The players a game can be watched as: what each of them saw and did, as the host has recorded it.
//!
//! A game the host has recorded a player's camera and cursor for, whether a replay or one being
//! watched live, can be shown through that player's eyes, the view following where they looked and
//! their cursor and selection drawn over it. The host owns the following and the drawing; what the
//! overlay draws is the choice of whose perspective it is and of which parts of it to show, in a row
//! of the minimap's frame (see [`super::minimap`]).

use egui::Color32;

/// The perspectives the host has recorded for the game, and which of them the watcher is shown.
pub struct PerspectiveView {
    /// The recorded perspectives, in the order the host numbers them.
    pub choices: Vec<PerspectiveChoice>,
    /// Index into `choices` of the one being shown, if any.
    pub shown: Option<usize>,
    /// Whether the shown player's camera is followed and their cursor drawn.
    pub camera: bool,
    /// Whether the shown player's selection and clicks are shown.
    pub actions: bool,
    /// While the watcher has moved the camera away from a followed player's: how much of the wait
    /// before it follows again is left, from 1.0 down to 0.0. `None` when the camera is not
    /// overridden.
    pub camera_returns: Option<f32>,
}

/// One player whose perspective was recorded.
pub struct PerspectiveChoice {
    pub name: String,
    /// The player's color, which their choice is marked with as their rows elsewhere are.
    pub color: Color32,
}

impl PerspectiveView {
    /// The perspective being shown, if there is one to show.
    pub(crate) fn shown_choice(&self) -> Option<&PerspectiveChoice> {
        self.shown.and_then(|index| self.choices.get(index))
    }
}
