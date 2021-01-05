//! Fucntions for writing/reading our replay extensions.

use std::convert::TryInto;
use std::io;

use byteorder::{ReadBytesExt, WriteBytesExt, LE};
use libc::c_void;

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
) -> Result<(), io::Error> {
    windows::file_seek(file, std::io::SeekFrom::End(0))?;
    // Current format: (The first two u32s are required by SC:R, after that we can have anything)
    // u32 section_id
    // u32 data_length (Not counting these first 8 bytes)
    // u16 format_version (0)
    // u32 starcraft_exe_build
    // u8 shieldbattery_version_length
    // u8 shieldbattery_version_string[..]
    // u8 team_game_main_players[4]
    //      Think that relying on it being [0, 0, 0, 0] for non-team games is ok?
    //      BW shouldn't care at least.
    // u8 starting_races[0xc]
    //      This is also needed for team game replays.
    let game = bw.game();
    let mut buffer = Vec::with_capacity(32);
    buffer.write_u32::<LE>(SECTION_ID)?;
    buffer.write_u32::<LE>(0)?;
    buffer.write_u16::<LE>(0)?;
    buffer.write_u32::<LE>(exe_build)?;
    let version = env!("SHIELDBATTERY_VERSION").as_bytes();
    let length = version.len().min(255) as u8;
    buffer.push(length);
    buffer.extend_from_slice(&version[..length as usize]);
    let team_game_main_players = (*game).team_game_main_player;
    buffer.extend_from_slice(&team_game_main_players);
    let starting_races = (*game).starting_races;
    buffer.extend_from_slice(&starting_races);
    let length = buffer.len() as u32 - 8;
    (&mut buffer[4..]).write_u32::<LE>(length)?;
    windows::file_write(file, &buffer)?;
    Ok(())
}

pub fn parse_shieldbattery_data(data: &[u8]) -> Option<SbatReplayData> {
    let format = (&data[0..]).read_u16::<LE>().ok()?;
    if format != 0 {
        return None;
    }
    let &version_string_length = data.get(6)?;
    let mut offset = 7 + version_string_length as usize;
    let team_game_main_players = data.get(offset..)?.get(..4)?;
    offset += 4;
    let starting_races = data.get(offset..)?.get(..0xc)?;
    Some(SbatReplayData {
        team_game_main_players: team_game_main_players.try_into().ok()?,
        starting_races: starting_races.try_into().ok()?,
    })
}
