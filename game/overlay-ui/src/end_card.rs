//! The screen a player gets when their game is decided, standing in for SC:R's victory and defeat
//! popups.
//!
//! It is the game's one hero moment for a player rather than a watcher, so it is staged as the end
//! of a match rather than drawn as a dialog: the game recedes into the dark, the result lands as
//! one word across a banner the width of the screen, the record of the player's own game follows
//! it, and the two things there are to do next come last. Everything here is a pure fn of plain
//! data plus an [`egui::Context`], so the same code renders in the injected game DLL and in the host
//! preview.
//!
//! The whole entrance runs off one clock, the seconds since the screen first appeared, cut into
//! [`Beat`]s by a [`Timeline`]: every stage is placed relative to the moment the word lands, so the
//! stages hand off to each other however the word's own tempo is tuned.

use std::sync::Arc;

use egui::emath::{GuiRounding, TSTransform};
use egui::{
    Area, Color32, Context, Galley, Id, Key, Mesh, Order, Painter, Pos2, Rect, Sense, Shape,
    Stroke, Ui, UiBuilder, Vec2, pos2, vec2,
};

use crate::colors::{
    AMBER50, AMBER60, AMBER80, AMBER99, BLUE10, CONTAINER, GREY_BLUE20, GREY_BLUE60, GREY_BLUE70,
    GREY_BLUE80, GREY10,
};
use crate::game_menu::clock_text;
use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::widgets::{self, ButtonPlate, ResourceGlyph};
use crate::kit::{motion, theme, tiers};
use crate::observer::RaceView;
use crate::observer::race_icon;
use crate::tr;

/// Where the middle of the banner sits, as a fraction of the screen's height from its top. Above
/// the screen's middle: SC:R's console takes the bottom quarter of the screen, and a composition
/// centered on the whole screen reads as sinking into it. The record and the buttons hang below the
/// banner, so this is also what keeps them clear of the console.
const BANNER_CENTER: f32 = 0.39;

/// How tall the banner is, edge to soft edge.
const BAND_HEIGHT: f32 = 196.0;

/// How far from its middle the banner stays at full strength before its edges start to fade, as a
/// fraction of its half-height.
const BAND_SOLID: f32 = 0.42;

/// Size of the result word, and the tracking it comes to rest at, as a fraction of that size.
const WORD_SIZE: f32 = 124.0;
const WORD_TRACKING: f32 = 0.12;

/// The tracking a defeat's word starts from before its letters draw together, as a fraction of its
/// size.
const DEFEAT_OPEN_TRACKING: f32 = 0.42;

/// How much larger a victory's word starts than it lands, and a defeat's.
const VICTORY_WORD_LIFT: f32 = 0.24;
const DEFEAT_WORD_LIFT: f32 = 0.05;

/// How far above its resting place a defeat's word starts, sinking into it as it lands.
const DEFEAT_WORD_DROP: f32 = 14.0;

/// The least room left either side of the word. A translation too long to fit is set smaller
/// rather than run off the screen.
const WORD_MARGIN: f32 = 96.0;

/// Side of the race emblem behind the word, and how far past the banner's edges it fades out, as a
/// multiple of the banner's height.
const EMBLEM_SIZE: f32 = 300.0;
const EMBLEM_REACH: f32 = 1.35;

/// How the light behind the word spreads: its half-width and half-height.
const LIGHT_RADII: Vec2 = vec2(560.0, 116.0);

/// The gap between the word's letters and the inner end of the rules either side of it.
const RULE_GAP: f32 = 44.0;

/// Half the width of the light that sweeps across a victory's word.
const GLINT_HALF_WIDTH: f32 = 90.0;

/// The gap between the banner's bottom edge and the clock under it, and between the clock and the
/// summary.
const CLOCK_GAP: f32 = 26.0;
const STATS_GAP: f32 = 24.0;

/// How far past the record the darkness pooled under it reaches, and how dark it is at its middle.
const RECORD_SHADE_REACH: Vec2 = vec2(220.0, 90.0);
const RECORD_SHADE_ALPHA: f32 = 0.5;

/// Size of the clock's numerals.
const CLOCK_SIZE: f32 = 22.0;

/// Size of one of the summary's numbers.
const STAT_SIZE: f32 = 34.0;

/// How wide one cell of the summary is, and how tall: its label, the gap under it, and its number.
const STAT_CELL_WIDTH: f32 = 150.0;
const STAT_CELL_HEIGHT: f32 = 64.0;

/// How far a cell of the summary rises as it fades in, and how far the buttons do.
const CELL_RISE: f32 = 12.0;
const BUTTON_RISE: f32 = 8.0;

/// Side of the glyph beside a resource's number.
const GLYPH_SIZE: f32 = 16.0;

/// The gap between the summary and the buttons.
const ACTIONS_GAP: f32 = 38.0;

/// The size of one of the buttons, and the gap between the two.
const BUTTON_WIDTH: f32 = 240.0;
const BUTTON_HEIGHT: f32 = 44.0;
const BUTTON_GAP: f32 = 12.0;

/// Size of a button's label, and how far its capitals are tracked apart.
const BUTTON_LABEL_SIZE: f32 = 13.0;
const BUTTON_TRACKING: f32 = 1.8;

/// The keys the card's buttons answer to, as their keycaps name them. Leaving shows `E`, SC:R's End
/// Mission key and the one the overlay leaves with everywhere; carrying on after a victory shows
/// SC:R's `C` (Continue Playing). A defeat has no carrying on: SC:R's defeat popup offers only its
/// OK. See [`key_choice`] for every key that answers.
pub const LEAVE_KEY: &str = "E";
pub const KEEP_PLAYING_KEY: &str = "C";

