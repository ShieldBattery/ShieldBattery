//! Writes the log file from a thread of its own, so that a thread logging never waits on the disk.
//!
//! A write to the log file takes as long as the volume it is on makes it take, which is seconds
//! when something else keeps that volume busy or holds its writes. Made by the thread that logged
//! the line, such a write freezes the game for as long: its main thread logs from inside its steps.
//! So a log call only formats its line and adds it to the lines waiting, and the writer thread
//! writes whatever has collected.
//!
//! The game's startup doesn't tolerate other threads running alongside it, so the writer thread
//! only starts once the DLL may start one (see `scr_init`). Lines logged before that are written
//! by the threads logging them.
//!
//! Lines still waiting when the process ends are lost, so everything that ends it waits briefly
//! for the writer first (see [`flush`]): the crash handler before its breadcrumbs, which go
//! straight to the file, and the hooks every exit passes through. A process killed from outside
//! loses the lines waiting at that moment, which is normally none.
//!
//! Log calls come from every thread, among them the loader's workers that have no thread-local
//! storage (see `windows::thread_has_tls`), so nothing a log call does here may use thread-locals.
//! [`flush`] runs inside the crash handler, so it also takes no lock and doesn't allocate.

use std::fmt;
use std::fs::File;
use std::io::{self, Write};
use std::mem;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use winapi::um::processthreadsapi::GetCurrentThreadId;
use winapi::um::synchapi::{CreateEventW, SetEvent, WaitForSingleObject};
use winapi::um::winbase::{INFINITE, WAIT_OBJECT_0};
use winapi::um::winnt::HANDLE;

/// How much text may wait for the writer thread. Lines logged past it are dropped and counted, so
/// a log file that can't be written for a long time doesn't take the process' memory with it.
const MAX_WAITING_BYTES: usize = 4 * 1024 * 1024;
/// A write taking at least this long gets a line of its own saying so.
const SLOW_WRITE: Duration = Duration::from_millis(50);

static WRITER: OnceLock<LogWriter> = OnceLock::new();

type Sink = Box<dyn Write + Send>;

struct LogWriter {
    state: Mutex<State>,
    /// Auto-reset event (as HANDLE) telling the writer thread that lines are waiting, 0 if it
    /// couldn't be created.
    wake: usize,
    max_waiting_bytes: usize,
    /// How many lines have been handed to the writer thread, and how many of them it has
    /// finished writing.
    queued: AtomicU64,
    written: AtomicU64,
    /// The writer thread's id, 0 while it isn't running.
    thread_id: AtomicU32,
}

struct State {
    /// Where lines go, until the writer thread takes it over. While it is here, log calls write
    /// their own lines.
    sink: Option<Sink>,
    /// The lines waiting for the writer thread, each ending in a newline.
    waiting: String,
    waiting_lines: u64,
    /// How many lines were dropped since the writer thread last looked.
    dropped: u64,
}

