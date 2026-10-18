//! Holds BW's tick-gated client-side work to the rate it runs at on Battle.net.
//!
//! BW runs screen scrolling, palette cycling and software cursor animation once enough
//! `GetTickCount` time has passed since they last ran, and each run moves things by a fixed amount.
//! Windows' `GetTickCount` only advances once per system timer interrupt, every 15.625 ms, so those
//! speeds were tuned against that granularity. Our `GetTickCount` hook serves a 1 ms clock (see
//! [`crate::frame_pacing::tick_count`]), which lets the gates pass sooner: screen scrolling would run
//! up to ~90 times a second at high frame rates instead of 64. The hooks using this module let each
//! run only when a native tick would have.

use std::time::Duration;

use parking_lot::Mutex;

use super::{Value, VirtualAddress, hooks};
use crate::frame_pacing;

/// How often Windows' `GetTickCount` advances, in microseconds.
const NATIVE_TICK_US: u64 = 15_625;

/// How long BW shows each frame of an animated software cursor, in milliseconds.
const CURSOR_FRAME_MS: u32 = 100;

/// BW's screen scrolling runs once `(u32)(now - last_run) > 10`.
static SCREEN_SCROLLING: NativeTickGate = NativeTickGate::new(11);
/// BW's palette cycling runs once `(u32)(now - last_run) >= 10`.
static PALETTE_CYCLING: NativeTickGate = NativeTickGate::new(10);

/// BW's tick-gated work, each `None` where the analysis can't place it, which leaves that work
/// running at our clock's rate.
pub struct TickGatedWork {
    /// `update_screen_scrolling`, and the tick its gate last passed at, stored negated.
    pub screen_scrolling: Option<(VirtualAddress, Value<u32>)>,
    /// `update_palette_cycles`, and the tick its gate last passed at.
    pub palette_cycling: Option<(VirtualAddress, Value<u32>)>,
    pub cursor_animation: Option<CursorAnimation>,
}

/// The two functions that advance the software cursor's animation, in game and in menus, and the
/// tick they move to its next frame at (signed: once `now - next_frame_tick >= 0`).
pub struct CursorAnimation {
    pub update_game_cursor: VirtualAddress,
    pub step_menu_cursor_animation: VirtualAddress,
    pub next_frame_tick: Value<u32>,
}

pub fn apply_tick_gate_hooks(
    work: &TickGatedWork,
    exe: &mut whack::ModulePatcher<'_>,
    base: usize,
) {
    unsafe {
        if let Some((function, negated_last_run)) = work.screen_scrolling {
            exe.hook_closure_address(
                hooks::UpdateScreenScrolling,
                move |orig| {
                    // BW calls this once `(u32)(now + negated_last_run) > 10`, having just stored
                    // `-now`. Storing `11 - now` instead keeps that true for every later tick, so
                    // when scrolling runs is decided here.
                    let tick = 0u32.wrapping_sub(negated_last_run.resolve());
                    negated_last_run.write(11u32.wrapping_sub(tick));
                    if SCREEN_SCROLLING.passes(frame_pacing::tick_clock_elapsed()) {
                        frame_pacing::note_scroll_run();
                        orig();
                    }
                },
                function.0 as usize - base,
            );
        }
        if let Some((function, last_run)) = work.palette_cycling {
            exe.hook_closure_address(
                hooks::UpdatePaletteCycles,
                move |orig| {
                    // BW calls this once `(u32)(now - last_run) >= 10`, having just stored `now`.
                    // Storing `now - 10` instead keeps that true for every later tick, so when the
                    // palette cycles is decided here.
                    let tick = last_run.resolve();
                    last_run.write(tick.wrapping_sub(10));
                    if PALETTE_CYCLING.passes(frame_pacing::tick_clock_elapsed()) {
                        orig();
                    }
                },
                function.0 as usize - base,
            );
        }
        if let Some(cursor) = &work.cursor_animation {
            let next_frame_tick = cursor.next_frame_tick;
            let step_animation = move |orig: unsafe extern "C" fn()| {
                let before = next_frame_tick.resolve();
                orig();
                let after = next_frame_tick.resolve();
                if after != before {
                    // BW moved to the next frame and scheduled the one after it
                    // `CURSOR_FRAME_MS` past the tick it moved at.
                    let tick = after.wrapping_sub(CURSOR_FRAME_MS);
                    next_frame_tick.write(native_deadline(tick, CURSOR_FRAME_MS));
                }
            };
            exe.hook_closure_address(
                hooks::UpdateGameCursor,
                step_animation,
                cursor.update_game_cursor.0 as usize - base,
            );
            exe.hook_closure_address(
                hooks::StepMenuCursorAnimation,
                step_animation,
                cursor.step_menu_cursor_animation.0 as usize - base,
            );
        }
    }
}

/// How many native ticks have to pass for a native `GetTickCount` to read at least `min_elapsed`
/// milliseconds later.
fn native_ticks_for(min_elapsed: u32) -> u64 {
    (u64::from(min_elapsed) * 1000).div_ceil(NATIVE_TICK_US)
}

