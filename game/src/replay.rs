//! Fucntions for writing/reading our replay extensions.

use std::convert::TryInto;
use std::io;

use byteorder::{ReadBytesExt, WriteBytesExt, LE};
use libc::c_void;

use crate::app_messages::GameSetupInfo;
use crate::bw::Bw;
use crate::windows;

static REPLAY_MAGIC: &[u8] = &[
    0xc2, 0x19, 0xc2, 0x93, 0x01, 0x00, 0x00, 0x00,
    0x04, 0x00, 0x00, 0x00, 0x73, 0x65, 0x52, 0x53,
];

pub static SECTION_ID: u32 = 0x74616253; // Sbat

pub struct SbatReplayData {
    pub team_game_main_players: [u8; 4],
    pub starting_races: [u8; 0xc],
}

/// Checks if the start of file matches what SC:R currently writes to every replay
/// (This does not check for 1.16.1 / early SC:R magic bytes)
pub unsafe fn has_replay_magic_bytes(file: *mut c_void) -> bool {
    match has_replay_magic_bytes_res(file) {
        Ok(o) => o,
        Err(e) => {
            error!("Unable to check file for replay magic: {}", e);
            false
        }
    }
}

unsafe fn has_replay_magic_bytes_res(file: *mut c_void) -> Result<bool, io::Error> {
    windows::file_seek(file, std::io::SeekFrom::Start(0))?;
    let mut buffer = [0u8; 0x10];
    windows::file_read(file, &mut buffer[..])?;
    Ok(buffer == REPLAY_MAGIC)
}

/// Adds shieldbattery replay data to end of a winapi file.
/// (Seeks to the end if not already)
pub unsafe fn add_shieldbattery_data(
    file: *mut c_void,
    bw: &dyn Bw,
    exe_build: u32,
    setup_info: &GameSetupInfo,
) -> Result<(), io::Error> {
    windows::file_seek(file, std::io::SeekFrom::End(0))?;
    // Current format: (The first two u32s are required by SC:R, after that we can have anything)
    // u32 section_id
    // u32 data_length (Not counting these first 8 bytes)
    // 0x0      u16 format_version (0)
    // 0x2      u32 starcraft_exe_build
    //      This is somewhat redundant as GCFG section that SC:R writes by default has it too,
    //      but may as well have a copy we control.
    // 0x6      u8 shieldbattery_version_string[0x10]
    // 0x16     u8 team_game_main_players[4]
    //      Think that relying on it being [0, 0, 0, 0] for non-team games is ok?
    //      BW shouldn't care at least.
    // 0x1a     u8 starting_races[0xc]
    //      This is also needed for team game replays.
    // 0x26     u128 game_id_uuid
    // 0x36     u32 user_ids[0x8]
    let game = bw.game();
    let mut buffer = Vec::with_capacity(32);
    buffer.write_u32::<LE>(SECTION_ID)?;
    buffer.write_u32::<LE>(0)?;
    buffer.write_u16::<LE>(0)?;
    buffer.write_u32::<LE>(exe_build)?;
    let version = env!("SHIELDBATTERY_VERSION").as_bytes();
    let mut version_buf = [0u8; 16];
    for (out, val) in version_buf.iter_mut().zip(version.iter()) {
        *out = *val;
    }
    buffer.extend_from_slice(&version_buf[..]);
    let team_game_main_players = (*game).team_game_main_player;
    buffer.extend_from_slice(&team_game_main_players);
    let starting_races = (*game).starting_races;
    buffer.extend_from_slice(&starting_races);
    write_uuid(&mut buffer, &setup_info.game_id)?;
    for slot in &setup_info.slots {
        let user_id = match slot.user_id {
            Some(user_id) => user_id,
            None => 0xffffffff as u32,
        };
        buffer.write_u32::<LE>(user_id)?;
    }
    let length = buffer.len() as u32 - 8;
    (&mut buffer[4..]).write_u32::<LE>(length)?;
    windows::file_write(file, &buffer)?;
    Ok(())
}

/// Id is expected to be "12345678-9abc-def0-1234-56789abcdef0"
/// format, otherwise returns error.
/// Writes as big-endian bytes 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, ...
/// (Just doing this by hand as it's just 30 lines,
/// could use uuid crate otherwise to be more efficient)
fn write_uuid<W: io::Write>(mut out: W, id: &str) -> Result<(), io::Error> {
    fn bad_format() -> io::Error {
        io::Error::new(io::ErrorKind::Other, "Invalid UUID string")
    }

    let mut buffer = [0u8; 16];
    let id = id.as_bytes();
    if id.len() != 36 {
        return Err(bad_format());
    }
    let mut in_pos = 0;
    let mut out_pos = 0;
    for &bytes in &[4, 2, 2, 2, 6] {
        if in_pos != 0 {
            if id[in_pos] != b'-' {
                return Err(bad_format());
            }
            in_pos += 1;
        }
        for byte in (&id[in_pos..]).chunks_exact(2).take(bytes) {
            buffer[out_pos] = match std::str::from_utf8(byte).ok()
                .and_then(|x| u8::from_str_radix(x, 16).ok())
            {
                Some(s) => s,
                None => return Err(bad_format()),
            };
            out_pos += 1;
            in_pos += 2;
        }
    }
    out.write_all(&buffer[..])
}

#[test]
fn test_write_uuid() {
    let mut buf = vec![];
    write_uuid(&mut buf, "12345678-9abc-def0-1234-56789abcdef0").unwrap();
    assert_eq!(&buf,
        &[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
          0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0],
    );
}

pub fn parse_shieldbattery_data(data: &[u8]) -> Option<SbatReplayData> {
    let format = (&data[0..]).read_u16::<LE>().ok()?;
    if format != 0 {
        return None;
    }
    let team_game_main_players = data.get(0x16..)?.get(..4)?;
    let starting_races = data.get(0x1a..)?.get(..0xc)?;
    Some(SbatReplayData {
        team_game_main_players: team_game_main_players.try_into().ok()?,
        starting_races: starting_races.try_into().ok()?,
    })
}
