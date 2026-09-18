//! The network-stats overlay's presentation layer: a plain-data view-model and the egui render fns
//! that draw it. Like [`crate::disconnect`], everything here is a pure fn of [`NetStatsView`] plus an
//! [`egui::Context`], so the same code renders in the injected game DLL and in the host preview. The
//! DLL builds the view-model from live turn-state instrumentation; the preview builds it from
//! adjustable knobs.
//!
//! This is a diagnostic surface shown during live play (toggled by the `/netstat` chat command), so
//! it is drawn at the kit's ambient tier: quiet over gameplay, anchored top-right where it can't
//! collide with the top-center disconnect overlay. It serves two readers at once: a player triaging
//! lag live (calm when healthy, amber when not), and an operator reading a screenshot in a bug
//! report hours later (the identity header and event ticker carry the ids and recent history an
//! incident lookup needs).

use egui::{Align, Align2, Color32, Id, Layout, Ui, vec2};

use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, TagStyle};
use crate::kit::{theme, tiers};
use crate::{tr, tr_plural};

/// How wide the panel is, in overlay points. Everything inside is laid out against it, so no value
/// or translation can make the panel breathe as its numbers change.
const PANEL_WIDTH: f32 = 484.0;

/// Text size for the per-slot table.
const ROW_SIZE: f32 = 13.0;

/// Height of one table row.
const ROW_HEIGHT: f32 = 18.0;

/// Gap between table columns.
const COLUMN_GAP: f32 = theme::SPACE_XS;

/// Width of the player-name column.
const NAME_WIDTH: f32 = 96.0;

/// Width of the column holding each slot's home relay, or its departure tag once it has left.
const HOME_WIDTH: f32 = 72.0;

/// How many numeric columns the table carries, which is what the remaining width is split between.
const NUMERIC_COLUMNS: usize = 6;

/// Height of each history sparkline.
const STRIP_HEIGHT: f32 = 30.0;

/// Calm/placeholder cutoff for the `age` column. A healthy peer's most-recent-turn age churns every
/// frame (~0-40ms), which is unreadable flicker and never actionable, so below this the column shows
/// a steady placeholder instead of the live number. Well under the [`stale_color`] warning threshold
/// (~500ms), so a genuinely late arrival still surfaces its actual milliseconds.
const AGE_CALM_THRESHOLD_MS: u64 = 200;

/// Milliseconds past which an inter-arrival gap or a stale turn is worth the player's attention.
const NOTABLE_MS: u64 = 500;

/// The arrival-gap strip scales its plot against at least this many milliseconds, so a healthy
/// game's tiny inter-arrival jitter reads as a calm line near the floor rather than being amplified
/// to full height. Only a genuine gap taller than this lifts the trace.
const GAP_STRIP_FLOOR_MS: u64 = 800;

/// How a departed slot left the session, for the row's departure tag. A drop is the anomalous
/// case, so it renders amber where a deliberate leave stays muted.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RowDeparture {
    /// A deliberate exit (quit, surrender); tagged `left`.
    Left,
    /// An unclean drop (the peer stopped responding); tagged `drop`.
    Dropped,
}

