//! Replay playback commands: the playback a transport key is relative to, seeks coalesced to the
//! latest one asked for, and speed changes completed from where playback is now.

use egui::{Context, Modifiers};

use super::hotkeys::Action;
use super::{Intent, Mode};
use crate::observer::MapPoint;
use crate::transport::{self, SpeedStep, TransportView};

/// The shortest time between two seeks reaching the game.
///
/// A dragged playhead asks for a new frame every frame it moves, and every seek simulates up to its
/// target from the nearest keyframe or from where playback is. Coalescing to the latest target
/// keeps a drag to a few seeks instead of dozens, and costs nothing: the intermediate frames were
/// never going to be watched.
const SEEK_INTERVAL_SECS: f64 = 0.25;

/// The replay commands waiting to go out, and the playback they are decided against.
pub(super) struct ReplayCommands {
    /// Replay playback as of the last frame. Keypresses arrive between frames and a transport key
    /// is relative — one rung up, ten seconds back — so the state it is relative to has to be here
    /// rather than in the frame that drew it.
    playback: Option<TransportView>,
    /// The frame a seek has been asked for and not yet sent, which is the latest one asked for: a
    /// drag across the track is one seek to where the pointer ended up, not one per frame of it.
    pending_seek: Option<(u32, Option<MapPoint>)>,
    /// When the last seek went out, on the context's own clock.
    last_seek_secs: f64,
}

impl Default for ReplayCommands {
    fn default() -> ReplayCommands {
        ReplayCommands {
            playback: None,
            pending_seek: None,
            last_seek_secs: f64::NEG_INFINITY,
        }
    }
}

impl ReplayCommands {
    /// Takes over the playback a host handed over this frame, `None` outside a replay.
    pub(super) fn set_playback(&mut self, playback: Option<TransportView>) {
        self.playback = playback;
    }

    /// The playback a click on a reporting panel moves, or `None` where nothing can be moved: a live
    /// game, watched or played, only ever runs forwards.
    pub(super) fn seekable(&self, mode: Mode) -> Option<TransportView> {
        self.playback.filter(|_| mode == Mode::Replay)
    }

    /// Queues a jump to `frame`, and a look at `look_at` once it lands, replacing whatever was queued
    /// before it.
    pub(super) fn queue_seek(&mut self, frame: u32, look_at: Option<MapPoint>) {
        self.pending_seek = Some((frame, look_at));
    }

    /// Lets the queued seek out once the game is ready for one.
    ///
    /// Held back while the game is still working through the last one: a second seek sent then is
    /// refused outright, and a refusal that swallowed the player's final drag position would leave
    /// the playhead somewhere they never asked for.
    pub(super) fn send_queued_seek(
        &mut self,
        ctx: &Context,
        view: &TransportView,
        intents: &mut Vec<Intent>,
    ) {
        let Some((frame, look_at)) = self.pending_seek else {
            return;
        };
        let now = ctx.input(|input| input.time);
        if view.seek_pending || now - self.last_seek_secs < SEEK_INTERVAL_SECS {
            // Nothing else is asking for the frame that would let this out, so it asks itself.
            ctx.request_repaint();
            return;
        }
        self.pending_seek = None;
        self.last_seek_secs = now;
        intents.push(Intent::Seek(frame));
        if let Some(point) = look_at {
            intents.push(Intent::LookAt(point));
        }
    }

    /// Asks for a change to how playback runs, filling in whichever half of it the player did not
    /// touch from where playback is now.
    ///
    /// Asking to play a replay that has run out starts it over from the beginning, as the game's
    /// own replay controls do, at whatever speed it was running at. Nothing else would ever play
    /// again: past the last frame there is only an idle game left to simulate.
    pub(super) fn request_speed(
        &mut self,
        speed: Option<SpeedStep>,
        paused: Option<bool>,
        intents: &mut Vec<Intent>,
    ) {
        let Some(view) = self.playback else {
            return;
        };
        let step = speed.unwrap_or_else(|| view.step());
        intents.push(Intent::SetSpeed {
            speed_index: step.speed_index,
            multiplier: step.multiplier,
            paused: paused.unwrap_or(view.paused),
        });
        // A seek already asked for, queued or on its way, is somewhere the player wants to be
        // instead, and playing goes on from there.
        if paused == Some(false)
            && view.finished()
            && self.pending_seek.is_none()
            && !view.seek_pending
        {
            self.queue_seek(0, None);
        }
    }

