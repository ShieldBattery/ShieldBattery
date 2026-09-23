//! Bounded translation from BWAPI 4.4 unit commands to SC:R network records.
//!
//! Every successful translation begins with a one-unit SC:R selection record. The caller sends
//! the returned records through the game's `send_command` path and restores its prior selection
//! afterwards. This module never applies an order directly to a unit.

/// A BWAPI 4.4 `UnitCommand` without its actor and target object references.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Command {
    pub kind: i32,
    pub x: i32,
    pub y: i32,
    pub extra: i32,
}

/// BWAPI 4.4 `UnitCommandType` values supported by [`encode`].
pub mod kind {
    pub const ATTACK_MOVE: i32 = 0;
    pub const ATTACK_UNIT: i32 = 1;
    pub const BUILD: i32 = 2;
    pub const BUILD_ADDON: i32 = 3;
    pub const TRAIN: i32 = 4;
    pub const MORPH: i32 = 5;
    pub const RESEARCH: i32 = 6;
    pub const UPGRADE: i32 = 7;
    pub const SET_RALLY_POSITION: i32 = 8;
    pub const SET_RALLY_UNIT: i32 = 9;
    pub const MOVE: i32 = 10;
    pub const HOLD_POSITION: i32 = 12;
    pub const STOP: i32 = 13;
    pub const GATHER: i32 = 15;
    pub const RETURN_CARGO: i32 = 16;
    pub const REPAIR: i32 = 17;
    pub const CLOAK: i32 = 20;
    pub const DECLOAK: i32 = 21;
    pub const SIEGE: i32 = 22;
    pub const UNSIEGE: i32 = 23;
    pub const RIGHT_CLICK_POSITION: i32 = 30;
    pub const RIGHT_CLICK_UNIT: i32 = 31;
    pub const CANCEL_CONSTRUCTION: i32 = 33;
    pub const CANCEL_MORPH: i32 = 37;
    pub const USE_TECH: i32 = 40;
    pub const USE_TECH_POSITION: i32 = 41;
    pub const USE_TECH_UNIT: i32 = 42;
}

const SELECTION: u8 = 0x63;
const RIGHT_CLICK: u8 = 0x60;
const TARGETED_ORDER: u8 = 0x61;
const BUILD: u8 = 0x0c;
const BUILD_ADDON_ORDER: u8 = 0x24;
const SIEGE: u8 = 0x26;
const UNSIEGE: u8 = 0x25;
const STIM_PACK: u8 = 0x36;
const CLOAK: u8 = 0x21;
const DECLOAK: u8 = 0x22;
const TRAIN: u8 = 0x1f;
const UNIT_MORPH: u8 = 0x23;
const BUILDING_MORPH: u8 = 0x35;
const TRAIN_FIGHTER: u8 = 0x27;
const STOP: u8 = 0x1a;
const CARRIER_STOP: u8 = 0x1b;
const REAVER_STOP: u8 = 0x1c;
const HOLD_POSITION: u8 = 0x2b;
const RETURN_CARGO: u8 = 0x1e;
const RESEARCH: u8 = 0x30;
const UPGRADE: u8 = 0x32;
const CANCEL_CONSTRUCTION: u8 = 0x18;
const CANCEL_MORPH: u8 = 0x19;

const NO_FOW_TARGET: u16 = 0x00e4;
const MAX_UNIT_TYPE: u16 = 227;
const BWAPI_NONE_POSITION: (i32, i32) = (32_000, 32_032);

const ORDER_MOVE: u8 = 0x06;
const ORDER_ATTACK: u8 = 0x08;
const ORDER_TOWER_ATTACK: u8 = 0x13;
const ORDER_ATTACK_MOVE: u8 = 0x0e;
const ORDER_RALLY_UNIT: u8 = 0x27;
const ORDER_RALLY_POSITION: u8 = 0x28;
const ORDER_HARVEST: u8 = 0x4f;
const ORDER_REPAIR: u8 = 34;
const ORDER_YAMATO_GUN: u8 = 113;
const ORDER_EMP_SHOCKWAVE: u8 = 122;
const ORDER_SCANNER_SWEEP: u8 = 139;
const ORDER_DEFENSIVE_MATRIX: u8 = 141;
const ORDER_DRONE_BUILD: u8 = 0x19;
const ORDER_SCV_BUILD: u8 = 0x1e;
const ORDER_PROBE_BUILD: u8 = 0x1f;
const ORDER_BUILD_NYDUS_EXIT: u8 = 0x2e;
const ORDER_CARRIER_ATTACK: u8 = 0x35;
const ORDER_REAVER_ATTACK: u8 = 0x3b;
const ORDER_MEDIC_HEAL: u8 = 176;

