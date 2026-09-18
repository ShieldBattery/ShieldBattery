//! Host-renderable presentation layer for ShieldBattery's in-game disconnect overlay.
//!
//! egui is renderer-agnostic: the injected game DLL feeds this widget code through forge/D3D11,
//! while the `overlay-preview` binary in this crate feeds the exact same code through eframe's own
//! backend — both lay out identically given the same fonts and pixels-per-point. So the overlay's
//! view-model and every egui render fn live here as pure fns of plain data, with no BW / samase /
//! Windows dependency. The DLL builds the view-model from live turn-state data and calls the render
//! fns; the preview host builds it from adjustable knobs for fast visual iteration without launching
//! StarCraft.
//!
//! This crate carries its own font and base-style setup ([`install_fonts_and_style`]) so a host
//! preview renders text with the same faces and sizes the game does, and the [`kit`] module holds
//! the design tokens, type styles, surfaces and controls every screen is drawn from. Every string a
//! screen shows goes through [`tr!`] / [`tr_plural!`], which resolve against the app's own
//! translation catalogs (see [`i18n`]).
//!
//! The [`shell`] module is the state machine above those screens: which surfaces are up, which of
//! them is modal, what the frame does with the player's input, and which of SC:R's own dialogs the
//! overlay replaces. Both hosts drive it once per frame, so neither owns a policy the other can
//! drift from.

pub mod chat_history;
pub mod colors;
pub mod disconnect;
pub mod fonts;
pub mod i18n;
pub mod kit;
pub mod netstat;
pub mod shell;
mod style;
pub mod transport;

pub use fonts::{DynamicFonts, load_dynamic_fonts};
pub use style::install_fonts_and_style;
