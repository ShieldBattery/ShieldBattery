//! The emulated StarCraft render target the overlay believes it is drawing into.
//!
//! The game derives egui's `pixels_per_point` from its render target's pixel height against a
//! 1080-line baseline, so a point is a "unit" (1u = 1px at 1080p) and the overlay's on-screen size
//! tracks the display, not the OS DPI. This module reproduces that derivation for a chosen
//! resolution and hands the host the logical size and the scale it needs to blit the result.

use egui::{Align2, Color32, FontId, Painter, Pos2, Rect, Shape, Stroke, Vec2, pos2, vec2};
use serde::{Deserialize, Serialize};

/// The baseline the scale ramp is anchored to: at this pixel height one point is one pixel.
const REFERENCE_HEIGHT: f32 = 1080.0;

/// How much the compact ramp shrinks everything relative to the comfort ramp.
const COMPACT_RAMP_DIVISOR: f32 = 1.25;

/// The side of the square the minimap occupies in the bottom-left corner, in units.
const MINIMAP_RESERVE_UNITS: f32 = 348.0;

/// The height of the bottom console band (the unit panel and command card), in units.
const CONSOLE_BAND_UNITS: f32 = 200.0;

/// A resolution the overlay can be previewed at.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ResolutionPreset {
    R1280x720,
    #[default]
    R1920x1080,
    R2560x1440,
    R3840x2160,
    R1024x768,
    R1600x1200,
}

impl ResolutionPreset {
    pub const ALL: [ResolutionPreset; 6] = [
        ResolutionPreset::R1280x720,
        ResolutionPreset::R1920x1080,
        ResolutionPreset::R2560x1440,
        ResolutionPreset::R3840x2160,
        ResolutionPreset::R1024x768,
        ResolutionPreset::R1600x1200,
    ];

    pub fn size(self) -> [u32; 2] {
        match self {
            ResolutionPreset::R1280x720 => [1280, 720],
            ResolutionPreset::R1920x1080 => [1920, 1080],
            ResolutionPreset::R2560x1440 => [2560, 1440],
            ResolutionPreset::R3840x2160 => [3840, 2160],
            ResolutionPreset::R1024x768 => [1024, 768],
            ResolutionPreset::R1600x1200 => [1600, 1200],
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ResolutionPreset::R1280x720 => "1280x720",
            ResolutionPreset::R1920x1080 => "1920x1080",
            ResolutionPreset::R2560x1440 => "2560x1440",
            ResolutionPreset::R3840x2160 => "3840x2160",
            ResolutionPreset::R1024x768 => "1024x768",
            ResolutionPreset::R1600x1200 => "1600x1200",
        }
    }

    /// Width divided by height, the one thing the preset always fixes regardless of scale mode.
    pub fn aspect(self) -> f32 {
        let [w, h] = self.size();
        w as f32 / h as f32
    }
}

/// How the emulated screen's `pixels_per_point` is chosen.
#[derive(Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum ScaleMode {
    /// Derive the scale from the on-screen viewport's own physical pixel height, so every glyph is
    /// rasterized once at exactly the size it is displayed at and the blit is a 1:1 pixel copy. The
    /// resolution preset then only fixes the aspect ratio.
    #[default]
    MatchWindow,
    /// Derive the scale from the preset's pixel height, so layout matches that resolution exactly.
    /// The blit then resamples to whatever size the window gives it, which softens text.
    EmulateResolution,
}

impl ScaleMode {
    pub const ALL: [ScaleMode; 2] = [ScaleMode::MatchWindow, ScaleMode::EmulateResolution];

    pub fn label(self) -> &'static str {
        match self {
            ScaleMode::MatchWindow => "match window",
            ScaleMode::EmulateResolution => "emulate resolution",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            ScaleMode::MatchWindow => {
                "Scale from the window's pixels: crisp text, preset fixes aspect only."
            }
            ScaleMode::EmulateResolution => {
                "Scale from the preset's pixels: exact layout, resampled blit."
            }
        }
    }
}

/// A resolved emulated screen: what the overlay's context is told, and at what density.
#[derive(Clone, Copy)]
pub struct VirtualScreen {
    /// egui's scale for the overlay's context.
    pub pixels_per_point: f32,
    /// The screen rect handed to the overlay's context, in points.
    pub points: Vec2,
    /// The pixel size the overlay is rasterized at.
    pub physical: Vec2,
}

