//! What a client keeps of its own simulation so that its log alone can show whether, when and
//! where it stopped agreeing with its peers: the component hashes of its newest confirmed report
//! positions, logged when the relay evicts it for a desync (and at debug level when a game ends
//! normally, for comparison), and a table of every unit at the newest confirmed report position,
//! written next to the game log on an eviction.
//!
//! Both describe confirmed state only, which every client reaches and plain replay playback
//! reproduces frame for frame, so either can be diffed against a replay of the game.

use std::collections::VecDeque;
use std::fmt::{self, Write as _};
use std::path::{Path, PathBuf};

use parking_lot::Mutex;

use crate::rollback::state_hash::{StateHash, UnitRecord};

/// The sync probe is logged at frames, or in a game that rolls back at report positions, that
/// are a multiple of this.
const SYNC_PROBE_INTERVAL: u32 = 240;

/// How many of the newest confirmed report positions the evidence keeps.
const CONFIRMED_KEPT: usize = 64;

/// The unit tables kept in the logs directory, newest first; older ones are deleted when a new
/// one is written.
const UNIT_TABLES_KEPT: usize = 3;

/// A unit table stops taking rows once it is this large, and says so on its last line.
const MAX_UNIT_TABLE_BYTES: usize = 512 * 1024;

const UNIT_TABLE_PREFIX: &str = "desync-units-";

const UNIT_TABLE_COLUMNS: &str = "index,unit_id,player,minor_unique_index,exact_x,exact_y,\
    hitpoints,shields,energy,current_speed,order,order_state,order_timer,order_target_x,\
    order_target_y,order_target,move_target_x,move_target_y,secondary_order,flags,\
    remaining_build_time,unit_hash";

/// Whether the sync probe is logged at frame (or report position) `point`.
pub(crate) fn is_sync_probe_point(point: u32) -> bool {
    point.is_multiple_of(SYNC_PROBE_INTERVAL)
}

/// A low-rate reading of the synced state: the words around the RNG seed operand, the first four
/// players' resources, the trigger countdown, and the state hash with its components.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SyncProbe {
    pub rng: [u32; 6],
    pub minerals: [u32; 4],
    pub gas: [u32; 4],
    pub trigger_timer: u16,
    pub hash: StateHash,
}

/// The one format plain playback and a live game both log the probe in, so their lines diff
/// directly.
impl fmt::Display for SyncProbe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "frame {} rng {:x?} minerals {:?} gas {:?} trigger_timer {} {}",
            self.hash.frame, self.rng, self.minerals, self.gas, self.trigger_timer, self.hash,
        )
    }
}

struct ConfirmedReport {
    position: u32,
    hash: StateHash,
}

struct UnitTable {
    position: u32,
    hash: StateHash,
    units: Vec<UnitRecord>,
}

struct Evidence {
    /// The newest confirmed report positions, oldest first.
    confirmed: VecDeque<ConfirmedReport>,
    /// The units at the newest confirmed report position.
    table: Option<UnitTable>,
    /// Whether an eviction has logged the evidence already.
    eviction_logged: bool,
}

static EVIDENCE: Mutex<Evidence> = Mutex::new(Evidence {
    confirmed: VecDeque::new(),
    table: None,
    eviction_logged: false,
});

/// Takes in the confirmed report position `position`: the probe its step read and the units its
/// state hash covered. Logs the probe when the position is a probe point. Returns the unit buffer
/// of the table this one replaces, for reuse.
pub(super) fn confirm(
    position: u32,
    probe: &SyncProbe,
    units: Vec<UnitRecord>,
) -> Option<Vec<UnitRecord>> {
    if is_sync_probe_point(position) {
        debug!("Sync probe: {probe} position {position}");
    }
    let mut evidence = EVIDENCE.lock();
    if evidence.confirmed.len() == CONFIRMED_KEPT {
        evidence.confirmed.pop_front();
    }
    evidence.confirmed.push_back(ConfirmedReport {
        position,
        hash: probe.hash,
    });
    let replaced = evidence.table.replace(UnitTable {
        position,
        hash: probe.hash,
        units,
    });
    replaced.map(|table| table.units)
}

pub(super) fn reset() {
    let mut evidence = EVIDENCE.lock();
    evidence.confirmed.clear();
    evidence.table = None;
    evidence.eviction_logged = false;
}

