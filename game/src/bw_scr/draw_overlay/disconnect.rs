use std::time::Instant;

use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectTier as ViewTier, DisconnectView, SelfState as ViewSelfState,
    render_disconnect_view,
};
use rally_point_client::proto::ids::SlotId;

use crate::app_messages::{GameSetupInfo, SbUser, SbUserId};
use crate::bw_scr::draw_overlay::OverlayState;
use crate::netcode_v2::{self, DisconnectStatus, DisconnectTier, SelfState};

/// Builds the display view from the turn-state snapshot and the session's user list, resolving each
/// row's user id to a name and mapping the turn-state tier / self-state onto the presentation
/// enums the render path takes. The single place turn-state data and game-setup data meet.
fn build_disconnect_view(
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

impl OverlayState {
    /// Draws the survivor disconnect notice: a small, translucent panel anchored top-center. While
    /// this client's own link is relay-confirmed down, it is the single prominent self notice (never
    /// on a mere stall, however wide, since an unconfirmed stall is exactly as likely to be a peer's
    /// link as ours). Otherwise, whenever the local simulation is blocked on at least one remote
    /// participant's turn (a mere stall) or the relay has confirmed a peer's link death, it is a
    /// "Waiting for players" header over one column-aligned row per such player — name, elapsed
    /// time, and, for a relay-confirmed row, a Drop button (greyed out with a countdown until the
    /// unlock threshold, then clickable).
    ///
    /// Renders in every build — this is product UX, not debug output — and only while there is
    /// something to report; an all-healthy status draws nothing. The panel captures mouse input only
    /// while a Drop button is showing (registered via [`force_add_ui_rect`](OverlayState::force_add_ui_rect)
    /// rather than the `ui_active`-gated [`add_ui_rect`](OverlayState::add_ui_rect): BW's native
    /// "TimeOut" waiting-for-players dialog is suppressed but still spawned — see
    /// `dialog_hook::spawn_dialog_hook` — and sitting at the top of BW's dialog stack, it drives
    /// `ui_active` to `false` exactly while the Drop button needs to be clickable, so the Drop
    /// button's rect must win regardless); otherwise clicks and keys pass straight through to the
    /// game.
    pub(super) fn add_disconnect_overlay(
        &mut self,
        status: &DisconnectStatus,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        let users = setup_info.map(|info| info.users.as_slice()).unwrap_or(&[]);
        let view = build_disconnect_view(status, users, Instant::now());
        if view.is_empty() {
            return;
        }

        let interactable = view.has_button();
        let res = render_disconnect_view(&view, ctx);
        // Each clicked Drop button submits the identical drop request the debug command uses. Safe
        // to reach the turn state here: the draw path holds no turn-state lock across `step`.
        for &slot in &res.inner {
            netcode_v2::with_turn_state(|s| s.request_drop(SlotId(slot)));
        }
        // Register the panel's rect only when it is interactable, so the game doesn't lose clicks to
        // a passive notice. Unconditional on `ui_active` (see the doc comment above): a suppressed
        // BW dialog sitting on the stack must never be able to steal the Drop button's clicks.
        if interactable {
            self.force_add_ui_rect(&Some(res), false);
        }
    }
}
