//! Native preview host for the in-game overlays.
//!
//! An eframe app that renders the extracted overlays (the exact widget code the game DLL uses) over
//! a configurable backdrop, with a knobs panel to emulate every state without launching StarCraft:
//! the disconnect overlay's disconnected players / per-row tier / elapsed seconds / drop flags /
//! self-state, the network-stats overlay's header, per-slot rows and buffer sparkline, and egui's
//! pixels-per-point. Knobs persist to a JSON file next to the binary across restarts.
//!
//! `--smoke` renders a few frames of several states headlessly (no window) and exits 0, for CI-ish
//! verification that the extracted render path and font setup run on the host.

use std::path::PathBuf;
use std::time::Instant;

use egui::{Color32, Rect, pos2, vec2};
use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectTier, DisconnectView, SelfState, render_disconnect_view,
};
use overlay_ui::netstat::{NetStatRowView, NetStatsView, render_netstat_view};
use serde::{Deserialize, Serialize};

/// Parsed command line.
struct Args {
    smoke: bool,
    backdrop: Option<String>,
}

fn parse_args() -> Args {
    let mut smoke = false;
    let mut backdrop = None;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--smoke" => smoke = true,
            "--backdrop" => backdrop = it.next(),
            other => eprintln!("overlay-preview: ignoring unknown argument `{other}`"),
        }
    }
    Args { smoke, backdrop }
}

fn main() -> eframe::Result<()> {
    let args = parse_args();
    if args.smoke {
        run_smoke();
        std::process::exit(0);
    }

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1500.0, 840.0])
            .with_title("ShieldBattery Overlay Preview"),
        ..Default::default()
    };
    eframe::run_native(
        "ShieldBattery Overlay Preview",
        native_options,
        Box::new(move |cc| {
            overlay_ui::install_fonts_and_style(&cc.egui_ctx);
            Ok(Box::new(PreviewApp::new(args)))
        }),
    )
}

/// Drives the extracted render path over a handful of emulated states without opening a window, so a
/// CI step can prove the presentation layer and font setup run on the host. Panics (non-zero exit)
/// if any frame does.
fn run_smoke() {
    let ctx = egui::Context::default();
    overlay_ui::install_fonts_and_style(&ctx);
    ctx.set_pixels_per_point(1.5);

    let states = [
        DisconnectView {
            rows: Vec::new(),
            self_state: SelfState::Reconnecting,
        },
        DisconnectView {
            rows: vec![
                DisconnectRowView {
                    slot: 0,
                    name: "Stalled Player".to_string(),
                    seconds: 3,
                    tier: DisconnectTier::Stall,
                    drop_unlocked: false,
                    drop_requested: false,
                },
                DisconnectRowView {
                    slot: 1,
                    name: "Counting Down".to_string(),
                    seconds: 20,
                    tier: DisconnectTier::Confirmed,
                    drop_unlocked: false,
                    drop_requested: false,
                },
                DisconnectRowView {
                    slot: 2,
                    name: "Droppable".to_string(),
                    seconds: 50,
                    tier: DisconnectTier::Confirmed,
                    drop_unlocked: true,
                    drop_requested: true,
                },
            ],
            self_state: SelfState::Healthy,
        },
    ];

    for view in &states {
        for _ in 0..3 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 720.0))),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            let _ = render_disconnect_view(view, &ctx);
            let output = ctx.end_pass();
            let _ = ctx.tessellate(output.shapes, ctx.pixels_per_point());
        }
    }

    let netstat_states = [
        // Empty (no remote players, no history) — exercises the degenerate table / sparkline paths.
        NetStatsView {
            turn_rate: 24,
            buffer_turns: 2,
            buffer_change_count: 0,
            buffer_last_change_secs: None,
            link_up: true,
            link_down_count: 0,
            link_last_change_secs: None,
            buffer_series: Vec::new(),
            rows: Vec::new(),
        },
        // A populated, unhappy session — stalls, a stale slot, link blips, a stepped buffer series.
        NetStatsView {
            turn_rate: 24,
            buffer_turns: 6,
            buffer_change_count: 3,
            buffer_last_change_secs: Some(12),
            link_up: false,
            link_down_count: 2,
            link_last_change_secs: Some(4),
            buffer_series: buffer_series_from_shape(BufferShape::Step),
            rows: vec![
                NetStatRowView {
                    name: "Rhynso".to_string(),
                    last_turn_age_ms: Some(42),
                    ewma_interval_ms: Some(43),
                    max_gap_ms: 120,
                    recent_stall_ms: 0,
                    lifetime_stall_ms: 0,
                    episode_count: 0,
                },
                NetStatRowView {
                    name: "tec27".to_string(),
                    last_turn_age_ms: Some(1300),
                    ewma_interval_ms: Some(210),
                    max_gap_ms: 1800,
                    recent_stall_ms: 2400,
                    lifetime_stall_ms: 90_000,
                    episode_count: 7,
                },
            ],
        },
    ];
    for view in &netstat_states {
        for _ in 0..3 {
            let raw = egui::RawInput {
                screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 720.0))),
                ..Default::default()
            };
            ctx.begin_pass(raw);
            render_netstat_view(view, &ctx);
            let output = ctx.end_pass();
            let _ = ctx.tessellate(output.shapes, ctx.pixels_per_point());
        }
    }
    println!("overlay-preview smoke: OK");
}

