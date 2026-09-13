//! Measures what a snapshot/resimulation netcode would have to reproduce, from inside a running
//! game or replay.
//!
//! Rolling the simulation back and replaying it needs three properties of BW's logic step that
//! aren't otherwise observable: how much of the step's state lives in heap allocations made
//! during the step (which allocations, and whether they outlive the step), how much unsynced side
//! effect the step emits (sounds are the cheapest proxy — they are produced by synced code but
//! must not be replayed when a frame is resimulated), and how cheaply the engine can be asked to
//! simulate several frames back to back to catch up after a rollback. Each logic step also gets a
//! fingerprint row so a resimulated run can be diffed against the original frame by frame.
//!
//! The whole module — and its command surface in `debug_control` / `game_state` — is compiled out
//! of release DLLs via `#[cfg(debug_assertions)]`, for the same reason the rest of the debug
//! control surface is: it patches the game allocator's vtable and can drive the simulation
//! forward on command, so a release build must not contain the code at all rather than merely
//! decline to run it.
//!
//! The vtable swap happens while the game is being patched, and everything else that touches BW
//! memory (the extra logic steps, the fingerprint reads) happens on the game thread inside
//! [`run_game_logic_step`]; the command entry points only set atomics and open files, so they are
//! safe to call from the async side.

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::ptr::null;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use tokio::sync::oneshot;
use winapi::um::libloaderapi::GetModuleHandleW;

use crate::bw_scr::BwScr;
use crate::bw_scr::scr;
use crate::bw_scr::thiscall::Thiscall;
use crate::debug_control::{RollbackProbeBatchResult, RollbackProbeStatus};
use crate::windows;

/// Environment variable that starts the probe at the first logic step of the run, so a replay can
/// be launched through the normal UI and still be measured without anything sending a command.
const AUTO_START_ENV_VAR: &str = "SB_ROLLBACK_PROBE";

/// Environment variable that schedules one batch for an auto-started run, as `<frames>@<frame>`:
/// once the game reaches game frame `<frame>`, the next logic step is asked to simulate `<frames>`
/// frames back to back. Lets the batch measurement run in a replay launched through the normal
/// UI, with nothing sending a command.
const AUTO_BATCH_ENV_VAR: &str = "SB_ROLLBACK_PROBE_BATCH";

/// Environment variable that opts an auto-started run into the allocator vtable swap, which
/// counts and attributes the vtable allocation path. The game's integrity scan treats the swapped
/// slots as tampering once it reaches that page, which ends the process a minute or two into the
/// game, so the swap is only worth having for a run whose purpose is that attribution.
const VTABLE_HOOKS_ENV_VAR: &str = "SB_ROLLBACK_PROBE_VTABLE";

/// Cap on distinct allocation call sites tracked. Past it, further new sites are folded into a
/// single bucket at offset 0 rather than letting a pathological run grow the map without bound;
/// the real caller set is a few dozen entries, so hitting this at all means something unexpected
/// is happening and the dump's totals still say how much was missed.
const MAX_TRACKED_ALLOC_SITES: usize = 4096;

/// How many entries each table in an allocation dump reports.
const ALLOC_DUMP_COUNT: usize = 64;

/// While the probe is armed, the allocation tables are dumped on their own every this many logic
/// steps, so a run that simply ends (the replay finishes, the game is closed) still leaves them in
/// the file.
const AUTO_DUMP_INTERVAL_STEPS: u32 = 1000;

/// Whether the probe should be measuring. Set by the command surface and by the auto-start
/// environment variable; the game thread picks the change up at its next logic step.
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether the run asked for the allocator vtable swap at all (see [`VTABLE_HOOKS_ENV_VAR`]).
static VTABLE_HOOKS_WANTED: AtomicBool = AtomicBool::new(false);

/// Whether the allocator vtable holds our counting trampolines. The swap is made during game init
/// and is never undone: the game periodically verifies that image page against a pristine copy,
/// and any difference it finds, our restore included, is treated as tampering and ends the
/// process. The trampolines forward to the originals and only count while [`IN_LOGIC_STEP`] is
/// set, so they cost nothing once the probe is disarmed.
static INSTALLED: AtomicBool = AtomicBool::new(false);

/// The writable alias of the executable image that the hook patcher writes code patches through.
/// Read-only image pages (the allocator vtable lives in one) cannot be re-protected in this
/// process, so the vtable slots are written through the same alias instead.
static WRITABLE_IMAGE: AtomicUsize = AtomicUsize::new(0);

