//! Game-thread adapter for the development BWAPI external-client bridge.

use std::cell::RefCell;
use std::collections::HashMap;
use std::mem;

use bw_dat::{Race, TechId, UnitArray, UnitId, UpgradeId};
use scr_analysis::{Analysis, scarf};

use super::{BwScr, Value};
use crate::bw::Bw;
use crate::bwapi::{commands, transport::Server, wire};

pub(super) struct Terrain {
    flags: Value<*mut u32>,
    tiles: Value<*mut u16>,
    cv5: Value<*mut u8>,
    vf4: Value<*mut u16>,
}

impl Terrain {
    pub(super) fn analyze(
        analysis: &mut Analysis<'_>,
        ctx: scarf::OperandCtx<'static>,
    ) -> Option<Self> {
        Some(Self {
            flags: Value::new(ctx, analysis.map_tile_flags()?),
            tiles: Value::new(ctx, analysis.tileset_indexed_map_tiles()?),
            cv5: Value::new(ctx, analysis.tileset_cv5()?),
            vf4: Value::new(ctx, analysis.minitile_data()?),
        })
    }
}

thread_local! {
    static BRIDGE: RefCell<Option<Bridge>> = const { RefCell::new(None) };
    static ATTEMPTED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct Bridge {
    server: Server,
    state: Snapshot,
}

#[derive(Default)]
struct Snapshot {
    started: bool,
    exhausted: bool,
    end_published: bool,
    end_acknowledged: bool,
    known_races: [Option<u8>; 12],
    seen_players: [bool; 12],
    ids: HashMap<u32, usize>,
    units: Vec<TrackedUnit>,
    accepted_commands: u64,
    rejected_commands: u64,
}

struct TrackedUnit {
    native_id: u32,
    accessible: bool,
    kind: u16,
    owner: u8,
    completed: bool,
    visible: bool,
    announced: bool,
}

impl BwScr {
    pub(super) unsafe fn bwapi_step(&self) {
        let instance = crate::bwapi_instance();
        let legacy_enabled = std::env::var_os("SB_BWAPI").is_some() && !crate::is_local_game();
        if (instance.is_none() && !legacy_enabled) || crate::game_thread::is_replay() {
            return;
        }
        let local = unsafe { self.local_player_id.resolve() };
        if local >= 8 {
            return;
        }
        BRIDGE.with_borrow_mut(|bridge| {
            if !ATTEMPTED.replace(true) {
                if !crate::game_thread::setup_info()
                    .is_some_and(|s| s.use_legacy_limits == Some(true))
                {
                    error!("BWAPI: bridge requires a lobby with legacy unit limits");
                    return;
                }
                if self.bwapi_terrain.is_none() {
                    error!("BWAPI: required terrain analysis unavailable; bridge disabled");
                    return;
                }
                match Server::new(instance) {
                    Ok(server) => {
                        info!("BWAPI: external-client server enabled for local player {local}");
                        *bridge = Some(Bridge {
                            server,
                            state: Snapshot::default(),
                        });
                    }
                    Err(e) => error!("BWAPI: could not start external-client server: {e}"),
                }
            }
            let Some(active) = bridge else { return };
            let result = active.server.poll(|data, connected| unsafe {
                if connected {
                    active.state = Snapshot::default();
                    if matches!((*self.game()).victory_state[local as usize], 1..=3) {
                        active.state.end_published = true;
                        active.state.end_acknowledged = true;
                    }
                    data.is_in_game = 0;
                    data.event_count = 1;
                    data.events[0] = wire::Event {
                        kind: 3,
                        value1: 0,
                        value2: 0,
                    };
                } else {
                    active.state.exchange(self, data, local as u8);
                }
            });
            if let Err(e) = result {
                warn!("BWAPI: client exchange failed: {e}");
            }
            if active.state.exhausted {
                error!("BWAPI: snapshot capacity exhausted; disabling bridge for this match");
                *bridge = None;
            }
        });
    }

    pub(super) fn bwapi_end(&self) {
        // The simulation is over; allow a bounded final exchange for a client still computing.
        BRIDGE.with_borrow_mut(|bridge| {
            let Some(mut bridge_value) = bridge.take() else {
                return;
            };
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            while !bridge_value.state.end_acknowledged && std::time::Instant::now() < deadline {
                let result = bridge_value.server.poll(|data, initial| {
                    if initial {
                        bridge_value.state.started = false;
                    }
                    let local = unsafe { self.local_player_id.resolve() } as usize;
                    let won = local < 8 && unsafe { (*self.game()).victory_state[local] == 3 };
                    if local < 8 && bridge_value.state.started {
                        unsafe {
                            bridge_value.state.update_players(self, data, local as u8);
                            let game = bw_dat::Game::from_ptr(self.game());
                            data.frame_count = game.frame_count() as i32;
                            data.elapsed_time = game.elapsed_seconds() as i32;
                        }
                    }
                    bridge_value.state.finish(data, won);
                });
                if result.is_err()
                    || matches!(result, Ok(crate::bwapi::transport::PollEvent::Disconnected))
                {
                    break;
                }
                if !bridge_value.state.end_acknowledged {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            info!(
                "BWAPI: finished; {} accepted commands, {} rejected commands",
                bridge_value.state.accepted_commands, bridge_value.state.rejected_commands
            );
        });
    }
}

impl Snapshot {
    fn finish(&mut self, data: &mut wire::GameData, won: bool) {
        data.clear_inbound();
        data.event_count = 0;
        data.event_string_count = 0;
        if !self.started || self.end_published {
            data.is_in_game = 0;
            event(data, 3, 0);
            self.end_acknowledged = true;
        } else {
            // The stock client materializes events on MatchFrame and clears its player/event
            // state when isInGame becomes false. Publish the end callback before the menu.
            data.is_in_game = 1;
            event(data, 2, 0);
            event(data, 1, i32::from(won));
            self.end_published = true;
            info!("BWAPI: MatchEnd winner={won} frame={}", data.frame_count);
        }
    }

    unsafe fn exchange(&mut self, bw: &BwScr, data: &mut wire::GameData, local: u8) {
        unsafe {
            let game = bw_dat::Game::from_ptr(bw.game());
            let victory = (**game).victory_state[local as usize];
            if self.end_published || (self.started && matches!(victory, 1..=3)) {
                self.update_players(bw, data, local);
                data.frame_count = game.frame_count() as i32;
                data.elapsed_time = game.elapsed_seconds() as i32;
                let first_end = !self.end_published;
                self.finish(data, victory == 3);
                if first_end && crate::is_background_game() {
                    // Hidden clients cannot wait for someone to dismiss the victory/defeat UI.
                    // The normal loop exit gives the bot its bounded final exchange and publishes
                    // the native result without changing the already adjudicated victory state.
                    crate::game_exit::request_leave_game();
                }
                return;
            }
            let vector = &*bw.units.resolve();
            let native = UnitArray::new(vector.data.cast(), vector.length);
            if self.started {
                self.consume_commands(bw, data, &native, local);
            }
            data.clear_inbound();
            data.event_count = 0;
            data.event_string_count = 0;
            if !self.started {
                self.initialize(bw, data, local);
                event(data, 0, 0);
            }
            data.map_width = i32::from(game.map_width_tiles().min(256));
            data.map_height = i32::from(game.map_height_tiles().min(256));
            data.self_ = i32::from(local);
            data.neutral = 11;
            data.player_count = 12;
            data.selected_unit_count = 0;
            data.nuke_dot_count = 0;
            data.unit_search_size = 0;
            data.unit_array.fill(-1);
            data.is_in_game = 1;
            data.is_multiplayer = 1;
            data.has_gui = 1;
            data.has_lat_com = 0;
            data.flags.fill(0);
            data.flags[1] = 1; // UserInput; complete-map information is never enabled.
            data.frame_count = game.frame_count() as i32;
            data.elapsed_time = game.elapsed_seconds() as i32;
            data.fps = 24;
            data.average_fps = 24.0;
            // The relay owns command latency. Do not advertise BWAPI's local latency compensation.
            let latency = crate::netcode_v2::with_turn_state(|s| s.latency_turns())
                .unwrap_or(2)
                .min(1000) as i32;
            data.latency_frames = latency;
            data.latency_time = latency * 42;
            data.remaining_latency_frames = latency;
            data.remaining_latency_time = latency * 42;
            self.update_players(bw, data, local);
            self.update_tiles(bw, data, local);
            self.update_units(data, &native, local, game);
            for (i, seen) in self.seen_players.iter().enumerate() {
                if *seen {
                    data.players[i].race = i32::from((*bw.players().add(i)).race);
                }
            }
            if self.exhausted || data.event_count as usize >= wire::MAX_EVENTS {
                self.exhausted = true;
                data.event_count = 0;
                data.is_in_game = 0;
                return;
            }
            if !self.started {
                data.initial_unit_count = self.units.len() as i32;
                self.started = true;
                info!(
                    "BWAPI: MatchStart with {} units on {}x{} map",
                    self.units.len(),
                    data.map_width,
                    data.map_height
                );
            } else {
                event(data, 2, 0);
            }
            if game.frame_count().is_multiple_of(240) {
                info!(
                    "BWAPI: frame {} units {} accepted {} rejected {} minerals {}",
                    game.frame_count(),
                    self.units.len(),
                    self.accepted_commands,
                    self.rejected_commands,
                    game.minerals(local)
                );
            }
        }
    }

    unsafe fn initialize(&mut self, bw: &BwScr, data: &mut wire::GameData, local: u8) {
        unsafe {
            let game = &*bw.game();
            if let Some(setup) = crate::game_thread::setup_info() {
                for mapping in crate::game_thread::player_id_mapping() {
                    let Some(id) = mapping.game_id else {
                        continue;
                    };
                    let Some(known) = self.known_races.get_mut(id.0 as usize) else {
                        continue;
                    };
                    *known = setup
                        .slots
                        .iter()
                        .find(|s| s.user_id == Some(mapping.sb_user_id))
                        .and_then(|s| match s.race.as_deref() {
                            Some("z") => Some(0),
                            Some("t") => Some(1),
                            Some("p") => Some(2),
                            _ => None,
                        });
                }
            }
            data.self_ = i32::from(local);
            data.neutral = 11;
            data.enemy = (0..8)
                .find(|&p| {
                    p != local as usize
                        && matches!((*bw.players().add(p)).player_type, 1 | 2)
                        && game.alliances[local as usize][p] == 0
                })
                .map_or(-1, |p| p as i32);
            data.player_count = 12;
            data.force_count = 2;
            copy_text(&mut data.forces[1].name, b"Players");
            data.map_width = i32::from(game.map_width_tiles.min(256));
            data.map_height = i32::from(game.map_height_tiles.min(256));
            copy_text(&mut data.map_name, &game.map_title);
            copy_text(&mut data.map_path_name, &game.map_path);
            let path = game.map_path.split(|&x| x == 0).next().unwrap_or_default();
            copy_text(
                &mut data.map_file_name,
                path.rsplit(|&x| x == b'\\' || x == b'/')
                    .next()
                    .unwrap_or_default(),
            );
            data.game_kind = 2;
            if let Some(setup) = crate::game_thread::setup_info() {
                data.random_seed = setup.seed;
                match map_hash(std::path::Path::new(&setup.map_path)) {
                    Ok(hash) => copy_text(&mut data.map_hash, hash.as_bytes()),
                    Err(e) => warn!("BWAPI: cannot hash map: {e}"),
                }
            }
            data.start_location_count = 0;
            for &[x, y] in &game.start_position {
                if x != 0
                    && y != 0
                    && x < game.map_width_tiles * 32
                    && y < game.map_height_tiles * 32
                {
                    let out = &mut data.start_locations[data.start_location_count as usize];
                    out.x = i32::from(x / 32) - 2;
                    out.y = i32::from(y / 32) - 1;
                    data.start_location_count += 1;
                }
            }
            data.unit_array.fill(-1);
            let pathing = &*bw.pathing();
            data.region_count = i32::from(pathing.region_count.min(5000));
            for (i, out) in data
                .regions
                .iter_mut()
                .take(data.region_count as usize)
                .enumerate()
            {
                let region = &pathing.regions[i];
                out.id = i as i32;
                out.island_id = i32::from(region.group);
                out.center_x = (region.center[0] >> 8) as i32;
                out.center_y = (region.center[1] >> 8) as i32;
                out.priority = i32::from(region.priority & 0x7f);
                out.left_most = i32::from(region.area.left);
                out.right_most = i32::from(region.area.right);
                out.top_most = i32::from(region.area.top);
                out.bottom_most = i32::from(region.area.bottom);
                out.is_accessible = u8::from(region.walkability != 0x1ffd);
                out.is_higher_ground = u8::from(region.walkability == 0x1ff9);
                out.neighbor_count =
                    usize::from(region.all_neighbours).min(out.neighbors.len()) as i32;
                for n in 0..out.neighbor_count as usize {
                    out.neighbors[n] = i32::from(*region.neighbour_ids.add(n));
                }
            }
            for (i, split) in pathing.split_regions.iter().take(5000).enumerate() {
                data.map_split_tiles_mini_tile_mask[i] = split.minitile_flags;
                data.map_split_tiles_region1[i] = split.region_false;
                data.map_split_tiles_region2[i] = split.region_true;
            }
            if let Some(terrain) = &bw.bwapi_terrain {
                let tiles = terrain.tiles.resolve();
                let cv5 = terrain.cv5.resolve();
                let vf4 = terrain.vf4.resolve();
                if !tiles.is_null() && !cv5.is_null() && !vf4.is_null() {
                    for y in 0..data.map_height as usize {
                        for x in 0..data.map_width as usize {
                            data.map_tile_region_id[x][y] = pathing.map_tile_regions[y * 256 + x];
                            let tile = *tiles.add(y * data.map_width as usize + x) as usize;
                            // CV5 records contain a 20-byte header and sixteen u16 megatile IDs.
                            let mega = cv5
                                .add((tile >> 4) * 52 + 20 + (tile & 15) * 2)
                                .cast::<u16>()
                                .read_unaligned() as usize;
                            for dy in 0..4 {
                                for dx in 0..4 {
                                    let wx = x * 4 + dx;
                                    let wy = y * 4 + dy;
                                    let bottom = wy >= data.map_height as usize * 4 - 4
                                        || (wy >= data.map_height as usize * 4 - 8
                                            && (wx < 20 || wx >= data.map_width as usize * 4 - 20));
                                    data.is_walkable[wx][wy] = u8::from(
                                        !bottom && *vf4.add(mega * 16 + dy * 4 + dx) & 1 != 0,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    unsafe fn update_tiles(&self, bw: &BwScr, data: &mut wire::GameData, local: u8) {
        unsafe {
            let Some(terrain) = &bw.bwapi_terrain else {
                return;
            };
            let flags = terrain.flags.resolve();
            if flags.is_null() {
                return;
            }
            let mask = 1u32 << local;
            for y in 0..data.map_height as usize {
                for x in 0..data.map_width as usize {
                    let f = *flags.add(y * data.map_width as usize + x);
                    let visible = f & mask == 0;
                    data.is_visible[x][y] = u8::from(visible);
                    data.is_explored[x][y] = u8::from(f & (mask << 8) == 0);
                    data.has_creep[x][y] = u8::from(visible && f & 0x4040_0000 != 0);
                    data.is_occupied[x][y] = u8::from(visible && f & 0x0800_0000 != 0);
                    data.is_buildable[x][y] = u8::from(f & 0x0084_0000 == 0);
                    data.ground_height[x][y] = ((f >> 24) & 7) as i32;
                }
            }
        }
    }

    unsafe fn update_players(&self, bw: &BwScr, data: &mut wire::GameData, local: u8) {
        unsafe {
            let game = bw_dat::Game::from_ptr(bw.game());
            for i in 0..12usize {
                let player = &*bw.players().add(i);
                let out = &mut data.players[i];
                // Client-writable fields are overwritten before publication.
                *out = mem::zeroed();
                copy_text(&mut out.name, &player.name);
                out.race = if i < 8 && i != local as usize {
                    observed_race(self.known_races[i], self.seen_players[i], player.race)
                } else {
                    i32::from(player.race)
                };
                out.kind = i32::from(player.player_type);
                out.force = 1;
                out.is_neutral = u8::from(i == 11);
                out.is_participating = u8::from(i < 8 && matches!(player.player_type, 1 | 2));
                out.start_location_x = 1000;
                out.start_location_y = 1001; // TilePositions::None.
                if i < 8 {
                    let [x, y] = (**game).start_position[i];
                    if x != 0 && y != 0 {
                        if i != local as usize && !game.allied(local, i as u8) {
                            out.start_location_y = 1002; // TilePositions::Unknown.
                        } else {
                            out.start_location_x = i32::from(x / 32) - 2;
                            out.start_location_y = i32::from(y / 32) - 1;
                        }
                    }
                }
                for j in 0..12usize {
                    let participants = out.is_participating != 0
                        && j < 8
                        && matches!((*bw.players().add(j)).player_type, 1 | 2);
                    out.is_ally[j] = u8::from(participants && game.allied(i as u8, j as u8));
                    out.is_enemy[j] =
                        u8::from(participants && i != j && !game.allied(i as u8, j as u8));
                }
                if i < 8 {
                    out.is_victorious = u8::from((**game).victory_state[i] == 3);
                    out.is_defeated = u8::from(matches!((**game).victory_state[i], 1 | 2));
                }
                if i != local as usize {
                    continue;
                }
                out.start_location_x = i32::from((**game).start_position[i][0] / 32) - 2;
                out.start_location_y = i32::from((**game).start_position[i][1] / 32) - 1;
                out.minerals = game.minerals(local) as i32;
                out.gas = game.gas(local) as i32;
                for race in [Race::Zerg, Race::Terran, Race::Protoss] {
                    let r = race.id() as usize;
                    out.supply_total[r] =
                        game.supply_provided(local, race)
                            .min(game.supply_max(local, race)) as i32;
                    out.supply_used[r] = game.supply_used(local, race) as i32;
                }
                for kind in 0..228 {
                    let id = UnitId(kind as u16);
                    out.all_unit_count[kind] = game.unit_count(local, id) as i32;
                    out.completed_unit_count[kind] = game.completed_count(local, id) as i32;
                    out.dead_unit_count[kind] = game.unit_deaths(local, id) as i32;
                    out.killed_unit_count[kind] = game.unit_kills(local, id) as i32;
                    out.is_unit_available[kind] = u8::from(game.unit_available(local, id));
                }
                for t in 0..44 {
                    out.has_researched[t] = u8::from(game.tech_researched(local, TechId(t as u16)));
                    out.is_researching[t] =
                        u8::from(game.tech_in_progress(local, TechId(t as u16)));
                    out.is_research_available[t] =
                        u8::from(game.tech_available(local, TechId(t as u16)));
                }
                for u in 0..61 {
                    out.upgrade_level[u] =
                        i32::from(game.upgrade_level(local, UpgradeId(u as u16)));
                    out.max_upgrade_level[u] =
                        i32::from(game.upgrade_max_level(local, UpgradeId(u as u16)));
                    out.is_upgrading[u] =
                        u8::from(game.upgrade_in_progress(local, UpgradeId(u as u16)));
                }
            }
        }
    }

    unsafe fn update_units(
        &mut self,
        data: &mut wire::GameData,
        native: &UnitArray,
        local: u8,
        game: bw_dat::Game,
    ) {
        unsafe {
            let mut current = Vec::new();
            let mut deaths = std::collections::HashSet::new();
            for index in 0..native.len() {
                let unit = bw_dat::Unit::from_ptr(native.ptr().add(index)).unwrap();
                if unit.sprite().is_none() || unit.player() >= 12 || unit.id().0 >= 228 {
                    continue;
                }
                let visible = !unit.is_hidden()
                    && unit.is_visible_to(local)
                    && (unit.player() == local || !unit.is_invisible_hidden_to(local));
                let accessible =
                    unit.player() == local || visible || (!self.started && unit.player() == 11);
                let native_id = native.to_unique_id(unit);
                if unit.is_dying() {
                    if visible && let Some(&id) = self.ids.get(&native_id) {
                        deaths.insert(id);
                    }
                    continue;
                }
                let id = if let Some(&id) = self.ids.get(&native_id) {
                    id
                } else if accessible {
                    if self.units.len() == data.units.len() {
                        self.exhausted = true;
                        return;
                    }
                    let id = self.units.len();
                    self.ids.insert(native_id, id);
                    self.units.push(TrackedUnit {
                        native_id,
                        accessible: false,
                        kind: unit.id().0,
                        owner: unit.player(),
                        completed: false,
                        visible: false,
                        announced: false,
                    });
                    id
                } else {
                    continue;
                };
                current.push((id, unit, accessible, visible));
            }
            let mut seen = vec![false; self.units.len()];
            let mut accessible_now = vec![false; self.units.len()];
            for &(id, unit, accessible, visible) in &current {
                seen[id] = true;
                if visible {
                    self.seen_players[unit.player() as usize] = true;
                }
                accessible_now[id] = accessible;
                if !accessible {
                    continue;
                }
                let old = &mut self.units[id];
                let discovered = !old.accessible;
                let created = !old.announced && self.started && unit.player() == local;
                let shown = visible && !old.visible;
                let hidden = !visible && old.visible;
                old.announced = true;
                old.visible = visible;
                let morphed = old.kind != unit.id().0;
                let renegade = old.owner != unit.player();
                let completed = !old.completed && unit.is_completed();
                old.accessible = true;
                old.kind = unit.id().0;
                old.owner = unit.player();
                old.completed = unit.is_completed();
                let out = &mut data.units[id];
                let last_hp = out.hit_points;
                let last_ground_cooldown = out.ground_weapon_cooldown;
                let last_air_cooldown = out.air_weapon_cooldown;
                *out = mem::zeroed();
                out.id = id as i32;
                out.player = i32::from(unit.player());
                out.kind = i32::from(unit.id().0);
                out.clearance_level = if unit.player() == local { 3 } else { 2 };
                out.exists = 1;
                out.is_visible[local as usize] = u8::from(visible);
                out.position_x = i32::from(unit.position().x);
                out.position_y = i32::from(unit.position().y);
                out.hit_points = unit.hp_displayed();
                out.last_hit_points = last_hp;
                out.shields = unit.shields_displayed();
                out.energy = i32::from(unit.energy() / 256);
                out.resources = if unit.id().is_resource_container() {
                    i32::from(unit.resource_amount())
                } else {
                    0
                };
                out.kill_count = unit.kills() as i32;
                out.angle = f64::from((**unit).flingy.facing_direction.wrapping_sub(64))
                    * std::f64::consts::TAU
                    / 256.0;
                out.velocity_x = (**unit).flingy.current_speed_x as f64 / 256.0;
                out.velocity_y = (**unit).flingy.current_speed_y as f64 / 256.0;
                out.ground_weapon_cooldown = i32::from((**unit).ground_cooldown);
                out.air_weapon_cooldown = i32::from((**unit).air_cooldown);
                out.spell_cooldown = i32::from((**unit).spell_cooldown);
                out.is_completed = u8::from(unit.is_completed());
                out.is_detected = 1;
                out.is_powered = u8::from(
                    !(unit.id().is_building()
                        && unit.id().races().intersects(bw_dat::RaceFlags::PROTOSS)
                        && unit.disabled_flag()),
                );
                out.is_interruptible = u8::from(unit.flags() & 0x1000 == 0);
                out.is_invincible = u8::from(unit.is_invincible());
                out.is_burrowed = u8::from(unit.is_burrowed());
                out.is_cloaked = u8::from(unit.is_invisible());
                out.is_hallucination = u8::from(unit.is_hallucination());
                out.is_lifted = u8::from(unit.id().is_building() && unit.is_air());
                out.is_moving = u8::from((**unit).flingy.flingy_flags & 2 != 0);
                let damage_dealer = unit.subunit_turret();
                let attack_image = damage_dealer.sprite().and_then(|s| s.main_image());
                let attacking = attack_image
                    .is_some_and(|image| matches!((**image).iscript.animation, 2 | 3 | 5 | 6))
                    && unit.target().is_some();
                out.is_attacking = u8::from(attacking);
                out.is_starting_attack = u8::from(
                    attacking
                        && (out.ground_weapon_cooldown > last_ground_cooldown
                            || out.air_weapon_cooldown > last_air_cooldown),
                );
                let rest_frame = match unit.id().0 {
                    37 => 85,
                    38 => 51,
                    39 => 153,
                    40 => 17,
                    41 | 43 | 44 | 62 | 103 | 144 => 10000,
                    _ => -1,
                };
                out.is_attack_frame = u8::from(
                    out.is_starting_attack != 0
                        || (attacking
                            && rest_frame >= 0
                            && attack_image
                                .is_some_and(|image| i32::from((**image).frameset) != rest_frame)),
                );
                out.is_idle = u8::from(
                    matches!(
                        unit.order().0,
                        3 | 2 | 1 | 93 | 23 | 175 | 50 | 58 | 166 | 162 | 18 | 117 | 124 | 77
                    ) && unit.first_queued_unit().is_none()
                        && !unit.is_constructing_building(),
                );
                out.is_gathering = u8::from(matches!(unit.order().0, 79..=90));
                out.is_morphing = u8::from(matches!(unit.order().0, 42 | 43 | 45));
                if out.is_morphing != 0 {
                    out.is_completed = 0;
                }
                out.is_constructing = u8::from(
                    out.is_morphing != 0
                        || construction_order(unit.order().0)
                        || unit.secondary_order().0 == 37
                        || (!unit.is_completed() && unit.currently_building().is_some()),
                );
                out.is_training = u8::from(unit.first_queued_unit().is_some());
                out.carry_resource_kind = if unit.is_carrying_minerals() {
                    2
                } else if unit.is_carrying_gas() {
                    1
                } else {
                    0
                };
                out.order = normalized_order(unit.order().0);
                out.secondary_order = normalized_order(unit.secondary_order().0);
                out.order_timer = i32::from((**unit).order_timer);
                out.target_position_x = i32::from((**unit).flingy.move_target.pos.x);
                out.target_position_y = i32::from((**unit).flingy.move_target.pos.y);
                out.order_target_position_x = i32::from(unit.target_pos().x);
                out.order_target_position_y = i32::from(unit.target_pos().y);
                out.target = self.unit_id(
                    native,
                    bw_dat::Unit::from_ptr((**unit).flingy.move_target.unit),
                );
                out.order_target = self.unit_id(native, unit.target());
                out.build_unit = self.unit_id(native, unit.currently_building());
                out.addon = self.unit_id(native, unit.addon());
                out.nydus_exit = self.unit_id(native, unit.nydus_linked());
                out.power_up = self.unit_id(native, unit.powerup());
                out.rally_unit = -1;
                out.rally_position_x = 32000;
                out.rally_position_y = 32032;
                if can_produce(unit.id().0) {
                    out.rally_unit = self.unit_id(native, unit.rally_unit());
                    let rally = (**unit).rally_pylon.rally.pos;
                    out.rally_position_x = i32::from(rally.x);
                    out.rally_position_y = i32::from(rally.y);
                }
                out.transport = if unit.in_transport() {
                    self.unit_id(native, unit.related())
                } else {
                    -1
                };
                out.carrier = self.unit_id(native, unit.fighter_parent());
                out.hatchery = if unit.id().0 == 35 {
                    self.unit_id(native, unit.related())
                } else {
                    -1
                };
                out.build_kind = unit.first_queued_unit().map_or(228, |u| i32::from(u.0));
                out.training_queue.fill(228);
                for slot in 0..5 {
                    if let Some(kind) = unit.nth_queued_unit(slot) {
                        out.training_queue[out.training_queue_count as usize] = i32::from(kind.0);
                        out.training_queue_count += 1;
                    }
                }
                out.remaining_build_time = i32::from((**unit).remaining_build_time);
                out.remaining_train_time = unit
                    .currently_building()
                    .map_or(0, |u| i32::from((**u).remaining_build_time));
                out.tech = unit.tech_in_progress().map_or(44, |x| i32::from(x.0));
                out.upgrade = unit.upgrade_in_progress().map_or(61, |x| i32::from(x.0));
                out.buttonset = i32::from((**unit).buttons);
                out.last_attacker_player = i32::from((**unit).last_attacking_player);
                out.replay_id = id as i32;
                out.is_under_storm = u8::from((**unit).is_under_storm != 0);
                out.is_under_dweb = u8::from(unit.is_under_dweb());
                out.is_blind = u8::from(unit.is_blind());
                out.is_parasited = u8::from(unit.is_parasited());
                out.acid_spore_count = i32::from(unit.acid_spore_count());
                out.defense_matrix_points = i32::from((**unit).defensive_matrix_dmg / 256);
                out.defense_matrix_timer = i32::from((**unit).matrix_timer);
                out.ensnare_timer = i32::from((**unit).ensnare_timer);
                out.irradiate_timer = i32::from((**unit).irradiate_timer);
                out.lockdown_timer = i32::from((**unit).lockdown_timer);
                out.maelstrom_timer = i32::from((**unit).maelstrom_timer);
                out.plague_timer = i32::from((**unit).plague_timer);
                out.stasis_timer = i32::from((**unit).stasis_timer);
                out.stim_timer = i32::from((**unit).stim_timer);
                out.remove_timer = i32::from(unit.death_timer());
                out.spider_mine_count = unit.mine_amount(game) as i32;
                if unit.id().0 == 83 {
                    out.scarab_count = unit.fighter_amount() as i32;
                }
                if unit.id().0 == 72 {
                    out.interceptor_count = unit.fighter_amount() as i32;
                }
                if unit.player() != local {
                    redact_inside(out);
                }
                if created {
                    event(data, 12, id as i32);
                }
                if discovered {
                    event(data, 8, id as i32);
                }
                if shown {
                    event(data, 10, id as i32);
                }
                if hidden {
                    event(data, 11, id as i32);
                }
                if morphed {
                    event(data, 14, id as i32);
                }
                if renegade {
                    event(data, 15, id as i32);
                }
                if completed {
                    event(data, 17, id as i32);
                }
            }
            for id in 0..self.units.len() {
                let accessible = accessible_now[id];
                if self.units[id].accessible && !accessible {
                    self.units[id].accessible = false;
                    data.units[id].exists = 0;
                    data.units[id].clearance_level = 0;
                    data.units[id].is_visible.fill(0);
                    if self.units[id].visible {
                        event(data, 11, id as i32);
                    }
                    self.units[id].visible = false;
                    event(data, 9, id as i32);
                    // A disappearance in fog is not evidence of destruction.
                    if deaths.contains(&id) || (!seen[id] && self.units[id].owner == local) {
                        event(data, 13, id as i32);
                    }
                }
            }
            let mut x_search = Vec::new();
            let mut y_search = Vec::new();
            for &(id, unit, accessible, visible) in &current {
                if accessible && !unit.is_hidden() && x_search.len() + 2 <= data.x_unit_search.len()
                {
                    let rect = unit.collision_rect();
                    for value in [rect.left, rect.right - 1] {
                        x_search.push(wire::UnitFinder {
                            unit_index: id as i32,
                            search_value: i32::from(value),
                        });
                    }
                    for value in [rect.top, rect.bottom - 1] {
                        y_search.push(wire::UnitFinder {
                            unit_index: id as i32,
                            search_value: i32::from(value),
                        });
                    }
                }
                if accessible {
                    let player = &mut data.players[unit.player() as usize];
                    player.visible_unit_count[unit.id().0 as usize] += i32::from(visible);
                    if unit.player() != local {
                        player.all_unit_count[unit.id().0 as usize] += 1;
                        player.completed_unit_count[unit.id().0 as usize] +=
                            i32::from(unit.is_completed());
                    }
                    let native_index = native.to_index(unit) as usize;
                    if native_index < data.unit_array.len() {
                        data.unit_array[native_index] = id as i32;
                    }
                }
            }
            x_search.sort_by_key(|x| x.search_value);
            y_search.sort_by_key(|y| y.search_value);
            data.unit_search_size = x_search.len() as i32;
            data.x_unit_search[..x_search.len()].copy_from_slice(&x_search);
            data.y_unit_search[..y_search.len()].copy_from_slice(&y_search);
        }
    }

    fn unit_id(&self, native: &UnitArray, unit: Option<bw_dat::Unit>) -> i32 {
        unit.and_then(|u| self.ids.get(&native.to_unique_id(u)))
            .filter(|&&id| self.units[id].accessible)
            .map_or(-1, |&id| id as i32)
    }

    unsafe fn consume_commands(
        &mut self,
        bw: &BwScr,
        data: &wire::GameData,
        native: &UnitArray,
        local: u8,
    ) {
        unsafe {
            let Some(counts) = data.inbound_counts() else {
                self.rejected_commands += 1;
                return;
            };
            let count = counts.unit_commands.min(256);
            let selection: Vec<u32> = bw
                .client_selection()
                .into_iter()
                .flatten()
                .map(|u| native.to_unique_id(u))
                .collect();
            let mut submitted = false;
            for command in &data.unit_commands[..count] {
                let Some(actor) = usize::try_from(command.unit_index)
                    .ok()
                    .and_then(|i| self.units.get(i))
                    .filter(|u| u.accessible)
                    .and_then(|u| native.get_by_unique_id(u.native_id))
                else {
                    self.rejected_commands += 1;
                    continue;
                };
                if actor.player() != local {
                    self.rejected_commands += 1;
                    continue;
                }
                let target = usize::try_from(command.target_index)
                    .ok()
                    .and_then(|i| self.units.get(i))
                    .filter(|u| u.accessible)
                    .and_then(|u| native.get_by_unique_id(u.native_id))
                    .filter(|u| {
                        u.player() == local
                            || (u.is_visible_to(local) && !u.is_invisible_hidden_to(local))
                    });
                let (x, y) = if matches!(
                    command.kind,
                    commands::kind::ATTACK_UNIT
                        | commands::kind::GATHER
                        | commands::kind::RIGHT_CLICK_UNIT
                        | commands::kind::SET_RALLY_UNIT
                ) {
                    let Some(target) = target else {
                        self.rejected_commands += 1;
                        continue;
                    };
                    (
                        i32::from(target.position().x),
                        i32::from(target.position().y),
                    )
                } else {
                    (command.x, command.y)
                };
                let command = commands::Command {
                    kind: command.kind,
                    x,
                    y,
                    extra: command.extra,
                };
                let game = &*bw.game();
                let Some(packets) = commands::encode(
                    command,
                    native.to_unique_id(actor),
                    target.map(|u| native.to_unique_id(u)),
                    (game.map_width_tiles, game.map_height_tiles),
                    actor.id().0,
                ) else {
                    if self.rejected_commands < 10 {
                        warn!(
                            "BWAPI: unsupported or malformed command {:?} from unit type {}",
                            command,
                            actor.id().0
                        );
                    }
                    self.rejected_commands += 1;
                    continue;
                };
                if command.kind == commands::kind::BUILD && game.frame_count % 120 < 3 {
                    debug!(
                        "BWAPI: build actor {} type {} at {},{} native order {}",
                        native.to_unique_id(actor),
                        command.extra,
                        command.x,
                        command.y,
                        actor.order().0
                    );
                }
                for packet in &packets {
                    (bw.send_command)(packet.as_ptr(), packet.len());
                }
                self.accepted_commands += 1;
                submitted = true;
            }
            if submitted {
                let mut restore = vec![0x63, selection.len() as u8];
                for id in selection {
                    restore.extend_from_slice(&id.to_le_bytes());
                }
                (bw.send_command)(restore.as_ptr(), restore.len());
            }
        }
    }
}

fn map_hash(path: &std::path::Path) -> std::io::Result<String> {
    use sha1::{Digest, Sha1};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha1::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

// BWAPI 4.4's ProducesUnits flag is part of its public type table.
fn can_produce(kind: u16) -> bool {
    matches!(kind, 72 | 81..=83 | 106 | 111 | 113 | 114 | 130..=133 | 154 | 155 | 160 | 167)
}

fn observed_race(selected: Option<u8>, seen: bool, actual: u8) -> i32 {
    selected
        .map(i32::from)
        .unwrap_or_else(|| if seen { i32::from(actual) } else { 8 })
}

fn construction_order(order: u8) -> bool {
    matches!(normalized_order(order), 25 | 26 | 30..=33 | 37 | 44..=46 | 48 | 70)
}

fn event(data: &mut wire::GameData, kind: i32, unit: i32) {
    if let Some(out) = data.events.get_mut(data.event_count as usize) {
        *out = wire::Event {
            kind,
            value1: unit,
            value2: 0,
        };
        data.event_count += 1;
    }
}

fn copy_text(out: &mut [u8], input: &[u8]) {
    out.fill(0);
    let count = input
        .iter()
        .position(|&x| x == 0)
        .unwrap_or(input.len())
        .min(out.len().saturating_sub(1));
    out[..count].copy_from_slice(&input[..count]);
}

/// Enemy interiors are not part of the player's observation, even when the unit is visible.
fn redact_inside(unit: &mut wire::UnitData) {
    unit.energy = 0;
    unit.training_queue_count = 0;
    unit.training_queue.fill(228);
    unit.build_kind = 228;
    unit.tech = 44;
    unit.upgrade = 61;
    unit.remaining_build_time = 0;
    unit.remaining_train_time = 0;
    unit.remaining_research_time = 0;
    unit.remaining_upgrade_time = 0;
    unit.rally_unit = -1;
    unit.rally_position_x = 32000;
    unit.rally_position_y = 32032;
    unit.has_nuke = 0;
    unit.transport = -1;
    unit.is_hallucination = 0;
    unit.scarab_count = 0;
    unit.spider_mine_count = 0;
    unit.interceptor_count = 0;
}

/// Collapses engine-specific orders into BWAPI public order categories.
fn normalized_order(order: u8) -> i32 {
    match order {
        7 => 1,
        52 => 1,
        8 => 10,
        9 => 10,
        53 => 10,
        54 => 10,
        56 => 10,
        59 => 10,
        60 => 10,
        61 => 10,
        21 => 10,
        134 => 10,
        100 => 10,
        19 => 10,
        22 => 10,
        11 => 10,
        57 => 107,
        108 => 107,
        136 => 107,
        178 => 107,
        62 => 107,
        31 => 30,
        25 => 30,
        70 => 30,
        26 => 44,
        45 => 44,
        48 => 44,
        135 => 14,
        35 => 34,
        114 => 113,
        130 => 3,
        164 => 23,
        28 => 27,
        151 => 150,
        126 => 128,
        _ => i32::from(order),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_end_is_delivered_once_before_menu_and_discards_pending_commands() {
        let layout = std::alloc::Layout::new::<wire::GameData>();
        // The wire schema contains only integers, floats, and fixed arrays; zero is valid.
        let mut data = unsafe {
            let ptr = std::alloc::alloc_zeroed(layout).cast::<wire::GameData>();
            if ptr.is_null() {
                std::alloc::handle_alloc_error(layout);
            }
            Box::from_raw(ptr)
        };
        let mut state = Snapshot {
            started: true,
            ..Default::default()
        };
        data.unit_command_count = 1;
        state.finish(&mut data, true);
        assert_eq!(data.unit_command_count, 0);
        assert_eq!(data.is_in_game, 1);
        assert_eq!(data.event_count, 2);
        assert_eq!(data.events[0].kind, 2);
        assert_eq!(data.events[1].kind, 1);
        assert_eq!(data.events[1].value1, 1);
        assert!(!state.end_acknowledged);
        state.finish(&mut data, true);
        assert_eq!(data.is_in_game, 0);
        assert_eq!(data.event_count, 1);
        assert_eq!(data.events[0].kind, 3);
        assert!(state.end_acknowledged);
        state.finish(&mut data, true);
        assert_eq!(data.event_count, 1);
        assert_eq!(data.events[0].kind, 3);
    }

    #[test]
    fn random_race_is_unknown_until_an_opponent_unit_is_seen() {
        assert_eq!(observed_race(None, false, 0), 8);
        assert_eq!(observed_race(None, true, 0), 0);
        assert_eq!(observed_race(Some(1), false, 1), 1);
    }

    #[test]
    fn drone_landing_remains_construction_until_the_building_morphs() {
        for order in [25, 70, 26, 45, 44] {
            assert!(construction_order(order), "order {order}");
        }
        assert!(!construction_order(71));
        assert!(!construction_order(41));
        assert!(!construction_order(85));
    }

    #[test]
    fn visible_enemy_does_not_reveal_its_interior() {
        let mut unit = wire::UnitData {
            energy: 200,
            training_queue_count: 2,
            training_queue: [0; 5],
            remaining_train_time: 300,
            rally_unit: 5,
            has_nuke: 1,
            hit_points: 100,
            exists: 1,
            ..Default::default()
        };
        redact_inside(&mut unit);
        assert_eq!(unit.energy, 0);
        assert_eq!(unit.training_queue_count, 0);
        assert_eq!(unit.training_queue, [228; 5]);
        assert_eq!(unit.remaining_train_time, 0);
        assert_eq!(unit.rally_unit, -1);
        assert_eq!(unit.has_nuke, 0);
        assert_eq!(unit.hit_points, 100);
        assert_eq!(unit.exists, 1);
    }

    #[test]
    fn wire_strings_are_terminated_and_bounded() {
        let mut text = [255; 4];
        copy_text(&mut text, b"abcdef");
        assert_eq!(&text, b"abc\0");
        copy_text(&mut text, b"a\0b");
        assert_eq!(&text, b"a\0\0\0");
    }
}
