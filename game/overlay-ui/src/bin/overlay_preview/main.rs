//! Native preview host for the in-game overlays.
//!
//! The injected game DLL does not hand its overlays to a windowing toolkit: it owns an
//! `egui::Context` of its own, feeds it hand-built input, tessellates it and draws the meshes into
//! StarCraft's frame. This host does the same, with a window standing in for StarCraft — the
//! overlay runs in its own context at the game's scale, and the result is blitted into a viewport
//! rect inside an ordinary eframe app. So the preview exercises the pipeline the game uses, and the
//! knob panel beside it is a plain side panel at the OS scale that can never overlap the overlay.
//!
//! Knobs persist to a JSON file next to the binary across restarts.

mod game_host;
mod host_knobs;
mod knobs;
mod raster;
mod scenarios;
mod virtual_screen;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{Align2, Color32, Event, FontId, Rect, Vec2, pos2};
use image::RgbaImage;
use overlay_ui::i18n::{self, Locale};
use overlay_ui::shell::{InputCapture, KeyboardCapture, ModalId, PointerCapture, Shell};

use crate::game_host::{GameHost, PassInput};
use crate::knobs::{Backdrop, Knobs};
use crate::raster::TextureStore;
use crate::virtual_screen::{Blit, ResolutionPreset, ScaleMode, VirtualScreen};

/// Where frames of real gameplay live, so an overlay is previewed over the scene it has to stay
/// readable on: any 16:9 screenshot in the crate's `backdrops/` directory (see the README there),
/// stretched to whatever the emulated screen is. Read from disk at startup rather than embedded,
/// so a capture can be swapped without a rebuild; an empty directory simply falls back to the
/// solid fill.
const BACKDROP_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/backdrops");

/// The gameplay capture in use: the first `.png` in the backdrop directory by name, so a capture
/// is picked without the code naming it and a second one can take over by sorting earlier.
fn gameplay_backdrop_path() -> std::io::Result<PathBuf> {
    let mut pngs: Vec<PathBuf> = std::fs::read_dir(BACKDROP_DIR)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        })
        .collect();
    pngs.sort();
    pngs.into_iter().next().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("no .png in {BACKDROP_DIR}"),
        )
    })
}

/// What an emulated screen shows where no backdrop covers it, so a transparent-edged image or no
/// image at all still reads as a game scene rather than as the window's own fill.
const EMPTY_SCREEN_FILL: Color32 = Color32::from_rgb(0x10, 0x14, 0x1c);

/// The fill around a letterboxed emulated screen, dark enough to read as "not the game".
const LETTERBOX_FILL: Color32 = Color32::from_rgb(0x08, 0x0a, 0x0e);

/// The hairline marking where the emulated screen ends.
const VIEWPORT_EDGE: Color32 = Color32::from_rgb(0x35, 0x3d, 0x45);

/// The resolutions every scenario preset is rendered at offline: the smallest and the reference
/// 16:9 screens, the common windowed one between them, 1440p, where the overlay is drawn at a third
/// more pixels than points, and the 4:3 screen SD graphics give the game.
const RENDER_SIZES: [ResolutionPreset; 5] = [
    ResolutionPreset::R1280x720,
    ResolutionPreset::R1600x900,
    ResolutionPreset::R1920x1080,
    ResolutionPreset::R2560x1440,
    ResolutionPreset::R1280x960,
];

/// The resolutions the stills of an entrance are rendered at: the reference screen, and 1440p,
/// where anything drawn in fractions of a pixel shows it.
const TIMELINE_SIZES: [ResolutionPreset; 2] =
    [ResolutionPreset::R1920x1080, ResolutionPreset::R2560x1440];

/// How many passes an offline render runs before keeping one, and how far its clock has run by the
/// last of them. egui settles a freshly built context over several passes: auto-sized areas learn
/// their size, the font atlas grows to hold the glyphs that were asked for, and a newly shown area
/// fades in over the style's animation time — which only finishes if the clock moves. A first pass
/// is never what the game would show.
const SETTLE_PASSES: usize = 4;
const SETTLE_SECS: f64 = 0.75;

