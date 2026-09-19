//! The design tokens every part of the kit draws from.
//!
//! One unit of the design is one egui point: the host sets `pixels_per_point` to
//! `screen_height / 1080`, which is exactly the design's "1u = 1px at 1080p", so sizes here are
//! plain point values and no second scale factor may be applied on top of them.

use egui::{Color32, CornerRadius, Stroke};

use crate::colors::{
    AMBER60, AMBER70, BLUE10, BLUE60, BLUE70, BLUE80, GREY_BLUE10, GREY_BLUE40, GREY_BLUE50,
    GREY_BLUE60, GREY_BLUE70, GREY_BLUE80, GREY99, PROTOSS, RANDOM, TERRAN, ZERG,
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
/// Running text beside a primary value: a dialog's subtitle, a row's state, an explanation.
pub const TEXT_SECONDARY: Color32 = GREY_BLUE80;
pub const TEXT_DIM: Color32 = GREY_BLUE70;
pub const TEXT_LABEL: Color32 = GREY_BLUE60;
pub const TEXT_POSITIVE: Color32 = Color32::from_rgb(0x69, 0xF0, 0xAE);
pub const TEXT_NEGATIVE: Color32 = Color32::from_rgb(0xE6, 0x60, 0x60);
/// Text that says something is still going wrong. Lighter than [`ACCENT`], which is loud enough to
/// carry a title but too saturated to read as a sentence.
pub const TEXT_WARNING: Color32 = AMBER70;
/// The label of a destructive control, which is lifted off [`TEXT_NEGATIVE`] so it reads against
/// the dark fill that control is drawn on.
pub const TEXT_DANGER: Color32 = Color32::from_rgb(0xFF, 0x8A, 0x8A);
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

// What each resource is drawn in, wherever a panel names one. The hues are the game's own — light
// blue minerals, green vespene — lifted to values that read on the overlay's dark surfaces, so a
// number and the glyph beside it are recognised as the same resource the game's own counters show.
pub const RESOURCE_MINERALS: Color32 = Color32::from_rgb(0x6C, 0xC6, 0xFF);
pub const RESOURCE_GAS: Color32 = Color32::from_rgb(0x5A, 0xD6, 0x8A);
pub const RESOURCE_SUPPLY: Color32 = GREY_BLUE80;

/// The edge of a small outlined control over gameplay: a jump chip, a stepper end, a keycap.
pub const CHIP_STROKE: Color32 = alpha(BLUE80, 0.25);

// A scrollbar, in the same greys the app's own scrollbars wear: a dark rail with a grey-blue handle
// that steps one shade lighter under the pointer and one more while dragged. The steps are
// palette neighbours rather than a jump to white, since the bar sits beside the text it scrolls
// and must never outshine it.
pub const SCROLLBAR_RAIL: Color32 = alpha(GREY_BLUE10, 0.80);
pub const SCROLLBAR_HANDLE: Color32 = GREY_BLUE40;
pub const SCROLLBAR_HANDLE_HOVER: Color32 = GREY_BLUE50;
pub const SCROLLBAR_HANDLE_DRAG: Color32 = GREY_BLUE60;
/// Width of the handle. The rail is the handle plus [`SCROLLBAR_INSET`] on both sides.
pub const SCROLLBAR_WIDTH: f32 = 8.0;
/// Corner radius of the handle: half its width, so it ends in a full round.
pub const SCROLLBAR_RADIUS: u8 = 4;
/// Gap between the handle and the rail's edge, so the handle reads as sitting in the rail.
pub const SCROLLBAR_INSET: f32 = 2.0;

// Who a chat line went to, as the hue of the tag beside it. The one everyone hears is the quiet
// grey of the kit's plain tags, since most lines of most games go there and a log full of loud
// tags says nothing; the narrower scopes are each a hue apart, so a reader picks out the allied
// planning, the observer chatter and the whispers without reading a word of them.
pub const CHAT_SCOPE_ALL: Color32 = GREY_BLUE80;
pub const CHAT_SCOPE_ALLIES: Color32 = TEXT_POSITIVE;
pub const CHAT_SCOPE_OBSERVERS: Color32 = RESOURCE_MINERALS;
pub const CHAT_SCOPE_PLAYERS: Color32 = AMBER60;

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
pub const TIER2_FILL_BOTTOM: Color32 = alpha(Color32::from_rgb(13, 22, 44), 0.97);
pub const TIER2_STROKE_INNER: Color32 = BLUE70;
pub const TIER2_STROKE_OUTER: Color32 = alpha(BLUE60, 0.75);
/// Distance between the inner and outer strokes of tier-2 chrome.
pub const TIER2_STROKE_GAP: f32 = 3.0;
/// Successive strokes outside the outer one, one point apart, standing in for a blur. The design's
/// glow spreads far enough that three rings read as a second edge rather than as a halo, so the
/// falloff is spread over enough of them that no single ring is visible on its own.
pub const TIER2_GLOW: [Color32; 8] = [
    alpha(BLUE60, 0.16),
    alpha(BLUE60, 0.13),
    alpha(BLUE60, 0.105),
    alpha(BLUE60, 0.08),
    alpha(BLUE60, 0.058),
    alpha(BLUE60, 0.040),
    alpha(BLUE60, 0.025),
    alpha(BLUE60, 0.013),
];
/// Successive strokes just inside the chrome, standing in for the inset shadow that settles a
/// dialog's fill away from its lit edge.
pub const TIER2_INNER_SHADOW: [Color32; 6] = [
    alpha(BLUE10, 0.22),
    alpha(BLUE10, 0.18),
    alpha(BLUE10, 0.14),
    alpha(BLUE10, 0.10),
    alpha(BLUE10, 0.06),
    alpha(BLUE10, 0.03),
];
/// The fill of a boxed row inside a dialog: the dialog's own bottom shade, let through enough that
/// the row reads as a well in the surface rather than as a card on top of it.
pub const TIER2_ROW_FILL: Color32 = alpha(Color32::from_rgb(13, 22, 44), 0.70);
/// The rule between a dialog's header, its body and its footer.
pub const TIER2_DIVIDER: Color32 = alpha(BLUE70, 0.50);
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
