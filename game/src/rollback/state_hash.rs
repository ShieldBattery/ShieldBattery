//! A hash of the synced simulation state, which clients compare to check that their simulations
//! agree. The hash is built from one hash per part of the state, so two runs that disagree can
//! tell which part they disagree on.

use std::fmt;
use std::hash::Hasher;

use fxhash::FxHasher64;

use crate::bw;
use crate::bw_scr::BwScr;

/// Upper bound on the entries one object list is walked for, against a list whose links have
/// been overwritten.
const MAX_LIST_ENTRIES: usize = 0x10000;

/// The synced simulation state hashed one part at a time, equal on two clients exactly when their
/// simulations agree on what it covers: the economy, supply and research of every player, the RNG,
/// and every unit and bullet in list order with its position, vitals, orders and targets.
///
/// Built only from values every client computes identically. Pointers differ between processes,
/// so an object another object refers to is identified by its own fields instead, and nothing the
/// local view decides (camera, vision, selection) goes in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct StateHash {
    /// The frame count the state is at. Also hashed into [`frame_rng`](Self::frame_rng).
    pub frame: u32,
    /// The frame count and the words around the RNG seed.
    pub frame_rng: u64,
    /// Every player's minerals and gas.
    pub economy: u64,
    /// Every race's provided, used and maximum supply for every player.
    pub supply: u64,
    /// Every player's upgrade and tech levels.
    pub tech: u64,
    /// How many units the active and hidden unit lists hold together.
    pub unit_count: u32,
    /// Every unit of both lists in list order, and each list's length.
    pub units: u64,
    /// How many bullets the active bullet list holds.
    pub bullet_count: u32,
    /// Every bullet in list order, and the list's length.
    pub bullets: u64,
}

impl StateHash {
    /// The single hash of the whole state that clients send each other to compare.
    pub fn combined(&self) -> u64 {
        let mut hasher = FxHasher64::default();
        for component in [
            self.frame_rng,
            self.economy,
            self.supply,
            self.tech,
            self.units,
            self.bullets,
        ] {
            hasher.write_u64(component);
        }
        hasher.finish()
    }
}

/// `hash <combined> frame_rng <h> economy <h> supply <h> tech <h> units <count>/<h> bullets
/// <count>/<h>`, every hash as 16 hex digits.
impl fmt::Display for StateHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "hash {:016x} frame_rng {:016x} economy {:016x} supply {:016x} tech {:016x} \
             units {}/{:016x} bullets {}/{:016x}",
            self.combined(),
            self.frame_rng,
            self.economy,
            self.supply,
            self.tech,
            self.unit_count,
            self.units,
            self.bullet_count,
            self.bullets,
        )
    }
}

/// A position, and the unit there identified by [`unit_identity`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TargetRecord {
    pub x: i16,
    pub y: i16,
    pub unit: u32,
}

impl TargetRecord {
    unsafe fn read(target: &bw::PointAndUnit) -> TargetRecord {
        unsafe {
            TargetRecord {
                x: target.pos.x,
                y: target.pos.y,
                unit: unit_identity(target.unit),
            }
        }
    }

    fn hash_into(&self, hasher: &mut impl Hasher) {
        hasher.write_i16(self.x);
        hasher.write_i16(self.y);
        hasher.write_u32(self.unit);
    }
}

/// The hashed fields units and bullets share, from their movement state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FlingyRecord {
    pub hitpoints: i32,
    /// The position in 1/256 pixels.
    pub exact_x: i32,
    pub exact_y: i32,
    pub current_speed: i32,
    pub facing_direction: u8,
    pub movement_direction: u8,
    pub move_target: TargetRecord,
}

impl FlingyRecord {
    unsafe fn read(flingy: &bw::Flingy) -> FlingyRecord {
        unsafe {
            FlingyRecord {
                hitpoints: flingy.hitpoints,
                exact_x: flingy.exact_position.x,
                exact_y: flingy.exact_position.y,
                current_speed: flingy.current_speed,
                facing_direction: flingy.facing_direction,
                movement_direction: flingy.movement_direction,
                move_target: TargetRecord::read(&flingy.move_target),
            }
        }
    }

    fn hash_into(&self, hasher: &mut impl Hasher) {
        hasher.write_i32(self.hitpoints);
        hasher.write_i32(self.exact_x);
        hasher.write_i32(self.exact_y);
        hasher.write_i32(self.current_speed);
        hasher.write_u8(self.facing_direction);
        hasher.write_u8(self.movement_direction);
        self.move_target.hash_into(hasher);
    }
}

