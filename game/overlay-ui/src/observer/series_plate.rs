//! The series plate: the series a live game is one of, on a plate of its own at the top of the
//! screen while the matchup bar is not there to carry it.
//!
//! It is how the series panel ([`Panel::Series`](crate::shell::Panel::Series)) is drawn whenever
//! the bar is not up: with the matchup as the compact scoreboard in the corner, with the matchup
//! turned off, and with the bar put away. It hangs from the top edge at the middle like a short
//! matchup bar with nothing of the game's own on it, since the Matchup panel carries the clock and
//! the numbers: at each end a side, then that side's score in a cell, and between the two scores a
//! block reading the format over the game number. The tab the bar hangs under its middle hangs under
//! the plate's as well, carrying what of the series the plate does not say itself.
//!
//! A side of one player is named by them and a side of two by both, stacked; a side of three or
//! more is named by its label, since a grid of names on a plate this size would be the team cards
//! over again, and too small to read.

use std::sync::Arc;

use egui::{Align2, Area, Color32, Context, Galley, Id, Order, Rect, Sense, Ui, pos2, vec2};

use crate::kit::text::{self, TextSpec};
use crate::kit::{motion, theme, tiers};
use crate::observer::matchup::{
    self, BAR_RADIUS, CHIP, CHIP_GAP, COLOR_BAR, MIN_NAME_WIDTH, NAME_SIZE, NAME_WIDTH, PAD_INNER,
    PAD_OUTER, SCORE_CELL, STACKED_CHIP, STACKED_NAME_SIZE, SeriesFormat, SeriesView, TabAnchor,
};
use crate::observer::{
    EdgeCursor, MatchupPlayerView, MatchupView, TeamNames, centred, map_control,
    paint_picked_race_chip, paint_player_bar, paint_text, team_name,
};
use crate::{tr, tr_plural};

/// How tall the plate is with one player, or a side's label, at each end.
const PLATE_HEIGHT: f32 = 56.0;

/// How tall it is with two players stacked at an end.
const STACKED_PLATE_HEIGHT: f32 = 72.0;

/// The narrowest the middle block is, so a short format and game number still read as a block of
/// their own between the two scores rather than as a seam.
const MIDDLE_MIN_WIDTH: f32 = 96.0;

/// Padding either side of the middle block's rows, and the gap between the two.
const MIDDLE_PAD: f32 = 12.0;
const MIDDLE_ROW_GAP: f32 = 2.0;

/// Gap between a side's color edge and its score cell, on a plate with no room for the side's
/// names.
const BARE_EDGE_GAP: f32 = theme::SPACE_XS;

/// What the watcher asked of the plate this frame, and where it is.
pub struct SeriesPlateOutcome {
    /// Where the plate is on screen, then the tab hung under it where it hangs one, for the host's
    /// hit testing and for the surfaces placed under them.
    pub rects: Vec<Rect>,
    /// How far down the screen the plate reaches once it has settled, the tab under it included:
    /// what a surface hung under the plate clears. Settled rather than eased, so a surface placed
    /// under it eases to its place once rather than following the plate's entrance.
    pub depth: f32,
}

/// Draws the series plate at the middle of the top edge, fading and sliding it in and out. Returns
/// nothing at all once it is gone, or for a game with no series to show.
///
/// The plate keeps to the room between the stats wings, measured as the map-control strip measures
/// it: against the wider of the two wings, whether or not either is up. That is the room the
/// Economy wing and the Matchup panel leave it in the compact style, and no more than the wings
/// leave it with the matchup off.
pub fn render_series_plate(
    view: &MatchupView,
    ctx: &Context,
    shown: bool,
) -> Option<SeriesPlateOutcome> {
    let series = view.shown_series()?;
    let id = Id::new("sb_series_plate");
    let presence = id.with("presence");
    // Laid out only while it is on screen or on its way on or off: a plate nobody sees has no text
    // worth putting into the font atlas every frame.
    motion::enter_exit(ctx, presence, shown)?;
    let room = map_control::room_between_wings(ctx.viewport_rect());
    let plate = Plate::lay_out(ctx, view, series, room);
    let anchor = plate.tab_anchor();
    let depth = plate.height + matchup::series_tab_height(series, anchor).unwrap_or(0.0);
    let area = Area::new(id)
        .anchor(Align2::CENTER_TOP, vec2(0.0, 0.0))
        .order(Order::Foreground);
    let inner = motion::presence_area_from_top(ctx, presence, shown, area, |ui| {
        plate.draw(ui, series, room)
    })?;
    let mut rects = vec![inner.response.rect];
    rects.extend(inner.inner.into_iter().flatten());
    Some(SeriesPlateOutcome { rects, depth })
}

