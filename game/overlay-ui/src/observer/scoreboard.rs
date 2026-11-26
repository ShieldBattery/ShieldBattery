//! The scoreboard: every player and the numbers a watcher checks constantly, packed into one panel
//! in the screen's top-right corner.
//!
//! It is a stats wing, the top of the column the wings make down the right edge, built from the
//! same pieces they are: the same chrome and title row, a row of column headings, and a row per
//! player led by the square of their color and their name, ruled into sides where the sides have
//! players to tell apart. Its row carries the player's race icon too, and its headings are icons for
//! what each column counts, short of the rate, which keeps the name casters give it. Each player is
//! named once, on one row, so the columns are labeled once for the whole game rather than once per
//! player.
//!
//! A click on a row takes that player's vision, as it does everywhere a player is named, and a
//! player whose vision is off is dimmed rather than dropped.

use egui::{Align, Context, Rect, Sense, Ui, Vec2, pos2, vec2};

use crate::kit::text::{self, TextSpec};
use crate::kit::widgets::{self, ColumnGlyph};
use crate::kit::{theme, tiers};
use crate::observer::layout;
use crate::observer::matchup::{SeriesLine, SeriesView, supply_blocked};
use crate::observer::{
    EdgeCursor, MatchupPlayerView, MatchupView, STAT_BAR_GAP, STAT_COLOR_BAR, STAT_HEADING_HEIGHT,
    STAT_RACE_ICON, STAT_RACE_ICON_GAP, STAT_ROW_GAP, STAT_ROW_HEIGHT, STAT_VALUE_SIZE, StatRace,
    Wing, WingTitle, paint_count, paint_first_team_name, paint_stat_identity, paint_team_divider,
    paint_text, teams_worth_dividing, vision_alpha, wing_panel,
};
use crate::shell::Panel;
use crate::tr;

/// How wide the panel is, in overlay points: the width of the wings stacked under it on the right
/// edge, so the column they make together is one width from top to bottom.
pub const PANEL_WIDTH: f32 = super::graphs::PANEL_WIDTH;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - tiers::PANEL_MARGIN_WIDTH;

/// Gap between the name and the first number.
const NAME_GAP: f32 = 6.0;

/// Width of what leads a row and says whose it is, up to the first number: whatever the number
/// columns leave of the room inside the panel's chrome.
const IDENTITY_WIDTH: f32 = {
    let mut width = CONTENT_WIDTH;
    let mut index = 0;
    while index < Column::ALL.len() {
        width -= Column::ALL[index].width();
        index += 1;
    }
    width
};

/// Width the player's name is laid out in: what the identity leaves of itself. Fixed, because a
/// name is player-chosen: one longer than its slot would otherwise push every number beside it out
/// of its column.
const NAME_WIDTH: f32 =
    IDENTITY_WIDTH - STAT_COLOR_BAR - STAT_BAR_GAP - STAT_RACE_ICON - STAT_RACE_ICON_GAP - NAME_GAP;

/// Width of the column a side's series score stands in, leading its rows in a series game.
const SCORE_COLUMN: f32 = 26.0;

/// Gap between the score column and the hairline that walls it off from the rows' identities, and
/// between the hairline and the square of color that leads each row.
const SCORE_RULE_GAP: f32 = 6.0;
const SCORE_SWATCH_GAP: f32 = 7.0;

/// How far short of its side's rows the hairline beside the score column stops, top and bottom.
const SCORE_RULE_INSET: f32 = 3.0;

/// How much of a row's identity the series scores take in a series game: the room every row's
/// identity moves right by, and the name gives up, since the number columns keep their widths and
/// the panel its own.
const SCORE_LEAD: f32 = SCORE_COLUMN + SCORE_RULE_GAP + theme::HAIRLINE + SCORE_SWATCH_GAP;

/// Text size of a series score.
const SCORE_SIZE: f32 = 26.0;