/// What `key` chooses on either card. Leaving answers to every key SC:R leaves a game with: `E`
/// (End Mission), `O` (its defeat popup's OK), `V` (its victory popup's ending button outside a
/// multiplayer game), `Q` (Quit Mission) and `X` (Exit Program). Carrying on after a victory also
/// answers to `B`, the key of the observer button SC:R's defeat popup keeps hidden.
pub fn key_choice(key: Key, result: GameResult) -> Option<EndCardChoice> {
    match (key, result) {
        (Key::E | Key::V | Key::O | Key::Q | Key::X, _) => Some(EndCardChoice::Leave),
        (Key::C | Key::B, GameResult::Victory) => Some(EndCardChoice::KeepPlaying),
        _ => None,
    }
}

/// How the game went for the local player.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum GameResult {
    Victory,
    Defeat,
}

/// The local player's own game, in numbers the game itself kept.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct EndCardStats {
    pub units_produced: u32,
    pub units_killed: u32,
    pub units_lost: u32,
    /// Everything gathered over the game, not what is left in the bank.
    pub minerals_gathered: u32,
    pub gas_gathered: u32,
    /// Actions per minute over the whole game, for a host that counts them.
    pub average_apm: Option<u32>,
}

/// What the card shows.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EndCardView {
    pub result: GameResult,
    /// How long the game ran before it was decided, in whole seconds.
    pub game_seconds: u64,
    /// The player's own numbers, for a host that could read them.
    pub stats: Option<EndCardStats>,
    /// The race the player played, whose emblem stands behind the result. `None` for a host that
    /// could not tell, which leaves the banner without one rather than guessing.
    pub race: Option<RaceView>,
}

/// What the player chose to do next.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EndCardChoice {
    /// End the game and go back to the app.
    Leave,
    /// Put the card away and keep playing on the map.
    KeepPlaying,
}

/// What a pass of the card reported back.
pub struct EndCardResponse {
    /// What the player chose this pass, if anything.
    pub choice: Option<EndCardChoice>,
    /// The part of the screen the card's contents take up: the word, the record and the buttons.
    /// The darkening around them takes the rest of the screen's clicks too, but this is what the
    /// card is.
    pub rect: Rect,
}

/// Draws the end-of-game screen over the game, darkening everything behind it.
///
/// The screen arrives in stages rather than appearing, and its buttons only answer once the last
/// of them is in: it comes up at the moment a game is decided, which is often in the middle of a
/// fight, and a click the player aimed at a unit must not end the game they just won. `key_choice`
/// is what a key pressed since the last frame chose (see [`key_choice`]), which waits the same way:
/// the keys are the game's command keys too.
pub fn render_end_card(
    ctx: &Context,
    view: &EndCardView,
    key_choice: Option<EndCardChoice>,
) -> EndCardResponse {
    let id = Id::new("sb_end_card");
    let cells = stat_cells(view.stats.as_ref());
    let timeline = Timeline::of(view.result, cells.len());
    let t = motion::arrival_secs(ctx, id.with("arrival"), timeline.rest());
    let look = Look::of(view.result);
    let screen = ctx.viewport_rect();
    let center = pos2(
        screen.center().x,
        screen.top() + screen.height() * BANNER_CENTER,
    );
    // Takes every click that misses the buttons and does nothing with it: dismissing the screen
    // means choosing to keep playing, which is a choice and not something a stray click should
    // make.
    Area::new(id.with("backdrop"))
        .order(Order::Middle)
        .fixed_pos(screen.min)
        .fade_in(false)
        .show(ctx, |ui| {
            let (rect, _) = ui.allocate_exact_size(screen.size(), Sense::click());
            let shade = ease_out(timeline.backdrop.progress(t));
            ui.painter().add(backdrop(rect, center, &look, shade));
        });
    let settled = t >= timeline.settled();
    Area::new(id)
        .order(Order::Foreground)
        .fixed_pos(screen.min)
        .fade_in(false)
        .show(ctx, |ui| {
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            let shade = ui.painter().add(Shape::Noop);
            let word_rect = draw_banner(ui, view, &look, &timeline, t, center);
            let mut record = Record {
                ui,
                timeline: &timeline,
                t,
                center_x: center.x,
                top: center.y + BAND_HEIGHT / 2.0 + CLOCK_GAP,
            };
            let record_rect = record.draw(view, &cells);
            let (choice, actions_rect) = record.draw_actions(view.result, settled);
            // A deeper pool of the darkness under the record, so its small type holds up over
            // whatever the game had on screen there; laid under it and the banner once its extent
            // is known.
            let below = record_rect.union(actions_rect);
            ui.painter().set(
                shade,
                soft_ellipse(
                    below.center(),
                    below.size() / 2.0 + RECORD_SHADE_REACH,
                    look.shade,
                    RECORD_SHADE_ALPHA * ease_out(timeline.clock.progress(t)),
                ),
            );
            EndCardResponse {
                choice: choice.or(key_choice).filter(|_| settled),
                rect: word_rect.union(record_rect).union(actions_rect),
            }
        })
        .inner
}

/// One stretch of the entrance: when it starts, in seconds after the screen first appeared, and
/// how long it runs.
#[derive(Clone, Copy)]
struct Beat {
    start: f32,
    secs: f32,
}

impl Beat {
    const fn new(start: f32, secs: f32) -> Beat {
        Beat { start, secs }
    }

    /// How far through this beat the clock is at `t`: 0 until it starts, 1 once it is over.
    fn progress(self, t: f32) -> f32 {
        ((t - self.start) / self.secs.max(f32::EPSILON)).clamp(0.0, 1.0)
    }

    fn end(self) -> f32 {
        self.start + self.secs
    }
}

