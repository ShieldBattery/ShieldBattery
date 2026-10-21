use overlay_ui::netstat::{
    NetEventView, NetStatRowView, NetStatsView, RollbackEngineView, RollbackNetView, RowDeparture,
};

use crate::app_messages::{SbUser, SbUserId};
use crate::netcode_v2::{DepartureKind, NetEvent, NetStatsStatus};
use crate::rollback_live::{self, NetStatus};
use crate::user_aliases;

/// Builds the display view from the network-stats snapshot and the session's user list, resolving
/// each row's user id to a name and formatting each event into a line. Durations are flattened to
/// whole milliseconds/seconds here so the presentation layer carries only plain numbers.
pub(super) fn build_netstat_view(
    status: &NetStatsStatus,
    rollback: Option<&NetStatus>,
    users: &[SbUser],
) -> NetStatsView {
    let resolve = |user_id: SbUserId| -> String {
        users
            .iter()
            .find(|u| u.id == user_id)
            .map(|u| user_aliases::display_name(u.id, &u.name).into_owned())
            // TODO(tec27): Translate this
            .unwrap_or_else(|| "Unknown player".to_string())
    };
    let rows = status
        .rows
        .iter()
        .map(|row| NetStatRowView {
            name: resolve(row.user_id),
            home: format_home(row.home_relay_id, row.home_region.as_deref()),
            last_turn_age_ms: row.stats.last_turn_age.map(|d| d.as_millis() as u64),
            ewma_interval_ms: row.stats.ewma_interval.map(|d| d.as_millis() as u64),
            max_gap_ms: row.stats.max_gap.as_millis() as u64,
            recent_stall_ms: row.stats.recent_stall.as_millis() as u64,
            lifetime_stall_ms: row.stats.lifetime_stall.as_millis() as u64,
            episode_count: row.stats.episode_count,
            departure: row.stats.departed.map(|kind| match kind {
                DepartureKind::Left => RowDeparture::Left,
                DepartureKind::Dropped => RowDeparture::Dropped,
            }),
        })
        .collect();
    let events = status
        .events
        .iter()
        .map(|entry| NetEventView {
            elapsed_secs: entry.elapsed.as_secs(),
            text: format_event(&entry.event),
        })
        .collect();
    NetStatsView {
        session_id: status.session_id,
        relay_id: status.relay_id,
        region: status.region.clone(),
        buffer_turns: status.buffer_turns,
        buffer_change_count: status.buffer_change_count,
        buffer_last_change_secs: status.buffer_last_change.map(|d| d.as_secs()),
        link_up: status.link_up,
        link_down_count: status.link_down_count,
        link_last_change_secs: status.link_last_change.map(|d| d.as_secs()),
        buffer_samples: status.buffer_samples.clone(),
        gap_samples_ms: status
            .gap_samples
            .iter()
            .map(|d| d.as_millis() as u64)
            .collect(),
        events,
        phase_applied_us: status.phase_applied_us,
        phase_target_us: status.phase_target_us,
        rollback: rollback.map(build_rollback_view),
        rows,
    }
}

/// What the panel says about a game that rolls back: the split it plays with now, and what the
/// engine has done since the lockstep start.
fn build_rollback_view(status: &NetStatus) -> RollbackNetView {
    RollbackNetView {
        delay_frames: status.delay,
        rollback_frames: status.rollback,
        rollback_target: status.rollback_target,
        prediction_limit: status.prediction_limit,
        engine: status.stats.as_ref().map(|stats| RollbackEngineView {
            relay_lateness_p90_us: stats.lead_p90_last_us,
            clock_stopped_ms: stats.clock_stopped_us / 1000,
            clock_stops: stats.clock_stops,
            rollbacks: stats.rollbacks,
            deepest_rollback: stats.deepest_rollback,
            mispredicted_turns: stats.mispredicted_turns,
            confirmed_predictions: stats.confirmed_predictions,
            worst_tick_us: stats.worst_tick_us,
            slow_ticks: stats.slow_ticks,
            slow_tick_ms: rollback_live::SLOW_TICK_MS,
        }),
    }
}

/// Formats a slot's home relay for the table's `home` column: `r<id>` with the region appended when
/// present (`r1 local-a`), or `None` (rendered as an em dash) when the setup carried no relay id.
fn format_home(relay_id: Option<u64>, region: Option<&str>) -> Option<String> {
    relay_id.map(|id| match region {
        Some(region) => format!("r{id} {region}"),
        None => format!("r{id}"),
    })
}

/// Formats one recent event into its ticker line (the `mm:ss` timestamp is prepended by the render).
fn format_event(event: &NetEvent) -> String {
    match *event {
        NetEvent::BufferChanged { from, to } => format!("buffer {from} → {to} turns"),
        NetEvent::LinkLost => "link lost".to_string(),
        NetEvent::LinkRestored { outage } => {
            format!("link back ({:.1}s)", outage.as_secs_f64())
        }
        NetEvent::Rehomed { from, to } => format!("re-homed relay {from} → {to}"),
    }
}
