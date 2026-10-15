//! The card a player gets when their game is decided, standing in for SC:R's victory and defeat
//! popups.
//!
//! It is the game's one hero moment for a player rather than a watcher, so it wears the hero
//! chrome rather than a menu's: the result as a headline, how long the game ran, and a few numbers
//! from the player's own game, over the two things there are to do next. Everything here is a pure
//! fn of plain data plus an [`egui::Context`], so the same code renders in the injected game DLL and
//! in the host preview.

use egui::emath::TSTransform;
use egui::{
    Align, Align2, Area, Color32, Context, Frame, Id, InnerResponse, Key, Layout, Margin, Mesh,
    Order, Rect, Sense, Shape, Stroke, Ui, Vec2, pos2, vec2,
};

use crate::game_menu::clock_text;
use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ButtonPlate, ResourceGlyph};
use crate::kit::{motion, theme, tiers};
use crate::tr;

/// How wide the card is, in overlay points.
const CARD_WIDTH: f32 = 600.0;

/// Padding either side of everything on the card.
const PAD_X: i8 = 32;

/// Size of the result headline.
const HEADLINE_SIZE: f32 = 60.0;

/// Size of the clock under the headline.
const CLOCK_SIZE: f32 = 20.0;

/// Size of one of the summary's numbers.
const STAT_SIZE: f32 = 32.0;

/// How tall one cell of the summary is: its label, the gap under it, and its number.
const STAT_CELL_HEIGHT: f32 = 62.0;

/// How many cells the summary puts on one row.
const STAT_COLUMNS: usize = 3;

/// Side of the glyph beside a resource's number.
const GLYPH_SIZE: f32 = 16.0;

/// The height of one of the card's buttons, and the gap between the two.
const BUTTON_HEIGHT: f32 = 44.0;
const BUTTON_GAP: f32 = 12.0;

/// Size of a button's label, and how far its capitals are tracked apart.
const BUTTON_LABEL_SIZE: f32 = 13.0;
const BUTTON_TRACKING: f32 = 1.8;

/// How wide the rule under the headline is at its brightest, and how far it fades out either side.
const FLOURISH_WIDTH: f32 = 220.0;

/// The keys the card's buttons answer to, as their keycaps name them. Leaving shows `E` on both
/// cards, SC:R's End Mission key and the one the overlay leaves with everywhere; carrying on shows
/// SC:R's own key for each popup, `C` (Continue Playing) after a victory and `B` (Become Observer)
/// after a defeat. See [`key_choice`] for every key that answers.
pub const VICTORY_LEAVE_KEY: &str = "E";
pub const VICTORY_KEEP_PLAYING_KEY: &str = "C";
pub const DEFEAT_LEAVE_KEY: &str = "E";
pub const DEFEAT_KEEP_PLAYING_KEY: &str = "B";

/// What `key` chooses on either card. Leaving answers to every key SC:R leaves a game with: `E`
/// (End Mission), `O` (its defeat popup's OK), `V` (its victory popup's ending button outside a
/// multiplayer game), `Q` (Quit Mission) and `X` (Exit Program). Each card answers to the other's
/// carry-on key as well: a hand that knows one of the popups does not have to learn which this is.
pub fn key_choice(key: Key) -> Option<EndCardChoice> {
    match key {
        Key::E | Key::V | Key::O | Key::Q | Key::X => Some(EndCardChoice::Leave),
        Key::C | Key::B => Some(EndCardChoice::KeepPlaying),
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
}

/// What the player chose to do next.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EndCardChoice {
    /// End the game and go back to the app.
    Leave,
    /// Put the card away and keep playing on the map.
    KeepPlaying,
}