// The name gives up the room and still holds a name a watcher recognizes.
const _: () = assert!(NAME_WIDTH - SCORE_LEAD >= 96.0);

/// A number column, in the order a row reads them: the bank and supply in the order StarCraft's own
/// resource readout gives them, with workers ahead of supply and the rate last.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Column {
    Minerals,
    Gas,
    Workers,
    Supply,
    Apm,
}

impl Column {
    const ALL: [Column; 5] = [
        Column::Minerals,
        Column::Gas,
        Column::Workers,
        Column::Supply,
        Column::Apm,
    ];

    /// How wide the column is. A column's heading is centered in it, and so is its number, short of
    /// supply's, which stands on its slash in the middle. The widths are what keeps two neighbors'
    /// numbers apart at their longest: five digits of a bank, three of workers, three either side
    /// of supply's slash, and four of a rate.
    const fn width(self) -> f32 {
        match self {
            Column::Minerals => 56.0,
            Column::Gas => 56.0,
            Column::Workers => 44.0,
            Column::Supply => 74.0,
            Column::Apm => 44.0,
        }
    }
}

/// Height of the row of column headings. Taller than a wing's, whose headings are words: these are
/// icons, which want the size of a number beside them to be told apart at a glance.
const HEADING_HEIGHT: f32 = 18.0;

/// Size of the glyphs heading the number columns, which fill their row.
const COLUMN_ICON: f32 = HEADING_HEIGHT;

/// What the watcher asked of the scoreboard this frame.
pub struct ScoreboardOutcome {
    /// Where the panel is on screen, for the host's hit testing and for the surfaces stacked under
    /// it.
    pub rect: Rect,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
    /// Whether the keycap on its title row was clicked, which puts the matchup away as its key
    /// does.
    pub closed: bool,
}

/// Draws the scoreboard at the top of the screen's right edge, fading and sliding it in and out.
/// Returns nothing at all once it is gone.
pub fn render_scoreboard_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<ScoreboardOutcome> {
    let series_line = view
        .shown_series()
        .map(|series| move |ui: &Ui, room: Rect| paint_series_line(ui, room, series));
    let title = WingTitle {
        panel: Panel::Matchup,
        aside: series_line
            .as_ref()
            .map(|paint| paint as widgets::HeaderAside<'_>),
    };
    let wing = wing_panel(
        ctx,
        title,
        Wing::Right,
        layout::screen_margin(ctx.viewport_rect()),
        PANEL_WIDTH,
        shown,
        |ui| draw_panel(ui, view),
    )?;
    Some(ScoreboardOutcome {
        rect: wing.rect,
        toggled_vision: wing.inner,
        closed: wing.closed,
    })
}

/// Paints the series line into `room`, the title row's room after the panel's title: a dot, then
/// the series' title where it has one and there is room for it, then how far into the series this
/// game is, which always stays whole.
fn paint_series_line(ui: &Ui, room: Rect, series: &SeriesView) {
    let line = SeriesLine::lay_out(ui.ctx(), series, series_line_room(room.width()), true);
    line.paint(ui, room.left(), room.center().y);
}

/// Gap kept between the series line and the keycap at the end of the title row, so the line stops
/// short of the keycap rather than running into it.
const KEYCAP_GAP: f32 = theme::SPACE_SM;

/// How much of the `room` after the panel's title the series line is laid out in.
fn series_line_room(room: f32) -> f32 {
    (room - KEYCAP_GAP).max(0.0)
}

/// Draws the panel's contents under its title row, and reports which player was clicked.
///
/// In a series game each side's score leads its rows, as tall as the side's rows together, and
/// every row's identity moves right to make the room. Nothing is added under or over the rows, so
/// the panel is exactly as tall as it is in a game with no series, and the wings stacked under it
/// stay where they are.
fn draw_panel(ui: &mut Ui, view: &MatchupView) -> Option<u8> {
    let series = view.shown_series();
    let divided = teams_worth_dividing(view.players.iter().map(|player| player.team));
    let (headings, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, HEADING_HEIGHT), Sense::hover());
    draw_headings(
        ui,
        headings,
        view.players
            .first()
            .map(|player| player.team)
            .filter(|_| divided),
    );
    let mut side = view.players.first().map(|player| player.team);
    // The rows each side's players take, in the order the sides are listed.
    let mut sides: Vec<Rect> = Vec::new();
    let mut clicked = None;
    for player in &view.players {
        let new_side = side != Some(player.team);
        if new_side {
            side = Some(player.team);
        }
        if divided && new_side {
            ui.add_space(STAT_ROW_GAP);
            let (row, _) =
                ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
            paint_team_divider(ui, row, player.team);
        }
        ui.add_space(STAT_ROW_GAP);
        let (row, response) =
            ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_ROW_HEIGHT), Sense::click());
        draw_row(ui, row, player, series.is_some());
        widgets::state_overlay(ui, &response, row, theme::radius(theme::RADIUS_TIGHT));
        if response.clicked() {
            clicked = Some(player.player_id);
        }
        match sides.last_mut() {
            Some(rows) if !new_side => *rows = rows.union(row),
            _ => sides.push(row),
        }
    }
    if let Some(series) = series {
        let colors = series.score_colors();
        for ((rows, score), color) in sides.into_iter().zip(series.scores).zip(colors) {
            paint_side_score(ui, rows, score, color);
        }
    }
    clicked
}

