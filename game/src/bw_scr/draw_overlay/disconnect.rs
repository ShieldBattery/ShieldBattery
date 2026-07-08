use egui::{
    Align2, Color32, CornerRadius, Frame, InnerResponse, Margin, Pos2, RichText, Sense, Stroke,
    Vec2, pos2, vec2,
};

use crate::app_messages::{GameSetupInfo, SbUser, SbUserId};
use crate::bw_scr::draw_overlay::{OverlayState, colors, fonts::display_family};
use crate::netcode_v2::{self, DisconnectStatus, DisconnectTier, SelfState};
use rally_point_client::proto::ids::SlotId;

/// Near-white high-emphasis colour for a row's primary text.
const PRIMARY: Color32 = Color32::from_rgb(0xE8, 0xEA, 0xED);
/// Amber accent for the waiting/disconnect messaging and the self-loss icon.
const WARNING: Color32 = Color32::from_rgb(0xFF, 0xB7, 0x4D);
/// Muted secondary for the elapsed counters and the drop-request acknowledgement.
const SECONDARY: Color32 = Color32::from_rgb(0x9A, 0x9F, 0xA6);

/// Text size for a per-player row.
const ROW_SIZE: f32 = 18.0;
/// Text size for the prominent self-disconnect notice.
const SELF_SIZE: f32 = 24.0;

/// One display-ready disconnect row: a logical row from the turn state with its player name
/// resolved. Holds no BW or turn-state types, so the render path below depends only on this and
/// egui.
struct DisconnectRowView {
    /// The slot a drop click targets.
    slot: SlotId,
    /// The player's display name.
    name: String,
    /// How long the condition has run, in whole seconds.
    seconds: u64,
    /// Which tier the row is in.
    tier: DisconnectTier,
    /// Whether the manual drop button should show.
    drop_unlocked: bool,
    /// Whether to briefly acknowledge a just-made drop request.
    drop_requested: bool,
}

/// Everything the disconnect overlay needs to draw itself, resolved from the turn state and game
/// setup. The render path takes only this (plus an egui context), so it can move to a
/// host-compilable preview later without any DLL dependency.
struct DisconnectView {
    rows: Vec<DisconnectRowView>,
    self_state: SelfState,
}

impl DisconnectView {
    /// Whether anything is worth drawing at all.
    fn is_empty(&self) -> bool {
        self.rows.is_empty() && self.self_state == SelfState::Healthy
    }

    /// Whether any row offers a drop button — the only thing that makes the overlay interactable.
    fn has_button(&self) -> bool {
        self.rows.iter().any(|row| row.drop_unlocked)
    }
}

/// Builds the display view from the turn-state snapshot and the session's user list, resolving each
/// row's user id to a name. The single place turn-state data and game-setup data meet.
fn build_disconnect_view(
    status: &DisconnectStatus,
    users: &[SbUser],
    now: std::time::Instant,
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
            slot: row.slot,
            name: resolve(row.user_id),
            seconds: row.seconds,
            tier: row.tier,
            drop_unlocked: row.drop_unlocked,
            drop_requested: row.drop_requested,
        })
        .collect();
    DisconnectView {
        rows,
        self_state: status.self_state(now),
    }
}

/// Renders the disconnect view and returns the slots whose Drop button was clicked this frame. The
/// area is interactable only while a Drop button is present, so ordinary rows never capture input.
fn render_disconnect_view(
    view: &DisconnectView,
    ctx: &egui::Context,
) -> InnerResponse<Vec<SlotId>> {
    egui::Area::new("sb_disconnect_overlay".into())
        .anchor(Align2::CENTER_TOP, vec2(0.0, 24.0))
        .order(egui::Order::Foreground)
        .interactable(view.has_button())
        .show(ctx, |ui| {
            let mut clicked = Vec::new();
            Frame::default()
                .fill(colors::CONTAINER_HIGH.gamma_multiply(0.85))
                .corner_radius(CornerRadius::same(8))
                .inner_margin(Margin::symmetric(16, 12))
                .show(ui, |ui| {
                    ui.vertical_centered(|ui| match view.self_state {
                        SelfState::Reconnecting => draw_self_lost(ui),
                        SelfState::Interrupted => {
                            // TODO(tec27): Translate this
                            ui.label(
                                RichText::new("Connection interrupted…")
                                    .size(ROW_SIZE)
                                    .color(WARNING)
                                    .family(display_family()),
                            );
                        }
                        SelfState::Healthy => {
                            for row in &view.rows {
                                draw_row(ui, row, &mut clicked);
                            }
                        }
                    });
                });
            clicked
        })
}

/// Draws the prominent self-disconnect notice: a signal-lost icon and larger, warning-coloured text.
fn draw_self_lost(ui: &mut egui::Ui) {
    ui.horizontal(|ui| {
        ui.add_space(2.0);
        paint_signal_lost_icon(ui, WARNING);
        ui.add_space(8.0);
        // TODO(tec27): Translate this
        ui.label(
            RichText::new("Connection to the server lost — reconnecting…")
                .size(SELF_SIZE)
                .color(WARNING)
                .family(display_family()),
        );
    });
}