const TERRAN_MARINE: u16 = 0;
const TERRAN_SIEGE_TANK_TANK_MODE: u16 = 5;
const TERRAN_SIEGE_TANK_SIEGE_MODE: u16 = 30;
const TERRAN_FIREBAT: u16 = 32;
const TERRAN_MEDIC: u16 = 34;
const TERRAN_SCV: u16 = 7;
const TERRAN_WRAITH: u16 = 8;
const TERRAN_SCIENCE_VESSEL: u16 = 9;
const TERRAN_BATTLECRUISER: u16 = 12;
const TERRAN_COMMAND_CENTER: u16 = 106;
const TERRAN_COMSAT_STATION: u16 = 107;
const TERRAN_NUCLEAR_SILO: u16 = 108;
const TERRAN_FACTORY: u16 = 113;
const TERRAN_STARPORT: u16 = 114;
const TERRAN_CONTROL_TOWER: u16 = 115;
const TERRAN_SCIENCE_FACILITY: u16 = 116;
const TERRAN_COVERT_OPS: u16 = 117;
const TERRAN_PHYSICS_LAB: u16 = 118;
const TERRAN_MACHINE_SHOP: u16 = 120;
const ZERG_LARVA: u16 = 35;
const ZERG_HYDRALISK: u16 = 38;
const ZERG_DRONE: u16 = 41;
const ZERG_MUTALISK: u16 = 43;
const ZERG_INFESTED_TERRAN: u16 = 50;
const PROTOSS_PROBE: u16 = 64;
const PROTOSS_CARRIER: u16 = 72;
const HERO_WARBRINGER: u16 = 81;
const HERO_GANTRITHOR: u16 = 82;
const PROTOSS_REAVER: u16 = 83;
const ZERG_HATCHERY: u16 = 131;
const ZERG_LAIR: u16 = 132;
const ZERG_NYDUS_CANAL: u16 = 134;
const ZERG_SPIRE: u16 = 141;
const ZERG_CREEP_COLONY: u16 = 143;

