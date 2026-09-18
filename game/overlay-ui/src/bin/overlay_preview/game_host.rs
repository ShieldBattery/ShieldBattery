//! The emulated game-side egui host.
//!
//! The injected DLL owns an `egui::Context` that is not the one any windowing toolkit drives: it
//! feeds it a `RawInput` it builds by hand, tessellates the result itself, uploads the texture
//! deltas into the renderer's own texture store, and draws the meshes into StarCraft's frame. This
//! type runs that same pipeline with the preview window standing in for StarCraft, so the preview
//! exercises the real input translation, texture lifetime and clip handling rather than eframe's.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use egui::TexturesDelta;
use egui::epaint::{ClippedPrimitive, Primitive};
use egui::{
    Context, CursorIcon, Event, Modifiers, PointerButton, Pos2, Rect, Shape, TextureId, Ui, Vec2,
    ViewportId,
};

use crate::virtual_screen::Blit;

/// What the game context is fed for one pass.
pub struct PassInput {
    /// The emulated screen size, in the game context's points.
    pub points: Vec2,
    pub pixels_per_point: f32,
    /// Seconds since the host started, which every egui animation advances against.
    pub time: f64,
    /// Already-translated events, from [`GameHost::translate_events`] or empty when headless.
    pub events: Vec<Event>,
    pub focused: bool,
    pub predicted_dt: f32,
}

/// What one pass of the game context produced.
pub struct PassOutput {
    pub primitives: Vec<ClippedPrimitive>,
    pub textures_delta: TexturesDelta,
    pub cursor_icon: CursorIcon,
    /// How long the game context is willing to wait before it needs painting again;
    /// [`Duration::MAX`] means "nothing is animating".
    pub repaint_delay: Duration,
    pub wants_pointer: bool,
    pub wants_keyboard: bool,
}

/// The faces the game installs beside its DLL, read here out of the checkout instead.
///
/// They are read once per process: every host wants the same megabytes, and an offline render
/// builds a fresh host for every image.
fn dynamic_fonts() -> &'static overlay_ui::DynamicFonts {
    static FONTS: OnceLock<overlay_ui::DynamicFonts> = OnceLock::new();
    FONTS.get_or_init(|| {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../files/fonts/dynamic");
        let fonts = overlay_ui::load_dynamic_fonts(&directory);
        if fonts.is_empty() {
            eprintln!(
                "overlay-preview: no dynamic fonts under {}; Korean falls back to the embedded                  face and Chinese will not render",
                directory.display()
            );
        }
        fonts
    })
}

/// An emulated game-side egui host: one context, its texture store, and its input state.
pub struct GameHost {
    ctx: Context,
    /// Game-side texture id to the host texture it was copied into.
    host_textures: HashMap<TextureId, TextureId>,
    /// Whether the emulated screen holds keyboard focus; see [`GameHost::translate_events`].
    focused: bool,
    /// Whether the last pointer event placed the pointer inside the emulated screen.
    pointer_inside: bool,
    /// Whether a primary press that started inside the emulated screen is still held, so the drag
    /// and its release keep reaching the game even once the pointer leaves.
    pointer_captured: bool,
    warned_callback: bool,
    warned_user_texture: bool,
    warned_orphan_patch: bool,
}

impl GameHost {
    pub fn new() -> GameHost {
        let ctx = Context::default();
        overlay_ui::install_fonts_and_style(&ctx, dynamic_fonts());
        GameHost {
            ctx,
            host_textures: HashMap::new(),
            focused: false,
            pointer_inside: false,
            pointer_captured: false,
            warned_callback: false,
            warned_user_texture: false,
            warned_orphan_patch: false,
        }
    }

    /// Whether the emulated screen currently holds keyboard focus.
    pub fn focused(&self) -> bool {
        self.focused
    }

