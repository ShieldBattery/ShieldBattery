//! The disconnect overlay's presentation layer: a plain-data view-model and the egui render fns that
//! draw it. Everything here is a pure fn of [`DisconnectView`] plus an [`egui::Context`], so the same
//! code renders in the injected game DLL and in the host preview.
//!
//! The sim is stopped while this is up, so it is drawn at the kit's modal tier: it dims the game
//! behind it and is the only thing on screen worth reading.
//!
//! It has two forms. While this client's own link is fine the dialog is about the other players: the
//! whole roster, one boxed row each, so the player can see at a glance who the game is waiting on and
//! who is simply there. When our own link is the one that is down there is nothing to say about
//! anyone else, and the dialog becomes a single notice with the one way out of it.

use std::time::Duration;

use egui::{
    Align, Color32, Id, InnerResponse, Layout, Rect, Sense, Shape, Stroke, StrokeKind, Ui,
    UiBuilder, Vec2, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ButtonPlate, HoldState};
use crate::kit::{theme, tiers};
use crate::{colors, tr, tr_plural};

/// A relay-confirmed disconnect must last at least this long before the overlay offers its manual
/// drop; the Drop button's countdown label counts down toward it. Mirrors the turn-state constant of
/// the same name that computes each row's [`drop_unlocked`](DisconnectRowView::drop_unlocked) flag,
/// kept here so the presentation layer carries the one value its countdown label needs without
/// depending on the netcode crate.
pub const DROP_UNLOCK_UI: Duration = Duration::from_secs(45);

/// How wide the roster dialog is, in overlay points. Everything inside is laid out against this and
/// elides rather than growing: the countdown, the drop acknowledgement and a player's state all
/// change a row's contents while the player is reading it, and a modal that resized itself as they
/// did would be worse than one that is occasionally wider than it needs to be.
const ROSTER_WIDTH: f32 = 620.0;

/// How wide the self-notice dialog is. Narrower than the roster, because it holds one thing.
const NOTICE_WIDTH: f32 = 520.0;

/// Gap between the title block and the clock beside it.
const HEADER_GAP: f32 = 14.0;

/// Gap between a title and its subtitle.
const TITLE_GAP: f32 = 3.0;

/// Width of the header's clock column, wide enough for a wait that has crossed an hour.
const HEADER_CLOCK_WIDTH: f32 = 96.0;

/// Size of the header's clock.
const HEADER_CLOCK_SIZE: f32 = 30.0;

/// Size of the clock on the self notice, which is the only number on that screen.
const NOTICE_CLOCK_SIZE: f32 = 52.0;

/// How wide the self notice lets its explanation run before wrapping. Narrower than the dialog: a
/// centred paragraph that reaches both margins reads as a block rather than as a sentence.
const NOTICE_TEXT_WIDTH: f32 = 400.0;

/// How tall one player row is.
const ROW_HEIGHT: f32 = 52.0;

/// The room between a row's edge and what it holds.
const ROW_PAD_X: f32 = 16.0;

/// The gap between two rows.
const ROW_SPACING: f32 = 10.0;

/// The gap between two things inside a row.
const ROW_GAP: f32 = 12.0;

/// Width of the bar carrying a player's own color, and how tall it stands.
const COLOR_BAR: Vec2 = Vec2::new(4.0, 17.0);

/// Width of the column a row's state text sits in, wide enough for a translated state with its
/// clock on the end.
const STATE_WIDTH: f32 = 150.0;

/// Size of a player's name in a row.
const NAME_SIZE: f32 = 17.0;

/// The most room a row's teammate label may take before it elides.
const TEAMMATE_MAX: f32 = 84.0;

/// How far the drop control sits from the state text, which is wider than the row's own gap: it is
/// the one thing in the row a click does something to.
const BUTTON_MARGIN: f32 = 24.0;

/// The footprint of a row's drop control, the same whichever of its states it is wearing.
const BUTTON_SIZE: Vec2 = Vec2::new(152.0, 38.0);

/// The footprint of the self notice's abandon control.
const ABANDON_SIZE: Vec2 = Vec2::new(300.0, 46.0);

/// What a player's connection is doing, which decides their row's edge, its dot and what it says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerState {
    /// The player is in the game and their turns are arriving. Their row is there so the roster is
    /// the whole roster: a list of only the players in trouble says nothing about how much of the
    /// game is waiting.
    Connected,
    /// The sim is blocked on this player's turn, but no link death has been relay-confirmed.
    /// Informational only, since the relay would not honor a drop it has not observed.
    Stalled,
    /// The relay confirmed this player's link is down. The drop-unlock clock runs from the
    /// confirmation, and the manual drop becomes clickable once it passes [`DROP_UNLOCK_UI`].
    Reconnecting,
}

