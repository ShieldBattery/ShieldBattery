//! Network/replay commands that players send.

use std::borrow::Cow;

use byteorder::{ByteOrder, LittleEndian};

pub mod id {
    pub const NOP: u8 = 0x5;
    pub const SYNC: u8 = 0x37;
    pub const SET_LATENCY: u8 = 0x55;
    pub const REPLAY_SPEED: u8 = 0x56;
    pub const CHAT: u8 = 0x5c;
    pub const REPLAY_SEEK: u8 = 0x5d;
    pub const SET_TURN_RATE: u8 = 0x5f;
    pub const SET_NETWORK_SPEED: u8 = 0x66;
}

pub fn command_length(data: &[u8], command_lengths: &[u32]) -> Option<usize> {
    match *data.first()? {
        0x6 | 0x7 => {
            // Save/Load commands have a 0-terminated string starting at offset 5
            // as their last field
            data.iter()
                .enumerate()
                .skip(5)
                .find(|x| *x.1 == 0)
                .map(|x| x.0 + 1)
        }
        0x9 | 0xa | 0xb => {
            // Old selection commands, { u8 id, u8 unit_count, u16 units[] }
            data.get(1).map(|&count| count as usize * 2 + 2)
        }
        0x63 | 0x64 | 0x65 => {
            // New selection commands, { u8 id, u8 unit_count, u32 units[] }
            data.get(1).map(|&count| count as usize * 4 + 2)
        }
        x => command_lengths.get(x as usize).map(|&len| len as usize),
    }
}

/// Splits a byte slice that may contain many commands to slices of individual commands.
pub fn iter_commands<'a>(
    slice: &'a [u8],
    command_lengths: &'a [u32],
) -> impl Iterator<Item = &'a [u8]> {
    IterCommands {
        slice,
        command_lengths,
    }
}

struct IterCommands<'a> {
    slice: &'a [u8],
    command_lengths: &'a [u32],
}

impl<'a> Iterator for IterCommands<'a> {
    type Item = &'a [u8];
    fn next(&mut self) -> Option<Self::Item> {
        if self.slice.is_empty() {
            return None;
        }
        let len = command_length(self.slice, self.command_lengths);
        let split = len
            .filter(|&len| len != 0)
            .and_then(|len| Some((self.slice.get(..len)?, self.slice.get(len..)?)));
        match split {
            Some((cmd, rest)) => {
                self.slice = rest;
                Some(cmd)
            }
            None => {
                warn!("Unknown/invalid command {:x?}", self.slice);
                self.slice = &[];
                None
            }
        }
    }
}

/// Strips the native latency / turn-rate control commands (`0x55` set-latency, `0x5f` set-turn-rate,
/// `0x66` dynamic-turn-rate) from an assembled turn buffer, preserving every other command
/// (including the inline `0x37` sync command and the `0x5` keep-alive) in order.
///
/// The netcode v2 turn transport owns the latency buffer out-of-band via relay directives, and it pins
/// `builtin_turn_latency` / turn rate. If these in-stream commands were
/// allowed through they would ride `process_commands` → `recompute_turn_durations` and rewrite the
/// pinned globals mid-game (a user clicking the in-game latency knob, or a DTR re-issue), diverging
/// expectation from the relay-driven reality. Every client strips its own outbound turn identically,
/// so the command simply never reaches any sim — the knob becomes a no-op rather than a desync.
///
/// Returns `Cow::Borrowed` (no allocation) when the buffer contains none of them, which is the
/// overwhelmingly common per-turn case.
pub fn strip_control_commands<'a>(input: &'a [u8], command_lengths: &[u32]) -> Cow<'a, [u8]> {
    let is_control = |cmd: &[u8]| {
        matches!(
            cmd.first(),
            Some(&id::SET_LATENCY | &id::SET_TURN_RATE | &id::SET_NETWORK_SPEED)
        )
    };
    // First pass: bail out with a borrow if there's nothing to strip.
    if !iter_commands(input, command_lengths).any(is_control) {
        return Cow::Borrowed(input);
    }
    let mut buffer = Vec::with_capacity(input.len());
    for command in iter_commands(input, command_lengths) {
        if !is_control(command) {
            buffer.extend_from_slice(command);
        }
    }
    Cow::Owned(buffer)
}