/// One remote slot's row in the network-stats table: a player name and home relay, with its
/// turn-arrival and sim-stall attribution numbers. Holds no BW or turn-state types.
pub struct NetStatRowView {
    /// The player's display name.
    pub name: String,
    /// This slot's home relay at session create, pre-formatted as `r<id>` or `r<id> <region>`, or
    /// `None` when the setup carried none (rendered as an em dash). Peers' later re-homes are not
    /// observable client-side, so this is always the create-time home — only the header's own relay
    /// tracks re-homes live. The region part fills in mid-game: peers' regions are withheld until
    /// the relay releases the session's label map (they place players geographically, and the
    /// pre-game handoff must not carry them).
    pub home: Option<String>,
    /// Milliseconds since this slot's most recent turn arrived, or `None` if none has yet.
    pub last_turn_age_ms: Option<u64>,
    /// The slot's EWMA inter-arrival interval in milliseconds, or `None` before two turns have
    /// arrived.
    pub ewma_interval_ms: Option<u64>,
    /// The largest inter-arrival gap seen in the recent (~60 s) window, in milliseconds.
    pub max_gap_ms: u64,
    /// Milliseconds the sim spent blocked on this slot in the recent (~60 s) window.
    pub recent_stall_ms: u64,
    /// Milliseconds the sim spent blocked on this slot over the whole game so far.
    pub lifetime_stall_ms: u64,
    /// How many distinct stall episodes this slot has caused.
    pub episode_count: u32,
    /// How this player departed the session, or `None` while they are still in the game. A departed
    /// row renders inert — muted name, a `left`/`drop` tag in place of the home relay, and no
    /// warning colours, since its numbers can only go stale from here.
    pub departure: Option<RowDeparture>,
}

/// One line of the recent-events ticker: an in-game timestamp and a one-line description of what
/// happened. Rendered as `mm:ss  <text>`.
pub struct NetEventView {
    /// Seconds since game start, formatted to `mm:ss` at render.
    pub elapsed_secs: u64,
    /// The event description (e.g. `buffer 2 → 3 turns`, `link back (2.1s)`, `re-homed relay 2 → 1`).
    pub text: String,
}

/// Everything the network-stats overlay needs to draw itself, resolved from the turn state's
/// instrumentation and game setup. The render path takes only this (plus an egui context), so it
/// renders identically in the game DLL and the host preview.
pub struct NetStatsView {
    /// The rally-point2 session id — the key an incident lookup enters into the admin game page and
    /// the flight recorder blobs.
    pub session_id: u64,
    /// This client's current home relay id, live truth: it advances when the session re-homes off a
    /// dead relay.
    pub relay_id: u64,
    /// The current relay's region label (e.g. `local-b`), or `None` when nothing has named one —
    /// the launch handoff's create-time label until the relay releases the session's authoritative
    /// map mid-game.
    pub region: Option<String>,
    /// The latency buffer depth (in turns) currently in force.
    pub buffer_turns: u32,
    /// How many times the buffer depth has changed since the game started.
    pub buffer_change_count: u32,
    /// Seconds since the most recent buffer-depth change, or `None` if it has never changed.
    pub buffer_last_change_secs: Option<u64>,
    /// Whether this client's own relay link is currently up.
    pub link_up: bool,
    /// How many times the own link has gone down since the game started.
    pub link_down_count: u32,
    /// Seconds since the most recent own-link transition, or `None` if it has never changed.
    pub link_last_change_secs: Option<u64>,
    /// Buffer depth sampled once per second, oldest first. Drawn as a sparkline; fewer than two
    /// samples draws a "gathering" placeholder.
    pub buffer_samples: Vec<u32>,
    /// The worst remote per-slot arrival gap (milliseconds) in each one-second window, oldest first.
    /// Shares the strips' x-axis with [`buffer_samples`](Self::buffer_samples).
    pub gap_samples_ms: Vec<u64>,
    /// The recent-events ticker, oldest first. Empty omits the section.
    pub events: Vec<NetEventView>,
    /// Microseconds of send-phase delay currently held on each outbound turn's
    /// wire handoff (the relay's phase-alignment directive at work). Zero when
    /// no directive has ever arrived, which hides the header line entirely.
    pub phase_applied_us: u32,
    /// Microseconds of send-phase delay the newest directive commanded — where
    /// the applied value is slewing to. Equal to the applied value at rest.
    pub phase_target_us: u32,
    /// One row per remote slot.
    pub rows: Vec<NetStatRowView>,
}

