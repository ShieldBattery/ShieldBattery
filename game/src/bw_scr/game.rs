//! SC:R-specific code that affects game rules. Bugfixes, improvements, other things that will
//! affect gameplay and very likely require handling replay compatibility.
//!
//! Some similar changes that work same on 1.16.1 are under `crate::game_thread` module. Though
//! arguably it would be clearer to refactor these under `crate::bw::game` or such instead.

use std::ptr::{self, null_mut};
use std::sync::atomic::{Ordering};

use bw_dat::{Unit, OrderId, order};

use crate::bw;
use crate::game_thread;

use super::BwScr;

/// Change order allocation limits to be better what SC:R does.
pub unsafe fn prepare_issue_order(
    bw: &'static BwScr,
    unit: Unit,
    order: OrderId,
    x: i16,
    y: i16,
    target: Option<Unit>,
    fow_unit_id: u16,
    clear_queue: bool,
) {
    if unit.order() == order::DIE {
        return;
    }
    // Delete queued copies of this order, or all orders up to uninterruptable
    // order, if any, when `clear_queue` is set.
    let free_orders = bw.free_orders.resolve();
    let queue = bw::list::LinkedList {
        start: ptr::addr_of_mut!((**unit).order_queue_begin),
        end: ptr::addr_of_mut!((**unit).order_queue_end),
    };
    let mut allocated_order_count = bw.allocated_order_count.resolve();
    while let Some(last_queued) = queue.last() {
        let last_queued_id = OrderId((*last_queued).order_id);
        let delete = last_queued_id == order ||
            (clear_queue && last_queued_id.interruptable());
        if !delete {
            break;
        }
        if last_queued_id.icon() != 0xffff {
            (**unit).highlight_order_count = (**unit).highlight_order_count.wrapping_sub(1);
        }
        queue.remove(last_queued);
        free_orders.add(last_queued);
        allocated_order_count -= 1;
    }
    bw.allocated_order_count.write(allocated_order_count);
    if !can_allocate_order(bw, unit, order) {
        return;
    }
    // Note for people comparing this function with BW's disassembly:
    // The disassembly has checks for if order == CLOAK and logic to requeue
    // current order after cloak order, but this is dead (and broken) code,
    // and not how cloaking works, so it is not replicated here.
    if let Some(alloc) = free_orders.alloc() {
        let new_order = alloc.value();
        (*new_order).order_id = order.0;
        (*new_order).unit_id = fow_unit_id;
        (*new_order).position.x = x;
        (*new_order).position.y = y;
        (*new_order).target = target.map(|x| *x).unwrap_or(null_mut());
        alloc.append_to(&queue);
        if order.icon() != 0xffff {
            (**unit).highlight_order_count = (**unit).highlight_order_count.wrapping_add(1);
        }
        bw.allocated_order_count.write(allocated_order_count + 1);
    } else {
        warn!("Unable to allocate order");
    }
}

unsafe fn can_allocate_order(
    bw: &'static BwScr,
    unit: Unit,
    new_order: OrderId,
) -> bool {
    // There are several different compatibility rules depending on replay version:
    // Also the non-SB rules erroneously check unit's current order instead of new order,
    // causing comparisions against orders be more pointless.
    // The icon highlight check roughly matches user-issueable orders, but not 100%, so
    // we count the order queue size instead.
    //
    // Old: Always can
    // Build 8153: (If the current order is DIE [Never]) OR
    //   (order supply is not low) AND (there are less than 8 orders with icon highlight).
    // Newer SC:R builds(*): If (the current order is DIE or RESET_COLLISION_HARVESTER) OR
    //   ((order supply is not low) AND (there are less than 8 orders with icon highlight)).
    // Even newer SC:R builds (Flying SCV fix): Same as above, but if
    //       the current order is CONSTRUCTING_BUILDING AND
    //       the new order is RESET_COLLISION AND
    //       there are 8 or more icon highlight orders
    //   then skip all other checks and allow queuing
    // ShieldBattery: If (the new order is DIE) OR
    //   ((order queue length is less than 12) AND (order supply is not low) AND
    //      (this call is from process_game_commands)) OR
    //   ((order queue length is less than 20) AND (this call is not from process_game_commands))
    //
    // The ShieldBattery rules are chosen to have bit more space than 10 orders for
    // player-issued orders, as certain orders that seem to be just one from player side
    // will insert additional ones after it becomes the currently active order.
    // And separate limit of 20, that should never be reached, for such orders that the game
    // automatically inserts during gameplay.
    //
    // (*) Multiple separate values in replay can be used to trigger this Newer SC:R build rule.

    let sbat_rules = !game_thread::is_replay() ||
        game_thread::sbat_replay_data().map(|x| x.game_logic_version >= 1).unwrap_or(false);
    let order_supply_low = order_supply_low(bw);
    if sbat_rules {
        if new_order == order::DIE {
            return true;
        }

        let queue = bw::list::LinkedList {
            start: ptr::addr_of_mut!((**unit).order_queue_begin),
            end: ptr::addr_of_mut!((**unit).order_queue_end),
        };
        let queue_length = queue.count_entries();
        if bw.is_processing_game_commands.load(Ordering::Relaxed) {
            return queue_length < 12 && !order_supply_low;
        } else {
            return queue_length < 20;
        }
    }

    if let (Some(bfix), Some(gcfg)) = (bw.replay_bfix, bw.replay_gcfg) {
        let replay_bfix = bfix.resolve();
        let replay_gcfg = gcfg.resolve();
        let newer_scr_rules = (*replay_bfix).flags & 0x4 != 0 ||
            (*replay_gcfg).unk10 != 5 ||
            (*replay_gcfg).build > 8153;
        let blizz_flying_scv_fix  = (*replay_gcfg).build >= 9713;

        let highlight_orders = (**unit).highlight_order_count;
        if blizz_flying_scv_fix &&
            highlight_orders >= 8 &&
            unit.order() == order::CONSTRUCTING_BUILDING &&
            new_order == order::RESET_COLLISION
        {
            return true;
        }
        if newer_scr_rules {
            return (!order_supply_low && highlight_orders < 8) ||
                matches!(unit.order(), order::DIE | order::RESET_COLLISION_HARVESTER);
        }
        if (*replay_gcfg).build == 8153 {
            return (!order_supply_low && highlight_orders < 8) || unit.order() == order::DIE;
        }
    }

    true
}

unsafe fn order_supply_low(bw: &BwScr) -> bool {
    is_low_order_supply(bw.allocated_order_count.resolve(), bw.order_limit.resolve())
}

fn is_low_order_supply(allocated: u32, limit: u32) -> bool {
    allocated >= (limit as f32 * 0.9) as u32
}

#[test]
fn test_is_low_order_supply() {
    // Verified that the original exe considers these values
    // to be false-true boundary for these limits.
    assert!(is_low_order_supply(1799, 2000) == false);
    assert!(is_low_order_supply(1800, 2000) == true);
    assert!(is_low_order_supply(3599, 4000) == false);
    assert!(is_low_order_supply(3600, 4000) == true);
    assert!(is_low_order_supply(8999, 10000) == false);
    assert!(is_low_order_supply(9000, 10000) == true);
}