/// Parsed command line.
struct Args {
    smoke: bool,
    backdrop: Option<String>,
    render_dir: Option<PathBuf>,
    /// A language to render the translated screens in, instead of every preset in English.
    lang: Option<Locale>,
    /// How offline renders blend: egui's way, or the game's.
    blending: raster::Blending,
    /// Only the offline renders whose file name contains this, for looking at one screen without
    /// waiting on all of them.
    only: Option<String>,
}

fn parse_args() -> Args {
    let mut args = Args {
        smoke: false,
        backdrop: None,
        render_dir: None,
        lang: None,
        blending: raster::Blending::Premultiplied,
        only: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--smoke" => args.smoke = true,
            "--backdrop" => args.backdrop = it.next(),
            "--render" => args.render_dir = it.next().map(PathBuf::from),
            "--game-blending" => args.blending = raster::Blending::Straight,
            "--only" => args.only = it.next(),
            "--lang" => match it.next().as_deref().and_then(Locale::from_tag) {
                Some(locale) => args.lang = Some(locale),
                None => {
                    eprintln!("overlay-preview: --lang takes a language tag we have strings for")
                }
            },
            other => eprintln!("overlay-preview: ignoring unknown argument `{other}`"),
        }
    }
    args
}

fn main() -> eframe::Result<()> {
    let args = parse_args();
    // Offline there are no persisted knobs, so the command line alone decides what is behind the
    // overlay, and the shipped gameplay frame is what it decides by default.
    let backdrop = load_backdrop(
        &args
            .backdrop
            .clone()
            .map_or(Backdrop::default(), Backdrop::File),
    );

    if let Some(dir) = &args.render_dir {
        match render_all(
            dir,
            backdrop.as_ref(),
            args.lang,
            args.blending,
            args.only.as_deref(),
        ) {
            Ok(paths) => {
                for path in paths {
                    println!("{}", path.display());
                }
                std::process::exit(0);
            }
            Err(err) => {
                eprintln!("overlay-preview: render failed: {err}");
                std::process::exit(1);
            }
        }
    }

    if args.smoke {
        let dir = std::env::temp_dir().join("overlay-preview-smoke");
        match render_all(&dir, backdrop.as_ref(), None, args.blending, None) {
            Ok(paths) => {
                println!(
                    "overlay-preview smoke: OK ({} images under {})",
                    paths.len(),
                    dir.display()
                );
                std::process::exit(0);
            }
            Err(err) => {
                eprintln!("overlay-preview smoke: FAILED: {err}");
                std::process::exit(1);
            }
        }
    }

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1600.0, 900.0])
            .with_title("ShieldBattery Overlay Preview"),
        ..Default::default()
    };
    eframe::run_native(
        "ShieldBattery Overlay Preview",
        native_options,
        Box::new(move |cc| Ok(Box::new(PreviewApp::new(&cc.egui_ctx, args)))),
    )
}

/// Decodes what a backdrop knob asks for, or nothing at all when it asks for a plain fill.
fn load_backdrop(backdrop: &Backdrop) -> Option<RgbaImage> {
    match decode_backdrop(backdrop) {
        Ok(image) => image,
        Err(err) => {
            eprintln!(
                "overlay-preview: could not read {} ({err}); falling back to a solid fill",
                backdrop.describe()
            );
            None
        }
    }
}

fn decode_backdrop(backdrop: &Backdrop) -> Result<Option<RgbaImage>, image::ImageError> {
    match backdrop {
        Backdrop::SolidDark => Ok(None),
        Backdrop::Gameplay => Ok(Some(image::open(gameplay_backdrop_path()?)?.to_rgba8())),
        Backdrop::File(path) => Ok(Some(image::open(path)?.to_rgba8())),
    }
}

/// One offline render: a scenario preset, whether it is rendered in the pseudolocale, and the
/// moment of its entrance it is held at, or `None` for the preset at rest.
struct RenderCase {
    preset: scenarios::Preset,
    pseudolocale: bool,
    moment: Option<f64>,
}