/// Whether execution is currently inside BW's logic step. The allocator and sound hooks only
/// count while it is set.
///
/// It is process-wide rather than thread-local, so an allocation another thread happens to make
/// while the game thread is mid-step is counted as if it came from the step. Sound and allocator
/// traffic outside the game thread is rare enough that the totals stay usable, and a thread-local
/// would instead silently miss any work the step itself farms out.
static IN_LOGIC_STEP: AtomicBool = AtomicBool::new(false);

static ALLOC_CALLS: AtomicU32 = AtomicU32::new(0);
static FREE_CALLS: AtomicU32 = AtomicU32::new(0);
/// Calls through the engine's other allocation path over the same OS heap: a pair of plain
/// functions taking an allocation tag and flags rather than slots of the allocator vtable object.
/// Pathing, AI regions, replay recording and save/load allocate through it, so a step's heap
/// churn is only fully described by both pairs of counters together.
static FLAGS_ALLOC_CALLS: AtomicU32 = AtomicU32::new(0);
static FLAGS_FREE_CALLS: AtomicU32 = AtomicU32::new(0);
static SOUND_CALLS: AtomicU32 = AtomicU32::new(0);

/// Logic steps measured since the probe was armed; drives the periodic allocation dump.
static STEPS_MEASURED: AtomicU32 = AtomicU32::new(0);

/// The game frame the simulation was on when the current logic step began; tags live blocks with
/// the frame they were allocated on.
static CURRENT_FRAME: AtomicU32 = AtomicU32::new(0);

/// The game's own allocator functions, saved when the vtable slots are swapped.
static ORIGINAL_ALLOC: AtomicUsize = AtomicUsize::new(0);
static ORIGINAL_FREE: AtomicUsize = AtomicUsize::new(0);

/// Vtable-path allocation counts keyed by the caller's return address minus the executable's
/// base address.
static ALLOC_SITES: Mutex<Option<HashMap<usize, u32>>> = Mutex::new(None);

/// Every block allocated inside a logic step that has not been freed yet, by block address. This
/// is the measurement that matters for a snapshot: a block still here at the end of a step is
/// simulation state living outside the static regions and the pre-sized object pools.
static LIVE_ALLOCATIONS: Mutex<Option<HashMap<usize, LiveAllocation>>> = Mutex::new(None);

/// Cumulative counts of in-step allocations per allocation tag.
static TAG_STATS: Mutex<Option<HashMap<TagKey, TagStats>>> = Mutex::new(None);

/// The frame count a pending batch request asks the next logic step to simulate; 0 = none.
static PENDING_BATCH: AtomicU32 = AtomicU32::new(0);

/// The game frame at which the environment-scheduled batch fires, and its size; 0 = none.
static AUTO_BATCH_AT_FRAME: AtomicU32 = AtomicU32::new(0);
static AUTO_BATCH_FRAMES: AtomicU32 = AtomicU32::new(0);

/// Where the result of the pending batch goes once the game thread has run it.
static BATCH_REPLY: Mutex<Option<oneshot::Sender<RollbackProbeBatchResult>>> = Mutex::new(None);

static PROBE_FILE: Mutex<Option<ProbeFile>> = Mutex::new(None);

/// The per-frame synced-state read the probe records, so a resimulated frame can be compared
/// against the frame it is supposed to reproduce.
pub struct Fingerprint {
    pub frame: u32,
    /// The six `u32` words at the RNG seed operand: the seed itself plus the advancing draw
    /// state, so any difference in the number or order of synced random draws shows up here.
    pub rng: [u32; 6],
    pub minerals: [u32; 4],
    pub gas: [u32; 4],
    /// The trigger step's per-frame countdown; triggers run on the frame it reads as zero.
    pub trigger_timer: u16,
}

/// Which of the engine's two allocation paths a block came through.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum AllocPath {
    /// The allocator vtable object's `alloc`/`free` slots.
    Vtable,
    /// The plain tag-and-flags allocation functions.
    Flags,
}

impl AllocPath {
    fn name(self) -> &'static str {
        match self {
            AllocPath::Vtable => "vtable",
            AllocPath::Flags => "flags",
        }
    }
}

/// Identifies a kind of allocation in the dumps. The tag is the flags path's tag pointer as an
/// offset from the executable base (it points at a static descriptor, so it names the allocating
/// subsystem); the vtable path has no tag and uses 0.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct TagKey {
    path: AllocPath,
    tag: usize,
    flags: u32,
}