/// Logs the evidence and writes the unit table, for a client the relay evicted for a desync.
pub(crate) fn on_desync_eviction() {
    let (block, table) = {
        let mut evidence = EVIDENCE.lock();
        evidence.eviction_logged = true;
        let table = evidence.table.as_ref().map(|table| {
            unit_table_text(
                &format!(
                    "# Units hashed at confirmed position {} of game {}, {}",
                    table.position,
                    crate::parse_args().game_id,
                    table.hash,
                ),
                &table.units,
            )
        });
        (evidence_block(&evidence.confirmed), table)
    };
    warn!("Evicted for a desync. {block}");
    match table {
        Some(table) => {
            let name = format!("{UNIT_TABLE_PREFIX}{}.csv", crate::parse_args().game_id);
            write_unit_table(&name, &table);
        }
        None => warn!("No confirmed report position has a unit table to write"),
    }
}

/// Logs the evidence at debug level when a game that rolls back ends without an eviction, so a
/// client that stayed in sync leaves the same evidence to compare against.
pub(crate) fn on_game_end() {
    let evidence = EVIDENCE.lock();
    if evidence.eviction_logged || evidence.confirmed.is_empty() {
        return;
    }
    debug!("Game ended. {}", evidence_block(&evidence.confirmed));
}

/// The confirmed reports as one log message, a line per report position.
fn evidence_block(confirmed: &VecDeque<ConfirmedReport>) -> String {
    let mut block = format!(
        "Desync evidence, the last {} confirmed report positions, oldest first \
         (position frame hash frame_rng economy supply tech units bullets):",
        confirmed.len(),
    );
    for report in confirmed {
        let hash = &report.hash;
        let _ = write!(
            block,
            "\n  {} {} {:016x} {:016x} {:016x} {:016x} {:016x} {}/{:016x} {}/{:016x}",
            report.position,
            hash.frame,
            hash.combined(),
            hash.frame_rng,
            hash.economy,
            hash.supply,
            hash.tech,
            hash.unit_count,
            hash.units,
            hash.bullet_count,
            hash.bullets,
        );
    }
    block
}

/// The units as CSV under a `#` header line, one row per unit in list order, cut off at
/// [`MAX_UNIT_TABLE_BYTES`].
fn unit_table_text(header: &str, units: &[UnitRecord]) -> String {
    let mut text = String::with_capacity((units.len() * 120).min(MAX_UNIT_TABLE_BYTES) + 512);
    let _ = writeln!(text, "{header}");
    let _ = writeln!(text, "{UNIT_TABLE_COLUMNS}");
    for (written, unit) in units.iter().enumerate() {
        if text.len() >= MAX_UNIT_TABLE_BYTES {
            let _ = writeln!(text, "# Cut off after {written} of {} units", units.len());
            break;
        }
        let flingy = &unit.flingy;
        let _ = writeln!(
            text,
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:x},{},{},{},{:x},{},{:016x}",
            unit.index,
            unit.unit_id,
            unit.player,
            unit.minor_unique_index,
            flingy.exact_x,
            flingy.exact_y,
            flingy.hitpoints,
            unit.shields,
            unit.energy,
            flingy.current_speed,
            unit.order,
            unit.order_state,
            unit.order_timer,
            unit.order_target.x,
            unit.order_target.y,
            unit.order_target.unit,
            flingy.move_target.x,
            flingy.move_target.y,
            unit.secondary_order,
            unit.flags,
            unit.remaining_build_time,
            unit.hash(),
        );
    }
    text
}

fn logs_dir() -> PathBuf {
    crate::parse_args().user_data_path.join("logs")
}

/// Writes a unit table named `name` into the logs directory, then deletes all but the newest
/// [`UNIT_TABLES_KEPT`] tables there.
fn write_unit_table(name: &str, text: &str) {
    let dir = logs_dir();
    let path = dir.join(name);
    match std::fs::write(&path, text) {
        Ok(()) => info!("Wrote the unit table to {}", path.display()),
        Err(e) => error!("Couldn't write the unit table to {}: {e}", path.display()),
    }
    delete_old_unit_tables(&dir);
}

fn delete_old_unit_tables(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut tables: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with(UNIT_TABLE_PREFIX) && name.ends_with(".csv")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    tables.sort_by_key(|&(modified, _)| std::cmp::Reverse(modified));
    for (_, path) in tables.into_iter().skip(UNIT_TABLES_KEPT) {
        if let Err(e) = std::fs::remove_file(&path) {
            warn!("Couldn't delete the old unit table {}: {e}", path.display());
        }
    }
}