impl RenderCase {
    fn at_rest(preset: scenarios::Preset, pseudolocale: bool) -> RenderCase {
        RenderCase {
            preset,
            pseudolocale,
            moment: None,
        }
    }

    /// What the clock reads on the render's last pass, the one that is kept.
    fn final_secs(&self) -> f64 {
        self.moment
            .or(self.preset.settle_secs())
            .unwrap_or(SETTLE_SECS)
    }

    fn sizes(&self) -> &'static [ResolutionPreset] {
        match self.moment {
            Some(_) => &TIMELINE_SIZES,
            None => &RENDER_SIZES,
        }
    }
}

/// The renders for one real language: every screen drawn from translated strings, which is the set
/// the pseudolocale pass checks against long text, checked against what translators actually wrote.
fn language_cases() -> Vec<RenderCase> {
    scenarios::PSEUDOLOCALE_PRESETS
        .map(|preset| RenderCase::at_rest(preset, false))
        .into()
}

/// Every offline render, in file order: each preset in English, with stills of its entrance if it
/// has one worth reviewing, then one pseudolocale pass per screen that is drawn from translated
/// strings. The pseudolocale pass is what proves a layout survives text a third longer than the
/// English it was designed against.
fn render_cases() -> Vec<RenderCase> {
    let mut cases = Vec::new();
    for preset in scenarios::all_presets() {
        cases.push(RenderCase::at_rest(preset, false));
        cases.extend(preset.timeline().iter().map(|&moment| RenderCase {
            preset,
            pseudolocale: false,
            moment: Some(moment),
        }));
    }
    cases.extend(scenarios::PSEUDOLOCALE_PRESETS.map(|preset| RenderCase::at_rest(preset, true)));
    cases
}

/// Points the overlay's translations at what the knobs ask for. Applied before every pass, since
/// both settings are process-wide state the render fns read as they lay their strings out.
fn apply_language(knobs: &Knobs) {
    i18n::set_locale(knobs.language);
    i18n::set_pseudolocale(knobs.pseudolocale);
}

/// The move that puts the pinned pointer where the knob asks for it, or on the control it names as
/// `ctx` last drew it, or nothing while neither is set.
///
/// egui learns where the pointer is from events alone, so this is fed to every pass rather than to
/// the first: a context told once and then left alone still knows, but one pass is all an offline
/// render would have to lose to a settle that starts from scratch.
fn pinned_pointer_event(knobs: &Knobs, ctx: &egui::Context) -> Option<Event> {
    let pinned = knobs.host.pointer.map(|(x, y)| pos2(x, y));
    pinned
        .or_else(|| knobs.host.pointer_on.and_then(|target| target.resolve(ctx)))
        .map(Event::PointerMoved)
}

