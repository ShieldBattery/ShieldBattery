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

#[cfg(test)]
mod tests {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

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
}
