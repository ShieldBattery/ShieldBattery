//! The replay visions the viewer chose, kept through SC:R starting a replay over and through
//! keyframe restores.
//!
//! Which players' vision a replay shows lives in SC:R globals, `replay_visions` and
//! `local_visions` with `minimap_tile_vision_mask` kept in step with them, and SC:R changes them
//! on its own in two ways: it turns every vision back on
//! when it starts a replay over for a seek, and it takes a player's vision away when they leave.
//! The globals alone can't tell either change from the viewer's own, so the viewer's choice is kept
//! here as the visions they turned off, and given back once a replay that started over steps again.
//! That is before it plays or fast-forwards anywhere, so a player who left after the seek's target
//! is back in the game there with their vision, and loses it again as the replay reaches their
//! leave.
//!
//! The globals are outside the keyframes a replay seeks back and forth with, so restoring one
//! leaves them as they were at the frame the seek started from. A restore sets them the way a
//! replay that started over would have them at the restored frame: every player who hasn't left by
//! then, which SC:R marks on the player's slot type as it takes their vision away, less the visions
//! the viewer turned off.

use crate::bw::Bw;
use crate::game_thread;

use super::BwScr;

/// The slot types SC:R gives a human and a computer player as they leave or are defeated, when it
/// also takes their replay vision away.
const LEFT_PLAYER_TYPES: [u8; 2] = [10, 11];

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
        std::mem::take(&mut self.restore_after_restart).then(|| self.shown_of(reset))
    }

    /// The visions to show out of `available`, the ones SC:R would show without the viewer.
    fn shown_of(&self, available: u8) -> u8 {
        available & !self.off
    }
}

/// The players in a replay that SC:R gives vision to when it is started over, a bit per player,
/// less the ones that have left, given each player's slot type.
fn players_not_left(player_types: impl IntoIterator<Item = u8>) -> u8 {
    player_types
        .into_iter()
        .take(8)
        .enumerate()
        .filter(|&(_, player_type)| LEFT_PLAYER_TYPES.contains(&player_type))
        .fold(0xff, |players, (player, _)| players & !(1 << player))
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
            self.write_replay_visions(players);
        }
    }

    /// Gives a replay restored to a keyframe the visions of the players who haven't left by the
    /// restored frame, less the ones the viewer turned off. Call right after the restore, with the
    /// restored player slots in place.
    pub unsafe fn restore_replay_visions_after_keyframe(&self) {
        unsafe {
            let players = self.players();
            let not_left = players_not_left((0..8).map(|i| (*players.add(i)).player_type));
            let shown = self.replay_vision_choice.lock().shown_of(not_left);
            if shown != self.replay_visions.resolve() {
                debug!("Keyframe restore shows visions {shown:#04x}");
            }
            self.write_replay_visions(shown);
            game_thread::add_fow_sprites_for_replay_vision_change(self);
        }
    }

    /// Shows the replay or observed game through the vision of `players`, a bit per player, draws
    /// the units that need detection as those players see them, and gives a replay the buildings
    /// those players would remember had their vision been shown since it began.
    ///
    /// Sets the minimap's tile vision along with the other two globals, as SC:R's own vision
    /// filter does. SC:R folds `minimap_tile_vision_mask ^ local_visions` into its turn sync
    /// hash, but only players send that hash and check it against others; replays and observers
    /// do neither, and they are the only ones that change visions.
    pub unsafe fn write_replay_visions(&self, players: u8) {
        unsafe {
            self.replay_visions.write(players);
            self.local_visions.write(players);
            if let Some(mask) = &self.minimap_tile_vision_mask {
                mask.write(u32::from(players) << 8);
            }
            self.redraw_units_needing_detection();
            crate::remembered_buildings::rebuild(self);
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
    fn players_who_left_have_no_vision_to_give_back() {
        assert_eq!(players_not_left([2, 2, 0, 0, 0, 0, 0, 0]), 0xff);
        assert_eq!(players_not_left([2, 10, 0, 0, 0, 0, 0, 0]), 0xfd);
        assert_eq!(players_not_left([11, 2, 1, 10, 0, 0, 0, 0]), 0xf6);
        assert_eq!(
            players_not_left([2; 12].into_iter().chain([10])),
            0xff,
            "only the eight player slots have replay vision"
        );
    }

    #[test]
    fn a_keyframe_restore_shows_the_players_still_in_less_the_ones_turned_off() {
        let mut choice = ReplayVisionChoice::new();
        choice.note_change(0xff, 0xfe);
        assert_eq!(choice.shown_of(0xff), 0xfe);
        assert_eq!(choice.shown_of(0xfd), 0xfc);
        // Restoring doesn't stand in for the restart's own giving back.
        choice.note_restart();
        assert_eq!(choice.shown_of(0xff), 0xfe);
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