/// Renders the network-stats overlay as an ambient panel anchored top-right. Purely informational:
/// it never captures input (the caller registers no ui rect for it), so it doesn't interfere with
/// play while it's up.
pub fn render_netstat_view(view: &NetStatsView, ctx: &egui::Context) {
    egui::Area::new(Id::new("sb_netstat_overlay"))
        // Top-right, pushed down clear of SC:R's top-right resource counters (minerals/gas/supply),
        // which occupy roughly the top ~44px — so the panel reads as a distinct floating surface
        // below them rather than overlapping the HUD. Right margin keeps it off the screen edge.
        .anchor(Align2::RIGHT_TOP, vec2(-12.0, 54.0))
        .order(egui::Order::Foreground)
        .interactable(false)
        .show(ctx, |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(PANEL_WIDTH));
                widgets::panel_header(ui, &tr!("netstat.title", "Network stats"), None);
                draw_session(ui, view);
                ui.add_space(theme::SPACE_MD);
                draw_table(ui, &view.rows);
                ui.add_space(theme::SPACE_MD);
                draw_strips(ui, view);
                draw_events(ui, &view.events);
            });
        });
}

/// Draws what identifies and describes this session: the ids an incident lookup keys on, the buffer
/// depth in force, this client's own link, and the send-phase offset once one has ever been
/// directed.
fn draw_session(ui: &mut Ui, view: &NetStatsView) {
    widgets::stat_row(
        ui,
        &tr!("netstat.session", "Session"),
        &view.session_id.to_string(),
    );
    let relay = match &view.region {
        Some(region) => format!("{} · {region}", view.relay_id),
        None => view.relay_id.to_string(),
    };
    widgets::stat_row(ui, &tr!("netstat.relay", "Relay"), &relay);

    widgets::stat_row(
        ui,
        &tr!("netstat.buffer", "Buffer"),
        &tr_plural!(
            "netstat.bufferTurns",
            view.buffer_turns,
            one = "{{count}} turn",
            other = "{{count}} turns"
        ),
    );
    note(
        ui,
        &match view.buffer_last_change_secs {
            Some(secs) => tr_plural!(
                "netstat.bufferChanged",
                view.buffer_change_count,
                one = "Changed {{count}} time, last {{ago}} ago",
                other = "Changed {{count}} times, last {{ago}} ago",
                ago = mmss(secs)
            ),
            None => tr!("netstat.bufferSteady", "Steady since the start"),
        },
    );

    // Shown only once the relay has ever directed a send-phase shift: most sessions never get one
    // (phases already inside the relay's dead-band), and an all-zero line would just invite
    // questions.
    if view.phase_applied_us > 0 || view.phase_target_us > 0 {
        let applied_ms = view.phase_applied_us as f64 / 1000.0;
        let value = if view.phase_applied_us == view.phase_target_us {
            format!("+{applied_ms:.1} ms")
        } else {
            let target_ms = view.phase_target_us as f64 / 1000.0;
            format!("+{applied_ms:.1} → +{target_ms:.1} ms")
        };
        widgets::stat_row(ui, &tr!("netstat.sendPhase", "Send phase"), &value);
    }

    ui.horizontal(|ui| {
        ui.label(text::column_label().job(&tr!("netstat.link", "Link")));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let (label, style) = if view.link_up {
                (tr!("netstat.linkUp", "Up"), TagStyle::Neutral)
            } else {
                (tr!("netstat.linkDown", "Down"), TagStyle::Amber)
            };
            widgets::tag(ui, &label, style);
        });
    });
    note(
        ui,
        &match view.link_last_change_secs {
            Some(secs) => tr_plural!(
                "netstat.linkChanged",
                view.link_down_count,
                one = "Down {{count}} time, last change {{ago}} ago",
                other = "Down {{count}} times, last change {{ago}} ago",
                ago = mmss(secs)
            ),
            None => tr!("netstat.linkSteady", "No drops"),
        },
    );
}

/// A quiet line under a stat row, for the history behind the value above it.
fn note(ui: &mut Ui, text: &str) {
    ui.label(
        text::body(11.5, BodyWeight::Regular)
            .with_color(theme::TEXT_LABEL)
            .job_truncated(text, tiers::panel_content_width(PANEL_WIDTH)),
    );
}