/// The stages of the entrance, all on one clock.
///
/// The darkness and the banner come up first, the word lands into the banner, and everything
/// after is placed against that landing: the rules draw outward as it lands, the record follows it
/// cell by cell, and the buttons come last. A defeat lands slower and heavier than a victory, and
/// that is the only place the two tempos differ; the stages after the landing keep the same rhythm
/// whichever way the game went.
struct Timeline {
    backdrop: Beat,
    band: Beat,
    word: Beat,
    rules: Beat,
    /// The light that crosses a victory's word once it has landed. A defeat has none.
    glint: Option<Beat>,
    clock: Beat,
    /// How many cells the summary has.
    cells: usize,
}

/// When the first of the summary's cells starts in after the word lands, how far apart the cells
/// start, and how long each takes to come in.
const FIRST_CELL_DELAY: f32 = 0.15;
const CELL_STAGGER: f32 = 0.06;
const CELL_SECS: f32 = 0.4;

/// How long a cell's number takes to count up to its value, from the moment the cell starts in.
const COUNT_SECS: f32 = 0.6;

/// When the buttons start in after the last cell does, and how long they take.
const BUTTONS_DELAY: f32 = 0.25;
const BUTTONS_SECS: f32 = 0.3;

impl Timeline {
    fn of(result: GameResult, cells: usize) -> Timeline {
        let (backdrop, band, word) = match result {
            GameResult::Victory => (
                Beat::new(0.0, 0.4),
                Beat::new(0.0, 0.45),
                Beat::new(0.1, 0.55),
            ),
            GameResult::Defeat => (
                Beat::new(0.0, 0.5),
                Beat::new(0.0, 0.55),
                Beat::new(0.12, 0.62),
            ),
        };
        let landing = word.end();
        Timeline {
            backdrop,
            band,
            word,
            rules: Beat::new(landing - 0.12, 0.6),
            glint: (result == GameResult::Victory).then_some(Beat::new(landing + 0.2, 0.8)),
            clock: Beat::new(landing + 0.05, 0.35),
            cells,
        }
    }

    fn cell(&self, index: usize) -> Beat {
        Beat::new(
            self.word.end() + FIRST_CELL_DELAY + CELL_STAGGER * index as f32,
            CELL_SECS,
        )
    }

    fn count(&self, index: usize) -> Beat {
        Beat::new(self.cell(index).start, COUNT_SECS)
    }

    fn buttons(&self) -> Beat {
        let last_cell = self.cell(self.cells.saturating_sub(1)).start;
        Beat::new(last_cell + BUTTONS_DELAY, BUTTONS_SECS)
    }

    /// When the buttons are fully in, which is when they start to answer.
    fn settled(&self) -> f32 {
        self.buttons().end()
    }

    /// When the last thing on the screen stops moving.
    fn rest(&self) -> f32 {
        let last_count = self.count(self.cells.saturating_sub(1)).end();
        let glint = self.glint.map_or(0.0, Beat::end);
        self.settled()
            .max(last_count)
            .max(glint)
            .max(self.rules.end())
    }
}

/// The entrance's one easing: quick out of the gate and long into its rest, so everything it moves
/// lands without a bump.
fn ease_out(p: f32) -> f32 {
    1.0 - (1.0 - p).powi(3)
}

/// The victory word's landing: the same curve pushed harder, so the word covers nearly all its
/// distance at once and spends the rest of its beat settling, the way something heavy hits a
/// surface.
fn slam(p: f32) -> f32 {
    1.0 - (1.0 - p).powi(4)
}

/// Eases both in and out, for travel that starts and ends at rest.
fn ease_in_out(p: f32) -> f32 {
    p * p * (3.0 - 2.0 * p)
}

/// What sets a victory apart from a defeat on screen.
///
/// A victory is warm: the darkness is a deep navy and an amber light comes from behind the word. A
/// defeat is cold and heavier: the darkness is nearer black, closes in further from the edges, and
/// the light behind the word is a faint steel.
struct Look {
    /// The darkness laid over the game, at the composition's middle and at the screen's edges.
    shade: Color32,
    shade_middle: f32,
    shade_edge: f32,
    /// How far out from the middle the darkness stays at its lightest, as a fraction of the
    /// screen's half-height.
    shade_reach: f32,
    /// The banner, lit at its middle and falling off toward the screen's edges.
    band_middle: Color32,
    band_edge: Color32,
    band_alpha: f32,
    /// The light behind the word.
    light: Color32,
    light_alpha: f32,
    /// The word's gradient, top to bottom.
    word: [Color32; 3],
    /// The bloom behind the word, for a victory.
    glow: Option<Color32>,
    rule: Color32,
    emblem: Color32,
}

impl Look {
    fn of(result: GameResult) -> Look {
        match result {
            GameResult::Victory => Look {
                shade: BLUE10,
                shade_middle: 0.64,
                shade_edge: 0.93,
                shade_reach: 0.45,
                band_middle: CONTAINER,
                band_edge: BLUE10,
                band_alpha: 0.9,
                light: AMBER50,
                light_alpha: 0.13,
                word: [AMBER80, AMBER60, AMBER50],
                glow: Some(theme::ACCENT),
                rule: theme::ACCENT.gamma_multiply(0.6),
                emblem: theme::ACCENT.gamma_multiply(0.08),
            },
            // A loss is reported, not celebrated: steel rather than gold, no bloom, and only the
            // faintest red in the rules.
            GameResult::Defeat => Look {
                shade: GREY10,
                shade_middle: 0.74,
                shade_edge: 0.96,
                shade_reach: 0.3,
                band_middle: GREY_BLUE20,
                band_edge: GREY10,
                band_alpha: 0.9,
                light: GREY_BLUE60,
                light_alpha: 0.07,
                word: [GREY_BLUE80, GREY_BLUE70, GREY_BLUE60],
                glow: None,
                rule: GREY_BLUE60
                    .lerp_to_gamma(theme::TEXT_NEGATIVE, 0.3)
                    .gamma_multiply(0.45),
                emblem: GREY_BLUE70.gamma_multiply(0.07),
            },
        }
    }
}

