//! The disconnect overlay's presentation layer: a plain-data view-model and the egui render fns that
//! draw it. Everything here is a pure fn of [`DisconnectView`] plus an [`egui::Context`], so the same
//! code renders in the injected game DLL and in the host preview.
//!
//! The sim is stopped while this is up, so it is drawn at the kit's modal tier: it dims the game
//! behind it and is the only thing on screen worth reading.

use std::time::Duration;

use egui::{Align, Id, InnerResponse, Layout, Sense, Ui, Vec2, vec2};

use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ButtonVariant};
use crate::kit::{theme, tiers};
use crate::{tr, tr_plural};

/// A relay-confirmed disconnect must last at least this long before the overlay offers its manual
/// drop; the Drop button's countdown label counts down toward it. Mirrors the turn-state constant of
/// the same name that computes each row's [`drop_unlocked`](DisconnectRowView::drop_unlocked) flag,
/// kept here so the presentation layer carries the one value its countdown label needs without
/// depending on the netcode crate.
pub const DROP_UNLOCK_UI: Duration = Duration::from_secs(45);

/// How wide the dialog is, in overlay points.
///
/// A modal that resizes itself as its rows change state is worse than one that is occasionally
/// wider than it needs to be: the countdown, the drop acknowledgement and a player leaving the
/// roster all change a row's contents while the player is reading it. Everything inside is laid out
/// against this width and elides rather than growing.
const DIALOG_WIDTH: f32 = 520.0;

/// How tall one player row is. The Drop button sets the floor, since a modal's controls get the
/// larger hit target.
const ROW_HEIGHT: f32 = theme::HIT_DIALOG;

/// Fraction of the space left over after the Drop button that a player's name may take.
const NAME_SHARE: f32 = 0.42;

/// Width reserved for a row's elapsed counter, which holds `mm:ss` in condensed numerals.
const ELAPSED_WIDTH: f32 = 56.0;

/// Size of the clock over the roster.
const CLOCK_SIZE: f32 = 32.0;

/// Width of the column the clock and its label sit in, wide enough for a translated label that runs
/// well past the English one.
const CLOCK_WIDTH: f32 = 132.0;

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

    /// The longest-running relay-confirmed wait, which is what the dialog's clock reads. `None`
    /// while every row is only stalled: that tier runs on a different clock (sustained stall rather
    /// than confirmed link death), and showing it would make the clock jump back to zero the moment
    /// a row upgrades.
    fn confirmed_elapsed(&self) -> Option<u64> {
        self.rows
            .iter()
            .filter(|row| row.tier == DisconnectTier::Confirmed)
            .map(|row| row.seconds)
            .max()
    }
}

/// Renders the disconnect view and returns the slots whose Drop button was clicked this frame.
pub fn render_disconnect_view(
    view: &DisconnectView,
    ctx: &egui::Context,
) -> InnerResponse<Vec<u8>> {
    let title = match view.self_state {
        SelfState::Reconnecting => tr!("disconnect.interruptedTitle", "Connection interrupted"),
        SelfState::Healthy => tr!("disconnect.waitingTitle", "Waiting for players"),
    };
    let dialog = tiers::tier2_dialog(
        ctx,
        Id::new("sb_disconnect_overlay"),
        &title,
        DIALOG_WIDTH,
        |ui| match view.self_state {
            SelfState::Reconnecting => {
                draw_self_notice(ui);
                Vec::new()
            }
            SelfState::Healthy => draw_peers(ui, view),
        },
    );
    InnerResponse::new(dialog.inner, dialog.response)
}

/// Draws this client's own connection notice: what is happening, and dots that keep breathing to
/// say the attempt is still running. Only ever shown for a relay-confirmed self-link loss (see
/// [`SelfState`]) — never on a mere guess from the remote roster's behavior.
fn draw_self_notice(ui: &mut Ui) {
    ui.label(body_spec().job_wrapped(
        &tr!(
            "disconnect.interruptedBody",
            "The connection to the server was lost. The game continues as soon as it is back."
        ),
        DIALOG_WIDTH,
    ));
    ui.add_space(theme::SPACE_LG);
    ui.horizontal(|ui| {
        widgets::pulsing_dots(ui);
        ui.add_space(theme::SPACE_MD);
        ui.label(
            text::body(15.5, BodyWeight::Medium)
                .with_color(theme::ACCENT)
                .job(&tr!("disconnect.reconnecting", "Reconnecting")),
        );
    });
}