/// Paints a side's series score at the head of `rows`, the rows its players take: centered down
/// them in the score column, and walled off from the rows' identities by a hairline that runs down
/// them.
fn paint_side_score(ui: &Ui, rows: Rect, score: u32, color: egui::Color32) {
    let column = Rect::from_min_max(
        rows.left_top(),
        pos2(rows.left() + SCORE_COLUMN, rows.bottom()),
    );
    paint_text(
        ui,
        column,
        &text::numeral_strong(SCORE_SIZE).with_color(color),
        &score.to_string(),
        Align::Center,
    );
    let x = column.right() + SCORE_RULE_GAP + theme::HAIRLINE * 0.5;
    ui.painter().add(egui::Shape::line_segment(
        [
            pos2(x, rows.top() + SCORE_RULE_INSET),
            pos2(x, rows.bottom() - SCORE_RULE_INSET),
        ],
        egui::Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
    ));
}

/// Draws the row of column headings: the icon heading each number column, and over the names the
/// team a divided table opens with, `first_team`, as a wing's headings row names it.
fn draw_headings(ui: &Ui, rect: Rect, first_team: Option<u8>) {
    let mut cursor = EdgeCursor::from_left(rect);
    let names = cursor.take(IDENTITY_WIDTH);
    if let Some(team) = first_team {
        paint_first_team_name(ui, names, team);
    }
    for column in Column::ALL {
        let cell = cursor.take(column.width());
        let icon = Rect::from_center_size(cell.center(), Vec2::splat(COLUMN_ICON));
        let glyph = |glyph| widgets::paint_column_glyph(ui.painter(), icon, glyph, 1.0);
        match column {
            Column::Minerals => glyph(ColumnGlyph::Minerals),
            Column::Gas => glyph(ColumnGlyph::Gas),
            Column::Workers => glyph(ColumnGlyph::Workers),
            Column::Supply => glyph(ColumnGlyph::Supply),
            // The rate counts nothing an icon could stand for, and the three letters are what every
            // caster already calls it.
            Column::Apm => paint_heading_label(ui, cell, &tr!("observer.apm", "APM")),
        }
    }
}

/// Paints a word heading a column, centered in `cell` by its letters rather than by the box its
/// face leaves around them, so it sits on the same middle as the icons beside it.
fn paint_heading_label(ui: &Ui, cell: Rect, label: &str) {
    let spec = text::column_label();
    let galley = spec.layout(ui.ctx(), spec.job_truncated(label, cell.width()));
    let ink = text::ink_bounds(&galley);
    ui.painter().galley(
        pos2(
            cell.center().x - galley.size().x * 0.5,
            cell.center().y - ink.center().y,
        ),
        galley,
        spec.color,
    );
}

