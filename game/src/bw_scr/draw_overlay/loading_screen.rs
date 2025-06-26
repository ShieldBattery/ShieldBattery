use egui::{Align, Frame, Layout, Margin, RichText};

use crate::bw_scr::draw_overlay::{BwVars, OverlayState, colors};

impl OverlayState {
    pub fn add_loading_screen_ui(&mut self, _bw: &BwVars, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(
                Frame::default()
                    .fill(colors::BLUE10)
                    .inner_margin(Margin::symmetric(24, 16)),
            )
            .show(ctx, |ui| {
                ui.with_layout(Layout::top_down(Align::Center), |ui| {
                    ui.label(
                        RichText::new("Hello, World!")
                            .size(24.0)
                            .color(colors::GREY99),
                    );
                });
            });
    }
}
