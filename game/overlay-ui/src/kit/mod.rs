//! The overlay's UI kit: the tokens, type styles, surfaces, motion and controls every screen is
//! built from.
//!
//! Screens describe themselves in terms of this kit rather than in raw egui, so a change to the
//! design lands in one place and every overlay moves with it.

pub mod motion;
pub mod pixels;
pub(crate) mod surfaces;
pub mod text;
pub mod theme;
pub mod tiers;
pub mod widgets;

/// `value` held between `low` and `high`, for bounds worked out from a layout. Those can cross,
/// by a rounding error where something exactly fills its room and by more where it overflows it,
/// and where they do `low` wins rather than the panic `f32::clamp` gives.
pub fn clamp_layout(value: f32, low: f32, high: f32) -> f32 {
    value.min(high).max(low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossed_layout_bounds_settle_on_the_low_one() {
        assert_eq!(clamp_layout(5.0, 0.0, 10.0), 5.0);
        assert_eq!(clamp_layout(-1.0, 0.0, 10.0), 0.0);
        assert_eq!(clamp_layout(11.0, 0.0, 10.0), 10.0);
        assert_eq!(clamp_layout(200.0, 213.65, 213.649_96), 213.65);
    }
}
