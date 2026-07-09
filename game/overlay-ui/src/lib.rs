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
//! preview renders text with the same faces and sizes the game does.

pub mod colors;
pub mod disconnect;
pub mod fonts;
pub mod netstat;
mod style;

pub use style::install_fonts_and_style;