/// The width each numeric column takes, once the name and home columns have had theirs.
fn numeric_width() -> f32 {
    let content = tiers::panel_content_width(PANEL_WIDTH);
    let gaps = COLUMN_GAP * (NUMERIC_COLUMNS + 1) as f32;
    ((content - NAME_WIDTH - HOME_WIDTH - gaps) / NUMERIC_COLUMNS as f32).max(0.0)
}

/// Draws the per-slot table: a row of column labels followed by one row per remote slot. Every
/// column has the width the panel gave it, so the numbers stay in their columns as they change.
fn draw_table(ui: &mut Ui, rows: &[NetStatRowView]) {
    let numeric = numeric_width();
    let headings = [
        tr!("netstat.columnAge", "Age"),
        tr!("netstat.columnInterval", "Intv"),
        tr!("netstat.columnGap", "Gap"),
        tr!("netstat.columnRecentStall", "St60"),
        tr!("netstat.columnLifetimeStall", "Life"),
        tr!("netstat.columnEpisodes", "Ep"),
    ];
    table_row(ui, |ui| {
        let label = text::column_label();
        cell(
            ui,
            &label,
            &tr!("netstat.columnPlayer", "Player"),
            NAME_WIDTH,
            Align::LEFT,
        );
        cell(
            ui,
            &label,
            &tr!("netstat.columnHome", "Home"),
            HOME_WIDTH,
            Align::LEFT,
        );
        for heading in &headings {
            cell(ui, &label, heading, numeric, Align::RIGHT);
        }
    });

    if rows.is_empty() {
        ui.add_space(theme::SPACE_XS);
        ui.label(
            text::body(ROW_SIZE, BodyWeight::Regular)
                .with_color(theme::TEXT_LABEL)
                .job(&tr!("netstat.noRemotePlayers", "No remote players")),
        );
        return;
    }

    for row in rows {
        let departed = row.departure.is_some();
        let quiet = |color: Color32| if departed { theme::TEXT_LABEL } else { color };
        table_row(ui, |ui| {
            let name_color = if departed {
                theme::TEXT_LABEL
            } else {
                theme::TEXT_PRIMARY
            };
            cell(
                ui,
                &text::body(ROW_SIZE, BodyWeight::Medium).with_color(name_color),
                &row.name,
                NAME_WIDTH,
                Align::LEFT,
            );
            match row.departure {
                // A departed player's home relay stops meaning anything, so the column says how
                // they left instead.
                Some(departure) => {
                    let (label, style) = match departure {
                        RowDeparture::Left => (tr!("netstat.left", "Left"), TagStyle::Muted),
                        RowDeparture::Dropped => (tr!("netstat.dropped", "Drop"), TagStyle::Amber),
                    };
                    ui.allocate_ui_with_layout(
                        vec2(HOME_WIDTH, ROW_HEIGHT),
                        Layout::left_to_right(Align::Center),
                        |ui| {
                            ui.set_min_size(vec2(HOME_WIDTH, ROW_HEIGHT));
                            widgets::tag(ui, &label, style);
                        },
                    );
                }
                None => cell(
                    ui,
                    &text::body(ROW_SIZE, BodyWeight::Regular).with_color(theme::TEXT_DIM),
                    row.home.as_deref().unwrap_or(EM_DASH),
                    HOME_WIDTH,
                    Align::LEFT,
                ),
            }
            let numerals = [
                (
                    fmt_age(row.last_turn_age_ms),
                    quiet(stale_color(row.last_turn_age_ms)),
                ),
                (opt_ms(row.ewma_interval_ms), theme::TEXT_DIM),
                (fmt_ms(row.max_gap_ms), quiet(notable_color(row.max_gap_ms))),
                (
                    fmt_ms(row.recent_stall_ms),
                    quiet(stall_color(row.recent_stall_ms)),
                ),
                (
                    fmt_ms(row.lifetime_stall_ms),
                    quiet(stall_color(row.lifetime_stall_ms)),
                ),
                (
                    row.episode_count.to_string(),
                    quiet(stall_color(row.episode_count as u64)),
                ),
            ];
            for (value, color) in &numerals {
                cell(
                    ui,
                    &text::numeral(ROW_SIZE).with_color(*color),
                    value,
                    numeric,
                    Align::RIGHT,
                );
            }
        });
    }
}

