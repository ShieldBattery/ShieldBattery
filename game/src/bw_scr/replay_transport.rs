//! The game-side half of the replay transport: sending the commands that drive playback, and
//! learning the state back off the command stream.
//!
//! Speed, pause and seek are commands rather than globals, so the overlay drives playback by
//! sending exactly what SC:R's own replay plate sends. Reading the state back the same way — from
//! the stream every command passes through, whoever sent it — is what keeps our plate and the
//! game's own from ever disagreeing, and needs no per-architecture address for either global.

use std::time::{Duration, Instant};

use byteorder::{ByteOrder, LittleEndian};

use crate::bw::commands;

use super::BwScr;

/// The speed command: the id, the pause flag, the ladder position and the multiplier, packed with
/// no padding between them.
const SPEED_COMMAND_LEN: usize = 10;

/// The seek command: the id and the frame to jump to.
const SEEK_COMMAND_LEN: usize = 5;

/// How long a seek we sent may stay pending before another one is allowed through.
///
/// The game refuses a seek while one is in flight, and it refuses it silently — a refused command
/// never reaches the stream, so the arrival that would clear this never comes. Without a deadline
/// one refused seek would leave the transport unable to seek again for the rest of the replay.
const SEEK_TIMEOUT: Duration = Duration::from_secs(2);

/// How replay playback is running, as the last command to change it left it.
pub struct ReplayTransport {
    paused: bool,
    speed_index: u32,
    multiplier: u32,
    /// The frame a seek we sent is heading for, and when it went out.
    pending_seek: Option<(u32, Instant)>,
}

/// What the overlay needs to know about playback this frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TransportState {
    pub paused: bool,
    pub speed_index: u32,
    pub multiplier: u32,
    pub seek_pending: bool,
}

/// One thing the overlay wants done to playback.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ReplayCommand {
    Seek {
        frame: u32,
    },
    Speed {
        speed_index: u32,
        multiplier: u32,
        paused: bool,
    },
}

impl Default for ReplayTransport {
    fn default() -> ReplayTransport {
        ReplayTransport::new()
    }
}

impl ReplayTransport {
    /// Playback as a replay starts it: running, at the speed the replay was recorded at, which is
    /// the ladder's own `1` rung. Any command — ours or the game's plate's — corrects this.
    pub fn new() -> ReplayTransport {
        ReplayTransport {
            paused: false,
            speed_index: overlay_ui::transport::NORMAL_SPEED.speed_index,
            multiplier: overlay_ui::transport::NORMAL_SPEED.multiplier,
            pending_seek: None,
        }
    }

    /// Reads one live command, learning whatever it does to playback.
    ///
    /// Live commands only: a replay's own recorded stream carries none of these, and treating a
    /// re-fed command as news would report a state nothing had asked for.
    pub fn note_command(&mut self, command: &[u8]) {
        match command {
            [commands::id::REPLAY_SPEED, paused, rest @ ..]
                if rest.len() == SPEED_COMMAND_LEN - 2 =>
            {
                self.paused = *paused != 0;
                self.speed_index = LittleEndian::read_u32(&rest[..4]);
                self.multiplier = LittleEndian::read_u32(&rest[4..]);
            }
            // The seek has reached the game, so the next one may go out. Any seek clears this, not
            // only ours: a seek from the game's own plate ends the wait just as well.
            [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == SEEK_COMMAND_LEN - 1 => {
                self.pending_seek = None;
            }
            _ => (),
        }
    }

    /// What the overlay should show, now.
    pub fn state(&mut self) -> TransportState {
        TransportState {
            paused: self.paused,
            speed_index: self.speed_index,
            multiplier: self.multiplier,
            seek_pending: self.seek_pending(),
        }
    }

    /// Takes the right to send a seek to `frame`, or refuses it because one is still in flight.
    fn claim_seek(&mut self, frame: u32) -> bool {
        if self.seek_pending() {
            return false;
        }
        self.pending_seek = Some((frame, Instant::now()));
        true
    }

    /// Whether a seek we sent is still on its way, forgetting one that has waited past its
    /// deadline.
    fn seek_pending(&mut self) -> bool {
        let Some((frame, sent)) = self.pending_seek else {
            return false;
        };
        if sent.elapsed() < SEEK_TIMEOUT {
            return true;
        }
        debug!("Replay seek to frame {frame} was never seen in the command stream");
        self.pending_seek = None;
        false
    }
}

impl BwScr {
    /// What the overlay should show of playback this frame.
    pub fn replay_transport_state(&self) -> TransportState {
        self.replay_transport.lock().state()
    }