/// Renders every scenario preset at every offline resolution into `dir`, returning what it wrote.
/// `only` keeps the renders whose file name contains it.
fn render_all(
    dir: &Path,
    backdrop: Option<&RgbaImage>,
    lang: Option<Locale>,
    blending: raster::Blending,
    only: Option<&str>,
) -> std::io::Result<Vec<PathBuf>> {
    std::fs::create_dir_all(dir)?;
    let mut written = Vec::new();
    let cases = match lang {
        Some(_) => language_cases(),
        None => render_cases(),
    };
    for case in cases {
        for &resolution in case.sizes() {
            let mut knobs = Knobs::default();
            case.preset.apply(&mut knobs);
            knobs.pseudolocale = case.pseudolocale;
            if let Some(lang) = lang {
                knobs.language = lang;
            }
            apply_language(&knobs);
            // Offline there is no window to match, so the preset's own pixels set the scale.
            let screen = VirtualScreen::resolve(
                resolution,
                ScaleMode::EmulateResolution,
                knobs.screen.compact_ramp,
                0.0,
            );

            let mut host = GameHost::new();
            let mut state = scenarios::UiState::new(&knobs);
            let mut shell = Shell::new();
            shell.set_panel_prefs(knobs.host.panels);
            let mut textures = TextureStore::new();
            let mut primitives = Vec::new();
            let width = screen.physical.x.round() as u32;
            let height = screen.physical.y.round() as u32;
            let path = dir.join(format!(
                "{}-{}{}{}{}-{}x{}.png",
                case.preset.kind().slug(),
                case.preset.label(),
                case.moment
                    .map(|moment| format!("-t{moment:.2}"))
                    .unwrap_or_default(),
                if case.pseudolocale { "-pseudo" } else { "" },
                lang.map(|lang| format!("-{}", lang.tag()))
                    .unwrap_or_default(),
                width,
                height
            ));
            if only.is_some_and(|only| {
                !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(only))
            }) {
                continue;
            }
            for pass in 0..SETTLE_PASSES {
                // Evenly spaced up to the moment being rendered, so the kept pass is exactly that
                // far after whatever was shown on the first.
                let time = case.final_secs() * pass as f64 / (SETTLE_PASSES - 1) as f64;
                let mut output = host.run_pass(
                    PassInput {
                        points: screen.points,
                        pixels_per_point: screen.pixels_per_point,
                        time,
                        events: pinned_pointer_event(&knobs, host.ctx())
                            .into_iter()
                            .collect(),
                        // The game's window has focus while the overlay is drawn over it, and a
                        // dialog's lit control only shows in a window that has.
                        focused: true,
                        predicted_dt: 1.0 / 60.0,
                    },
                    |ctx| {
                        scenarios::render(&knobs, &mut state, time, ctx, &mut shell);
                    },
                );
                textures.apply(&mut output.textures_delta);
                primitives = output.primitives;
            }

            let image = raster::rasterize(
                &primitives,
                &textures,
                [width, height],
                screen.pixels_per_point,
                backdrop,
                blending,
            );
            image
                .save(&path)
                .map_err(|err| std::io::Error::other(format!("{}: {err}", path.display())))?;
            written.push(path);
        }
    }
    Ok(written)
}

/// What the last frame's pass reported, for the status line under the viewport.
struct Status {
    pixels_per_point: f32,
    points: Vec2,
    blit_scale: f32,
    wants_pointer: bool,
    wants_keyboard: bool,
    capture: InputCapture,
    top_modal: Option<ModalId>,
}

struct PreviewApp {
    knobs: Knobs,
    scenario_ui: scenarios::UiState,
    host: GameHost,
    /// The same state machine the game DLL drives, fed the emulated host's state and the window's
    /// own keypresses.
    shell: Shell,
    start: Instant,
    /// Whether a knob changed this frame and the file should be rewritten at frame end.
    dirty: bool,
    /// Cached backdrop texture, keyed by the knob it was decoded from.
    backdrop: Option<(Backdrop, egui::TextureHandle)>,
    /// Last backdrop-load error, shown in the panel.
    backdrop_error: Option<String>,
    status: Option<Status>,
    /// The overlay clock's reading on the pass the end-of-game screen came up, while it is up.
    end_card_shown_at: Option<f64>,
}

impl PreviewApp {
    fn new(ctx: &egui::Context, args: Args) -> PreviewApp {
        let mut knobs = knobs::load();
        if let Some(path) = args.backdrop {
            knobs.backdrop = Backdrop::File(path);
        }
        let scenario_ui = scenarios::UiState::new(&knobs);
        let mut shell = Shell::new();
        shell.set_panel_prefs(knobs.host.panels);
        // The host's own widgets are ordinary desktop chrome, so they keep egui's default look; only
        // the game context gets the overlay's fonts and style.
        ctx.all_styles_mut(|style| style.interaction.selectable_labels = false);
        PreviewApp {
            knobs,
            scenario_ui,
            host: GameHost::new(),
            shell,
            start: Instant::now(),
            dirty: false,
            backdrop: None,
            backdrop_error: None,
            status: None,
            end_card_shown_at: None,
        }
    }

