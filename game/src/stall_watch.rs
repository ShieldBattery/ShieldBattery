//! Notices the game's main thread making no progress, and logs where every thread in the process
//! was at the time, so that a load or game that hangs leaves a trace of what it hung in.
//!
//! The main thread counts its progress with [`beat`] from places it passes through many times a
//! second while it runs normally: the message pump, the window procedure, file opens and simulation
//! steps. Where it waits on purpose (for the next request from the async thread, for window
//! messages, in a modal loop Windows runs on it) it holds an [`idle`] guard, and such a wait is
//! never a stall. A watch thread looks once a second. When [`STALL_REPORT_TICKS`] looks in a row
//! find neither progress nor an intentional wait, it logs the stack of every thread, and at
//! [`STALL_FOLLOW_UP_TICKS`] the main thread's again.
//!
//! The watch counts its looks rather than measuring time, so a system suspend or a debugger
//! pausing the process never looks like a stall.

use std::fmt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::{GetCurrentProcessId, GetCurrentThreadId, OpenThread};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use winapi::um::winnt::{
    HANDLE, THREAD_GET_CONTEXT, THREAD_QUERY_INFORMATION, THREAD_SUSPEND_RESUME,
};

use crate::crash_dump::{CodeAddress, MappedCodeAddress};
use crate::thread_stack::{CodeRanges, StackBounds, StackCopy};

/// How often the watch thread looks at the main thread.
const TICK: Duration = Duration::from_secs(1);
/// Looks in a row without progress after which every thread's stack is logged.
const STALL_REPORT_TICKS: u32 = 10;
/// Looks in a row without progress after which the main thread's stack is logged again.
const STALL_FOLLOW_UP_TICKS: u32 = 30;
/// Most stalls per process whose stacks are logged.
const MAX_STALL_REPORTS: u32 = 3;
/// Bytes of each thread's stack copied, from its stack pointer up.
const STACK_COPY_BYTES: usize = 64 * 1024;
/// Most frames logged per thread.
const MAX_FRAMES: usize = 32;
/// Most threads whose stacks are logged at once.
const MAX_THREADS: usize = 128;

/// Thread id of the game's main thread, 0 until the watch starts.
static MAIN_THREAD_ID: AtomicU32 = AtomicU32::new(0);
/// Counts the main thread's progress; only changes matter.
static BEATS: AtomicU32 = AtomicU32::new(0);
/// Intentional waits the main thread is in.
static IDLE_WAITS: AtomicU32 = AtomicU32::new(0);
static LOAD_END_LOGGED: AtomicBool = AtomicBool::new(false);
static WATCH: OnceLock<Watch> = OnceLock::new();

/// Counts progress of the main thread. Does nothing on other threads.
#[inline]
pub fn beat() {
    if is_main_thread() {
        BEATS.fetch_add(1, Ordering::Relaxed);
    }
}

fn is_main_thread() -> bool {
    MAIN_THREAD_ID.load(Ordering::Relaxed) == unsafe { GetCurrentThreadId() }
}

/// Marks the main thread as waiting on purpose until the guard is dropped, so the wait doesn't
/// count as a stall. Does nothing on other threads.
pub fn idle() -> Idle {
    let counted = is_main_thread();
    if counted {
        IDLE_WAITS.fetch_add(1, Ordering::Relaxed);
    }
    Idle { counted }
}

pub struct Idle {
    counted: bool,
}