/// Draws the end-of-game card over the game, dimming everything behind it.
///
/// The card arrives rather than appearing, and its buttons only answer once it has landed: it comes
/// up at the moment a game is decided, which is often in the middle of a fight, and a click the
/// player aimed at a unit must not end the game they just won. `key_choice` is what a key pressed
/// since the last frame chose (see [`key_choice`]), which waits for the landing the same way: the
/// keys are the game's command keys too.
pub fn render_end_card(
    ctx: &Context,
    view: &EndCardView,
    key_choice: Option<EndCardChoice>,
) -> InnerResponse<Option<EndCardChoice>> {
    let id = Id::new("sb_end_card");
    let presence = motion::arrival(ctx, id.with("arrival"), theme::MOTION_HERO_SECS);
    let screen = ctx.viewport_rect();
    // Takes the clicks that miss the card and does nothing with them: dismissing the card means
    // choosing to keep playing, which is a choice and not something a stray click should make.
    Area::new(id.with("scrim"))
        .order(Order::Middle)
        .fixed_pos(screen.min)
        .show(ctx, |ui| {
            let (rect, _) = ui.allocate_exact_size(screen.size(), Sense::click());
            ui.painter()
                .rect_filled(rect, 0, theme::SCRIM.gamma_multiply(presence.alpha));
        });
    let settled = presence.progress >= 1.0;
    let card = Area::new(id)
        .order(Order::Foreground)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .show(ctx, |ui| {
            presence.apply_fade(ui);
            let background = ui.painter().add(Shape::Noop);
            let inner = Frame::NONE.show(ui, |ui| {
                ui.set_width(CARD_WIDTH);
                ui.spacing_mut().item_spacing = Vec2::ZERO;
                draw_card(ui, view, settled, key_choice)
            });
            ui.painter().set(
                background,
                tiers::tier1_chrome(inner.response.rect, theme::radius(theme::RADIUS_PANEL)),
            );
            inner.inner
        });
    // Grows from just under its resting size about its own center while it rises into place, so it
    // reads as coming forward rather than as sliding in from somewhere.
    let rect = card.response.rect;
    let scale = theme::MOTION_HERO_SCALE + (1.0 - theme::MOTION_HERO_SCALE) * presence.progress;
    let rise = presence.offset(vec2(0.0, theme::MOTION_HERO_SLIDE));
    ctx.set_transform_layer(
        card.response.layer_id,
        TSTransform::new(rect.center().to_vec2() * (1.0 - scale) + rise, scale),
    );
    card
}

/// The card's three sections, top to bottom, returning what the player chose.
fn draw_card(
    ui: &mut Ui,
    view: &EndCardView,
    settled: bool,
    key_choice: Option<EndCardChoice>,
) -> Option<EndCardChoice> {
    band(ui, 36, 24, |ui| draw_heading(ui, view));
    if let Some(stats) = &view.stats {
        rule(ui);
        band(ui, 22, 22, |ui| draw_stats(ui, stats));
    }
    rule(ui);
    band(ui, 22, 20, |ui| {
        draw_actions(ui, view.result, settled).or(key_choice.filter(|_| settled))
    })
}

/// The result and how long the game took to reach it.
fn draw_heading(ui: &mut Ui, view: &EndCardView) {
    let (title, color, glow) = match view.result {
        GameResult::Victory => (
            tr!("endCard.victory", "Victory"),
            theme::ACCENT,
            Some(theme::ACCENT),
        ),
        // A loss is reported, not celebrated: the same headline in a dimmed text color, with no
        // glow behind it.
        GameResult::Defeat => (tr!("endCard.defeat", "Defeat"), theme::TEXT_DIM, None),
    };
    ui.vertical_centered(|ui| {
        let spec = text::headline(HEADLINE_SIZE)
            .with_color(color)
            .with_letter_spacing(1.0);
        match glow {
            Some(glow) => tiers::glowing_text(ui, &spec, &title, glow),
            None => {
                ui.label(spec.job(&title));
            }
        }
        ui.add_space(theme::SPACE_SM);
        flourish(ui, color);
        ui.add_space(theme::SPACE_MD + 2.0);
        draw_clock(ui, view.game_seconds);
    });
}