/// Everything the state hash covers of one unit, plus where it sits in the unit pool.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct UnitRecord {
    /// The unit's slot in the unit pool, which every client allocates identically. Not hashed: the
    /// list order already is.
    pub index: u32,
    pub flingy: FlingyRecord,
    pub minor_unique_index: u8,
    pub unit_id: u16,
    pub player: u8,
    pub shields: i32,
    pub energy: u16,
    pub flags: u32,
    pub order: u8,
    pub order_state: u8,
    pub order_timer: u8,
    pub secondary_order: u8,
    pub secondary_order_state: u8,
    pub ground_cooldown: u8,
    pub air_cooldown: u8,
    pub spell_cooldown: u8,
    pub remaining_build_time: u16,
    pub build_queue: [u16; 5],
    pub order_target: TargetRecord,
    /// The subunit, identified by [`unit_identity`].
    pub subunit: u32,
}

impl UnitRecord {
    unsafe fn read(unit: &bw::Unit, pool: *const bw::Unit) -> UnitRecord {
        unsafe {
            let offset = (unit as *const bw::Unit as usize).wrapping_sub(pool as usize);
            UnitRecord {
                index: (offset / size_of::<bw::Unit>()) as u32,
                flingy: FlingyRecord::read(&unit.flingy),
                minor_unique_index: unit.minor_unique_index,
                unit_id: unit.unit_id,
                player: unit.player,
                shields: unit.shields,
                energy: unit.energy,
                flags: unit.flags,
                order: unit.order,
                order_state: unit.order_state,
                order_timer: unit.order_timer,
                secondary_order: unit.secondary_order,
                secondary_order_state: unit.secondary_order_state,
                ground_cooldown: unit.ground_cooldown,
                air_cooldown: unit.air_cooldown,
                spell_cooldown: unit.spell_cooldown,
                remaining_build_time: unit.remaining_build_time,
                build_queue: unit.build_queue,
                order_target: TargetRecord::read(&unit.order_target),
                subunit: unit_identity(unit.subunit),
            }
        }
    }

    fn hash_into(&self, hasher: &mut impl Hasher) {
        self.flingy.hash_into(hasher);
        hasher.write_u8(self.minor_unique_index);
        hasher.write_u16(self.unit_id);
        hasher.write_u8(self.player);
        hasher.write_i32(self.shields);
        hasher.write_u16(self.energy);
        hasher.write_u32(self.flags);
        hasher.write_u8(self.order);
        hasher.write_u8(self.order_state);
        hasher.write_u8(self.order_timer);
        hasher.write_u8(self.secondary_order);
        hasher.write_u8(self.secondary_order_state);
        hasher.write_u8(self.ground_cooldown);
        hasher.write_u8(self.air_cooldown);
        hasher.write_u8(self.spell_cooldown);
        hasher.write_u16(self.remaining_build_time);
        for &queued in &self.build_queue {
            hasher.write_u16(queued);
        }
        self.order_target.hash_into(hasher);
        hasher.write_u32(self.subunit);
    }

    /// What this unit alone hashes to, so one unit's difference between two runs shows up without
    /// comparing every field.
    pub fn hash(&self) -> u64 {
        let mut hasher = FxHasher64::default();
        self.hash_into(&mut hasher);
        hasher.finish()
    }
}

/// The heads of the object lists the state hash walks, and the start of the unit pool the units'
/// [`index`](UnitRecord::index) is counted from.
struct ObjectLists {
    units: [*const bw::Unit; 2],
    bullets: *const bw::Bullet,
    unit_pool: *const bw::Unit,
}

/// The [`StateHash`] of the current state. When `units_out` is given, every hashed unit is
/// appended to it in list order as well.
pub(crate) unsafe fn state_hash(
    bw: &BwScr,
    game: *const bw::Game,
    rng: &[u32; 6],
    units_out: Option<&mut Vec<UnitRecord>>,
) -> StateHash {
    unsafe {
        let lists = ObjectLists {
            units: [
                bw.rollback_list_head("first_active_unit") as *const bw::Unit,
                bw.rollback_list_head("first_hidden_unit") as *const bw::Unit,
            ],
            bullets: bw.rollback_list_head("first_active_bullet") as *const bw::Bullet,
            unit_pool: bw.rollback_unit_pool(),
        };
        hash_state(&*game, rng, &lists, units_out)
    }
}

/// The hash of one component, leaving `hasher` empty for the next.
fn finish_component(hasher: &mut FxHasher64) -> u64 {
    std::mem::take(hasher).finish()
}

