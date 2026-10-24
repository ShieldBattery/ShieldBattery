//! The scoreboard: every player and the numbers a watcher checks constantly, packed into one panel
//! in the screen's top-right corner.
//!
//! Each player is named once, on one row: the bar of their color, their race chip and their name,
//! as every other panel leads a player's row, then their numbers. The sides are split by a band
//! carrying the game clock and the icons that head the number columns, so the columns are labeled
//! once for the whole game rather than once per row or per side. A game that is not two sides has
//! the band at its head instead, over every player in the order the game lists them: a band in the
//! middle of a free-for-all would split it into two sides that do not exist.
//!
//! A click on a row takes that player's vision, as it does everywhere a player is named, and a
//! player whose vision is off is dimmed rather than dropped.

use egui::{
    Align, Align2, Area, Color32, Context, CornerRadius, Id, Order, Rect, Sense, Stroke, Ui,
    UiBuilder, Vec2, pos2, vec2,
};

use crate::kit::text;
use crate::kit::widgets::{self, ResourceGlyph, TagStyle};
use crate::kit::{motion, theme, tiers};
use crate::observer::matchup::supply_blocked;
use crate::observer::{
    EdgeCursor, MatchupPlayerView, MatchupView, ProductionIcon, WING_MARGIN, centred, game_clock,
    paint_count, paint_picked_race_chip, paint_player_bar, paint_text, unit_codes, vision_alpha,
};
use crate::tr;

/// How far the panel's top edge sits below the screen's.
const PANEL_TOP: f32 = WING_MARGIN;

/// Corner radius of the panel, which floats rather than hanging off an edge.
const PANEL_RADIUS: u8 = 6;

/// How far the rows sit inside the panel's edges.
const INSET: f32 = 4.0;

/// Height of one player's row, and the gap between two rows of the same side.
const ROW_HEIGHT: f32 = 28.0;
const ROW_GAP: f32 = 2.0;

/// Height of the band between the sides, and the gap it keeps from the rows on either side of it.
const BAND_HEIGHT: f32 = 24.0;
const BAND_GAP: f32 = 3.0;

/// Width of the bar of the player's own color that leads their row, and the gap after it.
const COLOR_BAR: f32 = 4.0;
const BAR_GAP: f32 = 8.0;

/// Diameter of the race chip, and the gap between it and the name.
const CHIP: f32 = 18.0;
const CHIP_GAP: f32 = 6.0;

/// Width the player's name is laid out in. Fixed, because a name is player-chosen: one longer than
/// its slot would otherwise push every number beside it out of its column.
const NAME_WIDTH: f32 = 118.0;

/// Gap between the name and the first number.
const NAME_GAP: f32 = 6.0;

/// Width of what leads a row and says whose it is, up to the first number.
const IDENTITY_WIDTH: f32 = COLOR_BAR + BAR_GAP + CHIP + CHIP_GAP + NAME_WIDTH + NAME_GAP;

/// A number column, in the order a row reads them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Column {
    Supply,
    Workers,
    Minerals,
    Gas,
    Apm,
}

impl Column {
    const ALL: [Column; 5] = [
        Column::Supply,
        Column::Workers,
        Column::Minerals,
        Column::Gas,
        Column::Apm,
    ];

    /// How wide the column is. A column's number and its heading are both centered in it, so the
    /// widths are what keeps two neighbors' numbers apart at their longest: a supply count against
    /// its cap, three digits of workers or of a rate, and five of a bank.
    const fn width(self) -> f32 {
        match self {
            Column::Supply => 74.0,
            Column::Workers => 44.0,
            Column::Minerals => 56.0,
            Column::Gas => 56.0,
            Column::Apm => 44.0,
        }
    }
}

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = {
    let mut width = INSET + IDENTITY_WIDTH + INSET;
    let mut index = 0;
    while index < Column::ALL.len() {
        width += Column::ALL[index].width();
        index += 1;
    }
    width
};

/// Text size of a player's name, and of every number on a row.
const NAME_SIZE: f32 = 17.0;
const VALUE_SIZE: f32 = 20.0;

/// How much of a supply count's size its cap is set at.
const SUPPLY_CAP_RATIO: f32 = 0.7;

/// Text size of the clock in the band.
const CLOCK_SIZE: f32 = 18.0;

/// Size of the tag in the band saying whether the game is happening now.
const TAG_SIZE: Vec2 = vec2(76.0, 16.0);

