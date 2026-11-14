//! Draws a replay player's cursor and keeps the vision shown in step with the perspective being
//! followed. Their selection and click feedback are shown by the game itself, and the controls for
//! choosing a perspective are the shell's.

use egui::{Color32, Id, LayerId, Order, Rect, Stroke, TextureHandle, pos2, vec2};
use overlay_ui::observer::{PerspectiveChoice, PerspectiveView};

use crate::first_person;

use super::{BwVars, OverlayState};

/// A followed player's perspective for one drawn frame, in render target pixels.
#[derive(Clone)]
pub struct FirstPersonView {
    pub color: Color32,
    /// The game's cursor scale: its cursor graphics, made for a 1920 pixel tall window, are drawn
    /// this many window pixels per graphic pixel. It is the viewer's own cursor size setting where
    /// they have set one.
    pub cursor_scale: f32,
    /// Whether the viewer's game shrinks any cursor that comes out more than
    /// [`LEGACY_CURSOR_LIMIT`] pixels across to that size, as the game's own cursor sizing does.
    pub legacy_cursor_sizing: bool,
    /// The player's cursor, or `None` while it isn't on their game window (alt-tabbed, or outside
    /// the time their recording covers).
    pub cursor: Option<(f32, f32)>,
    pub cursor_type: u8,
    /// Corners of the selection box the player is dragging.
    pub drag_rect: Option<((f32, f32), (f32, f32))>,
    /// Corners of the player's own view, when it covers a different area than the viewer's.
    pub player_view: Option<((f32, f32), (f32, f32))>,
}

/// One perspective the replay recorded.
#[derive(Clone)]
pub struct RecordedPerspective {
    pub name: String,
    pub color: Color32,
    /// The player's id in the game, if they are one of its 8 players.
    pub player_id: Option<u8>,
}

/// The recorded perspectives of the replay being watched, as of one drawn frame.
pub struct PerspectiveFrame {
    /// Every perspective the replay recorded, in track order. Never empty.
    pub recorded: Vec<RecordedPerspective>,
    /// The followed perspective as it is drawn this frame, with the render target size its
    /// coordinates are in.
    pub view: Option<(FirstPersonView, (u32, u32))>,
}

impl PerspectiveFrame {
    /// What the shell's perspective controls show.
    pub(super) fn controls_view(&self) -> PerspectiveView {
        let status = first_person::perspective_status();
        PerspectiveView {
            choices: self
                .recorded
                .iter()
                .map(|perspective| PerspectiveChoice {
                    name: perspective.name.clone(),
                    color: perspective.color,
                })
                .collect(),
            shown: status.track,
            camera: status.show_camera,
            actions: status.show_actions,
            camera_returns: status.override_remaining,
        }
    }
}

impl OverlayState {
    /// Draws the followed player's perspective, `render_size` being the render target size the
    /// view's coordinates are in.
    pub(super) fn add_first_person_view(
        &mut self,
        view: &FirstPersonView,
        render_size: (u32, u32),
        ctx: &egui::Context,
    ) {
        if render_size.0 == 0 {
            return;
        }
        let scale = self.screen_size.0 as f32 / render_size.0 as f32;
        let to_egui = |(x, y): (f32, f32)| pos2(x * scale, y * scale);
        // Under every panel: the cursor is part of the game being watched, not of the controls
        // over it.
        let painter = ctx.layer_painter(LayerId::new(
            Order::Background,
            Id::new("first_person_view"),
        ));
        if let Some((start, end)) = view.player_view {
            let rect = egui::Rect::from_two_pos(to_egui(start), to_egui(end));
            painter.rect_stroke(
                rect,
                0.0,
                Stroke::new(1.0, view.color.gamma_multiply(0.6)),
                egui::StrokeKind::Inside,
            );
        }

        if let Some((start, end)) = view.drag_rect {
            let rect = egui::Rect::from_two_pos(to_egui(start), to_egui(end));
            painter.rect_stroke(
                rect,
                0.0,
                Stroke::new(1.0, view.color),
                egui::StrokeKind::Middle,
            );
        }

        if let Some(cursor) = view.cursor {
            let texture = self
                .first_person_cursors
                .get_or_insert_with(|| load_cursor_atlas(ctx))
                .id();
            let elapsed = self.start_time.elapsed().as_secs_f64();
            let sprite = CursorSprite::for_cursor_type(view.cursor_type, elapsed);
            // Each sprite is drawn at the size of the game's own cursor of its kind, so the
            // player's cursor is as big as the viewer's and follows the window size and the
            // viewer's cursor size setting the same way.
            let art_scale = sprite.art_scale(view.cursor_scale, view.legacy_cursor_sizing);
            let window_height = self.window_size.1.max(1) as f32;
            let points_per_pixel = self.screen_size.1 as f32 / window_height;
            let sprite_scale = art_scale / CURSOR_ATLAS_ART_SCALE * points_per_pixel;
            let size = CURSOR_CELL * sprite_scale;
            let top_left = to_egui(cursor) - sprite.hotspot() * sprite_scale;
            let rect = Rect::from_min_size(top_left, vec2(size, size));
            for layer in CursorLayer::ALL {
                let tint = match layer {
                    CursorLayer::Body => view.color,
                    CursorLayer::Under | CursorLayer::Over => Color32::WHITE,
                };
                painter.image(texture, rect, sprite.uv(layer), tint);
            }
        }
    }

