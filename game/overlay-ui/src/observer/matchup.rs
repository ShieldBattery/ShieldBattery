//! The matchup bar: who is playing, what they are sitting on, and how far into the game it is.
//!
//! This is the one surface a watcher never turns off, so it is drawn at the kit's hero tier and
//! hangs off the top edge of the screen, where nothing the game draws competes with it: SC:R's own
//! resource counters sit in the top-right corner, and the bar is centred.
//!
//! Its two halves are mirror images about a middle block holding the clock. Each carries one
//! player, and a click on one is how a watcher takes that player's vision: the bar is the only
//! place every player in the game is named, which makes it the natural place to ask to see through
//! one of their eyes. A player whose vision is off is dimmed rather than dropped — they are still in
//! the game, and their numbers are still the ones the other side's are read against.
//!
//! A game with more than two players wants team cards rather than two halves. Until those exist the
//! bar keeps its middle block alone, so a watcher is never shown two of four players as though they
//! were the whole game.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, UiBuilder, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets::{self, ResourceGlyph, TagStyle};
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, RaceView, centred, game_clock, paint_player_bar, paint_race_chip, paint_text,
    vision_alpha,
};
use crate::tr;

/// How wide the bar is with both halves on it, in overlay points.
pub const BAR_WIDTH: f32 = 1200.0;

/// How wide it is with only its middle block, which is what a game it has no halves for leaves.
pub const CLOCK_WIDTH: f32 = 160.0;

/// How tall the bar is, in either form.
pub const BAR_HEIGHT: f32 = 64.0;

/// The radius of the two corners that are not against the screen's edge.
const BAR_RADIUS: u8 = 6;

/// Width of the middle block, which holds the clock and the tag saying what is being watched.
const CENTRE_WIDTH: f32 = 150.0;

/// Width of one player's half.
const SIDE_WIDTH: f32 = (BAR_WIDTH - CENTRE_WIDTH) / 2.0;

/// Width of the bar of the player's own color along the half's outer edge.
const COLOR_BAR: f32 = 6.0;

/// Gap between the color bar and the player's chip.
const PAD_OUTER: f32 = 12.0;

/// Diameter of the race chip.
const CHIP: f32 = 26.0;

/// Gap between the chip and the name.
const CHIP_GAP: f32 = 8.0;

/// Width the player's name is laid out against. Fixed, because a name is player-chosen: one longer
/// than its slot would otherwise push every number beside it out of the design's grid.
const NAME_WIDTH: f32 = 117.0;

/// Gap between the name and the first number.
const NAME_GAP: f32 = 12.0;

/// Gap between two numbers.
const STAT_GAP: f32 = 10.0;

/// Size of the glyph that says which resource a number counts.
const GLYPH: f32 = 14.0;

/// Gap between a glyph and the number it names.
const GLYPH_GAP: f32 = 6.0;

// How much room each number is laid out in. Every one of them is fixed for the same reason the name
// is: the bar must not breathe as a bank passes a thousand or a supply count gains a digit.
const MINERAL_VALUE: f32 = 46.0;
const GAS_VALUE: f32 = 46.0;
const SUPPLY_VALUE: f32 = 76.0;
const APM_VALUE: f32 = 42.0;

/// Width of the caps label standing in for a glyph on the rate, which counts no resource.
const APM_LABEL: f32 = 26.0;

/// One resource cell of a half: which glyph names it, and the room its number is laid out in.
#[derive(Copy, Clone)]
struct StatCell {
    glyph: ResourceGlyph,
    value_width: f32,
}

impl StatCell {
    /// What the cell takes of the row: its glyph, the gap, and its number.
    const fn width(self) -> f32 {
        GLYPH + GLYPH_GAP + self.value_width
    }
}

const MINERAL_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Minerals,
    value_width: MINERAL_VALUE,
};
const GAS_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Gas,
    value_width: GAS_VALUE,
};
const SUPPLY_STAT: StatCell = StatCell {
    glyph: ResourceGlyph::Supply,
    value_width: SUPPLY_VALUE,
};

/// What the rate cell takes of the row.
const APM_CELL: f32 = APM_LABEL + GLYPH_GAP + APM_VALUE;

/// Gap between the last number and the middle block.
const PAD_INNER: f32 = 12.0;

/// A half is the design's grid and nothing else: every cell is placed against the half's own outer
/// edge, so no number and no translation can move one. Checked where the widths are written,
/// because a half that overran would draw its last number under the clock.
const _: () = assert!(
    COLOR_BAR
        + PAD_OUTER
        + CHIP
        + CHIP_GAP
        + NAME_WIDTH
        + NAME_GAP
        + MINERAL_STAT.width()
        + STAT_GAP
        + GAS_STAT.width()
        + STAT_GAP
        + SUPPLY_STAT.width()
        + STAT_GAP
        + APM_CELL
        + PAD_INNER
        == SIDE_WIDTH
);

