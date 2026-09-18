use std::time::Instant;

use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectTier as ViewTier, DisconnectView, SelfState as ViewSelfState,
};

use crate::app_messages::{SbUser, SbUserId};
use crate::netcode_v2::{DisconnectStatus, DisconnectTier, SelfState};

/// Builds the display view from the turn-state snapshot and the session's user list, resolving each
/// row's user id to a name and mapping the turn-state tier / self-state onto the presentation
/// enums the render path takes. The single place turn-state data and game-setup data meet.
///
/// The surface itself is drawn by the shell, which decides from this view which of its two modals is
/// up: a stall-aware notice naming the players the simulation is waiting on, or the prominent notice
/// for this client's own link being down. Product UX, drawn in every build; an all-healthy status
/// draws nothing at all.
pub(super) fn build_disconnect_view(
    status: &DisconnectStatus,
    users: &[SbUser],
    now: Instant,
) -> DisconnectView {
    let resolve = |user_id: SbUserId| -> String {
        users
            .iter()
            .find(|u| u.id == user_id)
            .map(|u| u.name.clone())
            // TODO(tec27): Translate this
            .unwrap_or_else(|| "Unknown player".to_string())
    };
    let rows = status
        .rows(now)
        .into_iter()
        .map(|row| DisconnectRowView {
            slot: row.slot.0,
            name: resolve(row.user_id),
            seconds: row.seconds,
            tier: match row.tier {
                DisconnectTier::Stall => ViewTier::Stall,
                DisconnectTier::Confirmed => ViewTier::Confirmed,
            },
            drop_unlocked: row.drop_unlocked,
            drop_requested: row.drop_requested,
        })
        .collect();
    DisconnectView {
        rows,
        self_state: match status.self_state(now) {
            SelfState::Healthy => ViewSelfState::Healthy,
            SelfState::Reconnecting => ViewSelfState::Reconnecting,
        },
    }
}