unsafe fn hash_state(
    game: &bw::Game,
    rng: &[u32; 6],
    lists: &ObjectLists,
    mut units_out: Option<&mut Vec<UnitRecord>>,
) -> StateHash {
    unsafe {
        let mut hasher = FxHasher64::default();
        hasher.write_u32(game.frame_count);
        for &word in rng {
            hasher.write_u32(word);
        }
        let frame_rng = finish_component(&mut hasher);

        for values in [&game.minerals, &game.gas] {
            for &value in values {
                hasher.write_u32(value);
            }
        }
        let economy = finish_component(&mut hasher);

        for supplies in &game.supplies {
            for values in [&supplies.provided, &supplies.used, &supplies.max] {
                for &value in values {
                    hasher.write_u32(value);
                }
            }
        }
        let supply = finish_component(&mut hasher);

        hasher.write(game.upgrade_level_sc.as_flattened());
        hasher.write(game.tech_level_sc.as_flattened());
        hasher.write(game.upgrade_level_bw.as_flattened());
        hasher.write(game.tech_level_bw.as_flattened());
        let tech = finish_component(&mut hasher);

        let mut unit_count = 0;
        for first in lists.units {
            let mut unit = first;
            let mut count = 0;
            while !unit.is_null() && count < MAX_LIST_ENTRIES {
                let record = UnitRecord::read(&*unit, lists.unit_pool);
                record.hash_into(&mut hasher);
                if let Some(out) = units_out.as_deref_mut() {
                    out.push(record);
                }
                unit = (*unit).flingy.next as *const bw::Unit;
                count += 1;
            }
            hasher.write_usize(count);
            unit_count += count;
        }
        let units = finish_component(&mut hasher);

        let mut bullet = lists.bullets;
        let mut bullet_count = 0;
        while !bullet.is_null() && bullet_count < MAX_LIST_ENTRIES {
            let b = &*bullet;
            FlingyRecord::read(&b.flingy).hash_into(&mut hasher);
            hasher.write_u8(b.player);
            hasher.write_u8(b.state);
            hasher.write_u8(b.order_timer);
            hasher.write_u8(b.weapon_id);
            hasher.write_u8(b.death_timer);
            hasher.write_u8(b.flags);
            hasher.write_u8(b.bounces_remaining);
            TargetRecord::read(&b.target).hash_into(&mut hasher);
            hasher.write_u32(unit_identity(b.parent));
            bullet = b.flingy.next as *const bw::Bullet;
            bullet_count += 1;
        }
        hasher.write_usize(bullet_count);
        let bullets = finish_component(&mut hasher);

        StateHash {
            frame: game.frame_count,
            frame_rng,
            economy,
            supply,
            tech,
            unit_count: unit_count as u32,
            units,
            bullet_count: bullet_count as u32,
            bullets,
        }
    }
}