/// Text size of a player's name.
const NAME_SIZE: f32 = 19.0;

/// Text size of every number on the bar.
const VALUE_SIZE: f32 = 24.0;

/// Text size of the clock.
const CLOCK_SIZE: f32 = 30.0;

/// Size of the tag under the clock.
const TAG_WIDTH: f32 = 76.0;
const TAG_HEIGHT: f32 = 16.0;

/// How far the tag sits above the bar's bottom edge.
const TAG_BOTTOM_MARGIN: f32 = 6.0;

/// One player as the bar reads them.
pub struct MatchupPlayerView {
    /// The game's own player id, which is what a vision toggle names.
    pub player_id: u8,
    pub name: String,
    /// The color this player is on the map, which is what ties a half of the bar to what the watcher
    /// is looking at.
    pub color: Color32,
    pub race: RaceView,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    pub minerals: u32,
    pub gas: u32,
    /// Supply in the units the game shows, not the halved ones it counts in.
    pub supply_used: u32,
    pub supply_max: u32,
    pub apm: u32,
}

/// Everything the matchup bar draws from.
pub struct MatchupView {
    /// The players on the bar, outermost first: the first takes the left half and the second the
    /// right. Any other count leaves the bar its middle block alone.
    pub players: Vec<MatchupPlayerView>,
    /// How far into the game it is, in seconds.
    pub elapsed_secs: u64,
    /// Whether this is a recording rather than a game happening now, which is what the tag says.
    pub is_replay: bool,
}

impl MatchupView {
    /// Whether the bar has two halves to draw, as opposed to its middle block alone.
    fn is_duel(&self) -> bool {
        self.players.len() == 2
    }
}

/// What the watcher asked of the bar this frame.
pub struct MatchupOutcome {
    /// Where the bar is on screen, for the host's hit testing.
    pub rect: Rect,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
}

/// Draws the matchup bar against the top edge of the screen, fading and sliding it in and out.
/// Returns nothing at all once it is gone.
pub fn render_matchup_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<MatchupOutcome> {
    let id = Id::new("sb_matchup_bar");
    let area = Area::new(id)
        .anchor(Align2::CENTER_TOP, vec2(0.0, 0.0))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        draw_bar(ui, view)
    })?;
    Some(MatchupOutcome {
        rect: inner.response.rect,
        toggled_vision: inner.inner,
    })
}

/// Draws the bar and reports which player was clicked.
fn draw_bar(ui: &mut Ui, view: &MatchupView) -> Option<u8> {
    let width = if view.is_duel() {
        BAR_WIDTH
    } else {
        CLOCK_WIDTH
    };
    let (rect, _) = ui.allocate_exact_size(vec2(width, BAR_HEIGHT), Sense::hover());
    ui.painter()
        .add(tiers::tier1_chrome(rect, theme::radius_bottom(BAR_RADIUS)));
    let centre =
        Rect::from_center_size(rect.center(), vec2(CENTRE_WIDTH.min(width), rect.height()));

    let mut clicked = None;
    if view.is_duel() {
        for (index, player) in view.players.iter().enumerate() {
            let half = if index == 0 {
                Rect::from_min_max(rect.left_top(), centre.left_bottom())
            } else {
                Rect::from_min_max(centre.right_top(), rect.right_bottom())
            };
            let response = ui.interact(
                half,
                ui.id().with(("matchup_player", player.player_id)),
                Sense::click(),
            );
            draw_half(ui, half, player, index == 1);
            widgets::state_overlay(ui, &response, half, theme::radius(theme::RADIUS_TIGHT));
            if response.clicked() {
                clicked = Some(player.player_id);
            }
        }
    }
    draw_centre(ui, centre, view);
    clicked
}

/// Draws the middle block: the clock, and the tag saying whether this game is happening now.
fn draw_centre(ui: &mut Ui, rect: Rect, view: &MatchupView) {
    let tag = if view.is_replay {
        tr!("observer.replayTag", "Replay")
    } else {
        tr!("observer.liveTag", "Live")
    };
    let clock_rect = Rect::from_min_max(
        rect.left_top(),
        pos2(rect.right(), rect.bottom() - TAG_HEIGHT - theme::SPACE_XS),
    );
    paint_text(
        ui,
        clock_rect,
        &text::numeral(CLOCK_SIZE),
        &game_clock(view.elapsed_secs),
        Align::Center,
    );
    let tag_rect = Rect::from_center_size(
        pos2(
            rect.center().x,
            rect.bottom() - TAG_HEIGHT * 0.5 - TAG_BOTTOM_MARGIN,
        ),
        vec2(TAG_WIDTH, TAG_HEIGHT),
    );
    // The tag is placed rather than laid out, so it is drawn in a scope of its own: the kit's tags
    // take their space from whatever layout they are handed, and this one's place is the design's.
    ui.scope_builder(UiBuilder::new().max_rect(tag_rect), |ui| {
        widgets::tag_exact(
            ui,
            &text::column_label(),
            &tag,
            TagStyle::Amber,
            tag_rect.size(),
        );
    });
}