/// `color` at `alpha` of full opacity, whatever its own alpha.
fn with_alpha(color: Color32, alpha: f32) -> Color32 {
    theme::alpha(color, alpha.clamp(0.0, 1.0))
}

/// Hermite step from 0 at `from` to 1 at `to`.
fn smoothstep(from: f32, to: f32, x: f32) -> f32 {
    let p = ((x - from) / (to - from)).clamp(0.0, 1.0);
    p * p * (3.0 - 2.0 * p)
}

/// A mesh over `rect` cut into `columns` by `rows` cells, every vertex colored by `color` at its
/// position. For the screen's soft shapes, which are gradients in two directions at once and which
/// fade to nothing at their own edges, so a mesh's straight sides are never what the eye sees.
fn shaded_grid(rect: Rect, columns: usize, rows: usize, color: impl Fn(Pos2) -> Color32) -> Mesh {
    let mut mesh = Mesh::default();
    for row in 0..=rows {
        for column in 0..=columns {
            let position = pos2(
                rect.left() + rect.width() * column as f32 / columns as f32,
                rect.top() + rect.height() * row as f32 / rows as f32,
            );
            mesh.colored_vertex(position, color(position));
        }
    }
    let stride = columns as u32 + 1;
    for row in 0..rows as u32 {
        for column in 0..columns as u32 {
            let corner = row * stride + column;
            mesh.add_triangle(corner, corner + 1, corner + stride);
            mesh.add_triangle(corner + 1, corner + stride + 1, corner + stride);
        }
    }
    mesh
}

/// The darkness over the game: lightest around the banner, closing in toward the screen's edges.
fn backdrop(screen: Rect, center: Pos2, look: &Look, shade: f32) -> Shape {
    let half_height = screen.height() / 2.0;
    Shape::mesh(shaded_grid(screen, 24, 16, |position| {
        // Measured in the screen's height both ways, so the falloff is round on a 4:3 screen and a
        // 16:9 one alike.
        let distance = ((position - center) / half_height).length();
        let edge = smoothstep(look.shade_reach, look.shade_reach + 1.1, distance);
        let alpha = look.shade_middle + (look.shade_edge - look.shade_middle) * edge;
        with_alpha(look.shade, alpha * shade)
    }))
}

/// The banner and everything on it, returning the rect the word's letters take up.
fn draw_banner(
    ui: &Ui,
    view: &EndCardView,
    look: &Look,
    timeline: &Timeline,
    t: f32,
    center: Pos2,
) -> Rect {
    let screen = ui.ctx().viewport_rect();
    let painter = ui.painter();
    let open = ease_out(timeline.band.progress(t));
    painter.add(band(screen, center, look, open));
    painter.add(light(center, look, open));
    // Dissolves into the darkness a little past the banner's own edges rather than standing out
    // past them, so it reads as something in the banner rather than as a shape over the game.
    if let Some(race) = view.race
        && open > 0.0
    {
        let rect = race_icon::icon_rect(center, EMBLEM_SIZE, ui.ctx().pixels_per_point());
        let half = BAND_HEIGHT / 2.0 * EMBLEM_REACH;
        race_icon::paint_race_icon_shaded(painter, rect, race, |position| {
            look.emblem
                .gamma_multiply(band_fade(position.y - center.y, half) * open)
        });
    }
    let word = Word::lay_out(ui, view.result, timeline, t, center);
    draw_rules(painter, look, timeline.rules.progress(t), center, word.ink);
    word.paint(painter, look, timeline, t);
    word.ink
}

/// The banner: a band the width of the screen whose top and bottom edges fade, lit at its middle.
/// `open` is how far it has opened out from a line through its middle.
fn band(screen: Rect, center: Pos2, look: &Look, open: f32) -> Shape {
    if open <= 0.0 {
        return Shape::Noop;
    }
    let half = BAND_HEIGHT / 2.0 * open;
    let rect = Rect::from_x_y_ranges(screen.x_range(), center.y - half..=center.y + half);
    let half_width = screen.width() / 2.0;
    Shape::mesh(shaded_grid(rect, 16, 20, |position| {
        let across = ((position.x - center.x).abs() / half_width).min(1.0);
        let color = look
            .band_middle
            .lerp_to_gamma(look.band_edge, smoothstep(0.0, 1.0, across));
        let fade = band_fade(position.y - center.y, half);
        with_alpha(color, look.band_alpha * fade * open)
    }))
}

/// How strong the banner is `offset` above or below its middle, for a banner `half` tall either
/// side of it: full through its middle, falling smoothly to nothing at its edges.
fn band_fade(offset: f32, half: f32) -> f32 {
    1.0 - smoothstep(BAND_SOLID, 1.0, offset.abs() / half.max(f32::EPSILON))
}

/// The light behind the word: a wide, low glow that is gone well before it reaches anything that
/// could cut it off.
fn light(center: Pos2, look: &Look, open: f32) -> Shape {
    soft_ellipse(center, LIGHT_RADII, look.light, look.light_alpha * open)
}

/// A pool of `color` at `alpha` around `center`, falling off smoothly to nothing at `radii`.
fn soft_ellipse(center: Pos2, radii: Vec2, color: Color32, alpha: f32) -> Shape {
    if alpha <= 0.0 {
        return Shape::Noop;
    }
    let rect = Rect::from_center_size(center, radii * 2.0);
    Shape::mesh(shaded_grid(rect, 28, 12, |position| {
        let distance = ((position - center) / radii).length().min(1.0);
        let falloff = (1.0 - distance * distance).powi(2);
        with_alpha(color, alpha * falloff)
    }))
}