/// A short rule under the headline that fades out at both ends, in the headline's own color.
fn flourish(ui: &mut Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(vec2(FLOURISH_WIDTH, 1.0), Sense::hover());
    let middle = color.gamma_multiply(0.55);
    let clear = Color32::TRANSPARENT;
    let mut mesh = Mesh::default();
    let y_top = rect.top();
    let y_bottom = rect.top() + theme::HAIRLINE;
    for (x, vertex_color) in [
        (rect.left(), clear),
        (rect.center().x, middle),
        (rect.right(), clear),
    ] {
        mesh.colored_vertex(pos2(x, y_top), vertex_color);
        mesh.colored_vertex(pos2(x, y_bottom), vertex_color);
    }
    for left in [0u32, 2] {
        mesh.add_triangle(left, left + 1, left + 2);
        mesh.add_triangle(left + 1, left + 2, left + 3);
    }
    ui.painter().add(Shape::mesh(mesh));
}

/// How long the game ran, as a label and a clock centered together.
fn draw_clock(ui: &mut Ui, game_seconds: u64) {
    let label_spec = text::body(13.0, BodyWeight::Regular).with_color(theme::TEXT_DIM);
    let label = tr!("endCard.gameTime", "Game time");
    let label_galley = label_spec.galley(ui, &label);
    let clock = clock_text(game_seconds);
    let clock_spec = text::numeral(CLOCK_SIZE);
    let clock_galley = clock_spec.galley(ui, &clock);
    let gap = theme::SPACE_SM + 2.0;
    let size = vec2(
        label_galley.size().x + gap + clock_galley.size().x,
        label_galley.size().y.max(clock_galley.size().y),
    );
    ui.allocate_ui_with_layout(size, Layout::left_to_right(Align::Center), |ui| {
        ui.spacing_mut().item_spacing = Vec2::ZERO;
        ui.label(label_spec.job(&label));
        ui.add_space(gap);
        ui.label(clock_spec.job(&clock));
    });
}

/// One number of the summary.
struct StatCell {
    label: String,
    value: u32,
    glyph: Option<ResourceGlyph>,
}

/// The player's numbers, in rows of [`STAT_COLUMNS`] with hairlines between the columns.
fn draw_stats(ui: &mut Ui, stats: &EndCardStats) {
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
    let width = ui.available_width();
    let column = width / STAT_COLUMNS as f32;
    for (index, row) in cells.chunks(STAT_COLUMNS).enumerate() {
        if index > 0 {
            ui.add_space(theme::SPACE_XL);
        }
        let (rect, _) = ui.allocate_exact_size(vec2(width, STAT_CELL_HEIGHT), Sense::hover());
        // A short row sits in the middle of the card rather than against its left edge.
        let left = rect.left() + (width - column * row.len() as f32) / 2.0;
        for (slot, cell) in row.iter().enumerate() {
            let cell_rect = Rect::from_min_size(
                pos2(left + column * slot as f32, rect.top()),
                vec2(column, STAT_CELL_HEIGHT),
            );
            if slot > 0 {
                ui.painter().add(Shape::line_segment(
                    [
                        pos2(cell_rect.left(), cell_rect.top() + theme::SPACE_XS),
                        pos2(cell_rect.left(), cell_rect.bottom() - theme::SPACE_XS),
                    ],
                    Stroke::new(theme::HAIRLINE, theme::TIER1_DIVIDER),
                ));
            }
            draw_stat_cell(ui, cell_rect, cell);
        }
    }
}