/// Draws one player's row: the identity every stats wing leads a row with, here with the player's
/// race icon, then their numbers in the columns the headings name. Where `scored`, the identity
/// stands after the room the series scores take, and the name gives that room up.
fn draw_row(ui: &Ui, rect: Rect, player: &MatchupPlayerView, scored: bool) {
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(rect);
    let lead = if scored { SCORE_LEAD } else { 0.0 };
    cursor.skip(lead);
    paint_stat_identity(
        ui,
        &mut cursor,
        Some(StatRace {
            race: player.race,
            random: player.random,
        }),
        NAME_WIDTH - lead,
        &player.name,
        player.color,
        alpha,
    );
    cursor.skip(NAME_GAP);

    let value =
        text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha));
    // The two banks stand side by side in columns of one width, named only by the icons heading
    // them, so each is set in the color its icon is drawn in: that carries the name down to every
    // row, and the two read apart without a look back up at the headings.
    let minerals = value
        .clone()
        .with_color(theme::RESOURCE_MINERALS.gamma_multiply(alpha));
    let gas = value
        .clone()
        .with_color(theme::RESOURCE_GAS.gamma_multiply(alpha));
    // The rate is set a step quieter than the holdings: those are the reading, and the rate is
    // color on it.
    let rate =
        text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha));
    for column in Column::ALL {
        let cell = cursor.take(column.width());
        match column {
            Column::Minerals => paint_count(ui, cell, &minerals, player.minerals, Align::Center),
            Column::Gas => paint_count(ui, cell, &gas, player.gas, Align::Center),
            Column::Workers => paint_count(ui, cell, &value, player.workers, Align::Center),
            Column::Supply => {
                // A supply block is production time a player is losing, so it is the one number on
                // the row that changes color.
                let color = if supply_blocked(player.supply_used, player.supply_max) {
                    theme::TEXT_NEGATIVE
                } else {
                    theme::TEXT_PRIMARY
                };
                paint_supply(
                    ui,
                    cell,
                    &value.clone().with_color(color.gamma_multiply(alpha)),
                    player.supply_used,
                    player.supply_max,
                );
            }
            Column::Apm => paint_count(ui, cell, &rate, player.apm, Align::Center),
        }
    }
}

/// Paints a supply count against its cap with the slash between them on the middle of `cell`: the
/// count set against the slash from the left and the cap from the right, so the slash holds still
/// as either gains a digit and lines up down the column.
fn paint_supply(ui: &Ui, cell: Rect, spec: &TextSpec, used: u32, max: u32) {
    let middle = cell.center().x;
    let half_slash = spec.galley(ui, "/").size().x * 0.5;
    paint_text(ui, cell, spec, "/", Align::Center);
    paint_text(
        ui,
        cell.with_max_x(middle - half_slash),
        spec,
        &used.to_string(),
        Align::RIGHT,
    );
    paint_text(
        ui,
        cell.with_min_x(middle + half_slash),
        spec,
        &max.to_string(),
        Align::LEFT,
    );
}

#[cfg(test)]
mod tests {
    use egui::Color32;