/// The hairlines that run out from beside the word toward the screen's edges, brightest by the
/// word and gone by the edge. `drawn` is how far out they have drawn, from 0 at the word to 1 at
/// the edge.
fn draw_rules(painter: &Painter, look: &Look, drawn: f32, center: Pos2, ink: Rect) {
    if drawn <= 0.0 {
        return;
    }
    let reach = ease_out(drawn);
    let pixels_per_point = painter.ctx().pixels_per_point();
    let pixel = 1.0 / pixels_per_point;
    // On a whole pixel row and one pixel thick, so the rule is as crisp at 1440p as at 1080p.
    let top = (center.y * pixels_per_point).round() / pixels_per_point;
    let screen = painter.ctx().viewport_rect();
    for (inner, outer) in [
        (ink.left() - RULE_GAP, screen.left()),
        (ink.right() + RULE_GAP, screen.right()),
    ] {
        let length = inner - outer;
        let mut mesh = Mesh::default();
        let mut stops = [0.0, 0.03, 0.12, 0.3, 0.55, 0.8, 1.0]
            .into_iter()
            .filter(|&along| along < reach)
            .collect::<Vec<_>>();
        stops.push(reach);
        for along in stops {
            // A short fade in at the word's end, so the rule starts rather than being cut off, then
            // a long fall to nothing at the screen's edge.
            let alpha = smoothstep(0.0, 0.03, along) * (1.0 - along).powf(1.4);
            let x = inner - length * along;
            let color = look.rule.gamma_multiply(alpha);
            mesh.colored_vertex(pos2(x, top), color);
            mesh.colored_vertex(pos2(x, top + pixel), color);
        }
        let quads = mesh.vertices.len() as u32 / 2 - 1;
        for quad in 0..quads {
            let corner = quad * 2;
            mesh.add_triangle(corner, corner + 1, corner + 2);
            mesh.add_triangle(corner + 1, corner + 2, corner + 3);
        }
        painter.add(Shape::mesh(mesh));
    }
}

/// The result word, laid out for this pass of its landing.
struct Word {
    /// The word in [`Color32::PLACEHOLDER`], so every copy of it can be tinted at paint time.
    galley: Arc<Galley>,
    /// Where the galley's origin sits once the word has landed.
    origin: Pos2,
    /// The size the word is set at.
    size: f32,
    /// What moves the word from where it lands to where it is this pass.
    transform: TSTransform,
    /// How visible the word is this pass.
    alpha: f32,
    /// The letters' own extent this pass, transform applied.
    ink: Rect,
}

impl Word {
    fn lay_out(ui: &Ui, result: GameResult, timeline: &Timeline, t: f32, center: Pos2) -> Word {
        let title = match result {
            GameResult::Victory => tr!("endCard.victory", "Victory"),
            GameResult::Defeat => tr!("endCard.defeat", "Defeat"),
        };
        let screen = ui.ctx().viewport_rect();
        let spec = |size: f32, tracking: f32| TextSpec {
            uppercase: true,
            ..text::headline(size)
                .with_color(Color32::PLACEHOLDER)
                .with_letter_spacing(size * tracking)
        };
        // Measured at rest, so a word that has to be set smaller to fit is set at one size
        // throughout its landing rather than shrinking as its letters draw together.
        let fit = (screen.width() - WORD_MARGIN * 2.0)
            / ink_bounds(&spec(WORD_SIZE, WORD_TRACKING).galley(ui, &title)).width();
        let size = WORD_SIZE * fit.min(1.0);
        let landing = timeline.word.progress(t);
        let (scale, drop, tracking, alpha) = match result {
            GameResult::Victory => (
                1.0 + VICTORY_WORD_LIFT * (1.0 - slam(landing)),
                0.0,
                WORD_TRACKING,
                smoothstep(0.0, 0.35, landing),
            ),
            // Heavier: it starts nearly at its size, a little above its place and with its
            // letters spread, and all three close in together on the slower curve.
            GameResult::Defeat => {
                let remaining = 1.0 - ease_out(landing);
                (
                    1.0 + DEFEAT_WORD_LIFT * remaining,
                    -DEFEAT_WORD_DROP * remaining,
                    WORD_TRACKING + (DEFEAT_OPEN_TRACKING - WORD_TRACKING) * remaining,
                    smoothstep(0.0, 0.55, landing),
                )
            }
        };
        let galley = spec(size, tracking).galley(ui, &title);
        let resting_ink = ink_bounds(&galley);
        let origin = center - resting_ink.center().to_vec2();
        let transform = TSTransform::new(center.to_vec2() * (1.0 - scale) + vec2(0.0, drop), scale);
        Word {
            ink: transform * resting_ink.translate(origin.to_vec2()),
            galley,
            origin,
            size,
            transform,
            alpha,
        }
    }

    fn paint(&self, painter: &Painter, look: &Look, timeline: &Timeline, t: f32) {
        if self.alpha <= 0.0 {
            return;
        }
        let mut painter = painter.clone();
        painter.set_opacity(self.alpha);
        let add = |painter: &Painter, mut shape: Shape| {
            shape.transform(self.transform);
            painter.add(shape);
        };
        if let Some(glow) = look.glow {
            for stamp in tiers::glow_stamps(self.origin, &self.galley, glow, self.size) {
                add(&painter, stamp);
            }
        }
        let [top, middle, bottom] = look.word;
        let ctx = painter.ctx().clone();
        // Measured at rest, as the mesh is built at rest and moved by the word's transform.
        let rest = self.transform.inverse() * self.ink;
        let glint = timeline
            .glint
            .map(|glint| glint.progress(t))
            .filter(|progress| *progress > 0.0 && *progress < 1.0)
            .map(|progress| {
                let left = rest.left() - GLINT_HALF_WIDTH;
                let right = rest.right() + GLINT_HALF_WIDTH;
                left + (right - left) * ease_in_out(progress)
            });
        let color_at = |pos: Pos2| {
            let along = ((pos.y - rest.top()) / rest.height()).clamp(0.0, 1.0);
            let color = if along < 0.5 {
                top.lerp_to_gamma(middle, along * 2.0)
            } else {
                middle.lerp_to_gamma(bottom, along * 2.0 - 1.0)
            };
            match glint {
                Some(center) if (pos.x - center).abs() < GLINT_HALF_WIDTH => {
                    let distance = (pos.x - center).abs() / GLINT_HALF_WIDTH;
                    let strength = (distance * std::f32::consts::FRAC_PI_2).cos().powi(2);
                    color.lerp_to_gamma(AMBER99, 0.9 * strength)
                }
                _ => color,
            }
        };
        let mesh = word_mesh(
            &self.galley,
            self.origin,
            ctx.pixels_per_point(),
            ctx.fonts(|fonts| fonts.font_image_size()),
            color_at,
        );
        add(&painter, Shape::mesh(mesh));
    }
}

