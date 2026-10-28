//! How surfaces come and go.
//!
//! Everything animated here is driven from egui's own clock, so a host that steps time forward
//! (an offline render, a test) sees the same motion a live frame does.

use egui::emath::TSTransform;
use egui::{Area, Context, Id, InnerResponse, Ui, Vec2, vec2};

use crate::kit::theme;

/// Where a surface is in its entrance or exit.
#[derive(Clone, Copy)]
pub struct Presence {
    /// What to multiply the surface's opacity by.
    pub alpha: f32,
    /// How far along its entrance the surface is, from 0 (gone) to 1 (at rest).
    pub progress: f32,
}

impl Presence {
    /// Applies the fade to `ui`; the slide is the caller's to apply, since only it knows whether
    /// the surface is positioned by an area, a layout or a rect.
    pub fn apply_fade(&self, ui: &mut Ui) {
        ui.set_opacity(self.alpha);
    }

    /// How far the surface still is from its resting place, for a surface that arrives from
    /// `slide` away and leaves the same way.
    pub fn offset(&self, slide: Vec2) -> Vec2 {
        slide * (1.0 - self.progress)
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
        progress: t,
    })
}

/// Shows `area` through its entrance and exit, fading it and rising it into place from a few points
/// below its resting place: the entrance every panel standing on something makes.
pub fn presence_area<R>(
    ctx: &Context,
    id: Id,
    shown: bool,
    area: Area,
    add: impl FnOnce(&mut Ui) -> R,
) -> Option<InnerResponse<R>> {
    presence_area_along(
        ctx,
        id,
        shown,
        area,
        vec2(0.0, theme::MOTION_PANEL_SLIDE),
        add,
    )
}

/// [`presence_area`] for a surface hung from the screen's top edge, which comes down from that edge
/// and goes back up to it. Rising into place, it would rise into whatever hangs under it.
pub fn presence_area_from_top<R>(
    ctx: &Context,
    id: Id,
    shown: bool,
    area: Area,
    add: impl FnOnce(&mut Ui) -> R,
) -> Option<InnerResponse<R>> {
    presence_area_along(
        ctx,
        id,
        shown,
        area,
        vec2(0.0, -theme::MOTION_PANEL_SLIDE),
        add,
    )
}

/// Shows `area` through its entrance and exit, fading it and sliding it in from `slide` away.
///
/// The slide is a transform on the area's own layer rather than an offset baked into its position,
/// so the caller keeps whatever anchor or fixed position it built the area with.
pub fn presence_area_along<R>(
    ctx: &Context,
    id: Id,
    shown: bool,
    area: Area,
    slide: Vec2,
    add: impl FnOnce(&mut Ui) -> R,
) -> Option<InnerResponse<R>> {
    let presence = enter_exit(ctx, id, shown)?;
    let inner = area.show(ctx, |ui| {
        presence.apply_fade(ui);
        add(ui)
    });
    ctx.set_transform_layer(
        inner.response.layer_id,
        TSTransform::from_translation(presence.offset(slide)),
    );
    Some(inner)
}

/// How many seconds ago a surface that makes its entrance every time it starts being drawn
/// appeared, up to `secs`.
///
/// For a surface that comes and goes with a state it does not own, such as a modal raised by a
/// dialog the game spawns: there is no `shown` flag to animate between, only a surface that was
/// absent on the last pass and is drawn on this one. The clock restarts whenever a pass goes by
/// without the surface asking, so a surface that leaves and comes back arrives again rather than
/// reappearing at rest. The surface stages its entrance off this clock itself.
///
/// Frames are asked for until `secs` have gone by, and not after, so an entrance staged off this
/// clock comes to rest on its last frame rather than idling at full frame rate.
pub fn arrival_secs(ctx: &Context, id: Id, secs: f32) -> f32 {
    #[derive(Clone, Copy)]
    struct Entrance {
        started: f64,
        last_pass: u64,
    }

    let now = ctx.input(|input| input.time);
    let pass = ctx.cumulative_pass_nr();
    let entrance = ctx.data_mut(|data| {
        let entrance = match data.get_temp::<Entrance>(id) {
            Some(entrance) if entrance.last_pass + 1 >= pass => Entrance {
                last_pass: pass,
                ..entrance
            },
            _ => Entrance {
                started: now,
                last_pass: pass,
            },
        };
        data.insert_temp(id, entrance);
        entrance
    });
    let elapsed = ((now - entrance.started) as f32).clamp(0.0, secs);
    if elapsed < secs {
        ctx.request_repaint();
    }
    elapsed
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

/// Where a surface is placed this frame, from the numbers it is placed by: a top edge, an inset, the
/// ends of a run. A surface arriving takes its place at once and makes its own entrance there; one
/// already on screen eases to a new place; one on its way out keeps the place it had when it was
/// last wanted, so it leaves from where it stood rather than from wherever its neighbors moved to.
///
/// Every number eases on its own, on the same curve and from the same frame, so numbers that change
/// together move together, and so do surfaces whose places change on the same frame.
///
/// Whether the surface was on screen is the caller's to say, once it has drawn it, with
/// [`Spot::drawn`]: that decides whether the next change is eased or simply taken.
#[must_use = "a spot needs to be told whether its surface was drawn"]
pub struct Spot<'a, const N: usize> {
    ctx: &'a Context,
    id: Id,
    held: [f32; N],
    at: [f32; N],
}