/// Draws one player row: the waiting/disconnect message, the elapsed counter, and — for a
/// relay-confirmed row past the unlock threshold — the manual Drop button and any request note. A
/// click pushes the row's slot into `clicked`.
fn draw_row(ui: &mut egui::Ui, row: &DisconnectRowView, clicked: &mut Vec<SlotId>) {
    ui.horizontal(|ui| {
        // TODO(tec27): Translate these
        let message = match row.tier {
            DisconnectTier::Stall => format!("Waiting for {}…", row.name),
            DisconnectTier::Confirmed => format!("{} lost connection — waiting…", row.name),
        };
        ui.label(
            RichText::new(message)
                .size(ROW_SIZE)
                .color(PRIMARY)
                .family(display_family()),
        );
        ui.label(
            RichText::new(format!("({}s)", row.seconds))
                .size(ROW_SIZE)
                .color(SECONDARY)
                .family(display_family()),
        );
        if row.drop_unlocked {
            let button = egui::Button::new(
                RichText::new("Drop")
                    .size(ROW_SIZE)
                    .color(PRIMARY)
                    .family(display_family()),
            )
            .fill(colors::CONTAINER_HIGHEST);
            if ui.add(button).clicked() {
                clicked.push(row.slot);
            }
        }
        if row.drop_requested {
            ui.label(
                RichText::new("drop requested…")
                    .size(ROW_SIZE)
                    .color(SECONDARY)
                    .family(display_family()),
            );
        }
    });
}

/// Paints three ascending signal bars with a diagonal slash through them, in `color`, sized to sit
/// beside the self-notice text. Drawn from egui primitives so it needs no image asset.
fn paint_signal_lost_icon(ui: &mut egui::Ui, color: Color32) {
    let size = Vec2 { x: 30.0, y: 24.0 };
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let painter = ui.painter_at(rect);
    let bar_width = 6.0;
    let gap = 3.0;
    let baseline = rect.bottom() - 2.0;
    let heights = [8.0, 14.0, 20.0];
    for (i, &height) in heights.iter().enumerate() {
        let x = rect.left() + 2.0 + i as f32 * (bar_width + gap);
        let bar = egui::Rect {
            min: Pos2 {
                x,
                y: baseline - height,
            },
            max: Pos2 {
                x: x + bar_width,
                y: baseline,
            },
        };
        painter.rect_filled(bar, CornerRadius::same(1), color);
    }
    // A slash from lower-left to upper-right, backed by a darker outline so it reads against the
    // bars.
    let start = pos2(rect.left() + 1.0, rect.bottom() - 1.0);
    let end = pos2(rect.right() - 1.0, rect.top() + 1.0);
    painter.line_segment(
        [start, end],
        Stroke::new(4.0, Color32::from_black_alpha(180)),
    );
    painter.line_segment([start, end], Stroke::new(2.0, color));
}

impl OverlayState {
    /// Draws the survivor disconnect notice: a small, translucent panel anchored top-center that
    /// names the players the local simulation is waiting on. A row starts as a plain
    /// stall-tier "Waiting for {name}…" the moment the turn stream stalls, and upgrades to
    /// "{name} lost connection — waiting…" once the relay confirms that link is dead. A confirmed row
    /// past the unlock threshold grows a Drop button that submits a manual drop request; while this
    /// client's own link is down, a single prominent notice replaces the per-peer rows.
    ///
    /// Renders in every build — this is product UX, not debug output — and only while there is
    /// something to report; an all-healthy status draws nothing. The panel captures mouse input only
    /// while a Drop button is showing (following the interactable-overlay mechanism the replay stats
    /// window uses); otherwise clicks and keys pass straight through to the game.
    pub(super) fn add_disconnect_overlay(
        &mut self,
        status: &DisconnectStatus,
        setup_info: Option<&GameSetupInfo>,
        ctx: &egui::Context,
    ) {
        let users = setup_info.map(|info| info.users.as_slice()).unwrap_or(&[]);
        let view = build_disconnect_view(status, users, std::time::Instant::now());
        if view.is_empty() {
            return;
        }

        let interactable = view.has_button();
        let res = render_disconnect_view(&view, ctx);
        // Each clicked Drop button submits the identical drop request the debug command uses. Safe
        // to reach the turn state here: the draw path holds no turn-state lock across `step`.
        for &slot in &res.inner {
            netcode_v2::with_turn_state(|s| s.request_drop(slot));
        }
        // Register the panel's rect (respecting whether higher-priority BW menus are open) only when
        // it is interactable, so the game doesn't lose clicks to a passive notice.
        if interactable {
            self.add_ui_rect(&Some(res));
        }
    }
}