/// One emulated disconnect row's adjustable state.
#[derive(Clone, Serialize, Deserialize)]
struct RowKnob {
    /// The rally-point2 slot id this row reports as; surfaced in the click log so a click is
    /// traceable to a row.
    slot: u8,
    name: String,
    /// `false` => [`DisconnectTier::Stall`], `true` => [`DisconnectTier::Confirmed`].
    confirmed: bool,
    /// Base elapsed seconds; the auto-tick offset is added on top for the live view.
    seconds: u64,
    drop_unlocked: bool,
    drop_requested: bool,
}

impl RowKnob {
    fn generated(slot: u8) -> RowKnob {
        RowKnob {
            slot,
            name: format!("Player {}", slot + 1),
            confirmed: true,
            seconds: 10,
            drop_unlocked: false,
            drop_requested: false,
        }
    }
}

/// One of the buffer-directive series shapes the network-stats sparkline can be emulated with, so the
/// sparkline's drawing is exercised against a flat line, a single step, a steady ramp, and a
/// repeating sawtooth without needing a live relay retuning the pipe.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum BufferShape {
    Flat,
    Step,
    Ramp,
    Sawtooth,
}

impl BufferShape {
    const ALL: [BufferShape; 4] = [
        BufferShape::Flat,
        BufferShape::Step,
        BufferShape::Ramp,
        BufferShape::Sawtooth,
    ];

    fn label(self) -> &'static str {
        match self {
            BufferShape::Flat => "flat",
            BufferShape::Step => "step",
            BufferShape::Ramp => "ramp",
            BufferShape::Sawtooth => "sawtooth",
        }
    }
}

/// Builds a normalized `(t, v)` buffer series (both axes in `[0, 1]`) for a shape, matching the
/// contract [`NetStatsView::buffer_series`] documents.
fn buffer_series_from_shape(shape: BufferShape) -> Vec<(f32, f32)> {
    const POINTS: usize = 48;
    (0..POINTS)
        .map(|i| {
            let t = i as f32 / (POINTS - 1) as f32;
            let v = match shape {
                BufferShape::Flat => 0.5,
                BufferShape::Step => {
                    if t < 0.5 {
                        0.2
                    } else {
                        0.85
                    }
                }
                BufferShape::Ramp => t,
                BufferShape::Sawtooth => (t * 3.0).fract(),
            };
            (t, v)
        })
        .collect()
}