/// What a [`Spot`] keeps between frames.
#[derive(Clone, Copy)]
struct SpotState<const N: usize> {
    held: [f32; N],
    drawn: bool,
}

impl<'a, const N: usize> Spot<'a, N> {
    /// The spot `id` names, for a surface `wanted` on screen whose place is now `target`.
    pub fn new(ctx: &'a Context, id: Id, wanted: bool, target: [f32; N]) -> Spot<'a, N> {
        let state = ctx.data(|data| data.get_temp::<SpotState<N>>(id));
        let held = match state {
            Some(state) if !wanted => state.held,
            _ => target,
        };
        let secs = if state.is_some_and(|state| state.drawn) {
            theme::MOTION_PANEL_SECS
        } else {
            0.0
        };
        let at = std::array::from_fn(|index| {
            ctx.animate_value_with_time(id.with(index), held[index], secs)
        });
        Spot { ctx, id, held, at }
    }

    /// Where the surface is drawn this frame.
    pub fn at(&self) -> [f32; N] {
        self.at
    }

    /// Records whether the surface was drawn this frame.
    pub fn drawn(self, drawn: bool) {
        let state = SpotState {
            held: self.held,
            drawn,
        };
        self.ctx.data_mut(|data| data.insert_temp(self.id, state));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs one frame at `time` seconds, placing a surface by `target` and drawing it while it is
    /// `wanted` or still on its way out, and returns where it was placed.
    fn frame(ctx: &Context, time: f64, wanted: bool, target: f32, drawn: bool) -> f32 {
        ctx.begin_pass(egui::RawInput {
            time: Some(time),
            ..Default::default()
        });
        let spot = Spot::new(ctx, Id::new("spot"), wanted, [target]);
        let [at] = spot.at();
        spot.drawn(drawn);
        // A placement check has no GPU texture store to hand the atlas to.
        ctx.end_pass().textures_delta.clear();
        at
    }

    #[test]
    fn a_surface_arriving_takes_its_place_at_once() {
        let ctx = Context::default();
        assert_eq!(frame(&ctx, 0.0, true, 100.0, true), 100.0);
        // Gone and back somewhere else: it is placed there rather than slid across.
        frame(&ctx, 1.0, false, 100.0, false);
        assert_eq!(frame(&ctx, 2.0, true, 300.0, true), 300.0);
    }

    #[test]
    fn a_surface_on_screen_eases_to_a_new_place() {
        let ctx = Context::default();
        frame(&ctx, 0.0, true, 100.0, true);
        frame(&ctx, 1.0, true, 300.0, true);
        let midway = frame(
            &ctx,
            1.0 + f64::from(theme::MOTION_PANEL_SECS) / 2.0,
            true,
            300.0,
            true,
        );
        assert!(midway > 100.0 && midway < 300.0, "{midway}");
        assert_eq!(frame(&ctx, 3.0, true, 300.0, true), 300.0);
    }

    #[test]
    fn a_surface_on_its_way_out_keeps_its_place() {
        let ctx = Context::default();
        frame(&ctx, 0.0, true, 100.0, true);
        // Its neighbors move on as it leaves; it stays where it stood.
        for step in 1..5 {
            let time = 1.0 + f64::from(step) * 0.03;
            assert_eq!(frame(&ctx, time, false, 300.0, true), 100.0);
        }
    }
}
