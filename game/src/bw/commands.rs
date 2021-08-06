//! Network/replay commands that players send.

use std::borrow::Cow;

use byteorder::{ByteOrder, LittleEndian};

pub mod id {
    pub const NOP: u8 = 0x5;
    pub const SYNC: u8 = 0x37;
    pub const REPLAY_SPEED: u8 = 0x56;
    pub const REPLAY_SEEK: u8 = 0x5d;
    pub const SET_TURN_RATE: u8 = 0x5f;
    pub const SET_NETWORK_SPEED: u8 = 0x66;
}

pub fn command_length(data: &[u8], command_lengths: &[u32]) -> Option<usize> {
    match *data.get(0)? {
        0x6 | 0x7 => {
            // Save/Load commands have a 0-terminated string starting at offset 5
            // as their last field
            data.iter().enumerate().skip(5).find(|x| *x.1 == 0).map(|x| x.0 + 1)
        }
        0x9 | 0xa | 0xb => {
            // Old selection commands, { u8 id, u8 unit_count, u16 units[] }
            data.get(1).map(|&count| count as usize * 2 + 2)
        }
        0x63 | 0x64 | 0x65 => {
            // New selection commands, { u8 id, u8 unit_count, u32 units[] }
            data.get(1).map(|&count| count as usize * 4 + 2)
        }
        x => {
            command_lengths.get(x as usize).map(|&len| len as usize)
        }
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
            [id::REPLAY_SEEK, ..] => from_replay == false,
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
                    match command {
                        [id::SET_NETWORK_SPEED, ..] | [id::SET_TURN_RATE, ..] |
                            [id::NOP, ..] => true,
                        _ => false,
                    }
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
        !0, !0, !0, !0, !0, 1, 33, 33, 1, 26, 26, 26, 8, 3, 5, 2,
        1, 1, 5, 3, 10, 11, !0, !0, 1, 1, 2, 1, 1, 1, 2, 3,
        3, 2, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 2, 1, 5,
        2, 1, 2, 1, 1, 3, 1, 7, !0, !0, !0, !0, !0, !0, !0, !0,
        !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0,
        !0, !0, !0, !0, !0, 2, 10, 2, 5, !0, 1, !0, 82, 5, !0, 2,
        12, 13, 5, 50, 50, 50, 4, !0, !0, !0, !0, !0, !0, !0, !0, !0,
    ];

    #[test]
    fn filter_replay_speed() {
        // Invalid play/pause
        let data = &[
            0x20, 0xff, 0xff,
            0x56, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid speed
        let data2 = &[
            0x20, 0xff, 0xff,
            0x56, 0x00, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data3 = &[
            0x20, 0xff, 0xff,
            0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data4 = &[
            0x20, 0xff, 0xff,
            0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data5 = &[
            0x20, 0xff, 0xff,
            0x56, 0x01, 0x06, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data6 = &[
            0x20, 0xff, 0xff,
            0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Ok
        let data7 = &[
            0x20, 0xff, 0xff,
            0x56, 0x01, 0x06, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        // Invalid multiplier
        let data8 = &[
            0x20, 0xff, 0xff,
            0x56, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let expected_bad = &[
            0x20, 0xff, 0xff,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        assert_eq!(&*filter_invalid_commands(data, false, false, LENGTHS), expected_bad);
        assert_eq!(&*filter_invalid_commands(data2, false, false, LENGTHS), expected_bad);
        assert_eq!(&*filter_invalid_commands(data3, false, false, LENGTHS), expected_bad);
        assert_eq!(&*filter_invalid_commands(data4, false, false, LENGTHS), data4);
        assert_eq!(&*filter_invalid_commands(data4, true, false, LENGTHS), expected_bad);
        assert_eq!(&*filter_invalid_commands(data5, false, false, LENGTHS), data5);
        assert_eq!(&*filter_invalid_commands(data6, false, false, LENGTHS), expected_bad);
        assert_eq!(&*filter_invalid_commands(data7, false, false, LENGTHS), data7);
        assert_eq!(&*filter_invalid_commands(data8, false, false, LENGTHS), expected_bad);
    }

    #[test]
    fn filter_replay_seek() {
        // Ok, but cannot be from replay file
        let data = &[
            0x20, 0xff, 0xff,
            0x5d, 0x01, 0x00, 0x00, 0x00,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let expected_bad = &[
            0x20, 0xff, 0xff,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        assert_eq!(&*filter_invalid_commands(data, false, false, LENGTHS), data);
        assert_eq!(&*filter_invalid_commands(data, true, false, LENGTHS), expected_bad);
    }

    #[test]
    fn test_iter_commands() {
        let data = &[
            0x20, 0xff, 0xff,
            0x32, 0xff,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x62, 0xff, 0xff, 0xff, 0xff]);
        assert!(iter.next().is_none());

        let data = &[
            0x20, 0xff, 0xff,
            0x32, 0xff,
            0x0a, 0x03, 0xaa, 0xaa, 0xbb, 0xbb, 0xcc, 0xcc,
            0x63, 0x02, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb,
            0x62, 0xff, 0xff, 0xff, 0xff,
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x0a, 0x03, 0xaa, 0xaa, 0xbb, 0xbb, 0xcc, 0xcc]);
        assert_eq!(
            iter.next().unwrap(),
            &[0x63, 0x02, 0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb],
        );
        assert_eq!(iter.next().unwrap(), &[0x62, 0xff, 0xff, 0xff, 0xff]);
        assert!(iter.next().is_none());

        let data = &[
            0x20, 0xff, 0xff,
            0x32, 0xff,
            0x07, 0xff, 0xff, 0xff, 0xff, b's', b'a', b'v', b'e', 0x00,
            0x32, 0xff,
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
            0x20, 0xff, 0xff,
            0x32, 0xff,
            0x62, 0xff, 0xff, 0xff, // Invalid as it's too short
        ];
        let mut iter = iter_commands(data, LENGTHS);
        assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
        assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
        assert!(iter.next().is_none());
    }

    #[test]
    fn filter_observer_commands() {
        let data = &[
            0x20, 0xff, 0xff,
            0x62, 0xff, 0xff, 0xff, 0xff,
            0x32, 0xff,
        ];
        let empty: &[u8] = &[];
        assert_eq!(&*filter_invalid_commands(data, false, true, LENGTHS), empty);

        let data = &[
            0x37, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x66, 0x00, 0x00, 0x00,
            0x37, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x5f, 0x06,
        ];
        let filtered = &[
            0x66, 0x00, 0x00, 0x00,
            0x5f, 0x06,
        ];
        assert_eq!(&*filter_invalid_commands(data, false, true, LENGTHS), filtered);
    }
}
