use std::ptr;

use bw_dat::{TechId, Unit, UnitId, UpgradeId};
use egui::{Color32, TextureId};
use hashbrown::HashMap;
use overlay_ui::observer::{
    ProductionIcon, ProductionItemView, ProductionPlayerView, ProductionView,
};

use crate::bw;
use crate::bw_scr::game_stats::TimelineSubject;

use super::{BwVars, OverlayState, Texture, player_has_units, replay_players_by_team};

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

/// One run of the same thing in a player's production list: what is being made, how many of it are
/// on the way, and how far along the nearest one is.
///
/// The list itself is per-producing-unit, because a click on a tile selects one of those units and a
/// second click moves to the next. What the panel shows is one tile per run, so the grouping is done
/// here once and read both by the view the panel is drawn from and by the click that comes back.
struct ProductionGroup {
    production: Production,
    count: u32,
    progress: f32,
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
        entry.or_insert_with(|| match production {
            Production::Tech(..) | Production::Upgrade(..) => next_sort_order,
            Production::Unit(..) => 0x1_0000 | next_sort_order,
        });
        self.list.push((production, unit, progress));
    }

    /// The list as the panel shows it: one entry per run of the same thing.
    fn groups(&self) -> Vec<ProductionGroup> {
        let mut groups = Vec::new();
        let mut start = 0;
        while start < self.list.len() {
            let &(production, _, ref progress) = &self.list[start];
            let end = start
                + self.list[start..]
                    .iter()
                    .take_while(|entry| entry.0 == production)
                    .count();
            // A dual-birth unit is two units per egg, so an egg's tile counts two of them: the
            // panel is answering "how many are coming", not "how many eggs are there".
            let multiplier = match production {
                Production::Unit(unit) if unit.flags() & 0x400 != 0 => 2,
                _ => 1,
            };
            groups.push(ProductionGroup {
                production,
                count: (end - start).saturating_mul(multiplier) as u32,
                progress: progress.as_float(),
            });
            start = end;
        }
        groups
    }

    fn finish_frame(&mut self) {
        self.list
            .sort_by_cached_key(|&(ref prod, unit, ref progress)| {
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
            if let Some((production, progress)) = unit_production(unit)
                && let Some(player_prod) =
                    self.production.per_player.get_mut(unit.player() as usize)
            {
                player_prod.add_production(unit, production, progress);
            }
        }
        for player_prod in &mut self.production.per_player {
            player_prod.finish_frame();
        }
    }

    /// Builds the production panel's view: one row per player with something on the way, in the
    /// order the replay lists their players.
    ///
    /// Players with no units of their own are left out, as are a team game's players who are not the
    /// one commanding the team: in a team game every unit belongs to the commanding player, so the
    /// others would each carry a row of everything or a row of nothing.
    pub fn build_production_view(&self, bw: &BwVars) -> ProductionView {
        let is_team_game = crate::game_thread::is_team_game();
        let players = replay_players_by_team(bw)
            .filter(|&(_team, player_id)| player_has_units(bw, player_id))
            .filter(|&(_team, player_id)| {
                !is_team_game || unsafe { (**bw.game).team_game_main_player.contains(&player_id) }
            })
            .filter_map(|(_team, player_id)| {
                let production = self.production.per_player.get(player_id as usize)?;
                let color = unsafe {
                    bw::player_color(
                        bw.game,
                        bw.main_palette,
                        bw.use_rgb_colors,
                        bw.rgb_colors,
                        player_id,
                    )
                };
                Some(ProductionPlayerView {
                    player_id,
                    color: Color32::from_rgb(color[0], color[1], color[2]),
                    items: production
                        .groups()
                        .into_iter()
                        .map(|group| ProductionItemView {
                            icon: production_icon(group.production, bw.is_hd),
                            count: group.count,
                            progress: group.progress,
                        })
                        .collect(),
                })
            })
            .collect();
        ProductionView { players }
    }

    /// Selects whatever is making the `item`th entry of a player's row, walking to the next one of
    /// them when the same entry is asked for again.
    pub fn select_production(&mut self, player_id: u8, item: usize) {
        let Some(production) = self
            .production
            .per_player
            .get(player_id as usize)
            .and_then(|player| player.groups().into_iter().nth(item))
            .map(|group| group.production)
        else {
            return;
        };
        self.handle_click(player_id, production);
    }

    /// Moves the game's selection onto one of the units making `clicked`, cycling through them on
    /// repeated asks so a caster can walk a reinforcement wave back through the buildings making it.
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
        let next_idx = self
            .production
            .last_clicked
            .and_then(|last| {
                let clicked_idx = first
                    + player_production.list[first..]
                        .iter()
                        .take_while(|x| x.0 == clicked)
                        .position(|x| x.1 == last)?;
                // If clicked_idx + 1 is still of same production type, go to it,
                // otherwise go to index 0
                let next_idx = if player_production
                    .list
                    .get(clicked_idx + 1)
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
            // For zerg buildings, first queued unit is equal to the morph target,
            // with unit.id() only being equal for first tier of morphs
            // (So not lair / gspire etc).
            // Other races have None in queue, so for them use unit.id()
            if let Some(dest) = unit.first_queued_unit() {
                return Some((Production::Unit(dest), unit_completion(unit)));
            } else {
                return Some((Production::Unit(id), unit_completion(unit)));
            }
        }
        if let Some(tech) = unit.tech_in_progress() {
            return Some((
                Production::Tech(tech),
                research_completion(unit, tech.time()),
            ));
        }
        if let Some(upgrade) = unit.upgrade_in_progress() {
            let time = upgrade_time(unit, upgrade);
            return Some((
                Production::Upgrade(upgrade),
                research_completion(unit, time),
            ));
        }
        if let Some(child) = unit.first_queued_unit() {
            return Some((Production::Unit(child), currently_building_completion(unit)));
        }
    }
    if matches!(
        id,
        bw_dat::unit::EGG | bw_dat::unit::LURKER_EGG | bw_dat::unit::COCOON
    ) {
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
            upgrade
                .time_factor()
                .saturating_mul(level.saturating_sub(1)),
        )
    }
}

