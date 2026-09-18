//! The observer and replay panel set: what a watcher is told about a game they are not playing.
//!
//! Like every other screen here, each panel is a plain-data view-model plus a pure render fn over
//! it and an [`egui::Context`], so the injected game DLL and the preview host draw the same pixels
//! from the same code. The DLL builds the view-models from BW's own state once per frame; the
//! preview builds them from a simulated game.
//!
//! One [`ObserverView`] carries the whole set, because the panels are read together: a watcher
//! glancing at production is reading it against the supply and the bank on the matchup bar. The
//! shell decides which of them are on screen and what a click on one asks of the game.

mod dock;
mod matchup;
mod production;

pub use dock::{DockOutcome, render_obs_dock};
pub use matchup::{MatchupOutcome, MatchupPlayerView, MatchupView, render_matchup_view};
pub use production::{
    ProductionIcon, ProductionItemView, ProductionOutcome, ProductionPlayerView, ProductionView,
    render_production_view,
};

use egui::{Align, Color32, Rect, Stroke, StrokeKind, Ui, pos2, vec2};
use serde::{Deserialize, Serialize};

use crate::colors::{PROTOSS, RANDOM, TERRAN, ZERG};
use crate::kit::text::TextSpec;
use crate::kit::theme;
use crate::tr;

/// Everything the observer panels draw from this frame.
///
/// A host builds it for every frame it is watching a game, whether or not any panel is on screen:
/// the panels are toggled by keys that arrive between frames, and only the shell knows which of
/// them the watcher has hidden.
pub struct ObserverView {
    pub matchup: MatchupView,
    pub production: ProductionView,
}

/// The race a player is playing, which decides the color and the letter of their chip.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum RaceView {
    Zerg,
    Terran,
    Protoss,
    /// Picked at random, and not yet resolved into one of the three.
    #[default]
    Random,
}

impl RaceView {
    pub const ALL: [RaceView; 4] = [
        RaceView::Zerg,
        RaceView::Terran,
        RaceView::Protoss,
        RaceView::Random,
    ];

    /// The race's own color, which its chip is drawn in.
    pub fn color(self) -> Color32 {
        match self {
            RaceView::Zerg => ZERG,
            RaceView::Terran => TERRAN,
            RaceView::Protoss => PROTOSS,
            RaceView::Random => RANDOM,
        }
    }

    /// The single letter that stands for the race on a chip.
    ///
    /// Translated, because the letter is an abbreviation of the race's name rather than a symbol:
    /// a Korean reader expects the first syllable of the Korean name, not a `Z`.
    pub fn letter(self) -> String {
        match self {
            RaceView::Zerg => tr!("observer.raceZerg", "Z"),
            RaceView::Terran => tr!("observer.raceTerran", "T"),
            RaceView::Protoss => tr!("observer.raceProtoss", "P"),
            RaceView::Random => tr!("observer.raceRandom", "R"),
        }
    }

    /// A short name for this race in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            RaceView::Zerg => "zerg",
            RaceView::Terran => "terran",
            RaceView::Protoss => "protoss",
            RaceView::Random => "random",
        }
    }
}

/// Game time as the panels write it: `m:ss`, growing an hours field only once there is one.
///
/// A clock that carried a leading `0:` all game would spend two of its characters on nothing, and a
/// clock that dropped the hour once a game ran long would read as having restarted.
pub fn game_clock(seconds: u64) -> String {
    let minutes = seconds / 60;
    let seconds = seconds % 60;
    if minutes >= 60 {
        format!("{}:{:02}:{:02}", minutes / 60, minutes % 60, seconds)
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// Paints one line of text into a rect the caller has already placed, aligned within it and elided
/// rather than allowed to grow past it.
///
/// The observer panels place their cells by arithmetic rather than by egui layouts: their geometry
/// is fixed by the design and must not move as a number gains a digit or a name is translated, and
/// a cell that is drawn where the design puts it is easier to check against the design than one
/// that is the sum of everything laid out before it.
pub(crate) fn paint_text(ui: &Ui, rect: Rect, spec: &TextSpec, text: &str, align: Align) {
    if text.is_empty() || !ui.is_rect_visible(rect) {
        return;
    }
    let job = spec.job_truncated(text, rect.width());
    let galley = ui.ctx().fonts_mut(|fonts| fonts.layout_job(job));
    let x = match align {
        Align::RIGHT => rect.right() - galley.size().x,
        Align::Center => rect.center().x - galley.size().x * 0.5,
        Align::LEFT => rect.left(),
    };
    ui.painter().galley(
        pos2(x, rect.center().y - galley.size().y * 0.5),
        galley,
        spec.color,
    );
}

/// Paints a player's race chip: a ring in the race's color with the race's letter inside it.
pub(crate) fn paint_race_chip(ui: &Ui, rect: Rect, race: RaceView, alpha: f32) {
    let diameter = rect.width().min(rect.height());
    let color = race.color().gamma_multiply(alpha);
    let centre = rect.center();
    ui.painter()
        .circle_filled(centre, diameter * 0.5, color.gamma_multiply(0.16));
    ui.painter().circle_stroke(
        centre,
        diameter * 0.5 - theme::HAIRLINE * 0.5,
        Stroke::new(theme::HAIRLINE, color),
    );
    let spec = crate::kit::text::player_name(diameter * 0.54).with_color(color);
    paint_text(ui, rect, &spec, &race.letter(), Align::Center);
}

/// Paints the bar of a player's own color that marks which side of a panel is theirs.
pub(crate) fn paint_player_bar(ui: &Ui, rect: Rect, color: Color32, alpha: f32) {
    ui.painter().rect_filled(
        rect,
        theme::radius(theme::RADIUS_TIGHT),
        color.gamma_multiply(alpha),
    );
}

/// Outlines a tile the pointer is over, for the tiles that act when they are clicked.
pub(crate) fn paint_tile_chrome(ui: &Ui, rect: Rect, hovered: bool) {
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(crate::colors::BLUE10, 0.7),
    );
    ui.painter().add(egui::Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            if hovered {
                theme::ACCENT
            } else {
                theme::TIER0_STROKE
            },
        ),
        StrokeKind::Inside,
    ));
}