impl Drop for Idle {
    fn drop(&mut self) {
        if self.counted {
            IDLE_WAITS.fetch_sub(1, Ordering::Relaxed);
            BEATS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Whether the main thread is in a wait it means to be in: one marked with [`idle`], or a modal
/// size, move or menu loop, which Windows runs on it until the user lets go.
fn main_thread_idle() -> bool {
    IDLE_WAITS.load(Ordering::Relaxed) != 0 || crate::forge::in_size_move_menu_loop()
}

type GetThreadDescriptionFn = unsafe extern "system" fn(HANDLE, *mut *mut u16) -> i32;

struct Watch {
    /// A handle to the main thread with the access [`StackCopy::capture`] and [`StackBounds`]
    /// need.
    main_thread: OwnedHandle,
    main_thread_id: u32,
    stack_bounds: StackBounds,
    /// Missing on systems older than Windows 10 1607, and in older Wine.
    get_thread_description: Option<GetThreadDescriptionFn>,
    /// The beat count the watch last saw change, and when.
    progress_seen: Mutex<(u32, Instant)>,
    /// Held while stacks are captured, so that two captures never suspend threads at once.
    capturing: Mutex<()>,
}

/// Starts watching the calling thread, which must be the game's main thread, for stalls.
pub fn start() {
    let main_thread_id = unsafe { GetCurrentThreadId() };
    let Some(main_thread) = open_thread(main_thread_id) else {
        error!(
            "Couldn't open the main thread to watch it for stalls: {}",
            std::io::Error::last_os_error()
        );
        return;
    };
    let Some(stack_bounds) = StackBounds::resolve() else {
        error!("Couldn't find what watching for stalls needs from ntdll");
        return;
    };
    // GetThreadDescription is in kernelbase, and kernel32 forwards to it on newer systems.
    let get_thread_description = ["kernelbase", "kernel32"].iter().find_map(|name| {
        let library = crate::windows::load_library(name).ok()?;
        let function = library.proc_address("GetThreadDescription").ok()?;
        // Both stay loaded for the whole process.
        drop(library);
        Some(unsafe {
            std::mem::transmute::<winapi::shared::minwindef::FARPROC, GetThreadDescriptionFn>(
                function,
            )
        })
    });
    let watch = Watch {
        main_thread,
        main_thread_id,
        stack_bounds,
        get_thread_description,
        progress_seen: Mutex::new((BEATS.load(Ordering::Relaxed), Instant::now())),
        capturing: Mutex::new(()),
    };
    if WATCH.set(watch).is_err() {
        error!("Stall watch started twice");
        return;
    }
    MAIN_THREAD_ID.store(main_thread_id, Ordering::Relaxed);
    let spawned = std::thread::Builder::new()
        .name("sb-stall-watch".into())
        .spawn(watch_loop);
    match spawned {
        Ok(_) => info!("Watching main thread {main_thread_id:#x} for stalls"),
        Err(e) => error!("Couldn't start the stall watch thread: {e}"),
    }
}

fn open_thread(id: u32) -> Option<OwnedHandle> {
    let handle = unsafe {
        OpenThread(
            THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION,
            0,
            id,
        )
    };
    (!handle.is_null()).then(|| unsafe { OwnedHandle::from_raw_handle(handle as _) })
}

fn watch_loop() {
    let Some(watch) = WATCH.get() else {
        return;
    };
    let mut counter = StallCounter::new(BEATS.load(Ordering::Relaxed));
    let mut stall_start_stack = None;
    loop {
        std::thread::sleep(TICK);
        let beats = BEATS.load(Ordering::Relaxed);
        {
            let mut seen = watch
                .progress_seen
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if seen.0 != beats {
                *seen = (beats, Instant::now());
            }
        }
        match counter.tick(beats, main_thread_idle()) {
            None => (),
            Some(StallEvent::Stalled { log_stacks: false }) => {
                info!(
                    "Main thread made no progress for {STALL_REPORT_TICKS} s (stacks not logged \
                     again after {MAX_STALL_REPORTS} stalls)"
                );
            }
            Some(StallEvent::Stalled { log_stacks: true }) => {
                let stacks = watch.capture_stacks(true);
                log_stacks(
                    &format!("Main thread made no progress for {STALL_REPORT_TICKS} s."),
                    &stacks,
                );
                stall_start_stack = stacks.into_iter().next().and_then(|x| x.frames);
            }
            Some(StallEvent::StillStalled) => {
                let stacks = watch.capture_stacks(false);
                let (described, _) = describe_stacks(&stacks);
                if let (Some(main), Some(description)) = (stacks.first(), described.first()) {
                    let change = match main.frames == stall_start_stack {
                        true => "is unchanged",
                        false => "changed",
                    };
                    info!(
                        "Main thread still made no progress after {STALL_FOLLOW_UP_TICKS} s; its \
                         stack {change}: {description}",
                    );
                }
            }
            Some(StallEvent::Resumed { ticks }) => {
                info!("Main thread made progress again after about {ticks} s without any");
            }
        }
    }
}

/// Logs every thread's stack once, if the game is quitting before it started, along with when the
/// main thread last made progress. Call from the thread handling the quit, not the main thread.
pub fn log_load_ended_before_start() {
    let Some(watch) = WATCH.get() else {
        return;
    };
    if LOAD_END_LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    let (seen_beats, seen_at) = *watch
        .progress_seen
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let last_progress = match BEATS.load(Ordering::Relaxed) == seen_beats {
        true => format!("about {} s ago", seen_at.elapsed().as_secs()),
        false => "within the last second".to_owned(),
    };
    let waiting = match main_thread_idle() {
        true => "is",
        false => "is not",
    };
    let stacks = watch.capture_stacks(true);
    log_stacks(
        &format!(
            "Game load ended before the game started. The main thread last made progress \
             {last_progress} and {waiting} in an intentional wait."
        ),
        &stacks,
    );
}

/// Logs `headline` and a stack per line, the first stack on the headline's line.
fn log_stacks(headline: &str, stacks: &[ThreadStack]) {
    let main_thread_id = MAIN_THREAD_ID.load(Ordering::Relaxed);
    let (described, loader_names) = describe_stacks(stacks);
    let mut headline = Some(match loader_names {
        true => headline.to_owned(),
        false => format!(
            "{headline} Modules are named from the memory map, as another thread holds the \
             loader's lock."
        ),
    });
    for (stack, description) in stacks.iter().zip(&described) {
        let kind = match stack.id == main_thread_id {
            true => "main thread",
            false => "thread",
        };
        match headline.take() {
            Some(headline) => info!("{headline} Stack of {kind} {description}"),
            None => info!("Stack of {kind} {description}"),
        }
    }
    if let Some(headline) = headline {
        info!("{headline}");
    }
}

/// Each stack as text (see [`ThreadStack::describe`]), with the modules named by the loader, and
/// whether they are: when another thread keeps the loader's lock, they're named from the memory map
/// instead.
fn describe_stacks(stacks: &[ThreadStack]) -> (Vec<String>, bool) {
    let describe = |names| {
        stacks
            .iter()
            .map(|x| x.describe(names).to_string())
            .collect()
    };
    match crate::crash_dump::with_loader_lock(|| describe(ModuleNames::Loader)) {
        Some(described) => (described, true),
        None => (describe(ModuleNames::MemoryMap), false),
    }
}

/// A thread's call stack as captured, for logging.
struct ThreadStack {
    id: u32,
    name: Option<String>,
    /// Innermost first; `None` when the thread couldn't be captured.
    frames: Option<Vec<usize>>,
}

/// Where the modules in a stack's description get their names from.
#[derive(Clone, Copy)]
enum ModuleNames {
    /// The loader, see [`CodeAddress`].
    Loader,
    /// The memory map, see [`MappedCodeAddress`].
    MemoryMap,
}

impl ThreadStack {
    /// `<id> (<name>): <frames>`.
    fn describe(&self, names: ModuleNames) -> impl fmt::Display + '_ {
        StackDescription(self, names)
    }
}

struct StackDescription<'a>(&'a ThreadStack, ModuleNames);

impl fmt::Display for StackDescription<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stack = self.0;
        write!(f, "{:#x}", stack.id)?;
        if let Some(name) = &stack.name {
            write!(f, " ({name})")?;
        }
        f.write_str(": ")?;
        match &stack.frames {
            None => f.write_str("not captured"),
            Some(frames) => {
                for (i, &frame) in frames.iter().enumerate() {
                    if i != 0 {
                        f.write_str(" < ")?;
                    }
                    match self.1 {
                        ModuleNames::Loader => write!(f, "{}", CodeAddress(frame))?,
                        ModuleNames::MemoryMap => write!(f, "{}", MappedCodeAddress(frame))?,
                    }
                }
                Ok(())
            }
        }
    }
}