    /// Carries out a transport key, or reports that there was no replay for it to act on.
    pub(super) fn key_action(
        &mut self,
        action: Action,
        modifiers: Modifiers,
        intents: &mut Vec<Intent>,
    ) -> bool {
        let Some(view) = self.playback else {
            return false;
        };
        match action {
            Action::PauseResume => self.request_speed(None, Some(view.playing()), intents),
            Action::SpeedUp => self.request_speed(
                Some(transport::step_speed(view.speed_index, view.multiplier, 1)),
                None,
                intents,
            ),
            Action::SpeedDown => self.request_speed(
                Some(transport::step_speed(view.speed_index, view.multiplier, -1)),
                None,
                intents,
            ),
            Action::SeekBackward | Action::SeekForward => {
                let step = if modifiers.shift {
                    transport::SEEK_STEP_LONG_SECS
                } else {
                    transport::SEEK_STEP_SECS
                };
                let step = match action {
                    Action::SeekBackward => -step,
                    _ => step,
                };
                // Counted from where the queued seek would put playback rather than from where it
                // is now, so two presses in a row add up instead of one eating the other.
                let from = self
                    .pending_seek
                    .map_or(view.elapsed_frames, |(frame, _)| frame);
                let delta = transport::seconds_to_frames(i64::from(step), view.game_speed);
                let frame = view.frame_at(i64::from(from) + delta);
                self.queue_seek(frame, None);
            }
            _ => return false,
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use egui::{Key, Modifiers};

    use super::*;
    use crate::shell::test_support::*;

    #[test]
    fn the_pause_key_flips_only_the_pause_of_the_speed_command() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::SetSpeed {
                speed_index: view.speed_index,
                multiplier: view.multiplier,
                paused: true,
            }]
        );
    }

    #[test]
    fn play_on_a_replay_that_has_run_out_starts_it_over_at_the_same_speed() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        // Played to its end and still simulating, which is what the game leaves running there.
        let ended = TransportView {
            elapsed_frames: 60_010,
            multiplier: 4,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&ended));
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&ended)),
            [
                Intent::SetSpeed {
                    speed_index: ended.speed_index,
                    multiplier: 4,
                    paused: false,
                },
                Intent::Seek(0),
            ]
        );
    }

    #[test]
    fn play_on_a_replay_stopped_at_its_end_starts_it_over() {
        let mut commands = ReplayCommands::default();
        commands.set_playback(Some(TransportView {
            elapsed_frames: 60_000,
            paused: true,
            ..replay()
        }));
        let mut intents = Vec::new();
        // What the plate's play button asks for.
        commands.request_speed(None, Some(false), &mut intents);
        assert_eq!(commands.pending_seek, Some((0, None)));
        assert!(matches!(
            intents[..],
            [Intent::SetSpeed { paused: false, .. }]
        ));
    }

    #[test]
    fn only_asking_to_play_starts_a_replay_that_has_run_out_over() {
        let mut commands = ReplayCommands::default();
        commands.set_playback(Some(TransportView {
            elapsed_frames: 60_000,
            ..replay()
        }));
        let mut intents = Vec::new();
        commands.request_speed(Some(crate::transport::NORMAL_SPEED), None, &mut intents);
        commands.request_speed(None, Some(true), &mut intents);
        assert_eq!(commands.pending_seek, None);
    }

    #[test]
    fn a_seek_already_asked_for_wins_over_starting_a_finished_replay_over() {
        let mut commands = ReplayCommands::default();
        let ended = TransportView {
            elapsed_frames: 60_000,
            ..replay()
        };
        commands.set_playback(Some(ended));
        commands.queue_seek(50_000, None);
        let mut intents = Vec::new();
        commands.request_speed(None, Some(false), &mut intents);
        assert_eq!(commands.pending_seek, Some((50_000, None)));

        // And one already on its way to the game, including the restart itself.
        commands.pending_seek = None;
        commands.set_playback(Some(TransportView {
            seek_pending: true,
            ..ended
        }));
        commands.request_speed(None, Some(false), &mut intents);
        assert_eq!(commands.pending_seek, None);
    }

    #[test]
    fn the_pause_key_mid_replay_only_toggles_playback() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = TransportView {
            paused: true,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::P, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::SetSpeed {
                speed_index: view.speed_index,
                multiplier: view.multiplier,
                paused: false,
            }]
        );
    }

    #[test]
    fn the_speed_keys_walk_the_ladder_and_leave_playback_stopped_if_it_was() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = TransportView {
            paused: true,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::U, Modifiers::NONE));
        assert!(shell.key_pressed(Key::D, Modifiers::NONE));
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [
                Intent::SetSpeed {
                    speed_index: 6,
                    multiplier: 2,
                    paused: true,
                },
                // Half speed is the classic "fast" rung (83 ms frames against the fastest 42 ms),
                // not a fractional multiplier.
                Intent::SetSpeed {
                    speed_index: 2,
                    multiplier: 1,
                    paused: true,
                },
            ]
        );
    }

    #[test]
    fn seek_keys_add_up_into_one_jump_and_shift_lengthens_the_step() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        run_frame(&mut shell, &ctx, Some(&view));
        let shift = Modifiers {
            shift: true,
            ..Modifiers::NONE
        };
        assert!(shell.key_pressed(Key::Period, Modifiers::NONE));
        assert!(shell.key_pressed(Key::Period, shift));
        // Ten seconds and then a minute, counted from where playback is: one seek, not two.
        let expected = view
            .seek_target(crate::transport::SEEK_STEP_SECS + crate::transport::SEEK_STEP_LONG_SECS);
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::Seek(expected)]
        );
    }

    #[test]
    fn a_held_seek_key_keeps_seeking() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        run_frame(&mut shell, &ctx, Some(&view));
        assert!(shell.key_pressed(Key::Period, Modifiers::NONE));
        shell.key_repeated(Key::Period, Modifiers::NONE);
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&view)),
            [Intent::Seek(
                view.seek_target(2 * crate::transport::SEEK_STEP_SECS)
            )]
        );
    }

    #[test]
    fn a_seek_waits_while_the_game_is_still_working_through_the_last_one() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let pending = TransportView {
            seek_pending: true,
            ..replay()
        };
        run_frame(&mut shell, &ctx, Some(&pending));
        assert!(shell.key_pressed(Key::Comma, Modifiers::NONE));
        assert!(run_frame(&mut shell, &ctx, Some(&pending)).is_empty());
        // Still queued, so it goes out as soon as the game is ready rather than being lost.
        let ready = replay();
        assert_eq!(
            run_frame(&mut shell, &ctx, Some(&ready)),
            [Intent::Seek(
                ready.seek_target(-crate::transport::SEEK_STEP_SECS)
            )]
        );
    }

    #[test]
    fn transport_keys_are_the_games_until_a_replay_is_being_watched() {
        let mut shell = spectating_shell();
        for key in [Key::P, Key::U, Key::D, Key::Comma, Key::Period] {
            assert!(
                !shell.key_pressed(key, Modifiers::NONE),
                "{key:?} was consumed with no replay to act on"
            );
        }
    }

    #[test]
    fn the_games_own_plate_is_left_alone_until_ours_is_actually_on_screen() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let view = replay();
        assert!(run_frame_at(&mut shell, &ctx, Some(&view), 0.0).transport_shown);

        // A plate the player has hidden keeps the corner until its exit has finished playing.
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        assert!(run_frame_at(&mut shell, &ctx, Some(&view), 0.05).transport_shown);
        assert!(!run_frame_at(&mut shell, &ctx, Some(&view), 0.5).transport_shown);

        // And there is nothing to stand in for outside a replay.
        let mut elsewhere = spectating_shell();
        let ctx = fresh_ctx();
        assert!(!run_frame_at(&mut elsewhere, &ctx, None, 0.0).transport_shown);
    }

    #[test]
    fn only_a_replay_makes_the_reporting_panels_ways_back_into_the_game() {
        let mut commands = ReplayCommands::default();
        assert_eq!(commands.seekable(Mode::Replay), None);
        commands.playback = Some(replay());
        assert_eq!(commands.seekable(Mode::Replay), Some(replay()));
        // A live game being watched has no playback to move, whatever a host hands over.
        assert_eq!(commands.seekable(Mode::Observing), None);
    }
}
