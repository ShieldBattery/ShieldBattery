//! Keeps a hotkey's button press from being overtaken by the input that follows it.
//!
//! A hotkey doesn't activate its button right away. SC:R marks the button pressed, so the press
//! shows, and puts it in a table of four with a deadline 20 ms after it handled the key (30 ms on
//! some older builds). Its dialog code activates the buttons whose deadline has passed whenever it
//! dispatches an event, before and after handling it. Input arriving before the deadline is
//! therefore handled first, against whatever the press was about to change: a key meant for the
//! command card a button opens goes to the card still showing (Select Larva then Drone makes no
//! drone), and a click meant for the targeting a button starts lands as an ordinary click. The
//! table also holds only one press per dialog, so another hotkey on the same card is dropped
//! outright while the first one waits.
//!
//! [`DelayedControlActivations::activate_waiting`] activates every waiting press right as a key or
//! mouse button message arrives, before the overlay or SC:R's window procedure sees it, so whatever
//! the press does is in place before anything handles that input. A dialog a press opens is up by
//! then: the game menu's `F10` opens SC:R's own menu, which the overlay replaces, so the next key
//! finds the overlay's menu up and goes to its buttons. A press nothing follows still waits out
//! its deadline, showing pressed for as long as it does on Battle.net.

use std::ffi::c_void;
use std::mem::size_of;

use scr_analysis::scarf;
use winapi::um::winuser::{
    WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_MOUSELAST, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

use super::Value;
use crate::frame_pacing;

/// How many presses SC:R's table holds.
const ENTRY_COUNT: usize = 4;

/// A press waiting in SC:R's table.
#[repr(C)]
struct DelayedControlActivation {
    /// The tick count the button activates after, once `(deadline - now) as i32 < 0`.
    deadline: u32,
    /// The pressed button; null for a free entry.
    control: *mut c_void,
}

const _: () = assert!(size_of::<DelayedControlActivation>() == 2 * size_of::<usize>());

/// SC:R's table of hotkey presses waiting to activate their buttons.
pub struct DelayedControlActivations {
    entries: Value<*mut DelayedControlActivation>,
    /// SC:R's own activation of the presses whose deadline has passed.
    process: unsafe extern "C" fn(),
}

impl DelayedControlActivations {
    pub fn new(
        ctx: scarf::OperandCtx<'static>,
        entries: scarf::Operand<'_>,
        process: unsafe extern "C" fn(),
    ) -> Self {
        DelayedControlActivations {
            entries: Value::new(ctx, entries),
            process,
        }
    }

    /// Activates every waiting press now, through SC:R's own activation, which it would otherwise
    /// run when it next dispatches an event to its dialogs. Called on the window's thread, where
    /// SC:R dispatches them.
    pub unsafe fn activate_waiting(&self) {
        unsafe {
            let entries = self.entries.resolve();
            // SC:R reads the same clock when it checks, no earlier than now.
            let due = frame_pacing::tick_count().wrapping_sub(1);
            let mut any_waiting = false;
            for i in 0..ENTRY_COUNT {
                let entry = entries.add(i);
                if !(*entry).control.is_null() {
                    (*entry).deadline = due;
                    any_waiting = true;
                }
            }
            if any_waiting {
                (self.process)();
            }
        }
    }

    /// The deadline of the first waiting press, if any.
    #[cfg(debug_assertions)]
    pub unsafe fn first_deadline(&self) -> Option<u32> {
        unsafe {
            let entries = self.entries.resolve();
            (0..ENTRY_COUNT)
                .map(|i| entries.add(i))
                .find(|&entry| !(*entry).control.is_null())
                .map(|entry| (*entry).deadline)
        }
    }
}

/// Whether a waiting press has to activate before SC:R handles `msg`: key presses and releases,
/// mouse buttons and the wheel. Mouse moves act on nothing a press changes and arrive constantly.
/// Character messages are left out because each follows the key press it was made from, so counting
/// them would activate a press the moment it's made, without it ever showing.
pub fn activates_waiting_presses(msg: u32) -> bool {
    matches!(msg, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP)
        || (WM_LBUTTONDOWN..=WM_MOUSELAST).contains(&msg)
}
