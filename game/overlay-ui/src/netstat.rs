//! The network-stats overlay's presentation layer: a plain-data view-model and the egui render fns
//! that draw it. Like [`crate::disconnect`], everything here is a pure fn of [`NetStatsView`] plus an
//! [`egui::Context`], so the same code renders in the injected game DLL and in the host preview. The
//! DLL builds the view-model from live turn-state instrumentation; the preview builds it from
//! adjustable knobs.
//!
//! This is a diagnostic surface shown during live play (toggled by the `/netstat` chat command), so
//! it stays compact, translucent, and anchored top-right where it can't collide with the
//! top-center disconnect overlay. It serves two readers at once: a player triaging lag live (calm
//! when healthy, amber when not), and an operator reading a screenshot in a bug report hours later
//! (the identity header and event ticker carry the ids and recent history an incident lookup needs).

use egui::{
    Align2, Color32, CornerRadius, FontFamily, FontId, Frame, Margin, Pos2, Rect, RichText, Stroke,
    Vec2, pos2, vec2,
};

use crate::colors;
use crate::fonts::display_family;

/// Near-white high-emphasis colour for primary text (header title, player names).
const PRIMARY: Color32 = Color32::from_rgb(0xE8, 0xEA, 0xED);
/// Muted secondary for column headers, units, and quiet values.
const SECONDARY: Color32 = Color32::from_rgb(0x9A, 0x9F, 0xA6);
/// Amber accent for any value worth a glance: accrued stall time, a stale turn arrival, a downed
/// link.
const WARNING: Color32 = Color32::from_rgb(0xFF, 0xB7, 0x4D);
/// Green for a healthy own-link indicator.
const HEALTHY: Color32 = Color32::from_rgb(0x81, 0xC7, 0x84);

/// Text size for the panel title.
const TITLE_SIZE: f32 = 18.0;
/// Text size for the header stat lines (identity / buffer / link).
const HEADER_SIZE: f32 = 14.0;
/// Text size for the per-slot table (both the column header and the rows). Monospace, so the numeric
/// columns line up.
const ROW_SIZE: f32 = 13.0;
/// Horizontal gap between table columns.
const COLUMN_SPACING: f32 = 14.0;
/// Vertical gap between table rows.
const ROW_SPACING: f32 = 4.0;
/// Minimum width of the player-name column, so short names don't let the table jitter in width as
/// values change.
const NAME_MIN_WIDTH: f32 = 96.0;
/// Minimum width of the per-player home column (`r1 local-a`-style text).
const HOME_MIN_WIDTH: f32 = 78.0;
/// Minimum width of each numeric column.
const NUM_MIN_WIDTH: f32 = 52.0;

/// Calm/placeholder cutoff for the `age` column. A healthy peer's most-recent-turn age churns every
/// frame (~0-40ms), which is unreadable flicker and never actionable, so below this the column shows
/// a steady placeholder instead of the live number. Well under the [`stale_color`] warning threshold
/// (~500ms), so a genuinely late arrival still surfaces its actual milliseconds.
const AGE_CALM_THRESHOLD_MS: u64 = 200;

/// Size of each time-sampled history strip's drawing area.
const STRIP_SIZE: Vec2 = Vec2 { x: 208.0, y: 28.0 };
/// The strips' plotted line colour.
const STRIP_LINE: Color32 = colors::BLUE80;
/// The arrival-gap strip scales its plot against at least this many milliseconds, so a healthy
/// game's tiny inter-arrival jitter reads as a calm line near the floor rather than being amplified
/// to full height. Only a genuine gap taller than this lifts the trace.
const GAP_STRIP_FLOOR_MS: u64 = 800;

/// One remote slot's row in the network-stats table: a player name and home relay, with its
/// turn-arrival and sim-stall attribution numbers. Holds no BW or turn-state types.
pub struct NetStatRowView {
    /// The player's display name.
    pub name: String,
    /// This slot's home relay at session create, pre-formatted as `r<id>` or `r<id> <region>`, or
    /// `None` when the setup carried none (rendered as an em dash). Peers' later re-homes are not
    /// observable client-side, so this is always the create-time home — only the header's own relay
    /// tracks re-homes live.
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
    /// The current relay's region label (e.g. `local-b`), or `None` when the setup carried none.
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
    /// Buffer depth sampled once per second, oldest first. Drawn as a stepped line; fewer than two
    /// samples draws a "gathering" placeholder.
    pub buffer_samples: Vec<u32>,
    /// The worst remote per-slot arrival gap (milliseconds) in each one-second window, oldest first.
    /// Shares the strips' x-axis with [`buffer_samples`](Self::buffer_samples).
    pub gap_samples_ms: Vec<u64>,
    /// The recent-events ticker, oldest first. Empty omits the section.
    pub events: Vec<NetEventView>,
    /// One row per remote slot.
    pub rows: Vec<NetStatRowView>,
}

