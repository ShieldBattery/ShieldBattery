use std::ptr;

use bw_dat::{Game, TechId, Unit, UnitId, UpgradeId, WeaponId};
use egui::{Color32, TextureId, Vec2};
use hashbrown::HashMap;
use overlay_ui::observer::{
    ProductionIcon, ProductionItemView, ProductionPlayerView, ProductionProgressView,
    ProductionView, UnitUpgradeView, UpgradeEffect, WIREFRAME_LAYERS, WeaponDamageView, Wireframe,
};

use crate::bw;
use crate::bw_scr::draw_inject;
use crate::bw_scr::game_stats::TimelineSubject;

use super::wireframe::{self, FULL_HEALTH};
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

    /// Builds the production panel's view: one row per player, in the order the replay lists their
    /// players, with what they are making.
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
            .filter_map(|(team, player_id)| {
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
                    team,
                    color: Color32::from_rgb(color[0], color[1], color[2]),
                    items: production
                        .groups()
                        .into_iter()
                        .map(|group| ProductionItemView {
                            icon: production_icon(group.production, bw),
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

/// What one unit is making, as the selection panel reads it: the same production the panel of
/// everything on the way reads, plus fighters built in a carrier or reaver and the queue behind
/// production that has one.
///
/// `None` for a unit that is making nothing, which is most of them.
pub(super) fn selected_production(unit: Unit, bw: &BwVars) -> Option<ProductionProgressView> {
    let (production, progress) = unit_production(unit).or_else(|| fighter_production(unit))?;
    Some(ProductionProgressView {
        icon: production_icon(production, bw),
        name: production_name(production, bw),
        progress: progress.as_float(),
        queue: queued_units(unit, production)
            .map(|queue| queue.map(|unit_id| unit_icon(unit_id, bw)).collect()),
        // A building under construction is made as itself, and so is a drone turning into one: by
        // then the unit already is the building it is becoming.
        is_subject: production == Production::Unit(unit.id()),
    })
}

/// A carrier or reaver's fighter under construction. Fighters are kept out of the overview's
/// production list, but selecting their parent shows the construction and its queue.
fn fighter_production(unit: Unit) -> Option<(Production, Progress)> {
    if !unit.is_completed() || unit.is_hallucination() {
        return None;
    }
    let fighter = unit.id().fighter_id()?;
    if unit.first_queued_unit() != Some(fighter) {
        return None;
    }
    Some((
        Production::Unit(fighter),
        currently_building_completion(unit),
    ))
}

/// What a unit fights with, as the game's console lists it beside the unit: its armor upgrade, its
/// shields for a unit that has any, then each of its weapons, each at the level its owner has
/// taken the upgrade improving it to.
///
/// Which of those a unit has is the console's own rule, read off units.dat: armor
/// unless its armor upgrade is [`NO_ARMOR_UPGRADE`], shields for anything with shields, and each
/// weapon, the air one only where it is not the ground one again. A unit whose guns are on a turret
/// (a goliath, a siege tank) has its weapons on the turret's entry, so the turret's are read too.
/// Reavers and carriers show their scarab and interceptor inventories and those weapons' damage. A lurker has no weapon until
/// it burrows. A vulture with spider mines also shows how many it has left, including zero.
///
/// A hallucination has none: the console shows no upgrades for one to its owner or to anyone
/// watching, which is everyone this panel is drawn for.
pub(super) fn selected_upgrades(unit: Unit, bw: &BwVars) -> Vec<UnitUpgradeView> {
    // The upgrade tables are indexed by player slot and assert on anything past the twelfth.
    const PLAYER_SLOTS: u8 = 0xc;
    let player = unit.player();
    if player >= PLAYER_SLOTS || unit.is_hallucination() {
        return Vec::new();
    }
    let game = bw.game;
    let id = unit.id();
    let mut upgrades: Vec<(UpgradeId, UpgradeEffect)> = Vec::new();
    if let Some(armor) = id
        .armor_upgrade()
        .filter(|&armor| armor != NO_ARMOR_UPGRADE)
    {
        let base = id.armor();
        upgrades.push((
            armor,
            UpgradeEffect::Armor {
                base,
                bonus: unit.armor(game).saturating_sub(base),
            },
        ));
    }
    if id.has_shields() {
        upgrades.push((bw_dat::upgrade::PLASMA_SHIELDS, UpgradeEffect::Shields));
    }
    let armed = id != bw_dat::unit::LURKER || unit.is_burrowed();
    let mut weapons: Vec<WeaponId> = Vec::new();
    for weapon in [Some(id), id.subunit()]
        .into_iter()
        .flatten()
        .filter(|_| armed)
        .flat_map(|id| [id.ground_weapon(), id.air_weapon()])
        .flatten()
    {
        if !weapons.contains(&weapon) {
            weapons.push(weapon);
        }
    }
    let mut chips: Vec<UnitUpgradeView> = upgrades
        .into_iter()
        .map(|(upgrade, effect)| UnitUpgradeView {
            icon: production_icon(Production::Upgrade(upgrade), bw),
            level: match &effect {
                // Armor includes unit-specific bonuses such as Chitinous Plating.
                UpgradeEffect::Armor { bonus, .. } => u8::try_from(*bonus).unwrap_or(u8::MAX),
                _ => game.upgrade_level(player, upgrade),
            },
            name: production_name(Production::Upgrade(upgrade), bw),
            effect,
        })
        .collect();
    // A weapon is shown by its own icon whether or not anything upgrades it, as the game's own
    // status panel does: a worker's attack takes no upgrades but is still what the unit fights
    // with, and reads level 0.
    for weapon in weapons {
        let level = weapon
            .upgrade()
            .map_or(0, |upgrade| game.upgrade_level(player, upgrade));
        // The overlay is built in the game's draw, on its main thread.
        let name = bw
            .stat_txt
            .and_then(|stat_txt| unsafe { stat_txt.weapon_name(weapon) });
        chips.push(UnitUpgradeView {
            icon: atlas_icon(weapon.get(WEAPON_ICON_FIELD) as u16, 0.0, bw),
            level,
            name: name.clone(),
            effect: UpgradeEffect::Damage(vec![WeaponDamageView {
                name,
                base: weapon.damage(),
                bonus: weapon.bonus().saturating_mul(u32::from(level)),
                hits: weapon_hits(id, weapon.factor()),
            }]),
        });
    }
    if let Some((fighter, count)) = selected_fighters(unit)
        && let Some(weapon) = fighter.ground_weapon()
    {
        let level = weapon
            .upgrade()
            .map_or(0, |upgrade| game.upgrade_level(player, upgrade));
        chips.push(UnitUpgradeView {
            icon: atlas_icon(fighter.0, 0.0, bw),
            level: count,
            name: bw
                .stat_txt
                .and_then(|stat_txt| unsafe { stat_txt.inventory_name(fighter) }),
            effect: UpgradeEffect::Count {
                damage: weapon.damage(),
                bonus: weapon.bonus().saturating_mul(u32::from(level)),
            },
        });
    }
    if let Some(count) = selected_mines(unit, game) {
        let mine = bw_dat::unit::SPIDER_MINE;
        chips.push(UnitUpgradeView {
            icon: atlas_icon(mine.0, 0.0, bw),
            level: count,
            name: bw
                .stat_txt
                .and_then(|stat_txt| unsafe { stat_txt.inventory_name(mine) }),
            effect: UpgradeEffect::Count {
                damage: mine.ground_weapon().map_or(0, |weapon| weapon.damage()),
                bonus: 0,
            },
        });
    }
    chips
}

/// Carriers count interceptors both in the hangar and deployed; reavers count loaded scarabs.
/// Both counters remain visible at zero, and hero variants follow the same rules.
fn selected_fighters(unit: Unit) -> Option<(UnitId, u8)> {
    if unit.player() >= 0xc || unit.is_hallucination() {
        return None;
    }
    unit.id().fighter_id().map(|fighter| {
        (
            fighter,
            u8::try_from(unit.fighter_amount()).unwrap_or(u8::MAX),
        )
    })
}

/// The console keeps a vulture's mine counter visible after its last mine is spent, but hides it
/// until spider mines are researched. Raynor's vulture has the technology without research.
fn selected_mines(unit: Unit, game: Game) -> Option<u8> {
    use bw_dat::unit::{JIM_RAYNOR_VULTURE, VULTURE};

    if unit.player() >= 0xc || unit.is_hallucination() {
        return None;
    }
    let available = match unit.id() {
        JIM_RAYNOR_VULTURE => true,
        VULTURE => game.tech_researched(unit.player(), bw_dat::tech::SPIDER_MINES),
        _ => false,
    };
    // Only vultures use this member of the unit-specific union.
    available.then(|| unsafe { (**unit).unit_specific.vulture.mines })
}

/// Hits per attack: weapons.dat's factor except for units with a burst encoded in their animation.
/// Firebats and zealots, including their heroes, hit twice; Valkyries fire eight rockets per volley.
fn weapon_hits(unit: UnitId, factor: u32) -> u32 {
    use bw_dat::unit::{FENIX_ZEALOT, FIREBAT, GUI_MONTAG, VALKYRIE, ZEALOT};
    match unit {
        FIREBAT | GUI_MONTAG | ZEALOT | FENIX_ZEALOT => 2,
        VALKYRIE => 8,
        _ => factor,
    }
}

/// The upgrade units.dat names as the armor upgrade of everything with no armor to upgrade: every
/// building, a spider mine, a nuke, a scanner sweep. The console draws no armor icon for it, and
/// it is not the slot past the table's end that the dat crate reads as no upgrade at all.
const NO_ARMOR_UPGRADE: UpgradeId = UpgradeId(0x3c);

/// The weapons.dat field holding the frame of the command-icon atlas a weapon is shown by.
const WEAPON_ICON_FIELD: u32 = 23;

/// The units waiting behind the one this unit is making, in the order they will be made, or
/// `None` for production that has no queue.
///
/// Completed buildings training units and carriers or reavers building fighters have queues. An
/// upgrade or a technology is one item a building works through alone, and a building that is itself
/// still being built (or an egg) holds what it is turning into in the same queue rather than a line
/// of work behind it.
///
/// The queue is a ring of [`BUILD_QUEUE_LEN`] slots starting at the one being worked on and filled
/// forward from it, so the walk goes forward and stops at the first empty slot rather than taking
/// every non-empty slot in the ring.
fn queued_units(unit: Unit, production: Production) -> Option<impl Iterator<Item = UnitId>> {
    let is_training = matches!(production, Production::Unit(..))
        && (unit.id().is_building() || unit.id().fighter_id().is_some())
        && unit.is_completed();
    is_training.then(|| (1..BUILD_QUEUE_LEN).map_while(move |slot| unit.nth_queued_unit(slot)))
}

/// How many entries the game's build queue holds.
const BUILD_QUEUE_LEN: u8 = 5;

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

/// Which of the game's own icons stands for a kind of unit: a frame of the command-icon atlas, or
/// for the units the atlas has no icon of, their wireframe as a unit at full health draws it.
///
/// Every panel that names a unit names it with this same icon, so no two surfaces show the same
/// thing two different ways.
pub fn unit_icon(id: UnitId, bw: &BwVars) -> ProductionIcon {
    production_icon(Production::Unit(id), bw)
}

/// The icon of one unit in particular, at `hit_points` of `max_hit_points`: its kind's
/// [`unit_icon`], except that a unit drawn as its wireframe has its layers colored for how hurt it
/// is, as the game's status panel colors them.
pub fn unit_icon_at_health(
    id: UnitId,
    hit_points: u32,
    max_hit_points: u32,
    bw: &BwVars,
) -> ProductionIcon {
    let level = wireframe::health_level(hit_points, max_hit_points);
    wireframe_icon(id, level, bw).unwrap_or_else(|| unit_icon(id, bw))
}

/// Which frame of the game's own command-icon atlas stands for something the timeline is about: the
/// same icon the production panel draws for it.
pub fn timeline_icon(subject: TimelineSubject, bw: &BwVars) -> ProductionIcon {
    let production = match subject {
        TimelineSubject::Unit(id) => Production::Unit(id),
        TimelineSubject::Upgrade(id) => Production::Upgrade(id),
        TimelineSubject::Tech(id) => Production::Tech(id),
    };
    production_icon(production, bw)
}

/// What the game calls something the timeline is about, in the game's language.
pub fn timeline_name(subject: TimelineSubject, bw: &BwVars) -> Option<String> {
    let production = match subject {
        TimelineSubject::Unit(id) => Production::Unit(id),
        TimelineSubject::Upgrade(id) => Production::Upgrade(id),
        TimelineSubject::Tech(id) => Production::Tech(id),
    };
    production_name(production, bw)
}

/// What the game calls what is being made, in the game's language.
fn production_name(production: Production, bw: &BwVars) -> Option<String> {
    let stat_txt = bw.stat_txt?;
    // The overlay is built in the game's draw, on its main thread.
    unsafe {
        match production {
            Production::Unit(id) => stat_txt.unit_name(id),
            Production::Upgrade(id) => stat_txt.upgrade_name(id),
            Production::Tech(id) => stat_txt.tech_name(id),
        }
    }
}

/// How much of each side of an HD unit's command-icon frame is empty padding around its render.
///
/// The renders are centered in their frames with about a tenth of a frame free on every side. The
/// few that reach a little closer to an edge lose only the soft fringe of their outermost pixels to
/// the crop. Upgrade and technology icons fill their frames, and the SD and carbot atlases are drawn
/// edge to edge.
const HD_UNIT_ICON_MARGIN: f32 = 0.09;

/// The units whose frame in the command-icon atlas is a placeholder reading "BLANK", the same in
/// every graphics mode: turrets, heroes, and units no button ever makes. A panel names these by
/// their unit code instead.
const BLANK_UNIT_ICONS: [u16; 47] = [
    4, 6, 18, 24, 26, 27, 31, 87, 97, 98, 102, 105, 119, 153, 158, 161, 179, 180, 181, 182, 183,
    184, 185, 186, 187, 191, 192, 193, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 213, 220,
    221, 222, 223, 224, 225, 226, 227,
];

/// Which frame of the game's own command-icon atlas (or for the units it has no icon of, of their
/// wireframes) stands for a production, and the texture id the renderer has that frame under, along
/// with the frame's pixel size so a panel can draw it at its own proportions.
fn production_icon(production: Production, bw: &BwVars) -> ProductionIcon {
    // A kind of unit rather than one unit, so drawn as a unit at full health would be.
    if let Production::Unit(id) = production
        && let Some(icon) = wireframe_icon(id, FULL_HEALTH, bw)
    {
        return icon;
    }
    let is_hd = bw.is_hd;
    let frame = match production {
        // The atlas has no egg: a larva's egg's frame is a radiation symbol and a lurker egg's
        // reads BLANK. Where the wireframes cannot be drawn either, the cocoon is the one pod the
        // atlas draws, and what an egg hatches into is named beside it wherever it is shown.
        Production::Unit(bw_dat::unit::EGG | bw_dat::unit::LURKER_EGG) => bw_dat::unit::COCOON.0,
        Production::Unit(id) if BLANK_UNIT_ICONS.contains(&id.0) => {
            return ProductionIcon {
                texture: None,
                index: id.0,
                size: None,
                margin: 0.0,
                wireframe: None,
            };
        }
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
    let margin = match production {
        Production::Unit(_) if is_hd && !bw.is_carbot => HD_UNIT_ICON_MARGIN,
        _ => 0.0,
    };
    atlas_icon(frame, margin, bw)
}

/// One frame of the game's own command-icon atlas, under the texture id the renderer has it as,
/// with the frame's pixel size and the share of each side of it that is empty padding.
fn atlas_icon(frame: u16, margin: f32, bw: &BwVars) -> ProductionIcon {
    // SAFETY: `cmdicons` is the game's own atlas, which outlives the frames drawn from it.
    let size = unsafe {
        (!bw.cmdicons.is_null())
            .then(|| draw_inject::ddsgrp_texture(bw.cmdicons, bw.is_hd, bw.is_carbot, frame))
            .flatten()
            .filter(|texture| (**texture).width != 0 && (**texture).height != 0)
            .map(|texture| Vec2::new((*texture).width as f32, (*texture).height as f32))
    };
    ProductionIcon {
        texture: Some(TextureId::User(Texture::CmdIcon(frame).to_egui_id())),
        index: frame,
        size,
        margin,
        wireframe: None,
    }
}

/// A unit drawn as its wireframe, its hit-point layers colored for the `level` of health
/// [`wireframe::health_level`] reckons, or `None` for a kind of unit drawn by its command icon, and
/// where the game's wireframes or the remap that colors them could not be read.
///
/// A frame too narrow to hold a square cell for every hit-point layer is `None` too, rather than a
/// slice of art drawn as if it were a wireframe.
fn wireframe_icon(id: UnitId, level: usize, bw: &BwVars) -> Option<ProductionIcon> {
    if !wireframe::draws_as_wireframe(id) || bw.wirefram.is_null() {
        return None;
    }
    let remap = bw.wireframe_remap?;
    // SAFETY: `wirefram` is the game's own set, which outlives the frames drawn from it.
    let (width, height) = unsafe {
        let texture = draw_inject::ddsgrp_texture(bw.wirefram, bw.is_hd, bw.is_carbot, id.0)?;
        ((*texture).width, (*texture).height)
    };
    if height == 0 || u32::from(width) < u32::from(height) * WIREFRAME_LAYERS as u32 {
        return None;
    }
    // SAFETY: The main palette is the game's own 256 entries of four bytes, alive for as long as
    // the game runs, and a remap entry is a byte.
    let colors = remap.pod_layer_colors(level).map(|index| unsafe {
        let color = bw.main_palette.add(4 * usize::from(index));
        Color32::from_rgb(*color, *color.add(1), *color.add(2))
    });
    Some(ProductionIcon {
        texture: Some(TextureId::User(Texture::Wireframe(id.0).to_egui_id())),
        index: id.0,
        size: Some(Vec2::splat(f32::from(height))),
        margin: 0.0,
        wireframe: Some(Wireframe {
            layers: colors,
            cell_width: f32::from(height) / f32::from(width),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bw_dat::{tech, unit};

    #[test]
    fn fighter_construction_requires_a_real_completed_parent_with_a_matching_queue() {
        let mut raw: bw::Unit = unsafe { std::mem::zeroed() };
        raw.flags = 1;
        raw.build_queue = [unit::NONE.0; 5];
        let parent = unsafe { Unit::from_ptr(&raw mut raw).unwrap() };
        for id in [
            unit::CARRIER,
            unit::GANTRITHOR,
            unit::REAVER,
            unit::WARBRINGER,
        ] {
            let fighter = id.fighter_id().unwrap();
            unsafe {
                (**parent).unit_id = id.0;
                (**parent).build_queue[0] = unit::NONE.0;
            }
            assert!(fighter_production(parent).is_none());
            unsafe { (**parent).build_queue[0] = fighter.0 };
            assert_eq!(
                fighter_production(parent).unwrap().0,
                Production::Unit(fighter)
            );
            unsafe { (**parent).flags = 0x4000_0001 };
            assert!(fighter_production(parent).is_none());
            unsafe { (**parent).flags = 0 };
            assert!(fighter_production(parent).is_none());
            unsafe {
                (**parent).flags = 1;
                (**parent).build_queue[0] = unit::MARINE.0;
            }
            assert!(fighter_production(parent).is_none());
        }
        unsafe {
            (**parent).unit_id = unit::MARINE.0;
            (**parent).build_queue[0] = unit::INTERCEPTOR.0;
        }
        assert!(fighter_production(parent).is_none());
    }

    #[test]
    fn fighter_queue_wraps_after_the_active_slot_and_stops_at_the_first_empty_slot() {
        let mut raw: bw::Unit = unsafe { std::mem::zeroed() };
        raw.flags = 1;
        raw.current_build_slot = 3;
        let parent = unsafe { Unit::from_ptr(&raw mut raw).unwrap() };
        for id in [
            unit::CARRIER,
            unit::GANTRITHOR,
            unit::REAVER,
            unit::WARBRINGER,
        ] {
            let fighter = id.fighter_id().unwrap();
            unsafe {
                (**parent).unit_id = id.0;
                (**parent).build_queue = [fighter.0, unit::NONE.0, fighter.0, fighter.0, fighter.0];
            }
            let production = fighter_production(parent).unwrap().0;
            let queue = queued_units(parent, production)
                .unwrap()
                .collect::<Vec<_>>();
            assert_eq!(queue, [fighter, fighter]);
            unsafe { (**parent).build_queue[4] = unit::NONE.0 };
            assert_eq!(queued_units(parent, production).unwrap().count(), 0);
            unsafe { (**parent).build_queue = [unit::NONE.0; 5] };
            assert!(fighter_production(parent).is_none());
        }
    }

    #[test]
    fn weapon_hit_counts_include_unit_specific_bursts() {
        for id in [
            unit::FIREBAT,
            unit::GUI_MONTAG,
            unit::ZEALOT,
            unit::FENIX_ZEALOT,
        ] {
            assert_eq!(weapon_hits(id, 1), 2);
        }
        assert_eq!(weapon_hits(unit::VALKYRIE, 1), 8);
        assert_eq!(weapon_hits(unit::GOLIATH, 2), 2);
        assert_eq!(weapon_hits(unit::SCOUT, 2), 2);
        assert_eq!(weapon_hits(unit::MARINE, 1), 1);
    }

    #[test]
    fn fighter_inventory_counts_loaded_and_deployed_interceptors_but_only_loaded_scarabs() {
        let mut raw: bw::Unit = unsafe { std::mem::zeroed() };
        raw.player = 1;
        let unit = unsafe { Unit::from_ptr(&raw mut raw).unwrap() };
        for id in [
            unit::CARRIER,
            unit::GANTRITHOR,
            unit::REAVER,
            unit::WARBRINGER,
        ] {
            unsafe {
                (**unit).unit_id = id.0;
                (**unit).unit_specific.carrier.in_hangar_count = 0;
                (**unit).unit_specific.carrier.out_hangar_count = 0;
            }
            let fighter = id.fighter_id().unwrap();
            assert_eq!(selected_fighters(unit), Some((fighter, 0)));
            unsafe {
                (**unit).unit_specific.carrier.in_hangar_count = 3;
                (**unit).unit_specific.carrier.out_hangar_count = 2;
            }
            let expected = if fighter == unit::INTERCEPTOR { 5 } else { 3 };
            assert_eq!(selected_fighters(unit), Some((fighter, expected)));
        }
        unsafe { (**unit).flags = 0x4000_0000 };
        assert_eq!(selected_fighters(unit), None);
        unsafe {
            (**unit).flags = 0;
            (**unit).player = 0x80;
        }
        assert_eq!(selected_fighters(unit), None);
        unsafe {
            (**unit).player = 1;
            (**unit).unit_id = unit::MARINE.0;
        }
        assert_eq!(selected_fighters(unit), None);
    }

    #[test]
    fn mine_inventory_requires_research_and_keeps_showing_when_empty() {
        let mut game: Box<bw::Game> = unsafe { Box::new(std::mem::zeroed()) };
        let game = unsafe { Game::from_ptr(&raw mut *game) };
        let mut raw: bw::Unit = unsafe { std::mem::zeroed() };
        raw.unit_id = unit::VULTURE.0;
        raw.player = 2;
        raw.unit_specific.vulture.mines = 3;
        let vulture = unsafe { Unit::from_ptr(&raw mut raw).unwrap() };
        assert_eq!(selected_mines(vulture, game), None);

        // Another player's research must not unlock this vulture's counter.
        game.set_tech_level(1, tech::SPIDER_MINES, 1);
        assert_eq!(selected_mines(vulture, game), None);
        game.set_tech_level(2, tech::SPIDER_MINES, 1);
        for count in (0..=3).rev() {
            unsafe { (**vulture).unit_specific.vulture.mines = count };
            assert_eq!(selected_mines(vulture, game), Some(count));
        }
        game.set_tech_level(2, tech::SPIDER_MINES, 0);
        assert_eq!(selected_mines(vulture, game), None);

        unsafe {
            (**vulture).unit_id = unit::JIM_RAYNOR_VULTURE.0;
            (**vulture).unit_specific.vulture.mines = 3;
        }
        assert_eq!(selected_mines(vulture, game), Some(3));
        unsafe { (**vulture).flags = 0x4000_0000 };
        assert_eq!(selected_mines(vulture, game), None);
        unsafe {
            (**vulture).flags = 0;
            (**vulture).unit_id = unit::MARINE.0;
        }
        assert_eq!(selected_mines(vulture, game), None);
        unsafe {
            (**vulture).unit_id = unit::VULTURE.0;
            (**vulture).player = 0x80;
        }
        assert_eq!(selected_mines(vulture, game), None);
    }
}