    /// Shows the game with the vision of the player whose perspective is shown, the way they saw
    /// it, and puts back the vision the viewer had once no perspective is.
    pub(super) fn update_perspective_vision(
        &mut self,
        bw: &BwVars,
        recorded: &[RecordedPerspective],
    ) {
        let track = first_person::perspective_status().track;
        // Perspectives of players without an id in the game (observers) leave vision alone.
        let shown = track.and_then(|t| Some((t, recorded.get(t)?.player_id?)));
        if self.perspective_vision.map(|before| before.track) == shown.map(|(track, _)| track) {
            return;
        }
        let before = self.perspective_vision.take();
        match shown {
            Some((track, player_id)) => {
                // Going from one perspective to the next keeps what the viewer had before the
                // first of them.
                let (visions, show_entire_map) = match before {
                    Some(before) => (before.visions, before.show_entire_map),
                    None => (
                        self.out_state.replay_visions,
                        self.out_state.show_entire_map,
                    ),
                };
                self.out_state.replay_visions = unsafe { super::team_vision_mask(bw, player_id) };
                self.out_state.show_entire_map = false;
                self.perspective_vision = Some(VisionBeforePerspective {
                    track,
                    visions,
                    show_entire_map,
                });
            }
            None => {
                if let Some(before) = before {
                    self.out_state.replay_visions = before.visions;
                    self.out_state.show_entire_map = before.show_entire_map;
                }
            }
        }
    }
}

/// The vision the viewer had before a perspective's was shown in its place.
#[derive(Copy, Clone)]
pub(super) struct VisionBeforePerspective {
    /// The perspective whose player's vision is shown, as an index of the replay's tracks.
    track: usize,
    visions: u8,
    show_entire_map: bool,
}

/// The cursors drawn for the shown player, generated by `images/first-person-cursors.py`: a grid
/// of cells `CURSOR_CELL` pixels square, each sprite three consecutive cells (one per
/// [`CursorLayer`]).
static CURSOR_ATLAS: &[u8] = include_bytes!("images/first-person-cursors.png");
const CURSOR_ATLAS_COLUMNS: usize = 12;
const CURSOR_CELL: f32 = 128.0;
/// Atlas pixels per pixel of the game's cursor art, which the sprites are sized against: each
/// covers about what the game's own cursor of its kind does.
const CURSOR_ATLAS_ART_SCALE: f32 = 0.75;
/// Where an arrow sprite's tip is in its cell, in atlas pixels. Every other sprite points with
/// its cell's center.
const CURSOR_ARROW_TIP: f32 = 8.0;
/// The size the game's own sizing keeps cursors within, in window pixels: a cursor whose longer
/// side comes out longer is shrunk to it.
const LEGACY_CURSOR_LIMIT: f32 = 64.0;
/// Frames of the hover cursor's rotating arcs, and how long each shows.
const HOVER_FRAMES: usize = 12;
const HOVER_FRAME_SECS: f64 = 0.1;

fn load_cursor_atlas(ctx: &egui::Context) -> TextureHandle {
    let image = match image::load_from_memory(CURSOR_ATLAS) {
        Ok(image) => image.to_rgba8(),
        Err(e) => {
            error!("Couldn't decode the first-person cursor atlas: {e}");
            image::RgbaImage::new(1, 1)
        }
    };
    let size = [image.width() as usize, image.height() as usize];
    let image = egui::ColorImage::from_rgba_unmultiplied(size, image.as_raw());
    ctx.load_texture("first_person_cursors", image, egui::TextureOptions::LINEAR)
}

/// The layers each cursor sprite is drawn in, bottom to top.
#[derive(Copy, Clone)]
enum CursorLayer {
    /// The dark outline.
    Under,
    /// Shapes tinted to the player's color.
    Body,
    /// Highlights, and colors that mean something (green, yellow and red for the player's own,
    /// neutral and enemy units), which aren't tinted.
    Over,
}

impl CursorLayer {
    const ALL: [CursorLayer; 3] = [CursorLayer::Under, CursorLayer::Body, CursorLayer::Over];
}

/// A sprite of the cursor atlas, by its position in the generator's order.
#[derive(Copy, Clone)]
struct CursorSprite(usize);

impl CursorSprite {
    const ARROW: usize = 0;
    const ILLEGAL: usize = 1;
    const TARGET: usize = 2;
    const HOVER: usize = 5;
    const DRAG: usize = Self::HOVER + 3 * HOVER_FRAMES;
    const SCROLL: usize = Self::DRAG + 1;