    /// Reads a live game command for whatever it says about replay playback.
    pub fn note_replay_transport_command(&self, command: &[u8]) {
        self.replay_transport.lock().note_command(command);
    }

    /// Carries out one thing the overlay asked of playback.
    ///
    /// Must run on the game thread: this reaches the same command-submission path the game's own
    /// replay plate clicks into.
    pub unsafe fn send_replay_command(&self, command: ReplayCommand) {
        unsafe {
            match command {
                ReplayCommand::Seek { frame } => {
                    if !self.replay_transport.lock().claim_seek(frame) {
                        return;
                    }
                    let mut data = [0u8; SEEK_COMMAND_LEN];
                    data[0] = commands::id::REPLAY_SEEK;
                    LittleEndian::write_u32(&mut data[1..], frame);
                    self.send_game_command(&data);
                }
                ReplayCommand::Speed {
                    speed_index,
                    multiplier,
                    paused,
                } => {
                    let mut data = [0u8; SPEED_COMMAND_LEN];
                    data[0] = commands::id::REPLAY_SPEED;
                    data[1] = u8::from(paused);
                    LittleEndian::write_u32(&mut data[2..6], speed_index);
                    LittleEndian::write_u32(&mut data[6..], multiplier);
                    self.send_game_command(&data);
                }
            }
        }
    }

    unsafe fn send_game_command(&self, data: &[u8]) {
        unsafe {
            (self.send_command)(data.as_ptr(), data.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_speed_command_is_read_back_exactly_as_it_was_written() {
        let mut transport = ReplayTransport::new();
        let mut data = [0u8; SPEED_COMMAND_LEN];
        data[0] = commands::id::REPLAY_SPEED;
        data[1] = 1;
        LittleEndian::write_u32(&mut data[2..6], 0);
        LittleEndian::write_u32(&mut data[6..], 4);
        transport.note_command(&data);
        assert_eq!(
            transport.state(),
            TransportState {
                paused: true,
                speed_index: 0,
                multiplier: 4,
                seek_pending: false,
            }
        );
    }

    #[test]
    fn a_command_of_the_wrong_length_says_nothing_about_playback() {
        let mut transport = ReplayTransport::new();
        let before = transport.state();
        transport.note_command(&[commands::id::REPLAY_SPEED, 1, 0, 0]);
        transport.note_command(&[commands::id::REPLAY_SEEK]);
        assert_eq!(transport.state(), before);
    }

    #[test]
    fn only_one_seek_is_in_flight_at_a_time() {
        let mut transport = ReplayTransport::new();
        assert!(transport.claim_seek(1000));
        assert!(transport.state().seek_pending);
        assert!(!transport.claim_seek(2000));

        let mut data = [0u8; SEEK_COMMAND_LEN];
        data[0] = commands::id::REPLAY_SEEK;
        LittleEndian::write_u32(&mut data[1..], 1000);
        transport.note_command(&data);
        assert!(!transport.state().seek_pending);
        assert!(transport.claim_seek(2000));
    }

    #[test]
    fn a_seek_the_game_never_took_stops_blocking_the_next_one() {
        let mut transport = ReplayTransport::new();
        assert!(transport.claim_seek(1000));
        transport.pending_seek = Some((1000, Instant::now() - SEEK_TIMEOUT));
        assert!(!transport.state().seek_pending);
        assert!(transport.claim_seek(2000));
    }
}
