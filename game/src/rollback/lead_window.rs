//! How a live game that rolls back decides its lead: the rollback target in force at each step
//! ([`rollback_target_at`]), and the window of rollback measured against it ([`LeadWindow`]).

/// How many frames of the prediction limit a game's opening leaves past its rollback target. Nobody
/// sees another player's units in the opening of a melee game, so corrections there go unseen and
/// the opening takes as much lateness as it can by rolling back, for the least input delay, but
/// still predicts through a peer's hitch of about an eighth of a second rather than stalling.
const OPENING_HEADROOM: u32 = 3;

/// How many steps a game's opening runs at its rollback target: fifteen seconds.
pub const OPENING_STEPS: u32 = 360;

/// How many ticks the client watches the rollback it runs before deciding whether to move its
/// lead: two seconds. A burst of lateness shorter than a tenth of that is rolled back over, up to
/// the prediction limit, and the lead only follows lateness that holds.
pub const LEAD_WINDOW_TICKS: usize = 48;

/// The most frames one window moves the lead down by. A drop takes effect at once, the game
/// putting its next steps off a frame a tick (frames the player sees repeat), and a window can run
/// at the prediction limit for no longer than one peer's link takes to fade for a couple of
/// seconds: following its whole excess would pile on as much input delay as the limit allows, just
/// as the fade ends, and a rise takes it back off only once a whole window has run without it, and
/// then a frame at a time. Lateness that holds keeps moving the lead down, window after window.
pub const MAX_LEAD_DROP: i32 = 2;

/// The rollback target in force at a step, and how it came about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RollbackTarget {
    /// The frames of rollback the lead aims at.
    pub frames: u32,
    /// The target the player chose, which `frames` is never below.
    pub chosen: u32,
    /// Whether the game's opening is over and its target has come or is coming down from it.
    pub after_opening: bool,
}

impl RollbackTarget {
    /// How many frames of rollback past the player's own target this one deliberately runs.
    pub fn extra(&self) -> u32 {
        self.frames - self.chosen
    }
}

/// The rollback target at `step`, for a player who chose `chosen` in a game whose prediction limit
/// is `limit`: in a game with an opening, [`OPENING_HEADROOM`] short of the limit through the
/// opening, then a frame lower each lead window until it is back at `chosen`, so the lead gives
/// each frame of rollback back as input delay one at a time (each is a frame the player sees
/// repeat) rather than in the bigger drops lateness can make.
pub fn rollback_target_at(step: u32, chosen: u32, limit: u32, opening: bool) -> RollbackTarget {
    if !opening {
        return RollbackTarget {
            frames: chosen,
            chosen,
            after_opening: false,
        };
    }
    let opening_target = limit.saturating_sub(OPENING_HEADROOM);
    let (target, after_opening) = match step.checked_sub(OPENING_STEPS) {
        None => (opening_target, false),
        Some(after) => {
            let given_back = after / LEAD_WINDOW_TICKS as u32 + 1;
            (opening_target.saturating_sub(given_back), true)
        }
    };
    RollbackTarget {
        frames: target.max(chosen),
        chosen,
        after_opening,
    }
}

/// What a whole window of rollback decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowVerdict {
    /// How far to move the lead (negative is more input delay).
    pub adjustment: i32,
    /// The window's median and 90th percentile rollback.
    pub median: i32,
    pub p90: i32,
    /// Whether the lead was coming down from the opening, a frame a window at most.
    pub ramp: bool,
}

/// The rollback the ticks since the lead last moved ran with.
pub struct LeadWindow {
    rollbacks: [i32; LEAD_WINDOW_TICKS],
    ticks: usize,
    /// The newest step whose turns were all known as of the last tick noted.
    known_until: u32,
    /// The most rollback any tick ran with since more turns last became known.
    worst_since_known: i32,
    /// Whether the lead has come down from the opening with its target: a window back at the
    /// player's own target found no excess left to drop.
    ramp_done: bool,
}

impl LeadWindow {
    pub const fn new() -> LeadWindow {
        LeadWindow {
            rollbacks: [0; LEAD_WINDOW_TICKS],
            ticks: 0,
            known_until: 0,
            worst_since_known: i32::MIN,
            ramp_done: false,
        }
    }