/// What a side is named by on the plate.
enum PlateSide<'a> {
    /// Its players, one or two of them.
    Players(Vec<&'a MatchupPlayerView>),
    /// Its label, for a side of three or more: `color` is its first player's, which is the edge
    /// the label stands against.
    Team { label: String, color: Color32 },
}

impl PlateSide<'_> {
    /// Whether this side stacks two players at its end of the plate.
    fn stacked(&self) -> bool {
        matches!(self, PlateSide::Players(players) if players.len() == 2)
    }
}

/// How the plate's sides are drawn in the room it has.
#[derive(Copy, Clone, PartialEq, Debug)]
enum SidesForm {
    /// Named, each name laid out in `name_width` points.
    Named { name_width: f32 },
    /// The color edge alone, for a plate with too little room for a side's name to read: the plate
    /// is then its two scores and the block between them.
    Bare,
}

/// The block between the two scores: the format over the game number, laid out once a frame.
struct MiddleBlock {
    format: Arc<Galley>,
    game: Arc<Galley>,
    width: f32,
}

impl MiddleBlock {
    /// The style both of the block's rows are set in.
    fn spec() -> TextSpec {
        text::column_label().with_color(theme::TEXT_SECONDARY)
    }

    /// Lays the block out for `series`. Neither row ever gives way: the block is as wide as the
    /// wider of them and its padding, never narrower than [`MIDDLE_MIN_WIDTH`], and a whole number
    /// of points either side of the plate's middle line.
    fn lay_out(ctx: &Context, series: &SeriesView) -> MiddleBlock {
        let spec = MiddleBlock::spec();
        let format = spec.layout(ctx, spec.job(&format_label(series)));
        let game = spec.layout(ctx, spec.job(&game_label(series)));
        let text = format.size().x.max(game.size().x);
        let width = even((text + MIDDLE_PAD * 2.0).max(MIDDLE_MIN_WIDTH));
        MiddleBlock {
            format,
            game,
            width,
        }
    }

    /// Paints the two rows centered in `rect`, one over the other.
    fn paint(&self, ui: &Ui, rect: Rect) {
        let height = self.format.size().y + MIDDLE_ROW_GAP + self.game.size().y;
        let pixels_per_point = ui.ctx().pixels_per_point();
        let mut top = rect.center().y - height * 0.5;
        for galley in [&self.format, &self.game] {
            let left = rect.center().x - galley.size().x * 0.5;
            let at = egui::emath::GuiRounding::round_to_pixels(pos2(left, top), pixels_per_point);
            ui.painter()
                .galley(at, galley.clone(), MiddleBlock::spec().color);
            top += galley.size().y + MIDDLE_ROW_GAP;
        }
    }
}

/// What the middle block says the series is played as.
fn format_label(series: &SeriesView) -> String {
    match series.format {
        SeriesFormat::BestOf { length } => tr_plural!(
            "observer.seriesBestOf",
            length,
            one = "Best of {{count}}",
            other = "Best of {{count}}"
        ),
    }
}

/// What the middle block says about which game of the series this is.
fn game_label(series: &SeriesView) -> String {
    tr!(
        "observer.seriesGame",
        "Game {{game}}",
        game = series.game_number
    )
}

/// The nearest even number of whole points at least `width`, so a surface centered on the screen's
/// middle line lands on whole pixels.
fn even(width: f32) -> f32 {
    (width * 0.5).ceil() * 2.0
}

/// The plate laid out for the room it has.
struct Plate<'a> {
    /// The side listed first, at the left end, then the other.
    sides: [PlateSide<'a>; 2],
    form: SidesForm,
    /// Whether a side stacks two named players at its end, which sets the plate's height and the
    /// size its names and race chips are drawn at.
    stacked: bool,
    middle: MiddleBlock,
    width: f32,
    height: f32,
}

