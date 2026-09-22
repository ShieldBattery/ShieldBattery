//! SC:R's replay autosave, with the failure path that pops up a modal error dialog removed.
//!
//! SC:R autosaves `LastReplay.rep` from inside the multiplayer game teardown. Its own
//! replace-the-existing-file step deletes the file without clearing a read-only attribute first,
//! and when that delete fails while the file is still there it builds an OK dialog. Dialog colors
//! are picked through the nearest-palette-color lookup, which reads a table that terrain shutdown
//! has already freed earlier in the same teardown, so the dialog faults. This module reproduces the
//! parts of the autosave that are safe there and reports the failure through the log instead.

use std::ffi::CStr;
use std::fs;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use winapi::um::fileapi::SetFileAttributesW;
use winapi::um::winnt::FILE_ATTRIBUTE_READONLY;

use scr_analysis::VirtualAddress;

use crate::bw::ReplayData;
use crate::bw::commands::command_length;
use crate::windows::winapi_str;

/// Size of the path buffer SC:R passes to `build_replay_file_path`.
const REPLAY_PATH_BUFFER_SIZE: usize = 0x104;

/// The value SC:R's own "couldn't replace the existing replay" branch returns.
const REPLACE_FAILED: i32 = -1;

/// SC:R's replay autosave entry point and the path builder it uses, resolved together
/// (all-or-nothing): replacing the file safely needs the path the save is going to write to.
pub struct ReplayAutosave {
    /// `int save_replay_by_name(const char *name, bool replace_existing)`, the hook target.
    pub save_replay_by_name: VirtualAddress,
    /// `bool build_replay_file_path(const char *name, char *out, u32 out_size)`. Writes a
    /// NUL-terminated UTF-8 path into `out` and creates the containing directory if needed.
    pub build_replay_file_path: unsafe extern "C" fn(*const i8, *mut u8, u32) -> u8,
}

/// What [`remove_replay_file`] had to do to clear the path.
#[derive(Debug, Eq, PartialEq)]
pub enum RemovedReplayFile {
    /// Nothing was at the path to begin with.
    NotPresent,
    /// The file was deleted as it was.
    Deleted,
    /// The file was marked read-only, so that attribute had to be cleared before the delete.
    DeletedAfterClearingReadOnly,
}

/// Deletes the file at `path` if it exists, clearing a read-only attribute that would otherwise
/// block the delete.
///
/// The attribute is not put back when the delete fails afterwards: the path is one the game
/// rewrites after every match, and a file that can't be replaced is reported to the caller anyway.
pub fn remove_replay_file(path: &Path) -> io::Result<RemovedReplayFile> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(RemovedReplayFile::NotPresent);
        }
        Err(error) => return Err(error),
    };
    let attributes = metadata.file_attributes();
    let mut cleared_read_only = false;
    if attributes & FILE_ATTRIBUTE_READONLY != 0 {
        // Only the read-only bit is dropped; every other attribute the file carries is written back
        // as it was.
        let cleared = attributes & !FILE_ATTRIBUTE_READONLY;
        // Failing to clear the attribute isn't reported on its own; the delete below is the step
        // that has to succeed and its error describes the actual obstacle.
        cleared_read_only = unsafe { SetFileAttributesW(winapi_str(path).as_ptr(), cleared) } != 0;
    }
    fs::remove_file(path)?;
    // A delete can be accepted while another open handle keeps the name in the directory, which
    // leaves the path just as unwritable as an outright failure.
    if fs::symlink_metadata(path).is_ok() {
        return Err(io::Error::other("File still exists after being deleted"));
    }
    Ok(if cleared_read_only {
        RemovedReplayFile::DeletedAfterClearingReadOnly
    } else {
        RemovedReplayFile::Deleted
    })
}