    fn ensure_backdrop(&mut self, ctx: &egui::Context) {
        let wanted = self.knobs.backdrop.clone();
        if self.backdrop.as_ref().map(|(knob, _)| knob) == Some(&wanted) {
            return;
        }
        match decode_backdrop(&wanted) {
            Ok(None) => {
                self.backdrop = None;
                self.backdrop_error = None;
            }
            Ok(Some(rgba)) => {
                let (w, h) = rgba.dimensions();
                let color =
                    egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &rgba);
                let texture = ctx.load_texture("backdrop", color, egui::TextureOptions::LINEAR);
                self.backdrop = Some((wanted, texture));
                self.backdrop_error = None;
            }
            Err(err) => {
                self.backdrop = None;
                self.backdrop_error = Some(format!("{err}"));
            }
        }
    }

    /// Runs one pass of the emulated game host and blits it into the central panel.
    fn draw_emulated_screen(&mut self, ui: &mut egui::Ui) {
        let full = ui.max_rect();
        let status_height = 20.0;
        let available = Rect::from_min_max(
            full.min,
            pos2(full.max.x, (full.max.y - status_height).max(full.min.y)),
        )
        .shrink(8.0);
        ui.painter().rect_filled(full, 0.0, LETTERBOX_FILL);
        if !available.is_positive() {
            return;
        }

        let screen_knobs = self.knobs.screen;
        let viewport = virtual_screen::fit_aspect(available, screen_knobs.preset.aspect());
        let host_pixels_per_point = ui.ctx().pixels_per_point();
        let screen = VirtualScreen::resolve(
            screen_knobs.preset,
            screen_knobs.scale_mode,
            screen_knobs.compact_ramp,
            viewport.height() * host_pixels_per_point,
        );
        let blit = Blit::new(viewport, screen.points);

        let (host_events, modifiers, predicted_dt, window_focused) = ui.ctx().input(|input| {
            (
                input.events.clone(),
                input.modifiers,
                input.predicted_dt,
                input.focused,
            )
        });
        let events = self.host.translate_events(&host_events, modifiers, &blit);
        let mut events = self.offer_keys_to_shell(events);
        // Last move of the pass wins, so a pinned pointer appended here overrides the window's own
        // wherever it happens to be, including the `PointerGone` it sends on its way off the
        // emulated screen.
        events.extend(pinned_pointer_event(&self.knobs, self.host.ctx()));
        apply_language(&self.knobs);
        // Holding the end-of-game screen's entrance holds the overlay's whole clock at that moment
        // after the screen came up: its stages are all read off that clock, and nothing else on the
        // shell's screen moves with it.
        let elapsed = match (self.end_card_shown_at, self.knobs.shell.end_card_moment) {
            (Some(shown_at), Some(moment)) => shown_at + f64::from(moment),
            _ => self.start.elapsed().as_secs_f64(),
        };
        let knobs = &self.knobs;
        let scenario_state = &mut self.scenario_ui;
        let shell = &mut self.shell;
        let mut outcome = scenarios::Outcome::default();
        let mut output = self.host.run_pass(
            PassInput {
                points: screen.points,
                pixels_per_point: screen.pixels_per_point,
                time: elapsed,
                events,
                focused: window_focused && self.host.focused(),
                predicted_dt,
            },
            |ctx| {
                outcome = scenarios::render(knobs, scenario_state, elapsed, ctx, shell);
            },
        );
        let end_card_up = outcome.top_modal.and_then(ModalId::game_result).is_some();
        self.end_card_shown_at = end_card_up.then(|| self.end_card_shown_at.unwrap_or(elapsed));
        self.scenario_ui.disconnect.note_clicks(
            outcome.disconnect_clicks,
            outcome.abandoned,
            outcome.left,
        );
        // Closing a replacement closes the dialog it stands in for. The game DLL drives the real
        // dialog's return control; here the switch that stands in for it is what gets flipped.
        for dialog in &outcome.close_native_dialogs {
            self.knobs.host.set_spawned(*dialog, false);
            self.dirty = true;
        }
        if outcome.open_game_menu {
            self.knobs.host.game_menu_spawned = true;
            self.dirty = true;
        }
        // Hotkeys move the panel prefs, and where they leave them is what persists.
        let prefs = *self.shell.panel_prefs();
        if prefs != self.knobs.host.panels {
            self.knobs.host.panels = prefs;
            self.dirty = true;
        }

        self.paint_backdrop(ui, viewport);
        self.host.present(ui, &blit, &mut output);
        if self.knobs.show_guides {
            virtual_screen::paint_reserve_guides(ui.painter(), viewport);
        }
        if self.knobs.host.show_hit_rects {
            // Drawn by the window rather than by the overlay, the way the guides are: these are what
            // the shell reported, not something it put on screen.
            virtual_screen::paint_hit_rects(ui.painter(), &blit, &outcome.hit_rects);
        }
        // An edge on the emulated screen, so where it ends and the letterbox begins is readable even
        // when the overlay is anchored nowhere near a corner.
        ui.painter().rect_stroke(
            viewport,
            0.0,
            egui::Stroke::new(1.0, VIEWPORT_EDGE),
            egui::StrokeKind::Outside,
        );

        if ui
            .ctx()
            .pointer_latest_pos()
            .is_some_and(|pos| viewport.contains(pos))
        {
            ui.ctx().set_cursor_icon(output.cursor_icon);
        }
        if output.repaint_delay < Duration::MAX {
            ui.ctx().request_repaint_after(output.repaint_delay);
        }
        // Live counters change because the host feeds new numbers in, which the game context has no
        // way to predict, so the host has to keep asking for frames itself.
        if scenarios::is_live(&self.knobs) {
            ui.ctx().request_repaint();
        }

        self.status = Some(Status {
            pixels_per_point: screen.pixels_per_point,
            points: screen.points,
            blit_scale: blit.scale,
            wants_pointer: output.wants_pointer,
            wants_keyboard: output.wants_keyboard,
            capture: outcome.capture,
            top_modal: outcome.top_modal,
        });
        self.paint_status(ui, full, status_height);
    }

    fn paint_backdrop(&self, ui: &egui::Ui, viewport: Rect) {
        let painter = ui.painter();
        painter.rect_filled(viewport, 0.0, EMPTY_SCREEN_FILL);
        if let Some((_, texture)) = &self.backdrop {
            painter.image(
                texture.id(),
                viewport,
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                Color32::WHITE,
            );
        }
    }

    fn paint_status(&self, ui: &egui::Ui, full: Rect, status_height: f32) {
        let Some(status) = &self.status else {
            return;
        };
        let text = format!(
            "{} {} | ppp {:.3} | {:.0}x{:.0} pt | blit x{:.3} | wants pointer {} | wants keyboard \
             {} | capture {}/{} | modal {}",
            self.knobs.screen.preset.label(),
            self.knobs.screen.scale_mode.label(),
            status.pixels_per_point,
            status.points.x,
            status.points.y,
            status.blit_scale,
            status.wants_pointer,
            status.wants_keyboard,
            match status.capture.pointer {
                PointerCapture::HitRects => "hit rects",
                PointerCapture::All => "all",
            },
            match status.capture.keyboard {
                KeyboardCapture::Selective => "selective",
                KeyboardCapture::All { chat: true } => "all but chat",
                KeyboardCapture::All { chat: false } => "all",
            },
            status.top_modal.map_or("none", ModalId::label),
        );
        ui.painter().text(
            pos2(full.left() + 10.0, full.bottom() - status_height * 0.5),
            Align2::LEFT_CENTER,
            text,
            FontId::proportional(12.0),
            Color32::from_rgb(0x91, 0x98, 0xa1),
        );
    }

    fn knobs_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("Overlay preview");
        ui.label("The overlay runs in its own context at the game's scale; these knobs stand in for the live game state that feeds it.");

        ui.add_space(8.0);
        ui.separator();
        ui.strong("Emulated screen");
        let screen = &mut self.knobs.screen;
        let mut changed = false;
        egui::ComboBox::from_label("resolution")
            .selected_text(screen.preset.label())
            .show_ui(ui, |ui| {
                for preset in ResolutionPreset::ALL {
                    changed |= ui
                        .selectable_value(&mut screen.preset, preset, preset.label())
                        .changed();
                }
            });
        for mode in ScaleMode::ALL {
            let response = ui
                .radio_value(&mut screen.scale_mode, mode, mode.label())
                .on_hover_text(mode.description());
            changed |= response.changed();
        }
        changed |= ui
            .checkbox(&mut screen.compact_ramp, "compact ramp (scale / 1.25)")
            .changed();
        changed |= ui
            .checkbox(&mut self.knobs.show_guides, "show reserve guides")
            .changed();
        self.dirty |= changed;

        ui.add_space(8.0);
        ui.label("Backdrop:");
        let mut file_path = match &self.knobs.backdrop {
            Backdrop::File(path) => path.clone(),
            _ => String::new(),
        };
        ui.horizontal_wrapped(|ui| {
            for (backdrop, label) in [
                (Backdrop::Gameplay, "gameplay"),
                (Backdrop::SolidDark, "solid dark"),
            ] {
                if ui
                    .selectable_label(self.knobs.backdrop == backdrop, label)
                    .clicked()
                {
                    self.knobs.backdrop = backdrop;
                    self.dirty = true;
                }
            }
            if ui
                .selectable_label(matches!(self.knobs.backdrop, Backdrop::File(_)), "PNG file")
                .clicked()
            {
                self.knobs.backdrop = Backdrop::File(file_path.clone());
                self.dirty = true;
            }
        });
        if matches!(self.knobs.backdrop, Backdrop::File(_))
            && ui.text_edit_singleline(&mut file_path).changed()
        {
            self.knobs.backdrop = Backdrop::File(file_path);
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
        ui.strong("Language");
        let mut changed = false;
        egui::ComboBox::from_label("language")
            .selected_text(self.knobs.language.tag())
            .show_ui(ui, |ui| {
                for locale in Locale::ALL {
                    changed |= ui
                        .selectable_value(&mut self.knobs.language, locale, locale.tag())
                        .changed();
                }
            });
        changed |= ui
            .checkbox(&mut self.knobs.pseudolocale, "pseudolocale")
            .on_hover_text(
                "Accents, brackets and pads every string to ~135% of its English length, so a                  layout is judged against long text before translators see it.",
            )
            .changed();
        self.dirty |= changed;

        ui.add_space(8.0);
        ui.separator();
        ui.strong("Emulated host");
        self.dirty |= host_knobs::knobs_ui(&mut self.knobs.host, &mut self.shell, ui);

        ui.add_space(8.0);
        ui.separator();
        ui.strong("Scenario");
        self.dirty |= scenarios::knobs_ui(&mut self.knobs, &mut self.scenario_ui, ui);
    }

    /// Gives the shell its turn at a keypress before the overlay's context sees it, the way the game
    /// DLL's window proc does: a key a focused widget wants goes through untouched, and otherwise
    /// the shell takes whatever it can act on and the rest reaches the emulated game.
    fn offer_keys_to_shell(&mut self, events: Vec<Event>) -> Vec<Event> {
        if self
            .status
            .as_ref()
            .is_some_and(|status| status.wants_keyboard)
        {
            return events;
        }
        let shell = &mut self.shell;
        events
            .into_iter()
            .filter(|event| match event {
                Event::Key {
                    key,
                    pressed: true,
                    modifiers,
                    ..
                } => !shell.key_pressed(*key, *modifiers),
                _ => true,
            })
            .collect()
    }
}

impl eframe::App for PreviewApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.dirty = false;
        let ctx = ui.ctx().clone();
        self.ensure_backdrop(&ctx);

        egui::Panel::left("knobs")
            .resizable(true)
            .default_size(360.0)
            .show(ui, |ui| {
                egui::ScrollArea::vertical().show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    self.knobs_panel(ui);
                });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ui, |ui| self.draw_emulated_screen(ui));

        if self.dirty {
            knobs::save(&self.knobs);
        }
    }

    fn on_exit(&mut self) {
        knobs::save(&self.knobs);
    }
}
