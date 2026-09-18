use std::time::Instant;

use egui::Color32;
use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectView, PeerState, SelfState as ViewSelfState,
};

use crate::app_messages::{SbUser, SbUserId};
use crate::netcode_v2::{DisconnectStatus, DisconnectTier, SelfState};

/// One player of this game as the game itself knows them, which is the only place their color and
/// their side can be read from. The disconnect status names players by ShieldBattery user id, so a
/// roster entry is matched to a status row through the name the two have in common.
pub(super) struct RosterPlayer {
    pub name: String,
    pub color: Color32,
    /// Whether they are on the local player's side.
    pub teammate: bool,
    /// Whether this is the local player, whose own row the dialog never draws: it is about the
    /// people being waited for.
    pub is_local: bool,
}

/// Builds the display view from the turn-state snapshot, the session's user list and the game's own
/// roster: one row per other player, carrying what the game knows about them (their color, whose
/// side they are on) and what the turn state knows (whether their turns are still arriving). The
/// single place turn-state data and game data meet.
///
/// The surface itself is drawn by the shell, which decides from this view which of its two forms is
/// up: the roster, naming everyone the simulation is waiting on among everyone still playing, or
/// the prominent notice for this client's own link being down. Product UX, drawn in every build; an
/// all-healthy status draws nothing at all.
pub(super) fn build_disconnect_view(
    status: &DisconnectStatus,
    users: &[SbUser],
    roster: &[RosterPlayer],
    self_seconds: u64,
    now: Instant,
) -> DisconnectView {
    let self_state = match status.self_state(now) {
        SelfState::Healthy => ViewSelfState::Healthy,
        SelfState::Reconnecting => ViewSelfState::Reconnecting,
    };
    let troubled = status.rows(now);
    // A game where everyone's turns are arriving is the normal state of a game, so it costs nothing
    // beyond the check: no names are resolved and no roster is walked.
    if troubled.is_empty() && self_state == ViewSelfState::Healthy {
        return DisconnectView {
            rows: Vec::new(),
            self_state,
            self_seconds,
        };
    }
    let resolve = |user_id: SbUserId| -> String {
        users
            .iter()
            .find(|u| u.id == user_id)
            .map(|u| u.name.clone())
            // TODO(tec27): Translate this
            .unwrap_or_else(|| "Unknown player".to_string())
    };
    let mut rows: Vec<DisconnectRowView> = Vec::new();
    let mut named = Vec::new();
    for player in roster.iter().filter(|player| !player.is_local) {
        let trouble = troubled
            .iter()
            .find(|row| resolve(row.user_id) == player.name);
        if let Some(row) = trouble {
            named.push(row.slot);
        }
        rows.push(DisconnectRowView {
            slot: trouble.map_or(0, |row| row.slot.0),
            name: player.name.clone(),
            color: player.color,
            teammate: player.teammate,
            seconds: trouble.map_or(0, |row| row.seconds),
            state: match trouble.map(|row| row.tier) {
                None => PeerState::Connected,
                Some(DisconnectTier::Stall) => PeerState::Stalled,
                Some(DisconnectTier::Confirmed) => PeerState::Reconnecting,
            },
            drop_unlocked: trouble.is_some_and(|row| row.drop_unlocked),
            drop_requested: trouble.is_some_and(|row| row.drop_requested),
        });
    }
    // A player the game's own roster does not account for is still one the simulation is waiting
    // on, and losing their row would leave the surface saying everyone is fine while the game sits
    // stopped. They get a row of their own, in the color the overlay uses where it has none.
    for row in troubled.iter().filter(|row| !named.contains(&row.slot)) {
        rows.push(DisconnectRowView {
            slot: row.slot.0,
            name: resolve(row.user_id),
            color: overlay_ui::kit::theme::TEXT_DIM,
            teammate: false,
            seconds: row.seconds,
            state: match row.tier {
                DisconnectTier::Stall => PeerState::Stalled,
                DisconnectTier::Confirmed => PeerState::Reconnecting,
            },
            drop_unlocked: row.drop_unlocked,
            drop_requested: row.drop_requested,
        });
    }
    DisconnectView {
        rows,
        self_state,
        self_seconds,
    }
}
