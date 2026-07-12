use overlay_ui::netstat::{NetEventView, NetStatRowView, NetStatsView, render_netstat_view};

use crate::app_messages::{GameSetupInfo, SbUser, SbUserId};
use crate::bw_scr::draw_overlay::OverlayState;
use crate::netcode_v2::{NetEvent, NetStatsStatus};

/// Builds the display view from the network-stats snapshot and the session's user list, resolving
/// each row's user id to a name and formatting each event into a line. The single place net-stats
/// data and game-setup data meet — the net-stats analogue of `disconnect::build_disconnect_view`.
/// Durations are flattened to whole milliseconds/seconds here so the presentation layer carries only
/// plain numbers.
fn build_netstat_view(status: &NetStatsStatus, users: &[SbUser]) -> NetStatsView {
    let resolve = |user_id: SbUserId| -> String {
        users
            .iter()
            .find(|u| u.id == user_id)
            .map(|u| u.name.clone())
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
        rows,
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

impl OverlayState {
    /// Draws the `/netstat` network-stats overlay: a compact, translucent panel anchored top-right
    /// (clear of the top-center disconnect overlay), shown only while the overlay is toggled on — a
    /// `Some` snapshot. `None` (toggled off, or no session) draws nothing. Player names resolve the
    /// same way the disconnect overlay resolves them, from the session's user list.
    ///
    /// Purely informational: it registers no ui rect, so it never captures input and never interferes
    /// with play while it's up.
    pub(super) fn add_netstat_overlay(
        &mut self,
        status: Option<&NetStatsStatus>,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        let Some(status) = status else {
            return;
        };
        let users = setup_info.map(|info| info.users.as_slice()).unwrap_or(&[]);
        let view = build_netstat_view(status, users);
        render_netstat_view(&view, ctx);
    }
}