/// How much of a panel a surface whose player has no vision is drawn at.
///
/// Vision is the one thing on these panels the watcher decides rather than the game: a player whose
/// vision is off is still in the game and still worth reading, so their half of a panel is dimmed
/// rather than emptied or removed.
pub(crate) const NO_VISION_ALPHA: f32 = 0.45;

/// The opacity a player's part of a panel is drawn at.
pub(crate) fn vision_alpha(vision: bool) -> f32 {
    if vision { 1.0 } else { NO_VISION_ALPHA }
}

/// A slot of a row, taken from whichever end of it the player's side starts at.
///
/// The matchup bar's two halves are mirror images, so one layout is written and read from the
/// outside in: the left half walks right from the screen's left, the right half walks left from its
/// right, and every cell lands where the mirror of the other half's is.
pub(crate) struct EdgeCursor {
    x: f32,
    step: f32,
    top: f32,
    bottom: f32,
}

impl EdgeCursor {
    /// A cursor starting at `rect`'s left edge and walking right.
    pub(crate) fn from_left(rect: Rect) -> EdgeCursor {
        EdgeCursor {
            x: rect.left(),
            step: 1.0,
            top: rect.top(),
            bottom: rect.bottom(),
        }
    }

    /// A cursor starting at `rect`'s right edge and walking left.
    pub(crate) fn from_right(rect: Rect) -> EdgeCursor {
        EdgeCursor {
            x: rect.right(),
            step: -1.0,
            top: rect.top(),
            bottom: rect.bottom(),
        }
    }

    /// Whether this cursor runs towards the screen's centre from the right, which is what mirrors
    /// the alignment inside each cell as well as the cells themselves.
    pub(crate) fn mirrored(&self) -> bool {
        self.step < 0.0
    }

    /// Which end of a cell its icon and its label sit at.
    pub(crate) fn outer_align(&self) -> Align {
        if self.mirrored() {
            Align::RIGHT
        } else {
            Align::LEFT
        }
    }

    /// Takes the next `width` of the row, returning the rect it covers.
    pub(crate) fn take(&mut self, width: f32) -> Rect {
        let next = self.x + width * self.step;
        let (left, right) = if self.mirrored() {
            (next, self.x)
        } else {
            (self.x, next)
        };
        self.x = next;
        Rect::from_min_max(pos2(left, self.top), pos2(right, self.bottom))
    }

    /// Skips `width` of the row.
    pub(crate) fn skip(&mut self, width: f32) {
        self.x += width * self.step;
    }
}

/// The same rect, inset vertically to `height` about its own middle.
pub(crate) fn centred(rect: Rect, height: f32) -> Rect {
    Rect::from_center_size(rect.center(), vec2(rect.width(), height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clock_grows_an_hours_field_only_once_there_is_one() {
        assert_eq!(game_clock(0), "0:00");
        assert_eq!(game_clock(65), "1:05");
        assert_eq!(game_clock(3599), "59:59");
        assert_eq!(game_clock(3600), "1:00:00");
        assert_eq!(game_clock(3725), "1:02:05");
    }

    #[test]
    fn mirrored_cells_land_on_their_opposites() {
        let row = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 20.0));
        let mut left = EdgeCursor::from_left(row);
        let mut right = EdgeCursor::from_right(row);
        left.skip(4.0);
        right.skip(4.0);
        let left_cell = left.take(30.0);
        let right_cell = right.take(30.0);
        assert_eq!(left_cell.left(), 4.0);
        assert_eq!(left_cell.right(), 34.0);
        assert_eq!(right_cell.right(), 96.0);
        assert_eq!(right_cell.left(), 66.0);
        assert_eq!(left.outer_align(), Align::LEFT);
        assert_eq!(right.outer_align(), Align::RIGHT);
    }
}