/// Draws what the dialog says about other players: one line on why the game has stopped, the clock
/// the wait has been running for, and a row per player the sim is waiting on.
fn draw_peers(ui: &mut Ui, view: &DisconnectView) -> Vec<u8> {
    let body = tr_plural!(
        "disconnect.waitingBody",
        view.rows.len(),
        one = "The game is paused until this player reconnects.",
        other = "The game is paused until these players reconnect."
    );
    let clock = view.confirmed_elapsed();
    let clock_width = if clock.is_some() { CLOCK_WIDTH } else { 0.0 };
    let body_width = (DIALOG_WIDTH - clock_width - theme::SPACE_LG).max(120.0);
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing.x = theme::SPACE_LG;
        ui.allocate_ui_with_layout(vec2(body_width, 0.0), Layout::top_down(Align::LEFT), |ui| {
            ui.set_width(body_width);
            ui.label(body_spec().job_wrapped(&body, body_width));
        });
        if let Some(seconds) = clock {
            ui.allocate_ui_with_layout(
                vec2(clock_width, 0.0),
                Layout::top_down(Align::RIGHT),
                |ui| {
                    ui.set_width(clock_width);
                    ui.label(
                        text::column_label()
                            .job_truncated(&tr!("disconnect.elapsedLabel", "Elapsed"), clock_width),
                    );
                    ui.add_space(theme::SPACE_XS);
                    ui.label(text::numeral(CLOCK_SIZE).job(&mmss(seconds)));
                },
            );
        }
    });

    ui.add_space(theme::SPACE_LG);
    widgets::divider(ui);
    ui.add_space(theme::SPACE_SM);

    // Every row's Drop button is the same width, whichever label it is currently wearing, so a
    // countdown ticking down or a row unlocking never shifts the column beside it.
    let button_width = drop_button_width(ui);
    let mut clicked = Vec::new();
    for row in &view.rows {
        draw_row(ui, row, button_width, &mut clicked);
    }
    clicked
}

/// Draws one player's row: their name, what their connection is doing, how long it has been doing
/// it, and the manual drop.
fn draw_row(ui: &mut Ui, row: &DisconnectRowView, button_width: f32, clicked: &mut Vec<u8>) {
    ui.horizontal(|ui| {
        // Every width here is decided by the dialog rather than read back from the layout: this row
        // sits in an auto-sized area, so sizing a column from the space available would let a wide
        // row widen the area and the next pass hand that extra width straight back to the column.
        ui.spacing_mut().item_spacing.x = theme::SPACE_MD;
        ui.set_min_height(ROW_HEIGHT);
        let free = DIALOG_WIDTH - button_width - ELAPSED_WIDTH - theme::SPACE_MD * 3.0;
        let name_width = (free * NAME_SHARE).max(0.0);
        let state_width = (free - name_width).max(0.0);

        cell(
            ui,
            name_width,
            Align::LEFT,
            text::player_name(17.0),
            &row.name,
        );
        cell(
            ui,
            state_width,
            Align::LEFT,
            state_spec(row),
            &state_text(row),
        );
        let elapsed = match row.tier {
            DisconnectTier::Confirmed => mmss(row.seconds),
            DisconnectTier::Stall => String::new(),
        };
        cell(
            ui,
            ELAPSED_WIDTH,
            Align::RIGHT,
            text::numeral(17.0).with_color(theme::TEXT_DIM),
            &elapsed,
        );
        draw_drop_button(ui, row, button_width, clicked);
    });
}

/// One row cell: a slot of exactly `width` the text is elided into.
///
/// Every column's width here is decided by the dialog, not by its contents: a long name or a long
/// translation has to lose its tail, not push the Drop button off the edge.
fn cell(ui: &mut Ui, width: f32, align: Align, spec: TextSpec, text: &str) {
    widgets::text_cell(ui, &spec, text, vec2(width, ROW_HEIGHT), align);
}

/// Draws the Drop button for a [`Confirmed`](DisconnectTier::Confirmed) row: shown from the moment
/// the relay confirms the drop, labelled with a countdown and inert until [`DROP_UNLOCK_UI`], then
/// an amber, clickable one. A click while enabled pushes the row's slot into `clicked`; a disabled
/// button ignores clicks entirely, since no request can reach a relay that wouldn't yet honor it.
///
/// A stalled row gets the same footprint and nothing in it, so a row upgrading to confirmed doesn't
/// move the rows around it.
fn draw_drop_button(ui: &mut Ui, row: &DisconnectRowView, width: f32, clicked: &mut Vec<u8>) {
    if row.tier != DisconnectTier::Confirmed {
        ui.allocate_exact_size(Vec2::new(width, ROW_HEIGHT), Sense::hover());
        return;
    }
    let enabled = row.drop_unlocked;
    let label = if enabled {
        drop_label()
    } else {
        let remaining = DROP_UNLOCK_UI.as_secs().saturating_sub(row.seconds);
        drop_countdown_label(&mmss(remaining))
    };
    let variant = if enabled {
        ButtonVariant::Tier2Primary
    } else {
        ButtonVariant::Tier2
    };
    let response = ui
        .scope(|ui| {
            widgets::set_disabled(ui, !enabled);
            widgets::button_sized(ui, &label, variant, width)
        })
        .inner;
    if enabled && response.clicked() {
        clicked.push(row.slot);
    }
}