impl PeerState {
    /// Whether the game is waiting on this player, which is what puts a drop control in their row
    /// and an amber edge around it.
    fn is_waiting(self) -> bool {
        !matches!(self, PeerState::Connected)
    }
}

/// This client's own connection state, deciding whether the overlay shows the prominent self-notice
/// or the roster. The presentation-side mirror of the turn-state enum of the same name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfState {
    /// Our link is fine; any rows are about peers.
    Healthy,
    /// The relay confirmed our own link is down (or the session ended); show the prominent self
    /// notice.
    Reconnecting,
}

/// One display-ready roster row: a player of this game with whatever the turn state knows about
/// their link. Holds no BW or turn-state types, so the render path below depends only on this and
/// egui.
pub struct DisconnectRowView {
    /// The slot a drop click targets, as the raw rally-point2 slot id. Round-tripped back to the
    /// caller through [`render_disconnect_view`]'s clicked list.
    pub slot: u8,
    /// The player's display name.
    pub name: String,
    /// The color this player is playing as, which is how a name in a list is matched to the units
    /// on the map.
    pub color: Color32,
    /// Whether this player is on the local player's side, which is what makes waiting for them
    /// mean something different from waiting for an opponent.
    pub teammate: bool,
    /// How long the condition has run, in whole seconds. Zero for a connected player.
    pub seconds: u64,
    /// What the player's link is doing.
    pub state: PeerState,
    /// Whether the manual drop button is enabled: shown from the moment the row is
    /// [`Reconnecting`](PeerState::Reconnecting), outlined and inert with a countdown label until
    /// this flips, then clickable.
    pub drop_unlocked: bool,
    /// Whether to briefly acknowledge a just-made drop request.
    pub drop_requested: bool,
}

/// Everything the disconnect overlay needs to draw itself, resolved from the turn state and game
/// setup. The render path takes only this (plus an egui context), so it renders identically in the
/// game DLL and the host preview.
pub struct DisconnectView {
    /// Every player of this game other than the local one, in roster order.
    pub rows: Vec<DisconnectRowView>,
    pub self_state: SelfState,
    /// How long this client's own link has been down, in whole seconds. Only read while
    /// [`self_state`](Self::self_state) is [`Reconnecting`](SelfState::Reconnecting).
    pub self_seconds: u64,
}

impl DisconnectView {
    /// Whether anything is worth drawing at all. A roster where every player is connected is the
    /// normal state of a game, not a surface.
    pub fn is_empty(&self) -> bool {
        self.self_state == SelfState::Healthy && !self.rows.iter().any(|row| row.state.is_waiting())
    }

    /// Whether any row shows a Drop button (enabled or still counting down) — the only thing that
    /// makes the overlay interactable. Keyed on the state rather than `drop_unlocked`: the button
    /// itself is present (just inert) before the unlock threshold, so the overlay's input rect
    /// must be registered from the moment a row goes confirmed, not only once the button is
    /// clickable.
    pub fn has_button(&self) -> bool {
        self.rows
            .iter()
            .any(|row| row.state == PeerState::Reconnecting)
    }

    /// The longest-running relay-confirmed wait, which is what the dialog's clock reads. `None`
    /// while every row is only stalled: that state runs on a different clock (sustained stall rather
    /// than confirmed link death), and showing it would make the clock jump back to zero the moment
    /// a row upgrades.
    fn confirmed_elapsed(&self) -> Option<u64> {
        self.rows
            .iter()
            .filter(|row| row.state == PeerState::Reconnecting)
            .map(|row| row.seconds)
            .max()
    }

    /// How many players the game is waiting on, which is what the roster's subtitle is about.
    fn waiting_count(&self) -> usize {
        self.rows
            .iter()
            .filter(|row| row.state.is_waiting())
            .count()
    }
}

/// What the player asked the disconnect overlay for this frame.
#[derive(Default)]
pub struct DisconnectOutcome {
    /// The slots whose Drop button was clicked.
    pub drop_requests: Vec<u8>,
    /// Whether the abandon hold on the self notice completed.
    pub abandoned: bool,
}

