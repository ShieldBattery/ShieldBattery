//! Network/replay commands that players send.

pub mod id {
    pub const REPLAY_SEEK: u8 = 0x5d;
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
        let len = match *self.slice.get(0)? {
            0x6 | 0x7 => {
                // Save/Load commands have a 0-terminated string starting at offset 5
                // as their last field
                self.slice.iter().enumerate().skip(5).find(|x| *x.1 == 0).map(|x| x.0 + 1)
            }
            0x9 | 0xa | 0xb => {
                // Old selection commands, { u8 id, u8 unit_count, u16 units[] }
                self.slice.get(1).map(|&count| count as usize * 2 + 2)
            }
            0x63 | 0x64 | 0x65 => {
                // New selection commands, { u8 id, u8 unit_count, u32 units[] }
                self.slice.get(1).map(|&count| count as usize * 4 + 2)
            }
            x => {
                self.command_lengths.get(x as usize).map(|&len| len as usize)
            }
        };
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

#[test]
fn test_iter_commands() {
    let lengths = &[
        !0, !0, !0, !0, !0, 1, 33, 33, 1, 26, 26, 26, 8, 3, 5, 2,
        1, 1, 5, 3, 10, 11, !0, !0, 1, 1, 2, 1, 1, 1, 2, 3,
        3, 2, 2, 3, 1, 2, 2, 1, 2, 3, 1, 2, 2, 2, 1, 5,
        2, 1, 2, 1, 1, 3, 1, 1, !0, !0, !0, !0, !0, !0, !0, !0,
        !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0, !0,
        !0, !0, !0, !0, !0, 2, 10, 2, 5, !0, 1, !0, 82, 5, !0, 2,
        12, 13, 5, 50, 50, 50, 4, !0, !0, !0, !0, !0, !0, !0, !0, !0,
    ];
    let data = &[
        0x20, 0xff, 0xff,
        0x32, 0xff,
        0x62, 0xff, 0xff, 0xff, 0xff,
    ];
    let mut iter = iter_commands(data, lengths);
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
    let mut iter = iter_commands(data, lengths);
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
    let mut iter = iter_commands(data, lengths);
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
    let mut iter = iter_commands(data, lengths);
    assert_eq!(iter.next().unwrap(), &[0x20, 0xff, 0xff]);
    assert_eq!(iter.next().unwrap(), &[0x32, 0xff]);
    assert!(iter.next().is_none());
}
