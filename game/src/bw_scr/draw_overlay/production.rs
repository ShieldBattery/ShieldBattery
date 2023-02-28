use std::ptr;

use bw_dat::{UpgradeId, UnitId, Unit, TechId};
use egui::{Align, Align2, Color32, Layout, Rect, Sense, TextureId, Vec2};
use hashbrown::HashMap;

use crate::bw;

use super::{BwVars, OverlayState, ReplayUiValues, Texture, replay_players_by_team};

pub struct ProductionState {
    per_player: [PlayerProduction; 8],
    last_clicked: Option<Unit>,
}

struct PlayerProduction {
    /// Sorted so that upgrades / techs are first (Assuming they're more important),
    /// and otherwise the ordering is kept between frames, so that new production
    /// is placed at the end.
    list: Vec<(Production, Unit, Progress)>,
    /// For keeping list sorted in the next frame.
    sort_order: HashMap<Production, u32>,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash)]
enum Production {
    Unit(UnitId),
    Upgrade(UpgradeId),
    Tech(TechId),
}

impl Production {
    fn icon(&self) -> Texture {
        match *self {
            Production::Unit(id) => Texture::CmdIcon(id.0),
            Production::Upgrade(id) => Texture::CmdIcon(id.icon() as u16),
            Production::Tech(id) => Texture::CmdIcon(id.icon() as u16),
        }
    }
}

/// Completion of a production; units are game ticks/frames.
struct Progress {
    pos: u32,
    end: u32,
}

impl Progress {
    fn remaining(&self) -> u32 {
        self.end.saturating_sub(self.pos)
    }

    fn as_float(&self) -> f32 {
        if self.end == 0 || self.pos > self.end {
            1.0
        } else {
            self.pos as f32 / self.end as f32
        }
    }
}

impl ProductionState {
    pub fn new() -> ProductionState {
        ProductionState {
            per_player: std::array::from_fn(|_| PlayerProduction::new()),
            last_clicked: None,
        }
    }
}

impl PlayerProduction {
    pub fn new() -> PlayerProduction {
        PlayerProduction {
            list: Vec::new(),
            sort_order: HashMap::new(),
        }
    }

    fn new_frame(&mut self) {
        self.sort_order.clear();
        let mut prev = None;
        for &(production, _, _) in self.list.iter() {
            if Some(production) == prev {
                continue;
            }
            prev = Some(production);
            let next = self.sort_order.len() as u32;
            let sort_order = match production {
                Production::Tech(..) | Production::Upgrade(..) => next,
                Production::Unit(..) => 0x1_0000 | next,
            };
            self.sort_order.insert(production, sort_order);
        }
        self.list.clear();
    }

    fn add_production(&mut self, unit: Unit, production: Production, progress: Progress) {
        let next_sort_order = self.sort_order.len() as u32;
        let entry = self.sort_order.entry(production);
        entry.or_insert_with(|| {
            match production {
                Production::Tech(..) | Production::Upgrade(..) => next_sort_order,
                Production::Unit(..) => 0x1_0000 | next_sort_order,
            }
        });
        self.list.push((production, unit, progress));
    }

    fn finish_frame(&mut self) {
        self.list.sort_by_cached_key(|&(ref prod, unit, ref progress)| {
            let sort_order = match self.sort_order.get(prod) {
                Some(&s) => s,
                // ???
                None => u32::MAX,
            };
            // Have unit ptr value as tiebreaker if two units have same
            // time left, so that cycling through them won't break.
            (sort_order, progress.remaining(), *unit as usize)
        });
    }
}

impl OverlayState {
    pub fn update_replay_production(&mut self, bw: &BwVars) {
        for player_prod in &mut self.production.per_player {
            player_prod.new_frame();
        }
        for unit in bw.active_units {
            if let Some((production, progress)) = unit_production(unit) {
                if let Some(player_prod) =
                    self.production.per_player.get_mut(unit.player() as usize)
                {
                    player_prod.add_production(unit, production, progress);
                }
            }
        }
        for player_prod in &mut self.production.per_player {
            player_prod.finish_frame();
        }
    }