/// Renders the disconnect view and reports what the player did with it.
pub fn render_disconnect_view(
    view: &DisconnectView,
    ctx: &egui::Context,
) -> InnerResponse<DisconnectOutcome> {
    let width = match view.self_state {
        SelfState::Reconnecting => NOTICE_WIDTH,
        SelfState::Healthy => ROSTER_WIDTH,
    };
    let dialog = tiers::tier2_dialog(
        ctx,
        Id::new("sb_disconnect_overlay"),
        width,
        |ui| match view.self_state {
            SelfState::Reconnecting => draw_self_notice(ui, view),
            SelfState::Healthy => draw_roster(ui, view),
        },
    );
    InnerResponse::new(dialog.inner, dialog.response)
}

/// Draws this client's own connection notice: that the attempt is still running, how long it has
/// been, and the one thing the player can do about it. Only ever shown for a relay-confirmed
/// self-link loss (see [`SelfState`]) — never on a mere guess from the remote roster's behavior.
fn draw_self_notice(ui: &mut Ui, view: &DisconnectView) -> DisconnectOutcome {
    tiers::dialog_header(ui, |ui| {
        draw_title_block(
            ui,
            &tr!("disconnect.interruptedTitle", "Connection interrupted"),
            &tr!(
                "disconnect.interruptedSubtitle",
                "Your connection to the ShieldBattery server was lost."
            ),
            None,
        );
    });
    tiers::dialog_body(ui, |ui| {
        ui.vertical_centered(|ui| {
            draw_reconnecting_label(ui);
            ui.add_space(theme::SPACE_SM);
            ui.label(text::numeral(NOTICE_CLOCK_SIZE).job(&mmss(view.self_seconds)));
            ui.add_space(theme::SPACE_SM);
            widgets::centered_paragraph(
                ui,
                &body_spec(),
                &tr!(
                    "disconnect.interruptedBody",
                    "We'll keep trying. The game is paused, and your opponents see you as \
                     reconnecting, so nothing is lost yet."
                ),
                NOTICE_TEXT_WIDTH,
            );
        });
    });
    let abandoned = tiers::dialog_footer(ui, |ui| {
        // The footer's own top padding carries most of the distance from the paragraph above; the
        // rest is what keeps a destructive control from sitting against the words explaining it.
        ui.add_space(theme::SPACE_SM + 2.0);
        let abandoned = ui
            .vertical_centered(|ui| {
                widgets::hold_to_confirm(
                    ui,
                    &tr!("disconnect.abandonAction", "Hold to abandon"),
                    ABANDON_SIZE,
                ) == HoldState::Confirmed
            })
            .inner;
        ui.add_space(theme::SPACE_SM);
        let width = ui.available_width();
        widgets::centered_paragraph(
            ui,
            &footnote_spec(),
            &tr!(
                "disconnect.abandonNote",
                "Hold for {{seconds}} seconds. Releasing early cancels. Abandoning usually counts \
                 as a loss, unless your team wins without you.",
                seconds = theme::MOTION_HOLD_SECS.round() as u64
            ),
            width,
        );
        abandoned
    });
    DisconnectOutcome {
        drop_requests: Vec::new(),
        abandoned,
    }
}

/// Draws what the dialog says about the other players: why the game has stopped, how long it has
/// been stopped for, a row per player, and the rules the drop control plays by.
fn draw_roster(ui: &mut Ui, view: &DisconnectView) -> DisconnectOutcome {
    tiers::dialog_header(ui, |ui| {
        let subtitle = tr_plural!(
            "disconnect.waitingBody",
            view.waiting_count(),
            one = "The game is paused until this player reconnects.",
            other = "The game is paused until these players reconnect."
        );
        draw_title_block(
            ui,
            &tr!("disconnect.waitingTitle", "Waiting for players"),
            &subtitle,
            view.confirmed_elapsed().map(mmss).as_deref(),
        );
    });
    let drop_requests = tiers::dialog_body(ui, |ui| {
        let mut clicked = Vec::new();
        for (index, row) in view.rows.iter().enumerate() {
            if index > 0 {
                ui.add_space(ROW_SPACING);
            }
            draw_row(ui, row, &mut clicked);
        }
        clicked
    });
    tiers::dialog_footer(ui, |ui| {
        let width = ui.available_width();
        for line in [
            tr!(
                "disconnect.dropRule",
                "Drop unlocks {{seconds}} seconds after a player disconnects, per player. Dropped \
                 players lose the game.",
                seconds = DROP_UNLOCK_UI.as_secs()
            ),
            tr!(
                "disconnect.waitingCost",
                "You can wait as long as you like. Waiting costs you nothing but time."
            ),
        ] {
            ui.label(footnote_spec().job_wrapped(&line, width));
            ui.add_space(TITLE_GAP);
        }
    });
    DisconnectOutcome {
        drop_requests,
        abandoned: false,
    }
}