/// Size of the icons heading the number columns.
const COLUMN_ICON: f32 = 16.0;

/// Where the band goes in a game of this shape, and which players stand on each side of it.
struct Sides<'a> {
    above: Vec<&'a MatchupPlayerView>,
    below: Vec<&'a MatchupPlayerView>,
}

impl<'a> Sides<'a> {
    /// A game of two sides is split where its sides are. Any other shape is listed whole under the
    /// band.
    fn of(view: &'a MatchupView) -> Sides<'a> {
        let halves = view.halves();
        if halves.teams.is_some() {
            Sides {
                above: halves.left,
                below: halves.right,
            }
        } else {
            Sides {
                above: Vec::new(),
                below: view.players.iter().collect(),
            }
        }
    }

    /// How tall the panel is with these rows in it.
    fn height(&self) -> f32 {
        let rows = |count: usize| {
            if count == 0 {
                0.0
            } else {
                count as f32 * ROW_HEIGHT + (count - 1) as f32 * ROW_GAP + BAND_GAP
            }
        };
        let band = if self.above.is_empty() {
            // At the panel's head the band stands against its top edge, which it shares the
            // corners of.
            BAND_HEIGHT
        } else {
            INSET + BAND_HEIGHT
        };
        band + rows(self.above.len()) + rows(self.below.len()) + INSET
    }
}

/// How far down from the screen's top edge the scoreboard reaches for a game of `view`'s players.
///
/// Worked out rather than measured, because where the dock stands on the right edge is decided from
/// what the surfaces there will take before any of them is drawn.
pub(crate) fn panel_bottom(view: &MatchupView) -> f32 {
    PANEL_TOP + Sides::of(view).height()
}

/// What the watcher asked of the scoreboard this frame.
pub struct ScoreboardOutcome {
    /// Where the panel is on screen, for the host's hit testing and for the surfaces stacked under
    /// it.
    pub rect: Rect,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
}

/// Draws the scoreboard in the screen's top-right corner, `right_inset` in from where the corner's
/// margin would put it, fading and sliding it in and out. Returns nothing at all once it is gone.
pub fn render_scoreboard_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
    right_inset: f32,
) -> Option<ScoreboardOutcome> {
    let id = Id::new("sb_scoreboard");
    let area = Area::new(id)
        .anchor(
            Align2::RIGHT_TOP,
            vec2(-(WING_MARGIN + right_inset), PANEL_TOP),
        )
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        draw_panel(ui, view)
    })?;
    Some(ScoreboardOutcome {
        rect: inner.response.rect,
        toggled_vision: inner.inner,
    })
}

/// Draws the panel and reports which player was clicked.
fn draw_panel(ui: &mut Ui, view: &MatchupView) -> Option<u8> {
    let sides = Sides::of(view);
    let (rect, _) = ui.allocate_exact_size(vec2(PANEL_WIDTH, sides.height()), Sense::hover());
    let radius = theme::radius(PANEL_RADIUS);
    ui.painter().add(tiers::tier1_chrome(rect, radius));

    let mut clicked = None;
    let mut top = rect.top();
    let mut row = |ui: &mut Ui, top: &mut f32, player: &MatchupPlayerView| {
        let row = Rect::from_min_size(
            pos2(rect.left() + INSET, *top),
            vec2(rect.width() - INSET * 2.0, ROW_HEIGHT),
        );
        *top += ROW_HEIGHT + ROW_GAP;
        let response = ui.interact(
            row,
            ui.id().with(("scoreboard_player", player.player_id)),
            Sense::click(),
        );
        draw_row(ui, row, player);
        widgets::state_overlay(ui, &response, row, theme::radius(theme::RADIUS_TIGHT));
        if response.clicked() {
            clicked = Some(player.player_id);
        }
    };

    let band_corners = if sides.above.is_empty() {
        CornerRadius {
            nw: PANEL_RADIUS,
            ne: PANEL_RADIUS,
            sw: 0,
            se: 0,
        }
    } else {
        top += INSET;
        for player in &sides.above {
            row(ui, &mut top, player);
        }
        top += BAND_GAP - ROW_GAP;
        CornerRadius::ZERO
    };
    let band = Rect::from_min_size(pos2(rect.left(), top), vec2(rect.width(), BAND_HEIGHT));
    draw_band(ui, band, band_corners, view);
    top += BAND_HEIGHT + BAND_GAP;
    for player in &sides.below {
        row(ui, &mut top, player);
    }
    clicked
}

