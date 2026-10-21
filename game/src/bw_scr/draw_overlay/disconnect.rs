use std::time::Instant;

use egui::Color32;
use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectView, PeerState, SelfState as ViewSelfState,
};

use crate::app_messages::{SbUser, SbUserId};
use crate::netcode_v2::{DisconnectStatus, DisconnectTier, SelfState};
use crate::user_aliases;

/// One player of this game as the game itself knows them, which is the only place their color and
/// their side can be read from. The disconnect status names players by ShieldBattery user id, so a
/// roster entry is matched by user id, independently of its displayed alias.
pub(super) struct RosterPlayer {
    pub name: String,
    pub user_id: Option<SbUserId>,
    pub color: Color32,
    /// Whether they are on the local player's side.
    pub teammate: bool,
    /// Whether this is the local player, whose own row the dialog never draws: it is about the
    /// people being waited for.
    pub is_local: bool,
}

/// Builds the display view from the turn-state snapshot, the session's user list and the game's own
/// roster: one row per other player, carrying what the game knows about them (their color, whose
/// side they are on) and what the turn state knows (whether their turns are still arriving).
///
/// An all-healthy status builds an empty view, which the shell draws as nothing.
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
        SelfState::Disconnected => ViewSelfState::Disconnected,
        SelfState::Desynced => ViewSelfState::Desynced,
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
            .map(|u| user_aliases::display_name(u.id, &u.name).into_owned())
            // TODO(tec27): Translate this
            .unwrap_or_else(|| "Unknown player".to_string())
    };
    let mut rows: Vec<DisconnectRowView> = Vec::new();
    let mut named = Vec::new();
    for player in roster.iter().filter(|player| !player.is_local) {
        let trouble = troubled
            .iter()
            .find(|row| Some(row.user_id) == player.user_id);
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
                Some(DisconnectTier::Confirmed) => PeerState::LinkLost,
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
                DisconnectTier::Confirmed => PeerState::LinkLost,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netcode_v2::DisconnectedPeer;
    use rally_point_client::proto::ids::SlotId;
    use std::time::Duration;

    #[test]
    fn shared_aliases_do_not_change_drop_targets() {
        let now = Instant::now();
        let users = [
            SbUser {
                id: SbUserId(1),
                name: "First".into(),
                avatar_url: None,
            },
            SbUser {
                id: SbUserId(2),
                name: "Second".into(),
                avatar_url: None,
            },
        ];
        let roster = [SbUserId(1), SbUserId(2)].map(|user_id| RosterPlayer {
            name: "bob".into(),
            user_id: Some(user_id),
            color: Color32::WHITE,
            teammate: false,
            is_local: false,
        });
        let mut status = DisconnectStatus::healthy();
        status.peers.push(DisconnectedPeer {
            slot: SlotId(7),
            user_id: SbUserId(2),
            since: now - Duration::from_secs(60),
        });
        let view = build_disconnect_view(&status, &users, &roster, 0, now);
        assert_eq!(view.rows.len(), 2);
        assert!(matches!(view.rows[0].state, PeerState::Connected));
        assert_eq!(view.rows[1].slot, 7);
        assert!(view.rows[1].drop_unlocked);
        status.peers.push(DisconnectedPeer {
            slot: SlotId(3),
            user_id: SbUserId(1),
            since: now - Duration::from_secs(60),
        });
        let view = build_disconnect_view(&status, &users, &roster, 0, now);
        assert_eq!(view.rows.len(), 2);
        assert_eq!(view.rows[0].slot, 3);
        assert_eq!(view.rows[1].slot, 7);
    }
}