#[derive(Default)]
struct TagStats {
    allocs: u64,
    bytes: u64,
}

struct LiveAllocation {
    key: TagKey,
    size: usize,
    /// Game frame the block was allocated on.
    frame: u32,
    /// Return address of the allocating call as an offset from the executable base, for the
    /// vtable path; 0 for the flags path, whose tag already names the allocator.
    site: usize,
}

struct ProbeFile {
    path: PathBuf,
    file: File,
    rows: u32,
}

impl ProbeFile {
    fn create() -> Result<ProbeFile, String> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        // Alongside the game log, which is the directory anyone collecting a run's artifacts
        // already picks up.
        let path = crate::parse_args()
            .user_data_path
            .join("logs")
            .join(format!("rollback-probe-{seconds}.csv"));
        let mut file = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        writeln!(
            &mut file,
            "frame,frames_simulated,step_micros,alloc_calls,free_calls,\
             flags_alloc_calls,flags_free_calls,sound_calls,\
             rng0,rng1,rng2,rng3,rng4,rng5,\
             minerals0,minerals1,minerals2,minerals3,gas0,gas1,gas2,gas3,trigger_timer"
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(ProbeFile {
            path,
            file,
            rows: 0,
        })
    }
}

/// Base address of the executable, which every recorded call site and tag is reported relative
/// to.
///
/// A call site that did not come from the executable (a call into the allocator from a system
/// DLL, say) still gets recorded, as an offset far outside the executable's extent.
fn exe_base() -> usize {
    static BASE: AtomicUsize = AtomicUsize::new(0);
    let cached = BASE.load(Ordering::Relaxed);
    if cached != 0 {
        return cached;
    }
    let base = unsafe { GetModuleHandleW(null()) } as usize;
    BASE.store(base, Ordering::Relaxed);
    base
}

/// Records the writable alias of the executable image that code patches are written through, so
/// the allocator vtable can be patched the same way. Called once while the game is being patched.
pub fn set_writable_image(image: *mut u8) {
    WRITABLE_IMAGE.store(image as usize, Ordering::Release);
}

/// The game frame the current logic step began on.
pub fn current_frame() -> u32 {
    CURRENT_FRAME.load(Ordering::Relaxed)
}

/// Starts the probe if the auto-start environment variable asks for it. Called once while the DLL
/// initialises, before the game thread exists.
pub fn init_from_env() {
    if std::env::var(AUTO_START_ENV_VAR).as_deref() != Ok("1") {
        return;
    }
    let status = start();
    info!(
        "{AUTO_START_ENV_VAR}=1: rollback probe auto-started, writing {}",
        status.path.as_deref().unwrap_or("(no file)"),
    );
    if std::env::var(VTABLE_HOOKS_ENV_VAR).as_deref() == Ok("1") {
        VTABLE_HOOKS_WANTED.store(true, Ordering::Release);
        info!("{VTABLE_HOOKS_ENV_VAR}=1: allocator vtable calls will be counted");
    }
    if let Ok(spec) = std::env::var(AUTO_BATCH_ENV_VAR) {
        let parsed = spec
            .split_once('@')
            .and_then(|(frames, at)| Some((frames.parse::<u32>().ok()?, at.parse::<u32>().ok()?)));
        match parsed {
            Some((frames, at_frame)) if frames > 0 && at_frame > 0 => {
                AUTO_BATCH_FRAMES.store(frames, Ordering::Relaxed);
                AUTO_BATCH_AT_FRAME.store(at_frame, Ordering::Release);
                info!(
                    "{AUTO_BATCH_ENV_VAR}: batch of {frames} frames scheduled at frame {at_frame}"
                );
            }
            _ => error!("{AUTO_BATCH_ENV_VAR}={spec:?} is not <frames>@<frame>; ignoring it"),
        }
    }
}

/// Arms the probe. The counters attach to BW on the game thread's next logic step.
pub fn start() -> RollbackProbeStatus {
    {
        let mut probe_file = PROBE_FILE.lock();
        if probe_file.is_none() {
            match ProbeFile::create() {
                Ok(file) => {
                    info!("Rollback probe logging to {}", file.path.display());
                    *probe_file = Some(file);
                }
                Err(e) => {
                    error!("Rollback probe could not open its log file: {e}");
                    return status();
                }
            }
        }
    }
    *ALLOC_SITES.lock() = Some(HashMap::new());
    *LIVE_ALLOCATIONS.lock() = Some(HashMap::new());
    *TAG_STATS.lock() = Some(HashMap::new());
    STEPS_MEASURED.store(0, Ordering::Relaxed);
    ACTIVE.store(true, Ordering::Release);
    info!("Rollback probe started");
    status()
}