/// How many cells across and down each letter of the word is cut into, so the colors given its
/// corners can follow the gradient down the letters and the glint's soft band across them.
const WORD_MESH_CELLS: usize = 12;

/// The word as one mesh of its letters, each cut into a grid whose corners take their color from
/// `color_at`: the colors change across the letters without the word being drawn more than once.
/// A word drawn as several clipped copies shows the seams between them along every edge, wherever
/// the renderer's clipping falls a pixel off the overlay's own.
///
/// Built the way egui lays a galley's glyphs out (each glyph a quad of the font atlas, the galley
/// set on a whole pixel), at `origin`, with the atlas `atlas_size` texels across.
fn word_mesh(
    galley: &Galley,
    origin: Pos2,
    pixels_per_point: f32,
    atlas_size: [usize; 2],
    color_at: impl Fn(Pos2) -> Color32,
) -> Mesh {
    let origin = origin.round_to_pixels(pixels_per_point);
    let texel = vec2(1.0 / atlas_size[0] as f32, 1.0 / atlas_size[1] as f32);
    let mut mesh = Mesh::default();
    for row in &galley.rows {
        let row_origin = origin + row.pos.to_vec2();
        let vertices = &row.visuals.mesh.vertices;
        let glyphs = &vertices[row.visuals.glyph_vertex_range.clone()];
        // A glyph is a quad laid out corner to corner: its first vertex the top left, its last the
        // bottom right.
        for quad in glyphs.as_chunks::<4>().0 {
            let rect = Rect::from_min_max(quad[0].pos, quad[3].pos).translate(row_origin.to_vec2());
            let uv = Rect::from_min_max(
                (quad[0].uv.to_vec2() * texel).to_pos2(),
                (quad[3].uv.to_vec2() * texel).to_pos2(),
            );
            add_letter_grid(&mut mesh, rect, uv, &color_at);
        }
    }
    mesh
}

/// Adds one letter's quad to `mesh` as a grid of [`WORD_MESH_CELLS`] by [`WORD_MESH_CELLS`] cells.
fn add_letter_grid(mesh: &mut Mesh, rect: Rect, uv: Rect, color_at: &impl Fn(Pos2) -> Color32) {
    let base = mesh.vertices.len() as u32;
    let side = WORD_MESH_CELLS as u32 + 1;
    for down in 0..side {
        for across in 0..side {
            let at = vec2(
                across as f32 / WORD_MESH_CELLS as f32,
                down as f32 / WORD_MESH_CELLS as f32,
            );
            let pos = rect.lerp_inside(at);
            mesh.vertices.push(egui::epaint::Vertex {
                pos,
                uv: uv.lerp_inside(at),
                color: color_at(pos),
            });
        }
    }
    for down in 0..WORD_MESH_CELLS as u32 {
        for across in 0..WORD_MESH_CELLS as u32 {
            let corner = base + down * side + across;
            mesh.indices.extend_from_slice(&[
                corner,
                corner + 1,
                corner + side,
                corner + side,
                corner + 1,
                corner + side + 1,
            ]);
        }
    }
}

/// The extent of a laid-out line's letters relative to its origin, leaving out the room the face
/// keeps above and below them, which is what the word is centered on the banner by.
fn ink_bounds(galley: &Galley) -> Rect {
    galley.rows.first().map_or(galley.rect, |row| {
        row.visuals.mesh_bounds.translate(row.pos.to_vec2())
    })
}

/// One number of the summary.
struct StatCell {
    label: String,
    value: u32,
    glyph: Option<ResourceGlyph>,
}

fn stat_cells(stats: Option<&EndCardStats>) -> Vec<StatCell> {
    let Some(stats) = stats else {
        return Vec::new();
    };
    let mut cells = vec![
        StatCell {
            label: tr!("endCard.unitsProduced", "Units produced"),
            value: stats.units_produced,
            glyph: None,
        },
        StatCell {
            label: tr!("endCard.unitsKilled", "Units killed"),
            value: stats.units_killed,
            glyph: None,
        },
        StatCell {
            label: tr!("endCard.unitsLost", "Units lost"),
            value: stats.units_lost,
            glyph: None,
        },
        StatCell {
            label: tr!("endCard.mineralsGathered", "Minerals gathered"),
            value: stats.minerals_gathered,
            glyph: Some(ResourceGlyph::Minerals),
        },
        StatCell {
            label: tr!("endCard.gasGathered", "Gas gathered"),
            value: stats.gas_gathered,
            glyph: Some(ResourceGlyph::Gas),
        },
    ];
    if let Some(apm) = stats.average_apm {
        cells.push(StatCell {
            label: tr!("endCard.averageApm", "Average APM"),
            value: apm,
            glyph: None,
        });
    }
    cells
}