/// A thread about to be captured: everything a capture needs, prepared before anything is
/// suspended.
struct CaptureTarget {
    id: u32,
    /// `None` for the main thread, whose handle the watch keeps.
    owned: Option<OwnedHandle>,
    handle: HANDLE,
    stack: Option<(usize, usize)>,
    copy: StackCopy,
    captured: bool,
}

impl Watch {
    /// Captures the main thread's stack and, with `all_threads`, those of every other thread but
    /// the calling one. The main thread comes first.
    fn capture_stacks(&self, all_threads: bool) -> Vec<ThreadStack> {
        let _capturing = self
            .capturing
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let current = unsafe { GetCurrentThreadId() };
        let mut targets = Vec::new();
        if self.main_thread_id != current {
            targets.push(CaptureTarget {
                id: self.main_thread_id,
                owned: None,
                handle: self.main_thread.as_raw_handle() as HANDLE,
                stack: self
                    .stack_bounds
                    .of(self.main_thread.as_raw_handle() as HANDLE),
                copy: StackCopy::new(STACK_COPY_BYTES),
                captured: false,
            });
        }
        if all_threads {
            let others = process_thread_ids()
                .into_iter()
                .filter(|&id| id != current && id != self.main_thread_id)
                .take(MAX_THREADS.saturating_sub(targets.len()));
            for id in others {
                // A thread that has exited since the snapshot can't be opened.
                let Some(owned) = open_thread(id) else {
                    continue;
                };
                let handle = owned.as_raw_handle() as HANDLE;
                targets.push(CaptureTarget {
                    id,
                    stack: self.stack_bounds.of(handle),
                    owned: Some(owned),
                    handle,
                    copy: StackCopy::new(STACK_COPY_BYTES),
                    captured: false,
                });
            }
        }
        // Every thread is suspended, copied and resumed in turn before any is walked, named or
        // logged: while a thread is suspended, nothing may allocate, log or take a lock (see
        // `thread_stack`). The log writer and the async runtime's threads get suspended like any
        // other, which is harmless as nothing is logged until all of them run again.
        for target in &mut targets {
            target.captured = unsafe {
                target
                    .copy
                    .capture(target.handle, target.stack.unwrap_or((0, 0)))
            };
        }
        let code = CodeRanges::executable_memory();
        targets
            .into_iter()
            .map(|mut target| {
                let frames = target.captured.then(|| {
                    let mut frames = Vec::with_capacity(MAX_FRAMES);
                    target
                        .copy
                        .walk(&code, MAX_FRAMES, |address, _| frames.push(address));
                    frames
                });
                let name = self.thread_name(target.handle);
                drop(target.owned);
                ThreadStack {
                    id: target.id,
                    name,
                    frames,
                }
            })
            .collect()
    }