/// Disarms the probe and writes a final allocation dump. The vtable trampolines stay in place (see
/// [`INSTALLED`]); they stop counting as soon as no logic step is being measured.
pub fn stop() -> RollbackProbeStatus {
    ACTIVE.store(false, Ordering::Release);
    dump_allocations();
    info!("Rollback probe stopped");
    status()
}

pub fn status() -> RollbackProbeStatus {
    let probe_file = PROBE_FILE.lock();
    RollbackProbeStatus {
        active: ACTIVE.load(Ordering::Acquire),
        frames_logged: probe_file.as_ref().map(|f| f.rows).unwrap_or(0),
        path: probe_file.as_ref().map(|f| f.path.display().to_string()),
    }
}

/// Asks the next logic step to simulate `frames` frames back to back, and hands back the channel
/// the game thread reports the outcome on. The caller decides how long to wait: nothing answers
/// while no game loop is running.
pub fn request_batch(frames: u32) -> oneshot::Receiver<RollbackProbeBatchResult> {
    let (send, recv) = oneshot::channel();
    // Replacing an unanswered request drops its sender, which surfaces on that caller's receiver
    // as a cancellation rather than leaving it waiting for a batch that will never run.
    *BATCH_REPLY.lock() = Some(send);
    PENDING_BATCH.store(frames.max(1), Ordering::Release);
    info!("Rollback probe batch of {frames} frames requested");
    recv
}

/// Writes the allocation tables seen so far to the game log and the probe file: the busiest
/// vtable-path call sites, the in-step allocation counts per tag, and the blocks allocated inside
/// a logic step that are still live.
pub fn dump_allocations() -> RollbackProbeStatus {
    let sites = {
        let sites = ALLOC_SITES.lock();
        let mut sites = match sites.as_ref() {
            Some(sites) => sites.iter().map(|(&k, &v)| (k, v)).collect::<Vec<_>>(),
            None => Vec::new(),
        };
        sites.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        sites.truncate(ALLOC_DUMP_COUNT);
        sites
    };
    // Live blocks folded per tag, alongside the cumulative counts for the same tag, so one row
    // says both how often a tag allocates and how much of it survives.
    let tags = {
        let live = LIVE_ALLOCATIONS.lock();
        let stats = TAG_STATS.lock();
        let mut live_per_tag: HashMap<TagKey, (u64, u64)> = HashMap::new();
        if let Some(live) = live.as_ref() {
            for block in live.values() {
                let entry = live_per_tag.entry(block.key).or_default();
                entry.0 += 1;
                entry.1 += block.size as u64;
            }
        }
        let mut rows = match stats.as_ref() {
            Some(stats) => stats
                .iter()
                .map(|(&key, stats)| {
                    let (live_count, live_bytes) =
                        live_per_tag.get(&key).copied().unwrap_or((0, 0));
                    (key, stats.allocs, stats.bytes, live_count, live_bytes)
                })
                .collect::<Vec<_>>(),
            None => Vec::new(),
        };
        rows.sort_unstable_by(|a, b| b.3.cmp(&a.3).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0)));
        rows.truncate(ALLOC_DUMP_COUNT);
        rows
    };
    let live_blocks = {
        let live = LIVE_ALLOCATIONS.lock();
        let mut blocks = match live.as_ref() {
            Some(live) => live
                .values()
                .map(|b| (b.frame, b.key, b.size, b.site))
                .collect::<Vec<_>>(),
            None => Vec::new(),
        };
        blocks.sort_unstable();
        blocks
    };
    // Live blocks folded per allocating site, the view that says which code produces state that
    // outlives the step.
    let live_sites = {
        let mut per_site: HashMap<(AllocPath, usize), (u64, u64)> = HashMap::new();
        for &(_, key, size, site) in &live_blocks {
            let entry = per_site.entry((key.path, site)).or_default();
            entry.0 += 1;
            entry.1 += size as u64;
        }
        let mut rows = per_site
            .into_iter()
            .map(|((path, site), (count, bytes))| (count, bytes, path, site))
            .collect::<Vec<_>>();
        rows.sort_unstable_by(|a, b| b.cmp(a));
        rows
    };
    let step = STEPS_MEASURED.load(Ordering::Relaxed);

    info!(
        "Rollback probe allocation dump after {step} steps: {} call sites, {} tags, {} live \
         blocks allocated in-step (offsets from exe base)",
        sites.len(),
        tags.len(),
        live_blocks.len(),
    );
    for &(offset, count) in &sites {
        info!("  site +{offset:x} {count}");
    }
    for &(key, allocs, bytes, live_count, live_bytes) in &tags {
        info!(
            "  tag {} +{:x} flags {:#x}: {allocs} allocs, {bytes} bytes, live {live_count} \
             blocks / {live_bytes} bytes",
            key.path.name(),
            key.tag,
            key.flags,
        );
    }
    for &(count, bytes, path, site) in live_sites.iter().take(ALLOC_DUMP_COUNT) {
        info!(
            "  live site {} +{site:x}: {count} blocks / {bytes} bytes",
            path.name()
        );
    }
    for &(frame, key, size, site) in live_blocks.iter().take(ALLOC_DUMP_COUNT) {
        info!(
            "  live frame {frame} {} +{:x} flags {:#x} site +{site:x} size {size}",
            key.path.name(),
            key.tag,
            key.flags,
        );
    }

    let mut probe_file = PROBE_FILE.lock();
    if let Some(probe_file) = probe_file.as_mut() {
        let _ = writeln!(&mut probe_file.file, "# dump,step,{step}");
        for &(offset, count) in &sites {
            let _ = writeln!(&mut probe_file.file, "# alloc_site,{offset:x},{count}");
        }
        for &(key, allocs, bytes, live_count, live_bytes) in &tags {
            let _ = writeln!(
                &mut probe_file.file,
                "# alloc_tag,{},{:x},{:x},{allocs},{bytes},{live_count},{live_bytes}",
                key.path.name(),
                key.tag,
                key.flags,
            );
        }
        for &(count, bytes, path, site) in &live_sites {
            let _ = writeln!(
                &mut probe_file.file,
                "# live_site,{},{site:x},{count},{bytes}",
                path.name(),
            );
        }
        for &(frame, key, size, site) in &live_blocks {
            let _ = writeln!(
                &mut probe_file.file,
                "# live_block,{frame},{},{:x},{:x},{site:x},{size}",
                key.path.name(),
                key.tag,
                key.flags,
            );
        }
        let _ = probe_file.file.flush();
    }
    drop(probe_file);
    status()
}

