//! Network/replay commands that players send.

use std::borrow::Cow;

use byteorder::{ByteOrder, LittleEndian};

pub mod id {
    pub const NOP: u8 = 0x5;
    pub const SAVE_GAME: u8 = 0x6;
    pub const LOAD_GAME: u8 = 0x7;
    pub const RESTART_GAME: u8 = 0x8;
    pub const SELECT: u8 = 0x9;
    pub const SELECT_ADD: u8 = 0xa;
    pub const SELECT_REMOVE: u8 = 0xb;
    pub const VISION: u8 = 0xd;
    pub const ALLIANCE: u8 = 0xe;
    pub const GAME_SPEED: u8 = 0xf;
    pub const PAUSE: u8 = 0x10;
    pub const RESUME: u8 = 0x11;
    pub const CHEAT: u8 = 0x12;
    pub const HOTKEY: u8 = 0x13;
    pub const RIGHT_CLICK: u8 = 0x14;
    pub const TARGETED_ORDER: u8 = 0x15;
    pub const UNLOAD: u8 = 0x29;
    pub const SYNC: u8 = 0x37;
    pub const SET_LATENCY: u8 = 0x55;
    pub const REPLAY_SPEED: u8 = 0x56;
    pub const LEAVE_GAME: u8 = 0x57;
    pub const MINIMAP_PING: u8 = 0x58;
    pub const MAKE_GAME_PUBLIC: u8 = 0x5b;
    pub const CHAT: u8 = 0x5c;
    pub const REPLAY_SEEK: u8 = 0x5d;
    pub const SET_TURN_RATE: u8 = 0x5f;
    pub const RIGHT_CLICK_EXTENDED: u8 = 0x60;
    pub const TARGETED_ORDER_EXTENDED: u8 = 0x61;
    pub const UNLOAD_EXTENDED: u8 = 0x62;
    pub const SELECT_EXTENDED: u8 = 0x63;
    pub const SELECT_ADD_EXTENDED: u8 = 0x64;
    pub const SELECT_REMOVE_EXTENDED: u8 = 0x65;
    pub const SET_NETWORK_SPEED: u8 = 0x66;
}

/// Selection hotkey groups each player has: 0-9 for the number keys and 10-17 for SC:R's history
/// of recent selections, which an Alt+click recalls. SC:R's hotkey handler also accepts group 18,
/// whose slot is the next player's group 0.
const SELECTION_HOTKEY_GROUPS: u8 = 18;

/// Bytes available for text in the classic `[0x5c][sender id][text]` chat command record: the
/// record is a fixed 0x52 bytes total (a 2-byte header followed by a 0x50-byte text field), and
/// the text field's last byte is reserved for the trailing NUL the native chat handler expects.
pub const CHAT_TEXT_CAPACITY: usize = 0x50 - 1;

/// Sender id of the chat records holding the notice ShieldBattery records at the start of every
/// replay. No player or observer has this id, so SC:R renders the lines as bare text without a
/// name, and ShieldBattery's own playback can recognize and drop them.
pub const REPLAY_NOTICE_SENDER: u8 = 27;

/// Truncates `text` to at most `max_len` bytes, backing off to the nearest UTF-8 character
/// boundary at or before `max_len` so a multi-byte character is never split. Returns `text`
/// unchanged (a borrow, no allocation) when it already fits.
pub fn truncate_utf8(text: &str, max_len: usize) -> &str {
    if text.len() <= max_len {
        return text;
    }
    let mut end = max_len;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
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

/// Removes native sync (0x37) commands, for a game that checks synchronization some other way.
pub fn strip_sync_commands<'a>(input: &'a [u8], command_lengths: &[u32]) -> Cow<'a, [u8]> {
    let is_sync = |cmd: &[u8]| cmd.first() == Some(&id::SYNC);
    if !iter_commands(input, command_lengths).any(is_sync) {
        return Cow::Borrowed(input);
    }
    let mut buffer = Vec::with_capacity(input.len());
    for command in iter_commands(input, command_lengths) {
        if !is_sync(command) {
            buffer.extend_from_slice(command);
        }
    }
    Cow::Owned(buffer)
}