/// One row of the table, with the column gap as its only spacing.
fn table_row<R>(ui: &mut Ui, add: impl FnOnce(&mut Ui) -> R) -> R {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing = vec2(COLUMN_GAP, 0.0);
        ui.set_min_height(ROW_HEIGHT);
        add(ui)
    })
    .inner
}

fn cell(ui: &mut Ui, spec: &TextSpec, value: &str, width: f32, align: Align) {
    widgets::text_cell(ui, spec, value, vec2(width, ROW_HEIGHT), align);
}

/// Draws the time-sampled history: buffer depth and the worst per-slot arrival gap, both sampled at
/// 1 Hz so their shared x-axis is wall time. Each labels its current value beside its caption, so
/// the shape and the number never need cross-referencing.
fn draw_strips(ui: &mut Ui, view: &NetStatsView) {
    // Normalized across the samples' own range rather than plotted raw: the depths a game moves
    // between span a couple of turns out of a much larger scale, and drawn against zero every
    // directive change flattens into the same line.
    let floor = view.buffer_samples.iter().copied().min().unwrap_or(0);
    let span = view
        .buffer_samples
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .saturating_sub(floor);
    let buffer: Vec<f32> = view
        .buffer_samples
        .iter()
        // A buffer that has never changed has no range to spread over, and pinning it to the floor
        // would draw it as an absent line rather than a steady one, so it rides at mid height.
        .map(|&v| match span {
            0 => 0.5,
            span => (v - floor) as f32 / span as f32,
        })
        .collect();
    let last_buffer = view.buffer_samples.last();
    strip(
        ui,
        &tr!("netstat.bufferDepth", "Buffer depth"),
        &buffer,
        &last_buffer.map_or_else(|| EM_DASH.to_string(), u32::to_string),
        theme::TEXT_DIM,
        theme::TEXT_DIM,
    );

    ui.add_space(theme::SPACE_SM);

    // Plotted against a floor as well as the observed peak, so a healthy game's jitter reads as a
    // calm line near the bottom instead of being amplified to full height.
    let scale = view
        .gap_samples_ms
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .max(GAP_STRIP_FLOOR_MS) as f32;
    let gaps: Vec<f32> = view
        .gap_samples_ms
        .iter()
        .map(|&v| v as f32 / scale)
        .collect();
    let last_gap = view.gap_samples_ms.last().copied();
    strip(
        ui,
        &tr!("netstat.worstGap", "Worst gap"),
        &gaps,
        &last_gap.map_or_else(|| EM_DASH.to_string(), fmt_ms),
        last_gap.map_or(theme::TEXT_DIM, notable_color),
        theme::ACCENT,
    );
}

/// One captioned sparkline with its current value on the right of the caption. Fewer than two
/// samples says so rather than drawing a line through a single point.
fn strip(
    ui: &mut Ui,
    caption: &str,
    values: &[f32],
    value: &str,
    value_color: Color32,
    line_color: Color32,
) {
    ui.horizontal(|ui| {
        ui.label(text::column_label().job(caption));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(text::numeral(13.0).with_color(value_color).job(value));
        });
    });
    ui.add_space(theme::SPACE_XS);
    let width = tiers::panel_content_width(PANEL_WIDTH);
    if values.len() < 2 {
        let (rect, _) = ui.allocate_exact_size(vec2(width, STRIP_HEIGHT), egui::Sense::hover());
        let spec = text::body(ROW_SIZE, BodyWeight::Regular).with_color(theme::TEXT_LABEL);
        let galley = spec.galley(ui, &tr!("netstat.gathering", "Gathering samples"));
        ui.painter()
            .galley(rect.center() - galley.size() * 0.5, galley, spec.color);
        return;
    }
    // Already normalized to `[0, 1]` by the caller, which knows what each series' scale means;
    // letting the widget rescale to the samples' own peak would undo exactly that.
    widgets::sparkline_to(ui, values, 1.0, vec2(width, STRIP_HEIGHT), line_color);
}