/// Counts one sound request, when the game is inside a logic step. Called from the `play_sound`
/// hook.
pub fn note_play_sound() {
    if IN_LOGIC_STEP.load(Ordering::Relaxed) {
        SOUND_CALLS.fetch_add(1, Ordering::Relaxed);
    }
}

/// Records one allocation through the tag/flags allocation path, once the game has performed it.
/// Only allocations made inside a logic step are counted and tracked.
pub fn note_flags_alloc(block: *mut u8, size: usize, tag: usize, flags: u32) {
    if !IN_LOGIC_STEP.load(Ordering::Relaxed) {
        return;
    }
    FLAGS_ALLOC_CALLS.fetch_add(1, Ordering::Relaxed);
    let key = TagKey {
        path: AllocPath::Flags,
        tag: tag.wrapping_sub(exe_base()),
        flags,
    };
    record_allocation(block, size, key, 0);
}

/// Records one deallocation through the tag/flags allocation path. Frees are tracked whenever they
/// happen, since a block allocated inside a step and freed outside it did not persist either.
pub fn note_flags_free(block: *mut u8) {
    if IN_LOGIC_STEP.load(Ordering::Relaxed) {
        FLAGS_FREE_CALLS.fetch_add(1, Ordering::Relaxed);
    }
    forget_allocation(block);
}

fn record_allocation(block: *mut u8, size: usize, key: TagKey, site: usize) {
    if let Some(stats) = TAG_STATS.lock().as_mut() {
        let entry = stats.entry(key).or_default();
        entry.allocs += 1;
        entry.bytes += size as u64;
    }
    if block.is_null() {
        return;
    }
    if let Some(live) = LIVE_ALLOCATIONS.lock().as_mut() {
        let frame = current_frame();
        live.insert(
            block as usize,
            LiveAllocation {
                key,
                size,
                frame,
                site,
            },
        );
    }
}