/// The frame the last replay seek command in `input` asks for, if it has one.
pub fn replay_seek_target(input: &[u8], command_lengths: &[u32]) -> Option<u32> {
    iter_commands(input, command_lengths)
        .filter_map(|command| match command {
            [id::REPLAY_SEEK, rest @ ..] if rest.len() == 4 => Some(LittleEndian::read_u32(rest)),
            _ => None,
        })
        .last()
}

/// Removes the replay UI's seek commands.
pub fn strip_replay_seeks<'a>(input: &'a [u8], command_lengths: &[u32]) -> Cow<'a, [u8]> {
    let is_seek = |cmd: &[u8]| cmd.first() == Some(&id::REPLAY_SEEK);
    if !iter_commands(input, command_lengths).any(is_seek) {
        return Cow::Borrowed(input);
    }
    let mut buffer = Vec::with_capacity(input.len());
    for command in iter_commands(input, command_lengths) {
        if !is_seek(command) {
            buffer.extend_from_slice(command);
        }
    }
    Cow::Owned(buffer)
}

/// Removes the notice ShieldBattery records at the start of every replay (see
/// [`REPLAY_NOTICE_SENDER`]), which is addressed to viewers outside ShieldBattery.
///
/// Only meant for replays ShieldBattery recorded: in any other replay, a chat line from this
/// sender came from some player's client, and should play back like any other chat.
pub fn strip_replay_notice<'a>(input: &'a [u8], command_lengths: &[u32]) -> Cow<'a, [u8]> {
    let is_notice = |cmd: &[u8]| matches!(cmd, [id::CHAT, REPLAY_NOTICE_SENDER, ..]);
    if !iter_commands(input, command_lengths).any(is_notice) {
        return Cow::Borrowed(input);
    }
    let mut buffer = Vec::with_capacity(input.len());
    for command in iter_commands(input, command_lengths) {
        if !is_notice(command) {
            buffer.extend_from_slice(command);
        }
    }
    Cow::Owned(buffer)
}

