//! How many fewer of its own turns than the relay's latency buffer a client keeps in flight, in a
//! game that predicts inputs: its lead.
//!
//! The client's turns leave when its pacing against the session clock says
//! ([`crate::rollback::pacing`]), whatever its lead, so they reach every other player at the same
//! time; what the lead moves is which frame the client is simulating when each one leaves. That
//! trade is the client's own: a frame of lead is a frame less input delay and a frame more of other
//! players' turns arriving after it has simulated past them. At least one turn always stays in the
//! pipe (more when the player asked for a minimum input delay), and at most [`MAX_PIPE_TURNS`].
//!
//! The lead the client means to run with is moved by the rollback driver as it measures how late or
//! early other players' turns reach it. The lead in effect, which the pipe follows, drops to a
//! lower lead at once but rises toward a higher one only as the driver takes each frame up
//! ([`Lead::follow`]): each frame of lead gained takes a turn out of the pipe, which the game makes
//! up by stepping a frame sooner, during which none of its turns leave.

use super::MAX_PIPE_TURNS;

/// A client's lead, independent of the latency buffer it applies to: every method takes the
/// buffer in force, which bounds it. See the [module docs](self).
#[derive(Clone, Copy, Debug)]
pub struct Lead {
    /// The lead this client means to run with, before the buffer bounds it.
    intended: i32,
    /// The lead the pipe follows, at most `intended`.
    in_effect: i32,
    /// The fewest of its own turns this client keeps in flight, however little delay its link
    /// needs: 1, or more when the player asked for a minimum input delay.
    min_pipe_turns: u32,
}

impl Lead {
    /// No lead, keeping at least `min_pipe_turns` in the pipe.
    pub const fn new(min_pipe_turns: u32) -> Lead {
        Lead {
            intended: 0,
            in_effect: 0,
            min_pipe_turns,
        }
    }

    /// Sets the lead this client means to run with, leaving the lead in effect to rise to it a
    /// frame at a time.
    pub fn set_intended(&mut self, frames: i32) {
        self.intended = frames;
    }

    /// The lowest and highest lead `buffer` allows: the ones that leave [`MAX_PIPE_TURNS`] and the
    /// fewest turns this client keeps in the pipe.
    fn bounds(&self, buffer: u32) -> (i32, i32) {
        (
            buffer as i32 - MAX_PIPE_TURNS as i32,
            buffer as i32 - self.min_pipe_turns as i32,
        )
    }

    /// The lead in effect over a latency buffer of `buffer` turns.
    pub fn in_effect(&self, buffer: u32) -> i32 {
        let (min, max) = self.bounds(buffer);
        self.in_effect.min(self.intended).clamp(min, max)
    }

    /// How many frames of the lead this client means to run with over `buffer` are not in effect
    /// yet.
    pub fn pending(&self, buffer: u32) -> i32 {
        let (min, max) = self.bounds(buffer);
        self.intended.clamp(min, max) - self.in_effect(buffer)
    }

    /// How many of its own turns the pipe keeps in flight over `buffer` with `lead` in effect: the
    /// buffer less the lead, and never fewer than the player's minimum.
    pub fn pipe_depth(&self, buffer: u32, lead: i32) -> u32 {
        (buffer as i32 - lead).max(self.min_pipe_turns as i32) as u32
    }

    /// Moves the lead this client means to run with by `frames`, within what `buffer` allows, and
    /// returns whether it moved: a lead already at the bound it is pushed toward stays put. A drop
    /// takes effect at once.
    pub fn adjust(&mut self, buffer: u32, frames: i32) -> bool {
        let (min, max) = self.bounds(buffer);
        let before = self.intended.clamp(min, max);
        self.intended = before.saturating_add(frames).clamp(min, max);
        self.in_effect = self.in_effect.min(self.intended);
        self.intended != before
    }

    /// Moves the lead in effect up to `frames` closer to the lead this client means to run with,
    /// and returns how many frames it moved.
    pub fn follow(&mut self, buffer: u32, frames: u32) -> u32 {
        let (min, max) = self.bounds(buffer);
        self.in_effect = self.in_effect.clamp(min, max);
        let taken = self
            .pending(buffer)
            .clamp(0, i32::try_from(frames).unwrap_or(i32::MAX));
        self.in_effect += taken;
        taken as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pipe_stays_between_one_turn_and_the_lockstep_ceiling() {
        let mut lead = Lead::new(1);
        lead.set_intended(3);
        // A rollback target past what the buffer allows still leaves a turn in the pipe.
        assert_eq!(lead.follow(2, 2), 1);
        assert_eq!(lead.in_effect(2), 1);
        assert_eq!(lead.pipe_depth(2, lead.in_effect(2)), 1);
        assert!(lead.adjust(2, -100));
        assert_eq!(lead.in_effect(2), 2 - MAX_PIPE_TURNS as i32);
        assert_eq!(lead.pipe_depth(2, lead.in_effect(2)), MAX_PIPE_TURNS);
        assert!(
            !lead.adjust(2, -1),
            "a lead at its lowest doesn't move lower"
        );
        assert!(lead.adjust(2, 100));
        lead.follow(2, MAX_PIPE_TURNS);
        assert_eq!(lead.in_effect(2), 1);
        assert!(
            !lead.adjust(2, 1),
            "a lead at its highest doesn't move higher"
        );
    }

    #[test]
    fn a_minimum_input_delay_keeps_the_pipe_from_draining_below_it() {
        let mut lead = Lead::new(2);
        lead.set_intended(2);
        assert_eq!(
            lead.pipe_depth(1, lead.in_effect(1)),
            2,
            "a link that needs no delay at all still gets the minimum"
        );
        lead.follow(4, 2);
        assert_eq!(lead.pipe_depth(4, lead.in_effect(4)), 2);
        assert_eq!(
            lead.pending(4),
            0,
            "the rollback target can't take it lower"
        );
        assert_eq!(
            lead.pipe_depth(6, lead.in_effect(6)),
            4,
            "a link that needs more gets more"
        );
    }

    #[test]
    fn a_rise_in_the_lead_takes_effect_only_as_it_is_followed() {
        let mut lead = Lead::new(1);
        lead.set_intended(2);
        let pipe = |lead: &Lead| lead.pipe_depth(6, lead.in_effect(6));
        assert_eq!(
            pipe(&lead),
            6,
            "the whole buffer until the lead takes effect"
        );
        assert_eq!(lead.pending(6), 2);
        assert_eq!(lead.follow(6, 1), 1);
        assert_eq!((pipe(&lead), lead.pending(6)), (5, 1));
        assert_eq!(lead.follow(6, 3), 1, "no further than the rollback target");
        assert_eq!((pipe(&lead), lead.pending(6)), (4, 0));
        // A drop in the lead takes effect at once.
        lead.adjust(6, -3);
        assert_eq!((pipe(&lead), lead.pending(6)), (7, 0));
        lead.adjust(6, 2);
        assert_eq!((pipe(&lead), lead.pending(6)), (7, 2));
        lead.follow(6, 1);
        assert_eq!((pipe(&lead), lead.pending(6)), (6, 1));
    }
}