impl LogWriter {
    fn new(sink: Sink, max_waiting_bytes: usize) -> LogWriter {
        let wake = unsafe { CreateEventW(null_mut(), 0, 0, null_mut()) };
        LogWriter {
            state: Mutex::new(State {
                sink: Some(sink),
                waiting: String::new(),
                waiting_lines: 0,
                dropped: 0,
            }),
            wake: wake as usize,
            max_waiting_bytes,
            queued: AtomicU64::new(0),
            written: AtomicU64::new(0),
            thread_id: AtomicU32::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn log(&self, line: fmt::Arguments<'_>) {
        // Formatted before the lock is taken: what a logged value's formatting does and how long
        // it takes is up to the value.
        let mut line = line.to_string();
        line.push('\n');
        let first_waiting = {
            let mut state = self.lock();
            if let Some(sink) = &mut state.sink {
                let _ = sink.write_all(line.as_bytes());
                return;
            }
            if state.waiting.len() + line.len() > self.max_waiting_bytes {
                state.dropped += 1;
                return;
            }
            let first_waiting = state.waiting.is_empty();
            state.waiting.push_str(&line);
            state.waiting_lines += 1;
            self.queued.fetch_add(1, Ordering::Release);
            first_waiting
        };
        // The writer thread was already told about lines that were waiting before this one.
        if first_waiting {
            unsafe {
                SetEvent(self.wake as HANDLE);
            }
        }
    }

    /// Starts the writer thread, which takes over writing once it runs.
    fn start_thread(&'static self) -> io::Result<()> {
        if self.wake == 0 {
            return Err(io::Error::other("no event to wake the thread with"));
        }
        std::thread::Builder::new()
            .name("sb-log-writer".into())
            .spawn(move || {
                crate::crash_dump::reserve_exception_handler_stack();
                self.thread_id
                    .store(unsafe { GetCurrentThreadId() }, Ordering::Release);
                let sink = self.lock().sink.take();
                if let Some(sink) = sink {
                    self.write_waiting_lines(sink);
                }
            })
            .map(|_| ())
    }

    /// The writer thread's body.
    fn write_waiting_lines(&self, mut sink: Sink) -> ! {
        let mut batch = String::new();
        loop {
            if unsafe { WaitForSingleObject(self.wake as HANDLE, INFINITE) } != WAIT_OBJECT_0 {
                std::thread::sleep(Duration::from_millis(10));
            }
            let (lines, dropped) = {
                let mut state = self.lock();
                mem::swap(&mut state.waiting, &mut batch);
                (
                    mem::take(&mut state.waiting_lines),
                    mem::take(&mut state.dropped),
                )
            };
            if lines != 0 {
                let start = Instant::now();
                let _ = sink.write_all(batch.as_bytes());
                let took = start.elapsed();
                batch.clear();
                self.written.fetch_add(lines, Ordering::Release);
                if took >= SLOW_WRITE {
                    warn!(
                        "Writing {lines} lines to the log file took {} ms; lines logged in that \
                         time were written after it",
                        took.as_millis(),
                    );
                }
            }
            if dropped != 0 {
                warn!(
                    "{dropped} log lines were dropped: over {} bytes of them were waiting for the \
                     log file to be written",
                    self.max_waiting_bytes,
                );
            }
        }
    }

    fn flush(&self, timeout: Duration) -> bool {
        let target = self.queued.load(Ordering::Acquire);
        let done = || self.written.load(Ordering::Acquire) >= target;
        if done() {
            return true;
        }
        // The writer thread can't wait for itself.
        if self.thread_id.load(Ordering::Acquire) == unsafe { GetCurrentThreadId() } {
            return false;
        }
        let start = Instant::now();
        loop {
            if done() {
                return true;
            }
            if start.elapsed() >= timeout {
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

/// Sets `file` as where log lines go. Until [`start_thread`], each log call writes its own line.
pub fn init(file: File) {
    let _ = WRITER.set(LogWriter::new(Box::new(file), MAX_WAITING_BYTES));
}

/// Logs one formatted line, without its newline.
pub fn log(line: fmt::Arguments<'_>) {
    if let Some(writer) = WRITER.get() {
        writer.log(line);
    }
}

/// Starts the thread that writes the log file from then on. If it can't be started, log calls
/// keep writing their own lines.
pub fn start_thread() {
    let Some(writer) = WRITER.get() else {
        return;
    };
    if let Err(e) = writer.start_thread() {
        error!("Couldn't start the log writer thread, so threads write their own log lines: {e}");
    }
}

/// Waits until every line logged before this call is in the log file, for at most `timeout`.
/// Returns whether they all are.
///
/// Safe to call from the crash handler and on a thread that is ending the process: it takes no
/// lock, doesn't allocate and uses no thread-locals.
pub fn flush(timeout: Duration) -> bool {
    match WRITER.get() {
        Some(writer) => writer.flush(timeout),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// A sink collecting what is written to it, whose writes wait for as long as the test holds
    /// `gate`.
    #[derive(Clone, Default)]
    struct TestSink {
        written: Arc<Mutex<Vec<u8>>>,
        gate: Arc<Mutex<()>>,
    }

    impl TestSink {
        fn text(&self) -> String {
            String::from_utf8(self.written.lock().unwrap().clone()).unwrap()
        }
    }

    impl Write for TestSink {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let _gate = self.gate.lock().unwrap();
            self.written.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn writer(sink: &TestSink, max_waiting_bytes: usize) -> &'static LogWriter {
        Box::leak(Box::new(LogWriter::new(
            Box::new(sink.clone()),
            max_waiting_bytes,
        )))
    }

    /// Starts the writer thread and waits until it has taken over writing.
    fn start(writer: &'static LogWriter) {
        writer.start_thread().unwrap();
        wait_until(|| writer.lock().sink.is_none());
    }

    fn wait_until(mut condition: impl FnMut() -> bool) {
        let start = Instant::now();
        while !condition() {
            assert!(start.elapsed() < Duration::from_secs(10), "timed out");
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn lines_logged_before_the_thread_starts_are_written_by_the_call() {
        let sink = TestSink::default();
        let writer = writer(&sink, MAX_WAITING_BYTES);
        writer.log(format_args!("one"));
        writer.log(format_args!("two {}", 2));
        assert_eq!(sink.text(), "one\ntwo 2\n");
        assert!(writer.flush(Duration::ZERO));
    }

    #[test]
    fn the_thread_writes_lines_in_the_order_they_were_logged() {
        let sink = TestSink::default();
        let writer = writer(&sink, MAX_WAITING_BYTES);
        writer.log(format_args!("before"));
        start(writer);
        let mut expected = String::from("before\n");
        for i in 0..1000 {
            writer.log(format_args!("line {i}"));
            expected.push_str(&format!("line {i}\n"));
        }
        assert!(writer.flush(Duration::from_secs(10)));
        assert_eq!(sink.text(), expected);
    }

    #[test]
    fn a_write_that_blocks_doesnt_block_log_calls() {
        let sink = TestSink::default();
        let writer = writer(&sink, MAX_WAITING_BYTES);
        start(writer);
        let gate = sink.gate.lock().unwrap();
        for i in 0..10 {
            writer.log(format_args!("line {i}"));
        }
        assert!(!writer.flush(Duration::from_millis(20)));
        assert_eq!(sink.text(), "");
        drop(gate);
        assert!(writer.flush(Duration::from_secs(10)));
        let expected: String = (0..10).map(|i| format!("line {i}\n")).collect();
        assert_eq!(sink.text(), expected);
    }

    #[test]
    fn lines_past_the_limit_are_dropped_and_counted() {
        let sink = TestSink::default();
        // Room for two of the lines logged below.
        let writer = writer(&sink, 16);
        start(writer);
        let gate = sink.gate.lock().unwrap();
        // The writer thread takes this one and blocks writing it.
        writer.log(format_args!("first"));
        wait_until(|| writer.lock().waiting_lines == 0);
        for i in 0..5 {
            writer.log(format_args!("line {i}"));
        }
        assert_eq!(writer.lock().dropped, 3);
        drop(gate);
        assert!(writer.flush(Duration::from_secs(10)));
        assert_eq!(sink.text(), "first\nline 0\nline 1\n");
    }
}