    use super::*;
    use crate::observer::RaceView;
    use crate::observer::test_support::settled_rect;

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
            series: None,
        }
    }

    /// How tall the panel settles for a game whose players are on `teams`.
    fn height(teams: &[u8]) -> f32 {
        height_of(&view(teams))
    }

    fn height_of(view: &MatchupView) -> f32 {
        settled_rect(|ctx| render_scoreboard_view(view, ctx, true).map(|outcome| outcome.rect))
            .expect("the scoreboard is drawn")
            .height()
    }

    /// A series as long as a series line gets: a best of ninety-nine at twelve to eleven going
    /// into its twenty-fourth game, under fifty of the widest letter as its title.
    fn longest_series() -> SeriesView {
        SeriesView {
            title: Some("W".repeat(50)),
            format: crate::observer::SeriesFormat::BestOf { length: 99 },
            game_number: 24,
            scores: [12, 11],
        }
    }

    #[test]
    fn a_series_leaves_the_panel_exactly_as_tall_as_it_was() {
        for teams in [
            &[1, 2][..],
            &[1, 1, 2, 2],
            &[1, 1, 1, 2, 2, 2],
            &[1, 1, 1, 1, 2, 2, 2, 2],
        ] {
            let scored = MatchupView {
                series: Some(longest_series()),
                ..view(teams)
            };
            assert!(scored.shown_series().is_some());
            assert_eq!(height_of(&scored), height(teams), "{teams:?}");
        }
    }

    #[test]
    fn a_series_takes_its_room_from_the_names_alone() {
        assert_eq!(NAME_WIDTH, 138.0);
        assert_eq!(SCORE_LEAD, 40.0);
        assert_eq!(NAME_WIDTH - SCORE_LEAD, 98.0);
    }

    #[test]
    fn the_series_line_stays_whole_in_the_title_row_and_short_of_the_keycap() {
        use std::cell::Cell;

        let room = Cell::new(None);
        settled_rect(|ctx| {
            let aside = |_: &Ui, rect: Rect| room.set(Some(rect));
            wing_panel(
                ctx,
                WingTitle {
                    panel: Panel::Matchup,
                    aside: Some(&aside),
                },
                Wing::Right,
                0.0,
                PANEL_WIDTH,
                true,
                |_| (),
            )
            .map(|wing| wing.rect)
        })
        .expect("the panel is drawn");
        let room = room.get().expect("the title row hands over its room");
        let (whole, width) =
            crate::observer::test_support::settled_at(egui::vec2(1280.0, 720.0), |ctx| {
                let line = SeriesLine::lay_out(
                    ctx,
                    &longest_series(),
                    series_line_room(room.width()),
                    true,
                );
                Some((line.progress_whole(), line.width()))
            })
            .expect("the line is laid out");
        assert!(whole);
        assert!(
            width <= room.width() - KEYCAP_GAP + 0.01,
            "{width} in {room:?}"
        );
    }

    #[test]
    fn a_four_digit_rate_fits_its_column_whole() {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx.begin_pass(egui::RawInput::default());
        let spec = text::numeral(STAT_VALUE_SIZE);
        let fitted = crate::observer::fit_count(&ctx, &spec, 8888, Column::Apm.width());
        // A layout check has no GPU texture store to hand the atlas to.
        ctx.end_pass().textures_delta.clear();
        assert_eq!(fitted, "8888");
    }

    #[test]
    fn a_full_supply_fits_whole_either_side_of_its_slash() {
        let ctx = egui::Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx.begin_pass(egui::RawInput::default());
        let spec = text::numeral(STAT_VALUE_SIZE);
        let width = |text: &str| spec.layout(&ctx, spec.job(text)).size().x;
        let side = (Column::Supply.width() - width("/")) * 0.5;
        let count = width("200");
        // A layout check has no GPU texture store to hand the atlas to.
        ctx.end_pass().textures_delta.clear();
        assert!(
            count <= side,
            "{count} is wider than the {side} beside the slash"
        );
    }

    #[test]
    fn a_game_is_ruled_between_its_sides_only_where_a_side_has_players_to_tell_apart() {
        let duel = height(&[1, 2]);
        let four_sides = height(&[1, 2, 3, 4]);
        let two_pairs = height(&[1, 1, 2, 2]);
        assert!((four_sides - duel - 2.0 * (STAT_ROW_GAP + STAT_ROW_HEIGHT)).abs() < 0.5);
        assert!((two_pairs - four_sides - (STAT_ROW_GAP + STAT_HEADING_HEIGHT)).abs() < 0.5);
    }
}
