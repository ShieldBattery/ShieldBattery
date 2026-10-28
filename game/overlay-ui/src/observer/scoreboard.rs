//! The scoreboard: every player and the numbers a watcher checks constantly, packed into one panel
//! in the screen's top-right corner.
//!
//! It is a stats wing, the top of the column the wings make down the right edge, built from the
//! same pieces they are: the same chrome and title row, with the game clock in the middle of it, a
//! row of column headings, and a row per player led by the square of their color and their name,
//! ruled into sides where the sides have players to tell apart. Its row carries the player's race
//! icon too, and its headings are icons for what each column counts, short of the rate, which keeps
//! the name casters give it. Each player is named once, on one row, so the columns are labeled once
//! for the whole game rather than once per player.
//!
//! A click on a row takes that player's vision, as it does everywhere a player is named, and a
//! player whose vision is off is dimmed rather than dropped.

use egui::{Align, Context, Id, Rect, Sense, Ui, Vec2, pos2, vec2};

use crate::kit::text::{self, TextSpec};
use crate::kit::widgets::{self, ColumnGlyph};
use crate::kit::{theme, tiers};
use crate::observer::matchup::supply_blocked;
use crate::observer::{
    EdgeCursor, MatchupPlayerView, MatchupView, STAT_BAR_GAP, STAT_COLOR_BAR, STAT_HEADING_HEIGHT,
    STAT_RACE_ICON, STAT_RACE_ICON_GAP, STAT_ROW_GAP, STAT_ROW_HEIGHT, STAT_VALUE_SIZE, StatRace,
    WING_MARGIN, Wing, game_clock, paint_count, paint_first_team_name, paint_stat_identity,
    paint_team_divider, paint_text, teams_worth_dividing, vision_alpha, wing_panel,
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

    /// How wide the column is. A column's heading is centered in it, and so is its number, short of
    /// supply's, which stands on its slash in the middle. The widths are what keeps two neighbors'
    /// numbers apart at their longest: three digits either side of supply's slash, three of
    /// workers, four of a rate, and five of a bank.
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

/// Height of the row of column headings. Taller than a wing's, whose headings are words: these are
/// icons, which want the size of a number beside them to be told apart at a glance.
const HEADING_HEIGHT: f32 = 18.0;

/// Size of the glyphs heading the number columns, which fill their row.
const COLUMN_ICON: f32 = HEADING_HEIGHT;

/// Text size of the game clock in the middle of the title row.
const CLOCK_SIZE: f32 = 16.0;

/// What the watcher asked of the scoreboard this frame.
pub struct ScoreboardOutcome {
    /// Where the panel is on screen, for the host's hit testing and for the surfaces stacked under
    /// it.
    pub rect: Rect,
    /// The player whose vision was asked to change, if one was clicked.
    pub toggled_vision: Option<u8>,
}

/// Draws the scoreboard at the top of the screen's right edge, fading and sliding it in and out.
/// Returns nothing at all once it is gone.
pub fn render_scoreboard_view(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<ScoreboardOutcome> {
    let inner = wing_panel(
        ctx,
        Id::new("sb_scoreboard"),
        Wing::Right,
        WING_MARGIN,
        PANEL_WIDTH,
        shown,
        |ui| draw_panel(ui, view),
    )?;
    Some(ScoreboardOutcome {
        rect: inner.response.rect,
        toggled_vision: inner.inner,
    })
}

/// Draws the panel's contents and reports which player was clicked.
fn draw_panel(ui: &mut Ui, view: &MatchupView) -> Option<u8> {
    let title = tr!("observer.panelMatchup", "Matchup");
    let header = widgets::panel_header(ui, &title, Panel::Matchup.key_label().as_deref());
    draw_clock(ui, header.rect, &title, view.elapsed_secs);
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
    let mut clicked = None;
    for player in &view.players {
        if divided && side != Some(player.team) {
            side = Some(player.team);
            ui.add_space(STAT_ROW_GAP);
            let (row, _) =
                ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_HEADING_HEIGHT), Sense::hover());
            paint_team_divider(ui, row, player.team);
        }
        ui.add_space(STAT_ROW_GAP);
        let (row, response) =
            ui.allocate_exact_size(vec2(CONTENT_WIDTH, STAT_ROW_HEIGHT), Sense::click());
        draw_row(ui, row, player);
        widgets::state_overlay(ui, &response, row, theme::radius(theme::RADIUS_TIGHT));
        if response.clicked() {
            clicked = Some(player.player_id);
        }
    }
    clicked
}

/// Draws the game clock in the middle of the title row, `header`, whose title is `title`.
///
/// Set on the title's letters rather than in the middle of the row: the title is small capitals and
/// the clock figures, each sitting at its own height in the box its face leaves around it, and the
/// two read as one line only where their letters do.
fn draw_clock(ui: &Ui, header: Rect, title: &str, elapsed_secs: u64) {
    let title = text::panel_title().galley(ui, title);
    let letters_middle =
        header.center().y - title.size().y * 0.5 + text::ink_bounds(&title).center().y;
    let spec = text::numeral(CLOCK_SIZE).with_color(theme::TIER0_HEADER);
    let clock = spec.galley(ui, &game_clock(elapsed_secs));
    let top = letters_middle - text::ink_bounds(&clock).center().y;
    ui.painter().galley(
        pos2(header.center().x - clock.size().x * 0.5, top),
        clock,
        spec.color,
    );
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
            Column::Supply => glyph(ColumnGlyph::Supply),
            Column::Workers => glyph(ColumnGlyph::Workers),
            Column::Minerals => glyph(ColumnGlyph::Minerals),
            Column::Gas => glyph(ColumnGlyph::Gas),
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
/// race icon, then their numbers in the columns the headings name.
fn draw_row(ui: &Ui, rect: Rect, player: &MatchupPlayerView) {
    let alpha = vision_alpha(player.vision);
    let mut cursor = EdgeCursor::from_left(rect);
    paint_stat_identity(
        ui,
        &mut cursor,
        Some(StatRace {
            race: player.race,
            random: player.random,
        }),
        NAME_WIDTH,
        &player.name,
        player.color,
        alpha,
    );
    cursor.skip(NAME_GAP);

    let value =
        text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha));
    // The rate is set a step quieter than the holdings: those are the reading, and the rate is
    // color on it.
    let rate =
        text::numeral(STAT_VALUE_SIZE).with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha));
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
                paint_supply(
                    ui,
                    cell,
                    &value.clone().with_color(color.gamma_multiply(alpha)),
                    player.supply_used,
                    player.supply_max,
                );
            }
            Column::Workers => paint_count(ui, cell, &value, player.workers, Align::Center),
            Column::Minerals => paint_count(ui, cell, &value, player.minerals, Align::Center),
            Column::Gas => paint_count(ui, cell, &value, player.gas, Align::Center),
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
        }
    }

    /// How tall the panel settles for a game whose players are on `teams`.
    fn height(teams: &[u8]) -> f32 {
        let view = view(teams);
        settled_rect(|ctx| render_scoreboard_view(&view, ctx, true).map(|outcome| outcome.rect))
            .expect("the scoreboard is drawn")
            .height()
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
