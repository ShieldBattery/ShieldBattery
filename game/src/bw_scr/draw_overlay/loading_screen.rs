use egui::{Color32, CornerRadius, Frame, Label, Layout, Margin, RichText, Shadow, Vec2};
use egui_extras::StripBuilder;
use egui_flex::{Flex, FlexAlign, FlexInstance};

use crate::{
    app_messages::{
        GamePlayerRank, GameSetupInfo, GameType, MapInfo, MatchmakingDivision, PlayerInfo,
        SbSlotType, SbUser,
    },
    bw::{RACE_PROTOSS, RACE_TERRAN, RACE_ZERG},
    bw_scr::draw_overlay::{BwVars, OverlayState, colors, fonts::display_family},
};

const MAP_IMAGE_SIZE: Vec2 = Vec2::new(640.0, 640.0);
const SMALL_MAP_IMAGE_SIZE: Vec2 = Vec2::new(480.0, 480.0);
const MAP_BREAKPOINT: f32 = 1360.0;
const OBSERVER_ROW_HEIGHT: f32 = 48.0;
const OBSERVER_AVATAR_SIZE: f32 = 24.0;
const OBSERVER_NAME_MAX_WIDTH: f32 = 200.0;

// TODO(tec27): This is probably retrievable from egui?
const BACKGROUND_SIZE: Vec2 = Vec2::new(1920.0, 1152.0);

impl OverlayState {
    pub fn add_loading_screen_ui(
        &mut self,
        bw: &BwVars,
        setup_info: Option<&GameSetupInfo>,
        ui: &mut egui::Ui,
    ) {
        // egui 0.34 made `CentralPanel::show` take a `&mut Ui` (drawn into the pass's root Ui)
        // rather than a `&Context`. The rest of this fn still wants the context for image loading and
        // the floating countdown Area, so hold onto a clone.
        let ctx = ui.ctx().clone();
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
                .show(ui, |_ui| {});
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
        let observers = setup_info
            .slots
            .iter()
            .filter(|s| s.is_observer())
            .collect::<Vec<_>>();

        let map_size = if ctx.content_rect().size().x < MAP_BREAKPOINT {
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
            .show(ui, |ui| {
                // Do the equivalent of `object-fit: cover` for the background image
                let screen_size = ctx.content_rect().size();
                let background_scale =
                    (screen_size.x / BACKGROUND_SIZE.x).max(screen_size.y / BACKGROUND_SIZE.y);
                let scaled_size = BACKGROUND_SIZE * background_scale;
                let top_left = ctx.content_rect().center() - scaled_size * 0.5;
                let background_rect = egui::Rect::from_min_size(top_left, scaled_size);
                egui::Image::new(egui::include_image!("images/loading-screen.webp"))
                    .tint(Color32::from_white_alpha(170))
                    .paint_at(ui, background_rect);

                ui.style_mut().spacing.item_spacing = [40.0, 24.0].into();
                ui.with_layout(
                    Layout::centered_and_justified(egui::Direction::TopDown),
                    |ui| {
                        // Observers get their own row along the bottom, and the players and map
                        // center in the space above it, so the two never overlap.
                        let mut rows = StripBuilder::new(ui).size(egui_extras::Size::remainder());
                        if !observers.is_empty() {
                            rows = rows.size(egui_extras::Size::exact(OBSERVER_ROW_HEIGHT));
                        }
                        rows.vertical(|mut rows| {
                            rows.strip(|builder| {
                                builder
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
                                                            &setup_info.ranks,
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
                                                                .corner_radius(CornerRadius::same(
                                                                    8,
                                                                ))
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
                                                                        .corner_radius(
                                                                            CornerRadius::same(8),
                                                                        ),
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
                                                            &setup_info.ranks,
                                                            false,
                                                        )
                                                    });
                                                });
                                        });
                                    });
                            });
                            if !observers.is_empty() {
                                rows.cell(|ui| add_observer_row(ui, &observers, &setup_info.users));
                            }
                        });
                    },
                );
            });

        if let Some(countdown_start) = bw.countdown_start {
            let elapsed = 5 - countdown_start.elapsed().as_secs().min(5);
            let area_width = 80.0;
            let x_center = ctx.content_rect().center().x - area_width / 2.0;
            egui::Area::new("loading_screen_countdown".into())
                .fixed_pos(egui::pos2(x_center, 24.0))
                .show(&ctx, |ui| {
                    ui.set_min_width(area_width);
                    ui.set_min_height(area_width);
                    Frame::default()
                        .fill(colors::BLUE50)
                        .multiply_with_opacity(0.5)
                        .corner_radius(CornerRadius::same(40))
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
        ranks: &[GamePlayerRank],
        is_start_team: bool,
    ) {
        let user = if player.player_type == SbSlotType::Computer {
            None
        } else {
            users.iter().find(|u| Some(u.id) == player.user_id)
        };
        let username = if player.player_type == SbSlotType::Computer {
            "Computer"
        } else {
            user.map(|u| u.name.as_str()).unwrap_or("Unknown Player")
        };
        let avatar_url = user.and_then(|u| u.avatar_url.as_deref());
        let rank = ranks.iter().find(|r| Some(r.user_id) == player.user_id);
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
                        let race_image = egui::Image::new(race_icon)
                            .fit_to_exact_size([40.0, 40.0].into())
                            .tint(race_color);
                        // A circular avatar, shown only when the user has uploaded one. The race
                        // icon always sits on the inner (map-facing) edge, and the avatar (when
                        // present) sits on the outer edge, with the name in between.
                        let avatar = avatar_url.map(|url| {
                            egui::Image::from_uri(url)
                                .show_loading_spinner(false)
                                .fit_to_exact_size([40.0, 40.0].into())
                                .corner_radius(CornerRadius::same(20))
                        });

                        let add_name = |flex: &mut FlexInstance| {
                            flex.add_ui(egui_flex::item().shrink(), |ui| {
                                ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Truncate);
                                ui.vertical(|ui| {
                                    ui.spacing_mut().item_spacing.y = 4.0;
                                    ui.label(
                                        RichText::new(username)
                                            .size(28.0)
                                            .color(colors::GREY99)
                                            .family(display_family()),
                                    );
                                    if let Some(rank) = rank {
                                        add_rank(ui, rank);
                                    }
                                });
                            });
                        };

                        if is_start_team {
                            if let Some(avatar) = avatar {
                                flex.add(egui_flex::item(), avatar);
                            }
                            add_name(flex);
                            flex.add(egui_flex::item(), race_image);
                        } else {
                            flex.add(egui_flex::item(), race_image);
                            add_name(flex);
                            if let Some(avatar) = avatar {
                                flex.add(egui_flex::item(), avatar);
                            }
                        }
                    });
            },
        );
    }
}