/// Hook body for `save_replay_by_name`: clears an existing replay file out of the way itself, and
/// when that can't be done, reports the failure to the log and returns without calling the
/// original, which would raise a modal error dialog.
pub unsafe fn save_replay_by_name_hook(
    autosave: &ReplayAutosave,
    name: *const i8,
    replace_existing: u8,
    orig: unsafe extern "C" fn(*const i8, u8) -> i32,
) -> i32 {
    unsafe {
        if replace_existing == 0 {
            return orig(name, replace_existing);
        }
        let mut buffer = [0u8; REPLAY_PATH_BUFFER_SIZE];
        let built = (autosave.build_replay_file_path)(
            name,
            buffer.as_mut_ptr(),
            REPLAY_PATH_BUFFER_SIZE as u32,
        );
        if built == 0 {
            // No path to clear. The original builds the path again and takes its own no-path exit,
            // which is not the dialog branch.
            return orig(name, replace_existing);
        }
        let Some(path) = CStr::from_bytes_until_nul(&buffer)
            .ok()
            .and_then(|path| path.to_str().ok())
        else {
            warn!("Replay path was not valid UTF-8; leaving the replay autosave to SC:R");
            return orig(name, replace_existing);
        };
        match remove_replay_file(Path::new(path)) {
            Ok(RemovedReplayFile::DeletedAfterClearingReadOnly) => {
                info!("Cleared the read-only attribute on replay file {path} to replace it");
            }
            Ok(RemovedReplayFile::Deleted | RemovedReplayFile::NotPresent) => (),
            Err(error) => {
                warn!(
                    "Could not replace replay file {path}: {error}; skipping SC:R's replay autosave"
                );
                return REPLACE_FAILED;
            }
        }
        orig(name, replace_existing)
    }
}

/// Temporarily replaces concealed local-bot names in the serialized replay header. Live player
/// names stay unchanged, including when saving before gameplay has ended.
///
/// The header must remain valid throughout `save`, and this must run on the game thread while
/// nothing else mutates its player names. The mapping must use the randomized in-game player IDs.
pub unsafe fn with_replay_player_names<R>(
    header: *mut crate::bw::ReplayHeader,
    slots: &[crate::app_messages::PlayerInfo],
    mapping: &[crate::game_thread::PlayerIdMapping],
    save: impl FnOnce() -> R,
) -> R {
    if header.is_null() {
        return save();
    }
    unsafe {
        let players = std::ptr::addr_of_mut!((*header).players).cast::<crate::bw::Player>();
        let mut original = scopeguard::guard([None; 8], |names: [Option<[u8; 25]>; 8]| {
            for (id, name) in names.into_iter().enumerate() {
                if let Some(name) = name {
                    std::ptr::addr_of_mut!((*players.add(id)).name).write(name);
                }
            }
        });
        for slot in slots {
            let (Some(user_id), Some(name)) = (slot.user_id, slot.replay_name.as_deref()) else {
                continue;
            };
            if name.is_empty()
                || name.len() > 24
                || !name.bytes().all(|x| (0x20..=0x7e).contains(&x))
            {
                warn!("Ignoring invalid replay player name");
                continue;
            }
            let Some(id) = mapping
                .iter()
                .find(|player| player.sb_user_id == user_id)
                .and_then(|player| player.game_id)
                .map(|id| id.0 as usize)
                .filter(|&id| id < original.len())
            else {
                continue;
            };
            let ptr = std::ptr::addr_of_mut!((*players.add(id)).name);
            original[id].get_or_insert_with(|| ptr.read());
            let mut encoded = [0; 25];
            encoded[..name.len()].copy_from_slice(name.as_bytes());
            ptr.write(encoded);
        }
        save()
    }
}