/// The network-stats overlay's emulation knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct NetStatsKnobs {
    /// Whether to render the network-stats overlay at all.
    show: bool,
    turn_rate: u32,
    buffer_turns: u32,
    buffer_change_count: u32,
    /// Seconds since the last buffer change; a negative value emulates "never changed" (`None`).
    buffer_last_change_secs: i64,
    link_up: bool,
    link_down_count: u32,
    /// Seconds since the last link transition; a negative value emulates "never changed" (`None`).
    link_last_change_secs: i64,
    /// How many remote-slot rows to synthesize.
    row_count: usize,
    /// The recent-stall milliseconds applied to every other synthesized row (the rest stay clean),
    /// so the stall columns' colouring and formatting can be eyeballed.
    stall_ms: u64,
    shape: BufferShape,
}

impl Default for NetStatsKnobs {
    fn default() -> NetStatsKnobs {
        NetStatsKnobs {
            show: false,
            turn_rate: 24,
            buffer_turns: 3,
            buffer_change_count: 2,
            buffer_last_change_secs: 15,
            link_up: true,
            link_down_count: 1,
            link_last_change_secs: 30,
            row_count: 3,
            stall_ms: 1500,
            shape: BufferShape::Step,
        }
    }
}

/// The full set of persisted preview knobs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Knobs {
    rows: Vec<RowKnob>,
    /// `true` => the prominent self-reconnecting notice replaces the peers panel.
    self_reconnecting: bool,
    /// egui pixels-per-point; the game derives this from render-target height, so it is the main
    /// knob for matching the game's on-screen scale.
    pixels_per_point: f32,
    /// While set, every row's elapsed counter advances in real time from its base value.
    auto_tick: bool,
    /// Optional PNG backdrop behind the overlay; solid dark when absent.
    backdrop_path: Option<String>,
    /// The network-stats overlay's emulation state.
    netstat: NetStatsKnobs,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            rows: vec![
                RowKnob {
                    slot: 0,
                    name: "Rhynso".to_string(),
                    confirmed: true,
                    seconds: 12,
                    drop_unlocked: false,
                    drop_requested: false,
                },
                RowKnob {
                    slot: 1,
                    name: "tec27".to_string(),
                    confirmed: false,
                    seconds: 4,
                    drop_unlocked: false,
                    drop_requested: false,
                },
            ],
            self_reconnecting: false,
            pixels_per_point: 1.5,
            auto_tick: false,
            backdrop_path: None,
            netstat: NetStatsKnobs::default(),
        }
    }
}

/// Where the persisted knobs live: next to the built binary, so a checkout's `target/` carries them.
fn knobs_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.with_file_name("overlay-preview-knobs.json"))
}

fn load_knobs() -> Knobs {
    let Some(path) = knobs_path() else {
        return Knobs::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|err| {
            eprintln!("overlay-preview: ignoring unreadable knobs file ({err})");
            Knobs::default()
        }),
        Err(_) => Knobs::default(),
    }
}

fn save_knobs(knobs: &Knobs) {
    let Some(path) = knobs_path() else {
        return;
    };
    match serde_json::to_string_pretty(knobs) {
        Ok(text) => {
            if let Err(err) = std::fs::write(&path, text) {
                eprintln!("overlay-preview: could not save knobs ({err})");
            }
        }
        Err(err) => eprintln!("overlay-preview: could not serialize knobs ({err})"),
    }
}

struct PreviewApp {
    knobs: Knobs,
    /// Real time accumulated while auto-tick is on, added to every row's base seconds.
    tick_accum: f64,
    last_instant: Instant,
    /// Whether a knob changed this frame and the file should be rewritten at frame end.
    dirty: bool,
    /// Cached backdrop texture, keyed by the path it was decoded from.
    backdrop_tex: Option<(String, egui::TextureHandle)>,
    /// Last backdrop-load error, shown in the panel.
    backdrop_error: Option<String>,
    /// The slots clicked in the most recent frame that had any, for feedback.
    last_clicked: Vec<u8>,
    next_slot: u8,
}

impl PreviewApp {
    fn new(args: Args) -> PreviewApp {
        let mut knobs = load_knobs();
        if let Some(backdrop) = args.backdrop {
            knobs.backdrop_path = Some(backdrop);
        }
        let next_slot = knobs.rows.iter().map(|r| r.slot).max().map_or(0, |m| m + 1);
        PreviewApp {
            knobs,
            tick_accum: 0.0,
            last_instant: Instant::now(),
            dirty: false,
            backdrop_tex: None,
            backdrop_error: None,
            last_clicked: Vec::new(),
            next_slot,
        }
    }