/// The tick at which a native `GetTickCount`, read at `tick`, would first read at least
/// `min_elapsed` milliseconds later.
///
/// Only millisecond precise, as BW's own comparison against the result is: a native tick counts
/// as having advanced once `tick` reaches the millisecond it advances in.
pub fn native_deadline(tick: u32, min_elapsed: u32) -> u32 {
    let native_ticks = ((u64::from(tick) + 1) * 1000 - 1) / NATIVE_TICK_US;
    ((native_ticks + native_ticks_for(min_elapsed)) * NATIVE_TICK_US / 1000) as u32
}

/// Decides when gated work runs for a BW gate that compares an unsigned `now - last_run`.
///
/// Pushing such a gate's stored tick later would wrap the difference on the next check and pass
/// it immediately, so the gate's hook instead keeps BW's comparison passing and asks this whether
/// the work runs.
pub struct NativeTickGate {
    /// How many milliseconds BW's gate requires between runs.
    min_elapsed: u32,
    /// The native tick, counted from the start of our tick clock, that the next run waits for.
    next_run: Mutex<Option<u64>>,
}

impl NativeTickGate {
    pub const fn new(min_elapsed: u32) -> NativeTickGate {
        NativeTickGate {
            min_elapsed,
            next_run: Mutex::new(None),
        }
    }

    /// Whether the work runs for a check `elapsed` into our tick clock. Takes the clock with more
    /// precision than its milliseconds so that frames landing just either side of a native tick
    /// are told apart.
    pub fn passes(&self, elapsed: Duration) -> bool {
        let native_ticks = elapsed.as_micros() as u64 / NATIVE_TICK_US;
        let mut next_run = self.next_run.lock();
        if next_run.is_some_and(|next| native_ticks < next) {
            return false;
        }
        *next_run = Some(native_ticks + native_ticks_for(self.min_elapsed));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a native `GetTickCount` reads `us` microseconds in: the clock as of its last 15.625 ms
    /// interrupt.
    fn native_tick(us: u64) -> u32 {
        (us / NATIVE_TICK_US * NATIVE_TICK_US / 1000) as u32
    }

    /// Runs BW's screen scroll gate (`(u32)(now - last) > 10`) for frames `frame_us` apart over
    /// ten seconds starting at `start_us`, returning when scrolling ran.
    fn scroll_runs(frame_us: u64, start_us: u64, native: bool) -> Vec<u64> {
        let gate = NativeTickGate::new(11);
        // Due in the first frame, as the gate is.
        let mut last = native_tick(start_us).wrapping_sub(11);
        let mut runs = Vec::new();
        let mut us = start_us;
        while us < start_us + 10_000_000 {
            let now = if native {
                native_tick(us)
            } else {
                (us / 1000) as u32
            };
            if now.wrapping_sub(last) > 10 {
                if native {
                    last = now;
                    runs.push(us);
                } else {
                    // The hook: hold BW's gate open, then decide here.
                    last = now.wrapping_sub(11);
                    if gate.passes(Duration::from_micros(us)) {
                        runs.push(us);
                    }
                }
            }
            us += frame_us;
        }
        runs
    }

    #[test]
    fn deadlines_land_on_native_tick_boundaries() {
        assert_eq!(native_deadline(0, 11), 15);
        assert_eq!(native_deadline(14, 11), 15);
        // The tick advances 15.625 ms in, during millisecond 15.
        assert_eq!(native_deadline(15, 11), 31);
        assert_eq!(native_deadline(30, 10), 31);
        assert_eq!(native_deadline(31, 10), 46);
        // 6 native ticks are 93.75 ms, so a 100 ms wait takes 7.
        assert_eq!(native_deadline(0, 100), 109);
        assert_eq!(native_deadline(20, 100), 125);
    }

    #[test]
    fn deadlines_wrap_with_the_tick_count() {
        let deadline = native_deadline(u32::MAX - 2, 11);
        assert!(deadline < 20);
    }

    #[test]
    fn scrolling_runs_in_the_frames_it_does_natively() {
        for fps in [30, 60, 64, 100, 120, 128, 144, 165, 240, 300, 500, 1000] {
            let frame_us = 1_000_000 / fps;
            for start_us in [0, 3_300, 7_812, 15_000, 15_624] {
                assert_eq!(
                    scroll_runs(frame_us, start_us, false),
                    scroll_runs(frame_us, start_us, true),
                    "{fps} fps from {start_us} us",
                );
            }
        }
    }

    #[test]
    fn scrolling_runs_once_per_native_tick_at_high_frame_rates() {
        assert_eq!(scroll_runs(1_000, 0, false).len(), 640);
        assert_eq!(scroll_runs(4_167, 0, false).len(), 640);
    }

    #[test]
    fn gate_holds_until_the_next_native_tick() {
        let gate = NativeTickGate::new(10);
        assert!(gate.passes(Duration::from_micros(100_000)));
        assert!(!gate.passes(Duration::from_micros(101_000)));
        assert!(!gate.passes(Duration::from_micros(109_374)));
        assert!(gate.passes(Duration::from_micros(109_375)));
        assert!(!gate.passes(Duration::from_micros(110_000)));
    }
}
