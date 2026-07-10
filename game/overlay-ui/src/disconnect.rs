//! The disconnect overlay's presentation layer: a plain-data view-model and the egui render fns that
//! draw it. Everything here is a pure fn of [`DisconnectView`] plus an [`egui::Context`], so the same
//! code renders in the injected game DLL and in the host preview.

use std::time::Duration;

use egui::{
    Align, Align2, Color32, CornerRadius, Frame, InnerResponse, Layout, Margin, Pos2, RichText,
    Sense, Stroke, Vec2, WidgetText, pos2, vec2,
};

use crate::colors;
use crate::fonts::display_family;

/// A relay-confirmed disconnect must last at least this long before the overlay offers its manual
/// drop; the Drop button's countdown label counts down toward it. Mirrors the turn-state constant of
/// the same name that computes each row's [`drop_unlocked`](DisconnectRowView::drop_unlocked) flag,
/// kept here so the presentation layer carries the one value its countdown label needs without
/// depending on the netcode crate.
pub const DROP_UNLOCK_UI: Duration = Duration::from_secs(45);

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
/// Fixed size of the Drop button's hit area, wide enough to fit its longest possible label,
/// `"Drop (45s)"` (the countdown starts at [`DROP_UNLOCK_UI`]'s whole seconds), so the button
/// keeps the same footprint whether it reads "Drop (45s)" or just "Drop" — see [`draw_drop_button`],
/// which renders it via `add_sized` rather than treating this as a mere minimum.
const DROP_BUTTON_SIZE: Vec2 = Vec2 { x: 140.0, y: 32.0 };
/// Minimum width of every grid column — generous enough that typical player names and any realistic
/// elapsed count fit without growing their column, keeping the panel width steady. Columns still
/// grow to fit wider content; this only sets a floor.
const COL_MIN_WIDTH: f32 = 110.0;
/// Horizontal gap between grid columns, and between the Drop button and its drop-requested
/// acknowledgement within the action cell — generous, so the name/elapsed/action columns read as
/// distinct fields rather than a run-on line.
const COLUMN_SPACING: f32 = 20.0;
/// Vertical gap between grid rows — enough that stacked rows read as a table, not a cramped block.
const ROW_SPACING: f32 = 12.0;
/// Vertical gap between the "Waiting for players" header and the first row.
const HEADER_GAP: f32 = 12.0;

/// Which of the two disconnect tiers a row is in — the presentation-side mirror of the turn-state
/// enum of the same name. The caller maps its own tier onto this when building the view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisconnectTier {
    /// The sim is blocked on this player's turn, but no link death has been relay-confirmed.
    /// Informational only — no drop is offered.
    Stall,
    /// The relay confirmed this player's link is down. The drop-unlock clock runs from the
    /// confirmation, and the manual drop appears once it passes [`DROP_UNLOCK_UI`].
    Confirmed,
}

/// This client's own connection state, deciding whether the overlay shows the prominent self-notice
/// or the peers panel. The presentation-side mirror of the turn-state enum of the same name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfState {
    /// Our link is fine; any rows are about peers.
    Healthy,
    /// The relay confirmed our own link is down (or the session ended); show the prominent self
    /// notice.
    Reconnecting,
}

/// One display-ready disconnect row: a logical row from the turn state with its player name
/// resolved. Holds no BW or turn-state types, so the render path below depends only on this and
/// egui.
pub struct DisconnectRowView {
    /// The slot a drop click targets, as the raw rally-point2 slot id. Round-tripped back to the
    /// caller through [`render_disconnect_view`]'s clicked list.
    pub slot: u8,
    /// The player's display name.
    pub name: String,
    /// How long the condition has run, in whole seconds.
    pub seconds: u64,
    /// Which tier the row is in.
    pub tier: DisconnectTier,
    /// Whether the manual drop button is enabled: shown from the moment the row is
    /// [`Confirmed`](DisconnectTier::Confirmed), greyed out and disabled with a countdown label
    /// until this flips, then clickable.
    pub drop_unlocked: bool,
    /// Whether to briefly acknowledge a just-made drop request.
    pub drop_requested: bool,
}

/// Everything the disconnect overlay needs to draw itself, resolved from the turn state and game
/// setup. The render path takes only this (plus an egui context), so it renders identically in the
/// game DLL and the host preview.
pub struct DisconnectView {
    pub rows: Vec<DisconnectRowView>,
    pub self_state: SelfState,
}

impl DisconnectView {
    /// Whether anything is worth drawing at all.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty() && self.self_state == SelfState::Healthy
    }

    /// Whether any row shows a Drop button (enabled or still counting down) — the only thing that
    /// makes the overlay interactable. Keyed on the tier rather than `drop_unlocked`: the button
    /// itself is present (just disabled) before the unlock threshold, so the overlay's input rect
    /// must be registered from the moment a row goes confirmed, not only once the button is
    /// clickable.
    pub fn has_button(&self) -> bool {
        self.rows
            .iter()
            .any(|row| row.tier == DisconnectTier::Confirmed)
    }
}