/// The monospace family used for the numeric table, so columns align regardless of digit widths.
fn mono() -> FontFamily {
    FontFamily::Monospace
}

/// Renders the network-stats overlay as a compact translucent panel anchored top-right. Purely
/// informational: it never captures input (the caller registers no ui rect for it), so it doesn't
/// interfere with play while it's up.
pub fn render_netstat_view(view: &NetStatsView, ctx: &egui::Context) {
    egui::Area::new("sb_netstat_overlay".into())
        // Top-right, pushed down clear of SC:R's top-right resource counters (minerals/gas/supply),
        // which occupy roughly the top ~44px — so the panel reads as a distinct floating surface
        // below them rather than overlapping the HUD. Right margin keeps it off the screen edge.
        .anchor(Align2::RIGHT_TOP, vec2(-12.0, 54.0))
        .order(egui::Order::Foreground)
        .interactable(false)
        .show(ctx, |ui| {
            Frame::default()
                .fill(colors::CONTAINER_HIGH.gamma_multiply(0.85))
                // A subtle 1px outline so the panel separates cleanly from the game behind it.
                .stroke(Stroke::new(1.0, colors::GREY40))
                .corner_radius(CornerRadius::same(8))
                .inner_margin(Margin::symmetric(14, 12))
                .show(ui, |ui| {
                    draw_header(ui, view);
                    ui.add_space(8.0);
                    draw_table(ui, &view.rows);
                    ui.add_space(10.0);
                    draw_strips(ui, view);
                    draw_events(ui, &view.events);
                });
        });
}

/// Draws the title and the three header lines: the identity line (session + current relay + region)
/// an incident lookup keys on, the buffer depth with its change summary, and the own-link state with
/// its history summary.
fn draw_header(ui: &mut egui::Ui, view: &NetStatsView) {
    ui.label(
        RichText::new("Network stats")
            .size(TITLE_SIZE)
            .color(PRIMARY)
            .strong()
            .family(display_family()),
    );
    ui.add_space(6.0);

    let relay = match &view.region {
        Some(region) => format!("relay {} ({region})", view.relay_id),
        None => format!("relay {}", view.relay_id),
    };
    ui.label(
        RichText::new(format!("session {}   ·   {relay}", view.session_id))
            .size(HEADER_SIZE)
            .color(SECONDARY)
            .family(mono()),
    );

    let buffer_summary = match view.buffer_last_change_secs {
        Some(secs) => format!("changed {}×, last {}s ago", view.buffer_change_count, secs),
        None => "steady since start".to_string(),
    };
    ui.label(
        RichText::new(format!(
            "buffer {} turns   ·   {buffer_summary}",
            view.buffer_turns
        ))
        .size(HEADER_SIZE)
        .color(SECONDARY)
        .family(mono()),
    );

    ui.horizontal(|ui| {
        let (state_text, state_color) = if view.link_up {
            ("link up", HEALTHY)
        } else {
            ("link DOWN", WARNING)
        };
        ui.label(
            RichText::new(state_text)
                .size(HEADER_SIZE)
                .color(state_color)
                .family(mono()),
        );
        let history = match view.link_last_change_secs {
            Some(secs) => format!("(down {}×, last change {}s ago)", view.link_down_count, secs),
            None => "(no drops)".to_string(),
        };
        ui.label(
            RichText::new(history)
                .size(HEADER_SIZE)
                .color(SECONDARY)
                .family(mono()),
        );
    });
}