/// Draws the recent-events ticker: `mm:ss  <text>` lines, oldest first. Omitted entirely when there
/// are no events, so a clean game shows nothing here.
fn draw_events(ui: &mut Ui, events: &[NetEventView]) {
    if events.is_empty() {
        return;
    }
    ui.add_space(theme::SPACE_MD);
    widgets::divider(ui);
    ui.add_space(theme::SPACE_SM);
    ui.label(text::column_label().job(&tr!("netstat.recentEvents", "Recent events")));
    ui.add_space(theme::SPACE_XS);
    let stamp_width = 44.0;
    let text_width = tiers::panel_content_width(PANEL_WIDTH) - stamp_width - COLUMN_GAP;
    for event in events {
        table_row(ui, |ui| {
            cell(
                ui,
                &text::numeral(ROW_SIZE).with_color(theme::TEXT_LABEL),
                &mmss(event.elapsed_secs),
                stamp_width,
                Align::LEFT,
            );
            cell(
                ui,
                &text::body(ROW_SIZE, BodyWeight::Regular).with_color(theme::TEXT_DIM),
                &event.text,
                text_width,
                Align::LEFT,
            );
        });
    }
}

/// What a column shows where it has no value at all.
const EM_DASH: &str = "—";

/// Renders a value as `Some` milliseconds, or an em dash for `None`.
fn opt_ms(value: Option<u64>) -> String {
    match value {
        Some(ms) => fmt_ms(ms),
        None => EM_DASH.to_string(),
    }
}

/// Formats the `age` column so it reads calm when fresh and informative when stale: a steady middle
/// dot while the most recent turn is fresh (below [`AGE_CALM_THRESHOLD_MS`]), where the live number
/// would only flicker; the actual milliseconds once age crosses that cutoff; and an em dash before
/// any turn has arrived.
fn fmt_age(age_ms: Option<u64>) -> String {
    match age_ms {
        Some(ms) if ms >= AGE_CALM_THRESHOLD_MS => fmt_ms(ms),
        Some(_) => "·".to_string(),
        None => EM_DASH.to_string(),
    }
}

/// Formats a millisecond duration compactly: bare `ms` under a second, `s` with one decimal under a
/// minute, then `m` + `s`.
fn fmt_ms(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms}ms")
    } else if ms < 60_000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else {
        format!("{}m{}s", ms / 60_000, (ms % 60_000) / 1000)
    }
}

/// Whole seconds as a clock reads them.
fn mmss(secs: u64) -> String {
    format!("{}:{:02}", secs / 60, secs % 60)
}

/// Amber once any stall time (or episode) has accrued, muted otherwise — so a clean slot reads quiet.
fn stall_color(value: u64) -> Color32 {
    if value > 0 {
        theme::ACCENT
    } else {
        theme::TEXT_DIM
    }
}

/// Amber once a duration crosses the threshold worth a glance, muted otherwise.
fn notable_color(ms: u64) -> Color32 {
    if ms >= NOTABLE_MS {
        theme::ACCENT
    } else {
        theme::TEXT_DIM
    }
}