/// Encodes one supported BWAPI command as a SC:R selection record followed by its action record.
///
/// `map_size` is the map width and height in tiles. BWAPI `Build` uses tile coordinates; other
/// supported positional commands use pixel coordinates, which must be inside the corresponding
/// tile dimensions multiplied by 32. `actor_id` and `target_id` are SC:R native unique IDs, where
/// zero is not a valid actor or target ID. The caller is responsible for ownership and visibility
/// checks before calling this function. `actor_tile`, when provided for add-ons, must be derived
/// from the actor's native position and placement dimensions, not from bot-supplied coordinates.
pub fn encode(
    command: Command,
    actor_id: u32,
    target_id: Option<u32>,
    map_size: (u16, u16),
    actor_type: u16,
    actor_tile: Option<(i32, i32)>,
) -> Option<Vec<Vec<u8>>> {
    if actor_id == 0 || actor_type > MAX_UNIT_TYPE || map_size.0 == 0 || map_size.1 == 0 {
        return None;
    }

    let action = match command.kind {
        kind::ATTACK_MOVE => {
            no_target(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let queued = queue_flag(command.extra)?;
            let order = if actor_type == ZERG_INFESTED_TERRAN {
                ORDER_ATTACK
            } else {
                ORDER_ATTACK_MOVE
            };
            targeted_order(x, y, 0, order, queued)
        }
        kind::ATTACK_UNIT => {
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let queued = queue_flag(command.extra)?;
            targeted_order(x, y, target, attack_unit_order(actor_type), queued)
        }
        kind::BUILD => {
            no_target(target_id)?;
            let (x, y) = tile_position(command.x, command.y, map_size)?;
            let unit_type = unit_type(command.extra)?;
            build_command(x, y, unit_type, actor_type)?
        }
        kind::BUILD_ADDON => {
            no_target(target_id)?;
            no_coordinates(command)?;
            let addon_type = unit_type(command.extra)?;
            addon_command(actor_tile?, addon_type, actor_type, map_size)?
        }
        kind::TRAIN => {
            no_target(target_id)?;
            no_coordinates(command)?;
            let unit_type = unit_type(command.extra)?;
            train_command(unit_type, actor_type)
        }
        kind::MORPH => {
            no_target(target_id)?;
            no_coordinates(command)?;
            let unit_type = unit_type(command.extra)?;
            let id = if is_player_building(unit_type) {
                BUILDING_MORPH
            } else {
                UNIT_MORPH
            };
            unit_type_command(id, unit_type)
        }
        kind::RESEARCH => {
            no_target(target_id)?;
            no_coordinates(command)?;
            vec![RESEARCH, tech_type(command.extra)?]
        }
        kind::UPGRADE => {
            no_target(target_id)?;
            no_coordinates(command)?;
            vec![UPGRADE, upgrade_type(command.extra)?]
        }
        kind::SET_RALLY_POSITION => {
            no_target(target_id)?;
            no_extra(command)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            targeted_order(x, y, 0, ORDER_RALLY_POSITION, false)
        }
        kind::SET_RALLY_UNIT => {
            no_extra(command)?;
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            targeted_order(x, y, target, ORDER_RALLY_UNIT, false)
        }
        kind::MOVE => {
            no_target(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let queued = queue_flag(command.extra)?;
            targeted_order(x, y, 0, ORDER_MOVE, queued)
        }
        kind::HOLD_POSITION => {
            no_target(target_id)?;
            no_coordinates(command)?;
            vec![HOLD_POSITION, queue_flag(command.extra)? as u8]
        }
        kind::STOP => {
            no_target(target_id)?;
            no_coordinates(command)?;
            let queued = queue_flag(command.extra)?;
            match actor_type {
                PROTOSS_REAVER | HERO_WARBRINGER => vec![REAVER_STOP],
                PROTOSS_CARRIER | HERO_GANTRITHOR => vec![CARRIER_STOP],
                _ => vec![STOP, queued as u8],
            }
        }
        kind::CANCEL_CONSTRUCTION => {
            no_target(target_id)?;
            no_coordinates(command)?;
            no_extra(command)?;
            vec![CANCEL_CONSTRUCTION]
        }
        kind::CANCEL_MORPH => {
            no_target(target_id)?;
            no_coordinates(command)?;
            no_extra(command)?;
            vec![if is_player_building(actor_type) {
                CANCEL_CONSTRUCTION
            } else {
                CANCEL_MORPH
            }]
        }
        kind::SIEGE => {
            no_target(target_id)?;
            no_coordinates(command)?;
            matches!(command.extra, 0 | 5).then_some(())?;
            (actor_type == TERRAN_SIEGE_TANK_TANK_MODE).then_some(vec![SIEGE, 0])?
        }
        kind::UNSIEGE => {
            no_target(target_id)?;
            no_coordinates(command)?;
            matches!(command.extra, 0 | 5).then_some(())?;
            (actor_type == TERRAN_SIEGE_TANK_SIEGE_MODE).then_some(vec![UNSIEGE, 0])?
        }
        kind::CLOAK | kind::DECLOAK => {
            no_target(target_id)?;
            no_coordinates(command)?;
            // useTech(Cloaking_Field) retains its tech ID after BWAPI changes the command type.
            (actor_type == TERRAN_WRAITH && matches!(command.extra, 0 | 9)).then_some(())?;
            vec![
                if command.kind == kind::CLOAK {
                    CLOAK
                } else {
                    DECLOAK
                },
                0,
            ]
        }
        kind::USE_TECH => {
            no_target(target_id)?;
            no_coordinates(command)?;
            (command.extra == 0 && matches!(actor_type, TERRAN_MARINE | TERRAN_FIREBAT))
                .then_some(vec![STIM_PACK])?
        }
        kind::USE_TECH_POSITION => {
            no_target(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let order = match (actor_type, command.extra) {
                (TERRAN_COMSAT_STATION, 4) => ORDER_SCANNER_SWEEP,
                (TERRAN_SCIENCE_VESSEL, 2) => ORDER_EMP_SHOCKWAVE,
                _ => return None,
            };
            targeted_order(x, y, 0, order, false)
        }
        kind::USE_TECH_UNIT => {
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let order = match (actor_type, command.extra) {
                (TERRAN_MEDIC, 34) => ORDER_MEDIC_HEAL,
                (TERRAN_SCIENCE_VESSEL, 6) => ORDER_DEFENSIVE_MATRIX,
                (TERRAN_BATTLECRUISER, 8) => ORDER_YAMATO_GUN,
                _ => return None,
            };
            targeted_order(x, y, target, order, false)
        }
        kind::GATHER => {
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            let queued = queue_flag(command.extra)?;
            targeted_order(x, y, target, ORDER_HARVEST, queued)
        }
        kind::REPAIR => {
            (actor_type == TERRAN_SCV).then_some(())?;
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            targeted_order(x, y, target, ORDER_REPAIR, queue_flag(command.extra)?)
        }
        kind::RETURN_CARGO => {
            no_target(target_id)?;
            no_coordinates(command)?;
            vec![RETURN_CARGO, queue_flag(command.extra)? as u8]
        }
        kind::RIGHT_CLICK_POSITION => {
            no_target(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            right_click(x, y, 0, queue_flag(command.extra)?)
        }
        kind::RIGHT_CLICK_UNIT => {
            let target = required_target_id(target_id)?;
            let (x, y) = pixel_position(command.x, command.y, map_size)?;
            right_click(x, y, target, queue_flag(command.extra)?)
        }
        _ => return None,
    };

    Some(vec![selection(actor_id), action])
}

fn selection(actor_id: u32) -> Vec<u8> {
    let mut record = vec![SELECTION, 1];
    push_u32(&mut record, actor_id);
    record
}

fn targeted_order(x: u16, y: u16, target: u32, order: u8, queued: bool) -> Vec<u8> {
    let mut record = Vec::with_capacity(13);
    record.push(TARGETED_ORDER);
    push_u16(&mut record, x);
    push_u16(&mut record, y);
    push_u32(&mut record, target);
    push_u16(&mut record, NO_FOW_TARGET);
    record.push(order);
    record.push(queued as u8);
    record
}

fn right_click(x: u16, y: u16, target: u32, queued: bool) -> Vec<u8> {
    let mut record = Vec::with_capacity(12);
    record.push(RIGHT_CLICK);
    push_u16(&mut record, x);
    push_u16(&mut record, y);
    push_u32(&mut record, target);
    push_u16(&mut record, NO_FOW_TARGET);
    record.push(queued as u8);
    record
}

fn build_command(x: u16, y: u16, unit_type: u16, actor_type: u16) -> Option<Vec<u8>> {
    let order = match actor_type {
        ZERG_NYDUS_CANAL if unit_type == ZERG_NYDUS_CANAL => ORDER_BUILD_NYDUS_EXIT,
        ZERG_DRONE if is_zerg_building(unit_type) => ORDER_DRONE_BUILD,
        TERRAN_SCV if is_terran_building(unit_type) => ORDER_SCV_BUILD,
        PROTOSS_PROBE if is_protoss_building(unit_type) => ORDER_PROBE_BUILD,
        _ => return None,
    };

    let mut record = Vec::with_capacity(8);
    record.push(BUILD);
    record.push(order);
    push_u16(&mut record, x);
    push_u16(&mut record, y);
    push_u16(&mut record, unit_type);
    Some(record)
}

fn addon_command(
    actor_tile: (i32, i32),
    addon_type: u16,
    actor_type: u16,
    map_size: (u16, u16),
) -> Option<Vec<u8>> {
    let valid_pair = matches!(
        (actor_type, addon_type),
        (
            TERRAN_COMMAND_CENTER,
            TERRAN_COMSAT_STATION | TERRAN_NUCLEAR_SILO
        ) | (TERRAN_FACTORY, TERRAN_MACHINE_SHOP)
            | (TERRAN_STARPORT, TERRAN_CONTROL_TOWER)
            | (
                TERRAN_SCIENCE_FACILITY,
                TERRAN_COVERT_OPS | TERRAN_PHYSICS_LAB
            )
    );
    valid_pair.then_some(())?;

    // BWAPI derives the add-on placement from the parent building's upper-left tile.
    let x = actor_tile.0.checked_add(4)?;
    let y = actor_tile.1.checked_add(1)?;
    let (x, y) = tile_position(x, y, map_size)?;
    let mut record = vec![BUILD, BUILD_ADDON_ORDER];
    push_u16(&mut record, x);
    push_u16(&mut record, y);
    push_u16(&mut record, addon_type);
    Some(record)
}

fn train_command(unit_type: u16, actor_type: u16) -> Vec<u8> {
    match actor_type {
        PROTOSS_CARRIER | HERO_GANTRITHOR | PROTOSS_REAVER | HERO_WARBRINGER => vec![TRAIN_FIGHTER],
        ZERG_LARVA | ZERG_MUTALISK | ZERG_HYDRALISK => unit_type_command(UNIT_MORPH, unit_type),
        ZERG_HATCHERY | ZERG_LAIR | ZERG_SPIRE | ZERG_CREEP_COLONY => {
            unit_type_command(BUILDING_MORPH, unit_type)
        }
        _ => unit_type_command(TRAIN, unit_type),
    }
}

fn unit_type_command(id: u8, unit_type: u16) -> Vec<u8> {
    let mut record = vec![id];
    push_u16(&mut record, unit_type);
    record
}

fn attack_unit_order(actor_type: u16) -> u8 {
    match actor_type {
        PROTOSS_CARRIER | HERO_GANTRITHOR => ORDER_CARRIER_ATTACK,
        PROTOSS_REAVER | HERO_WARBRINGER => ORDER_REAVER_ATTACK,
        _ if is_player_building(actor_type) => ORDER_TOWER_ATTACK,
        _ => ORDER_ATTACK,
    }
}

fn no_target(target_id: Option<u32>) -> Option<()> {
    target_id.is_none().then_some(())
}

fn required_target_id(target_id: Option<u32>) -> Option<u32> {
    target_id.filter(|&id| id != 0)
}

fn no_coordinates(command: Command) -> Option<()> {
    ((command.x == 0 && command.y == 0) || (command.x, command.y) == BWAPI_NONE_POSITION)
        .then_some(())
}

fn no_extra(command: Command) -> Option<()> {
    (command.extra == 0).then_some(())
}

fn queue_flag(extra: i32) -> Option<bool> {
    match extra {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

fn unit_type(extra: i32) -> Option<u16> {
    (0..=i32::from(MAX_UNIT_TYPE))
        .contains(&extra)
        .then_some(extra as u16)
}

fn tech_type(extra: i32) -> Option<u8> {
    (0..44).contains(&extra).then_some(extra as u8)
}

fn upgrade_type(extra: i32) -> Option<u8> {
    (0..61).contains(&extra).then_some(extra as u8)
}

fn pixel_position(x: i32, y: i32, map_size: (u16, u16)) -> Option<(u16, u16)> {
    let width = u32::from(map_size.0) * 32;
    let height = u32::from(map_size.1) * 32;
    let x = u16::try_from(x).ok()?;
    let y = u16::try_from(y).ok()?;
    (u32::from(x) < width && u32::from(y) < height).then_some((x, y))
}

fn tile_position(x: i32, y: i32, map_size: (u16, u16)) -> Option<(u16, u16)> {
    let x = u16::try_from(x).ok()?;
    let y = u16::try_from(y).ok()?;
    (x < map_size.0 && y < map_size.1).then_some((x, y))
}

fn push_u16(record: &mut Vec<u8>, value: u16) {
    record.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(record: &mut Vec<u8>, value: u32) {
    record.extend_from_slice(&value.to_le_bytes());
}

fn is_terran_building(unit_type: u16) -> bool {
    matches!(unit_type, 106 | 109..=114 | 116 | 120 | 122..=125)
}

fn is_zerg_building(unit_type: u16) -> bool {
    matches!(unit_type, 131..=146 | 149)
}

fn is_protoss_building(unit_type: u16) -> bool {
    matches!(unit_type, 154..=157 | 159..=160 | 162..=167 | 169..=172)
}

fn is_player_building(unit_type: u16) -> bool {
    is_terran_building(unit_type) || is_zerg_building(unit_type) || is_protoss_building(unit_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(
        command: Command,
        actor_id: u32,
        target_id: Option<u32>,
        map_size: (u16, u16),
        actor_type: u16,
    ) -> Option<Vec<Vec<u8>>> {
        super::encode(command, actor_id, target_id, map_size, actor_type, None)
    }

    const MAP: (u16, u16) = (128, 96);
    const ACTOR: u32 = 0x89ab_cdef;
    const TARGET: u32 = 0x0123_4567;

    fn command(kind: i32, x: i32, y: i32, extra: i32) -> Command {
        Command { kind, x, y, extra }
    }

    fn encoded(command: Command, target: Option<u32>, actor_type: u16) -> Vec<Vec<u8>> {
        encode(command, ACTOR, target, MAP, actor_type).unwrap()
    }

    #[test]
    fn emits_selection_then_targeted_attack_move() {
        let records = encoded(command(kind::ATTACK_MOVE, 320, 240, 0), None, 0);
        assert_eq!(records[0], [0x63, 1, 0xef, 0xcd, 0xab, 0x89]);
        assert_eq!(
            records[1],
            [0x61, 0x40, 0x01, 0xf0, 0x00, 0, 0, 0, 0, 0xe4, 0, 0x0e, 0,]
        );
    }

    #[test]
    fn emits_documented_targeted_and_right_click_layouts() {
        let attack = encoded(command(kind::ATTACK_UNIT, 511, 512, 1), Some(TARGET), 0);
        assert_eq!(
            attack[1],
            [0x61, 0xff, 1, 0, 2, 0x67, 0x45, 0x23, 1, 0xe4, 0, 0x08, 1,]
        );

        let right_click = encoded(
            command(kind::RIGHT_CLICK_UNIT, 511, 512, 1),
            Some(TARGET),
            0,
        );
        assert_eq!(
            right_click[1],
            [0x60, 0xff, 1, 0, 2, 0x67, 0x45, 0x23, 1, 0xe4, 0, 1]
        );
    }

    #[test]
    fn maps_attack_move_attack_unit_and_stop_special_cases() {
        let infested = encoded(
            command(kind::ATTACK_MOVE, 1, 2, 0),
            None,
            ZERG_INFESTED_TERRAN,
        );
        assert_eq!(infested[1][11], ORDER_ATTACK);

        let carrier = encoded(
            command(kind::ATTACK_UNIT, 1, 2, 0),
            Some(TARGET),
            PROTOSS_CARRIER,
        );
        assert_eq!(carrier[1][11], ORDER_CARRIER_ATTACK);

        let reaver = encoded(command(kind::STOP, 0, 0, 1), None, PROTOSS_REAVER);
        assert_eq!(reaver[1], [REAVER_STOP]);
    }

    #[test]
    fn encodes_build_train_and_morph_records() {
        let build = encoded(command(kind::BUILD, 12, 34, 109), None, TERRAN_SCV);
        assert_eq!(build[1], [0x0c, 0x1e, 12, 0, 34, 0, 109, 0]);

        let extractor = encoded(command(kind::BUILD, 12, 34, 149), None, ZERG_DRONE);
        assert_eq!(extractor[1], [0x0c, 0x19, 12, 0, 34, 0, 149, 0]);

        let shield_battery = encoded(command(kind::BUILD, 12, 34, 172), None, PROTOSS_PROBE);
        assert_eq!(shield_battery[1], [0x0c, 0x1f, 12, 0, 34, 0, 172, 0]);

        let train = encoded(command(kind::TRAIN, 32_000, 32_032, 0), None, 0);
        assert_eq!(train[1], [0x1f, 0, 0]);

        let larva = encoded(command(kind::TRAIN, 32_000, 32_032, 37), None, ZERG_LARVA);
        assert_eq!(larva[1], [0x23, 37, 0]);

        let morph_building = encoded(
            command(kind::MORPH, 32_000, 32_032, 132),
            None,
            ZERG_HATCHERY,
        );
        assert_eq!(morph_building[1], [0x35, 132, 0]);
    }

    #[test]
    fn encodes_rally_move_hold_gather_and_right_click_position() {
        let rally = encoded(command(kind::SET_RALLY_POSITION, 320, 240, 0), None, 0);
        assert_eq!(rally[1][11], ORDER_RALLY_POSITION);
        assert_eq!(rally[1][5..9], [0, 0, 0, 0]);

        let move_order = encoded(command(kind::MOVE, 320, 240, 1), None, 0);
        assert_eq!(move_order[1][11], ORDER_MOVE);
        assert_eq!(move_order[1][12], 1);

        let hold = encoded(command(kind::HOLD_POSITION, 32_000, 32_032, 1), None, 0);
        assert_eq!(hold[1], [0x2b, 1]);

        let stop = encoded(command(kind::STOP, 32_000, 32_032, 0), None, 0);
        assert_eq!(stop[1], [0x1a, 0]);

        let gather = encoded(command(kind::GATHER, 320, 240, 0), Some(TARGET), ZERG_DRONE);
        assert_eq!(gather[1][11], ORDER_HARVEST);

        let right_click = encoded(command(kind::RIGHT_CLICK_POSITION, 320, 240, 0), None, 0);
        assert_eq!(right_click[1][0], 0x60);
        assert_eq!(right_click[1][5..9], [0, 0, 0, 0]);
    }

    #[test]
    fn encodes_return_research_upgrade_and_cancels() {
        let return_cargo = encoded(command(kind::RETURN_CARGO, 0, 0, 1), None, ZERG_DRONE);
        assert_eq!(return_cargo[1], [0x1e, 1]);

        let research = encoded(command(kind::RESEARCH, 0, 0, 43), None, 0);
        assert_eq!(research[1], [0x30, 43]);

        let upgrade = encoded(command(kind::UPGRADE, 0, 0, 60), None, 0);
        assert_eq!(upgrade[1], [0x32, 60]);

        let cancel_construction = encoded(command(kind::CANCEL_CONSTRUCTION, 0, 0, 0), None, 0);
        assert_eq!(cancel_construction[1], [0x18]);

        let cancel_building_morph = encoded(command(kind::CANCEL_MORPH, 0, 0, 0), None, 106);
        assert_eq!(cancel_building_morph[1], [0x18]);

        let cancel_unit_morph = encoded(command(kind::CANCEL_MORPH, 0, 0, 0), None, ZERG_DRONE);
        assert_eq!(cancel_unit_morph[1], [0x19]);
    }

    fn encoded_with_actor_tile(
        command: Command,
        target: Option<u32>,
        actor_type: u16,
        actor_tile: (i32, i32),
    ) -> Vec<Vec<u8>> {
        super::encode(command, ACTOR, target, MAP, actor_type, Some(actor_tile)).unwrap()
    }

    #[test]
    fn encodes_terran_addon_from_trusted_parent_tile() {
        let records = encoded_with_actor_tile(
            command(
                kind::BUILD_ADDON,
                32_000,
                32_032,
                TERRAN_MACHINE_SHOP.into(),
            ),
            None,
            TERRAN_FACTORY,
            (12, 34),
        );
        assert_eq!(records[1], [0x0c, 0x24, 16, 0, 35, 0, 120, 0]);
    }

    #[test]
    fn encodes_terran_siege_stim_and_heal_records() {
        for extra in [0, 5] {
            let siege = encoded(
                command(kind::SIEGE, 32_000, 32_032, extra),
                None,
                TERRAN_SIEGE_TANK_TANK_MODE,
            );
            assert_eq!(siege[1], [0x26, 0]);
            let unsiege = encoded(
                command(kind::UNSIEGE, 32_000, 32_032, extra),
                None,
                TERRAN_SIEGE_TANK_SIEGE_MODE,
            );
            assert_eq!(unsiege[1], [0x25, 0]);
        }

        let stim = encoded(
            command(kind::USE_TECH, 32_000, 32_032, 0),
            None,
            TERRAN_MARINE,
        );
        assert_eq!(stim[1], [0x36]);

        let heal = encoded(
            command(kind::USE_TECH_UNIT, 511, 512, 34),
            Some(TARGET),
            TERRAN_MEDIC,
        );
        assert_eq!(
            heal[1],
            [0x61, 0xff, 1, 0, 2, 0x67, 0x45, 0x23, 1, 0xe4, 0, 176, 0]
        );
    }

    #[test]
    fn encodes_later_terran_abilities_and_repair() {
        for extra in [0, 9] {
            let cloak = encoded(
                command(kind::CLOAK, 32_000, 32_032, extra),
                None,
                TERRAN_WRAITH,
            );
            assert_eq!(cloak[1], [0x21, 0]);
            let decloak = encoded(command(kind::DECLOAK, 0, 0, extra), None, TERRAN_WRAITH);
            assert_eq!(decloak[1], [0x22, 0]);
        }

        let scanner = encoded(
            command(kind::USE_TECH_POSITION, 320, 240, 4),
            None,
            TERRAN_COMSAT_STATION,
        );
        assert_eq!(
            scanner[1],
            [0x61, 0x40, 1, 0xf0, 0, 0, 0, 0, 0, 0xe4, 0, 139, 0]
        );

        let emp = encoded(
            command(kind::USE_TECH_POSITION, 320, 240, 2),
            None,
            TERRAN_SCIENCE_VESSEL,
        );
        assert_eq!(
            emp[1],
            [0x61, 0x40, 1, 0xf0, 0, 0, 0, 0, 0, 0xe4, 0, 122, 0]
        );

        let matrix = encoded(
            command(kind::USE_TECH_UNIT, 511, 512, 6),
            Some(TARGET),
            TERRAN_SCIENCE_VESSEL,
        );
        assert_eq!(
            matrix[1],
            [0x61, 0xff, 1, 0, 2, 0x67, 0x45, 0x23, 1, 0xe4, 0, 141, 0]
        );

        let yamato = encoded(
            command(kind::USE_TECH_UNIT, 511, 512, 8),
            Some(TARGET),
            TERRAN_BATTLECRUISER,
        );
        assert_eq!(
            yamato[1],
            [0x61, 0xff, 1, 0, 2, 0x67, 0x45, 0x23, 1, 0xe4, 0, 113, 0]
        );

        for queued in [0, 1] {
            let repair = encoded(
                command(kind::REPAIR, 511, 512, queued),
                Some(TARGET),
                TERRAN_SCV,
            );
            assert_eq!(
                repair[1],
                [
                    0x61,
                    0xff,
                    1,
                    0,
                    2,
                    0x67,
                    0x45,
                    0x23,
                    1,
                    0xe4,
                    0,
                    34,
                    queued as u8
                ]
            );
        }
    }

    #[test]
    fn rejects_malformed_later_terran_commands() {
        for (cmd, target, actor) in [
            (
                command(kind::SIEGE, 0, 0, 6),
                None,
                TERRAN_SIEGE_TANK_TANK_MODE,
            ),
            (
                command(kind::UNSIEGE, 0, 0, 6),
                None,
                TERRAN_SIEGE_TANK_SIEGE_MODE,
            ),
            (command(kind::CLOAK, 0, 0, 9), None, TERRAN_MARINE),
            (command(kind::CLOAK, 1, 0, 9), None, TERRAN_WRAITH),
            (command(kind::CLOAK, 0, 0, 2), None, TERRAN_WRAITH),
            (command(kind::DECLOAK, 0, 0, 9), Some(TARGET), TERRAN_WRAITH),
            (
                command(kind::USE_TECH_POSITION, 320, 240, 4),
                None,
                TERRAN_SCIENCE_VESSEL,
            ),
            (
                command(kind::USE_TECH_POSITION, 320, 240, 2),
                None,
                TERRAN_COMSAT_STATION,
            ),
            (
                command(kind::USE_TECH_POSITION, 320, 240, 34),
                None,
                TERRAN_COMSAT_STATION,
            ),
            (
                command(kind::USE_TECH_POSITION, 320, 240, 4),
                Some(TARGET),
                TERRAN_COMSAT_STATION,
            ),
            (
                command(kind::USE_TECH_POSITION, 4096, 240, 4),
                None,
                TERRAN_COMSAT_STATION,
            ),
            (
                command(kind::USE_TECH_POSITION, 320, -1, 2),
                None,
                TERRAN_SCIENCE_VESSEL,
            ),
            (
                command(kind::USE_TECH_UNIT, 511, 512, 6),
                None,
                TERRAN_SCIENCE_VESSEL,
            ),
            (
                command(kind::USE_TECH_UNIT, 511, 512, 8),
                Some(0),
                TERRAN_BATTLECRUISER,
            ),
            (
                command(kind::USE_TECH_UNIT, 4096, 512, 6),
                Some(TARGET),
                TERRAN_SCIENCE_VESSEL,
            ),
            (
                command(kind::USE_TECH_UNIT, 511, 512, 6),
                Some(TARGET),
                TERRAN_BATTLECRUISER,
            ),
            (
                command(kind::USE_TECH_UNIT, 511, 512, 8),
                Some(TARGET),
                TERRAN_SCIENCE_VESSEL,
            ),
            (command(kind::REPAIR, 511, 512, 0), None, TERRAN_SCV),
            (
                command(kind::REPAIR, 511, 512, 0),
                Some(TARGET),
                TERRAN_MEDIC,
            ),
            (command(kind::REPAIR, 511, 512, 2), Some(TARGET), TERRAN_SCV),
            (
                command(kind::REPAIR, 511, 3072, 0),
                Some(TARGET),
                TERRAN_SCV,
            ),
        ] {
            assert!(
                encode(cmd, ACTOR, target, MAP, actor).is_none(),
                "{cmd:?} for actor {actor}"
            );
        }
    }

    #[test]
    fn rejects_invalid_terran_command_shapes_and_actors() {
        assert!(
            encode(
                command(
                    kind::BUILD_ADDON,
                    32_000,
                    32_032,
                    TERRAN_MACHINE_SHOP.into()
                ),
                ACTOR,
                None,
                MAP,
                TERRAN_FACTORY,
            )
            .is_none()
        );
        assert!(
            super::encode(
                command(kind::BUILD_ADDON, 1, 1, TERRAN_MACHINE_SHOP.into()),
                ACTOR,
                None,
                MAP,
                TERRAN_FACTORY,
                Some((12, 34)),
            )
            .is_none()
        );
        assert!(
            super::encode(
                command(
                    kind::BUILD_ADDON,
                    32_000,
                    32_032,
                    TERRAN_CONTROL_TOWER.into()
                ),
                ACTOR,
                None,
                MAP,
                TERRAN_FACTORY,
                Some((12, 34)),
            )
            .is_none()
        );
        assert!(
            super::encode(
                command(
                    kind::BUILD_ADDON,
                    32_000,
                    32_032,
                    TERRAN_MACHINE_SHOP.into()
                ),
                ACTOR,
                None,
                MAP,
                TERRAN_FACTORY,
                Some((124, 34)),
            )
            .is_none()
        );
        assert!(
            encode(
                command(kind::SIEGE, 32_000, 32_032, 0),
                ACTOR,
                None,
                MAP,
                TERRAN_SIEGE_TANK_SIEGE_MODE,
            )
            .is_none()
        );
        assert!(
            encode(
                command(kind::USE_TECH, 32_000, 32_032, 1),
                ACTOR,
                None,
                MAP,
                TERRAN_MARINE,
            )
            .is_none()
        );
        assert!(
            encode(
                command(kind::USE_TECH_UNIT, 511, 512, 34),
                ACTOR,
                None,
                MAP,
                TERRAN_MEDIC,
            )
            .is_none()
        );
        assert!(
            encode(
                command(kind::USE_TECH_UNIT, 511, 512, 33),
                ACTOR,
                Some(TARGET),
                MAP,
                TERRAN_MEDIC,
            )
            .is_none()
        );
    }

    #[test]
    fn rejects_unsupported_and_malformed_commands() {
        assert!(encode(command(99, 0, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::ATTACK_UNIT, 0, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::MOVE, 0, 0, 2), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::BUILD, 0, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::TRAIN, 1, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::MORPH, 0, 0, 228), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::RESEARCH, 0, 0, 44), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::UPGRADE, 0, 0, 61), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::STOP, 1, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::MOVE, 0, 0, 0), 0, None, MAP, 0).is_none());
        assert!(encode(command(kind::MOVE, 0, 0, 0), ACTOR, None, MAP, 228).is_none());
        assert!(encode(command(kind::MOVE, 0, 0, 0), ACTOR, Some(TARGET), MAP, 0).is_none());
        assert!(encode(command(kind::GATHER, 0, 0, 0), ACTOR, Some(0), MAP, 0).is_none());
    }

    #[test]
    fn enforces_pixel_and_tile_map_boundaries() {
        assert!(encode(command(kind::MOVE, 4095, 3071, 0), ACTOR, None, MAP, 0).is_some());
        assert!(encode(command(kind::MOVE, 4096, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(encode(command(kind::MOVE, -1, 0, 0), ACTOR, None, MAP, 0).is_none());
        assert!(
            encode(
                command(kind::MOVE, 65_536, 0, 0),
                ACTOR,
                None,
                (u16::MAX, 1),
                0
            )
            .is_none()
        );
        assert!(
            encode(
                command(kind::BUILD, 127, 95, 109),
                ACTOR,
                None,
                MAP,
                TERRAN_SCV
            )
            .is_some()
        );
        assert!(
            encode(
                command(kind::BUILD, 128, 0, 109),
                ACTOR,
                None,
                MAP,
                TERRAN_SCV
            )
            .is_none()
        );
    }
}
