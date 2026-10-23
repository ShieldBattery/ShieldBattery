//! The replay visions the viewer chose, kept through SC:R starting a replay over.
//!
//! Which players' vision a replay shows lives in two SC:R globals, `replay_visions` and
//! `local_visions`, and SC:R changes them on its own in two ways: it turns every vision back on
//! when it starts a replay over for a seek, and it takes a player's vision away when they leave.
//! The globals alone can't tell either change from the viewer's own, so the viewer's choice is kept
//! here as the visions they turned off, and given back once a replay that started over steps again.
//! That is before it plays or fast-forwards anywhere, so a player who left after the seek's target
//! is back in the game there with their vision, and loses it again as the replay reaches their
//! leave.

use super::BwScr;

/// The visions the viewer turned off, and whether a replay that started over still needs them back.
pub struct ReplayVisionChoice {
    /// The players whose vision the viewer turned off, a bit per player: on the Vision panel, or
    /// through the overlay's guess at the replay's start that they only watch.
    off: u8,
    /// Whether the replay is starting over for a seek and still has to be given the choice back.
    restore_after_restart: bool,
}

impl ReplayVisionChoice {
    pub fn new() -> Self {
        Self {
            off: 0,
            restore_after_restart: false,
        }
    }

    /// The viewer changed the visions shown from `shown` to `chosen`.
    fn note_change(&mut self, shown: u8, chosen: u8) {
        self.off = (self.off | (shown & !chosen)) & !(chosen & !shown);
    }

    /// A seek is starting the replay over.
    fn note_restart(&mut self) {
        self.restore_after_restart = true;
    }

    /// The visions a replay that started over has to show, once, given the ones SC:R reset it to.
    fn take_restore(&mut self, reset: u8) -> Option<u8> {
        std::mem::take(&mut self.restore_after_restart).then_some(reset & !self.off)
    }
}

impl BwScr {
    /// Notes the viewer changing the replay visions from `shown` to `chosen`, before they're
    /// written.
    pub fn note_replay_vision_choice(&self, shown: u8, chosen: u8) {
        self.replay_vision_choice.lock().note_change(shown, chosen);
    }

    /// Tells the vision choice a live seek is starting the replay over, which SC:R does for every
    /// seek back that keyframe seeking leaves to it.
    pub fn note_replay_vision_restart(&self) {
        self.replay_vision_choice.lock().note_restart();
    }

    /// Gives a replay that started over for a seek the visions the viewer chose, which SC:R turned
    /// back on. Call on the restarted game's first logic step, before it plays or fast-forwards
    /// anywhere: the remembered buildings the fast-forward leaves are then those visions' own.
    pub unsafe fn restore_replay_visions(&self) {
        unsafe {
            let reset = self.replay_visions.resolve();
            let Some(players) = self.replay_vision_choice.lock().take_restore(reset) else {
                return;
            };
            debug!(
                "Replay started over with visions {reset:#04x}, giving back the chosen {players:#04x}"
            );
            self.replay_visions.write(players);
            self.local_visions.write(players);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_restart_gets_every_vision_but_the_ones_turned_off_once() {
        let mut choice = ReplayVisionChoice::new();
        choice.note_change(0xff, 0xfe);
        assert_eq!(
            choice.take_restore(0xff),
            None,
            "nothing to give back without a restart"
        );
        choice.note_restart();
        assert_eq!(choice.take_restore(0xff), Some(0xfe));
        assert_eq!(choice.take_restore(0xff), None, "given back once");
    }

    #[test]
    fn a_vision_turned_back_on_is_not_turned_off_by_a_restart() {
        let mut choice = ReplayVisionChoice::new();
        choice.note_change(0xff, 0xfc);
        choice.note_change(0xfc, 0xfd);
        choice.note_restart();
        assert_eq!(choice.take_restore(0xff), Some(0xfd));
    }

    #[test]
    fn a_vision_sc_r_took_away_for_a_leave_comes_back() {
        let mut choice = ReplayVisionChoice::new();
        choice.note_change(0xff, 0xfe);
        // The other player leaves, and SC:R takes their vision away (0xfe to 0xfc) on its own.
        choice.note_restart();
        assert_eq!(choice.take_restore(0xff), Some(0xfe));
    }

    #[test]
    fn a_vision_turned_on_after_sc_r_took_it_away_stays_on() {
        let mut choice = ReplayVisionChoice::new();
        // SC:R took the second player's vision away (0xff to 0xfd) as they left, and the viewer
        // turns it back on.
        choice.note_change(0xfd, 0xff);
        choice.note_restart();
        assert_eq!(choice.take_restore(0xff), Some(0xff));
    }
}
