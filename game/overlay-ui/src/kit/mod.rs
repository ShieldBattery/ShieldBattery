//! The overlay's UI kit: the tokens, type styles, surfaces, motion and controls every screen is
//! built from.
//!
//! Screens describe themselves in terms of this kit rather than in raw egui, so a change to the
//! design lands in one place and every overlay moves with it.

pub mod motion;
pub mod text;
pub mod theme;
pub mod tiers;
pub mod widgets;