impl<'a> Plate<'a> {
    /// Lays the plate out for `view`'s `series` in `room` points of the screen's width.
    ///
    /// The plate wants each name laid out in the bar's own name slot. Where that is wider than the
    /// room, the names give way first: both sides' slots narrow alike, down to the narrowest that
    /// still reads as a name with its end elided ([`MIN_NAME_WIDTH`]). With too little room even for
    /// that the sides drop their names and race icons, keeping only their color edges, and the plate
    /// is the two scores and the block between them. The format and the game number never shorten,
    /// so a room narrower than those three, which no screen the game runs at comes near, is left
    /// with the plate overrunning it rather than with a format nobody can read.
    fn lay_out(ctx: &Context, view: &'a MatchupView, series: &SeriesView, room: f32) -> Plate<'a> {
        // A side is labelled by the number the game gives its team, which in a series game is its
        // place in the series, the side listed first being the first.
        let side = |team: Option<u8>, position: u8, players: Vec<&'a MatchupPlayerView>| {
            if players.len() <= 2 {
                PlateSide::Players(players)
            } else {
                PlateSide::Team {
                    label: team_name(&TeamNames::default(), team.unwrap_or(position)),
                    color: players
                        .first()
                        .map_or(Color32::WHITE, |player| player.color),
                }
            }
        };
        let [(first_team, first), (second_team, second)] = view.halves().each();
        let sides = [side(first_team, 1, first), side(second_team, 2, second)];
        let middle = MiddleBlock::lay_out(ctx, series);
        let core = middle.width + SCORE_CELL * 2.0;
        let mut stacked = sides.iter().any(PlateSide::stacked);
        let side_fixed = COLOR_BAR + PAD_OUTER + chip_size(stacked) + CHIP_GAP + PAD_INNER;
        let named_width = |name_width: f32| (side_fixed + name_width) * 2.0 + core;
        let form = if named_width(NAME_WIDTH) <= room {
            SidesForm::Named {
                name_width: NAME_WIDTH,
            }
        } else {
            let name_width = ((room - core) * 0.5 - side_fixed).floor();
            if name_width >= MIN_NAME_WIDTH {
                SidesForm::Named { name_width }
            } else {
                SidesForm::Bare
            }
        };
        let width = match form {
            SidesForm::Named { name_width } => named_width(name_width),
            SidesForm::Bare => {
                // With no names left to stack, the plate keeps the height of one.
                stacked = false;
                (COLOR_BAR + BARE_EDGE_GAP) * 2.0 + core
            }
        };
        let height = if stacked {
            STACKED_PLATE_HEIGHT
        } else {
            PLATE_HEIGHT
        };
        Plate {
            sides,
            form,
            stacked,
            middle,
            width,
            height,
        }
    }

    /// What the tab under the plate hangs from: the two scores and the block between them.
    fn tab_anchor(&self) -> TabAnchor {
        TabAnchor::Plate {
            width: self.middle.width + SCORE_CELL * 2.0,
        }
    }

    /// Draws the plate and the tab under it, `room` being what the tab may take of the screen's
    /// width, and returns the rects the tab covers where it hangs one.
    fn draw(&self, ui: &mut Ui, series: &SeriesView, room: f32) -> Option<Vec<Rect>> {
        let (rect, _) = ui.allocate_exact_size(vec2(self.width, self.height), Sense::hover());
        ui.painter()
            .add(tiers::tier1_chrome(rect, theme::radius_bottom(BAR_RADIUS)));
        let middle = Rect::from_center_size(rect.center(), vec2(self.middle.width, rect.height()));
        matchup::paint_middle_block(ui, middle);
        self.middle.paint(ui, middle);
        let colors = series.score_colors();
        let cells = [
            Rect::from_min_max(
                pos2(middle.left() - SCORE_CELL, rect.top()),
                middle.left_bottom(),
            ),
            Rect::from_min_max(
                middle.right_top(),
                pos2(middle.right() + SCORE_CELL, rect.bottom()),
            ),
        ];
        for (index, side) in self.sides.iter().enumerate() {
            let mirrored = index == 1;
            let cell = cells[index];
            let (wall, end) = if mirrored {
                (
                    cell.right(),
                    Rect::from_min_max(cell.right_top(), rect.right_bottom()),
                )
            } else {
                (
                    cell.left(),
                    Rect::from_min_max(rect.left_top(), cell.left_bottom()),
                )
            };
            matchup::draw_score_cell(ui, cell, wall, series.scores[index], colors[index]);
            self.draw_side(ui, end, side, mirrored);
        }
        let anchor = self.tab_anchor();
        matchup::series_tab_height(series, anchor)
            .map(|_| matchup::draw_series_tab(ui, rect, series, room, anchor))
    }