/// Removes invalid commands that aren't caught by BW.
pub fn filter_invalid_commands<'a>(
    input: &'a [u8],
    from_replay: bool,
    is_observer: bool,
    command_lengths: &[u32],
) -> Cow<'a, [u8]> {
    let mut first_valid = 0;
    let mut pos = 0;
    let mut buffer = Vec::new();
    for command in iter_commands(input, command_lengths) {
        let ok = match command {
            [id::REPLAY_SEEK, ..] => !from_replay,
            [id::REPLAY_SPEED, rest @ ..] => {
                if from_replay || rest.len() != 9 {
                    false
                } else {
                    let pause = rest[0];
                    let speed = LittleEndian::read_u32(&rest[1..]);
                    let multiplier = LittleEndian::read_u32(&rest[5..]);
                    pause < 2 && speed < 7 && matches!(multiplier, 1 | 2 | 4 | 8 | 16)
                }
            }
            _ => {
                if is_observer {
                    // Filter out almost all observer commands.
                    // Network speed commands are allowed as storm player with id 0 (host)
                    // is expected to send them.
                    matches!(
                        command,
                        [id::SET_NETWORK_SPEED, ..] | [id::SET_TURN_RATE, ..] | [id::NOP, ..]
                    )
                } else {
                    true
                }
            }
        };
        if !ok {
            if first_valid == 0 {
                buffer.clear();
            }
            buffer.extend_from_slice(&input[first_valid..pos]);
            pos += command.len();
            first_valid = pos;
        } else {
            pos += command.len();
        }
    }
    if first_valid == 0 {
        Cow::Borrowed(input)
    } else {
        buffer.extend_from_slice(&input[first_valid..pos]);
        Cow::Owned(buffer)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    static LENGTHS: &[u32] = &[
        !0, !0, !0, !0, !0, 1, 33, 33, 1, 26, 26, 26, 8, 3, 5, 2, 1, 1, 5, 3, 10, 11, !0, !0, 1, 1,
        2, 1, 1, 1, 2, 3, 3, 2, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 2, 1, 5, 2, 1, 2, 1, 1, 3, 1, 7,
        !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0,
        !0, !0, !0, !0, !0, !0, 2, 10, 2, 5, !0, 1, !0, 82, 5, !0, 2, 12, 13, 5, 50, 50, 50, 4, !0,
        !0, !0, !0, !0, !0, !0, !0, !0,
    ];

    #[test]
    fn filter_replay_speed() {
        // Invalid play/pause
        let data = &[
            0x20, 0xff, 0xff, 0x56, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid speed
        let data2 = &[
            0x20, 0xff, 0xff, 0x56, 0x00, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data3 = &[
            0x20, 0xff, 0xff, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data4 = &[
            0x20, 0xff, 0xff, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data5 = &[
            0x20, 0xff, 0xff, 0x56, 0x01, 0x06, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data6 = &[
            0x20, 0xff, 0xff, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data7 = &[
            0x20, 0xff, 0xff, 0x56, 0x01, 0x06, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data8 = &[
            0x20, 0xff, 0xff, 0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x62,
            0xff, 0xff, 0xff, 0xff,
        ];
        let expected_bad = &[0x20, 0xff, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff];
        assert_eq!(
            &*filter_invalid_commands(data, false, false, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data2, false, false, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data3, false, false, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data4, false, false, LENGTHS),
            data4
        );
        assert_eq!(
            &*filter_invalid_commands(data4, true, false, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data5, false, false, LENGTHS),
            data5
        );
        assert_eq!(
            &*filter_invalid_commands(data6, false, false, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data7, false, false, LENGTHS),
            data7
        );
        assert_eq!(
            &*filter_invalid_commands(data8, false, false, LENGTHS),
            expected_bad
        );
    }

    #[test]
    fn filter_replay_seek() {
        // Ok, but cannot be from replay file
        let data = &[
            0x20, 0xff, 0xff, 0x5d, 0x01, 0x00, 0x00, 0x00, 0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let expected_bad = &[0x20, 0xff, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff];
        assert_eq!(&*filter_invalid_commands(data, false, false, LENGTHS), data);
        assert_eq!(
            &*filter_invalid_commands(data, true, false, LENGTHS),
            expected_bad
        );
    }

    #[test]
    fn test_iter_commands() {
        let data = &[0x20, 0xff, 0xff, 0x32, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x62, 0xff, 0xff, 0xff, 0xff]);
        assert!(iter.next().is_none());

        let data = &[
            0x20, 0xff, 0xff, 0x32, 0xff, 0x0a, 0x03, 0xaa, 0xaa, 0xbb, 0xbb, 0xcc, 0xcc, 0x63,
            0x02, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb, 0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert_eq!(
            iter.next().unwrap(),
            &[0x0a, 0x03, 0xaa, 0xaa, 0xbb, 0xbb, 0xcc, 0xcc]
        );
        assert_eq!(
            iter.next().unwrap(),
            &[0x63, 0x02, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb],
        );
        assert_eq!(iter.next().unwrap(), &[0x62, 0xff, 0xff, 0xff, 0xff]);
        assert!(iter.next().is_none());

        let data = &[
            0x20, 0xff, 0xff, 0x32, 0xff, 0x07, 0xff, 0xff, 0xff, 0xff, b's', b'a', b'v', b'e',
            0x00, 0x32, 0xff,
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert_eq!(
            iter.next().unwrap(),
            &[0x07, 0xff, 0xff, 0xff, 0xff, b's', b'a', b'v', b'e', 0x00],
        );
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert!(iter.next().is_none());

        let data = &[
            0x20, 0xff, 0xff, 0x32, 0xff, 0x62, 0xff, 0xff, 0xff, // Invalid as it's too short
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert!(iter.next().is_none());
    }

    // The shared LENGTHS fixture marks 0x55/0x5f as variable (`!0`), so these strip tests use a
    // table with the real fixed lengths for the control commands (0x55/0x5f = 2, 0x66 = 4).
    fn strip_lengths() -> Vec<u32> {
        let mut lengths = vec![1u32; 256];
        lengths[0x20] = 3; // move
        lengths[0x37] = 2; // sync
        lengths[id::SET_LATENCY as usize] = 2; // 0x55
        lengths[id::SET_TURN_RATE as usize] = 2; // 0x5f
        lengths[id::SET_NETWORK_SPEED as usize] = 4; // 0x66
        lengths[id::NOP as usize] = 1; // 0x05 keep-alive
        lengths
    }

    #[test]
    fn strip_control_commands_removes_latency_and_turn_rate() {
        let lengths = strip_lengths();
        let data = &[
            0x20, 0xaa, 0xbb, //       move -> kept
            0x55, 0x02, //             set-latency -> stripped
            0x37, 0xcc, //             sync -> kept (must survive)
            0x5f, 0x18, //             set-turn-rate -> stripped
            0x66, 0x01, 0x02, 0x03, // dynamic-turn-rate -> stripped
            0x05, //                   keep-alive -> kept
        ];
        let expected = &[0x20, 0xaa, 0xbb, 0x37, 0xcc, 0x05];
        assert_eq!(&*strip_control_commands(data, &lengths), expected);
    }

    #[test]
    fn strip_control_commands_borrows_when_nothing_to_strip() {
        let lengths = strip_lengths();
        let data = &[0x20, 0xaa, 0xbb, 0x37, 0xcc, 0x05];
        assert!(matches!(
            strip_control_commands(data, &lengths),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn filter_observer_commands() {
        let data = &[0x20, 0xff, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff, 0x32, 0xff];
        let empty: &[u8] = &[];
        assert_eq!(&*filter_invalid_commands(data, false, true, LENGTHS), empty);

        let data = &[
            0x37, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x66, 0x00, 0x00, 0x00, 0x37, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x5f, 0x06,
        ];
        let filtered = &[0x66, 0x00, 0x00, 0x00, 0x5f, 0x06];
        assert_eq!(
            &*filter_invalid_commands(data, false, true, LENGTHS),
            filtered
        );
    }
}