    /// The sprite showing a game cursor type (see `BwCursorType`), `elapsed_secs` into the hover
    /// animation.
    fn for_cursor_type(cursor_type: u8, elapsed_secs: f64) -> CursorSprite {
        // Relations in the order the atlas has them: own, neutral, enemy.
        let hover_frame = (elapsed_secs / HOVER_FRAME_SECS) as usize % HOVER_FRAMES;
        let hover = |relation: usize| Self::HOVER + relation * HOVER_FRAMES + hover_frame;
        CursorSprite(match cursor_type {
            1 => Self::ILLEGAL,
            4 => Self::TARGET,
            2 | 5 => Self::TARGET + 1,
            3 => Self::TARGET + 2,
            6 => hover(0),
            8 => hover(1),
            7 => hover(2),
            9 => Self::DRAG,
            11..=18 => Self::SCROLL + (cursor_type - 11) as usize,
            _ => Self::ARROW,
        })
    }

    /// Where the cursor points, from the sprite's top-left, in atlas pixels.
    fn hotspot(self) -> egui::Vec2 {
        match self.0 {
            Self::ARROW | Self::ILLEGAL => vec2(CURSOR_ARROW_TIP, CURSOR_ARROW_TIP),
            _ => vec2(CURSOR_CELL / 2.0, CURSOR_CELL / 2.0),
        }
    }

    /// Window pixels per pixel of the game's cursor art that the game draws its own cursor of
    /// this sprite's kind at: `cursor_scale`, less whatever `legacy_sizing` takes to keep the
    /// cursor within [`LEGACY_CURSOR_LIMIT`].
    fn art_scale(self, cursor_scale: f32, legacy_sizing: bool) -> f32 {
        if legacy_sizing {
            cursor_scale.min(LEGACY_CURSOR_LIMIT / self.game_art_extent())
        } else {
            cursor_scale
        }
    }

    /// The longer side of the game's own cursor of this sprite's kind, in pixels of its art.
    fn game_art_extent(self) -> f32 {
        match self.0 {
            Self::ARROW => 80.0,
            Self::ILLEGAL => 114.0,
            Self::TARGET..Self::HOVER => 108.0,
            Self::HOVER..Self::DRAG => 164.0,
            Self::DRAG => 88.0,
            // Up, right, down and left are the even ones, and longer than the diagonals.
            scroll if (scroll - Self::SCROLL).is_multiple_of(2) => 142.0,
            _ => 104.0,
        }
    }

    fn uv(self, layer: CursorLayer) -> Rect {
        let cell = self.0 * 3 + layer as usize;
        let rows = (CURSOR_SPRITE_COUNT * 3).div_ceil(CURSOR_ATLAS_COLUMNS);
        let (w, h) = (1.0 / CURSOR_ATLAS_COLUMNS as f32, 1.0 / rows as f32);
        let x = (cell % CURSOR_ATLAS_COLUMNS) as f32 * w;
        let y = (cell / CURSOR_ATLAS_COLUMNS) as f32 * h;
        Rect::from_min_size(pos2(x, y), vec2(w, h))
    }
}

/// Sprites in the atlas: arrow, illegal, three targets, three hover animations, drag and eight
/// scroll directions.
const CURSOR_SPRITE_COUNT: usize = CursorSprite::SCROLL + 8;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn cursor_atlas_matches_sprite_layout() {
        let atlas = image::load_from_memory(CURSOR_ATLAS).unwrap();
        let cell = CURSOR_CELL as u32;
        let rows = (CURSOR_SPRITE_COUNT * 3).div_ceil(CURSOR_ATLAS_COLUMNS) as u32;
        assert_eq!(atlas.width(), CURSOR_ATLAS_COLUMNS as u32 * cell);
        assert_eq!(atlas.height(), rows * cell);
    }

    #[test]
    fn legacy_sizing_shrinks_only_the_cursors_past_its_limit() {
        let arrow = CursorSprite(CursorSprite::ARROW);
        let hover = CursorSprite(CursorSprite::HOVER + 3);
        let scroll_up = CursorSprite(CursorSprite::SCROLL);
        let scroll_up_right = CursorSprite(CursorSprite::SCROLL + 1);
        // At this scale the arrow comes out 37.5 pixels long, the hover cursor 77 across.
        let scale = 0.46875;
        assert_eq!(arrow.art_scale(scale, true), scale);
        assert_eq!(hover.art_scale(scale, true), 64.0 / 164.0);
        assert_eq!(hover.art_scale(scale, false), scale);
        // Every cursor is past the limit at full size, each by its own measure.
        assert_eq!(arrow.art_scale(1.0, true), 64.0 / 80.0);
        assert_eq!(scroll_up.art_scale(1.0, true), 64.0 / 142.0);
        assert_eq!(scroll_up_right.art_scale(1.0, true), 64.0 / 104.0);
        assert_eq!(arrow.art_scale(1.0, false), 1.0);
    }
}