    /// Draws `side` into `end`, its end of the plate, from the plate's outer edge inwards, mirrored
    /// for the side on the right.
    fn draw_side(&self, ui: &Ui, end: Rect, side: &PlateSide<'_>, mirrored: bool) {
        let cursor = |rect: Rect| {
            if mirrored {
                EdgeCursor::from_right(rect)
            } else {
                EdgeCursor::from_left(rect)
            }
        };
        match side {
            PlateSide::Players(players) => {
                for (row, player) in matchup::rows_of(end, players.len())
                    .into_iter()
                    .zip(players)
                {
                    let mut cursor = cursor(row);
                    paint_edge(ui, cursor.take(COLOR_BAR), player.color);
                    let SidesForm::Named { name_width } = self.form else {
                        continue;
                    };
                    let stacked = self.stacked;
                    cursor.skip(PAD_OUTER);
                    let chip = chip_size(stacked);
                    paint_picked_race_chip(
                        ui,
                        centred(cursor.take(chip), chip),
                        player.race,
                        player.random,
                        1.0,
                    );
                    cursor.skip(CHIP_GAP);
                    paint_text(
                        ui,
                        cursor.take(name_width),
                        &text::player_name(name_size(stacked)),
                        &player.name,
                        cursor.outer_align(),
                    );
                }
            }
            PlateSide::Team { label, color } => {
                let mut cursor = cursor(end);
                paint_edge(ui, cursor.take(COLOR_BAR), *color);
                if let SidesForm::Named { name_width } = self.form {
                    cursor.skip(PAD_OUTER);
                    let room = chip_size(self.stacked) + CHIP_GAP + name_width;
                    paint_text(
                        ui,
                        cursor.take(room),
                        &text::player_name(NAME_SIZE),
                        label,
                        cursor.outer_align(),
                    );
                }
            }
        }
    }
}

/// Paints the color edge a side's row stands against into `rect`, short of the plate's own edges
/// by the gap the bar keeps.
fn paint_edge(ui: &Ui, rect: Rect, color: Color32) {
    paint_player_bar(
        ui,
        centred(rect, (rect.height() - theme::SPACE_SM).max(theme::SPACE_SM)),
        color,
        1.0,
    );
}

/// The diameter of a race chip on a plate stacked or not.
fn chip_size(stacked: bool) -> f32 {
    if stacked { STACKED_CHIP } else { CHIP }
}