/// The line that says the attempt is still running: a breathing dot and the word, centred together
/// rather than each on its own, so the pair reads as one label.
fn draw_reconnecting_label(ui: &mut Ui) {
    let spec = text::body(12.0, BodyWeight::Medium)
        .with_color(theme::TEXT_WARNING)
        .with_letter_spacing(1.2);
    let label = text::caps(&tr!("disconnect.reconnecting", "Reconnecting"));
    let galley = spec.galley(ui, &label);
    let gap = theme::SPACE_SM + 2.0;
    let size = vec2(
        DOT_DIAMETER + gap + galley.size().x,
        galley.size().y.max(DOT_DIAMETER),
    );
    ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Center), |ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        widgets::status_dot(ui, theme::ACCENT, true);
        ui.add_space(gap);
        ui.painter().galley(
            pos2(
                ui.cursor().left(),
                ui.max_rect().center().y - galley.size().y * 0.5,
            ),
            galley,
            spec.color,
        );
    });
}

/// A dialog header's contents: the title with its subtitle under it, and optionally a clock at the
/// far end, centred against the two of them.
fn draw_title_block(ui: &mut Ui, title: &str, subtitle: &str, clock: Option<&str>) {
    let content_width = ui.available_width();
    let clock_column = if clock.is_some() {
        HEADER_CLOCK_WIDTH + HEADER_GAP
    } else {
        0.0
    };
    let text_width = (content_width - clock_column).max(0.0);
    let subtitle_spec = text::body(14.0, BodyWeight::Regular).with_color(theme::TEXT_SECONDARY);
    let subtitle_galley = ui
        .ctx()
        .fonts_mut(|fonts| fonts.layout_job(subtitle_spec.job_wrapped(subtitle, text_width)));
    let height = text::dialog_title().row_height(ui) + TITLE_GAP + subtitle_galley.size().y;
    let (rect, _) = ui.allocate_exact_size(vec2(content_width, height), Sense::hover());
    let text_rect = Rect::from_min_size(rect.min, vec2(text_width, height));
    ui.scope_builder(UiBuilder::new().max_rect(text_rect), |ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        tiers::dialog_title(ui, title);
        ui.add_space(TITLE_GAP);
        ui.label(subtitle_galley);
    });
    if let Some(clock) = clock {
        let galley = text::numeral(HEADER_CLOCK_SIZE).galley(ui, clock);
        ui.painter().galley(
            pos2(
                rect.right() - galley.size().x,
                rect.center().y - galley.size().y * 0.5,
            ),
            galley,
            theme::TEXT_PRIMARY,
        );
    }
}

