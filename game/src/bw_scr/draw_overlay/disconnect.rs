use egui::{
    Align, Align2, Color32, CornerRadius, Frame, InnerResponse, Layout, Margin, Pos2, RichText,
    Sense, Stroke, Vec2, pos2, vec2,
};

use crate::app_messages::{GameSetupInfo, SbUser, SbUserId};
use crate::bw_scr::draw_overlay::{OverlayState, colors, fonts::display_family};
use crate::netcode_v2::{self, DROP_UNLOCK_UI, DisconnectStatus, DisconnectTier, SelfState};
use rally_point_client::proto::ids::SlotId;

/// Near-white high-emphasis colour for a row's primary text.
const PRIMARY: Color32 = Color32::from_rgb(0xE8, 0xEA, 0xED);
/// Amber accent for the waiting/disconnect messaging and the self-loss icon.
const WARNING: Color32 = Color32::from_rgb(0xFF, 0xB7, 0x4D);
/// Muted secondary for the elapsed counters and the drop-request acknowledgement.
const SECONDARY: Color32 = Color32::from_rgb(0x9A, 0x9F, 0xA6);

/// Enabled Drop button fill: an amber/danger accent, so the button reads as a distinct, deliberate
/// action rather than another line of text.
const DROP_BUTTON_FILL: Color32 = colors::AMBER60;
/// Enabled Drop button border, a shade darker than its fill.
const DROP_BUTTON_BORDER: Color32 = colors::AMBER30;
/// Enabled Drop button label colour — dark, for contrast against the bright amber fill.
const DROP_BUTTON_TEXT: Color32 = colors::GREY10;
/// Disabled (still-counting-down) Drop button fill: muted grey, distinct from the amber "ready" look.
const DROP_BUTTON_DISABLED_FILL: Color32 = colors::GREY30;
/// Disabled Drop button border.
const DROP_BUTTON_DISABLED_BORDER: Color32 = colors::GREY40;
/// Disabled Drop button label colour.
const DROP_BUTTON_DISABLED_TEXT: Color32 = colors::GREY60;

/// Text size for a per-player row.
const ROW_SIZE: f32 = 18.0;
/// Text size for the peers panel's header line — a bit larger than a row, so it reads as the single
/// statement of what the panel is rather than another row.
const HEADER_SIZE: f32 = 20.0;
/// Text size for the prominent self-disconnect notice.
const SELF_SIZE: f32 = 24.0;
/// Minimum size of the Drop button's hit area — noticeably larger than a text-sized default so it
/// reads unambiguously as a clickable button rather than a label.
const DROP_BUTTON_SIZE: Vec2 = Vec2 { x: 96.0, y: 32.0 };
/// Horizontal gap between grid columns, and between the Drop button and its drop-requested
/// acknowledgement within the action cell.
const COLUMN_SPACING: f32 = 14.0;
/// Vertical gap between grid rows — enough that stacked rows read as a table, not a cramped block.
const ROW_SPACING: f32 = 12.0;
/// Vertical gap between the "Waiting for players" header and the first row.
const HEADER_GAP: f32 = 12.0;

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
    /// Whether the manual drop button is enabled: shown from the moment the row is
    /// [`Confirmed`](DisconnectTier::Confirmed), greyed out and disabled with a countdown label
    /// until this flips, then clickable.
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

    /// Whether any row shows a Drop button (enabled or still counting down) — the only thing that
    /// makes the overlay interactable. Keyed on the tier rather than `drop_unlocked`: the button
    /// itself is present (just disabled) before the unlock threshold, so the overlay's input rect
    /// must be registered from the moment a row goes confirmed, not only once the button is
    /// clickable.
    fn has_button(&self) -> bool {
        self.rows
            .iter()
            .any(|row| row.tier == DisconnectTier::Confirmed)
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
                .inner_margin(Margin::symmetric(20, 16))
                .show(ui, |ui| {
                    ui.vertical_centered(|ui| match view.self_state {
                        // TODO(tec27): Translate this
                        SelfState::Reconnecting => {
                            draw_self_notice(ui, "Lost connection to the server, reconnecting…")
                        }
                        SelfState::Healthy => draw_peers_panel(ui, &view.rows, &mut clicked),
                    });
                });
            clicked
        })
}

/// Draws the prominent self-connection notice: a signal-lost icon beside larger, warning-coloured
/// text. Only ever shown for a relay-confirmed self-link loss (see [`SelfState`]) — never on a mere
/// guess from the remote roster's behavior.
fn draw_self_notice(ui: &mut egui::Ui, text: &str) {
    ui.horizontal(|ui| {
        ui.add_space(2.0);
        paint_signal_lost_icon(ui, WARNING);
        ui.add_space(8.0);
        ui.label(
            RichText::new(text)
                .size(SELF_SIZE)
                .color(WARNING)
                .family(display_family()),
        );
    });
}