fn forget_allocation(block: *mut u8) {
    if let Some(live) = LIVE_ALLOCATIONS.lock().as_mut() {
        live.remove(&(block as usize));
    }
}

/// Runs BW's game logic step, bracketed by whatever measurement is currently armed: one call
/// normally, or a batch of back-to-back calls when one has been requested.
///
/// This is the only place the probe touches BW: it runs on the game thread, so the allocator
/// vtable swap and the extra steps are serialised against the simulation.
pub unsafe fn run_game_logic_step(
    bw: &BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        let mut batch_frames = PENDING_BATCH.swap(0, Ordering::Acquire);
        let active = ACTIVE.load(Ordering::Acquire);
        if !active && batch_frames == 0 {
            return orig(param);
        }

        let before = bw.probe_fingerprint();
        if let Some(before) = &before {
            CURRENT_FRAME.store(before.frame, Ordering::Relaxed);
            let at_frame = AUTO_BATCH_AT_FRAME.load(Ordering::Acquire);
            if batch_frames == 0 && at_frame != 0 && before.frame >= at_frame {
                AUTO_BATCH_AT_FRAME.store(0, Ordering::Relaxed);
                batch_frames = AUTO_BATCH_FRAMES.load(Ordering::Relaxed);
            }
        }
        // Each logic step adds the frame delay to the tick the game loop paces itself against, so
        // a batch of steps would otherwise push real-time pacing that far into the future and
        // stall the game until it caught up. The tick goes back to what the loop wrote once the
        // batch has run.
        let saved_tick = (batch_frames != 0).then(|| bw.probe_next_game_step_tick());
        let calls = batch_frames.max(1);

        ALLOC_CALLS.store(0, Ordering::Relaxed);
        FREE_CALLS.store(0, Ordering::Relaxed);
        FLAGS_ALLOC_CALLS.store(0, Ordering::Relaxed);
        FLAGS_FREE_CALLS.store(0, Ordering::Relaxed);
        SOUND_CALLS.store(0, Ordering::Relaxed);
        IN_LOGIC_STEP.store(true, Ordering::Release);
        let start = Instant::now();
        let mut ret = 0;
        for _ in 0..calls {
            ret = orig(param);
        }
        let elapsed = start.elapsed();
        IN_LOGIC_STEP.store(false, Ordering::Release);

        let after = bw.probe_fingerprint();
        let simulated = match (&before, &after) {
            (Some(before), Some(after)) => after.frame.wrapping_sub(before.frame),
            _ => 0,
        };

        if let Some(saved_tick) = saved_tick {
            bw.probe_set_next_game_step_tick(saved_tick);
            let elapsed_micros = elapsed.as_micros().min(u64::MAX as u128) as u64;
            info!(
                "Rollback probe batch: asked for {batch_frames} frames, simulated {simulated} in \
                 {elapsed_micros} us",
            );
            finish_batch(RollbackProbeBatchResult {
                requested: batch_frames,
                simulated,
                elapsed_micros,
                error: None,
            });
        }

        if active && let Some(after) = after {
            write_row(&after, simulated, elapsed);
            let steps = STEPS_MEASURED.fetch_add(1, Ordering::Relaxed) + 1;
            if steps.is_multiple_of(AUTO_DUMP_INTERVAL_STEPS) {
                dump_allocations();
            }
        }
        ret
    }
}

fn finish_batch(result: RollbackProbeBatchResult) {
    if let Some(send) = BATCH_REPLY.lock().take() {
        let _ = send.send(result);
    }
}

fn write_row(fingerprint: &Fingerprint, simulated: u32, elapsed: Duration) {
    let allocs = ALLOC_CALLS.load(Ordering::Relaxed);
    let frees = FREE_CALLS.load(Ordering::Relaxed);
    let flags_allocs = FLAGS_ALLOC_CALLS.load(Ordering::Relaxed);
    let flags_frees = FLAGS_FREE_CALLS.load(Ordering::Relaxed);
    let sounds = SOUND_CALLS.load(Ordering::Relaxed);
    let mut probe_file = PROBE_FILE.lock();
    let Some(probe_file) = probe_file.as_mut() else {
        return;
    };
    let rng = &fingerprint.rng;
    let minerals = &fingerprint.minerals;
    let gas = &fingerprint.gas;
    let result = writeln!(
        &mut probe_file.file,
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
        fingerprint.frame,
        simulated,
        elapsed.as_micros(),
        allocs,
        frees,
        flags_allocs,
        flags_frees,
        sounds,
        rng[0],
        rng[1],
        rng[2],
        rng[3],
        rng[4],
        rng[5],
        minerals[0],
        minerals[1],
        minerals[2],
        minerals[3],
        gas[0],
        gas[1],
        gas[2],
        gas[3],
        fingerprint.trigger_timer,
    );
    match result {
        Ok(()) => probe_file.rows = probe_file.rows.wrapping_add(1),
        Err(e) => {
            // Give up on the file rather than logging once per frame for the rest of the game.
            error!("Rollback probe write failed, closing the log: {e}");
            ACTIVE.store(false, Ordering::Release);
        }
    }
}