/// Draws one player's row: who they are, what their connection is doing, and — for a player the
/// game is waiting on — the manual drop.
fn draw_row(ui: &mut Ui, row: &DisconnectRowView, clicked: &mut Vec<u8>) {
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(width, ROW_HEIGHT), Sense::hover());
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    let border = if row.state.is_waiting() {
        theme::alpha(colors::AMBER60, 0.40)
    } else {
        theme::alpha(colors::BLUE70, 0.35)
    };
    ui.painter()
        .rect_filled(rect, corner_radius, theme::TIER2_ROW_FILL);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, border),
        StrokeKind::Inside,
    ));

    // Every width here is decided by the dialog rather than read back from the layout: a long name
    // or a long translation has to lose its tail, not push the drop control off the edge.
    let teammate_label = tr!("disconnect.teammateTag", "teammate");
    let teammate_spec = text::body(13.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL);
    let teammate_width = if row.teammate {
        teammate_spec
            .galley(ui, &teammate_label)
            .size()
            .x
            .min(TEAMMATE_MAX)
    } else {
        0.0
    };
    let teammate_column = if row.teammate {
        teammate_width + ROW_GAP
    } else {
        0.0
    };
    // Only a player the game has given up waiting on has a drop control, so only their row keeps
    // room for one: a stalled row that held the room empty would have its state text standing a
    // button's width in from the edge every other row's sits against.
    let has_drop = row.state == PeerState::Reconnecting;
    let button_column = if has_drop {
        BUTTON_MARGIN + BUTTON_SIZE.x
    } else {
        0.0
    };
    // Three gaps are always spent: after the dot, after the color bar, and before the state
    // column. Everything left over after them and the fixed columns is the name's, and whatever
    // the name does not use is slack between it and the state, so a short name and its teammate
    // label stay together instead of drifting apart across the row.
    let fixed = DOT_DIAMETER + COLOR_BAR.x + ROW_GAP * 3.0 + STATE_WIDTH + button_column;
    let middle = (width - ROW_PAD_X * 2.0 - fixed).max(0.0);
    let name_width = text::player_name(NAME_SIZE)
        .galley(ui, &row.name)
        .size()
        .x
        .min((middle - teammate_column).max(0.0));
    let slack = (middle - teammate_column - name_width).max(0.0);

    let inner = Rect::from_min_max(
        pos2(rect.left() + ROW_PAD_X, rect.top()),
        pos2(rect.right() - ROW_PAD_X, rect.bottom()),
    );
    ui.scope_builder(
        UiBuilder::new()
            .max_rect(inner)
            .layout(Layout::left_to_right(Align::Center)),
        |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            widgets::status_dot(ui, dot_color(row.state), row.state.is_waiting());
            ui.add_space(ROW_GAP);
            color_bar(ui, row.color);
            ui.add_space(ROW_GAP);
            cell(
                ui,
                name_width,
                Align::LEFT,
                text::player_name(NAME_SIZE),
                &row.name,
            );
            if row.teammate {
                ui.add_space(ROW_GAP);
                cell(
                    ui,
                    teammate_width,
                    Align::LEFT,
                    teammate_spec,
                    &teammate_label,
                );
            }
            ui.add_space(ROW_GAP + slack);
            cell(
                ui,
                STATE_WIDTH,
                Align::RIGHT,
                state_spec(row),
                &state_text(row),
            );
            if has_drop {
                ui.add_space(BUTTON_MARGIN);
                draw_drop_button(ui, row, clicked);
            }
        },
    );
}

/// One row cell: a slot of exactly `width` the text is elided into.
fn cell(ui: &mut Ui, width: f32, align: Align, spec: TextSpec, text: &str) {
    widgets::text_cell(ui, &spec, text, vec2(width, ROW_HEIGHT), align);
}

/// The bar carrying a player's own color, which is what ties a name in this list to the units on
/// the map.
fn color_bar(ui: &mut Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(vec2(COLOR_BAR.x, ROW_HEIGHT), Sense::hover());
    let bar = Rect::from_center_size(rect.center(), COLOR_BAR);
    ui.painter().rect_filled(bar, theme::radius(1), color);
}

/// Draws the drop control for a row whose player is known to be gone: an outlined countdown while
/// the relay would refuse the request, then a lit, clickable one. A [`Stalled`](PeerState::Stalled)
/// row has no control and no room kept for one; when its link is confirmed down the control
/// arrives with the change of state, which is a change the row is showing anyway.
fn draw_drop_button(ui: &mut Ui, row: &DisconnectRowView, clicked: &mut Vec<u8>) {
    let spec = text::button_label(12.5).with_letter_spacing(1.4);
    if !row.drop_unlocked {
        let remaining = DROP_UNLOCK_UI.as_secs().saturating_sub(row.seconds);
        let label = tr!(
            "disconnect.dropCountdown",
            "Drop in {{time}}",
            time = mmss(remaining)
        );
        widgets::plate_button(ui, &spec, &label, BUTTON_SIZE, ButtonPlate::locked());
        return;
    }
    let response = widgets::plate_button(
        ui,
        &spec,
        &tr!("disconnect.dropAction", "Drop"),
        BUTTON_SIZE,
        ButtonPlate::destructive_lit(),
    );
    if response.clicked() {
        clicked.push(row.slot);
    }
}

/// What a row's state column says about that player's connection.
fn state_text(row: &DisconnectRowView) -> String {
    if row.drop_requested {
        return tr!("disconnect.stateDropRequested", "drop requested");
    }
    match row.state {
        PeerState::Connected => tr!("disconnect.stateConnected", "connected"),
        PeerState::Stalled => tr!("disconnect.stateNotResponding", "not responding"),
        PeerState::Reconnecting => tr!(
            "disconnect.stateReconnectingFor",
            "reconnecting… {{time}}",
            time = mmss(row.seconds)
        ),
    }
}