/// Draws the per-slot table: a column header followed by one row per remote slot. A monospace grid
/// keeps the numeric columns aligned as their values change.
fn draw_table(ui: &mut egui::Ui, rows: &[NetStatRowView]) {
    egui::Grid::new("sb_netstat_rows")
        .num_columns(8)
        .spacing(vec2(COLUMN_SPACING, ROW_SPACING))
        .min_col_width(NUM_MIN_WIDTH)
        .show(ui, |ui| {
            for (idx, &heading) in ["Player", "home", "age", "intv", "gap", "st60", "life", "ep"]
                .iter()
                .enumerate()
            {
                let width = match idx {
                    0 => NAME_MIN_WIDTH,
                    1 => HOME_MIN_WIDTH,
                    _ => NUM_MIN_WIDTH,
                };
                ui.allocate_ui(vec2(width, ROW_SIZE + 2.0), |ui| {
                    ui.label(
                        RichText::new(heading)
                            .size(ROW_SIZE)
                            .color(SECONDARY)
                            .family(mono()),
                    );
                });
            }
            ui.end_row();

            if rows.is_empty() {
                ui.label(
                    RichText::new("(no remote players)")
                        .size(ROW_SIZE)
                        .color(SECONDARY)
                        .family(mono()),
                );
                ui.end_row();
            }

            for row in rows {
                ui.label(
                    RichText::new(&row.name)
                        .size(ROW_SIZE)
                        .color(PRIMARY)
                        .family(mono()),
                );
                ui.label(
                    RichText::new(row.home.as_deref().unwrap_or("—"))
                        .size(ROW_SIZE)
                        .color(SECONDARY)
                        .family(mono()),
                );
                num_cell(
                    ui,
                    fmt_age(row.last_turn_age_ms),
                    stale_color(row.last_turn_age_ms),
                );
                num_cell(ui, opt_ms(row.ewma_interval_ms), SECONDARY);
                num_cell(ui, fmt_ms(row.max_gap_ms), gap_color(row.max_gap_ms));
                num_cell(
                    ui,
                    fmt_ms(row.recent_stall_ms),
                    stall_color(row.recent_stall_ms),
                );
                num_cell(
                    ui,
                    fmt_ms(row.lifetime_stall_ms),
                    stall_color(row.lifetime_stall_ms),
                );
                num_cell(
                    ui,
                    row.episode_count.to_string(),
                    stall_color(row.episode_count as u64),
                );
                ui.end_row();
            }
        });
}

/// Draws one numeric table cell in a fixed-width monospace font.
fn num_cell(ui: &mut egui::Ui, text: String, color: Color32) {
    ui.label(
        RichText::new(text)
            .size(ROW_SIZE)
            .color(color)
            .family(mono()),
    );
}

/// Draws the time-sampled history strips: buffer depth (stepped) and worst per-slot arrival gap
/// (line), both sampled at 1 Hz so their shared x-axis is wall time. Each labels its current value
/// on the right edge, so the graph and the number never need cross-referencing.
fn draw_strips(ui: &mut egui::Ui, view: &NetStatsView) {
    let buffer_points = buffer_strip_points(&view.buffer_samples);
    let buffer_value = view
        .buffer_samples
        .last()
        .map_or_else(|| "—".to_string(), |&v| format!("buffer {v}t"));
    draw_strip(ui, "buffer depth", &buffer_points, true, buffer_value, SECONDARY);

    ui.add_space(6.0);

    let gap_points = gap_strip_points(&view.gap_samples_ms);
    let last_gap = view.gap_samples_ms.last().copied();
    let gap_value = last_gap.map_or_else(|| "—".to_string(), |v| format!("gap {}", fmt_ms(v)));
    let gap_value_color = match last_gap {
        Some(ms) if ms >= 500 => WARNING,
        _ => SECONDARY,
    };
    draw_strip(ui, "worst gap", &gap_points, false, gap_value, gap_value_color);
}

