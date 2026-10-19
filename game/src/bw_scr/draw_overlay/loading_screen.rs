use std::time::Instant;

use egui::epaint::{Mesh, RectShape, Tessellator};
use egui::load::TexturePoll;
use egui::{
    Color32, CornerRadius, Frame, Label, Layout, Margin, Painter, Pos2, Rect, RichText, Shadow,
    Shape, Stroke, StrokeKind, Vec2,
};
use egui_extras::StripBuilder;
use egui_flex::{Flex, FlexAlign, FlexInstance};

use crate::{
    app_messages::{
        GamePlayerRank, GameSetupInfo, GameType, MapData, MapInfo, MapStartLocation,
        MatchmakingDivision, PlayerInfo, SbSlotType, SbUser,
    },
    bw::{RACE_PROTOSS, RACE_TERRAN, RACE_ZERG},
    bw_scr::draw_overlay::{BwVars, OverlayState, colors, fonts::display},
    game_thread,
    netcode_v2::{LoadingConnectivity, LoadingPresence, loading_presence},
};

const MAP_IMAGE_SIZE: Vec2 = Vec2::new(640.0, 640.0);
const SMALL_MAP_IMAGE_SIZE: Vec2 = Vec2::new(480.0, 480.0);
const MAP_BREAKPOINT: f32 = 1360.0;
const OBSERVER_ROW_HEIGHT: f32 = 48.0;
const OBSERVER_AVATAR_SIZE: f32 = 24.0;
const OBSERVER_NAME_MAX_WIDTH: f32 = 200.0;
/// How opaque a participant who hasn't connected yet is drawn.
const UNCONNECTED_OPACITY: f32 = 0.45;
/// How long a participant takes to fade between the connected and unconnected looks.
const PRESENCE_FADE_SECS: f32 = 0.3;

/// Spawn markers are "player tokens" matching the ones broodmap paints for start locations: a
/// rounded block of a start location's 4x3-tile footprint with a top-to-bottom gradient, a dark
/// outer and light inner bezel, and a soft drop shadow. They're never narrower than this, so they
/// stay readable on large maps.
const SPAWN_MARKER_MIN_WIDTH: f32 = 16.0;
/// Each start location is drawn in its slot's default player color, as broodmap and the map tiles
/// color them.
const SPAWN_MARKER_SLOT_COLORS: [Color32; 8] = [
    Color32::from_rgb(0xF4, 0x04, 0x04),
    Color32::from_rgb(0x0C, 0x48, 0xCC),
    Color32::from_rgb(0x2C, 0xB4, 0x94),
    Color32::from_rgb(0x88, 0x40, 0x9C),
    Color32::from_rgb(0xF8, 0x8C, 0x14),
    Color32::from_rgb(0x70, 0x30, 0x14),
    Color32::from_rgb(0xCC, 0xE0, 0xD0),
    Color32::from_rgb(0xFC, 0xFC, 0x38),
];
/// For a start location whose slot is out of range.
const SPAWN_MARKER_FALLBACK_COLOR: Color32 = Color32::from_rgb(0xD8, 0xD8, 0xD8);
/// The fill's top row is brightened by this fraction of its color, and its bottom row darkened.
const SPAWN_MARKER_GRADIENT: f32 = 0.12;
const SPAWN_MARKER_OUTER_STROKE: Color32 = Color32::from_rgba_premultiplied(0, 0, 0, 191);
const SPAWN_MARKER_INNER_STROKE: Color32 = Color32::from_rgba_premultiplied(179, 179, 179, 179);
const SPAWN_MARKER_SHADOW: Shadow = Shadow {
    offset: [0, 1],
    blur: 2,
    spread: 0,
    color: Color32::from_rgba_premultiplied(0, 0, 0, 89),
};

// TODO(tec27): This is probably retrievable from egui?
const BACKGROUND_SIZE: Vec2 = Vec2::new(1920.0, 1152.0);