/// Draws the band between the sides: the clock and what is being watched over the identity column,
/// and the icon heading each number column over it.
fn draw_band(ui: &mut Ui, rect: Rect, corners: CornerRadius, view: &MatchupView) {
    // Inside the panel's own edge, so the panel's stroke stays unbroken down its sides.
    let fill = rect.shrink2(vec2(theme::HAIRLINE, 0.0));
    ui.painter()
        .rect_filled(fill, corners, theme::alpha(crate::colors::BLUE10, 0.55));
    let rule = Stroke::new(theme::HAIRLINE, theme::TIER1_DIVIDER);
    if corners == CornerRadius::ZERO {
        ui.painter()
            .hline(fill.x_range(), rect.top() + theme::HAIRLINE * 0.5, rule);
    }
    ui.painter()
        .hline(fill.x_range(), rect.bottom() - theme::HAIRLINE * 0.5, rule);

    let mut cursor = EdgeCursor::from_left(rect);
    cursor.skip(INSET);
    // The clock stands in line with the race chips and the tag ends where the names do.
    let identity = cursor.take(IDENTITY_WIDTH);
    let identity = identity
        .with_min_x(identity.left() + COLOR_BAR + BAR_GAP)
        .with_max_x(identity.right() - NAME_GAP);
    paint_text(
        ui,
        identity,
        &text::numeral(CLOCK_SIZE),
        &game_clock(view.elapsed_secs),
        Align::LEFT,
    );
    let tag = if view.is_replay {
        tr!("observer.replayTag", "Replay")
    } else {
        tr!("observer.liveTag", "Live")
    };
    let tag_rect = Align2::RIGHT_CENTER.align_size_within_rect(TAG_SIZE, identity);
    // The tag is placed rather than laid out, so it is drawn in a scope of its own: the kit's tags
    // take their space from whatever layout they are handed, and this one's place is the band's.
    ui.scope_builder(UiBuilder::new().max_rect(tag_rect), |ui| {
        widgets::tag_exact(
            ui,
            &text::column_label(),
            &tag,
            TagStyle::Amber,
            tag_rect.size(),
        );
    });

    // A heading stands over players of every race, so it takes the game's art in terran's, the
    // same as a total over players of different races does.
    for column in Column::ALL {
        let cell = cursor.take(column.width());
        let icon = Rect::from_center_size(cell.center(), Vec2::splat(COLUMN_ICON));
        let resource = |glyph| widgets::paint_resource_icon(ui.painter(), icon, glyph, None, 1.0);
        match column {
            Column::Supply => resource(ResourceGlyph::Supply),
            Column::Workers => paint_worker_heading(ui, cell, icon, &view.worker_icon),
            Column::Minerals => resource(ResourceGlyph::Minerals),
            Column::Gas => resource(ResourceGlyph::Gas),
            // The rate counts nothing an icon could stand for, and the three letters are what every
            // caster already calls it.
            Column::Apm => paint_text(
                ui,
                cell,
                &text::column_label(),
                &tr!("observer.apm", "APM"),
                Align::Center,
            ),
        }
    }
}

/// Paints the heading of the workers column in `cell`: the game's worker icon in `icon`, set in the
/// same chip as the resource icons beside it, or the worker's short code where the host has no
/// icon atlas to draw it from.
fn paint_worker_heading(ui: &Ui, cell: Rect, icon: Rect, worker: &ProductionIcon) {
    match worker.texture {
        Some(texture) => {
            let art = widgets::paint_icon_chip(ui.painter(), icon, 1.0);
            worker.paint(ui.painter(), texture, art, Color32::WHITE);
        }
        None => paint_text(
            ui,
            cell,
            &text::column_label(),
            &unit_codes::code_or_index(worker.index),
            Align::Center,
        ),
    }
}