/// Environment variable that makes plain playback write the unit table of one frame, in the
/// format an eviction writes it, so the two can be diffed: `SB_DESYNC_UNITS_FRAME=<frame>`.
#[cfg(debug_assertions)]
const UNITS_FRAME_ENV_VAR: &str = "SB_DESYNC_UNITS_FRAME";

/// Writes the unit table of frame `frame` if [`UNITS_FRAME_ENV_VAR`] asks for it. Called with the
/// state at the start of each logic step.
#[cfg(debug_assertions)]
pub(crate) unsafe fn write_requested_unit_table(bw: &crate::bw_scr::BwScr, frame: u32) {
    use std::sync::OnceLock;
    static REQUESTED: OnceLock<Option<u32>> = OnceLock::new();
    let requested = REQUESTED.get_or_init(|| {
        let spec = std::env::var(UNITS_FRAME_ENV_VAR).ok()?;
        match spec.parse::<u32>() {
            Ok(frame) => Some(frame),
            Err(_) => {
                error!("{UNITS_FRAME_ENV_VAR}={spec:?} is not a frame; ignoring it");
                None
            }
        }
    });
    if *requested != Some(frame) {
        return;
    }
    let mut units = Vec::new();
    let Some(probe) = (unsafe { bw.rollback_sync_probe(Some(&mut units)) }) else {
        return;
    };
    let game_id = &crate::parse_args().game_id;
    let text = unit_table_text(
        &format!(
            "# Units hashed at frame {frame} of game {game_id}, {}",
            probe.hash
        ),
        &units,
    );
    write_unit_table(
        &format!("{UNIT_TABLE_PREFIX}{game_id}-frame-{frame}.csv"),
        &text,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(frame: u32, units: u64) -> StateHash {
        StateHash {
            frame,
            frame_rng: 1,
            economy: 2,
            supply: 3,
            tech: 4,
            unit_count: 7,
            units,
            bullet_count: 0,
            bullets: 5,
        }
    }

    #[test]
    fn the_probe_line_ends_with_every_component() {
        let probe = SyncProbe {
            rng: [1, 0x2f, 3, 4, 5, 6],
            minerals: [50, 50, 0, 0],
            gas: [0; 4],
            trigger_timer: 3,
            hash: hash(240, 0xa),
        };
        assert_eq!(
            probe.to_string(),
            format!(
                "frame 240 rng [1, 2f, 3, 4, 5, 6] minerals [50, 50, 0, 0] gas [0, 0, 0, 0] \
                 trigger_timer 3 hash {:016x} frame_rng 0000000000000001 economy \
                 0000000000000002 supply 0000000000000003 tech 0000000000000004 \
                 units 7/000000000000000a bullets 0/0000000000000005",
                hash(240, 0xa).combined(),
            ),
        );
    }

    #[test]
    fn evidence_lines_carry_every_component() {
        let confirmed: VecDeque<ConfirmedReport> = [
            ConfirmedReport {
                position: 8,
                hash: hash(8, 0xa),
            },
            ConfirmedReport {
                position: 16,
                hash: hash(16, 0xb),
            },
        ]
        .into_iter()
        .collect();
        let block = evidence_block(&confirmed);
        let lines: Vec<&str> = block.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("the last 2 confirmed"));
        let combined = hash(16, 0xb).combined();
        assert_eq!(
            lines[2],
            format!(
                "  16 16 {combined:016x} 0000000000000001 0000000000000002 0000000000000003 \
                 0000000000000004 7/000000000000000b 0/0000000000000005"
            ),
        );
    }

    #[test]
    fn unit_table_rows_match_the_columns_and_stop_at_the_cap() {
        let units = vec![UnitRecord::default(); 3];
        let text = unit_table_text("# header", &units);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 5);
        let columns = UNIT_TABLE_COLUMNS.split(',').count();
        for row in &lines[2..] {
            assert_eq!(row.split(',').count(), columns);
        }

        let many = vec![UnitRecord::default(); MAX_UNIT_TABLE_BYTES / 40];
        let text = unit_table_text("# header", &many);
        assert!(text.len() < MAX_UNIT_TABLE_BYTES + 256);
        assert!(
            text.trim_end()
                .lines()
                .last()
                .unwrap()
                .starts_with("# Cut off after")
        );
    }
}