impl OverlayState {
    pub fn add_loading_screen_ui(
        &mut self,
        bw: &BwVars,
        setup_info: Option<&GameSetupInfo>,
        loading_connectivity: Option<&LoadingConnectivity>,
        ui: &mut egui::Ui,
    ) {
        // `CentralPanel::show` draws into `ui`, but image loading and the floating countdown Area
        // want the context.
        let ctx = ui.ctx().clone();
        if !bw.has_init_bw
            && let Some(info) = setup_info
            && !info.is_replay()
        {
            // Preload the images we're going to display
            match &info.map {
                MapInfo::Game(info) => info.loading_screen_image_url().inspect(|url| {
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
        let (map_name, map_image_url, spawn_map) = match &setup_info.map {
            MapInfo::Game(info) => (
                Some(info.name.as_str()),
                info.loading_screen_image_url(),
                // Images with start locations drawn in already show them. UMS maps often stack
                // start locations in one spot or park them outside the playable area, since their
                // triggers move players elsewhere, so markers there wouldn't show where anyone plays.
                (info.needs_spawn_markers() && setup_info.game_type != GameType::Ums)
                    .then_some(&info.map_data),
            ),
            MapInfo::Replay(_) => (None, None, None),
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

        let local_user = game_thread::local_user_id();
        let now = Instant::now();
        let presence = |player: &PlayerInfo| match player.user_id {
            Some(user) if player.player_type != SbSlotType::Computer => {
                loading_presence(loading_connectivity, user, local_user, now)
            }
            _ => LoadingPresence::Connected,
        };

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
                                                            presence(p),
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
                                                                add_map_image(
                                                                    ui, url, map_size, spawn_map,
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
                                                                .family(display()),
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
                                                            presence(p),
                                                            false,
                                                        )
                                                    });
                                                });
                                        });
                                    });
                            });
                            if !observers.is_empty() {
                                rows.cell(|ui| {
                                    add_observer_row(ui, &observers, &setup_info.users, presence)
                                });
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
                                                .family(display()),
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
        presence: LoadingPresence,
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

        let opacity = presence_opacity(flex.ui().ctx(), player, presence);
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
                    .inner_margin(Margin::same(16))
                    .multiply_with_opacity(opacity),
            ),
            |ui| {
                ui.multiply_opacity(opacity);
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
                                            .family(display()),
                                    );
                                    if let Some(rank) = rank {
                                        add_rank(ui, rank);
                                    }
                                    add_presence_note(ui, presence, 16.0);
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

/// Adds the map's image, fit within `map_size`, with each of `spawn_map`'s start locations marked
/// over it in its slot's color. The colors only tell start locations apart: BW decides which player
/// starts where as the game starts, after the loading screen is gone.
fn add_map_image(ui: &mut egui::Ui, url: &str, map_size: Vec2, spawn_map: Option<&MapData>) {
    let image = egui::Image::from_uri(url)
        .show_loading_spinner(false)
        .fit_to_exact_size(map_size)
        .corner_radius(CornerRadius::same(8));
    // Until the image loads it's laid out at a placeholder size rather than the map's aspect ratio,
    // so markers placed in its rect would land in the wrong spots.
    let loaded = matches!(
        image.load_for_size(ui.ctx(), map_size),
        Ok(TexturePoll::Ready { .. })
    );
    let image_rect = ui.add(image).rect;
    if let Some(map) = spawn_map.filter(|_| loaded) {
        paint_spawn_markers(ui.painter(), map, image_rect);
    }
}

fn paint_spawn_markers(painter: &Painter, map: &MapData, image_rect: Rect) {
    for location in &map.start_locations {
        if let Some(center) = spawn_marker_center(location, map.width, map.height, image_rect) {
            paint_spawn_marker(
                painter,
                spawn_marker_rect(center, map.width, image_rect),
                SPAWN_MARKER_SLOT_COLORS
                    .get(usize::from(location.slot))
                    .copied()
                    .unwrap_or(SPAWN_MARKER_FALLBACK_COLOR),
            );
        }
    }
}

