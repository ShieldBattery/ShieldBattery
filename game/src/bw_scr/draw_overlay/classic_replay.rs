//! Original replay statistics, native-control background and production presentation.
use super::{
    BwVars, OverlayState, ReplayUiValues, Texture, has_player_vision, player_has_units,
    replay_players_by_team, team_vision_mask,
};
use crate::bw;
use crate::bw::apm_stats::ApmStats;
use bw_dat::Race;
use egui::epaint;
use egui::load::SizedTexture;
use egui::{
    Align, Align2, Color32, Id, Label, Layout, Rect, Response, Sense, TextureId, UiBuilder, Vec2,
    Widget, WidgetText, pos2, vec2,
};
use std::borrow::Cow;
trait UiExt {
    fn add_fixed_width<W: Widget>(&mut self, widget: W, width: f32);
    fn with_fixed_width<F: FnOnce(&mut Self)>(&mut self, width: f32, add_widgets: F);
}

impl UiExt for egui::Ui {
    fn add_fixed_width<W: Widget>(&mut self, widget: W, width: f32) {
        self.with_fixed_width(width, |ui| {
            ui.add(widget);
        })
    }

    fn with_fixed_width<F: FnOnce(&mut Self)>(&mut self, width: f32, add_widgets: F) {
        // egui doesn't like infinite sizes for ui rects (has a debug assertion),
        // so just replace infinite sides with very large end..
        // Not really sure what this should use anyway.
        let child_rect = self.cursor().intersect(Rect::from_center_size(
            pos2(0.0, 0.0),
            vec2(10000.0, 10000.0),
        ));
        let mut child_ui =
            self.new_child(UiBuilder::new().max_rect(child_rect).layout(*self.layout()));

        let mut clip_rect = child_ui.cursor();
        clip_rect.set_width(width);
        child_ui.set_clip_rect(clip_rect);

        add_widgets(&mut child_ui);
        let mut final_child_rect = child_ui.min_rect();
        final_child_rect.set_width(width);
        self.allocate_rect(final_child_rect, Sense::hover());
    }
}