/// Finds the allocator vtable in the writable alias of the image. Logs and returns null when the
/// alias is unavailable or does not mirror what the game reads through `vtable`.
unsafe fn writable_vtable(vtable: *mut scr::AllocatorVtable) -> *mut scr::AllocatorVtable {
    unsafe {
        let image = WRITABLE_IMAGE.load(Ordering::Acquire);
        let base = exe_base();
        if image == 0 || (vtable as usize) < base {
            error!(
                "Rollback probe has no writable image alias for the allocator vtable at {vtable:p}"
            );
            return std::ptr::null_mut();
        }
        let writable = (image + (vtable as usize - base)) as *mut scr::AllocatorVtable;
        let same_contents = (*writable).alloc.cast_usize() == (*vtable).alloc.cast_usize()
            && (*writable).free.cast_usize() == (*vtable).free.cast_usize();
        if !same_contents {
            error!(
                "Rollback probe: the writable image alias at {writable:p} does not mirror the \
                 allocator vtable at {vtable:p} ({}); allocator vtable calls will not be counted",
                windows::describe_page(writable.cast()),
            );
            return std::ptr::null_mut();
        }
        writable
    }
}

/// Swaps the allocator vtable's `alloc`/`free` slots for the counting trampolines, if the run
/// opted into them before the game started and the game has built its allocator by now. Called
/// from the game patching and init points; `stage` names the caller for the log. No-op once the
/// swap is in place.
pub unsafe fn install_at_init(bw: &BwScr, stage: &str) {
    unsafe {
        if !VTABLE_HOOKS_WANTED.load(Ordering::Acquire) || INSTALLED.load(Ordering::Acquire) {
            return;
        }
        let vtable = bw.probe_allocator_vtable();
        if vtable.is_null() {
            info!("Rollback probe: no game allocator yet at {stage}; vtable calls not hooked");
            return;
        }
        let writable = writable_vtable(vtable);
        if writable.is_null() {
            // The rest of the probe (the other allocation path, sounds, batches, the fingerprint
            // rows) is still worth having, so only this hook gives up.
            INSTALLED.store(true, Ordering::Release);
            return;
        }
        ORIGINAL_ALLOC.store((*vtable).alloc.cast_usize(), Ordering::Relaxed);
        ORIGINAL_FREE.store((*vtable).free.cast_usize(), Ordering::Relaxed);
        let alloc_hook_address = alloc_trampoline as *const () as usize;
        let free_hook_address = free_trampoline as *const () as usize;
        (*writable).alloc = Thiscall::foreign(alloc_hook_address);
        (*writable).free = Thiscall::foreign(free_hook_address);
        let took_effect = (*vtable).alloc.cast_usize() == alloc_hook_address
            && (*vtable).free.cast_usize() == free_hook_address;
        if !took_effect {
            error!(
                "Rollback probe: writing the allocator vtable through the image alias at \
                 {writable:p} did not change what the game reads at {vtable:p}; allocator vtable \
                 calls will not be counted",
            );
            INSTALLED.store(true, Ordering::Release);
            return;
        }
        INSTALLED.store(true, Ordering::Release);
        info!("Rollback probe attached to the game allocator at {vtable:p} during {stage}");
    }
}

fn record_alloc_site(return_address: usize) {
    let offset = return_address.wrapping_sub(exe_base());
    let mut sites = ALLOC_SITES.lock();
    let Some(sites) = sites.as_mut() else {
        return;
    };
    if sites.len() >= MAX_TRACKED_ALLOC_SITES && !sites.contains_key(&offset) {
        *sites.entry(0).or_insert(0) += 1;
        return;
    }
    *sites.entry(offset).or_insert(0) += 1;
}