/// The size a player's name is set at on a plate stacked or not.
fn name_size(stacked: bool) -> f32 {
    if stacked {
        STACKED_NAME_SIZE
    } else {
        NAME_SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observer::RaceView;

    fn player(player_id: u8, team: u8, name: &str) -> MatchupPlayerView {
        MatchupPlayerView {
            player_id,
            team,
            name: name.to_string(),
            color: theme::player_color(usize::from(player_id)),
            race: RaceView::Zerg,
            random: false,
            vision: true,
            minerals: 0,
            gas: 0,
            supply_used: 0,
            supply_max: 0,
            workers: 0,
            apm: 0,
        }
    }

    /// A best of ninety-nine at twelve to eleven going into its twenty-fourth game, under fifty of
    /// the widest letter as its title.
    fn longest_series() -> SeriesView {
        SeriesView {
            title: Some("W".repeat(50)),
            format: SeriesFormat::BestOf { length: 99 },
            game_number: 24,
            scores: [12, 11],
            lines: Vec::new(),
            logo: None,
            side_names: [None, None],
        }
    }

    /// A game of players on `teams` that is one of `series`, every player carrying the longest
    /// name the game allows.
    fn series_game(teams: &[u8], series: SeriesView) -> MatchupView {
        MatchupView {
            players: teams
                .iter()
                .enumerate()
                .map(|(index, &team)| player(index as u8, team, &"W".repeat(24)))
                .collect(),
            elapsed_secs: 0,
            is_replay: false,
            series: Some(series),
        }
    }

    const SHAPES: [&[u8]; 4] = [
        &[1, 2],
        &[1, 1, 2, 2],
        &[1, 1, 1, 2, 2, 2],
        &[1, 1, 1, 1, 2, 2, 2, 2],
    ];

    /// The plate as laid out on a screen of `size`, with the room it was laid out in.
    fn laid_out(view: &MatchupView, size: egui::Vec2) -> (SidesForm, f32, f32, f32) {
        crate::observer::test_support::settled_at(size, |ctx| {
            let series = view.shown_series()?;
            let room = map_control::room_between_wings(ctx.viewport_rect());
            let plate = Plate::lay_out(ctx, view, series, room);
            Some((plate.form, plate.width, plate.height, room))
        })
        .expect("the plate is laid out")
    }

    #[test]
    fn the_plate_names_its_sides_where_there_is_room_and_drops_them_where_there_is_not() {
        for teams in SHAPES {
            let view = series_game(teams, longest_series());
            let (form, width, height, room) = laid_out(&view, egui::vec2(1920.0, 1080.0));
            assert_eq!(
                form,
                SidesForm::Named {
                    name_width: NAME_WIDTH
                },
                "{teams:?}"
            );
            assert!(width <= room, "{teams:?}: {width} in {room}");
            let stacked = teams.len() == 4;
            assert_eq!(
                height,
                if stacked {
                    STACKED_PLATE_HEIGHT
                } else {
                    PLATE_HEIGHT
                },
                "{teams:?}"
            );

            // A 720p screen is 1280 points wide, with about 250 of them between the wings: the
            // plate is its scores and the block between them.
            let (form, width, height, room) = laid_out(&view, egui::vec2(1280.0, 720.0));
            assert_eq!(form, SidesForm::Bare, "{teams:?}");
            assert!(width <= room, "{teams:?}: {width} in {room}");
            assert_eq!(height, PLATE_HEIGHT);
        }
    }

    #[test]
    fn a_narrowing_room_elides_the_names_before_it_drops_them() {
        let view = series_game(&[1, 2], longest_series());
        crate::observer::test_support::settled_at(egui::vec2(1920.0, 1080.0), |ctx| {
            let series = view.shown_series()?;
            let full = Plate::lay_out(ctx, &view, series, f32::INFINITY);
            let middle = full.middle.width;
            let mut saw_narrowed = false;
            let mut last = NAME_WIDTH;
            let mut room = full.width + 20.0;
            while room > 0.0 {
                let plate = Plate::lay_out(ctx, &view, series, room);
                match plate.form {
                    SidesForm::Named { name_width } => {
                        assert!(name_width <= last, "{room}");
                        assert!(name_width >= MIN_NAME_WIDTH, "{room}");
                        assert!(plate.width <= room, "{room}: {}", plate.width);
                        saw_narrowed |= name_width < NAME_WIDTH;
                        last = name_width;
                    }
                    SidesForm::Bare => {
                        // Once the names go, they stay gone the narrower the room gets, and the
                        // format and the game number are never touched.
                        last = 0.0;
                        assert_eq!(plate.middle.width, middle, "{room}");
                        assert_eq!(
                            plate.width,
                            (COLOR_BAR + BARE_EDGE_GAP) * 2.0 + SCORE_CELL * 2.0 + middle
                        );
                    }
                }
                assert!(!plate.middle.format.elided && !plate.middle.game.elided);
                room -= 4.0;
            }
            assert!(saw_narrowed && last == 0.0);
            Some(())
        })
        .expect("the plates are laid out");
    }

    #[test]
    fn a_side_of_three_or_more_is_named_by_its_label() {
        let view = series_game(&[1, 1, 1, 2, 2], longest_series());
        let names = crate::observer::test_support::settled_at(egui::vec2(1920.0, 1080.0), |ctx| {
            let plate = Plate::lay_out(ctx, &view, view.shown_series()?, f32::INFINITY);
            Some(plate.sides.map(|side| match side {
                PlateSide::Team { label, .. } => label,
                PlateSide::Players(players) => format!("{} players", players.len()),
            }))
        })
        .expect("the plate is laid out");
        assert_eq!(names, ["Team 1".to_string(), "2 players".to_string()]);
    }

    #[test]
    fn the_plate_is_drawn_only_for_a_series_it_can_show() {
        let shown = |view: &MatchupView| {
            crate::observer::test_support::settled_at(egui::vec2(1920.0, 1080.0), |ctx| {
                Some(render_series_plate(view, ctx, true).is_some())
            })
            .unwrap_or(false)
        };
        assert!(shown(&series_game(&[1, 2], longest_series())));
        assert!(!shown(&series_game(&[1, 2, 3], longest_series())));
        assert!(!shown(&MatchupView {
            series: None,
            ..series_game(&[1, 2], longest_series())
        }));
    }

    #[test]
    fn the_tab_under_the_plate_is_the_title_alone_and_there_is_none_without_one() {
        let size = egui::vec2(1920.0, 1080.0);
        let outcome = |series: SeriesView| {
            let view = series_game(&[1, 2], series);
            crate::observer::test_support::settled_at(size, |ctx| {
                render_series_plate(&view, ctx, true).map(|outcome| (outcome.rects, outcome.depth))
            })
            .expect("the plate is drawn")
        };
        let (rects, depth) = outcome(longest_series());
        let [plate, tab] = rects[..] else {
            panic!("{rects:?}");
        };
        assert_eq!(plate.top(), 0.0);
        assert_eq!(tab.top(), plate.bottom());
        assert_eq!(tab.height(), matchup::TAB_ROW_HEIGHT);
        assert!((tab.center().x - plate.center().x).abs() < 0.5);
        assert_eq!(depth, PLATE_HEIGHT + matchup::TAB_ROW_HEIGHT);
        let room = map_control::room_between_wings(Rect::from_min_size(egui::Pos2::ZERO, size));
        assert!(tab.width() <= room);

        let (rects, depth) = outcome(SeriesView {
            title: None,
            ..longest_series()
        });
        assert_eq!(rects.len(), 1, "{rects:?}");
        assert_eq!(depth, PLATE_HEIGHT);
    }

    /// A logo of `width` by `height` pixels, on a texture no test draws from.
    fn logo(width: u32, height: u32) -> crate::observer::SeriesLogo {
        crate::observer::SeriesLogo {
            texture: egui::TextureId::User(1),
            size: [width, height],
        }
    }

    /// The plate's rects and its depth once a 1920x1080 screen has settled around `view`.
    fn settled_plate(view: &MatchupView) -> (Vec<Rect>, f32) {
        crate::observer::test_support::settled_at(egui::vec2(1920.0, 1080.0), |ctx| {
            render_series_plate(view, ctx, true).map(|outcome| (outcome.rects, outcome.depth))
        })
        .expect("the plate is drawn")
    }

    #[test]
    fn the_tab_under_the_plate_carries_the_casters_lines_and_logo_as_the_bars_does() {
        let short = vec!["a".repeat(20), "b".repeat(20)];
        let long = vec!["a".repeat(40), "b".repeat(40)];
        for title in [Some("Grand Final".to_string()), None] {
            for (lines, logo) in [
                (Vec::new(), Some(logo(576, 144))),
                (Vec::new(), Some(logo(144, 144))),
                (short.clone(), None),
                (long.clone(), None),
                (long.clone(), Some(logo(576, 144))),
            ] {
                let series = SeriesView {
                    title: title.clone(),
                    lines: lines.clone(),
                    logo,
                    ..longest_series()
                };
                // The plate's tab has the rows the bar's has, short only of the series line where
                // there is no title to be one.
                let bar = matchup::series_tab_height(&series, TabAnchor::Bar)
                    .expect("the bar always hangs a tab");
                let expected = if title.is_some() || logo.is_some() && lines.len() < 2 {
                    bar
                } else {
                    bar - matchup::TAB_ROW_HEIGHT
                };
                let view = series_game(&[1, 2], series);
                let (rects, depth) = settled_plate(&view);
                let [plate, tab] = rects[..] else {
                    panic!("{title:?} {lines:?}: {rects:?}");
                };
                assert_eq!(tab.height(), expected, "{title:?} {lines:?} {logo:?}");
                assert_eq!(tab.top(), plate.bottom());
                assert_eq!(depth, plate.height() + expected);
            }
        }
    }

    #[test]
    fn a_plate_for_a_series_with_nothing_for_its_tab_hangs_none() {
        let series = SeriesView {
            title: Some(String::new()),
            ..longest_series()
        };
        let (rects, depth) = settled_plate(&series_game(&[1, 1, 2, 2], series));
        assert_eq!(rects.len(), 1, "{rects:?}");
        assert_eq!(depth, STACKED_PLATE_HEIGHT);
    }

    #[test]
    fn a_logo_alone_under_the_plate_is_a_tab_as_narrow_as_the_logo() {
        let series = SeriesView {
            title: None,
            logo: Some(logo(144, 144)),
            ..longest_series()
        };
        let (rects, _) = settled_plate(&series_game(&[1, 2], series));
        let [plate, tab] = rects[..] else {
            panic!("{rects:?}");
        };
        // The square logo's 36 points and 8 either side of it, centered under the plate.
        assert_eq!(tab.width(), 52.0);
        assert!((tab.center().x - plate.center().x).abs() < 0.5);
    }
}