    /// Notes the rollback a tick ran with, having reached frame `reached` with `known_until` the
    /// newest step whose turns were all known, under the rollback target `target`, and returns the
    /// verdict once a whole window is in.
    ///
    /// The rollback noted is signed: below 0, the turns of frames the client hasn't reached yet
    /// were already in, and that many more frames of lead would still have run without rolling
    /// back. It counts the `to_follow` frames of lead the client has chosen but not taken up yet
    /// as already in effect, since they will spend that much of any such headroom: a rise bigger
    /// than a window can take up would otherwise be made again by the next window.
    ///
    /// The target is the rollback the client means to run steadily, and the frame past it is
    /// insurance against small delays: corrections stay hard to see up to a frame past the target,
    /// and only become visible beyond it. So the lead moves down (more input delay) once the
    /// window's median is past the target, or more than a tenth of its ticks ran past the
    /// insurance frame, by whichever excess is larger but at most [`MAX_LEAD_DROP`] frames (one
    /// while the lead comes down from the opening with its target); and it moves
    /// up once even its 90th percentile is short of the target, by that shortfall, which at a
    /// target of 0 only headroom shows. Moving the lead by a frame moves the whole distribution by
    /// a frame, so one move never leads straight to the opposite one.
    ///
    /// The window takes one sample each time more turns become known: the most rollback any tick
    /// ran with since the last time. The lead follows how late turns arrive, and while none arrive
    /// at all (a peer that stopped sending, or a lost link) the rollback just sits at the
    /// prediction limit, which says nothing about lateness: a sample for every such tick would
    /// pile input delay on for when turns resume. Turns that arrive several at a time leave the
    /// least rollback on the tick they arrive by and more on every tick until the next ones, and
    /// those later ticks are the ones the lead has to cover. Once no turn is left to arrive, none
    /// is late or early either.
    ///
    /// Coming down from the opening, each frame of rollback given back as input delay is a frame
    /// the player sees repeat. A lead that couldn't rise as far as the opening target allowed (its
    /// pipe at the floor) runs less rollback than the target until the target comes down past it,
    /// and by then the target can have come down by more than a frame since the window before,
    /// most of all when turns arriving several at a time make a window outlast the target's steps.
    /// So until a window back at the player's own target finds nothing more to drop, the lead
    /// comes down by a frame a window at most, whatever the excess.
    pub fn note(
        &mut self,
        reached: u32,
        known_until: u32,
        to_follow: i32,
        target: RollbackTarget,
    ) -> Option<WindowVerdict> {
        let rollback = i64::from(reached) - i64::from(known_until) + i64::from(to_follow);
        let rollback = rollback.clamp(i32::MIN.into(), i32::MAX.into()) as i32;
        self.worst_since_known = self.worst_since_known.max(rollback);
        if known_until == u32::MAX || known_until <= self.known_until {
            return None;
        }
        self.known_until = known_until;
        self.rollbacks[self.ticks] = std::mem::replace(&mut self.worst_since_known, i32::MIN);
        self.ticks += 1;
        if self.ticks < LEAD_WINDOW_TICKS {
            return None;
        }
        self.ticks = 0;
        self.rollbacks.sort_unstable();
        let median = self.rollbacks[LEAD_WINDOW_TICKS / 2];
        let p90 = self.rollbacks[(LEAD_WINDOW_TICKS * 9).div_ceil(10) - 1];
        let coming_down = target.after_opening && !self.ramp_done;
        let max_drop = match coming_down {
            true => 1,
            false => MAX_LEAD_DROP,
        };
        let frames = target.frames as i32;
        let excess = median
            .saturating_sub(frames)
            .max(p90.saturating_sub(frames + 1));
        let adjustment = if excess > 0 {
            -excess.min(max_drop)
        } else {
            frames.saturating_sub(p90).max(0)
        };
        if coming_down && target.frames == target.chosen && adjustment >= 0 {
            self.ramp_done = true;
        }
        Some(WindowVerdict {
            adjustment,
            median,
            p90,
            ramp: coming_down,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_opening_target_holds_then_gives_a_frame_back_each_lead_window() {
        let window = LEAD_WINDOW_TICKS as u32;
        let at = |step, chosen| rollback_target_at(step, chosen, 8, true).frames;
        assert_eq!(
            rollback_target_at(0, 2, 8, false).frames,
            2,
            "a game without an opening"
        );
        assert_eq!(at(0, 2), 5);
        assert_eq!(at(OPENING_STEPS - 1, 2), 5);
        assert_eq!(at(OPENING_STEPS, 2), 4);
        assert_eq!(at(OPENING_STEPS + window - 1, 2), 4);
        assert_eq!(at(OPENING_STEPS + window, 2), 3);
        assert_eq!(at(OPENING_STEPS + 50 * window, 2), 2);
        assert_eq!(
            at(OPENING_STEPS + window, 4),
            4,
            "never below the player's own target"
        );
        assert_eq!(
            rollback_target_at(0, 2, 3, true).frames,
            2,
            "a limit with no room for the headroom leaves the player's own target"
        );

        // A client whose pipe sat at its floor through the opening, running 4 frames of rollback
        // with the 90th percentile at 5. As the target steps 5, 4, 3, 2, it gives a frame back a
        // window at a time, never two at once, even when a window outlasts two of the target's
        // steps and finds it back at the player's own.
        let mut lead_window = LeadWindow::new();
        let mut lead = 0;
        let mut known_until = 1000_u32;
        let mut verdicts = Vec::new();
        for step in [
            OPENING_STEPS - 10,
            OPENING_STEPS + 10,
            OPENING_STEPS + 2 * window + 10,
            OPENING_STEPS + 3 * window + 10,
            OPENING_STEPS + 4 * window + 10,
        ] {
            let target = rollback_target_at(step, 2, 8, true);
            let mut verdict = None;
            for tick in 0..LEAD_WINDOW_TICKS {
                known_until += 1;
                // A frame more of input delay is a frame less rollback, on every tick.
                let rollback = if tick % 10 == 0 { 5 } else { 4 } + lead;
                let reached = known_until.checked_add_signed(rollback).unwrap();
                verdict = lead_window.note(reached, known_until, 0, target);
            }
            let verdict = verdict.unwrap();
            // The pipe is at its floor: the lead can't rise.
            lead += verdict.adjustment.min(0);
            verdicts.push((target.frames, verdict.adjustment, verdict.ramp));
        }
        assert_eq!(
            verdicts,
            [
                (5, 0, false),
                (4, 0, true),
                (2, -1, true),
                (2, -1, true),
                (2, 0, true),
            ]
        );
        // Back at the player's own target, lateness moves the lead as far as ever.
        let target = rollback_target_at(OPENING_STEPS + 5 * window, 2, 8, true);
        let mut verdict = None;
        for _ in 0..LEAD_WINDOW_TICKS {
            known_until += 1;
            verdict = lead_window.note(known_until + 6, known_until, 0, target);
        }
        assert_eq!(verdict.unwrap().adjustment, -MAX_LEAD_DROP);
    }

    /// Notes a tick under the usual drop cap.
    fn note(
        window: &mut LeadWindow,
        reached: u32,
        known_until: u32,
        to_follow: i32,
        target: u32,
    ) -> i32 {
        let target = RollbackTarget {
            frames: target,
            chosen: target,
            after_opening: false,
        };
        window
            .note(reached, known_until, to_follow, target)
            .map_or(0, |x| x.adjustment)
    }

    /// Feeds a fresh window a whole window of ticks running the given rollbacks in turn, and
    /// returns the lead move it ends with.
    fn window(target: u32, rollbacks: impl Fn(usize) -> i32) -> i32 {
        feed(&mut LeadWindow::new(), target, 0, rollbacks)
    }

    /// Feeds `window` a whole window of ticks running the given rollbacks in turn, each with
    /// `to_follow` frames of lead not in effect yet, and returns the lead move it ends with.
    fn feed(
        window: &mut LeadWindow,
        target: u32,
        to_follow: i32,
        rollbacks: impl Fn(usize) -> i32,
    ) -> i32 {
        let mut adjustment = 0;
        for tick in 0..LEAD_WINDOW_TICKS {
            let known_until = window.known_until.max(100) + 1;
            let reached = known_until.checked_add_signed(rollbacks(tick)).unwrap();
            adjustment = note(window, reached, known_until, to_follow, target);
        }
        adjustment
    }

    #[test]
    fn rollback_around_the_target_holds_the_lead() {
        assert_eq!(window(2, |tick| 1 + (tick % 3) as i32), 0);
        assert_eq!(window(2, |_| 2), 0);
        // The insurance frame past the target, now and then.
        assert_eq!(window(2, |tick| if tick % 5 == 0 { 3 } else { 2 }), 0);
    }

    #[test]
    fn rollback_past_the_target_most_of_the_time_adds_delay() {
        // Mostly a frame past the target, so its median is, though some ticks dip under it.
        assert_eq!(window(2, |tick| if tick % 4 == 0 { 1 } else { 3 }), -1);
    }

    #[test]
    fn rollback_often_past_the_insurance_frame_adds_delay() {
        // The median sits on the target, but more than a tenth of the ticks run at 5.
        assert_eq!(window(2, |tick| if tick % 6 == 0 { 5 } else { 2 }), -2);
    }

    #[test]
    fn a_window_at_the_prediction_limit_moves_the_lead_down_a_little_at_a_time() {
        assert_eq!(window(2, |_| 8), -MAX_LEAD_DROP);
        assert_eq!(window(2, |tick| if tick % 2 == 0 { 8 } else { 6 }), -2);
    }

    #[test]
    fn a_short_burst_is_rolled_back_over() {
        assert_eq!(window(2, |tick| if tick < 4 { 7 } else { 2 }), 0);
    }

    #[test]
    fn rollback_short_of_the_target_even_in_bursts_takes_delay_off() {
        assert_eq!(window(2, |tick| (tick % 2) as i32), 1);
        assert_eq!(window(3, |_| 0), 3);
    }

    #[test]
    fn headroom_takes_delay_off_even_at_a_target_of_0() {
        assert_eq!(window(0, |_| -3), 3);
        // The ticks with the least headroom are what the lead stops short of.
        assert_eq!(window(0, |tick| if tick % 2 == 0 { -1 } else { -4 }), 1);
        assert_eq!(window(0, |_| 0), 0);
        assert_eq!(window(2, |_| -3), 5);
    }

    #[test]
    fn delay_a_burst_added_at_a_target_of_0_comes_back_off() {
        let mut lead_window = LeadWindow::new();
        assert_eq!(feed(&mut lead_window, 0, 0, |_| 8), -MAX_LEAD_DROP);
        // The burst is over, and turns arrive as early as they did before it.
        assert_eq!(
            feed(&mut lead_window, 0, 0, |_| -MAX_LEAD_DROP),
            MAX_LEAD_DROP
        );
    }

    /// Feeds a fresh window ticks of a game whose turns arrive four at a time, every fourth tick,
    /// until a whole window is in, running `arrival_rollback` past them on the tick they arrive by
    /// and a frame further each tick until the next ones, and returns the lead move it ends with.
    fn batched_window(target: u32, arrival_rollback: i32) -> i32 {
        let mut window = LeadWindow::new();
        let mut adjustment = 0;
        for tick in 0..LEAD_WINDOW_TICKS as u32 * 4 {
            let known_until = 100 + tick / 4 * 4;
            let reached = known_until.checked_add_signed(arrival_rollback).unwrap() + tick % 4;
            adjustment += note(&mut window, reached, known_until, 0, target);
        }
        adjustment
    }

    #[test]
    fn turns_arriving_several_at_a_time_are_measured_by_the_ticks_between() {
        // Short of the turns on every tick, though only just by the last one before more arrive.
        assert_eq!(batched_window(0, -3), 0);
        // Rolling back on every tick but the ones turns arrive by.
        assert_eq!(batched_window(0, 0), -MAX_LEAD_DROP);
        assert_eq!(batched_window(2, -1), 0);
        assert_eq!(batched_window(2, -3), 2);
    }

    #[test]
    fn a_target_of_0_settles_where_batched_turns_are_never_predicted() {
        // Turns arrive four at a time, every fourth tick, the first of them ten frames ahead of a
        // client with no lead. A rise takes a frame effect every eleven ticks, as the frame
        // schedule's slew takes it up.
        let mut lead_window = LeadWindow::new();
        let (mut lead, mut in_effect) = (0, 0);
        for tick in 0..LEAD_WINDOW_TICKS as u32 * 4 * 10 {
            let known_until = 110 + tick / 4 * 4;
            let reached = (100 + tick as i32 + in_effect) as u32;
            lead += note(&mut lead_window, reached, known_until, lead - in_effect, 0);
            in_effect = in_effect.min(lead);
            if tick % 11 == 0 && in_effect < lead {
                in_effect += 1;
            }
        }
        // Seven frames of lead leave the tick before each arrival exactly on the newest known
        // step, and any more would roll back.
        assert_eq!((lead, in_effect), (7, 7));
    }

    #[test]
    fn a_rise_not_in_effect_yet_is_not_made_again() {
        let mut lead_window = LeadWindow::new();
        assert_eq!(feed(&mut lead_window, 0, 3, |_| -3), 0);
        assert_eq!(feed(&mut lead_window, 0, 3, |_| -5), 2);
    }

    #[test]
    fn ticks_without_new_turns_say_nothing() {
        let mut window = LeadWindow::new();
        for _ in 0..LEAD_WINDOW_TICKS * 2 {
            assert_eq!(note(&mut window, 9, 1, 0, 2), 0);
        }
    }

    #[test]
    fn ticks_once_no_turn_is_left_to_arrive_say_nothing() {
        let mut window = LeadWindow::new();
        for reached in 0..LEAD_WINDOW_TICKS as u32 * 2 {
            assert_eq!(note(&mut window, reached, u32::MAX, 0, 0), 0);
        }
    }
}
