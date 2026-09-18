//! How surfaces come and go.
//!
//! Everything animated here is driven from egui's own clock, so a host that steps time forward
//! (an offline render, a test) sees the same motion a live frame does.

use egui::emath::TSTransform;
use egui::{Area, Context, Id, InnerResponse, Ui, vec2};

use crate::kit::theme;

/// Where a surface is in its entrance or exit.
#[derive(Clone, Copy)]
pub struct Presence {
    /// What to multiply the surface's opacity by.
    pub alpha: f32,
    /// How far down the surface still is from its resting place.
    pub offset_y: f32,
}

impl Presence {
    /// Applies the fade to `ui`; the slide is the caller's to apply, since only it knows whether
    /// the surface is positioned by an area, a layout or a rect.
    pub fn apply_fade(&self, ui: &mut Ui) {
        ui.set_opacity(self.alpha);
    }
}

/// Advances a surface's entrance or exit, returning `None` once it is fully gone.
///
/// A caller that gets `None` must draw nothing at all: a hidden surface still holding its layout
/// would keep taking clicks, and an area that keeps being shown at zero opacity keeps asking for
/// frames forever.
pub fn enter_exit(ctx: &Context, id: Id, shown: bool) -> Option<Presence> {
    let t = ctx.animate_bool_with_time(id, shown, theme::MOTION_PANEL_SECS);
    if t <= 0.0 {
        return None;
    }
    Some(Presence {
        alpha: t,
        offset_y: (1.0 - t) * theme::MOTION_PANEL_SLIDE,
    })
}

/// Shows `area` through its entrance and exit, fading and sliding it.
///
/// The slide is a transform on the area's own layer rather than an offset baked into its position,
/// so the caller keeps whatever anchor or fixed position it built the area with.
pub fn presence_area<R>(
    ctx: &Context,
    id: Id,
    shown: bool,
    area: Area,
    add: impl FnOnce(&mut Ui) -> R,
) -> Option<InnerResponse<R>> {
    let presence = enter_exit(ctx, id, shown)?;
    let inner = area.show(ctx, |ui| {
        presence.apply_fade(ui);
        add(ui)
    });
    ctx.set_transform_layer(
        inner.response.layer_id,
        TSTransform::from_translation(vec2(0.0, presence.offset_y)),
    );
    Some(inner)
}

/// A 0 to 1 to 0 ramp over the pulse period, for anything that breathes to say "still working".
///
/// The caller is responsible for asking for the next frame; a pulse that nobody repaints is a
/// frozen dot.
pub fn pulse_phase(ctx: &Context) -> f32 {
    let time = ctx.input(|input| input.time) as f32;
    let phase = (time / theme::MOTION_PULSE_SECS).fract();
    1.0 - (phase * 2.0 - 1.0).abs()
}
