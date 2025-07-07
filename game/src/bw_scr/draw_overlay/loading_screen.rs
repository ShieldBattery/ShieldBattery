use egui::{Color32, CornerRadius, Frame, Label, Layout, Margin, RichText, Shadow, Vec2};
use egui_extras::StripBuilder;
use egui_flex::{Flex, FlexAlign, FlexInstance};

use crate::{
    app_messages::{GameSetupInfo, GameType, MapInfo, PlayerInfo, SbSlotType, SbUser},
    bw::{RACE_PROTOSS, RACE_TERRAN, RACE_ZERG},
    bw_scr::draw_overlay::{BwVars, OverlayState, colors, fonts::display_family},
};

const MAP_IMAGE_SIZE: Vec2 = Vec2::new(640.0, 640.0);
const SMALL_MAP_IMAGE_SIZE: Vec2 = Vec2::new(480.0, 480.0);
const MAP_BREAKPOINT: f32 = 1360.0;

// TODO(tec27): This is probably retrievable from egui?
const BACKGROUND_SIZE: Vec2 = Vec2::new(1920.0, 1152.0);

impl OverlayState {
    pub fn add_loading_screen_ui(
        &mut self,
        bw: &BwVars,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        if !bw.has_init_bw
            && let Some(info) = setup_info
            && !info.is_replay()
        {
            // Preload the images we're going to display
            match &info.map {
                MapInfo::Game(info) => info.image1024_url.as_deref().inspect(|url| {
                    let _ = ctx.try_load_image(url, egui::SizeHint::Scale(1.0.into()));
                }),
                MapInfo::Replay(_) => None,
            };
        }

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

        // TODO(tec27): Translate these
        let game_type_name = match setup_info.game_type {
            GameType::Melee => "Melee",
            GameType::Ffa => "Free For All",
            GameType::OneVOne => "One on One",
            GameType::TeamMelee => "Team Melee",
            GameType::TeamFfa => "Team Free For All",
            GameType::TopVBottom => "Top vs Bottom",
            GameType::Ums => "Use Map Settings",
        };
        let (start_players, end_players) = get_player_halves(setup_info);

        let map_size = if ctx.screen_rect().size().x < MAP_BREAKPOINT {
            SMALL_MAP_IMAGE_SIZE
        } else {
            MAP_IMAGE_SIZE
        };

        egui::CentralPanel::default()
            .frame(
                Frame::default()
                    .fill(colors::BLUE10)
                    .inner_margin(Margin::symmetric(24, 16)),
            )
            .show(ctx, |ui| {
                // Do the equivalent of `object-fit: cover` for the background image
                let screen_size = ctx.screen_rect().size();
                let background_scale =
                    (screen_size.x / BACKGROUND_SIZE.x).max(screen_size.y / BACKGROUND_SIZE.y);
                let scaled_size = BACKGROUND_SIZE * background_scale;
                let top_left = ctx.screen_rect().center() - scaled_size * 0.5;
                let background_rect = egui::Rect::from_min_size(top_left, scaled_size);
                egui::Image::new(egui::include_image!("images/loading-screen.webp"))
                    .tint(Color32::from_white_alpha(170))
                    .paint_at(ui, background_rect);

                ui.style_mut().spacing.item_spacing = [40.0, 24.0].into();
                ui.with_layout(
                    Layout::centered_and_justified(egui::Direction::TopDown),
                    |ui| {
                        StripBuilder::new(ui)
                            .size(egui_extras::Size::remainder().at_least(120.0))
                            .size(egui_extras::Size::exact(map_size.x + 4.0 + 4.0))
                            .size(egui_extras::Size::remainder().at_least(120.0))
                            .horizontal(|mut strip| {
                                strip.cell(|ui| {
                                    Flex::vertical()
                                        .align_items(FlexAlign::End)
                                        .justify(egui_flex::FlexJustify::Center)
                                        .w_full()
                                        .h_full()
                                        .show(ui, |flex| {
                                            start_players.iter().for_each(|p| {
                                                self.add_loading_player(
                                                    flex,
                                                    p,
                                                    &setup_info.users,
                                                    true,
                                                )
                                            });
                                        });
                                });

                                strip.cell(|ui| {
                                    Flex::vertical()
                                        .align_items(FlexAlign::Center)
                                        .justify(egui_flex::FlexJustify::Center)
                                        .w_full()
                                        .h_full()
                                        .show(ui, |flex| {
                                            flex.add_widget(
                                                egui_flex::item(),
                                                Label::new(
                                                    RichText::new(game_type_name)
                                                        .size(20.0)
                                                        .color(colors::BLUE95),
                                                ),
                                            );

                                            flex.add_ui(
                                                egui_flex::item().frame(
                                                    egui::Frame::default()
                                                        .fill(Color32::BLACK)
                                                        .corner_radius(CornerRadius::same(8))
                                                        .shadow(Shadow {
                                                            offset: [0, 0],
                                                            blur: 2,
                                                            spread: 2,
                                                            color: colors::BLUE80
                                                                .gamma_multiply(0.7),
                                                        }),
                                                ),
                                                |ui| {
                                                    if let Some(url) = map_image_url {
                                                        ui.add(
                                                            egui::Image::from_uri(url)
                                                                .show_loading_spinner(false)
                                                                .fit_to_exact_size(map_size)
                                                                .corner_radius(CornerRadius::same(
                                                                    8,
                                                                )),
                                                        );
                                                    }
                                                },
                                            );

                                            flex.add_widget(
                                                egui_flex::item(),
                                                Label::new(
                                                    RichText::new(map_name.unwrap_or(""))
                                                        .size(28.0)
                                                        .color(colors::GREY99)
                                                        .family(display_family()),
                                                ),
                                            );
                                        });
                                });

                                strip.cell(|ui| {
                                    Flex::vertical()
                                        .align_items(FlexAlign::Start)
                                        .justify(egui_flex::FlexJustify::Center)
                                        .w_full()
                                        .h_full()
                                        .show(ui, |flex| {
                                            end_players.iter().for_each(|p| {
                                                self.add_loading_player(
                                                    flex,
                                                    p,
                                                    &setup_info.users,
                                                    false,
                                                )
                                            });
                                        });
                                });
                            });
                    },
                );
            });

        if let Some(countdown_start) = bw.countdown_start {
            let elapsed = 5 - countdown_start.elapsed().as_secs().min(5);
            let area_width = 72.0;
            let x_center = ctx.screen_rect().center().x - area_width / 2.0;
            egui::Area::new("loading_screen_countdown".into())
                .fixed_pos(egui::pos2(x_center, 24.0))
                .show(ctx, |ui| {
                    ui.set_min_width(area_width);
                    ui.set_min_height(area_width);
                    Frame::default()
                        .fill(colors::BLUE50)
                        .multiply_with_opacity(0.5)
                        .corner_radius(CornerRadius::same(36))
                        .show(ui, |ui| {
                            ui.with_layout(
                                Layout::top_down(egui::Align::Center)
                                    .with_main_align(egui::Align::Center),
                                |ui| {
                                    let text = format!("{elapsed}");
                                    ui.add_sized(
                                        [area_width, area_width],
                                        Label::new(
                                            RichText::new(text)
                                                .size(56.0)
                                                .color(colors::GREY99)
                                                .family(display_family()),
                                        ),
                                    );
                                },
                            )
                        });
                });
        }
    }

