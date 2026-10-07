//! Forwards everything the process prints to stdout/stderr into the log.
//!
//! SC:R's renderer reports its failures (a failed Present, a failed texture creation, a removed
//! D3D device, ...) only by printing `prism: ...` lines to the CRT's stdout, which a GUI process
//! normally has nowhere to send. StarCraft links the CRT statically and binds CRT stdio to the
//! process's standard handles during its own startup, so pointing those handles at a pipe before
//! that startup runs (i.e. from `OnInject`) makes everything it prints readable here.

use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::os::windows::io::{FromRawHandle, RawHandle};
use std::ptr::null_mut;

use hashbrown::HashMap;
use winapi::um::handleapi::CloseHandle;
use winapi::um::namedpipeapi::CreatePipe;
use winapi::um::processenv::SetStdHandle;
use winapi::um::winbase::{STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};

/// Large enough that a burst of output doesn't block the printing thread (usually the game's main
/// thread) while the reader is busy writing to the log.
const PIPE_BUFFER_SIZE: u32 = 0x10000;
/// Bounds the memory spent remembering how often each distinct line has been seen.
const MAX_TRACKED_LINES: usize = 1024;

/// Must be called before StarCraft's CRT initializes, and after logging has been set up.
pub fn init() {
    match unsafe { redirect_std_handles() } {
        Ok(reader) => {
            let result = std::thread::Builder::new()
                .name("scr-stdout".into())
                .spawn(move || forward_lines(reader));
            if let Err(e) = result {
                error!("Couldn't start the stdout forwarding thread: {e}");
            }
        }
        Err(e) => error!("Couldn't redirect stdout to the log: {e}"),
    }
}

/// Points the process's stdout and stderr at a new pipe and returns its read end. The write end
/// stays open for the rest of the process's life, as the CRT keeps writing to it.
unsafe fn redirect_std_handles() -> io::Result<File> {
    unsafe {
        let mut read = null_mut();
        let mut write = null_mut();
        if CreatePipe(&mut read, &mut write, null_mut(), PIPE_BUFFER_SIZE) == 0 {
            return Err(io::Error::last_os_error());
        }
        let reader = File::from_raw_handle(read as RawHandle);
        if SetStdHandle(STD_OUTPUT_HANDLE, write) == 0 {
            let error = io::Error::last_os_error();
            CloseHandle(write);
            return Err(error);
        }
        if SetStdHandle(STD_ERROR_HANDLE, write) == 0 {
            // stdout already uses the pipe, so the write end has to stay open regardless.
            warn!(
                "Couldn't redirect stderr to the log: {}",
                io::Error::last_os_error()
            );
        }
        Ok(reader)
    }
}

/// Logs each line read from `reader`. A line that keeps repeating (e.g. one printed every frame)
/// is logged again only when its count reaches a power of two, so it can't flood the log while
/// the counts still show how fast it was recurring.
fn forward_lines(reader: File) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    let mut seen_counts: HashMap<Vec<u8>, u32> = HashMap::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => (),
            Err(e) => {
                error!("Reading redirected stdout failed: {e}");
                break;
            }
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }

        let count = match seen_counts.get_mut(&line) {
            Some(count) => {
                *count = count.saturating_add(1);
                *count
            }
            None => {
                if seen_counts.len() >= MAX_TRACKED_LINES {
                    seen_counts.clear();
                }
                seen_counts.insert(line.clone(), 1);
                1
            }
        };
        if count.is_power_of_two() {
            let text = String::from_utf8_lossy(&line);
            if count == 1 {
                info!("SC:R stdout: {text}");
            } else {
                info!("SC:R stdout: {text} (seen {count} times)");
            }
        }
    }
}
