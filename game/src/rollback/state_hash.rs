//! A hash of the synced simulation state, which clients compare to check that their simulations
//! agree.

use crate::bw;
use crate::bw_scr::BwScr;

/// Upper bound on the entries one object list is walked for, against a list whose links have
/// been overwritten.
const MAX_LIST_ENTRIES: usize = 0x10000;

/// A hash of the synced simulation state, equal on two clients exactly when their simulations
/// agree on what it covers: the economy, supply and research of every player, the RNG, and every
/// unit and bullet in list order with its position, vitals, orders and targets.
///
/// Built only from values every client computes identically. Pointers differ between processes,
/// so an object another object refers to is identified by its own fields instead, and nothing the
/// local view decides (camera, vision, selection) goes in.
pub(crate) unsafe fn state_hash(bw: &BwScr, game: *const bw::Game, rng: &[u32; 6]) -> u64 {
    use std::hash::Hasher;
    unsafe {
        let mut hasher = fxhash::FxHasher64::default();
        let game = &*game;
        hasher.write_u32(game.frame_count);
        for &word in rng {
            hasher.write_u32(word);
        }
        for values in [&game.minerals, &game.gas] {
            for &value in values {
                hasher.write_u32(value);
            }
        }
        for supplies in &game.supplies {
            for values in [&supplies.provided, &supplies.used, &supplies.max] {
                for &value in values {
                    hasher.write_u32(value);
                }
            }
        }
        hasher.write(game.upgrade_level_sc.as_flattened());
        hasher.write(game.tech_level_sc.as_flattened());
        hasher.write(game.upgrade_level_bw.as_flattened());
        hasher.write(game.tech_level_bw.as_flattened());

        let units = [
            bw.rollback_list_head("first_active_unit"),
            bw.rollback_list_head("first_hidden_unit"),
        ];
        for first in units {
            let mut unit = first as *const bw::Unit;
            let mut count = 0;
            while !unit.is_null() && count < MAX_LIST_ENTRIES {
                hash_unit(&mut hasher, &*unit);
                unit = (*unit).flingy.next as *const bw::Unit;
                count += 1;
            }
            hasher.write_usize(count);
        }

        let mut bullet = bw.rollback_list_head("first_active_bullet") as *const bw::Bullet;
        let mut count = 0;
        while !bullet.is_null() && count < MAX_LIST_ENTRIES {
            let b = &*bullet;
            hash_flingy(&mut hasher, &b.flingy);
            hasher.write_u8(b.player);
            hasher.write_u8(b.state);
            hasher.write_u8(b.order_timer);
            hasher.write_u8(b.weapon_id);
            hasher.write_u8(b.death_timer);
            hasher.write_u8(b.flags);
            hasher.write_u8(b.bounces_remaining);
            hash_target(&mut hasher, &b.target);
            hasher.write_u32(unit_identity(b.parent));
            bullet = b.flingy.next as *const bw::Bullet;
            count += 1;
        }
        hasher.write_usize(count);
        hasher.finish()
    }
}

unsafe fn hash_unit(hasher: &mut fxhash::FxHasher64, unit: &bw::Unit) {
    use std::hash::Hasher;
    unsafe {
        hash_flingy(hasher, &unit.flingy);
        hasher.write_u8(unit.minor_unique_index);
        hasher.write_u16(unit.unit_id);
        hasher.write_u8(unit.player);
        hasher.write_i32(unit.shields);
        hasher.write_u16(unit.energy);
        hasher.write_u32(unit.flags);
        hasher.write_u8(unit.order);
        hasher.write_u8(unit.order_state);
        hasher.write_u8(unit.order_timer);
        hasher.write_u8(unit.secondary_order);
        hasher.write_u8(unit.secondary_order_state);
        hasher.write_u8(unit.ground_cooldown);
        hasher.write_u8(unit.air_cooldown);
        hasher.write_u8(unit.spell_cooldown);
        hasher.write_u16(unit.remaining_build_time);
        for &queued in &unit.build_queue {
            hasher.write_u16(queued);
        }
        hash_target(hasher, &unit.order_target);
        hasher.write_u32(unit_identity(unit.subunit));
    }
}

unsafe fn hash_flingy(hasher: &mut fxhash::FxHasher64, flingy: &bw::Flingy) {
    use std::hash::Hasher;
    unsafe {
        hasher.write_i32(flingy.hitpoints);
        hasher.write_i32(flingy.exact_position.x);
        hasher.write_i32(flingy.exact_position.y);
        hasher.write_i32(flingy.current_speed);
        hasher.write_u8(flingy.facing_direction);
        hasher.write_u8(flingy.movement_direction);
        hash_target(hasher, &flingy.move_target);
    }
}

unsafe fn hash_target(hasher: &mut fxhash::FxHasher64, target: &bw::PointAndUnit) {
    use std::hash::Hasher;
    unsafe {
        hasher.write_i16(target.pos.x);
        hasher.write_i16(target.pos.y);
        hasher.write_u32(unit_identity(target.unit));
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