/// One cell: its label in small capitals over its number in the condensed face, both centered.
fn draw_stat_cell(ui: &Ui, rect: Rect, cell: &StatCell) {
    let label_job = text::column_label().job_truncated(&cell.label, rect.width() - theme::SPACE_LG);
    let label = ui.ctx().fonts_mut(|fonts| fonts.layout_job(label_job));
    let value_color = cell.glyph.map_or(theme::TEXT_PRIMARY, ResourceGlyph::color);
    let value = text::numeral(STAT_SIZE)
        .with_color(value_color)
        .galley(ui, &cell.value.to_string());
    let painter = ui.painter();
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

/// The two ways on from here, each marked with the key SC:R's own popup for `result` takes it on,
/// and the key that takes the gentler one.
fn draw_actions(ui: &mut Ui, result: GameResult, settled: bool) -> Option<EndCardChoice> {
    let width = ui.available_width();
    let spec = text::button_label(BUTTON_LABEL_SIZE).with_letter_spacing(BUTTON_TRACKING);
    let half = vec2((width - BUTTON_GAP) / 2.0, BUTTON_HEIGHT);
    let (leave_key, keep_playing_key) = match result {
        GameResult::Victory => (VICTORY_LEAVE_KEY, VICTORY_KEEP_PLAYING_KEY),
        GameResult::Defeat => (DEFEAT_LEAVE_KEY, DEFEAT_KEEP_PLAYING_KEY),
    };
    let mut choice = None;
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = BUTTON_GAP;
        for (label, plate, key, chosen) in [
            (
                tr!("endCard.leaveGame", "Leave game"),
                ButtonPlate::primary(),
                leave_key,
                EndCardChoice::Leave,
            ),
            (
                tr!("endCard.keepPlaying", "Keep playing"),
                ButtonPlate::standard(),
                keep_playing_key,
                EndCardChoice::KeepPlaying,
            ),
        ] {
            let button = widgets::plate_button(ui, &spec, &label, half, plate);
            widgets::paint_button_kbd(ui, button.rect, key);
            if button.clicked() {
                choice = Some(chosen);
            }
        }
    });
    ui.add_space(theme::SPACE_MD + 2.0);
    let hint_spec = text::body(11.0, BodyWeight::Regular).with_color(theme::TEXT_LABEL);
    widgets::centered_paragraph(
        ui,
        &hint_spec,
        &tr!("endCard.escHint", "Esc keeps playing"),
        width,
    );
    choice.filter(|_| settled)
}

/// One section of the card, the full width of the chrome and padded the same either side.
fn band<R>(ui: &mut Ui, top: i8, bottom: i8, add: impl FnOnce(&mut Ui) -> R) -> R {
    let margin = Margin {
        left: PAD_X,
        right: PAD_X,
        top,
        bottom,
    };
    let width = ui.available_width();
    Frame::NONE
        .inner_margin(margin)
        .show(ui, |ui| {
            ui.set_width(width - f32::from(margin.left) - f32::from(margin.right));
            ui.spacing_mut().item_spacing = Vec2::ZERO;
            add(ui)
        })
        .inner
}

/// The hairline between two sections, inset from the chrome's edge by the card's own padding.
fn rule(ui: &mut Ui) {
    let width = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(vec2(width, theme::HAIRLINE), Sense::hover());
    let inset = f32::from(PAD_X);
    ui.painter().add(Shape::line_segment(
        [
            pos2(rect.left() + inset, rect.center().y),
            pos2(rect.right() - inset, rect.center().y),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER1_DIVIDER),
    ));
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
            choice = render_end_card(ctx, &view(), None).inner;
        });
        output.textures_delta.clear();
        choice
    }

    /// A context whose card has finished arriving.
    fn settled_ctx() -> Context {
        let ctx = fresh_ctx();
        run_pass(&ctx, 0.0, None);
        run_pass(&ctx, 1.0, None);
        ctx
    }

    /// Where the Leave button sits once the card has landed, found by clicking down the left half
    /// of the card until something answers, which keeps the test free of the layout's numbers.
    fn leave_button() -> egui::Pos2 {
        let x = 960.0 - CARD_WIDTH / 4.0;
        (540..1080)
            .step_by(6)
            .map(|y| pos2(x, y as f32))
            .find(|&pos| run_pass(&settled_ctx(), 1.01, Some(pos)) == Some(EndCardChoice::Leave))
            .expect("the card has a Leave button")
    }

    #[test]
    fn a_click_that_lands_while_the_card_is_arriving_chooses_nothing() {
        let button = leave_button();
        let ctx = fresh_ctx();
        run_pass(&ctx, 0.0, None);
        assert_eq!(run_pass(&ctx, 0.05, Some(button)), None);
    }

    #[test]
    fn a_click_outside_the_card_chooses_nothing() {
        let ctx = settled_ctx();
        assert_eq!(run_pass(&ctx, 1.01, Some(pos2(40.0, 40.0))), None);
    }
}
