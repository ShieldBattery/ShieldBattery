use egui::{Color32, CornerRadius, Frame, Margin, RichText, Shadow};
use egui_flex::{Flex, FlexAlign};

use crate::{
    app_messages::{GameSetupInfo, MapInfo},
    bw_scr::draw_overlay::{BwVars, OverlayState, colors},
};

const MAP_IMAGE_WIDTH: f32 = 640.0;
const MAP_IMAGE_HEIGHT: f32 = 480.0;

impl OverlayState {
    pub fn add_loading_screen_ui(
        &mut self,
        bw: &BwVars,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        if !bw.has_init_bw || setup_info.is_none() || setup_info.unwrap().is_replay() {
            // If we don't have the game information yet or if it's a replay, we don't show a
            // loading screen. Render a black screen to hide the FPS counter during this time.
            egui::CentralPanel::default()
                .frame(Frame::default().fill(Color32::BLACK))
                .show(ctx, |_ui| {});
            return;
        }

        let setup_info = setup_info.unwrap();
        let (map_name, map_image_url) = match &setup_info.map {
            MapInfo::Game(info) => (Some(info.name.as_str()), info.image1024_url.as_deref()),
            MapInfo::Replay(_) => (None, None),
        };

        egui::CentralPanel::default()
            .frame(
                Frame::default()
                    .fill(colors::BLUE10)
                    .inner_margin(Margin::symmetric(24, 16)),
            )
            .show(ctx, |ui| {
                ui.style_mut().spacing.item_spacing = [40.0, 24.0].into();

                Flex::horizontal()
                    .align_items(FlexAlign::Center)
                    .w_full()
                    .h_full()
                    .show(ui, |flex| {
                        flex.add_flex(
                            egui_flex::item().grow(1.0),
                            Flex::vertical().align_items(FlexAlign::End),
                            |flex| {
                                flex.add_ui(egui_flex::item(), |ui| ui.label("Player Group 1"));
                            },
                        );

                        flex.add_flex(
                            egui_flex::item().grow(0.0),
                            Flex::vertical().align_items(FlexAlign::Start),
                            |flex| {
                                flex.add_ui(egui_flex::item(), |ui| {
                                    egui::Frame::default()
                                        .fill(Color32::BLACK)
                                        .corner_radius(CornerRadius::same(8))
                                        .shadow(Shadow {
                                            offset: [0, 0],
                                            blur: 2,
                                            spread: 2,
                                            color: colors::BLUE80.gamma_multiply(0.7),
                                        })
                                        .show(ui, |ui| {
                                            if let Some(url) = map_image_url {
                                                ui.add(
                                                    egui::Image::from_uri(url)
                                                        .show_loading_spinner(false)
                                                        .fit_to_exact_size(
                                                            [MAP_IMAGE_WIDTH, MAP_IMAGE_HEIGHT]
                                                                .into(),
                                                        )
                                                        .corner_radius(CornerRadius::same(8)),
                                                );
                                            }
                                        });
                                });

                                flex.add_ui(
                                    egui_flex::item().align_self(FlexAlign::Center),
                                    |ui| {
                                        ui.label(
                                            RichText::new(map_name.unwrap_or(""))
                                                .size(24.0)
                                                .color(colors::GREY99),
                                        )
                                    },
                                );
                            },
                        );

                        flex.add_flex(
                            egui_flex::item().grow(1.0),
                            Flex::vertical().align_items(FlexAlign::Start),
                            |flex| {
                                flex.add_ui(egui_flex::item(), |ui| ui.label("Player Group 2"));
                            },
                        );
                    });
            });
    }
}
