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

                    let map_image = egui::Image::from_uri("http://localhost:5555/files/map_images/15/29/1529e7d69cdee8ce125fed1b2688b2e6a21183fc9a8e6b2ce5adf363ce32b419-2048.jpg?v=1")
                        .max_width(640.0)
                        .max_height(480.0);
                    ui.add_sized(
                        [640.0, 480.0],
                        map_image,
                    );
                });
            });
    }
}