fn paint_spawn_marker(painter: &Painter, rect: Rect, color: Color32) {
    let radius = rect.height() * 0.2;
    painter.add(SPAWN_MARKER_SHADOW.as_shape(rect, radius));

    // egui fills shapes with a single color, so the gradient is applied to the vertices of the
    // tessellated fill instead.
    let mut tessellator = Tessellator::new(
        painter.pixels_per_point(),
        painter.ctx().tessellation_options(|o| *o),
        painter.ctx().fonts(|f| f.font_image_size()),
        Vec::new(),
    );
    let mut fill = Mesh::default();
    tessellator.tessellate_rect(&RectShape::filled(rect, radius, color), &mut fill);
    for vertex in &mut fill.vertices {
        let t = ((vertex.pos.y - rect.top()) / rect.height()).clamp(0.0, 1.0);
        let scale = 1.0 + SPAWN_MARKER_GRADIENT - 2.0 * SPAWN_MARKER_GRADIENT * t;
        vertex.color = scale_premultiplied(vertex.color, scale);
    }
    painter.add(Shape::mesh(fill));

    painter.rect_stroke(
        rect,
        radius,
        Stroke::new(1.0, SPAWN_MARKER_OUTER_STROKE),
        StrokeKind::Inside,
    );
    painter.rect_stroke(
        rect.shrink(1.0),
        (radius - 1.0).max(0.0),
        Stroke::new(1.0, SPAWN_MARKER_INNER_STROKE),
        StrokeKind::Inside,
    );
}

/// Scales `color`'s RGB by `scale`, keeping it a valid premultiplied color (no channel above alpha).
fn scale_premultiplied(color: Color32, scale: f32) -> Color32 {
    let [r, g, b, a] = color.to_array();
    let channel = |c: u8| (f32::from(c) * scale).round().clamp(0.0, f32::from(a)) as u8;
    Color32::from_rgba_premultiplied(channel(r), channel(g), channel(b), a)
}

/// The marker for a start location centered at `center`: its 4x3-tile footprint at the scale the
/// map is drawn into `image_rect`, widened to at least [`SPAWN_MARKER_MIN_WIDTH`].
fn spawn_marker_rect(center: Pos2, map_width_tiles: u16, image_rect: Rect) -> Rect {
    let footprint_width = 4.0 / f32::from(map_width_tiles.max(1)) * image_rect.width();
    let width = footprint_width.max(SPAWN_MARKER_MIN_WIDTH);
    Rect::from_center_size(center, egui::vec2(width, width * 0.75))
}

/// Where to center the marker for `location` when a map of the given size in tiles is drawn into
/// `image_rect`. Map images cover exactly the map's area, so positions map proportionally into the
/// rect. `None` for a map with no area.
fn spawn_marker_center(
    location: &MapStartLocation,
    map_width_tiles: u16,
    map_height_tiles: u16,
    image_rect: Rect,
) -> Option<Pos2> {
    if map_width_tiles == 0 || map_height_tiles == 0 {
        return None;
    }
    let map_width = f32::from(map_width_tiles) * 32.0;
    let map_height = f32::from(map_height_tiles) * 32.0;
    Some(
        image_rect.min
            + egui::vec2(
                f32::from(location.x) / map_width * image_rect.width(),
                f32::from(location.y) / map_height * image_rect.height(),
            ),
    )
}

/// Adds a centered row listing the game's observers, each as a compact name (with their avatar if
/// they have one) so they read as secondary to the player cards.
fn add_observer_row(
    ui: &mut egui::Ui,
    observers: &[&PlayerInfo],
    users: &[SbUser],
    presence: impl Fn(&PlayerInfo) -> LoadingPresence,
) {
    let ctx = ui.ctx().clone();
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
                let presence = presence(observer);
                let opacity = presence_opacity(&ctx, observer, presence);

                flex.add_ui(
                    egui_flex::item().frame(
                        Frame::default()
                            .fill(colors::CONTAINER_LOW)
                            .corner_radius(CornerRadius::same(8))
                            .inner_margin(Margin::symmetric(12, 8))
                            .multiply_with_opacity(opacity),
                    ),
                    |ui| {
                        ui.multiply_opacity(opacity);
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
                                            .family(display()),
                                    )
                                    .truncate(),
                                );
                            });
                            add_presence_note(ui, presence, 14.0);
                        });
                    },
                );
            }
        });
}