    fn effective_seconds(&self, base: u64) -> u64 {
        base + self.tick_accum as u64
    }

    fn build_view(&self) -> DisconnectView {
        let rows = self
            .knobs
            .rows
            .iter()
            .map(|row| DisconnectRowView {
                slot: row.slot,
                name: row.name.clone(),
                seconds: self.effective_seconds(row.seconds),
                tier: if row.confirmed {
                    DisconnectTier::Confirmed
                } else {
                    DisconnectTier::Stall
                },
                drop_unlocked: row.drop_unlocked,
                drop_requested: row.drop_requested,
            })
            .collect();
        DisconnectView {
            rows,
            self_state: if self.knobs.self_reconnecting {
                SelfState::Reconnecting
            } else {
                SelfState::Healthy
            },
        }
    }

    fn build_netstat_view(&self) -> NetStatsView {
        let k = &self.knobs.netstat;
        let rows = (0..k.row_count)
            .map(|i| {
                let stalled = i % 2 == 1;
                let recent = if stalled { k.stall_ms } else { 0 };
                NetStatRowView {
                    name: format!("Player {}", i + 1),
                    last_turn_age_ms: Some(if stalled { 900 } else { 40 } + i as u64 * 5),
                    ewma_interval_ms: Some(1000 / k.turn_rate.max(1) as u64 + i as u64 * 3),
                    max_gap_ms: if stalled { 1600 } else { 90 },
                    recent_stall_ms: recent,
                    lifetime_stall_ms: recent * 12,
                    episode_count: if stalled { 3 + i as u32 } else { 0 },
                }
            })
            .collect();
        NetStatsView {
            turn_rate: k.turn_rate,
            buffer_turns: k.buffer_turns,
            buffer_change_count: k.buffer_change_count,
            buffer_last_change_secs: (k.buffer_last_change_secs >= 0)
                .then_some(k.buffer_last_change_secs as u64),
            link_up: k.link_up,
            link_down_count: k.link_down_count,
            link_last_change_secs: (k.link_last_change_secs >= 0)
                .then_some(k.link_last_change_secs as u64),
            buffer_series: buffer_series_from_shape(k.shape),
            rows,
        }
    }