/// A unit identified by its own fields rather than its address: its type and how many times its
/// slot has been handed out, or 0 for no unit.
unsafe fn unit_identity(unit: *const bw::Unit) -> u32 {
    unsafe {
        match unit.is_null() {
            true => 0,
            false => {
                (((*unit).minor_unique_index as u32) << 16 | (*unit).unit_id as u32).wrapping_add(1)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::ptr::null;

    /// A game whose units all sit in one pool: every unit but the last linked into the active list
    /// in pool order, the last alone in the hidden list, and two bullets fired by the first unit.
    struct World {
        game: Box<bw::Game>,
        units: Vec<bw::Unit>,
        bullets: Vec<bw::Bullet>,
    }

    impl World {
        fn new(unit_count: usize) -> World {
            let mut game: Box<bw::Game> = Box::new(unsafe { std::mem::zeroed() });
            game.frame_count = 1234;
            game.minerals[0] = 50;
            game.gas[1] = 8;
            game.supplies[0].used[0] = 8;
            game.upgrade_level_sc[0][3] = 1;
            game.tech_level_bw[1][2] = 1;
            let mut units: Vec<bw::Unit> = (0..unit_count)
                .map(|i| {
                    let mut unit: bw::Unit = unsafe { std::mem::zeroed() };
                    unit.unit_id = (i % 100) as u16;
                    unit.player = (i % 2) as u8;
                    unit.flingy.hitpoints = 40 * 256 + i as i32;
                    unit.flingy.exact_position.x = (i as i32) * 512;
                    unit.flingy.exact_position.y = 1000;
                    unit.order = 3;
                    unit.energy = 50;
                    unit
                })
                .collect();
            let mut bullets: Vec<bw::Bullet> = (0..2)
                .map(|i| {
                    let mut bullet: bw::Bullet = unsafe { std::mem::zeroed() };
                    bullet.weapon_id = i;
                    bullet
                })
                .collect();
            // The links point into the vectors' storage, which the moves below don't reallocate.
            let unit_base = units.as_mut_ptr();
            let linked = unit_count.saturating_sub(2);
            for (i, unit) in units.iter_mut().enumerate().take(linked) {
                unit.flingy.next = unsafe { unit_base.add(i + 1) } as *mut bw::Flingy;
            }
            if unit_count >= 2 {
                units[0].order_target.unit = unsafe { unit_base.add(1) };
            }
            let bullet_base = bullets.as_mut_ptr();
            for bullet in &mut bullets {
                bullet.parent = unit_base;
            }
            bullets[0].flingy.next = unsafe { bullet_base.add(1) } as *mut bw::Flingy;
            World {
                game,
                units,
                bullets,
            }
        }

        fn lists(&self) -> ObjectLists {
            let count = self.units.len();
            let unit_at = |i: usize| match i < count {
                true => &self.units[i] as *const bw::Unit,
                false => null(),
            };
            ObjectLists {
                units: [unit_at(0), unit_at(count.saturating_sub(1))],
                bullets: self.bullets.as_ptr(),
                unit_pool: self.units.as_ptr(),
            }
        }

        fn hash(&self, units_out: Option<&mut Vec<UnitRecord>>) -> StateHash {
            unsafe { hash_state(&self.game, &[1, 2, 3, 4, 5, 6], &self.lists(), units_out) }
        }
    }

    #[test]
    fn a_change_moves_only_its_component_and_the_combined_hash() {
        let base = World::new(5).hash(None);
        assert_eq!(base.frame, 1234);
        assert_eq!(base.unit_count, 5);
        assert_eq!(base.bullet_count, 2);

        let mut changed = World::new(5);
        changed.units[2].flingy.hitpoints -= 1;
        let hash = changed.hash(None);
        assert_ne!(hash.units, base.units);
        assert_ne!(hash.combined(), base.combined());
        assert_eq!(
            (
                hash.frame_rng,
                hash.economy,
                hash.supply,
                hash.tech,
                hash.bullets
            ),
            (
                base.frame_rng,
                base.economy,
                base.supply,
                base.tech,
                base.bullets
            ),
        );

        let mut changed = World::new(5);
        changed.game.gas[3] = 1;
        let hash = changed.hash(None);
        assert_ne!(hash.economy, base.economy);
        assert_ne!(hash.combined(), base.combined());
        assert_eq!(
            (
                hash.frame_rng,
                hash.supply,
                hash.tech,
                hash.units,
                hash.bullets
            ),
            (
                base.frame_rng,
                base.supply,
                base.tech,
                base.units,
                base.bullets
            ),
        );

        let mut changed = World::new(5);
        changed.bullets[1].death_timer = 9;
        let hash = changed.hash(None);
        assert_ne!(hash.bullets, base.bullets);
        assert_eq!(hash.units, base.units);
    }

    #[test]
    fn a_referenced_unit_counts_by_identity_not_address() {
        let base = World::new(5).hash(None);
        let mut changed = World::new(5);
        // Unit 0 targets unit 1 in both runs; what unit 1 is decides unit 0's hash.
        changed.units[1].minor_unique_index = 1;
        let mut units = Vec::new();
        let hash = changed.hash(Some(&mut units));
        assert_ne!(hash.units, base.units);
        assert_eq!(units[0].order_target.unit, (1 << 16 | 1) + 1);
    }

    #[test]
    fn captured_units_are_the_hashed_ones_in_list_order() {
        let world = World::new(6);
        let mut units = Vec::new();
        let hash = world.hash(Some(&mut units));
        assert_eq!(units.len(), hash.unit_count as usize);
        let indices: Vec<u32> = units.iter().map(|x| x.index).collect();
        assert_eq!(indices, vec![0, 1, 2, 3, 4, 5]);
        assert_eq!(units[3].flingy.exact_x, 3 * 512);
        assert_eq!(world.hash(None), hash);

        let mut changed = World::new(6);
        changed.units[4].energy += 1;
        let mut changed_units = Vec::new();
        changed.hash(Some(&mut changed_units));
        let differing: Vec<u32> = units
            .iter()
            .zip(&changed_units)
            .filter(|(a, b)| a.hash() != b.hash())
            .map(|(a, _)| a.index)
            .collect();
        assert_eq!(differing, vec![4]);
    }
}