    /// Runs one pass: builds the `RawInput`, lets `draw` paint into the game context, and
    /// tessellates the result at the game's own scale.
    pub fn run_pass(&mut self, input: PassInput, draw: impl FnOnce(&Context)) -> PassOutput {
        self.ctx.set_pixels_per_point(input.pixels_per_point);
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, input.points)),
            // BW does not guarantee that textures wider than this work; the limit belongs to the
            // game's renderer, so the emulated host applies it too.
            max_texture_side: Some(2048),
            time: Some(input.time),
            predicted_dt: input.predicted_dt,
            events: input.events,
            focused: input.focused,
            ..Default::default()
        };
        self.ctx.begin_pass(raw);
        draw(&self.ctx);
        let output = self.ctx.end_pass();
        let primitives = self.ctx.tessellate(output.shapes, output.pixels_per_point);
        let repaint_delay = output
            .viewport_output
            .get(&ViewportId::ROOT)
            .map_or(Duration::MAX, |viewport| viewport.repaint_delay);
        PassOutput {
            primitives,
            textures_delta: output.textures_delta,
            cursor_icon: output.platform_output.cursor_icon,
            repaint_delay,
            wants_pointer: self.ctx.egui_wants_pointer_input(),
            wants_keyboard: self.ctx.egui_wants_keyboard_input(),
        }
    }

    /// Translates the host window's own events for the game context.
    ///
    /// Pointer events reach the game while the pointer is over the emulated screen, and keep
    /// reaching it after it leaves as long as a primary press that started inside is still held, so
    /// a drag off the edge neither breaks nor leaves a button stuck down. Leaving without a held
    /// button sends a single `PointerGone`, which clears hover state.
    ///
    /// Keyboard, text and wheel events reach the game only while the emulated screen has focus,
    /// which it takes when a primary press lands inside it and loses when one lands outside. That
    /// is what keeps typing into a knob field out of the overlay. Clipboard and IME events are
    /// never forwarded, matching the DLL, which translates neither.
    pub fn translate_events(
        &mut self,
        host_events: &[Event],
        modifiers: Modifiers,
        blit: &Blit,
    ) -> Vec<Event> {
        let mut events = Vec::with_capacity(host_events.len() + 1);
        // The DLL restates the modifiers every pass rather than tracking key-up/key-down pairs, so
        // a modifier released while the game had no focus can never stick.
        events.push(Event::ModifiersChanged(modifiers));
        for event in host_events {
            match event {
                Event::PointerMoved(pos) => {
                    let inside = blit.viewport.contains(*pos);
                    if inside || self.pointer_captured {
                        self.pointer_inside = inside;
                        events.push(Event::PointerMoved(blit.to_game(*pos)));
                    } else if self.pointer_inside {
                        self.pointer_inside = false;
                        events.push(Event::PointerGone);
                    }
                }
                Event::PointerGone => {
                    self.pointer_inside = false;
                    self.pointer_captured = false;
                    events.push(Event::PointerGone);
                }
                Event::PointerButton {
                    pos,
                    button,
                    pressed,
                    modifiers,
                } => {
                    let inside = blit.viewport.contains(*pos);
                    if *button == PointerButton::Primary {
                        if *pressed {
                            self.focused = inside;
                            self.pointer_captured = inside;
                        } else {
                            self.pointer_captured = false;
                        }
                    }
                    // A release always goes through: dropping one would leave the game context
                    // convinced the button is still down.
                    if inside || !*pressed {
                        self.pointer_inside = inside;
                        events.push(Event::PointerButton {
                            pos: blit.to_game(*pos),
                            button: *button,
                            pressed: *pressed,
                            modifiers: *modifiers,
                        });
                    }
                }
                Event::Key { .. } | Event::Text(_) | Event::MouseWheel { .. } if self.focused => {
                    events.push(event.clone());
                }
                _ => {}
            }
        }
        events
    }

    /// Copies the pass's textures into the host context and paints its meshes into `blit`.
    ///
    /// Vertex positions and clip rects are transformed from the emulated screen's points into the
    /// host's, and clipped to the viewport so nothing the overlay draws can escape the emulated
    /// screen into the surrounding window.
    pub fn present(&mut self, ui: &Ui, blit: &Blit, output: &mut PassOutput) {
        self.apply_textures(ui.ctx(), &mut output.textures_delta);
        let painter = ui.painter();
        for primitive in output.primitives.drain(..) {
            let clip_rect = blit
                .rect_to_host(primitive.clip_rect)
                .intersect(blit.viewport);
            if !clip_rect.is_positive() {
                continue;
            }
            match primitive.primitive {
                Primitive::Mesh(mut mesh) => {
                    if mesh.is_empty() {
                        continue;
                    }
                    let Some(texture_id) = self.host_texture_id(mesh.texture_id) else {
                        continue;
                    };
                    mesh.texture_id = texture_id;
                    for vertex in &mut mesh.vertices {
                        vertex.pos = blit.to_host(vertex.pos);
                    }
                    painter.with_clip_rect(clip_rect).add(Shape::mesh(mesh));
                }
                Primitive::Callback(_) => {
                    if !self.warned_callback {
                        self.warned_callback = true;
                        eprintln!(
                            "overlay-preview: skipping a paint callback; the game's renderer has \
                             no equivalent, so overlays must not use them"
                        );
                    }
                }
            }
        }
    }

    fn apply_textures(&mut self, host_ctx: &Context, delta: &mut TexturesDelta) {
        let manager = host_ctx.tex_manager();
        let mut manager = manager.write();
        for (game_id, image_deltas) in delta.set.drain() {
            for image_delta in image_deltas {
                match self.host_textures.get(&game_id) {
                    Some(host_id) => manager.set(*host_id, image_delta),
                    None if image_delta.pos.is_none() => {
                        let host_id = manager.alloc(
                            format!("game {game_id:?}"),
                            image_delta.image,
                            image_delta.options,
                        );
                        self.host_textures.insert(game_id, host_id);
                    }
                    None => {
                        if !self.warned_orphan_patch {
                            self.warned_orphan_patch = true;
                            eprintln!(
                                "overlay-preview: dropping a partial update for unallocated \
                                 texture {game_id:?}"
                            );
                        }
                    }
                }
            }
        }
        for game_id in delta.free.drain() {
            if let Some(host_id) = self.host_textures.remove(&game_id) {
                manager.free(host_id);
            }
        }
    }

    fn host_texture_id(&mut self, game_id: TextureId) -> Option<TextureId> {
        match game_id {
            TextureId::Managed(_) => self.host_textures.get(&game_id).copied(),
            TextureId::User(_) => {
                // In the game these alias BW's own icon atlases, which the preview has no copy of.
                if !self.warned_user_texture {
                    self.warned_user_texture = true;
                    eprintln!(
                        "overlay-preview: skipping a mesh using game texture {game_id:?}; the \
                         preview has no BW texture store to alias"
                    );
                }
                None
            }
        }
    }
}