/// Adds a centered row listing the game's observers, each as a compact name (with their avatar if
/// they have one) so they read as secondary to the player cards.
fn add_observer_row(ui: &mut egui::Ui, observers: &[&PlayerInfo], users: &[SbUser]) {
    Flex::horizontal()
        .align_items(FlexAlign::Center)
        .justify(egui_flex::FlexJustify::Center)
        .gap([12.0, 12.0].into())
        .w_full()
        .h_full()
        .show(ui, |flex| {
            // TODO(i18n): Translate this, along with the rest of the loading screen's strings
            flex.add(
                egui_flex::item(),
                Label::new(RichText::new("Observers").size(16.0).color(colors::GREY60)),
            );

            for observer in observers {
                let user = users.iter().find(|u| Some(u.id) == observer.user_id);
                let name = user.map(|u| u.name.as_str()).unwrap_or("Unknown Player");
                let avatar_url = user.and_then(|u| u.avatar_url.as_deref());

                flex.add_ui(
                    egui_flex::item().frame(
                        Frame::default()
                            .fill(colors::CONTAINER_LOW)
                            .corner_radius(CornerRadius::same(8))
                            .inner_margin(Margin::symmetric(12, 8)),
                    ),
                    |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 8.0;
                            if let Some(url) = avatar_url {
                                ui.add(
                                    egui::Image::from_uri(url)
                                        .show_loading_spinner(false)
                                        .fit_to_exact_size(Vec2::splat(OBSERVER_AVATAR_SIZE))
                                        .corner_radius(CornerRadius::same(
                                            (OBSERVER_AVATAR_SIZE / 2.0) as u8,
                                        )),
                                );
                            }
                            ui.scope(|ui| {
                                ui.set_max_width(OBSERVER_NAME_MAX_WIDTH);
                                ui.add(
                                    Label::new(
                                        RichText::new(name)
                                            .size(18.0)
                                            .color(colors::GREY99)
                                            .family(display_family()),
                                    )
                                    .truncate(),
                                );
                            });
                        });
                    },
                );
            }
        });
}