    fn ensure_backdrop(&mut self, ctx: &egui::Context) {
        let Some(path) = self.knobs.backdrop_path.clone() else {
            self.backdrop_tex = None;
            return;
        };
        if self.backdrop_tex.as_ref().map(|(p, _)| p.as_str()) == Some(path.as_str()) {
            return;
        }
        match image::open(&path) {
            Ok(img) => {
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                let color =
                    egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &rgba);
                let tex = ctx.load_texture("backdrop", color, egui::TextureOptions::LINEAR);
                self.backdrop_tex = Some((path, tex));
                self.backdrop_error = None;
            }
            Err(err) => {
                self.backdrop_tex = None;
                self.backdrop_error = Some(format!("{err}"));
            }
        }
    }

    fn paint_backdrop(&self, ui: &egui::Ui, rect: Rect) {
        let painter = ui.painter();
        // A solid dark base, so a transparent-edged image or no image at all still reads as a game
        // scene rather than the window's default fill.
        painter.rect_filled(rect, 0.0, Color32::from_rgb(0x10, 0x14, 0x1c));
        if let Some((_, tex)) = &self.backdrop_tex {
            painter.image(
                tex.id(),
                rect,
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                Color32::WHITE,
            );
        }
    }

    fn knobs_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("Overlay preview");
        ui.add_space(4.0);

        ui.label("These knobs emulate the live turn-state the game feeds the overlay.");
        ui.add_space(8.0);

        egui::Grid::new("global_knobs")
            .num_columns(2)
            .spacing(vec2(8.0, 6.0))
            .show(ui, |ui| {
                ui.label("Pixels per point");
                let ppp = ui.add(
                    egui::Slider::new(&mut self.knobs.pixels_per_point, 0.75..=3.0).step_by(0.05),
                );
                self.dirty |= ppp.changed();
                ui.end_row();

                ui.label("Self reconnecting");
                let sr = ui.checkbox(&mut self.knobs.self_reconnecting, "show self notice");
                self.dirty |= sr.changed();
                ui.end_row();

                ui.label("Auto-tick counters");
                let at = ui.checkbox(&mut self.knobs.auto_tick, "advance seconds live");
                if at.changed() {
                    self.tick_accum = 0.0;
                    self.dirty = true;
                }
                ui.end_row();
            });

        ui.add_space(8.0);
        ui.label("Backdrop (PNG path, blank for solid dark):");
        let mut path = self.knobs.backdrop_path.clone().unwrap_or_default();
        let edit = ui.text_edit_singleline(&mut path);
        if edit.changed() {
            self.knobs.backdrop_path = if path.trim().is_empty() {
                None
            } else {
                Some(path)
            };
            self.dirty = true;
        }
        if let Some(err) = &self.backdrop_error {
            ui.colored_label(
                Color32::from_rgb(0xff, 0x8a, 0x80),
                format!("backdrop: {err}"),
            );
        }

        ui.add_space(8.0);
        ui.separator();
        ui.horizontal(|ui| {
            ui.heading("Rows");
            if ui.button("+ add").clicked() {
                let slot = self.next_slot;
                self.next_slot += 1;
                self.knobs.rows.push(RowKnob::generated(slot));
                self.dirty = true;
            }
            if ui.button("clear").clicked() {
                self.knobs.rows.clear();
                self.dirty = true;
            }
        });

        let mut remove = None;
        for (idx, row) in self.knobs.rows.iter_mut().enumerate() {
            ui.push_id(idx, |ui| {
                ui.add_space(4.0);
                egui::Frame::group(ui.style()).show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(format!("slot {}", row.slot));
                        let name = ui.text_edit_singleline(&mut row.name);
                        self.dirty |= name.changed();
                        if ui.button("✕").clicked() {
                            remove = Some(idx);
                        }
                    });
                    ui.horizontal(|ui| {
                        let c = ui.checkbox(&mut row.confirmed, "confirmed");
                        self.dirty |= c.changed();
                        ui.label("seconds");
                        let s = ui.add(egui::DragValue::new(&mut row.seconds).range(0..=6000));
                        self.dirty |= s.changed();
                    });
                    ui.horizontal(|ui| {
                        let u = ui.checkbox(&mut row.drop_unlocked, "drop unlocked");
                        self.dirty |= u.changed();
                        let r = ui.checkbox(&mut row.drop_requested, "drop requested");
                        self.dirty |= r.changed();
                    });
                });
            });
        }
        if let Some(idx) = remove {
            self.knobs.rows.remove(idx);
            self.dirty = true;
        }

        ui.add_space(8.0);
        ui.separator();
        self.netstat_panel(ui);

        ui.add_space(8.0);
        ui.separator();
        if self.last_clicked.is_empty() {
            ui.label("Last Drop click: (none)");
        } else {
            ui.label(format!("Last Drop click: slots {:?}", self.last_clicked));
        }
    }

    /// The network-stats overlay's knobs section.
    fn netstat_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("Network stats");
        // Accumulate into a local so the whole section borrows only `self.knobs.netstat`, then fold
        // the result into `self.dirty` once that borrow has ended.
        let n = &mut self.knobs.netstat;
        let mut changed = false;
        changed |= ui
            .checkbox(&mut n.show, "show network-stats overlay")
            .changed();

        egui::Grid::new("netstat_knobs")
            .num_columns(2)
            .spacing(vec2(8.0, 6.0))
            .show(ui, |ui| {
                ui.label("Turn rate");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.turn_rate).range(1..=48))
                    .changed();
                ui.end_row();

                ui.label("Buffer turns");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.buffer_turns).range(1..=64))
                    .changed();
                ui.end_row();

                ui.label("Buffer changes");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.buffer_change_count).range(0..=999))
                    .changed();
                ui.end_row();

                ui.label("Buffer last change (s, <0 = never)");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.buffer_last_change_secs).range(-1..=6000))
                    .changed();
                ui.end_row();

                ui.label("Link up");
                changed |= ui.checkbox(&mut n.link_up, "own link up").changed();
                ui.end_row();

                ui.label("Link downs");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.link_down_count).range(0..=999))
                    .changed();
                ui.end_row();

                ui.label("Link last change (s, <0 = never)");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.link_last_change_secs).range(-1..=6000))
                    .changed();
                ui.end_row();

                ui.label("Rows");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.row_count).range(0..=11))
                    .changed();
                ui.end_row();

                ui.label("Stall ms (every other row)");
                changed |= ui
                    .add(egui::DragValue::new(&mut n.stall_ms).range(0..=600_000))
                    .changed();
                ui.end_row();
            });

        ui.horizontal(|ui| {
            ui.label("Buffer shape");
            for shape in BufferShape::ALL {
                changed |= ui
                    .selectable_value(&mut n.shape, shape, shape.label())
                    .changed();
            }
        });

        self.dirty |= changed;
    }
}