/// Draws the peers panel: a "Waiting for players" header followed by one column-aligned row per
/// blocking or relay-confirmed player — name, elapsed time, and (for a relay-confirmed row) the
/// manual Drop button. Mirrors the layout of SC:R's native waiting-for-players dialog rather than a
/// per-row sentence, so several simultaneous disconnects stack as a clean table instead of repeated
/// shortened sentences. The header states once what the panel is; individual rows don't restate it.
fn draw_peers_panel(ui: &mut egui::Ui, rows: &[DisconnectRowView], clicked: &mut Vec<SlotId>) {
    // TODO(tec27): Translate this
    ui.label(
        RichText::new("Waiting for players")
            .size(HEADER_SIZE)
            .color(PRIMARY)
            .strong()
            .family(display_family()),
    );
    ui.add_space(HEADER_GAP);
    egui::Grid::new("sb_disconnect_rows")
        .num_columns(3)
        .spacing(vec2(COLUMN_SPACING, ROW_SPACING))
        .show(ui, |ui| {
            for row in rows {
                ui.label(
                    RichText::new(&row.name)
                        .size(ROW_SIZE)
                        .color(PRIMARY)
                        .family(display_family()),
                );
                ui.label(
                    RichText::new(format!("{}s", row.seconds))
                        .size(ROW_SIZE)
                        .color(SECONDARY)
                        .family(display_family()),
                );
                draw_action_cell(ui, row, clicked);
                ui.end_row();
            }
        });
}

/// A row's action-column cell: the manual Drop button for a [`Confirmed`](DisconnectTier::Confirmed)
/// row (with its drop-requested acknowledgement alongside it, if a click just happened), or nothing
/// for a [`Stall`](DisconnectTier::Stall) row — there is no relay-confirmed death yet to drop.
fn draw_action_cell(ui: &mut egui::Ui, row: &DisconnectRowView, clicked: &mut Vec<SlotId>) {
    if row.tier != DisconnectTier::Confirmed {
        // An explicit empty cell, so every row touches all three grid columns the same way.
        ui.label("");
        return;
    }
    ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
        draw_drop_button(ui, row, clicked);
        if row.drop_requested {
            // TODO(tec27): Translate this
            ui.label(
                RichText::new("drop requested…")
                    .size(ROW_SIZE)
                    .color(SECONDARY)
                    .family(display_family()),
            );
        }
    });
}

/// Draws the Drop button for a [`Confirmed`](DisconnectTier::Confirmed) row: shown from the moment
/// the relay confirms the drop, labeled with a countdown and disabled/greyed until
/// [`DROP_UNLOCK_UI`], then a plain, clickable, amber/danger-filled button. A click while enabled
/// pushes the row's slot into `clicked`; a disabled button ignores clicks entirely (no request can
/// reach a relay that wouldn't yet honor it).
fn draw_drop_button(ui: &mut egui::Ui, row: &DisconnectRowView, clicked: &mut Vec<SlotId>) {
    let enabled = row.drop_unlocked;
    let label = if enabled {
        "Drop".to_string()
    } else {
        let remaining = DROP_UNLOCK_UI.as_secs().saturating_sub(row.seconds);
        format!("Drop ({remaining}s)")
    };
    let (fill, border, text_color) = if enabled {
        (DROP_BUTTON_FILL, DROP_BUTTON_BORDER, DROP_BUTTON_TEXT)
    } else {
        (
            DROP_BUTTON_DISABLED_FILL,
            DROP_BUTTON_DISABLED_BORDER,
            DROP_BUTTON_DISABLED_TEXT,
        )
    };
    let button = egui::Button::new(
        RichText::new(label)
            .size(ROW_SIZE)
            .color(text_color)
            .strong()
            .family(display_family()),
    )
    .fill(fill)
    .stroke(Stroke::new(1.5, border))
    .corner_radius(CornerRadius::same(6))
    .min_size(DROP_BUTTON_SIZE);
    let response = ui.add_enabled(enabled, button);
    if enabled && response.hovered() {
        // egui doesn't vary an explicit `.fill()` on hover, so paint a subtle highlight over the
        // button ourselves — visible feedback that it's a live, clickable control.
        ui.painter().rect_filled(
            response.rect,
            CornerRadius::same(6),
            Color32::from_white_alpha(28),
        );
    }
    if response.clicked() {
        clicked.push(row.slot);
    }
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
        // Register the panel's rect only when it is interactable, so the game doesn't lose clicks to
        // a passive notice. Unconditional on `ui_active` (see the doc comment above): a suppressed
        // BW dialog sitting on the stack must never be able to steal the Drop button's clicks.
        if interactable {
            self.force_add_ui_rect(&Some(res), false);
        }
    }
}