/// Draws one player's half, mirrored about the bar's middle for the player on the right.
fn draw_half(ui: &Ui, rect: Rect, player: &MatchupPlayerView, mirrored: bool) {
    let alpha = vision_alpha(player.vision);
    let mut cursor = if mirrored {
        EdgeCursor::from_right(rect)
    } else {
        EdgeCursor::from_left(rect)
    };

    let bar = cursor.take(COLOR_BAR);
    paint_player_bar(
        ui,
        centred(bar, rect.height() - theme::SPACE_SM),
        player.color,
        // The color bar is what says whose half this is, so it keeps more of itself than the rest
        // of a vision-less half: dimming it to the contents' opacity would make two players' halves
        // hard to tell apart at a glance.
        if player.vision { 1.0 } else { 0.5 },
    );
    cursor.skip(PAD_OUTER);
    let chip = cursor.take(CHIP);
    paint_race_chip(ui, centred(chip, CHIP), player.race, alpha);
    cursor.skip(CHIP_GAP);

    let name = cursor.take(NAME_WIDTH);
    paint_text(
        ui,
        name,
        &text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.name,
        cursor.outer_align(),
    );
    cursor.skip(NAME_GAP);

    draw_stat(
        ui,
        &mut cursor,
        MINERAL_STAT,
        &player.minerals.to_string(),
        theme::TEXT_PRIMARY.gamma_multiply(alpha),
        alpha,
    );
    cursor.skip(STAT_GAP);
    draw_stat(
        ui,
        &mut cursor,
        GAS_STAT,
        &player.gas.to_string(),
        theme::TEXT_PRIMARY.gamma_multiply(alpha),
        alpha,
    );
    cursor.skip(STAT_GAP);
    // Supply past the cap is production time a player is losing, so it is the one number on the bar
    // that changes color: a watcher scanning the bar sees the block before they have read either
    // half of the fraction.
    let supply_color = if player.supply_used > player.supply_max {
        theme::TEXT_NEGATIVE
    } else {
        theme::TEXT_PRIMARY
    };
    draw_stat(
        ui,
        &mut cursor,
        SUPPLY_STAT,
        &format!("{}/{}", player.supply_used, player.supply_max),
        supply_color.gamma_multiply(alpha),
        alpha,
    );
    cursor.skip(STAT_GAP);
    draw_apm(ui, &mut cursor, player.apm, alpha);
}

/// Draws one resource cell: the glyph against the half's outer edge, the number beside it.
fn draw_stat(
    ui: &Ui,
    cursor: &mut EdgeCursor,
    cell: StatCell,
    value: &str,
    color: Color32,
    alpha: f32,
) {
    let rect = cursor.take(cell.width());
    let mut inner = if cursor.mirrored() {
        EdgeCursor::from_right(rect)
    } else {
        EdgeCursor::from_left(rect)
    };
    let glyph_rect = centred(inner.take(GLYPH), GLYPH);
    widgets::paint_resource_glyph(ui.painter(), glyph_rect, cell.glyph, alpha);
    inner.skip(GLYPH_GAP);
    let value_rect = inner.take(cell.value_width);
    paint_text(
        ui,
        value_rect,
        &text::numeral(VALUE_SIZE).with_color(color),
        value,
        inner.outer_align(),
    );
}

/// Draws the rate cell, which is labelled rather than given a glyph: it counts no resource, and the
/// three letters are what every caster already calls it.
fn draw_apm(ui: &Ui, cursor: &mut EdgeCursor, apm: u32, alpha: f32) {
    let cell = cursor.take(APM_CELL);
    let mut inner = if cursor.mirrored() {
        EdgeCursor::from_right(cell)
    } else {
        EdgeCursor::from_left(cell)
    };
    let label = inner.take(APM_LABEL);
    paint_text(
        ui,
        label,
        &text::body(11.0, BodyWeight::Medium).with_color(theme::TEXT_LABEL.gamma_multiply(alpha)),
        &tr!("observer.apm", "APM"),
        inner.outer_align(),
    );
    inner.skip(GLYPH_GAP);
    let value = inner.take(APM_VALUE);
    paint_text(
        ui,
        value,
        &text::numeral(VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &apm.to_string(),
        inner.outer_align(),
    );
}