impl eframe::App for PreviewApp {
    // eframe 0.35 replaced `App::update(ctx)` with `App::ui(ui)`, handing the app a root `Ui` rather
    // than the bare context. Panels now nest into that `Ui` via `show_inside`; the overlay's own
    // floating `Area` still shows against the context, reached through `ui.ctx()`.
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.dirty = false;

        let now = Instant::now();
        let dt = (now - self.last_instant).as_secs_f64();
        self.last_instant = now;
        if self.knobs.auto_tick {
            self.tick_accum += dt;
            ctx.request_repaint();
        }

        ctx.set_pixels_per_point(self.knobs.pixels_per_point);
        self.ensure_backdrop(&ctx);

        let view = self.build_view();

        // The backdrop fills the whole window so it reads as a full game screen, and the overlay
        // (below) anchors to that full screen exactly as it does in-game.
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ui, |ui| {
                let rect = ui.max_rect();
                self.paint_backdrop(ui, rect);
                if view.is_empty() {
                    ui.painter().text(
                        rect.center(),
                        egui::Align2::CENTER_CENTER,
                        "All healthy — nothing to draw",
                        egui::FontId::proportional(20.0),
                        Color32::from_rgb(0x60, 0x66, 0x70),
                    );
                }
            });

        // The overlay draws itself as its own top-center Area in the `Foreground` layer, over the
        // full-window backdrop — the same anchoring it uses in-game.
        let clicked = render_disconnect_view(&view, &ctx).inner;
        if !clicked.is_empty() {
            self.last_clicked = clicked;
        }

        // The network-stats overlay anchors itself top-right, exactly as it does in-game.
        if self.knobs.netstat.show {
            let netstat_view = self.build_netstat_view();
            render_netstat_view(&netstat_view, &ctx);
        }

        // Float the knobs as a top-LEFT window in the same `Foreground` layer but drawn *after* the
        // overlays, so the controls always sit on top of (and take input ahead of) them where they
        // overlap. Anchored left (unlike the game, which has no knobs) so it doesn't hide the
        // top-right network-stats overlay it configures.
        egui::Window::new("Overlay preview knobs")
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::LEFT_TOP, vec2(8.0, 8.0))
            .resizable(true)
            .default_width(340.0)
            .show(&ctx, |ui| {
                egui::ScrollArea::vertical()
                    .max_height(ui.ctx().content_rect().height() - 48.0)
                    .show(ui, |ui| self.knobs_panel(ui));
            });

        if self.dirty {
            save_knobs(&self.knobs);
        }
    }

    // eframe 0.35's `on_exit` no longer receives a glow context (the default build renders through
    // wgpu, and the parameter was dropped from the trait).
    fn on_exit(&mut self) {
        save_knobs(&self.knobs);
    }
}
