//! The network-stats overlay's presentation layer: a plain-data view-model and the egui render fns
//! that draw it. Like [`crate::disconnect`], everything here is a pure fn of [`NetStatsView`] plus an
//! [`egui::Context`], so the same code renders in the injected game DLL and in the host preview. The
//! DLL builds the view-model from live turn-state instrumentation; the preview builds it from
//! adjustable knobs.
//!
//! This is a diagnostic surface shown during live play (toggled by the `/netstat` chat command), so
//! it stays compact, translucent, and anchored top-right where it can't collide with the
//! top-center disconnect overlay.

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
/// Text size for the header stat lines (turn rate / buffer / link).
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
/// Minimum width of each numeric column.
const NUM_MIN_WIDTH: f32 = 52.0;

/// Calm/placeholder cutoff for the `age` column. A healthy peer's most-recent-turn age churns every
/// frame (~0-40ms), which is unreadable flicker and never actionable, so below this the column shows
/// a steady placeholder instead of the live number. Well under the [`stale_color`] warning threshold
/// (~500ms), so a genuinely late arrival still surfaces its actual milliseconds.
const AGE_CALM_THRESHOLD_MS: u64 = 200;

/// Size of the buffer-directive sparkline's drawing area.
const SPARKLINE_SIZE: Vec2 = Vec2 { x: 220.0, y: 40.0 };
/// The sparkline's plotted line colour.
const SPARKLINE_LINE: Color32 = colors::BLUE80;

/// One remote slot's row in the network-stats table: a player name with its turn-arrival and
/// sim-stall attribution numbers. Holds no BW or turn-state types.
pub struct NetStatRowView {
    /// The player's display name.
    pub name: String,
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

/// Everything the network-stats overlay needs to draw itself, resolved from the turn state's
/// instrumentation and game setup. The render path takes only this (plus an egui context), so it
/// renders identically in the game DLL and the host preview.
pub struct NetStatsView {
    /// The current simulation turn rate (turns per second).
    pub turn_rate: u32,
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
    /// The buffer-directive series for the sparkline, each point normalized to `[0, 1]` on both
    /// axes: `x` is time across the series span (0 oldest, 1 newest), `y` is the value across the
    /// series' min..max (0 lowest, 1 highest). Fewer than two points draws no line.
    pub buffer_series: Vec<(f32, f32)>,
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
                    draw_sparkline(ui, view);
                });
        });
}

/// Draws the title and the three header stat lines: turn rate, buffer depth (with its change
/// summary), and own-link state (with its history summary).
fn draw_header(ui: &mut egui::Ui, view: &NetStatsView) {
    ui.label(
        RichText::new("Network stats")
            .size(TITLE_SIZE)
            .color(PRIMARY)
            .strong()
            .family(display_family()),
    );
    ui.add_space(6.0);

    ui.label(
        RichText::new(format!(
            "Turn rate {}/s   ·   buffer {} turns",
            view.turn_rate, view.buffer_turns
        ))
        .size(HEADER_SIZE)
        .color(SECONDARY)
        .family(mono()),
    );

    let buffer_summary = match view.buffer_last_change_secs {
        Some(secs) => format!(
            "buffer changed {}×, last {}s ago",
            view.buffer_change_count, secs
        ),
        None => "buffer steady since start".to_string(),
    };
    ui.label(
        RichText::new(buffer_summary)
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
            Some(secs) => format!(
                "(down {}×, last change {}s ago)",
                view.link_down_count, secs
            ),
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
        .num_columns(7)
        .spacing(vec2(COLUMN_SPACING, ROW_SPACING))
        .min_col_width(NUM_MIN_WIDTH)
        .show(ui, |ui| {
            for (idx, &heading) in ["Player", "age", "intv", "gap", "st60", "life", "ep"]
                .iter()
                .enumerate()
            {
                let width = if idx == 0 {
                    NAME_MIN_WIDTH
                } else {
                    NUM_MIN_WIDTH
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

/// The buffer-directive sparkline: a labelled, framed strip with the normalized value series drawn
/// as connected line segments. Uses only painter primitives, so it needs no plotting dependency.
fn draw_sparkline(ui: &mut egui::Ui, view: &NetStatsView) {
    ui.label(
        RichText::new("buffer history")
            .size(ROW_SIZE)
            .color(SECONDARY)
            .family(mono()),
    );
    ui.add_space(2.0);
    let (rect, _) = ui.allocate_exact_size(SPARKLINE_SIZE, egui::Sense::hover());
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

    if view.buffer_series.len() < 2 {
        painter.text(
            rect.center(),
            Align2::CENTER_CENTER,
            "no changes",
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
    let map = |(t, v): (f32, f32)| -> Pos2 {
        pos2(
            plot.left() + t.clamp(0.0, 1.0) * plot.width(),
            // A normalized value of 1 is the highest buffer depth, so it maps to the top of the strip.
            plot.bottom() - v.clamp(0.0, 1.0) * plot.height(),
        )
    };
    for pair in view.buffer_series.windows(2) {
        painter.line_segment(
            [map(pair[0]), map(pair[1])],
            Stroke::new(1.5, SPARKLINE_LINE),
        );
    }
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