/// Adds a line showing the player's division icon and name, followed by their rating when it's
/// known (it isn't during placement matches).
fn add_rank(ui: &mut egui::Ui, rank: &GamePlayerRank) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 8.0;
        if let Some((icon, label)) = division_icon_and_label(rank.division) {
            ui.add(egui::Image::new(icon).fit_to_exact_size([32.0, 32.0].into()));
            ui.label(RichText::new(label).size(18.0).color(colors::GREY90));
        }
        if let Some(rating) = rank.rating {
            ui.label(
                RichText::new(format!("{} MMR", rating.round() as i32))
                    .size(18.0)
                    .color(colors::GREY60),
            );
        }
    });
}

// TODO(i18n): Translate these, along with the rest of the loading screen's strings
fn division_icon_and_label(
    division: MatchmakingDivision,
) -> Option<(egui::ImageSource<'static>, &'static str)> {
    // The icons are the same ones the web client serves, embedded so the loading screen never
    // waits on a download.
    let result = match division {
        MatchmakingDivision::Unrated => (
            egui::include_image!("../../../../server/public/images/ranks/unrated.svg"),
            "Unrated",
        ),
        MatchmakingDivision::Bronze1 => (
            egui::include_image!("../../../../server/public/images/ranks/bronze1.svg"),
            "Bronze 1",
        ),
        MatchmakingDivision::Bronze2 => (
            egui::include_image!("../../../../server/public/images/ranks/bronze2.svg"),
            "Bronze 2",
        ),
        MatchmakingDivision::Bronze3 => (
            egui::include_image!("../../../../server/public/images/ranks/bronze3.svg"),
            "Bronze 3",
        ),
        MatchmakingDivision::Silver1 => (
            egui::include_image!("../../../../server/public/images/ranks/silver1.svg"),
            "Silver 1",
        ),
        MatchmakingDivision::Silver2 => (
            egui::include_image!("../../../../server/public/images/ranks/silver2.svg"),
            "Silver 2",
        ),
        MatchmakingDivision::Silver3 => (
            egui::include_image!("../../../../server/public/images/ranks/silver3.svg"),
            "Silver 3",
        ),
        MatchmakingDivision::Gold1 => (
            egui::include_image!("../../../../server/public/images/ranks/gold1.svg"),
            "Gold 1",
        ),
        MatchmakingDivision::Gold2 => (
            egui::include_image!("../../../../server/public/images/ranks/gold2.svg"),
            "Gold 2",
        ),
        MatchmakingDivision::Gold3 => (
            egui::include_image!("../../../../server/public/images/ranks/gold3.svg"),
            "Gold 3",
        ),
        MatchmakingDivision::Platinum1 => (
            egui::include_image!("../../../../server/public/images/ranks/platinum1.svg"),
            "Platinum 1",
        ),
        MatchmakingDivision::Platinum2 => (
            egui::include_image!("../../../../server/public/images/ranks/platinum2.svg"),
            "Platinum 2",
        ),
        MatchmakingDivision::Platinum3 => (
            egui::include_image!("../../../../server/public/images/ranks/platinum3.svg"),
            "Platinum 3",
        ),
        MatchmakingDivision::Diamond1 => (
            egui::include_image!("../../../../server/public/images/ranks/diamond1.svg"),
            "Diamond 1",
        ),
        MatchmakingDivision::Diamond2 => (
            egui::include_image!("../../../../server/public/images/ranks/diamond2.svg"),
            "Diamond 2",
        ),
        MatchmakingDivision::Diamond3 => (
            egui::include_image!("../../../../server/public/images/ranks/diamond3.svg"),
            "Diamond 3",
        ),
        MatchmakingDivision::Champion => (
            egui::include_image!("../../../../server/public/images/ranks/champion.svg"),
            "Champion",
        ),
        MatchmakingDivision::Unknown => return None,
    };
    Some(result)
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