    pub fn add_production_ui(&mut self, bw: &BwVars, ctx: &egui::Context) {
        egui::Window::new("Replay_Production")
            .anchor(Align2::LEFT_TOP, self.replay_ui_values.production_pos)
            .movable(false)
            .resizable(false)
            .title_bar(false)
            .frame(egui::Frame::none())
            .show(ctx, |ui| {
                // Want this so that the lines are tightly packed without
                // transparent gaps in between.
                ui.style_mut().spacing.item_spacing.y = 0.0;
                let is_team_game = crate::game_thread::is_team_game();
                for (_team, player_id) in replay_players_by_team(bw) {
                    if is_team_game {
                        if unsafe { !(**bw.game).team_game_main_player.contains(&player_id) } {
                            continue;
                        }
                    }
                    egui::Frame::popup(ui.style())
                        .inner_margin(egui::Margin::same(2.0))
                        //.shadow(egui::epaint::Shadow::NONE)
                        .show(ui, |ui| {
                            let clicked = self.add_player_production(bw, ui, player_id);
                            if let Some(clicked) = clicked {
                                self.handle_click(player_id, clicked);
                            }
                        });
                }
            });
    }

    fn handle_click(&mut self, player_id: u8, clicked: Production) {
        let player_production = match self.production.per_player.get(player_id as usize) {
            Some(s) => s,
            None => return,
        };
        let first = match player_production.list.iter().position(|x| x.0 == clicked) {
            Some(s) => s,
            None => return,
        };
        // If last clicked unit is part of this production set, cycle
        let next_idx = self.production.last_clicked
            .and_then(|last| {
                let clicked_idx = first + player_production.list[first..].iter()
                    .take_while(|x| x.0 == clicked)
                    .position(|x| x.1 == last)?;
                // If clicked_idx + 1 is still of same production type, go to it,
                // otherwise go to index 0
                let next_idx = if player_production.list.get(clicked_idx + 1)
                    .filter(|x| x.0 == clicked)
                    .is_some()
                {
                    clicked_idx + 1
                } else {
                    first
                };
                Some(next_idx)
            })
            .unwrap_or(first);
        let unit = match player_production.list.get(next_idx) {
            Some(s) => s.1,
            None => return,
        };
        self.production.last_clicked = Some(unit);
        self.out_state.select_unit = Some(unit);
    }

    /// Return production which was clicked on, if a click had happened
    fn add_player_production(
        &mut self,
        bw: &BwVars,
        ui: &mut egui::Ui,
        player_id: u8,
    ) -> Option<Production> {
        let player_production = match self.production.per_player.get(player_id as usize) {
            Some(s) => s,
            None => return None,
        };
        let size = Vec2 { x: 300.0, y: 24.0 };
        let mut clicked = None;
        let res = ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Min), |ui| {
            let ReplayUiValues {
                production_image_size,
                production_max,
                ..
            } = self.replay_ui_values;
            let margin = 2.0;

            // Player colored rect
            let color = unsafe {
                bw::player_color(
                    bw.game,
                    bw.main_palette,
                    bw.use_rgb_colors,
                    bw.rgb_colors,
                    player_id,
                )
            };
            {
                let color = Color32::from_rgb(color[0], color[1], color[2]);
                let rect_size = (6.0, production_image_size + margin * 2.0);
                let color_rect = Rect::from_min_size(ui.next_widget_position(), rect_size.into());
                let painter = ui.painter();
                let rounding = egui::Rounding::same(2.0);
                painter.rect_filled(color_rect, rounding, color);
                ui.allocate_rect(color_rect, Sense::hover());
            }

            let mut icons_added = 0;
            let mut i = 0;
            let font = egui::FontId {
                size: 20.0,
                family: egui::FontFamily::Proportional,
            };
            while i < player_production.list.len() && icons_added < production_max {
                let start = i;
                let &(production, _unit, ref progress) = &player_production.list[start];
                let mut end = i + 1;
                while end < player_production.list.len() {
                    if player_production.list[end].0 != production {
                        break;
                    }
                    end += 1;
                }
                let amount = end - start;
                i = end;

                let multiplier = match production {
                    Production::Unit(unit) => match unit.flags() & 0x400 != 0 {
                        // Dual birth units
                        true => 2,
                        false => 1,
                    },
                    _ => 1,
                };
                let amount = amount.saturating_mul(multiplier);

                let icon = production.icon();
                let size = (production_image_size, production_image_size);
                let rect = Rect::from_min_size(ui.next_widget_position(), size.into())
                    .translate((0.0, margin).into());
                let response = ui.allocate_rect(rect, Sense::click());
                if response.clicked() {
                    clicked = Some(production);
                }

                // Icon
                let painter = ui.painter();
                let uv = Rect::from_min_max((0.0, 0.0).into(), (1.0, 1.0).into());
                //let rounding = egui::Rounding::same(2.0);
                //painter.rect_filled(rect, rounding, Color32::BLACK);
                let icon_color = match response.hovered() {
                    true => Color32::YELLOW,
                    false => Color32::WHITE,
                };
                painter.image(TextureId::User(icon.to_egui_id()), rect, uv, icon_color);

                // Amount text
                // Show only number for units since for research it is always 1 anyway
                if matches!(production, Production::Unit(..)) {
                    let galley = painter.layout_no_wrap(
                        format!("{}", amount),
                        font.clone(),
                        Color32::WHITE,
                    );
                    let rounding = egui::Rounding::same(1.0);
                    let text_pos = rect.left_bottom() - Vec2::from((0.0, galley.rect.height()));
                    let text_rect = Rect::from_min_size(text_pos, galley.rect.size());
                    let bg_color = ui.visuals().window_fill();
                    painter.rect_filled(text_rect, rounding, bg_color);
                    painter.galley(text_pos, galley);
                }
                // Progress bar
                let mut progress_rect = Rect::from_min_size(
                    rect.left_bottom() - Vec2::from((0.0, 2.0)),
                    (rect.width(), 4.0).into(),
                );
                let rounding = egui::Rounding::same(1.0);
                painter.rect_filled(progress_rect, rounding, Color32::BLACK);
                progress_rect.set_width(progress_rect.width() * progress.as_float());
                painter.rect_filled(progress_rect, rounding, Color32::GREEN);
                icons_added += 1;
            }
        });
        self.add_ui_rect(&Some(res));
        clicked
    }
}