/// The byte length of the longest prefix of a replay recording buffer that SC:R's replay writer
/// can walk to the end.
///
/// `data` is the recorded bytes (`data_start..data_length`): closed records of
/// `{u32 frame, u8 count, {u8 player, command...}*}` where the commands' lengths (from
/// `command_lengths`, the game's per-id table) sum to exactly `count`, followed by at most one
/// open record whose command bytes start at `open_record_start` and whose count byte has not been
/// written yet. The writer walks closed records by their count byte and each command by its
/// length, with no bounds check inside a record, and a command id its table has no length for
/// (length -1) leaves the walk stuck forever: a buffer that fails this walk hangs the game at the
/// first replay save. So this stops at the first record that does not parse — a count that
/// overruns the buffer, an unknown or zero-length command, or commands that do not sum to the
/// count — and returns the offset that record starts at, or `data.len()` when everything parses.
/// An open record whose commands do not parse is dropped whole (its header included).
pub fn consistent_recording_length(
    data: &[u8],
    open_record_start: Option<usize>,
    command_lengths: &[u32],
) -> usize {
    let closed_end = match open_record_start {
        // The open record's header is the 5 bytes before its command bytes; a pointer that
        // cannot be that (inside the header, or past the data) means no walkable open record.
        Some(start) if start >= 5 && start <= data.len() => start - 5,
        Some(_) => return 0,
        None => data.len(),
    };
    let mut offset = 0;
    while offset < closed_end {
        let Some(&count) = data.get(offset + 4) else {
            return offset;
        };
        let body_start = offset + 5;
        let body_end = body_start + count as usize;
        if body_end > closed_end {
            return offset;
        }
        if !commands_fill(&data[body_start..body_end], command_lengths) {
            return offset;
        }
        offset = body_end;
    }
    match open_record_start {
        Some(start) if commands_fill(&data[start..], command_lengths) => data.len(),
        Some(_) => closed_end,
        None => data.len(),
    }
}

/// Whether `body` is exactly a sequence of `{u8 player, command}` pairs with known lengths.
fn commands_fill(mut body: &[u8], command_lengths: &[u32]) -> bool {
    while !body.is_empty() {
        let Some(command) = body.get(1..) else {
            return false;
        };
        match command_length(command, command_lengths) {
            Some(length) if length > 0 && length <= command.len() => body = &command[length..],
            _ => return false,
        }
    }
    true
}

/// Cuts the recorder's buffer back to the longest prefix SC:R's replay writer can walk (see
/// [`consistent_recording_length`]), logging what was dropped. Called before every replay save:
/// the writer's walk has no bounds check and never returns from a malformed record, so a buffer
/// that fails the walk would hang the game instead of producing a replay. A record dropped here
/// loses its commands from the saved replay, which is the lesser harm. If the cut removes the
/// open record, the recorder is left as if no record were open, positioned so its next append
/// opens a fresh one.
///
/// # Safety
/// `replay` must be the game's live recorder, called on the game thread.
pub unsafe fn sanitize_recording(
    replay: *mut ReplayData,
    frame_count: u32,
    command_lengths: &[u32],
) {
    unsafe {
        if replay.is_null() || (*replay).recording == 0 || (*replay).data_start.is_null() {
            return;
        }
        let length = (*replay).data_length as usize;
        let data = std::slice::from_raw_parts((*replay).data_start, length);
        let open_record_start = if (*replay).current_frame_data_start.is_null() {
            None
        } else {
            Some((*replay).current_frame_data_start as usize - (*replay).data_start as usize)
        };
        let consistent = consistent_recording_length(data, open_record_start, command_lengths);
        if consistent >= length {
            return;
        }
        warn!(
            "Replay recording has {} unwalkable trailing bytes at offset {consistent} (open \
             record at {open_record_start:?}); dropping them so the replay save cannot hang",
            length - consistent,
        );
        (*replay).data_length = consistent as u32;
        if open_record_start.is_some_and(|start| start > consistent) {
            (*replay).current_frame_data_start = std::ptr::null_mut();
            (*replay).current_frame = frame_count.wrapping_sub(1);
        }
    }
}