    /// The name `thread` was given, if any. `thread` needs `THREAD_QUERY_LIMITED_INFORMATION`
    /// access.
    fn thread_name(&self, thread: HANDLE) -> Option<String> {
        let get_thread_description = self.get_thread_description?;
        unsafe {
            let mut name = std::ptr::null_mut();
            if get_thread_description(thread, &mut name) < 0 || name.is_null() {
                return None;
            }
            let len = (0..).take_while(|&i| *name.add(i) != 0).count();
            let result = String::from_utf16_lossy(std::slice::from_raw_parts(name, len));
            winapi::um::winbase::LocalFree(name as *mut _);
            (!result.is_empty()).then_some(result)
        }
    }
}

/// Ids of every thread in this process.
fn process_thread_ids() -> Vec<u32> {
    let mut ids = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return ids;
        }
        let process = GetCurrentProcessId();
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = size_of::<THREADENTRY32>() as u32;
        let mut ok = Thread32First(snapshot, &mut entry) != 0;
        while ok {
            if entry.th32OwnerProcessID == process {
                ids.push(entry.th32ThreadID);
            }
            ok = Thread32Next(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    ids
}

/// Counts the watch's looks at the main thread and decides what each one reports.
struct StallCounter {
    last_beats: u32,
    /// Looks in a row that found neither progress nor an intentional wait.
    stalled_ticks: u32,
    /// Stalls whose stacks were logged.
    reports: u32,
    /// Whether the current stall was reported.
    stall_reported: bool,
    /// Whether the current stall's stacks were logged.
    stacks_logged: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum StallEvent {
    /// The main thread has made no progress for [`STALL_REPORT_TICKS`] looks; its stacks are
    /// logged unless [`MAX_STALL_REPORTS`] stalls already had theirs logged.
    Stalled { log_stacks: bool },
    /// A stall whose stacks were logged has lasted [`STALL_FOLLOW_UP_TICKS`] looks.
    StillStalled,
    /// A reported stall ended after `ticks` looks without progress.
    Resumed { ticks: u32 },
}

impl StallCounter {
    fn new(beats: u32) -> StallCounter {
        StallCounter {
            last_beats: beats,
            stalled_ticks: 0,
            reports: 0,
            stall_reported: false,
            stacks_logged: false,
        }
    }

    /// One look, finding the beat count at `beats` and the main thread in an intentional wait or
    /// not.
    fn tick(&mut self, beats: u32, idle: bool) -> Option<StallEvent> {
        let progressed = beats != self.last_beats;
        self.last_beats = beats;
        if progressed || idle {
            let ticks = std::mem::take(&mut self.stalled_ticks);
            self.stacks_logged = false;
            let reported = std::mem::take(&mut self.stall_reported);
            return reported.then_some(StallEvent::Resumed { ticks });
        }
        self.stalled_ticks = self.stalled_ticks.saturating_add(1);
        if self.stalled_ticks == STALL_REPORT_TICKS {
            let log_stacks = self.reports < MAX_STALL_REPORTS;
            if log_stacks {
                self.reports += 1;
            }
            self.stall_reported = true;
            self.stacks_logged = log_stacks;
            return Some(StallEvent::Stalled { log_stacks });
        }
        if self.stalled_ticks == STALL_FOLLOW_UP_TICKS && self.stacks_logged {
            return Some(StallEvent::StillStalled);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Looks `ticks` times without progress, returning what they reported.
    fn stall(counter: &mut StallCounter, ticks: u32) -> Vec<StallEvent> {
        let beats = counter.last_beats;
        (0..ticks)
            .filter_map(|_| counter.tick(beats, false))
            .collect()
    }

    #[test]
    fn stall_is_reported_at_the_threshold() {
        let mut counter = StallCounter::new(0);
        assert_eq!(stall(&mut counter, STALL_REPORT_TICKS - 1), vec![]);
        assert_eq!(
            counter.tick(0, false),
            Some(StallEvent::Stalled { log_stacks: true })
        );
        assert_eq!(
            stall(&mut counter, STALL_FOLLOW_UP_TICKS - STALL_REPORT_TICKS),
            vec![StallEvent::StillStalled],
        );
        assert_eq!(stall(&mut counter, 100), vec![]);
    }

    #[test]
    fn beat_resets_the_count() {
        let mut counter = StallCounter::new(0);
        assert_eq!(stall(&mut counter, STALL_REPORT_TICKS - 1), vec![]);
        assert_eq!(counter.tick(1, false), None);
        assert_eq!(stall(&mut counter, STALL_REPORT_TICKS - 1), vec![]);
        assert_eq!(
            counter.tick(1, false),
            Some(StallEvent::Stalled { log_stacks: true })
        );
    }

    #[test]
    fn idle_never_counts() {
        let mut counter = StallCounter::new(0);
        for _ in 0..1000 {
            assert_eq!(counter.tick(0, true), None);
        }
        // Idle in the middle of a would-be stall starts the count over.
        assert_eq!(stall(&mut counter, STALL_REPORT_TICKS - 1), vec![]);
        assert_eq!(counter.tick(0, true), None);
        assert_eq!(stall(&mut counter, STALL_REPORT_TICKS - 1), vec![]);
    }

    #[test]
    fn resuming_after_a_reported_stall_says_how_long_it_lasted() {
        let mut counter = StallCounter::new(0);
        stall(&mut counter, 17);
        assert_eq!(
            counter.tick(1, false),
            Some(StallEvent::Resumed { ticks: 17 })
        );
        assert_eq!(counter.tick(2, false), None);
        // An intentional wait ends a stall too.
        stall(&mut counter, 12);
        assert_eq!(
            counter.tick(2, true),
            Some(StallEvent::Resumed { ticks: 12 })
        );
        // A stall too short to be reported ends without a word.
        stall(&mut counter, STALL_REPORT_TICKS - 1);
        assert_eq!(counter.tick(3, false), None);
    }

    #[test]
    fn stacks_are_logged_for_a_limited_number_of_stalls() {
        let mut counter = StallCounter::new(0);
        let mut beats = 0;
        for report in 0..MAX_STALL_REPORTS + 2 {
            let log_stacks = report < MAX_STALL_REPORTS;
            let events = stall(&mut counter, STALL_FOLLOW_UP_TICKS);
            let mut expected = vec![StallEvent::Stalled { log_stacks }];
            if log_stacks {
                expected.push(StallEvent::StillStalled);
            }
            assert_eq!(events, expected);
            beats += 1;
            assert_eq!(
                counter.tick(beats, false),
                Some(StallEvent::Resumed {
                    ticks: STALL_FOLLOW_UP_TICKS
                })
            );
        }
    }

    #[test]
    fn stack_description_lists_frames_innermost_first() {
        let stack = ThreadStack {
            id: 0x1a2c,
            name: Some("worker".into()),
            frames: Some(vec![0x10, 0x20]),
        };
        for names in [ModuleNames::Loader, ModuleNames::MemoryMap] {
            assert_eq!(
                stack.describe(names).to_string(),
                "0x1a2c (worker): 10 < 20"
            );
        }
        let stack = ThreadStack {
            id: 0x30,
            name: None,
            frames: None,
        };
        assert_eq!(
            stack.describe(ModuleNames::Loader).to_string(),
            "0x30: not captured"
        );
    }

    #[test]
    fn process_threads_include_this_one() {
        assert!(process_thread_ids().contains(&unsafe { GetCurrentThreadId() }));
    }

    /// Captures the watched thread alone: capturing every thread would suspend the other tests'
    /// threads too, some of which write minidumps, which suspend threads themselves.
    #[test]
    fn watched_thread_is_captured() {
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = stop.clone();
            std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
            })
        };
        let id =
            unsafe { winapi::um::processthreadsapi::GetThreadId(thread.as_raw_handle() as HANDLE) };
        let watch = Watch {
            main_thread: open_thread(id).unwrap(),
            main_thread_id: id,
            stack_bounds: StackBounds::resolve().unwrap(),
            get_thread_description: None,
            progress_seen: Mutex::new((0, Instant::now())),
            capturing: Mutex::new(()),
        };
        let stacks = watch.capture_stacks(false);
        stop.store(true, Ordering::Relaxed);
        thread.join().unwrap();
        assert_eq!(stacks.len(), 1);
        assert_eq!(stacks[0].id, id);
        let frames = stacks[0].frames.as_ref().expect("thread not captured");
        assert!(frames.len() > 1, "{frames:x?}");
    }
}