fn research_completion(unit: Unit, time: u32) -> Progress {
    let remaining = unsafe { (**unit).unit_specific.building.research_time_remaining as u32 };
    Progress {
        pos: time.saturating_sub(remaining),
        end: time,
    }
}

/// Which frame of the game's own command-icon atlas stands for a unit.
///
/// Every panel that names a unit names it with this same icon, so no two surfaces show the same
/// thing two different ways.
pub fn unit_icon(id: UnitId, is_hd: bool) -> ProductionIcon {
    production_icon(Production::Unit(id), is_hd)
}

/// Which frame of the game's own command-icon atlas stands for something the timeline is about.
///
/// The timeline names a unit, an upgrade or a technology by the same icon the production panel draws
/// for it, so the two surfaces never show the same thing two different ways.
pub fn timeline_icon(subject: TimelineSubject, is_hd: bool) -> ProductionIcon {
    let production = match subject {
        TimelineSubject::Unit(id) => Production::Unit(id),
        TimelineSubject::Upgrade(id) => Production::Upgrade(id),
        TimelineSubject::Tech(id) => Production::Tech(id),
    };
    production_icon(production, is_hd)
}

/// Which frame of the game's own command-icon atlas stands for a production, and the texture id the
/// renderer has that frame under.
fn production_icon(production: Production, is_hd: bool) -> ProductionIcon {
    let frame = match production {
        Production::Unit(id) => {
            // SD cmdicons have lair and hive icons swapped.
            if !is_hd && id == bw_dat::unit::LAIR {
                bw_dat::unit::HIVE.0
            } else if !is_hd && id == bw_dat::unit::HIVE {
                bw_dat::unit::LAIR.0
            } else {
                id.0
            }
        }
        Production::Upgrade(id) => id.icon() as u16,
        Production::Tech(id) => id.icon() as u16,
    };
    ProductionIcon {
        texture: Some(TextureId::User(Texture::CmdIcon(frame).to_egui_id())),
        index: frame,
    }
}