/// The counting body behind [`alloc_trampoline`]. `return_address` is the address the game
/// allocation call will return to, which the trampoline reads off the stack before anything else
/// has had a chance to disturb it.
unsafe extern "C" fn alloc_hook(
    allocator: *mut scr::Allocator,
    size: usize,
    align: usize,
    return_address: usize,
) -> *mut u8 {
    unsafe {
        let original: Thiscall<unsafe extern "C" fn(*mut scr::Allocator, usize, usize) -> *mut u8> =
            Thiscall::foreign(ORIGINAL_ALLOC.load(Ordering::Relaxed));
        let block = original.call3(allocator, size, align);
        if IN_LOGIC_STEP.load(Ordering::Relaxed) {
            ALLOC_CALLS.fetch_add(1, Ordering::Relaxed);
            record_alloc_site(return_address);
            let key = TagKey {
                path: AllocPath::Vtable,
                tag: 0,
                flags: 0,
            };
            record_allocation(block, size, key, return_address.wrapping_sub(exe_base()));
        }
        block
    }
}

/// The counting body behind [`free_trampoline`].
unsafe extern "C" fn free_hook(
    allocator: *mut scr::Allocator,
    ptr: *mut u8,
    _return_address: usize,
) {
    unsafe {
        if IN_LOGIC_STEP.load(Ordering::Relaxed) {
            FREE_CALLS.fetch_add(1, Ordering::Relaxed);
        }
        forget_allocation(ptr);
        let original: Thiscall<unsafe extern "C" fn(*mut scr::Allocator, *mut u8)> =
            Thiscall::foreign(ORIGINAL_FREE.load(Ordering::Relaxed));
        original.call2(allocator, ptr);
    }
}

// The two allocator vtable slots are replaced with hand-written thunks rather than with ordinary
// Rust functions, because the point of the histogram is *which* game code allocated, and the
// only place that is still knowable is the return address sitting on the stack at the entry of
// the called function. A Rust function has no way to read its own return address, and the
// generic thiscall adapter used elsewhere in the tree interposes its own frame, which would make
// every call site look identical. Each thunk therefore reads the return address, passes it as one
// extra argument, and hands off to a normal `extern "C"` body.
//
// The two architectures need separate thunks because the slots are called with different
// conventions: on x86 the game uses thiscall (this in ecx, arguments on the stack, callee pops
// them), on x86_64 the standard register convention (this and arguments in rcx/rdx/r8, one free
// argument register left over, caller-allocated shadow space that is the same size regardless of
// argument count). The x86_64 thunks can therefore tail-jump into the body, while the x86 thunks
// have to rebuild the argument list and clean up.

#[cfg(target_arch = "x86")]
#[unsafe(naked)]
unsafe extern "C" fn alloc_trampoline() {
    // Entry: ecx = allocator, [esp] = return address, [esp + 4] = size, [esp + 8] = align.
    core::arch::naked_asm!(
        "push dword ptr [esp]",      // return address
        "push dword ptr [esp + 12]", // align
        "push dword ptr [esp + 12]", // size
        "push ecx",                  // allocator
        "call {hook}",
        "add esp, 16",
        "ret 8",
        hook = sym alloc_hook,
    )
}

#[cfg(target_arch = "x86")]
#[unsafe(naked)]
unsafe extern "C" fn free_trampoline() {
    // Entry: ecx = allocator, [esp] = return address, [esp + 4] = pointer.
    core::arch::naked_asm!(
        "push dword ptr [esp]",     // return address
        "push dword ptr [esp + 8]", // pointer
        "push ecx",                 // allocator
        "call {hook}",
        "add esp, 12",
        "ret 4",
        hook = sym free_hook,
    )
}

#[cfg(target_arch = "x86_64")]
#[unsafe(naked)]
unsafe extern "C" fn alloc_trampoline() {
    // Entry: rcx = allocator, rdx = size, r8 = align, [rsp] = return address. r9 is the fourth
    // argument register and is unused by a three-argument call, so the return address goes there
    // and the jump leaves the stack exactly as the game left it.
    core::arch::naked_asm!("mov r9, [rsp]", "jmp {hook}", hook = sym alloc_hook)
}

#[cfg(target_arch = "x86_64")]
#[unsafe(naked)]
unsafe extern "C" fn free_trampoline() {
    // Entry: rcx = allocator, rdx = pointer, [rsp] = return address.
    core::arch::naked_asm!("mov r8, [rsp]", "jmp {hook}", hook = sym free_hook)
}
