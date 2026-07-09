//! Native preview host for the disconnect overlay.
//!
//! An eframe app that renders the extracted overlay (the exact widget code the game DLL uses) over a
//! configurable backdrop, with a knobs panel to emulate every state without launching StarCraft:
//! the number of disconnected players, per-row tier / elapsed seconds / drop flags, self-state, and
//! egui's pixels-per-point. Knobs persist to a JSON file next to the binary across restarts.
//!
//! `--smoke` renders a few frames of several states headlessly (no window) and exits 0, for CI-ish
//! verification that the extracted render path and font setup run on the host.

use std::path::PathBuf;
use std::time::Instant;

use egui::{Color32, Rect, pos2, vec2};
use overlay_ui::disconnect::{
    DisconnectRowView, DisconnectTier, DisconnectView, SelfState, render_disconnect_view,
};
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
        if self.last_clicked.is_empty() {
            ui.label("Last Drop click: (none)");
        } else {
            ui.label(format!("Last Drop click: slots {:?}", self.last_clicked));
        }
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

        // Float the knobs as a top-right window in the same `Foreground` layer but drawn *after* the
        // overlay, so the controls always sit on top of (and take input ahead of) the overlay where
        // the two overlap — the overlay centers on the full window, so it can otherwise slide under
        // a docked panel.
        egui::Window::new("Overlay preview knobs")
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::RIGHT_TOP, vec2(-8.0, 8.0))
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