/// Draws one player's row: the bar of their color, their race chip and their name, then their
/// numbers in the columns the band heads.
fn draw_row(ui: &Ui, rect: Rect, player: &MatchupPlayerView) {
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(rect);

    paint_player_bar(
        ui,
        centred(cursor.take(COLOR_BAR), rect.height() - theme::SPACE_XS),
        player.color,
        // The color bar keeps more of itself than the rest of a vision-less row: it is what says
        // whose row this is, and two rows dimmed alike are hard to tell apart at a glance.
        if player.vision { 1.0 } else { 0.5 },
    );
    cursor.skip(BAR_GAP);
    paint_picked_race_chip(
        ui,
        centred(cursor.take(CHIP), CHIP),
        player.race,
        player.random,
        alpha,
    );
    cursor.skip(CHIP_GAP);
    paint_text(
        ui,
        cursor.take(NAME_WIDTH),
        &text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &player.name,
        Align::LEFT,
    );
    cursor.skip(NAME_GAP);

    let value = text::numeral(VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha));
    // The rate is set a step quieter than the holdings: those are the reading, and the rate is
    // color on it.
    let rate = text::numeral(VALUE_SIZE).with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha));
    for column in Column::ALL {
        let cell = cursor.take(column.width());
        match column {
            Column::Supply => {
                // A supply block is production time a player is losing, so it is the one number on
                // the row that changes color.
                let color = if supply_blocked(player.supply_used, player.supply_max) {
                    theme::TEXT_NEGATIVE
                } else {
                    theme::TEXT_PRIMARY
                };
                paint_supply(ui, cell, player, color.gamma_multiply(alpha), alpha);
            }
            Column::Workers => paint_count(ui, cell, &value, player.workers, Align::Center),
            Column::Minerals => paint_count(ui, cell, &value, player.minerals, Align::Center),
            Column::Gas => paint_count(ui, cell, &value, player.gas, Align::Center),
            Column::Apm => paint_count(ui, cell, &rate, player.apm, Align::Center),
        }
    }
}

/// Paints the supply cell, centered in its column. What a player is on is the number being watched
/// and their cap is what it is read against, so the cap is set smaller and quieter.
fn paint_supply(ui: &Ui, rect: Rect, player: &MatchupPlayerView, color: Color32, alpha: f32) {
    let spec = text::numeral(VALUE_SIZE).with_color(color);
    let mut job = spec.job(&player.supply_used.to_string());
    job.append(
        &format!("/{}", player.supply_max),
        0.0,
        text::numeral(VALUE_SIZE * SUPPLY_CAP_RATIO)
            .with_color(theme::TEXT_DIM.gamma_multiply(alpha))
            .format(),
    );
    let galley = spec.layout(ui.ctx(), job);
    let size = galley.size();
    ui.painter().galley(
        pos2(
            rect.center().x - size.x * 0.5,
            rect.center().y - size.y * 0.5,
        ),
        galley,
        color,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observer::RaceView;

    fn view(teams: &[u8]) -> MatchupView {
        MatchupView {
            players: teams
                .iter()
                .enumerate()
                .map(|(index, &team)| MatchupPlayerView {
                    player_id: index as u8,
                    team,
                    name: String::new(),
                    color: Color32::WHITE,
                    race: RaceView::Random,
                    random: false,
                    vision: true,
                    minerals: 0,
                    gas: 0,
                    supply_used: 0,
                    supply_max: 0,
                    workers: 0,
                    apm: 0,
                })
                .collect(),
            elapsed_secs: 0,
            is_replay: false,
            worker_icon: ProductionIcon {
                texture: None,
                index: 0x07,
                size: None,
                margin: 0.0,
                wireframe: None,
            },
        }
    }

    fn ids(players: &[&MatchupPlayerView]) -> Vec<u8> {
        players.iter().map(|player| player.player_id).collect()
    }

    #[test]
    fn a_game_of_two_sides_puts_the_band_between_them() {
        let view = view(&[1, 1, 2, 2]);
        let sides = Sides::of(&view);
        assert_eq!(ids(&sides.above), [0, 1]);
        assert_eq!(ids(&sides.below), [2, 3]);
    }

    #[test]
    fn any_other_game_has_the_band_at_its_head() {
        for teams in [&[1, 2, 3][..], &[1, 1], &[1], &[]] {
            let view = view(teams);
            let sides = Sides::of(&view);
            assert!(sides.above.is_empty());
            assert_eq!(sides.below.len(), teams.len());
        }
    }

    #[test]
    fn the_panel_grows_by_a_row_for_each_player() {
        let duel = Sides::of(&view(&[1, 2])).height();
        let pairs = Sides::of(&view(&[1, 1, 2, 2])).height();
        assert_eq!(pairs - duel, (ROW_HEIGHT + ROW_GAP) * 2.0);
    }
}