impl OverlayState {
    pub(super) fn add_classic_replay_ui(
        &mut self,
        bw: &BwVars,
        apm: Option<&ApmStats>,
        ctx: &egui::Context,
    ) {
        if self.classic_ui.show_statistics {
            self.add_replay_statistics(bw, apm, ctx);
        }
        if self.classic_ui.show_production {
            self.add_production_ui(bw, ctx);
        }
    }
    pub(super) fn make_button_panel_rect(
        &mut self,
        bw: &BwVars,
        pixels_per_point: f32,
    ) -> Vec<egui::ClippedPrimitive> {
        let mut shapes = Vec::new();
        let full_clip_rect = Rect::from_two_pos(
            pos2(0.0, 0.0),
            pos2(self.screen_size.0 as f32, self.screen_size.1 as f32),
        );

        let statbtn_dialog =
            bw::iter_dialogs(bw.dialogs.first()).find(|x| x.as_control().string() == "StatBtn");
        if let Some(dialog) = statbtn_dialog {
            let ctrl = dialog.as_control();
            if !ctrl.is_hidden() {
                let area = ctrl.screen_coords();
                let max_x = self.bw_dialog_coords_max_x() as i16;
                let rect = epaint::RectShape::new(
                    Rect::from_two_pos(
                        // left - 1 just since otherwise there'd be a thin column of lighter
                        // pixels left there.
                        self.bw_dialog_point_to_egui(area.left - 1, area.top),
                        // Dialog goes off the screen unless using minimap-on-center layout;
                        // clamp to screen width so that border stays visible.
                        self.bw_dialog_point_to_egui(area.right.min(max_x), 480),
                    ),
                    egui::CornerRadius::same(2),
                    Color32::BLACK,
                    egui::Stroke::new(2.0, Color32::DARK_GREEN),
                    egui::StrokeKind::Inside,
                );
                shapes.push(epaint::ClippedShape {
                    clip_rect: full_clip_rect,
                    shape: rect.into(),
                });
            }
        }
        self.ctx.tessellate(shapes, pixels_per_point)
    }
    fn add_replay_statistics(&mut self, bw: &BwVars, apm: Option<&ApmStats>, ctx: &egui::Context) {
        let res = egui::Window::new("Replay_Resources")
            .anchor(Align2::RIGHT_TOP, Vec2 { x: -10.0, y: 10.0 })
            .movable(false)
            .resizable(false)
            .title_bar(false)
            .show(ctx, |ui| {
                // Add separators between teams
                // So before first player of team but not before first player of all.
                let mut players_shown = false;
                let mut team_players_shown = false;
                let mut prev_team = 0;
                for (team, player_id) in replay_players_by_team(bw) {
                    // Skip players with no units -- assuming they're UMS map observers.
                    // UMS map with triggers can have players sometimes be
                    // without units until triggers let them play, but probably this
                    // won't be too relevant.
                    // But show all players in team games even though units are owned by one
                    // of them.
                    if !player_has_units(bw, player_id) && !bw.is_shared_control {
                        // But if we have player's vision enabled (Can be done through
                        // vision button above minimap / player having had units before),
                        // show player's name so that the user (hopefully) realizes that
                        // they provide vision.
                        if !has_player_vision(bw, player_id) {
                            continue;
                        }
                    }
                    if team != prev_team {
                        prev_team = team;
                        team_players_shown = false;
                    }
                    let info = unsafe {
                        let player = bw.players.add(player_id as usize);
                        player_resources_info(bw, player, player_id, apm)
                    };
                    if players_shown && !team_players_shown {
                        ui.scope(|ui| {
                            // Separators seem hard to see with 1.0 default
                            // stroke width.
                            let stroke =
                                &mut ui.style_mut().visuals.widgets.noninteractive.bg_stroke;
                            stroke.width = 2.0;
                            ui.separator();
                        });
                    }
                    let id = Id::new(("ReplayPlayerInfo", player_id));
                    let response = self.add_player_info(ui, id, &info);
                    if response.clicked() && player_id < 8 {
                        let bit = 1u8 << player_id;
                        let mask = unsafe { team_vision_mask(bw, player_id) };
                        // This seems to be enough.
                        // BW itself also writes non-replay player visions and exploration
                        // but they seem to be ignored anyway / wouldn't work as
                        // expected if they were read.
                        if bw.replay_visions & bit != 0 {
                            self.out_state.replay_visions &= !mask;
                        } else {
                            self.out_state.replay_visions |= mask;
                        }
                        if let Some(val) = self
                            .player_vision_was_auto_disabled
                            .get_mut(player_id as usize)
                        {
                            *val = false;
                        }
                    }
                    players_shown = true;
                    team_players_shown = true;
                }
            });
        self.add_ui_rect(&res);
    }
    fn add_player_info(&self, ui: &mut egui::Ui, id: Id, info: &PlayerInfo) -> Response {
        let size = Vec2 { x: 300.0, y: 24.0 };
        ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Center), |ui| {
            let ReplayUiValues {
                name_width,
                resource_width,
                supply_width,
                workers_width,
                apm_width,
                ..
            } = self.replay_ui_values;

            ui.with_fixed_width(name_width, |ui| {
                if !info.vision {
                    let x = egui::RichText::new("❌").color(Color32::RED);
                    ui.add(Label::new(x));
                }
                let text = egui::RichText::new(&*info.name).color(info.color);
                ui.add(Label::new(text));
            });

            let mineral_icon = Texture::StatRes(0);
            info.add_icon_text(ui, mineral_icon, &info.minerals.to_string(), resource_width);
            let gas_icon = Texture::StatRes(1 + info.race.min(2u8) as u16);
            info.add_icon_text(ui, gas_icon, &info.gas.to_string(), resource_width);

            let worker_icon = Texture::CmdIcon(match info.race {
                0 => bw_dat::unit::DRONE.0,
                1 => bw_dat::unit::SCV.0,
                _ => bw_dat::unit::PROBE.0,
            });
            info.add_colored_icon_text(
                ui,
                worker_icon,
                &info.workers.to_string(),
                workers_width,
                Color32::YELLOW,
            );

            // TODO Could add other races if player has supply for them?
            // But then each PlayerInfo render should agree on how many race supplies are drawn
            // to keep things on a grid.
            let (current, max) = info
                .supplies
                .get(info.race as usize)
                .copied()
                .unwrap_or((0, 0));
            // Supply text is slightly more complex as part of it is colored red when
            // supply blocked.
            let part1 = format!("{current}");
            let part2 = format!(" / {max}");
            // Didn't see any nice function to apply all style font overrides,
            // but as long as those don't exist this should match other text.
            let font_id = egui::style::FontSelection::Default.resolve(ui.style());
            let strong_color = ui.visuals().strong_text_color();
            let color = if current > max {
                Color32::RED
            } else {
                strong_color
            };
            let mut text = egui::text::LayoutJob::simple_singleline(part1, font_id.clone(), color);
            text.append(
                &part2,
                0.0,
                egui::TextFormat {
                    font_id,
                    color: strong_color,
                    ..Default::default()
                },
            );
            let supply_icon = Texture::StatRes(4 + info.race.min(2u8) as u16);
            info.add_colored_icon_complex_text(
                ui,
                supply_icon,
                text.into(),
                supply_width,
                Color32::WHITE,
            );

            let label = Label::new(egui::RichText::new("APM "));
            ui.add(label);
            let label = Label::new(egui::RichText::new(info.apm.to_string()).strong());
            ui.add_fixed_width(label, apm_width);
            ui.interact(ui.min_rect(), id, Sense::click())
        })
        .inner
    }
    pub(super) fn add_ui_rect<T>(&mut self, response: &Option<egui::InnerResponse<T>>) {
        if self.ui_active {
            self.force_add_ui_rect(response, false);
        }
    }
}
struct PlayerInfo {
    name: Cow<'static, str>,
    color: Color32,
    race: u8,
    minerals: u32,
    gas: u32,
    supplies: [(u32, u32); 3],
    workers: u32,
    apm: u32,
    vision: bool,
}
impl PlayerInfo {
    fn add_icon_text(&self, ui: &mut egui::Ui, icon: Texture, text: &str, width: f32) {
        self.add_colored_icon_text(ui, icon, text, width, Color32::WHITE)
    }