/// Amber once a slot's most recent turn is noticeably stale, else primary. `None` (no arrival yet)
/// reads as muted.
fn stale_color(age_ms: Option<u64>) -> Color32 {
    match age_ms {
        Some(ms) if ms >= NOTABLE_MS => theme::ACCENT,
        Some(_) => theme::TEXT_PRIMARY,
        None => theme::TEXT_DIM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_ctx() -> egui::Context {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx.set_pixels_per_point(1.5);
        ctx
    }

    fn row(name: &str, departure: Option<RowDeparture>) -> NetStatRowView {
        NetStatRowView {
            name: name.to_string(),
            home: Some("r1 local-a".to_string()),
            last_turn_age_ms: Some(40),
            ewma_interval_ms: Some(42),
            max_gap_ms: 90,
            recent_stall_ms: 0,
            lifetime_stall_ms: 0,
            episode_count: 0,
            departure,
        }
    }

    fn view(rows: Vec<NetStatRowView>, events: Vec<NetEventView>, samples: usize) -> NetStatsView {
        NetStatsView {
            session_id: 1_783_817_817_540_254,
            relay_id: 1,
            region: Some("local-a".to_string()),
            buffer_turns: 3,
            buffer_change_count: 2,
            buffer_last_change_secs: Some(15),
            link_up: true,
            link_down_count: 0,
            link_last_change_secs: None,
            buffer_samples: (0..samples).map(|i| 2 + (i as u32 % 3)).collect(),
            gap_samples_ms: (0..samples).map(|i| 20 + i as u64).collect(),
            events,
            phase_applied_us: 0,
            phase_target_us: 0,
            rows,
        }
    }

    /// Renders one pass and returns the panel's width in points.
    fn render_width(ctx: &egui::Context, view: &NetStatsView) -> f32 {
        let raw = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::pos2(0.0, 0.0),
                vec2(1920.0, 1080.0),
            )),
            ..Default::default()
        };
        ctx.begin_pass(raw);
        render_netstat_view(view, ctx);
        let mut out = ctx.end_pass();
        let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
        out.textures_delta.clear();
        ctx.memory(|memory| memory.area_rect(Id::new("sb_netstat_overlay")))
            .map_or(0.0, |rect| rect.width())
    }

    fn settle_width(ctx: &egui::Context, view: &NetStatsView) -> f32 {
        let mut width = 0.0;
        for _ in 0..4 {
            width = render_width(ctx, view);
        }
        width
    }

    /// The panel sits over live gameplay, anchored to the screen's right edge: a width that follows
    /// its contents would slide the whole panel sideways every time a number, a name or a departure
    /// tag changed.
    #[test]
    fn panel_width_does_not_follow_its_contents() {
        let ctx = fresh_ctx();
        let baseline = settle_width(&ctx, &view(vec![row("ab", None)], Vec::new(), 40));
        assert!(baseline > 0.0, "the panel drew nothing");

        let cases = [
            (
                "a long name and a departure",
                view(
                    vec![
                        row("aVeryLongPlayerNameIndeed", None),
                        row("bee", Some(RowDeparture::Dropped)),
                    ],
                    Vec::new(),
                    40,
                ),
            ),
            (
                "an event ticker",
                view(
                    vec![row("ab", None)],
                    vec![NetEventView {
                        elapsed_secs: 543,
                        text: "a rather long event description that will not fit".to_string(),
                    }],
                    40,
                ),
            ),
            ("no history yet", view(vec![row("ab", None)], Vec::new(), 1)),
            ("no players at all", view(Vec::new(), Vec::new(), 40)),
        ];
        for (label, case) in cases {
            let width = settle_width(&ctx, &case);
            assert!(
                (width - baseline).abs() < 1.0,
                "panel width moved with {label}: baseline={baseline}, got={width}",
            );
        }
    }

    #[test]
    fn durations_read_compactly() {
        assert_eq!(fmt_ms(0), "0ms");
        assert_eq!(fmt_ms(999), "999ms");
        assert_eq!(fmt_ms(1500), "1.5s");
        assert_eq!(fmt_ms(65_000), "1m5s");
        assert_eq!(fmt_age(None), EM_DASH);
        assert_eq!(fmt_age(Some(40)), "·");
        assert_eq!(fmt_age(Some(900)), "900ms");
        assert_eq!(mmss(543), "9:03");
    }
}
