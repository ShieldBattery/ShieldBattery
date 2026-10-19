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
//! [`DelayedControlActivations::make_due`] marks every waiting press as due right before SC:R's
//! window procedure gets a key or mouse button message, so the press activates as SC:R starts
//! handling that input, ahead of it. A press nothing follows still waits out its deadline, showing
//! pressed for as long as it does on Battle.net.

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
}

impl DelayedControlActivations {
    pub fn new(ctx: scarf::OperandCtx<'static>, entries: scarf::Operand<'_>) -> Self {
        DelayedControlActivations {
            entries: Value::new(ctx, entries),
        }
    }

    /// Makes every waiting press due, so SC:R activates it at the start of the next event it
    /// dispatches.
    pub unsafe fn make_due(&self) {
        unsafe {
            let entries = self.entries.resolve();
            // SC:R reads the same clock when it checks, no earlier than now.
            let due = frame_pacing::tick_count().wrapping_sub(1);
            for i in 0..ENTRY_COUNT {
                let entry = entries.add(i);
                if !(*entry).control.is_null() {
                    (*entry).deadline = due;
                }
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