    fn add_colored_icon_text(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: &str,
        width: f32,
        color: Color32,
    ) {
        let text = egui::RichText::new(text).strong();
        self.add_colored_icon_complex_text(ui, icon, text.into(), width, color)
    }

    fn add_colored_icon_complex_text(
        &self,
        ui: &mut egui::Ui,
        icon: Texture,
        text: WidgetText,
        width: f32,
        color: Color32,
    ) {
        let image = egui::Image::new(SizedTexture::new(
            TextureId::User(icon.to_egui_id()),
            (24.0, 24.0),
        ))
        .tint(color);
        ui.add(image);
        let label = Label::new(text);
        ui.add_fixed_width(label, width);
    }
}
unsafe fn player_resources_info(
    bw: &BwVars,
    player: *mut bw::Player,
    player_id: u8,
    apm: Option<&ApmStats>,
) -> PlayerInfo {
    unsafe {
        let game = bw.game;
        let get_supplies = |race| {
            let used = game.supply_used(player_id, race);
            let available = game
                .supply_provided(player_id, race)
                .min(game.supply_max(player_id, race));
            // Supply is internally twice the shown value (as zergling / scourge
            // takes 0.5 supply per unit), used supply has to be rounded up
            // when displayed.
            (used.wrapping_add(1) / 2, available / 2)
        };
        let color = bw::player_color(
            game,
            bw.main_palette,
            bw.use_rgb_colors,
            bw.rgb_colors,
            player_id,
        );
        let supplies = [
            get_supplies(Race::Zerg),
            get_supplies(Race::Terran),
            get_supplies(Race::Protoss),
        ];
        let workers = [bw_dat::unit::SCV, bw_dat::unit::PROBE, bw_dat::unit::DRONE]
            .iter()
            .map(|&unit| game.completed_count(player_id, unit))
            .sum::<u32>();
        let mut name = bw::player_name(player);
        if name.is_empty() {
            name = format!("Player {}", player_id + 1).into();
        }
        let mut race = (*player).race;
        if race > 2 {
            race = 0;
        }
        let vision = has_player_vision(bw, player_id);
        PlayerInfo {
            name,
            color: Color32::from_rgb(color[0], color[1], color[2]),
            race,
            minerals: game.minerals(player_id),
            gas: game.gas(player_id),
            supplies,
            workers,
            apm: apm.map(|x| x.player_recent_apm(player_id)).unwrap_or(0),
            vision,
        }
    }
}