/// Returns Some((Production, progress)) if the unit is actively producing something.
///
/// Note that for buildings the building itself returns `Production::Unit(unit.id())`,
/// an SCV actively building returns `None` to not double count terran buildings.
///
/// Assumed to not called on hidden (non-active) units, i.e. units being trained are not completed
/// and hidden.
///
/// Intention is that when `unit` is:
/// - Building being built (including addons), returns self id
/// - Building upgrading/teching, returns upgrade/tech
/// - Building training unit, returns unit id
/// - Egg / cocoon, returns target id
fn unit_production(unit: Unit) -> Option<(Production, Progress)> {
    let id = unit.id();
    if unit.id().is_building() {
        if !unit.is_completed() {
            // Note that even for morphing buildings, unit.id() will be the target
            // building ID - unlike eggs where the target ID is from build queue
            return Some((Production::Unit(id), unit_completion(unit)));
        }
        if let Some(tech) = unit.tech_in_progress() {
            return Some((Production::Tech(tech), research_completion(unit, tech.time())));
        }
        if let Some(upgrade) = unit.upgrade_in_progress() {
            let time = upgrade_time(unit, upgrade);
            return Some((Production::Upgrade(upgrade), research_completion(unit, time)));
        }
        if let Some(child) = unit.first_queued_unit() {
            return Some((Production::Unit(child), currently_building_completion(unit)));
        }
    }
    if matches!(id, bw_dat::unit::EGG | bw_dat::unit::LURKER_EGG | bw_dat::unit::COCOON) {
        let child_id = unit.first_queued_unit().unwrap_or(id);
        return Some((Production::Unit(child_id), unit_completion(unit)));
    }
    None
}

fn unit_completion(unit: Unit) -> Progress {
    // Effectively morph dest id or self id
    let id = unit.first_queued_unit().unwrap_or_else(|| unit.id());
    let remaining = unsafe { (**unit).remaining_build_time as u32 };
    let time = id.build_time();
    Progress {
        pos: time.saturating_sub(remaining),
        end: time,
    }
}

fn currently_building_completion(unit: Unit) -> Progress {
    if let Some(child) = unit.currently_building() {
        unit_completion(child)
    } else {
        // Queued but not started due to supply.
        // Could also return None here if we didn't want that
        // to show in production?
        let id = unit.first_queued_unit().unwrap_or_else(|| unit.id());
        Progress {
            pos: 0,
            end: id.build_time(),
        }
    }
}

fn upgrade_time(unit: Unit, upgrade: UpgradeId) -> u32 {
    unsafe {
        let building = ptr::addr_of_mut!((**unit).unit_specific.building);
        let level = (*building).next_upgrade_level as u32;
        upgrade.time().saturating_add(
            upgrade.time_factor().saturating_mul(level.saturating_sub(1))
        )
    }
}

fn research_completion(unit: Unit, time: u32) -> Progress {
    let remaining = unsafe {
        (**unit).unit_specific.building.research_time_remaining as u32
    };
    Progress {
        pos: time.saturating_sub(remaining),
        end: time,
    }
}