/// Puts the recorder back into a state where its next append opens a record, after SC:R's replay
/// writer ran mid-game.
///
/// Before walking the buffer, the writer closes the open frame record (writing its count byte and
/// clearing `current_frame_data_start`) but leaves `current_frame` at the frame that record was
/// for. The recorder opens a record only when the game frame differs from `current_frame`; while
/// they still match, an append assumes the record it just closed is still open and writes bare
/// command bytes after it. Every save during a game leaves this trap armed until the frame
/// counter moves, and the stalled-quit path springs it: the upload replay is saved while a
/// network stall holds the frame counter still, and the leaves fabricated for the remote slots
/// are recorded right after, in that same frame, outside any record. The teardown's LastReplay
/// autosave then walks into them and hangs the game (see [`sanitize_recording`]). Moving
/// `current_frame` off the live frame makes the next append open a fresh record.
///
/// # Safety
/// `replay` must be the game's live recorder, called on the game thread.
pub unsafe fn rearm_recorder_after_save(replay: *mut ReplayData, frame_count: u32) {
    unsafe {
        if replay.is_null() || (*replay).recording == 0 {
            return;
        }
        if (*replay).current_frame_data_start.is_null() && (*replay).current_frame == frame_count {
            (*replay).current_frame = frame_count.wrapping_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    fn replay_name_slot(user: u32, name: Option<&str>) -> crate::app_messages::PlayerInfo {
        serde_json::from_value(serde_json::json!({
            "id": "test-slot", "userId": user, "replayName": name,
            "teamId": 0, "type": "human", "typeId": 6,
        }))
        .unwrap()
    }

    #[test]
    fn replay_names_follow_randomized_players_and_restore_after_failed_save() {
        use crate::app_messages::SbUserId;
        use crate::bw::players::BwPlayerId;
        use crate::game_thread::PlayerIdMapping;
        let mut header: crate::bw::ReplayHeader = unsafe { std::mem::zeroed() };
        header.players[5].name[..12].copy_from_slice(b"Practice bot");
        header.players[1].name[..14].copy_from_slice(b"Practice bot 2");
        header.players[0].name[..6].copy_from_slice(b"Player");
        let original = std::array::from_fn::<_, 12, _>(|i| header.players[i].name);
        let slots = [
            replay_name_slot(1, None),
            replay_name_slot(2, Some("ZZZKBot")),
            replay_name_slot(3, Some("ZZZKBot 2")),
        ];
        let mapping = [
            PlayerIdMapping {
                sb_user_id: SbUserId(1),
                game_id: Some(BwPlayerId(0)),
            },
            PlayerIdMapping {
                sb_user_id: SbUserId(2),
                game_id: Some(BwPlayerId(5)),
            },
            PlayerIdMapping {
                sb_user_id: SbUserId(3),
                game_id: Some(BwPlayerId(1)),
            },
        ];
        let ptr = &raw mut header;
        for result in [0, 1] {
            let saved = unsafe {
                with_replay_player_names(ptr, &slots, &mapping, || {
                    let first = (*ptr).players[5].name;
                    let second = (*ptr).players[1].name;
                    assert_eq!(&first[..8], b"ZZZKBot\0");
                    assert_eq!(&second[..10], b"ZZZKBot 2\0");
                    assert_eq!((*ptr).players[0].name, original[0]);
                    result
                })
            };
            assert_eq!(saved, result);
            assert_eq!(
                std::array::from_fn::<_, 12, _>(|i| header.players[i].name),
                original
            );
        }
    }

    #[test]
    fn replay_names_ignore_missing_invalid_and_unmapped_identities() {
        use crate::app_messages::SbUserId;
        use crate::bw::players::BwPlayerId;
        use crate::game_thread::PlayerIdMapping;
        let mut header: crate::bw::ReplayHeader = unsafe { std::mem::zeroed() };
        let ptr = &raw mut header;
        let mapping = [PlayerIdMapping {
            sb_user_id: SbUserId(2),
            game_id: Some(BwPlayerId(5)),
        }];
        for name in [
            None,
            Some(""),
            Some("non-ASCII: \u{e9}"),
            Some("bad\0name"),
            Some("1234567890123456789012345"),
        ] {
            let slots = [
                replay_name_slot(2, name),
                replay_name_slot(3, Some("No mapping")),
            ];
            unsafe {
                with_replay_player_names(ptr, &slots, &mapping, || {
                    assert_eq!(
                        std::array::from_fn::<_, 12, _>(|i| (*ptr).players[i].name),
                        [[0; 25]; 12]
                    );
                });
            }
        }
        for game_id in [None, Some(BwPlayerId(8)), Some(BwPlayerId(255))] {
            let mapping = [PlayerIdMapping {
                sb_user_id: SbUserId(2),
                game_id,
            }];
            unsafe {
                with_replay_player_names(
                    ptr,
                    &[replay_name_slot(2, Some("Observer"))],
                    &mapping,
                    || {
                        assert_eq!(
                            std::array::from_fn::<_, 12, _>(|i| (*ptr).players[i].name),
                            [[0; 25]; 12]
                        );
                    },
                );
            }
        }
    }

    /// A uniquely named directory under the system temp directory, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> TempDir {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "sb-replay-save-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            // Best effort: a test leaving an undeletable file behind shouldn't also panic in drop.
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn set_read_only(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn deletes_read_only_file() {
        let dir = TempDir::new();
        let path = dir.join("LastReplay.rep");
        fs::write(&path, b"replay").unwrap();
        set_read_only(&path);

        let result = remove_replay_file(&path).unwrap();

        assert_eq!(result, RemovedReplayFile::DeletedAfterClearingReadOnly);
        assert!(!path.exists());
    }

    #[test]
    fn deletes_writable_file() {
        let dir = TempDir::new();
        let path = dir.join("LastReplay.rep");
        fs::write(&path, b"replay").unwrap();

        let result = remove_replay_file(&path).unwrap();

        assert_eq!(result, RemovedReplayFile::Deleted);
        assert!(!path.exists());
    }

    #[test]
    fn missing_file_is_ok() {
        let dir = TempDir::new();
        let path = dir.join("LastReplay.rep");

        let result = remove_replay_file(&path).unwrap();

        assert_eq!(result, RemovedReplayFile::NotPresent);
    }

    #[test]
    fn undeletable_file_is_left_alone() {
        let dir = TempDir::new();
        let path = dir.join("LastReplay.rep");
        fs::write(&path, b"replay").unwrap();
        // Denying every sharing mode makes any further open, including the one a delete needs,
        // fail while this handle is alive.
        let handle = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();

        let error = remove_replay_file(&path).unwrap_err();

        assert!(path.exists(), "{error}");
        drop(handle);
    }

    /// A command-length table with only the ids these tests use: hotkey (0x13, 3 bytes), leave
    /// (0x57, 2 bytes), chat (0x5c, 82 bytes); everything else unknown, as SC:R's own table
    /// reports unknown ids.
    fn lengths() -> Vec<u32> {
        let mut table = vec![u32::MAX; 0x76];
        table[0x13] = 3;
        table[0x57] = 2;
        table[0x5c] = 82;
        table
    }

    fn record(frame: u32, commands: &[&[u8]]) -> Vec<u8> {
        let mut out = frame.to_le_bytes().to_vec();
        let body: Vec<u8> = commands.iter().flat_map(|c| c.iter().copied()).collect();
        out.push(body.len() as u8);
        out.extend(body);
        out
    }

    const HOTKEY: &[u8] = &[0x00, 0x13, 0x00, 0x00];
    const LEAVE: &[u8] = &[0x01, 0x57, 0x03];

    #[test]
    fn consistent_recording_length_accepts_closed_and_open_records() {
        let mut data = record(424, &[HOTKEY]);
        data.extend(record(425, &[HOTKEY, HOTKEY]));
        assert_eq!(
            consistent_recording_length(&data, None, &lengths()),
            data.len()
        );

        // An open record: header written, count byte still stale, commands appended after it.
        let open_start = data.len() + 5;
        data.extend(record(426, &[]));
        data.extend(LEAVE);
        assert_eq!(
            consistent_recording_length(&data, Some(open_start), &lengths()),
            data.len()
        );
    }

    #[test]
    fn consistent_recording_length_stops_at_bare_command_bytes_after_the_last_record() {
        // The stalled-quit shape: a closed record, then a leave appended without a header.
        let closed = record(425, &[HOTKEY]);
        let mut data = closed.clone();
        data.extend(LEAVE);
        assert_eq!(
            consistent_recording_length(&data, None, &lengths()),
            closed.len()
        );
    }

    #[test]
    fn consistent_recording_length_stops_at_a_record_that_does_not_parse() {
        let first = record(10, &[HOTKEY]);
        let mut data = first.clone();
        // Count says 4 bytes, but the command id is unknown to the table.
        data.extend(record(11, &[&[0x00, 0x42, 0x00, 0x00]]));
        data.extend(record(12, &[HOTKEY]));
        assert_eq!(
            consistent_recording_length(&data, None, &lengths()),
            first.len()
        );

        // A count that overruns the buffer.
        let mut data = first.clone();
        data.extend([13, 0, 0, 0, 40, 0x00, 0x13]);
        assert_eq!(
            consistent_recording_length(&data, None, &lengths()),
            first.len()
        );

        // Commands that end short of the count.
        let mut data = first.clone();
        data.extend([14, 0, 0, 0, 5, 0x00, 0x13, 0x00, 0x00, 0x00]);
        assert_eq!(
            consistent_recording_length(&data, None, &lengths()),
            first.len()
        );
    }

    #[test]
    fn consistent_recording_length_drops_an_open_record_that_does_not_parse() {
        let closed = record(30, &[HOTKEY]);
        let mut data = closed.clone();
        let open_start = data.len() + 5;
        data.extend(record(31, &[]));
        data.extend([0x00, 0x13, 0x00]); // truncated hotkey
        assert_eq!(
            consistent_recording_length(&data, Some(open_start), &lengths()),
            closed.len()
        );
        // A pointer that cannot be an open record's command start walks nothing.
        assert_eq!(consistent_recording_length(&data, Some(2), &lengths()), 0);
    }

    #[test]
    fn sanitize_recording_cuts_the_buffer_and_closes_a_removed_open_record() {
        let closed = record(425, &[HOTKEY]);
        let mut buffer = closed.clone();
        let open_start = buffer.len() + 5;
        buffer.extend(record(426, &[]));
        buffer.extend([0x00, 0x13]);
        let mut replay = ReplayData {
            recording: 1,
            playing_back: 0,
            data_start: buffer.as_mut_ptr(),
            data_length: buffer.len() as u32,
            data_capacity: buffer.len() as u32,
            current_frame_data_start: unsafe { buffer.as_mut_ptr().add(open_start) },
            current_frame: 426,
            data_pos: std::ptr::null_mut(),
        };
        unsafe { sanitize_recording(&mut replay, 426, &lengths()) };
        assert_eq!(replay.data_length as usize, closed.len());
        assert!(replay.current_frame_data_start.is_null());
        assert_eq!(replay.current_frame, 425);

        // A clean buffer is left alone.
        let mut clean = closed.clone();
        let mut replay = ReplayData {
            recording: 1,
            playing_back: 0,
            data_start: clean.as_mut_ptr(),
            data_length: clean.len() as u32,
            data_capacity: clean.len() as u32,
            current_frame_data_start: std::ptr::null_mut(),
            current_frame: 425,
            data_pos: std::ptr::null_mut(),
        };
        unsafe { sanitize_recording(&mut replay, 500, &lengths()) };
        assert_eq!(replay.data_length as usize, closed.len());
        assert_eq!(replay.current_frame, 425);
    }

    #[test]
    fn rearm_recorder_after_save_moves_current_frame_off_the_live_frame() {
        let mut buffer = record(425, &[HOTKEY]);
        let mut replay = ReplayData {
            recording: 1,
            playing_back: 0,
            data_start: buffer.as_mut_ptr(),
            data_length: buffer.len() as u32,
            data_capacity: buffer.len() as u32,
            current_frame_data_start: std::ptr::null_mut(),
            current_frame: 425,
            data_pos: std::ptr::null_mut(),
        };
        // The writer closed the record for frame 425 while the game still sits at frame 425.
        unsafe { rearm_recorder_after_save(&mut replay, 425) };
        assert_eq!(replay.current_frame, 424);

        // A recorder whose frame already moved on, or with a record still open, is untouched.
        replay.current_frame = 425;
        unsafe { rearm_recorder_after_save(&mut replay, 426) };
        assert_eq!(replay.current_frame, 425);
        replay.current_frame_data_start = buffer.as_mut_ptr();
        unsafe { rearm_recorder_after_save(&mut replay, 425) };
        assert_eq!(replay.current_frame, 425);
        // Not recording (a replay being played back): nothing to re-arm.
        replay.current_frame_data_start = std::ptr::null_mut();
        replay.recording = 0;
        unsafe { rearm_recorder_after_save(&mut replay, 425) };
        assert_eq!(replay.current_frame, 425);
    }
}