/// Everything under the banner, laid out top to bottom from `top`.
struct Record<'a> {
    ui: &'a mut Ui,
    timeline: &'a Timeline,
    t: f32,
    center_x: f32,
    /// Where the next row goes.
    top: f32,
}

impl Record<'_> {
    /// The clock and the summary, returning the rect they take up.
    fn draw(&mut self, view: &EndCardView, cells: &[StatCell]) -> Rect {
        let clock = self.draw_clock(view.game_seconds);
        if cells.is_empty() {
            return clock;
        }
        self.top += STATS_GAP;
        clock.union(self.draw_stats(cells))
    }

    /// How long the game ran, as a label and a clock centered together.
    fn draw_clock(&mut self, game_seconds: u64) -> Rect {
        let ui = &*self.ui;
        let label = text::column_label().galley(ui, &tr!("endCard.gameTime", "Game time"));
        let clock = text::numeral(CLOCK_SIZE)
            .with_color(theme::TEXT_SECONDARY)
            .galley(ui, &clock_text(game_seconds));
        let gap = theme::SPACE_SM + 2.0;
        let width = label.size().x + gap + clock.size().x;
        let height = label.size().y.max(clock.size().y);
        let rect = Rect::from_min_size(
            pos2(self.center_x - width / 2.0, self.top),
            vec2(width, height),
        );
        let mut painter = ui.painter().clone();
        let shown = ease_out(self.timeline.clock.progress(self.t));
        painter.set_opacity(shown);
        let rise = CELL_RISE * (1.0 - shown);
        painter.galley(
            pos2(rect.left(), rect.center().y - label.size().y / 2.0 + rise),
            label,
            theme::TEXT_LABEL,
        );
        painter.galley(
            pos2(
                rect.right() - clock.size().x,
                rect.center().y - clock.size().y / 2.0 + rise,
            ),
            clock,
            theme::TEXT_SECONDARY,
        );
        self.top = rect.bottom();
        rect
    }

    /// The player's numbers as one row, with hairlines between the cells, each cell rising in on
    /// its own beat and counting its number up from nothing.
    fn draw_stats(&mut self, cells: &[StatCell]) -> Rect {
        let width = STAT_CELL_WIDTH * cells.len() as f32;
        let rect = Rect::from_min_size(
            pos2(self.center_x - width / 2.0, self.top),
            vec2(width, STAT_CELL_HEIGHT),
        );
        for (index, cell) in cells.iter().enumerate() {
            let shown = ease_out(self.timeline.cell(index).progress(self.t));
            if shown <= 0.0 {
                continue;
            }
            let counted = ease_out(self.timeline.count(index).progress(self.t));
            let cell_rect = Rect::from_min_size(
                pos2(rect.left() + STAT_CELL_WIDTH * index as f32, rect.top()),
                vec2(STAT_CELL_WIDTH, STAT_CELL_HEIGHT),
            );
            let mut painter = self.ui.painter().clone();
            painter.set_opacity(shown);
            if index > 0 {
                painter.add(Shape::line_segment(
                    [
                        pos2(cell_rect.left(), cell_rect.top() + theme::SPACE_XS),
                        pos2(cell_rect.left(), cell_rect.bottom() - theme::SPACE_XS),
                    ],
                    Stroke::new(theme::HAIRLINE, theme::TIER1_DIVIDER),
                ));
            }
            let value = (cell.value as f32 * counted).round() as u32;
            draw_stat_cell(
                self.ui,
                &painter,
                cell_rect.translate(vec2(0.0, CELL_RISE * (1.0 - shown))),
                cell,
                value,
            );
        }
        self.top = rect.bottom();
        rect
    }

    /// The ways on from here, each marked with its key: leaving, and after a victory carrying on,
    /// with the key that takes the gentler one. A defeated player can only leave, as SC:R's own
    /// defeat popup offers nothing else. Returns what was chosen and the rect the buttons and the
    /// note under them take up once they are in.
    fn draw_actions(&mut self, result: GameResult, settled: bool) -> (Option<EndCardChoice>, Rect) {
        self.top += ACTIONS_GAP;
        let shown = ease_out(self.timeline.buttons().progress(self.t));
        let mut buttons = vec![(
            tr!("endCard.leaveGame", "Leave game"),
            ButtonPlate::primary(),
            LEAVE_KEY,
            EndCardChoice::Leave,
        )];
        if result == GameResult::Victory {
            buttons.push((
                tr!("endCard.keepPlaying", "Keep playing"),
                ButtonPlate::standard(),
                KEEP_PLAYING_KEY,
                EndCardChoice::KeepPlaying,
            ));
        }
        let row_width =
            BUTTON_WIDTH * buttons.len() as f32 + BUTTON_GAP * (buttons.len() - 1) as f32;
        let top = self.top;
        let rise = BUTTON_RISE * (1.0 - shown);
        let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
        let mut choice = None;
        for (index, (label, plate, key, chosen)) in buttons.into_iter().enumerate() {
            let rect = Rect::from_min_size(
                pos2(
                    self.center_x - row_width / 2.0 + (BUTTON_WIDTH + BUTTON_GAP) * index as f32,
                    self.top + rise,
                ),
                vec2(BUTTON_WIDTH, BUTTON_HEIGHT),
            );
            if shown <= 0.0 {
                continue;
            }
            self.ui
                .scope_builder(UiBuilder::new().max_rect(rect), |ui| {
                    ui.set_opacity(shown);
                    let button = widgets::plate_button(ui, &spec, &label, rect.size(), plate);
                    widgets::paint_button_kbd(ui, button.rect, key);
                    if button.clicked() && settled {
                        choice = Some(chosen);
                    }
                });
        }
        self.top += BUTTON_HEIGHT;
        if result == GameResult::Victory {
            let hint = text::body(11.0, BodyWeight::Regular)
                .with_color(theme::TEXT_LABEL)
                .galley(self.ui, &tr!("endCard.escHint", "Esc keeps playing"));
            self.top += theme::SPACE_MD;
            let mut painter = self.ui.painter().clone();
            painter.set_opacity(shown);
            let size = hint.size();
            painter.galley(
                pos2(self.center_x - size.x / 2.0, self.top + rise),
                hint,
                theme::TEXT_LABEL,
            );
            self.top += size.y;
        }
        let rect = Rect::from_x_y_ranges(
            self.center_x - row_width / 2.0..=self.center_x + row_width / 2.0,
            top..=self.top,
        );
        (choice, rect)
    }
}