/// Removes invalid commands that aren't caught by BW.
///
/// `unit_count` is the number of slots in the unit pool, or `None` before the game has allocated
/// it, when there are no units for a command to name.
pub fn filter_invalid_commands<'a>(
    input: &'a [u8],
    from_replay: bool,
    is_observer: bool,
    unit_count: Option<usize>,
    command_lengths: &[u32],
) -> Cow<'a, [u8]> {
    let mut first_valid = 0;
    let mut pos = 0;
    let mut buffer = Vec::new();
    for command in iter_commands(input, command_lengths) {
        let ok = match command {
            // No client sends these, and BW would read outside the unit pool on them.
            _ if unit_count.is_some_and(|count| has_out_of_pool_unit_tag(command, count)) => false,
            // A saved game can't be loaded through ShieldBattery, so no live game acts on either
            // command. Every client drops them here, which also covers a client that sends one
            // without going through the menu. Replays keep theirs, so older replays play back
            // exactly as they always have.
            [id::SAVE_GAME | id::LOAD_GAME, ..] => from_replay,
            // No client sends a group past the last one, and one that did would overwrite another
            // player's control group. Replays keep theirs, so they play back as recorded.
            [id::HOTKEY, _, group, ..] => from_replay || *group < SELECTION_HOTKEY_GROUPS,
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

/// Whether `tag` points BW outside a unit pool of `unit_count` slots. A tag holds a 1-based pool
/// index in its low bits (13 for a pool over 1700 slots, 11 otherwise) and the slot's reuse count
/// above them, and BW indexes the pool with it unchecked. Tag 0 means no unit, which BW checks for
/// before indexing; any other tag whose index is 0 or past the pool's end makes BW read outside it.
fn unit_tag_out_of_pool(tag: u32, unit_count: usize) -> bool {
    let index_mask = if unit_count > 1700 { 0x1fff } else { 0x7ff };
    let index = (tag & index_mask) as usize;
    tag != 0 && (index == 0 || index > unit_count)
}

/// Whether `command` names a unit by a tag outside a unit pool of `unit_count` slots (see
/// [`unit_tag_out_of_pool`]). `command` is a whole command, as [`iter_commands`] yields them.
fn has_out_of_pool_unit_tag(command: &[u8], unit_count: usize) -> bool {
    let out_of_pool = |tag: u32| unit_tag_out_of_pool(tag, unit_count);
    let u16_tag = |offset: usize| {
        command
            .get(offset..offset + 2)
            .is_some_and(|tag| out_of_pool(LittleEndian::read_u16(tag) as u32))
    };
    let u32_tag = |offset: usize| {
        command
            .get(offset..offset + 4)
            .is_some_and(|tag| out_of_pool(LittleEndian::read_u32(tag)))
    };
    match command {
        // { u8 id, u8 count, u16 tags[count] }
        [
            id::SELECT | id::SELECT_ADD | id::SELECT_REMOVE,
            _,
            tags @ ..,
        ] => tags
            .as_chunks()
            .0
            .iter()
            .any(|&tag| out_of_pool(u16::from_le_bytes(tag) as u32)),
        // { u8 id, u8 count, u32 tags[count] }
        [
            id::SELECT_EXTENDED | id::SELECT_ADD_EXTENDED | id::SELECT_REMOVE_EXTENDED,
            _,
            tags @ ..,
        ] => tags
            .as_chunks()
            .0
            .iter()
            .any(|&tag| out_of_pool(u32::from_le_bytes(tag))),
        // { u8 id, u16 x, u16 y, target tag, ... }
        [id::RIGHT_CLICK | id::TARGETED_ORDER, ..] => u16_tag(5),
        [id::RIGHT_CLICK_EXTENDED | id::TARGETED_ORDER_EXTENDED, ..] => u32_tag(5),
        // { u8 id, unit tag }
        [id::UNLOAD, ..] => u16_tag(1),
        [id::UNLOAD_EXTENDED, ..] => u32_tag(1),
        _ => false,
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
    fn filter_out_of_pool_unit_tags() {
        let filter = |data: &[u8], unit_count| {
            filter_invalid_commands(data, true, false, Some(unit_count), LENGTHS).into_owned()
        };
        let empty: &[u8] = &[];

        // A 3400-slot pool takes 13 index bits, so indices up to 8191 pass the mask but only
        // 1..=3400 name a slot.
        let pool = 3400;
        // Extended select of tag 0x1e62 (index 7778) next to one of tag 0x2cc0 (index 3264).
        let data = &[
            0x63, 0x01, 0x62, 0x1e, 0x00, 0x00, //
            0x63, 0x01, 0xc0, 0x2c, 0x00, 0x00,
        ];
        assert_eq!(filter(data, pool), &[0x63, 0x01, 0xc0, 0x2c, 0x00, 0x00]);
        // The last slot passes and the one past it doesn't, wherever the tag sits in the list.
        let data = &[0x63, 0x02, 0x00, 0x00, 0x00, 0x00, 0x48, 0x0d, 0x00, 0x00];
        assert_eq!(filter(data, pool), data);
        let data = &[0x64, 0x02, 0x00, 0x00, 0x00, 0x00, 0x49, 0x0d, 0x00, 0x00];
        assert_eq!(filter(data, pool), empty);
        // Tag 0 is no unit, but a nonzero tag with index 0 is outside the pool.
        let data = &[0x65, 0x01, 0x00, 0x20, 0x00, 0x00];
        assert_eq!(filter(data, pool), empty);
        // A classic select drops just the same, and the commands around it stay.
        let data = &[
            0x13, 0x00, 0x00, // hotkey
            0x09, 0x01, 0x62, 0x1e, // select, tag 0x1e62
            0x0d, 0x01, 0x01, // vision
        ];
        assert_eq!(filter(data, pool), &[0x13, 0x00, 0x00, 0x0d, 0x01, 0x01]);

        // A 1700-slot pool takes 11 index bits, so tag 0x1e62 is index 1634 there.
        let pool = 1700;
        let data = &[0x09, 0x02, 0x62, 0x1e, 0xa4, 0x06];
        assert_eq!(filter(data, pool), data);
        // Index 1701, then a tag with index 0 and reuse count 1.
        assert_eq!(filter(&[0x0a, 0x01, 0xa5, 0x06], pool), empty);
        assert_eq!(filter(&[0x0b, 0x01, 0x00, 0x08], pool), empty);

        // Orders on a position (target tag 0) and on a unit in the pool stay.
        let pool = 3400;
        let ground = &[
            0x14, 0x10, 0x00, 0x20, 0x00, 0x00, 0x00, 0xe4, 0x00, 0x00, //
            0x15, 0x10, 0x00, 0x20, 0x00, 0x00, 0x00, 0xe4, 0x00, 0x06, 0x00, //
            0x60, 0x10, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe4, 0x00, 0x00, //
            0x61, 0x10, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe4, 0x00, 0x06, 0x00,
        ];
        assert_eq!(filter(ground, pool), ground);
        let in_pool = &[
            0x14, 0x10, 0x00, 0x20, 0x00, 0xc0, 0x2c, 0x00, 0x00, 0x00, //
            0x61, 0x10, 0x00, 0x20, 0x00, 0xc0, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, //
            0x29, 0xc0, 0x2c, //
            0x62, 0xc0, 0x2c, 0x00, 0x00,
        ];
        assert_eq!(filter(in_pool, pool), in_pool);
        // Each command that names a unit drops on a tag outside the pool.
        let out_of_pool: &[&[u8]] = &[
            &[0x14, 0x10, 0x00, 0x20, 0x00, 0x62, 0x1e, 0x00, 0x00, 0x00],
            &[
                0x15, 0x10, 0x00, 0x20, 0x00, 0x62, 0x1e, 0x00, 0x00, 0x0a, 0x00,
            ],
            &[
                0x60, 0x10, 0x00, 0x20, 0x00, 0x62, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x00,
            ],
            &[
                0x61, 0x10, 0x00, 0x20, 0x00, 0x62, 0x1e, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00,
            ],
            &[0x29, 0x62, 0x1e],
            &[0x62, 0x62, 0x1e, 0x00, 0x00],
        ];
        for &data in out_of_pool {
            assert_eq!(filter(data, pool), empty, "{data:02x?}");
        }

        // Nothing drops before the pool exists, and a clean batch stays borrowed.
        let data = &[0x29, 0x62, 0x1e];
        assert_eq!(
            &*filter_invalid_commands(data, true, false, None, LENGTHS),
            data
        );
        assert!(matches!(
            filter_invalid_commands(in_pool, true, false, Some(pool), LENGTHS),
            Cow::Borrowed(_)
        ));
    }

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
            &*filter_invalid_commands(data, false, false, None, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data2, false, false, None, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data3, false, false, None, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data4, false, false, None, LENGTHS),
            data4
        );
        assert_eq!(
            &*filter_invalid_commands(data4, true, false, None, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data5, false, false, None, LENGTHS),
            data5
        );
        assert_eq!(
            &*filter_invalid_commands(data6, false, false, None, LENGTHS),
            expected_bad
        );
        assert_eq!(
            &*filter_invalid_commands(data7, false, false, None, LENGTHS),
            data7
        );
        assert_eq!(
            &*filter_invalid_commands(data8, false, false, None, LENGTHS),
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
        assert_eq!(
            &*filter_invalid_commands(data, false, false, None, LENGTHS),
            data
        );
        assert_eq!(
            &*filter_invalid_commands(data, true, false, None, LENGTHS),
            expected_bad
        );
    }

    #[test]
    fn replay_seeks_are_found_and_stripped() {
        let data = &[
            0x5d, 0x10, 0x00, 0x00, 0x00, 0x20, 0xff, 0xff, 0x5d, 0x20, 0x00, 0x00, 0x00,
        ];
        assert_eq!(replay_seek_target(data, LENGTHS), Some(0x20));
        assert_eq!(&*strip_replay_seeks(data, LENGTHS), &[0x20, 0xff, 0xff]);

        let no_seek = &[0x20, 0xff, 0xff];
        assert_eq!(replay_seek_target(no_seek, LENGTHS), None);
        assert!(matches!(
            strip_replay_seeks(no_seek, LENGTHS),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn strip_replay_notice_keeps_player_chat() {
        let chat = |sender: u8| {
            let mut data = vec![0x20, 0xff, 0xff, id::CHAT, sender];
            data.extend_from_slice(&[b'a'; 0x50]);
            data.extend_from_slice(&[0x62, 0xff, 0xff, 0xff, 0xff]);
            data
        };
        let notice = chat(REPLAY_NOTICE_SENDER);
        assert_eq!(
            &*strip_replay_notice(&notice, LENGTHS),
            &[0x20, 0xff, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff]
        );
        let player_chat = chat(1);
        assert!(matches!(
            strip_replay_notice(&player_chat, LENGTHS),
            Cow::Borrowed(_)
        ));
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
    fn strip_sync_commands_removes_only_sync() {
        let lengths = strip_lengths();
        let data = &[0x20, 0xaa, 0xbb, 0x37, 0xcc, 0x05];
        assert_eq!(
            &*strip_sync_commands(data, &lengths),
            &[0x20, 0xaa, 0xbb, 0x05]
        );
        let untouched = &[0x20, 0xaa, 0xbb, 0x05];
        assert!(matches!(
            strip_sync_commands(untouched, &lengths),
            Cow::Borrowed(_)
        ));
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
    fn truncate_utf8_returns_input_unchanged_when_it_fits() {
        assert_eq!(truncate_utf8("hello", 10), "hello");
        assert_eq!(truncate_utf8("hello", 5), "hello");
        assert_eq!(truncate_utf8("", 0), "");
    }

    #[test]
    fn truncate_utf8_cuts_ascii_at_the_exact_byte() {
        assert_eq!(truncate_utf8("hello world", 5), "hello");
        assert_eq!(truncate_utf8("hello world", 0), "");
    }

    #[test]
    fn truncate_utf8_backs_off_to_a_char_boundary() {
        // "café" is 5 bytes ('é' is 2 bytes); a cap of 4 would split 'é' mid-character.
        let text = "café";
        assert_eq!(text.len(), 5);
        assert_eq!(truncate_utf8(text, 4), "caf");
        assert_eq!(truncate_utf8(text, 5), "café");
    }

    #[test]
    fn filter_observer_commands() {
        let data = &[0x20, 0xff, 0xff, 0x62, 0xff, 0xff, 0xff, 0xff, 0x32, 0xff];
        let empty: &[u8] = &[];
        assert_eq!(
            &*filter_invalid_commands(data, false, true, None, LENGTHS),
            empty
        );

        let data = &[
            0x37, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x66, 0x00, 0x00, 0x00, 0x37, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x5f, 0x06,
        ];
        let filtered = &[0x66, 0x00, 0x00, 0x00, 0x5f, 0x06];
        assert_eq!(
            &*filter_invalid_commands(data, false, true, None, LENGTHS),
            filtered
        );
    }

    #[test]
    fn filter_hotkeys_past_the_last_group_in_live_games() {
        // Keep-alives around hotkeys: recall 1, recall the history group 17, assign 18, add 255.
        let data = &[
            0x05, 0x13, 0x01, 0x01, 0x13, 0x01, 0x11, 0x13, 0x00, 0x12, 0x13, 0x02, 0xff, 0x05,
        ];
        assert_eq!(
            &*filter_invalid_commands(data, false, false, None, LENGTHS),
            &[0x05, 0x13, 0x01, 0x01, 0x13, 0x01, 0x11, 0x05]
        );
        assert_eq!(
            &*filter_invalid_commands(data, true, false, None, LENGTHS),
            data
        );
    }

    #[test]
    fn filter_save_and_load_in_live_games() {
        // Keep-alives around a save and a load, each carrying its 4-byte header and a
        // NUL-terminated name.
        let data = &[
            0x05, 0x06, 0x01, 0x02, 0x03, 0x04, b'a', b'b', 0x00, 0x05, 0x07, 0x01, 0x02, 0x03,
            0x04, b'c', 0x00, 0x05,
        ];
        assert_eq!(
            &*filter_invalid_commands(data, false, false, None, LENGTHS),
            &[0x05, 0x05, 0x05]
        );
        // Replays keep them, so older replays play back unchanged.
        assert_eq!(
            &*filter_invalid_commands(data, true, false, None, LENGTHS),
            data
        );
    }
}