/// A row's state text is amber once the link is known to be down, and quiet while the player is
/// simply playing or the sim is merely waiting on turns that may still arrive.
fn state_spec(row: &DisconnectRowView) -> TextSpec {
    let color = match row.state {
        PeerState::Connected => theme::TEXT_SECONDARY,
        PeerState::Stalled => theme::TEXT_DIM,
        PeerState::Reconnecting => theme::TEXT_WARNING,
    };
    text::body(13.5, BodyWeight::Regular).with_color(color)
}

/// The dot at the head of a row: steady green while the player is in the game, breathing amber
/// while the game is waiting on them.
fn dot_color(state: PeerState) -> Color32 {
    match state {
        PeerState::Connected => theme::TEXT_POSITIVE,
        PeerState::Stalled | PeerState::Reconnecting => theme::ACCENT,
    }
}

/// How wide a status dot's column is, which the row's own arithmetic has to agree with.
const DOT_DIAMETER: f32 = widgets::STATUS_DOT_DIAMETER;

fn body_spec() -> TextSpec {
    text::body(13.5, BodyWeight::Regular).with_color(theme::TEXT_SECONDARY)
}

/// The type the rules and asides under a dialog's contents are set in.
fn footnote_spec() -> TextSpec {
    text::body(12.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL)
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

    fn row(name: &str, state: PeerState, drop_requested: bool) -> DisconnectRowView {
        DisconnectRowView {
            slot: 0,
            name: name.to_string(),
            color: theme::player_color(0),
            teammate: false,
            seconds: 16,
            state,
            drop_unlocked: false,
            drop_requested,
        }
    }

    fn confirmed_row(name: &str, drop_requested: bool) -> DisconnectRowView {
        row(name, PeerState::Reconnecting, drop_requested)
    }

    fn peers(rows: Vec<DisconnectRowView>) -> DisconnectView {
        DisconnectView {
            rows,
            self_state: SelfState::Healthy,
            self_seconds: 0,
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
    /// long-named player joining the roster, changes what a row holds while the player is reading
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
        let mixed = settle_width(
            &ctx,
            &[peers(vec![
                row("aVeryLongPlayerNameIndeed", PeerState::Connected, false),
                confirmed_row("ab", false),
            ])],
        );
        let recovered = settle_width(&ctx, &[peers(vec![confirmed_row("ab", false)])]);

        for (label, width) in [
            ("drop acknowledged", acknowledged),
            ("long name", long_name),
            ("a connected row beside a waiting one", mixed),
            ("back to the baseline roster", recovered),
        ] {
            assert!(
                (width - baseline).abs() < 1.0,
                "dialog width moved with {label}: baseline={baseline}, got={width}",
            );
        }
    }

    /// A roster of players who are all where they should be is not a surface.
    #[test]
    fn an_all_connected_roster_draws_nothing() {
        assert!(
            peers(vec![
                row("a", PeerState::Connected, false),
                row("b", PeerState::Connected, false),
            ])
            .is_empty()
        );
        assert!(
            !peers(vec![
                row("a", PeerState::Connected, false),
                row("b", PeerState::Stalled, false),
            ])
            .is_empty()
        );
        assert!(
            !DisconnectView {
                rows: Vec::new(),
                self_state: SelfState::Reconnecting,
                self_seconds: 3,
            }
            .is_empty()
        );
    }

    /// The clock reads the longest relay-confirmed wait, and reads nothing at all while every row is
    /// only stalled or connected.
    #[test]
    fn the_clock_follows_the_confirmed_rows() {
        let mut rows = vec![confirmed_row("a", false), confirmed_row("b", false)];
        rows[0].seconds = 9;
        rows[1].seconds = 74;
        assert_eq!(peers(rows).confirmed_elapsed(), Some(74));

        assert_eq!(
            peers(vec![
                row("a", PeerState::Stalled, false),
                row("b", PeerState::Connected, false),
            ])
            .confirmed_elapsed(),
            None
        );
    }

    /// The subtitle counts the players the game is waiting on, not the roster it draws them in.
    #[test]
    fn the_waiting_count_ignores_connected_players() {
        let view = peers(vec![
            row("a", PeerState::Connected, false),
            row("b", PeerState::Connected, false),
            confirmed_row("c", false),
        ]);
        assert_eq!(view.waiting_count(), 1);
    }

    #[test]
    fn clock_labels_pad_seconds() {
        assert_eq!(mmss(0), "0:00");
        assert_eq!(mmss(45), "0:45");
        assert_eq!(mmss(74), "1:14");
    }
}