    fn add_loading_player(
        &self,
        flex: &mut FlexInstance,
        player: &PlayerInfo,
        users: &[SbUser],
        is_start_team: bool,
    ) {
        let username = if player.player_type == SbSlotType::Computer {
            "Computer"
        } else {
            users
                .iter()
                .find(|u| Some(u.id) == player.user_id)
                .map(|u| u.name.as_str())
                .unwrap_or("Unknown Player")
        };
        let (race_icon, race_color) = match player.bw_race() {
            RACE_PROTOSS => (
                egui::include_image!("icons/zealot_24px.svg"),
                colors::PROTOSS,
            ),
            RACE_TERRAN => (
                egui::include_image!("icons/marine_24px.svg"),
                colors::TERRAN,
            ),
            RACE_ZERG => (egui::include_image!("icons/hydra_24px.svg"), colors::ZERG),
            _ => (
                egui::include_image!("icons/random_24px.svg"),
                colors::RANDOM,
            ),
        };

        flex.add_ui(
            egui_flex::item().frame(
                egui::Frame::default()
                    .fill(colors::CONTAINER_LOW)
                    .corner_radius(CornerRadius::same(8))
                    .shadow(Shadow {
                        offset: [0, 0],
                        blur: 2,
                        spread: 2,
                        color: colors::BLUE80.gamma_multiply(0.7),
                    })
                    .inner_margin(Margin::same(16)),
            ),
            |ui| {
                Flex::horizontal()
                    .w_auto()
                    .gap([16.0, 16.0].into())
                    .align_items(FlexAlign::Center)
                    .show(ui, |flex| {
                        let mut image = Some(
                            egui::Image::new(race_icon)
                                .fit_to_exact_size([40.0, 40.0].into())
                                .tint(race_color),
                        );

                        if !is_start_team && let Some(image) = image.take() {
                            flex.add(egui_flex::item(), image);
                        }
                        flex.add_ui(egui_flex::item().shrink(), |ui| {
                            ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Truncate);
                            ui.label(
                                RichText::new(username)
                                    .size(28.0)
                                    .color(colors::GREY99)
                                    .family(display_family()),
                            );
                        });
                        if let Some(image) = image {
                            flex.add(egui_flex::item(), image);
                        }
                    });
            },
        );
    }
}

fn get_player_halves(setup_info: &GameSetupInfo) -> (Vec<&PlayerInfo>, Vec<&PlayerInfo>) {
    let players = setup_info
        .slots
        .iter()
        .filter(|s| matches!(s.player_type, SbSlotType::Human | SbSlotType::Computer))
        .collect::<Vec<_>>();

    match setup_info.game_type {
        // TODO(tec27): We could probably do something better here for UMS (splitting based on
        // teams), but the logic is complex, so I'm not going to work through it/test it right now
        GameType::Melee | GameType::Ffa | GameType::OneVOne | GameType::Ums => {
            let half = players.len().div_ceil(2);
            let (a, b) = players.split_at(half);
            (a.to_vec(), b.to_vec())
        }
        // TODO(tec27): We could probably split this into 1 group per team and then display N teams
        // on each half (but with a slight gap)?
        GameType::TeamMelee | GameType::TeamFfa => {
            let half = players.len().div_ceil(2);
            let (a, b) = players.split_at(half);
            (a.to_vec(), b.to_vec())
        }
        GameType::TopVBottom => {
            let first_team = players[0].team_id;
            (
                players
                    .iter()
                    .copied()
                    .filter(|s| s.team_id == first_team)
                    .collect(),
                players
                    .into_iter()
                    .filter(|s| s.team_id != first_team)
                    .collect(),
            )
        }
    }
}