/// How wide every Drop button in the dialog is: enough for the longest label any of them can wear,
/// in whatever language the overlay is speaking.
fn drop_button_width(ui: &Ui) -> f32 {
    let spec = text::button_label(14.0);
    // The countdown's own digits never change the label's width (it counts down from under a
    // minute), so one sample of it stands for all of them.
    let longest = [
        drop_label(),
        drop_countdown_label(&mmss(DROP_UNLOCK_UI.as_secs())),
    ]
    .iter()
    .map(|label| spec.galley(ui, label).size().x)
    .fold(0.0f32, f32::max);
    longest + theme::SPACE_XL * 2.0
}

fn drop_label() -> String {
    tr!("disconnect.dropAction", "Drop")
}

fn drop_countdown_label(time: &str) -> String {
    tr!("disconnect.dropCountdown", "Drop in {{time}}", time = time)
}

/// What a row's middle column says about that player's connection.
fn state_text(row: &DisconnectRowView) -> String {
    if row.drop_requested {
        return tr!("disconnect.stateDropRequested", "Drop requested");
    }
    match row.tier {
        DisconnectTier::Confirmed => tr!("disconnect.stateReconnecting", "Reconnecting"),
        DisconnectTier::Stall => tr!("disconnect.stateNotResponding", "Not responding"),
    }
}

/// A row's state text is amber once the link is known to be down, and quiet while the sim is merely
/// waiting on turns that may still arrive.
fn state_spec(row: &DisconnectRowView) -> TextSpec {
    let color = match row.tier {
        DisconnectTier::Confirmed => theme::ACCENT,
        DisconnectTier::Stall => theme::TEXT_DIM,
    };
    text::body(14.5, BodyWeight::Medium).with_color(color)
}

fn body_spec() -> TextSpec {
    text::body(15.5, BodyWeight::Regular).with_color(theme::TEXT_DIM)
}

/// Whole seconds as a clock reads them.
fn mmss(seconds: u64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders `view` for one pass against `ctx` and returns the dialog's on-screen width in points.
    fn render_width(ctx: &egui::Context, view: &DisconnectView) -> f32 {
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::pos2(0.0, 0.0),
                vec2(1280.0, 720.0),
            )),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        let width = render_disconnect_view(view, ctx).response.rect.width();
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        // Layout checks have no GPU texture store to update.
        out.textures_delta.clear();
        width
    }

    fn fresh_ctx() -> egui::Context {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
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

    /// Drives several passes and returns the dialog width from the last one, so callers can compare
    /// a settled width after some sequence of views. egui needs a couple of passes to settle an
    /// auto-sized area, so each step is rendered a few times.
    fn settle_width(ctx: &egui::Context, views: &[DisconnectView]) -> f32 {
        let mut width = 0.0;
        for view in views {
            for _ in 0..4 {
                width = render_width(ctx, view);
            }
        }
        width
    }

    /// The dialog must not resize as its rows change state. A drop acknowledgement appearing, or a
    /// long-named player leaving the roster, changes what a row holds while the player is reading
    /// it; the chrome around it has to stay put.
    #[test]
    fn dialog_width_is_the_same_whatever_the_rows_hold() {
        let ctx = fresh_ctx();
        let baseline = settle_width(&ctx, &[peers(vec![confirmed_row("ab", false)])]);

        let acknowledged = settle_width(&ctx, &[peers(vec![confirmed_row("Rhynso", true)])]);
        let long_name = settle_width(
            &ctx,
            &[peers(vec![
                confirmed_row("ab", false),
                confirmed_row("aVeryLongPlayerNameIndeed", false),
            ])],
        );
        let recovered = settle_width(&ctx, &[peers(vec![confirmed_row("ab", false)])]);

        for (label, width) in [
            ("drop acknowledged", acknowledged),
            ("long name", long_name),
            ("back to the baseline roster", recovered),
        ] {
            assert!(
                (width - baseline).abs() < 1.0,
                "dialog width moved with {label}: baseline={baseline}, got={width}",
            );
        }
    }

    /// The clock reads the longest relay-confirmed wait, and reads nothing at all while every row is
    /// only stalled.
    #[test]
    fn the_clock_follows_the_confirmed_rows() {
        let mut rows = vec![confirmed_row("a", false), confirmed_row("b", false)];
        rows[0].seconds = 9;
        rows[1].seconds = 74;
        assert_eq!(peers(rows).confirmed_elapsed(), Some(74));

        let mut stalled = confirmed_row("a", false);
        stalled.tier = DisconnectTier::Stall;
        assert_eq!(peers(vec![stalled]).confirmed_elapsed(), None);
    }

    #[test]
    fn clock_labels_pad_seconds() {
        assert_eq!(mmss(0), "0:00");
        assert_eq!(mmss(45), "0:45");
        assert_eq!(mmss(74), "1:14");
    }
}