/// Draws one labelled history strip: a caption, a framed plot of `points` (each already normalized
/// to `[0, 1]` on the y-axis, indexed oldest-first on the x-axis), and the current value labelled at
/// the strip's top-right corner. `step` holds each sample's level until the next (a staircase);
/// otherwise the samples connect directly. Uses only painter primitives, so it needs no plotting
/// dependency. Fewer than two points draws a placeholder.
fn draw_strip(
    ui: &mut egui::Ui,
    caption: &str,
    points: &[f32],
    step: bool,
    value_text: String,
    value_color: Color32,
) {
    ui.label(
        RichText::new(caption)
            .size(ROW_SIZE)
            .color(SECONDARY)
            .family(mono()),
    );
    ui.add_space(2.0);
    let (rect, _) = ui.allocate_exact_size(STRIP_SIZE, egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(
        rect,
        CornerRadius::same(4),
        colors::CONTAINER_LOW.gamma_multiply(0.7),
    );
    painter.rect_stroke(
        rect,
        CornerRadius::same(4),
        Stroke::new(1.0, colors::GREY40),
        egui::StrokeKind::Inside,
    );

    if points.len() < 2 {
        painter.text(
            rect.center(),
            Align2::CENTER_CENTER,
            "gathering…",
            FontId::new(ROW_SIZE, mono()),
            SECONDARY,
        );
        return;
    }

    // Inset the plotted line a couple of pixels so it never sits flush against the frame.
    let inset = 3.0;
    let plot = Rect::from_min_max(
        pos2(rect.left() + inset, rect.top() + inset),
        pos2(rect.right() - inset, rect.bottom() - inset),
    );
    let last = points.len() - 1;
    let map = |idx: usize, value: f32| -> Pos2 {
        pos2(
            plot.left() + (idx as f32 / last as f32) * plot.width(),
            // A normalized value of 1 is the strip's peak, so it maps to the top.
            plot.bottom() - value.clamp(0.0, 1.0) * plot.height(),
        )
    };
    for idx in 0..last {
        let a = map(idx, points[idx]);
        let b = map(idx + 1, points[idx + 1]);
        if step {
            // Hold the level across the interval, then step to the next sample's level.
            let corner = pos2(b.x, a.y);
            painter.line_segment([a, corner], Stroke::new(1.5, STRIP_LINE));
            painter.line_segment([corner, b], Stroke::new(1.5, STRIP_LINE));
        } else {
            painter.line_segment([a, b], Stroke::new(1.5, STRIP_LINE));
        }
    }

    painter.text(
        pos2(rect.right() - 4.0, rect.top() + 3.0),
        Align2::RIGHT_TOP,
        value_text,
        FontId::new(ROW_SIZE, mono()),
        value_color,
    );
}

/// Draws the recent-events ticker: `mm:ss  <text>` lines, oldest first. Omitted entirely when there
/// are no events, so a clean game shows nothing here.
fn draw_events(ui: &mut egui::Ui, events: &[NetEventView]) {
    if events.is_empty() {
        return;
    }
    ui.add_space(10.0);
    ui.label(
        RichText::new("recent events")
            .size(ROW_SIZE)
            .color(SECONDARY)
            .family(mono()),
    );
    ui.add_space(2.0);
    for event in events {
        ui.label(
            RichText::new(format!("{}  {}", fmt_mmss(event.elapsed_secs), event.text))
                .size(ROW_SIZE)
                .color(SECONDARY)
                .family(mono()),
        );
    }
}

/// Normalizes buffer-depth samples to `[0, 1]` across their own min..max, so a flat run sits at the
/// bottom and each directive change reads as a step. A flat series (zero range) pins to the bottom
/// rather than dividing by zero.
fn buffer_strip_points(values: &[u32]) -> Vec<f32> {
    let min = values.iter().copied().min().unwrap_or(0);
    let max = values.iter().copied().max().unwrap_or(0);
    let range = max.saturating_sub(min).max(1) as f32;
    values.iter().map(|&v| (v - min) as f32 / range).collect()
}

/// Normalizes arrival-gap samples to `[0, 1]` against `max(observed max, GAP_STRIP_FLOOR_MS)`, so a
/// healthy game's small gaps read low and calm and only a real spike lifts the trace.
fn gap_strip_points(values: &[u64]) -> Vec<f32> {
    let scale = values
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .max(GAP_STRIP_FLOOR_MS) as f32;
    values.iter().map(|&v| v as f32 / scale).collect()
}

/// Renders a value as `Some` milliseconds, or an em dash for `None`.
fn opt_ms(value: Option<u64>) -> String {
    match value {
        Some(ms) => fmt_ms(ms),
        None => "—".to_string(),
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
        None => "—".to_string(),
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

/// Formats whole seconds as `mm:ss` (minutes grow past two digits on a long game).
fn fmt_mmss(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

/// Amber once any stall time (or episode) has accrued, muted otherwise — so a clean slot reads quiet.
fn stall_color(value: u64) -> Color32 {
    if value > 0 { WARNING } else { SECONDARY }
}

/// Amber once an inter-arrival gap exceeds a noticeable threshold (~500 ms), muted otherwise.
fn gap_color(ms: u64) -> Color32 {
    if ms >= 500 { WARNING } else { SECONDARY }
}

/// Amber once a slot's most recent turn is noticeably stale (~500 ms), else primary. `None` (no
/// arrival yet) reads as muted.
fn stale_color(age_ms: Option<u64>) -> Color32 {
    match age_ms {
        Some(ms) if ms >= 500 => WARNING,
        Some(_) => PRIMARY,
        None => SECONDARY,
    }
}