/// One cell: its label in small capitals over its number in the condensed face, both centered.
/// `value` is what the number has counted up to so far.
fn draw_stat_cell(ui: &Ui, painter: &Painter, rect: Rect, cell: &StatCell, value: u32) {
    let label_job = text::column_label().job_truncated(&cell.label, rect.width() - theme::SPACE_LG);
    let label = ui.ctx().fonts_mut(|fonts| fonts.layout_job(label_job));
    let value_color = cell.glyph.map_or(theme::TEXT_PRIMARY, ResourceGlyph::color);
    let value = text::numeral(STAT_SIZE)
        .with_color(value_color)
        .galley(ui, &value.to_string());
    painter.galley(
        pos2(rect.center().x - label.size().x / 2.0, rect.top()),
        label,
        theme::TEXT_LABEL,
    );
    let glyph_room = cell.glyph.map_or(0.0, |_| GLYPH_SIZE + theme::SPACE_SM);
    let value_left = rect.center().x - (glyph_room + value.size().x) / 2.0;
    let value_top = rect.bottom() - value.size().y;
    if let Some(glyph) = cell.glyph {
        let glyph_rect = Rect::from_center_size(
            pos2(
                value_left + GLYPH_SIZE / 2.0,
                value_top + value.size().y / 2.0,
            ),
            vec2(GLYPH_SIZE, GLYPH_SIZE),
        );
        widgets::paint_resource_glyph(painter, glyph_rect, glyph, 1.0);
    }
    painter.galley(pos2(value_left + glyph_room, value_top), value, value_color);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_ctx() -> Context {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx
    }

    fn view() -> EndCardView {
        EndCardView {
            result: GameResult::Victory,
            game_seconds: 1068,
            stats: Some(EndCardStats {
                units_produced: 84,
                units_killed: 61,
                units_lost: 43,
                minerals_gathered: 18_450,
                gas_gathered: 6_120,
                average_apm: Some(214),
            }),
            race: Some(RaceView::Protoss),
        }
    }

    /// Runs one pass of the card at `time`, clicking at `click` if asked to.
    fn run_pass(ctx: &Context, time: f64, click: Option<egui::Pos2>) -> Option<EndCardChoice> {
        let mut events = Vec::new();
        if let Some(pos) = click {
            events.push(egui::Event::PointerMoved(pos));
            events.push(egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::NONE,
            });
            events.push(egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::NONE,
            });
        }
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
            time: Some(time),
            events,
            ..Default::default()
        };
        let mut choice = None;
        let mut output = ctx.run_ui(raw, |_| {
            choice = render_end_card(ctx, &view(), None).choice;
        });
        output.textures_delta.clear();
        choice
    }

    /// Long enough after the card first appears that every stage of it is in.
    const LANDED: f64 = 3.0;

    /// A context whose card has finished arriving.
    fn settled_ctx() -> Context {
        let ctx = fresh_ctx();
        run_pass(&ctx, 0.0, None);
        run_pass(&ctx, LANDED, None);
        ctx
    }

    /// Where the Leave button sits once the card has landed, found by clicking down the middle of
    /// its column until something answers, which keeps the test free of the layout's numbers.
    fn leave_button() -> egui::Pos2 {
        let x = 960.0 - (BUTTON_WIDTH + BUTTON_GAP) / 2.0;
        (540..1080)
            .step_by(6)
            .map(|y| pos2(x, y as f32))
            .find(|&pos| {
                run_pass(&settled_ctx(), LANDED + 0.01, Some(pos)) == Some(EndCardChoice::Leave)
            })
            .expect("the card has a Leave button")
    }

    #[test]
    fn the_whole_entrance_lands_well_inside_the_time_the_tests_give_it() {
        for result in [GameResult::Victory, GameResult::Defeat] {
            let timeline = Timeline::of(result, 6);
            assert!(timeline.settled() <= timeline.rest());
            assert!(f64::from(timeline.rest()) < LANDED);
        }
    }

    #[test]
    fn a_click_that_lands_while_the_card_is_arriving_chooses_nothing() {
        let button = leave_button();
        let ctx = fresh_ctx();
        run_pass(&ctx, 0.0, None);
        for time in [0.05, 0.6, 1.2] {
            assert_eq!(run_pass(&ctx, time, Some(button)), None);
        }
    }

    #[test]
    fn a_click_outside_the_buttons_chooses_nothing() {
        let ctx = settled_ctx();
        assert_eq!(run_pass(&ctx, LANDED + 0.01, Some(pos2(40.0, 40.0))), None);
        assert_eq!(
            run_pass(&ctx, LANDED + 0.02, Some(pos2(960.0, 420.0))),
            None
        );
    }

    #[test]
    fn the_whole_screen_sits_above_the_console() {
        let ctx = settled_ctx();
        let mut rect = Rect::NOTHING;
        let raw = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0))),
            time: Some(LANDED + 0.01),
            ..Default::default()
        };
        let _ = ctx.run_ui(raw, |_| {
            rect = render_end_card(&ctx, &view(), None).rect;
        });
        // SC:R's console takes the bottom quarter of the screen.
        assert!(rect.bottom() < 1080.0 * 0.75, "{rect:?}");
    }
}