/// The opacity to draw `player`'s card at for `presence`, eased so a player connecting fades in
/// rather than popping.
fn presence_opacity(ctx: &egui::Context, player: &PlayerInfo, presence: LoadingPresence) -> f32 {
    let target = match presence {
        LoadingPresence::Connected => 1.0,
        LoadingPresence::Connecting | LoadingPresence::Waiting => UNCONNECTED_OPACITY,
    };
    ctx.animate_value_with_time(
        egui::Id::new(("loading_presence", player.user_id.map(|u| u.0))),
        target,
        PRESENCE_FADE_SECS,
    )
}

/// Adds a short note saying a participant hasn't connected yet, and nothing once they have. Drawn
/// inside the participant's dimmed card, so its colors are picked to stay readable at that opacity.
fn add_presence_note(ui: &mut egui::Ui, presence: LoadingPresence, size: f32) {
    // TODO(i18n): Translate these, along with the rest of the loading screen's strings
    let (text, color) = match presence {
        LoadingPresence::Connected => return,
        LoadingPresence::Connecting => ("Connecting…", colors::GREY_BLUE70),
        LoadingPresence::Waiting => ("Waiting for player", colors::AMBER80),
    };
    // Undo the card's dimming for the note itself, so the reason it's dimmed stays legible.
    ui.scope(|ui| {
        ui.set_opacity(1.0);
        ui.label(RichText::new(text).size(size).color(color));
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

#[cfg(test)]
mod test {
    use super::*;

    fn rect(x: f32, y: f32, width: f32, height: f32) -> Rect {
        Rect::from_min_size(egui::pos2(x, y), egui::vec2(width, height))
    }

    fn location(x: u16, y: u16) -> MapStartLocation {
        MapStartLocation { x, y, slot: 0 }
    }

    #[test]
    fn spawn_marker_maps_position_proportionally_into_rect() {
        // A 128x96 map is 4096x3072 pixels; drawn at 640x480 that's 0.15625 rect px per map px.
        let center = spawn_marker_center(
            &location(1024, 2048),
            128,
            96,
            rect(100.0, 50.0, 640.0, 480.0),
        )
        .unwrap();
        assert_eq!(center, egui::pos2(100.0 + 160.0, 50.0 + 320.0));
    }

    #[test]
    fn spawn_marker_corners_map_to_rect_corners() {
        let image_rect = rect(0.0, 0.0, 480.0, 240.0);
        let top_left = spawn_marker_center(&location(0, 0), 128, 64, image_rect).unwrap();
        let bottom_right = spawn_marker_center(&location(4096, 2048), 128, 64, image_rect).unwrap();
        assert_eq!(top_left, image_rect.min);
        assert_eq!(bottom_right, image_rect.max);
    }

    #[test]
    fn spawn_marker_rect_is_the_start_location_footprint() {
        let image_rect = rect(0.0, 0.0, 640.0, 640.0);
        let marker = spawn_marker_rect(Pos2::new(100.0, 100.0), 64, image_rect);
        assert_eq!(marker.center(), Pos2::new(100.0, 100.0));
        assert_eq!(marker.size(), egui::vec2(40.0, 30.0));
    }

    #[test]
    fn spawn_marker_rect_has_a_minimum_width() {
        let image_rect = rect(0.0, 0.0, 480.0, 480.0);
        let marker = spawn_marker_rect(Pos2::new(100.0, 100.0), 256, image_rect);
        assert_eq!(marker.size(), egui::vec2(16.0, 12.0));
    }

    #[test]
    fn scale_premultiplied_never_exceeds_alpha() {
        let half_white = Color32::from_rgba_premultiplied(120, 120, 120, 128);
        assert_eq!(
            scale_premultiplied(half_white, 1.12),
            Color32::from_rgba_premultiplied(128, 128, 128, 128)
        );
        assert_eq!(
            scale_premultiplied(half_white, 0.5),
            Color32::from_rgba_premultiplied(60, 60, 60, 128)
        );
    }

    #[test]
    fn spawn_marker_skips_maps_without_area() {
        let image_rect = rect(0.0, 0.0, 640.0, 640.0);
        assert!(spawn_marker_center(&location(100, 100), 0, 128, image_rect).is_none());
        assert!(spawn_marker_center(&location(100, 100), 128, 0, image_rect).is_none());
    }
}
