//! The design tokens every part of the kit draws from.
//!
//! One unit of the design is one egui point: the host sets `pixels_per_point` to
//! `screen_height / 1080`, which is exactly the design's "1u = 1px at 1080p", so sizes here are
//! plain point values and no second scale factor may be applied on top of them.

use egui::{Color32, CornerRadius, Stroke};

use crate::colors::{
    AMBER60, BLUE10, BLUE60, BLUE70, BLUE80, GREY_BLUE60, GREY_BLUE70, GREY_BLUE80, GREY99,
    PROTOSS, RANDOM, TERRAN, ZERG,
};

/// A token color at a fraction of full opacity, premultiplied the way egui wants it.
pub const fn alpha(color: Color32, alpha: f32) -> Color32 {
    Color32::from_rgba_unmultiplied_const(
        color.r(),
        color.g(),
        color.b(),
        (alpha * 255.0 + 0.5) as u8,
    )
}

/// Width of every line the chrome draws. At the overlay's scale one point is one physical pixel at
/// 1080p, which is what keeps these strokes crisp instead of smeared across two pixels.
pub const HAIRLINE: f32 = 1.0;

// Spacing steps. Anything between panels, rows or a label and its value picks one of these.
pub const SPACE_XS: f32 = 4.0;
pub const SPACE_SM: f32 = 8.0;
pub const SPACE_MD: f32 = 12.0;
pub const SPACE_LG: f32 = 16.0;
pub const SPACE_XL: f32 = 24.0;

/// Corner radius of modal chrome and of the small tiles inside panels.
pub const RADIUS_TIGHT: u8 = 2;
/// Corner radius of a keycap chip.
pub const RADIUS_CHIP: u8 = 3;
/// Corner radius of panels and buttons.
pub const RADIUS_PANEL: u8 = 4;

/// Smallest height a control may take in a panel that sits over gameplay.
pub const HIT_PANEL: f32 = 34.0;
/// Smallest height a control may take inside a modal dialog, where the pointer is unhurried.
pub const HIT_DIALOG: f32 = 42.0;

/// How long a panel takes to fade and slide in or out.
pub const MOTION_PANEL_SECS: f32 = 0.15;
/// How far a panel slides while it fades.
pub const MOTION_PANEL_SLIDE: f32 = 8.0;
/// Period of anything that pulses to say "still working".
pub const MOTION_PULSE_SECS: f32 = 1.4;
/// How long a destructive action must be held before it fires.
pub const MOTION_HOLD_SECS: f32 = 3.0;
/// How long an abandoned hold takes to unwind.
pub const MOTION_HOLD_RELEASE_SECS: f32 = 0.15;

// Text colors.
pub const TEXT_PRIMARY: Color32 = GREY99;
pub const TEXT_DIM: Color32 = GREY_BLUE70;
pub const TEXT_LABEL: Color32 = GREY_BLUE60;
pub const TEXT_POSITIVE: Color32 = Color32::from_rgb(0x69, 0xF0, 0xAE);
pub const TEXT_NEGATIVE: Color32 = Color32::from_rgb(0xE6, 0x60, 0x60);
pub const ACCENT: Color32 = AMBER60;

/// The ring drawn around whatever holds keyboard focus.
pub const FOCUS_RING: Stroke = Stroke {
    width: HAIRLINE,
    color: ACCENT,
};

/// Per-player colors, in slot order. Slots past the sixth wrap around.
pub const PLAYER_COLORS: [Color32; 6] = [
    TEXT_NEGATIVE,
    TERRAN,
    PROTOSS,
    ZERG,
    RANDOM,
    Color32::from_rgb(0x66, 0xBB, 0x6A),
];

/// The color of the slot in `PLAYER_COLORS`, wrapping for slots beyond it.
pub fn player_color(slot: usize) -> Color32 {
    PLAYER_COLORS[slot % PLAYER_COLORS.len()]
}

// Interaction states. Both are drawn over whatever the control already painted, so one overlay
// works for every fill the kit uses.
pub const HOVER_OVERLAY: Color32 = Color32::from_rgba_unmultiplied_const(255, 255, 255, 15);
pub const PRESS_OVERLAY: Color32 = Color32::from_rgba_unmultiplied_const(0, 0, 0, 15);
/// Opacity a disabled control is drawn at.
pub const DISABLED_OPACITY: f32 = 0.38;

// Tier 0: ambient panels that sit over gameplay and must never compete with it.
pub const TIER0_FILL: Color32 = alpha(BLUE10, 0.86);
pub const TIER0_STROKE: Color32 = alpha(GREY_BLUE80, 0.16);
pub const TIER0_HEADER: Color32 = GREY_BLUE80;
pub const TIER0_DIVIDER: Color32 = alpha(GREY_BLUE80, 0.10);

// Tier 1: hero panels that carry the match's identity.
pub const TIER1_FILL_TOP: Color32 = alpha(Color32::from_rgb(0x18, 0x27, 0x3E), 0.95);
pub const TIER1_FILL_BOTTOM: Color32 = alpha(Color32::from_rgb(0x10, 0x15, 0x1E), 0.92);
pub const TIER1_STROKE: Color32 = alpha(BLUE60, 0.40);
/// A light line just inside the top edge, which is what gives a tier-1 panel its lift.
pub const TIER1_BEVEL: Color32 = alpha(BLUE80, 0.22);
pub const TIER1_HEADER: Color32 = AMBER60;

// Tier 2: modal chrome. It owns the screen, so it is allowed to glow.
pub const TIER2_FILL_TOP: Color32 = alpha(Color32::from_rgb(18, 34, 74), 0.96);
pub const TIER2_FILL_BOTTOM: Color32 = alpha(Color32::from_rgb(13, 22, 44), 0.96);
pub const TIER2_STROKE_INNER: Color32 = BLUE70;
pub const TIER2_STROKE_OUTER: Color32 = alpha(BLUE60, 0.75);
/// Distance between the inner and outer strokes of tier-2 chrome.
pub const TIER2_STROKE_GAP: f32 = 3.0;
/// Successive strokes outside the outer one, one point apart, standing in for a blur.
pub const TIER2_GLOW: [Color32; 3] = [
    alpha(BLUE60, 0.18),
    alpha(BLUE60, 0.10),
    alpha(BLUE60, 0.05),
];
/// The halo a tier-2 control wears while it is the active one.
pub const TIER2_ACTIVE_HALO: Color32 = alpha(BLUE60, 0.50);
/// What a modal lays over the rest of the screen.
pub const SCRIM: Color32 = alpha(Color32::from_rgb(8, 11, 17), 0.62);

/// The same radius on every corner.
pub fn radius(value: u8) -> CornerRadius {
    CornerRadius::same(value)
}

/// A radius that is square on top and rounded below, for chrome that hangs off an edge.
pub fn radius_bottom(value: u8) -> CornerRadius {
    CornerRadius {
        nw: 0,
        ne: 0,
        sw: value,
        se: value,
    }
}
