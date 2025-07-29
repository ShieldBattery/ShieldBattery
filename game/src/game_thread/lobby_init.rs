use std::time::{Duration, Instant};

use crate::bw::{Bw, get_bw};

/// How long between lobby "turns", e.g. checking/sending/applying lobby commands. This matches
/// SC'Rs timing.
const LOBBY_TURN_TIME: Duration = Duration::from_millis(50);

#[derive(Debug)]
enum LobbyInitCompleterState {
    NotStarted,
    Running(RunningState),
    Completed,
}

#[derive(Debug)]
pub struct LobbyInitCompleter {
    state: LobbyInitCompleterState,
}

impl LobbyInitCompleter {
    pub fn new() -> Self {
        LobbyInitCompleter {
            state: LobbyInitCompleterState::NotStarted,
        }
    }

    /// Steps the lobby init once, returning whether the lobby init is completed.
    pub fn step(&mut self) -> bool {
        match self.state {
            LobbyInitCompleterState::NotStarted => {
                debug!("LobbyInitCompleter advancing to Running state");
                self.state = LobbyInitCompleterState::Running(RunningState::new());

                false
            }
            LobbyInitCompleterState::Running(ref mut running_state) => {
                if running_state.step() {
                    debug!("LobbyInitCompleter completed");
                    self.state = LobbyInitCompleterState::Completed;
                    self.step()
                } else {
                    false
                }
            }
            LobbyInitCompleterState::Completed => true,
        }
    }

    /// Returns the time that a caller should wait until calling [LobbyInitCompleter::step] again.
    pub fn until_next_step(&self) -> u64 {
        match self.state {
            LobbyInitCompleterState::NotStarted => 0,
            LobbyInitCompleterState::Running(ref s) => s.until_next_step(),
            // NOTE(tec27): This time mostly only gets used if lobby init completes before we
            // have finished the countdown/mandatory minimum waiting time, so we just want a value
            // that will let it wait out its remaining time somewhat accurately
            LobbyInitCompleterState::Completed => 10,
        }
    }
}

#[derive(Debug)]
struct RunningState {
    last_receive_turns: Instant,
    in_stall: bool,
}

impl RunningState {
    fn new() -> Self {
        RunningState {
            last_receive_turns: Instant::now(),
            in_stall: false,
        }
    }

    fn step(&mut self) -> bool {
        unsafe {
            let bw = get_bw();

            if bw.try_finish_lobby_game_init() {
                return true;
            }

            if self.last_receive_turns.elapsed() >= LOBBY_TURN_TIME {
                let time = Instant::now();
                if bw.maybe_receive_turns() {
                    self.last_receive_turns = time;
                    self.in_stall = false;
                } else {
                    self.in_stall = true;
                }
            }

            if bw.try_finish_lobby_game_init() {
                return true;
            }
        }

        false
    }

    pub fn until_next_step(&self) -> u64 {
        if self.in_stall {
            // If we're in a stall, we want to step the network as soon as we can, but we also don't
            // want to completely block the thread/CPU. SC:R will basically call its equivalent
            // every render loop, so this could be anywhere from ~3ms to ~16ms for them.
            return 5;
        }

        // Sleep until the next turn receiving time, but at most 16ms (so we're still
        // processing events and re-rendering reasonably during this time)
        let turn_time_millis = LOBBY_TURN_TIME.as_millis();
        (turn_time_millis
            - (self
                .last_receive_turns
                .elapsed()
                .as_millis()
                .min(turn_time_millis)))
        .min(16) as u64
    }
}