impl VirtualScreen {
    /// Resolves the emulated screen for a preset and scale mode.
    ///
    /// `viewport_physical_height` is the on-screen height of the blit target in physical pixels; it
    /// only matters in [`ScaleMode::MatchWindow`].
    pub fn resolve(
        preset: ResolutionPreset,
        mode: ScaleMode,
        compact_ramp: bool,
        viewport_physical_height: f32,
    ) -> VirtualScreen {
        let physical_height = match mode {
            ScaleMode::MatchWindow => viewport_physical_height,
            ScaleMode::EmulateResolution => preset.size()[1] as f32,
        }
        .max(1.0);
        let ramp = if compact_ramp {
            COMPACT_RAMP_DIVISOR
        } else {
            1.0
        };
        // Below the baseline the game keeps a 1:1 point-to-pixel ratio rather than shrinking the UI
        // into unreadability, so the overlay simply takes up more of a small screen.
        let pixels_per_point = (physical_height / REFERENCE_HEIGHT / ramp).max(1.0);
        let points_height = physical_height / pixels_per_point;
        let points = vec2(points_height * preset.aspect(), points_height);
        VirtualScreen {
            pixels_per_point,
            points,
            physical: points * pixels_per_point,
        }
    }
}

/// Maps between the emulated screen's points and the host window's points.
#[derive(Clone, Copy)]
pub struct Blit {
    /// Where the emulated screen lands in the host window, in host points.
    pub viewport: Rect,
    /// Host points per emulated point.
    pub scale: f32,
}

impl Blit {
    /// Maps an emulated screen of `points` onto the `viewport` it was fitted into.
    pub fn new(viewport: Rect, points: Vec2) -> Blit {
        Blit {
            viewport,
            scale: viewport.height() / points.y.max(f32::MIN_POSITIVE),
        }
    }

    pub fn to_host(self, game: Pos2) -> Pos2 {
        self.viewport.min + game.to_vec2() * self.scale
    }

    pub fn to_game(self, host: Pos2) -> Pos2 {
        ((host - self.viewport.min) / self.scale).to_pos2()
    }

    pub fn rect_to_host(self, game: Rect) -> Rect {
        Rect::from_min_max(self.to_host(game.min), self.to_host(game.max))
    }
}

/// The largest centred rect of the given aspect ratio that fits in `available`.
///
/// The aspect alone decides where the emulated screen lands, which is what lets
/// [`ScaleMode::MatchWindow`] derive its scale from a viewport it has not yet laid out.
pub fn fit_aspect(available: Rect, aspect: f32) -> Rect {
    let width = available.width().min(available.height() * aspect);
    Rect::from_center_size(available.center(), vec2(width, width / aspect))
}

/// Draws the regions BW's own HUD owns, so an overlay that strays into them is obvious.
///
/// These are fixed in units, not points: the minimap and console take a constant fraction of the
/// screen whatever scale ramp the overlay is on, and the screen is 1080 units tall by definition.
pub fn paint_reserve_guides(painter: &Painter, viewport: Rect) {
    let unit = viewport.height() / REFERENCE_HEIGHT;
    let minimap = Rect::from_min_max(
        pos2(
            viewport.left(),
            viewport.bottom() - MINIMAP_RESERVE_UNITS * unit,
        ),
        pos2(
            viewport.left() + MINIMAP_RESERVE_UNITS * unit,
            viewport.bottom(),
        ),
    );
    let console = Rect::from_min_max(
        pos2(
            minimap.right(),
            viewport.bottom() - CONSOLE_BAND_UNITS * unit,
        ),
        viewport.max,
    );
    paint_guide_rect(
        painter,
        minimap,
        "minimap reserve",
        overlay_ui::colors::AMBER60,
    );
    paint_guide_rect(painter, console, "console band", overlay_ui::colors::BLUE70);
}

fn paint_guide_rect(painter: &Painter, rect: Rect, label: &str, color: Color32) {
    if !rect.is_positive() {
        return;
    }
    let stroke = Stroke::new(1.0, color.gamma_multiply(0.75));
    let corners = [
        rect.left_top(),
        rect.right_top(),
        rect.right_bottom(),
        rect.left_bottom(),
        rect.left_top(),
    ];
    painter.extend(Shape::dashed_line(&corners, stroke, 6.0, 5.0));
    painter.text(
        rect.left_top() + vec2(4.0, 3.0),
        Align2::LEFT_TOP,
        label,
        FontId::proportional(11.0),
        color,
    );
}