/// Renders the disconnect view and returns the slots whose Drop button was clicked this frame. The
/// area is interactable only while a Drop button is present, so ordinary rows never capture input.
pub fn render_disconnect_view(
    view: &DisconnectView,
    ctx: &egui::Context,
) -> InnerResponse<Vec<u8>> {
    egui::Area::new("sb_disconnect_overlay".into())
        .anchor(Align2::CENTER_TOP, vec2(0.0, 72.0))
        .order(egui::Order::Foreground)
        .interactable(view.has_button())
        .show(ctx, |ui| {
            let mut clicked = Vec::new();
            Frame::default()
                .fill(colors::CONTAINER_HIGH.gamma_multiply(0.85))
                // A subtle 1px outline so the panel separates cleanly from the game behind it.
                .stroke(Stroke::new(1.0, colors::GREY40))
                .corner_radius(CornerRadius::same(8))
                .inner_margin(Margin::symmetric(20, 16))
                .show(ui, |ui| {
                    // A plain left-aligned `vertical` so the panel hugs its content and can shrink
                    // back after a transient widening. A centring layout here would expand to the
                    // full available width and, fed by this auto-sized `Area`, pin the panel
                    // permanently wide (see the note in [`draw_peers_panel`], which centres the
                    // header by hand instead).
                    ui.vertical(|ui| match view.self_state {
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
fn draw_peers_panel(ui: &mut egui::Ui, rows: &[DisconnectRowView], clicked: &mut Vec<u8>) {
    // The header is centred over the rows below it, but it must NOT drive the panel's width. egui's
    // centring layouts (`vertical_centered` and friends) expand their `min_rect` to the full
    // available width — "pretend we used whole frame" — and because this panel lives in an
    // auto-sized `Area` whose width feeds back into that available width, a centred container pins
    // the panel to whatever width it ever reached and never shrinks: a single transient widening (a
    // `drop_requested` acknowledgement, or a wide name that later leaves) would strand the panel
    // permanently wide, with dead space to the right of the Drop button. So the panel hugs its
    // content with a plain left-aligned `vertical` (see [`render_disconnect_view`]) and the header
    // is measured and painted centred over the grid by hand — centring the text without letting a
    // centring layout claim the width.
    // TODO(tec27): Translate this
    let header = RichText::new("Waiting for players")
        .size(HEADER_SIZE)
        .color(PRIMARY)
        .strong()
        .family(display_family());
    let header_galley = WidgetText::from(header).into_galley(
        ui,
        Some(egui::TextWrapMode::Extend),
        f32::INFINITY,
        egui::TextStyle::Body,
    );
    // Reserve the header's vertical space up front (left-aligned, only as wide as the text) so the
    // grid lays out below it; the text is repositioned to centre once the grid's width is known.
    let (_, header_slot) = ui.allocate_space(header_galley.size());
    ui.add_space(HEADER_GAP);
    let grid = egui::Grid::new("sb_disconnect_rows")
        .num_columns(3)
        .spacing(vec2(COLUMN_SPACING, ROW_SPACING))
        .min_col_width(COL_MIN_WIDTH)
        .show(ui, |ui| {
            for row in rows {
                ui.label(
                    RichText::new(&row.name)
                        .size(ROW_SIZE)
                        .color(PRIMARY)
                        .family(display_family()),
                );
                // Only a relay-confirmed row shows its elapsed time: the stall tier runs on a
                // different clock (sustained-stall duration), and showing it would make the
                // counter visibly reset to zero when the row upgrades to confirmed. The confirmed
                // clock is also what the Drop button's unlock countdown runs against, so the one
                // timer the player sees is coherent with the button. A plain label keeps the
                // column width constant (min_col_width covers any realistic count) without
                // disturbing the row's text baseline the way a fixed-rect widget would.
                let elapsed_text = if row.tier == DisconnectTier::Confirmed {
                    format!("{}s", row.seconds)
                } else {
                    String::new()
                };
                ui.label(
                    RichText::new(elapsed_text)
                        .size(ROW_SIZE)
                        .color(SECONDARY)
                        .family(display_family()),
                );
                draw_action_cell(ui, row, clicked);
                ui.end_row();
            }
        });
    // Centre the header over the panel content (the wider of the reserved header slot and the
    // grid) and paint it into the space reserved above. The galley already carries its colour.
    let content = header_slot.union(grid.response.rect);
    let header_pos = pos2(
        content.center().x - 0.5 * header_galley.size().x,
        header_slot.top(),
    );
    ui.painter()
        .galley(header_pos, header_galley, Color32::PLACEHOLDER);
}

/// A row's action-column cell: the manual Drop button for a [`Confirmed`](DisconnectTier::Confirmed)
/// row (with its drop-requested acknowledgement alongside it, if a click just happened), or nothing
/// for a [`Stall`](DisconnectTier::Stall) row — there is no relay-confirmed death yet to drop.
fn draw_action_cell(ui: &mut egui::Ui, row: &DisconnectRowView, clicked: &mut Vec<u8>) {
    if row.tier != DisconnectTier::Confirmed {
        // Reserve the Drop button's exact footprint (same centered layout, same size) so a row
        // upgrading to the confirmed tier doesn't grow the row height or widen the panel when the
        // real button appears.
        ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
            ui.add_sized(DROP_BUTTON_SIZE, egui::Label::new(""));
        });
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
fn draw_drop_button(ui: &mut egui::Ui, row: &DisconnectRowView, clicked: &mut Vec<u8>) {
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
    .corner_radius(CornerRadius::same(6));
    // `add_sized` rather than the button's own `min_size`: a min size still lets the widest label
    // ("Drop (45s)") grow the button past a shorter one ("Drop"), which is exactly the frame-to-frame
    // resize this is meant to prevent. Sizing the button explicitly keeps its footprint identical
    // across every label the countdown produces.
    let response = ui
        .add_enabled_ui(enabled, |ui| ui.add_sized(DROP_BUTTON_SIZE, button))
        .inner;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders `view` for one pass against `ctx` and returns the panel's on-screen width in points.
    fn render_width(ctx: &egui::Context, view: &DisconnectView) -> f32 {
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                pos2(0.0, 0.0),
                vec2(1280.0, 720.0),
            )),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let width = render_disconnect_view(view, ctx).response.rect.width();
        let out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        width
    }

    fn fresh_ctx() -> egui::Context {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx);
        ctx.set_pixels_per_point(1.5);
        ctx
    }

    fn confirmed_row(name: &str, drop_requested: bool) -> DisconnectRowView {
        DisconnectRowView {
            slot: 0,
            name: name.to_string(),
            seconds: 16,
            tier: DisconnectTier::Confirmed,
            drop_unlocked: false,
            drop_requested,
        }
    }

    fn peers(rows: Vec<DisconnectRowView>) -> DisconnectView {
        DisconnectView {
            rows,
            self_state: SelfState::Healthy,
        }
    }

    /// Drives several passes and returns the panel width from the last one, so callers can compare a
    /// settled width after some sequence of views. egui needs a couple of passes to settle grid
    /// column state, so each step is rendered a few times.
    fn settle_width(ctx: &egui::Context, views: &[DisconnectView]) -> f32 {
        let mut width = 0.0;
        for view in views {
            for _ in 0..4 {
                width = render_width(ctx, view);
            }
        }
        width
    }

    /// The panel must shrink back after a transient widening. A `drop_requested` acknowledgement
    /// widens the action column while it shows; once it clears, the panel has to hug its content
    /// again rather than stranding dead space to the right of the Drop button. This regressed under
    /// egui 0.35 when the panel was wrapped in a centring layout, whose `min_rect` grabbed the full
    /// available width of the auto-sized `Area` and pinned the width permanently.
    #[test]
    fn panel_width_recovers_after_drop_requested_clears() {
        let baseline = {
            let ctx = fresh_ctx();
            settle_width(&ctx, &[peers(vec![confirmed_row("Rhynso", false)])])
        };

        let ctx = fresh_ctx();
        // Widen it transiently with the acknowledgement, then clear it.
        settle_width(&ctx, &[peers(vec![confirmed_row("Rhynso", true)])]);
        let recovered = settle_width(&ctx, &[peers(vec![confirmed_row("Rhynso", false)])]);

        assert!(
            (recovered - baseline).abs() < 1.0,
            "panel stayed wide after the drop-requested label cleared: baseline={baseline}, \
             recovered={recovered}",
        );
    }

    /// The same recovery must hold when a wide row leaves the roster — e.g. a long-named player who
    /// was disconnected reconnects and drops out of the panel. The remaining narrower rows should
    /// hug, not inherit the departed row's width.
    #[test]
    fn panel_width_recovers_after_wide_row_leaves() {
        let baseline = {
            let ctx = fresh_ctx();
            settle_width(&ctx, &[peers(vec![confirmed_row("ab", false)])])
        };

        let ctx = fresh_ctx();
        settle_width(
            &ctx,
            &[peers(vec![
                confirmed_row("ab", false),
                confirmed_row("aVeryLongPlayerNameIndeed", false),
            ])],
        );
        let recovered = settle_width(&ctx, &[peers(vec![confirmed_row("ab", false)])]);

        assert!(
            (recovered - baseline).abs() < 1.0,
            "panel stayed wide after the long-named row left: baseline={baseline}, \
             recovered={recovered}",
        );
    }
}
