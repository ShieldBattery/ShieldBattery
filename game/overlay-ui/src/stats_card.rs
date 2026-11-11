//! The card the `/stats` chat command answers with: who the player is, their record, and where they
//! stand in matchmaking, drawn the way their profile card is in the app rather than as lines of
//! chat. Only the player who asked sees it. Like the setting notice it takes no input and leaves
//! on its own, since it answers a question asked from the chat box mid-game, where the player's
//! hands are busy with the game.
//!
//! The card stands in the screen's top-left corner, under the network chip: the one corner BW
//! keeps nothing of its own in during a player's game. Above the minimap, where BW writes its chat,
//! the card would lie over the very lines it was asked for among, and the middle of the screen is
//! where the game is played. It is let through enough to see units moving under it.
//!
//! The [roster](PlayerRoster) is the same information for every other player in the game at once,
//! a row each, held up by a key rather than asked for by name.

use std::collections::HashMap;
use std::sync::Arc;

use egui::text::{LayoutJob, TextWrapping};
use egui::{
    Align, Align2, Area, Color32, ColorImage, Context, CornerRadius, Galley, Id, Order, Painter,
    Pos2, Rect, Sense, Shape, Stroke, StrokeKind, TextureHandle, TextureOptions, Vec2, pos2, vec2,
};
use resvg::{tiny_skia, usvg};

use crate::colors::BLUE10;
use crate::kit::text::{self, BodyWeight, TextSpec};
use crate::kit::{motion, theme};
use crate::observer::race_icon::{icon_rect, paint_race_icon};
use crate::observer::{RaceView, minimap_reserve};
use crate::{tr, tr_plural};

/// How long the card stays at full strength, in seconds: long enough to read a record and two ranks
/// between glances at the game.
const HOLD_SECS: f64 = 6.0;

/// How long the card takes to fade away once its hold is over, in seconds. Slow enough that a
/// player who looks back at it mid-fade still catches it, and sees that it is going rather than
/// finding it gone.
const FADE_SECS: f64 = 1.5;

/// How far down the screen the corner surfaces start: clear of the network chip and of SC:R's
/// FPS line under it, whichever of them is up.
const CORNER_TOP: f32 = 72.0;

/// The fill of the corner surfaces: the ambient panels' own blue, let well through so the game
/// shows under a card that only passes by. Further through than the setting notice's, which holds
/// a line of text rather than a card's worth.
const FILL: Color32 = theme::alpha(BLUE10, 0.6);

const WIDTH: f32 = 360.0;
const PADDING: Vec2 = vec2(14.0, 10.0);

/// The race icon beside the player's name.
const NAME_ICON: f32 = 18.0;
const NAME_SIZE: f32 = 19.0;
const RECORD_SIZE: f32 = 17.0;
const SUBTITLE_SIZE: f32 = 13.0;

/// A division emblem in a standing row.
const EMBLEM: f32 = 34.0;
const DIVISION_SIZE: f32 = 16.0;
/// The mode a row is about.
const DETAIL_SIZE: f32 = 13.0;
/// The player's MMR in a row's mode.
const RATING_SIZE: f32 = 16.0;

/// The text of a notice that stands in for the card.
const NOTICE_SIZE: f32 = 15.0;

/// The race-colored bar down the card's left edge, which says whose card it is the way the race
/// wash behind the app's card does.
const ACCENT_WIDTH: f32 = 3.0;

/// How strongly the main race's emblem shows through behind the card's right half.
const BACKDROP_EMBLEM_OPACITY: f32 = 0.10;

/// A matchmaking division, as the app's ladder places a player in one.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Division {
    Unrated,
    Bronze1,
    Bronze2,
    Bronze3,
    Silver1,
    Silver2,
    Silver3,
    Gold1,
    Gold2,
    Gold3,
    Platinum1,
    Platinum2,
    Platinum3,
    Diamond1,
    Diamond2,
    Diamond3,
    Champion,
}

impl Division {
    pub const ALL: [Division; 17] = [
        Division::Unrated,
        Division::Bronze1,
        Division::Bronze2,
        Division::Bronze3,
        Division::Silver1,
        Division::Silver2,
        Division::Silver3,
        Division::Gold1,
        Division::Gold2,
        Division::Gold3,
        Division::Platinum1,
        Division::Platinum2,
        Division::Platinum3,
        Division::Diamond1,
        Division::Diamond2,
        Division::Diamond3,
        Division::Champion,
    ];

    /// The division's name as the app's ladder writes it.
    pub fn label(self) -> String {
        match self {
            Division::Unrated => tr!("statsCard.division.unrated", "Unrated"),
            Division::Bronze1 => tr!("statsCard.division.bronze1", "Bronze 1"),
            Division::Bronze2 => tr!("statsCard.division.bronze2", "Bronze 2"),
            Division::Bronze3 => tr!("statsCard.division.bronze3", "Bronze 3"),
            Division::Silver1 => tr!("statsCard.division.silver1", "Silver 1"),
            Division::Silver2 => tr!("statsCard.division.silver2", "Silver 2"),
            Division::Silver3 => tr!("statsCard.division.silver3", "Silver 3"),
            Division::Gold1 => tr!("statsCard.division.gold1", "Gold 1"),
            Division::Gold2 => tr!("statsCard.division.gold2", "Gold 2"),
            Division::Gold3 => tr!("statsCard.division.gold3", "Gold 3"),
            Division::Platinum1 => tr!("statsCard.division.platinum1", "Platinum 1"),
            Division::Platinum2 => tr!("statsCard.division.platinum2", "Platinum 2"),
            Division::Platinum3 => tr!("statsCard.division.platinum3", "Platinum 3"),
            Division::Diamond1 => tr!("statsCard.division.diamond1", "Diamond 1"),
            Division::Diamond2 => tr!("statsCard.division.diamond2", "Diamond 2"),
            Division::Diamond3 => tr!("statsCard.division.diamond3", "Diamond 3"),
            Division::Champion => tr!("statsCard.division.champion", "Champion"),
        }
    }

    /// The division's emblem: the same SVG the app shows, embedded so the card never waits on a
    /// download.
    fn svg(self) -> &'static str {
        match self {
            Division::Unrated => include_str!("../../../server/public/images/ranks/unrated.svg"),
            Division::Bronze1 => include_str!("../../../server/public/images/ranks/bronze1.svg"),
            Division::Bronze2 => include_str!("../../../server/public/images/ranks/bronze2.svg"),
            Division::Bronze3 => include_str!("../../../server/public/images/ranks/bronze3.svg"),
            Division::Silver1 => include_str!("../../../server/public/images/ranks/silver1.svg"),
            Division::Silver2 => include_str!("../../../server/public/images/ranks/silver2.svg"),
            Division::Silver3 => include_str!("../../../server/public/images/ranks/silver3.svg"),
            Division::Gold1 => include_str!("../../../server/public/images/ranks/gold1.svg"),
            Division::Gold2 => include_str!("../../../server/public/images/ranks/gold2.svg"),
            Division::Gold3 => include_str!("../../../server/public/images/ranks/gold3.svg"),
            Division::Platinum1 => {
                include_str!("../../../server/public/images/ranks/platinum1.svg")
            }
            Division::Platinum2 => {
                include_str!("../../../server/public/images/ranks/platinum2.svg")
            }
            Division::Platinum3 => {
                include_str!("../../../server/public/images/ranks/platinum3.svg")
            }
            Division::Diamond1 => include_str!("../../../server/public/images/ranks/diamond1.svg"),
            Division::Diamond2 => include_str!("../../../server/public/images/ranks/diamond2.svg"),
            Division::Diamond3 => include_str!("../../../server/public/images/ranks/diamond3.svg"),
            Division::Champion => include_str!("../../../server/public/images/ranks/champion.svg"),
        }
    }
}

/// A matchmaking mode, as the app's queue lists them.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum MatchmakingMode {
    OneVOne,
    OneVOneFastest,
    TwoVTwo,
    TwoVTwoBgh,
    TwoVTwoHunters,
    TwoVTwoFastest,
    ThreeVThreeBgh,
    ThreeVThreeHunters,
    ThreeVThreeFastest,
}

impl MatchmakingMode {
    /// The mode's name as the app's queue writes it.
    pub fn label(self) -> String {
        match self {
            MatchmakingMode::OneVOne => tr!("statsCard.mode.1v1", "1v1"),
            MatchmakingMode::OneVOneFastest => tr!("statsCard.mode.1v1fastest", "1v1 Fastest"),
            MatchmakingMode::TwoVTwo => tr!("statsCard.mode.2v2", "2v2"),
            MatchmakingMode::TwoVTwoBgh => tr!("statsCard.mode.2v2bgh", "2v2 BGH"),
            MatchmakingMode::TwoVTwoHunters => tr!("statsCard.mode.2v2hunters", "2v2 Hunters"),
            MatchmakingMode::TwoVTwoFastest => tr!("statsCard.mode.2v2fastest", "2v2 Fastest"),
            MatchmakingMode::ThreeVThreeBgh => tr!("statsCard.mode.3v3bgh", "3v3 BGH"),
            MatchmakingMode::ThreeVThreeHunters => {
                tr!("statsCard.mode.3v3hunters", "3v3 Hunters")
            }
            MatchmakingMode::ThreeVThreeFastest => {
                tr!("statsCard.mode.3v3fastest", "3v3 Fastest")
            }
        }
    }
}

/// Where a player stands in a mode they have a rating in.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Rank {
    pub division: Division,
    /// Their MMR in the mode, rounded.
    pub rating: u32,
}

/// A player's standing in one mode: their rank, or `None` if they aren't rated in it.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ModeStanding {
    pub mode: MatchmakingMode,
    pub rank: Option<Rank>,
}

/// Everything the card says about a player.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatsCardView {
    pub name: String,
    /// The race the player picks in most of their games, if any one race is most of them.
    pub main_race: Option<RaceView>,
    pub wins: u32,
    pub losses: u32,
    /// The mode the player has their highest MMR in, or `None` if they're rated in none.
    pub best: Option<ModeStanding>,
    /// The player's standing in the mode of the game being played, or `None` outside matchmaking.
    pub current: Option<ModeStanding>,
}

/// What the card answers a `/stats` command with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StatsCardContent {
    Stats(StatsCardView),
    /// No player has the name that was asked about.
    NotFound {
        name: String,
    },
    /// The stats couldn't be loaded. `name` is the name asked about, or `None` for the player's
    /// own.
    Failed {
        name: Option<String>,
    },
}

/// The card on screen, or on its way off.
pub struct StatsCard {
    content: StatsCardContent,
    /// When the card was first drawn, which is when its hold starts. `None` until then.
    since: Option<f64>,
}

impl StatsCard {
    pub fn new(content: StatsCardContent) -> StatsCard {
        StatsCard {
            content,
            since: None,
        }
    }

    pub fn content(&self) -> &StatsCardContent {
        &self.content
    }

    /// Draws the card in the top-left corner, in line with the minimap below it, which `minimap`
    /// gives where the host knows it. Returns whether the card is still on screen.
    pub fn draw(&mut self, ctx: &Context, minimap: Option<Rect>) -> bool {
        let now = ctx.input(|input| input.time);
        let since = *self.since.get_or_insert(now);
        let elapsed = now - since;
        if elapsed < HOLD_SECS {
            ctx.request_repaint_after_secs((HOLD_SECS - elapsed) as f32);
        } else if elapsed < HOLD_SECS + FADE_SECS {
            ctx.request_repaint();
        }
        let strength = fade_strength(elapsed);
        let content = &self.content;
        motion::presence_area_from_top(
            ctx,
            Id::new("sb_stats_card_presence"),
            elapsed < HOLD_SECS + FADE_SECS,
            corner_area(ctx, Id::new("sb_stats_card"), minimap),
            |ui| {
                ui.multiply_opacity(strength);
                let layout = CardLayout::new(ui.ctx(), content);
                let (rect, _) =
                    ui.allocate_exact_size(vec2(WIDTH, layout.height()), Sense::hover());
                layout.paint(ui.painter(), rect);
            },
        )
        .is_some()
    }
}

/// How strongly the card shows `elapsed` seconds after it came up: fully through its hold, then
/// easing away to nothing over the fade.
fn fade_strength(elapsed: f64) -> f32 {
    let t = ((HOLD_SECS + FADE_SECS - elapsed) / FADE_SECS).clamp(0.0, 1.0) as f32;
    t * t * (3.0 - 2.0 * t)
}

/// An area hung in the top-left corner, its left edge in line with the minimap's so the corner
/// surfaces and the console share one margin. Where the host can't say where the minimap is, the
/// console's own square for it stands in.
fn corner_area(ctx: &Context, id: Id, minimap: Option<Rect>) -> Area {
    let screen = ctx.content_rect();
    let minimap = minimap.unwrap_or_else(|| minimap_reserve(screen));
    Area::new(id)
        .order(Order::Foreground)
        .interactable(false)
        .pivot(Align2::LEFT_TOP)
        .fixed_pos(pos2(minimap.left(), screen.top() + CORNER_TOP))
}

/// The card's text, laid out once a frame so its height is known before anything is painted.
enum CardLayout {
    Stats {
        view: StatsCardView,
        name: Arc<Galley>,
        record: Arc<Galley>,
        subtitle: Arc<Galley>,
        rows: Vec<RowLayout>,
        height: f32,
    },
    Notice {
        message: Arc<Galley>,
        height: f32,
    },
}

/// One standing row's text: what it is ("BEST MODE", "THIS GAME") over the division on the left,
/// and the mode over the player's MMR in it on the right.
struct RowLayout {
    rank: Option<Rank>,
    caption: Arc<Galley>,
    division: Arc<Galley>,
    mode: Option<Arc<Galley>>,
    rating: Option<Arc<Galley>>,
    height: f32,
}

impl CardLayout {
    fn new(ctx: &Context, content: &StatsCardContent) -> CardLayout {
        let inner_width = WIDTH - PADDING.x * 2.0;
        match content {
            StatsCardContent::Stats(view) => {
                let record = text_layout(ctx, record_job(view.wins, view.losses, RECORD_SIZE));
                let name_width =
                    inner_width - NAME_ICON - theme::SPACE_SM - record.size().x - theme::SPACE_MD;
                let name = text::player_name(NAME_SIZE).layout(
                    ctx,
                    text::player_name(NAME_SIZE).job_truncated(&view.name, name_width),
                );
                let subtitle_spec = text::body(SUBTITLE_SIZE, BodyWeight::Regular)
                    .with_color(theme::TEXT_SECONDARY);
                let subtitle = subtitle_spec.layout(
                    ctx,
                    subtitle_spec.job_truncated(&subtitle(view), inner_width),
                );
                let rows = standing_rows(view)
                    .into_iter()
                    .map(|row| RowLayout::new(ctx, row, inner_width))
                    .collect::<Vec<_>>();
                let rows_height = rows.iter().map(|row| row.height).sum::<f32>()
                    + theme::SPACE_XS * rows.len().saturating_sub(1) as f32;
                let height = PADDING.y * 2.0
                    + name.size().y.max(record.size().y)
                    + 2.0
                    + subtitle.size().y
                    + theme::SPACE_SM * 2.0
                    + theme::HAIRLINE
                    + rows_height;
                CardLayout::Stats {
                    view: view.clone(),
                    name,
                    record,
                    subtitle,
                    rows,
                    height,
                }
            }
            StatsCardContent::NotFound { name } => {
                let message = text_layout(
                    ctx,
                    name_message_job(
                        &tr!("statsCard.notFound", "No player named"),
                        name,
                        inner_width,
                    ),
                );
                let height = PADDING.y * 2.0 + message.size().y;
                CardLayout::Notice { message, height }
            }
            StatsCardContent::Failed { name } => {
                let message = match name {
                    Some(name) => text_layout(
                        ctx,
                        name_message_job(
                            &tr!("statsCard.failedFor", "Couldn't load the stats of"),
                            name,
                            inner_width,
                        ),
                    ),
                    None => {
                        let spec = text::body(NOTICE_SIZE, BodyWeight::Semibold);
                        spec.layout(
                            ctx,
                            spec.job_wrapped(
                                &tr!("statsCard.failedOwn", "Couldn't load your stats"),
                                inner_width,
                            ),
                        )
                    }
                };
                let height = PADDING.y * 2.0 + message.size().y;
                CardLayout::Notice { message, height }
            }
        }
    }

    fn height(&self) -> f32 {
        match self {
            CardLayout::Stats { height, .. } | CardLayout::Notice { height, .. } => *height,
        }
    }

    fn paint(&self, painter: &Painter, rect: Rect) {
        let race = match self {
            CardLayout::Stats { view, .. } => view.main_race,
            CardLayout::Notice { .. } => None,
        };
        paint_chrome(painter, rect, race);
        let inner = rect.shrink2(PADDING);
        match self {
            CardLayout::Stats {
                view,
                name,
                record,
                subtitle,
                rows,
                ..
            } => {
                let row_height = name.size().y.max(record.size().y);
                let mut x = inner.left();
                if let Some(race) = view.main_race {
                    let center = pos2(x + NAME_ICON * 0.5, inner.top() + row_height * 0.5);
                    let icon = icon_rect(center, NAME_ICON, painter.ctx().pixels_per_point());
                    paint_race_icon(painter, icon, race, race.color());
                    x += NAME_ICON + theme::SPACE_SM;
                }
                // The name and the record share a baseline, whatever their faces and sizes.
                let baseline_y = inner.top() + row_height
                    - (name.size().y - text::baseline(name))
                        .max(record.size().y - text::baseline(record));
                painter.galley(
                    pos2(x, baseline_y - text::baseline(name)),
                    name.clone(),
                    theme::TEXT_PRIMARY,
                );
                painter.galley(
                    pos2(
                        inner.right() - record.size().x,
                        baseline_y - text::baseline(record),
                    ),
                    record.clone(),
                    theme::TEXT_PRIMARY,
                );

                let subtitle_top = inner.top() + row_height + 2.0;
                painter.galley(
                    pos2(inner.left(), subtitle_top),
                    subtitle.clone(),
                    theme::TEXT_SECONDARY,
                );

                let divider_y = subtitle_top + subtitle.size().y + theme::SPACE_SM;
                painter.hline(
                    inner.x_range(),
                    divider_y,
                    Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
                );

                let mut top = divider_y + theme::HAIRLINE + theme::SPACE_SM;
                for row in rows {
                    row.paint(
                        painter,
                        Rect::from_min_size(
                            pos2(inner.left(), top),
                            vec2(inner.width(), row.height),
                        ),
                    );
                    top += row.height + theme::SPACE_XS;
                }
            }
            CardLayout::Notice { message, .. } => {
                painter.galley(inner.min, message.clone(), theme::TEXT_PRIMARY);
            }
        }
    }
}

/// One row of standings, before it's laid out.
#[derive(Clone, Debug, PartialEq, Eq)]
struct StandingRow {
    caption: String,
    /// The mode the row is about, or `None` for the row of a player rated in nothing, which is
    /// about no mode in particular.
    mode: Option<MatchmakingMode>,
    rank: Option<Rank>,
}

impl RowLayout {
    /// Lays out a row `width` across. The mode and MMR on the right are laid out first and kept
    /// whole, since they're what the row is read for; the caption and division on the left are cut
    /// short with an ellipsis if what's left of the row can't hold them.
    fn new(ctx: &Context, row: StandingRow, width: f32) -> RowLayout {
        let mode = row.mode.map(|mode| {
            let spec =
                text::body(DETAIL_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY);
            spec.layout(ctx, spec.job(&mode.label()))
        });
        let rating = row.rank.map(|rank| {
            let mut job = LayoutJob::default();
            append(
                &mut job,
                &text::numeral_strong(RATING_SIZE),
                &rank.rating.to_string(),
                0.0,
            );
            append(
                &mut job,
                &text::numeral(RATING_SIZE).with_color(theme::TEXT_DIM),
                &tr!("statsCard.mmr", "MMR"),
                4.0,
            );
            text_layout(ctx, job)
        });
        let right_width = [&mode, &rating]
            .into_iter()
            .flatten()
            .map(|galley| galley.size().x)
            .fold(0.0, f32::max);
        let left_width = width - EMBLEM - theme::SPACE_SM - right_width - theme::SPACE_MD;

        let caption = text::column_label().layout(
            ctx,
            text::column_label().job_truncated(&row.caption, left_width),
        );
        let division_spec = text::body(DIVISION_SIZE, BodyWeight::Semibold);
        let division = match row.rank {
            Some(rank) => division_spec.layout(
                ctx,
                division_spec.job_truncated(&rank.division.label(), left_width),
            ),
            None => {
                let spec = division_spec.with_color(theme::TEXT_SECONDARY);
                spec.layout(
                    ctx,
                    spec.job_truncated(&tr!("statsCard.unranked", "Unranked"), left_width),
                )
            }
        };
        let left_height = caption.size().y + division.size().y;
        let right_height = mode.as_ref().map_or(0.0, |galley| galley.size().y)
            + rating.as_ref().map_or(0.0, |galley| galley.size().y);
        RowLayout {
            rank: row.rank,
            caption,
            division,
            mode,
            rating,
            height: EMBLEM.max(left_height).max(right_height),
        }
    }

    fn paint(&self, painter: &Painter, rect: Rect) {
        let division = self.rank.map_or(Division::Unrated, |rank| rank.division);
        let icon = icon_rect(
            pos2(rect.left() + EMBLEM * 0.5, rect.center().y),
            EMBLEM,
            painter.ctx().pixels_per_point(),
        );
        paint_division_icon(painter, icon, division);

        // Each side is centered on the row as a block, so a side with one line sits in the middle.
        let paint_stack = |galleys: &[&Arc<Galley>], right_aligned: bool| {
            let height = galleys.iter().map(|galley| galley.size().y).sum::<f32>();
            let mut y = rect.center().y - height * 0.5;
            for galley in galleys {
                let x = if right_aligned {
                    rect.right() - galley.size().x
                } else {
                    icon.right() + theme::SPACE_SM
                };
                painter.galley(pos2(x, y), (*galley).clone(), theme::TEXT_PRIMARY);
                y += galley.size().y;
            }
        };
        paint_stack(&[&self.caption, &self.division], false);
        let right = [&self.mode, &self.rating]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        paint_stack(&right, true);
    }
}

/// The standing rows a card has: the best mode and the mode of the game being played, as one row
/// when they're the same mode; and a lone unranked row for a player rated in nothing outside
/// matchmaking, so the card still says where they stand.
fn standing_rows(view: &StatsCardView) -> Vec<StandingRow> {
    let row = |caption: String, standing: ModeStanding| StandingRow {
        caption,
        mode: Some(standing.mode),
        rank: standing.rank,
    };
    let best_caption = || tr!("statsCard.bestMode", "Best mode");
    let current_caption = || tr!("statsCard.thisGame", "This game");
    match (view.best, view.current) {
        (Some(best), Some(current)) if best.mode == current.mode => vec![row(
            tr!("statsCard.bestModeThisGame", "Best mode · This game"),
            best,
        )],
        (Some(best), Some(current)) => {
            vec![row(best_caption(), best), row(current_caption(), current)]
        }
        (Some(best), None) => vec![row(best_caption(), best)],
        (None, Some(current)) => vec![row(current_caption(), current)],
        (None, None) => vec![StandingRow {
            caption: best_caption(),
            mode: None,
            rank: None,
        }],
    }
}

/// The line under the player's name: their main race and how many games their record is from.
fn subtitle(view: &StatsCardView) -> String {
    let total = view.wins + view.losses;
    if total == 0 {
        return tr!("statsCard.noGames", "No games played");
    }
    let games = tr_plural!(
        "statsCard.games",
        total,
        one = "{{count}} game",
        other = "{{count}} games",
    );
    let win_rate = tr!(
        "statsCard.winRate",
        "{{percent}}% won",
        percent = (view.wins as f64 * 100.0 / total as f64).round() as u32,
    );
    match view.main_race {
        Some(race) => {
            let race = race_name(race);
            let main = tr!("statsCard.mainRace", "{{race}} main", race = race);
            format!("{main} · {games} · {win_rate}")
        }
        None => format!("{games} · {win_rate}"),
    }
}

fn race_name(race: RaceView) -> String {
    match race {
        RaceView::Zerg => tr!("statsCard.race.zerg", "Zerg"),
        RaceView::Terran => tr!("statsCard.race.terran", "Terran"),
        RaceView::Protoss => tr!("statsCard.race.protoss", "Protoss"),
        RaceView::Random => tr!("statsCard.race.random", "Random"),
    }
}

/// The record as the app's card writes it: each count with a short result mark in its color. The
/// marks are set in the counts' own face and size, so they stand on the same baseline rather than
/// dropping under it the way a smaller face aligned to the line's bottom does.
fn record_job(wins: u32, losses: u32, size: f32) -> LayoutJob {
    let count = text::numeral_strong(size);
    let mark = |color| text::numeral_strong(size).with_color(color);
    let mut job = LayoutJob::default();
    for (i, (value, mark_text, color)) in [
        (wins, tr!("statsCard.winMark", "W"), theme::TEXT_POSITIVE),
        (losses, tr!("statsCard.lossMark", "L"), theme::TEXT_NEGATIVE),
    ]
    .into_iter()
    .enumerate()
    {
        let leading = if i == 0 { 0.0 } else { theme::SPACE_SM };
        append(&mut job, &count, &value.to_string(), leading);
        append(&mut job, &mark(color), &mark_text, 2.0);
    }
    job
}

/// A message about a player, with their name set in the face names are set in.
fn name_message_job(message: &str, name: &str, wrap_width: f32) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap_width;
    append(
        &mut job,
        &text::body(NOTICE_SIZE, BodyWeight::Semibold).with_color(theme::TEXT_SECONDARY),
        message,
        0.0,
    );
    append(&mut job, &text::player_name(NOTICE_SIZE + 1.0), name, 5.0);
    job
}

/// Appends `text` in `spec`'s style, sitting on the line's baseline whatever its size.
fn append(job: &mut LayoutJob, spec: &TextSpec, text: &str, leading_space: f32) {
    let mut format = spec.format();
    format.valign = Align::BOTTOM;
    job.append(text, leading_space, format);
}

fn text_layout(ctx: &Context, job: LayoutJob) -> Arc<Galley> {
    ctx.fonts_mut(|fonts| fonts.layout_job(job))
}

/// The card's panel: the ambient panels' own fill and hairline, the main race's color down the
/// left edge, and the race's emblem showing faintly through the right half.
fn paint_chrome(painter: &Painter, rect: Rect, race: Option<RaceView>) {
    let radius = CornerRadius::from(theme::RADIUS_PANEL);
    painter.rect_filled(rect, radius, FILL);
    if let Some(race) = race {
        let size = rect.height() * 1.3;
        let center = pos2(rect.right() - size * 0.28, rect.center().y);
        let icon = icon_rect(center, size, painter.ctx().pixels_per_point());
        paint_race_icon(
            &painter.with_clip_rect(rect.shrink(1.0)),
            icon,
            race,
            theme::alpha(race.color(), BACKDROP_EMBLEM_OPACITY),
        );
        // Kept clear of the rounded corners, which a square bar would poke out of.
        let inset = f32::from(theme::RADIUS_PANEL);
        painter.rect_filled(
            Rect::from_min_max(
                pos2(rect.left(), rect.top() + inset),
                pos2(rect.left() + ACCENT_WIDTH, rect.bottom() - inset),
            ),
            CornerRadius::ZERO,
            race.color(),
        );
    }
    painter.add(Shape::rect_stroke(
        rect,
        radius,
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));
}

/// The rasterized emblems uploaded so far, by division and by the physical size they were drawn
/// at.
///
/// The card draws one size of emblem, so the cache holds a handful of entries and is simply
/// emptied should it ever outgrow that, rather than keeping every size a run of resolution changes
/// has asked for.
#[derive(Clone, Default)]
struct EmblemCache {
    textures: HashMap<(Division, u32), TextureHandle>,
}

/// How many emblems the cache keeps before it is emptied: every division a card can show at once,
/// at a couple of sizes.
const CACHE_LIMIT: usize = 8;

fn emblem_texture(ctx: &Context, division: Division, pixels: u32) -> TextureHandle {
    let id = Id::new("stats_card::emblems");
    if let Some(texture) = ctx.data(|data| {
        data.get_temp::<EmblemCache>(id)
            .and_then(|cache| cache.textures.get(&(division, pixels)).cloned())
    }) {
        return texture;
    }
    let image = rasterize(division.svg(), pixels)
        .unwrap_or_else(|| ColorImage::filled([1, 1], Color32::TRANSPARENT));
    let texture = ctx.load_texture(
        format!("division-emblem-{division:?}-{pixels}"),
        image,
        TextureOptions::LINEAR,
    );
    ctx.data_mut(|data| {
        let cache = data.get_temp_mut_or_default::<EmblemCache>(id);
        if cache.textures.len() >= CACHE_LIMIT {
            cache.textures.clear();
        }
        cache.textures.insert((division, pixels), texture.clone());
    });
    texture
}

/// Renders `svg` into a `pixels`-square image, scaled to fill it. `None` if the SVG fails to
/// parse, which would be a broken build rather than anything a game can cause.
fn rasterize(svg: &str, pixels: u32) -> Option<ColorImage> {
    let tree = usvg::Tree::from_str(svg, &usvg::Options::default()).ok()?;
    let mut pixmap = tiny_skia::Pixmap::new(pixels, pixels)?;
    let frame = tree.size();
    let scale = pixels as f32 / frame.width().max(frame.height());
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Some(ColorImage::from_rgba_premultiplied(
        [pixels as usize, pixels as usize],
        pixmap.data(),
    ))
}

/// Paints `division`'s emblem into `rect`, a square from [`icon_rect`].
fn paint_division_icon(painter: &Painter, rect: Rect, division: Division) {
    let pixels = (rect.width() * painter.ctx().pixels_per_point()).round() as u32;
    let texture = emblem_texture(painter.ctx(), division, pixels.max(1));
    painter.image(
        texture.id(),
        rect,
        Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0)),
        Color32::WHITE,
    );
}

/// The roster's row width, which holds a long name and a division side by side.
const ROSTER_WIDTH: f32 = 380.0;
const ROSTER_PADDING: Vec2 = vec2(12.0, 10.0);
/// The player-color bar at the start of each row, which ties the row to the units on screen.
const ROSTER_SWATCH_WIDTH: f32 = 3.0;
const ROSTER_RACE_ICON: f32 = 15.0;
const ROSTER_NAME_SIZE: f32 = 17.0;
const ROSTER_DETAIL_SIZE: f32 = 13.0;
const ROSTER_RECORD_SIZE: f32 = 14.0;
const ROSTER_EMBLEM: f32 = 30.0;
const ROSTER_DIVISION_SIZE: f32 = 15.0;
const ROSTER_RATING_SIZE: f32 = 14.0;
/// Room between one row and the next within a side.
const ROSTER_ROW_GAP: f32 = 6.0;
/// Room between an icon and the text beside it.
const ROSTER_ICON_GAP: f32 = 6.0;

/// Which side of the player a group of the roster's rows is on.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RosterSide {
    Allies,
    /// Everyone not on the player's side, which in a free-for-all is everyone.
    Opponents,
}

impl RosterSide {
    fn label(self) -> String {
        match self {
            RosterSide::Allies => tr!("statsCard.roster.allies", "Allies"),
            RosterSide::Opponents => tr!("statsCard.roster.opponents", "Opponents"),
        }
    }
}

/// What the roster knows about a player's matchmaking so far.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RosterStats {
    /// Asked for and not back yet.
    Loading,
    /// Asked for and not to be had, such as for a player the app couldn't find.
    Unavailable,
    Loaded(RosterRecord),
}

/// A player's record and standing, as their row shows them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterRecord {
    pub main_race: Option<RaceView>,
    pub wins: u32,
    pub losses: u32,
    /// In a matchmaking game, the player's standing in its mode, with no rank for a player not yet
    /// rated in it. Outside matchmaking, their best mode, or `None` if they're rated in nothing.
    pub standing: Option<ModeStanding>,
}

/// One other player in the game.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterPlayer {
    pub name: String,
    /// The player's color in this game.
    pub color: Color32,
    /// The race they're playing this game.
    pub race: RaceView,
    pub stats: RosterStats,
}

/// A side of the game and the players on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterGroup {
    pub side: RosterSide,
    pub players: Vec<RosterPlayer>,
}

/// Every other player in the game, by side.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterView {
    /// The game's matchmaking mode, which every row's standing is in, or `None` outside
    /// matchmaking, where each row shows its player's best mode instead.
    pub mode: Option<MatchmakingMode>,
    /// Allies before opponents: the player sizes up their own side first.
    pub groups: Vec<RosterGroup>,
}

/// Draws the roster in the top-left corner while `shown`, returning whether any of it is on screen. It
/// comes and goes with the key held for it, at a panel's own quick fade: a look asked for with a
/// key is wanted at once, and gone the moment the key is let go.
pub fn draw_roster(ctx: &Context, view: &RosterView, shown: bool, minimap: Option<Rect>) -> bool {
    motion::presence_area_from_top(
        ctx,
        Id::new("sb_player_roster_presence"),
        shown,
        corner_area(ctx, Id::new("sb_player_roster"), minimap),
        |ui| {
            let layout = RosterLayout::new(ui.ctx(), view);
            let (rect, _) =
                ui.allocate_exact_size(vec2(ROSTER_WIDTH, layout.height), Sense::hover());
            layout.paint(ui.painter(), rect);
        },
    )
    .is_some()
}

/// A row's emblem, division and MMR, for a player whose stats are in. No MMR for one unranked.
type RankGalleys = (Division, Arc<Galley>, Option<Arc<Galley>>);

struct RosterLayout {
    /// What the first side's heading says on its right, over the rank column: the mode every rank
    /// is in, or that each is the player's best.
    column: Arc<Galley>,
    groups: Vec<(Arc<Galley>, Vec<RosterRowLayout>)>,
    /// How wide the rank column's text is, which every row's emblem stands to the left of so the
    /// divisions line up down the roster.
    rank_text_width: f32,
    height: f32,
}

struct RosterRowLayout {
    color: Color32,
    race: RaceView,
    name: Arc<Galley>,
    detail: Arc<Galley>,
    rank: Option<RankGalleys>,
    height: f32,
}

impl RosterLayout {
    fn new(ctx: &Context, view: &RosterView) -> RosterLayout {
        let inner_width = ROSTER_WIDTH - ROSTER_PADDING.x * 2.0;
        let column_text = match view.mode {
            Some(mode) => mode.label(),
            None => tr!("statsCard.bestMode", "Best mode"),
        };
        let column = text::column_label().layout(ctx, text::column_label().job(&column_text));
        let ranks = view
            .groups
            .iter()
            .map(|group| {
                group
                    .players
                    .iter()
                    .map(|player| rank_galleys(ctx, view.mode, player))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let rank_text_width = ranks
            .iter()
            .flatten()
            .flatten()
            .map(|(_, division, rating)| {
                division
                    .size()
                    .x
                    .max(rating.as_ref().map_or(0.0, |rating| rating.size().x))
            })
            .fold(column.size().x - ROSTER_EMBLEM - ROSTER_ICON_GAP, f32::max);
        let left_width = inner_width
            - ROSTER_SWATCH_WIDTH
            - theme::SPACE_SM
            - ROSTER_RACE_ICON
            - ROSTER_ICON_GAP
            - ROSTER_EMBLEM
            - ROSTER_ICON_GAP
            - rank_text_width
            - theme::SPACE_MD;
        let mut height = ROSTER_PADDING.y * 2.0;
        let groups = view
            .groups
            .iter()
            .zip(ranks)
            .enumerate()
            .map(|(i, (group, ranks))| {
                let heading =
                    text::column_label().layout(ctx, text::column_label().job(&group.side.label()));
                if i > 0 {
                    height += theme::SPACE_SM * 2.0 + theme::HAIRLINE;
                }
                height += heading.size().y.max(column.size().y) + theme::SPACE_XS;
                let rows = group
                    .players
                    .iter()
                    .zip(ranks)
                    .map(|(player, rank)| RosterRowLayout::new(ctx, player, rank, left_width))
                    .collect::<Vec<_>>();
                height += rows.iter().map(|row| row.height).sum::<f32>()
                    + ROSTER_ROW_GAP * rows.len().saturating_sub(1) as f32;
                (heading, rows)
            })
            .collect();
        RosterLayout {
            column,
            groups,
            rank_text_width,
            height,
        }
    }

    fn paint(&self, painter: &Painter, rect: Rect) {
        paint_chrome(painter, rect, None);
        let inner = rect.shrink2(ROSTER_PADDING);
        let rank_left = inner.right() - self.rank_text_width - ROSTER_ICON_GAP - ROSTER_EMBLEM;
        let mut top = inner.top();
        for (i, (heading, rows)) in self.groups.iter().enumerate() {
            if i > 0 {
                top += theme::SPACE_SM;
                painter.hline(
                    inner.x_range(),
                    top,
                    Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
                );
                top += theme::HAIRLINE + theme::SPACE_SM;
            }
            let heading_height = heading.size().y.max(self.column.size().y);
            painter.galley(pos2(inner.left(), top), heading.clone(), theme::TEXT_DIM);
            if i == 0 {
                painter.galley(pos2(rank_left, top), self.column.clone(), theme::TEXT_DIM);
            }
            top += heading_height + theme::SPACE_XS;
            for row in rows {
                row.paint(
                    painter,
                    Rect::from_min_size(pos2(inner.left(), top), vec2(inner.width(), row.height)),
                    rank_left,
                );
                top += row.height + ROSTER_ROW_GAP;
            }
        }
    }
}

/// The division and MMR a row shows on its right, for a player whose stats are in.
fn rank_galleys(
    ctx: &Context,
    mode: Option<MatchmakingMode>,
    player: &RosterPlayer,
) -> Option<RankGalleys> {
    let RosterStats::Loaded(record) = &player.stats else {
        return None;
    };
    let division_spec = text::body(ROSTER_DIVISION_SIZE, BodyWeight::Semibold);
    let Some(rank) = record.standing.and_then(|standing| standing.rank) else {
        let spec = division_spec.with_color(theme::TEXT_SECONDARY);
        let unranked = spec.layout(ctx, spec.job(&tr!("statsCard.unranked", "Unranked")));
        return Some((Division::Unrated, unranked, None));
    };
    let division = division_spec.layout(ctx, division_spec.job(&rank.division.label()));
    let mut job = LayoutJob::default();
    append(
        &mut job,
        &text::numeral_strong(ROSTER_RATING_SIZE),
        &rank.rating.to_string(),
        0.0,
    );
    append(
        &mut job,
        &text::numeral(ROSTER_RATING_SIZE).with_color(theme::TEXT_DIM),
        &tr!("statsCard.mmr", "MMR"),
        3.0,
    );
    // Outside matchmaking each row is about its own player's best mode, so it says which.
    if mode.is_none()
        && let Some(standing) = record.standing
    {
        append(
            &mut job,
            &text::body(ROSTER_DETAIL_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY),
            &format!("· {}", standing.mode.label()),
            5.0,
        );
    }
    Some((rank.division, division, Some(text_layout(ctx, job))))
}

impl RosterRowLayout {
    fn new(
        ctx: &Context,
        player: &RosterPlayer,
        rank: Option<RankGalleys>,
        left_width: f32,
    ) -> RosterRowLayout {
        let name_spec = text::player_name(ROSTER_NAME_SIZE);
        let name = name_spec.layout(ctx, name_spec.job_truncated(&player.name, left_width));
        let dim = |message: String| {
            let spec =
                text::body(ROSTER_DETAIL_SIZE, BodyWeight::Regular).with_color(theme::TEXT_DIM);
            spec.layout(ctx, spec.job_truncated(&message, left_width))
        };
        let detail = match &player.stats {
            RosterStats::Loading => dim(tr!("statsCard.roster.loading", "Loading\u{2026}")),
            RosterStats::Unavailable => dim(tr!("statsCard.roster.unavailable", "No stats")),
            RosterStats::Loaded(record) => {
                let mut job = record_job(record.wins, record.losses, ROSTER_RECORD_SIZE);
                if let Some(race) = record.main_race {
                    let main = tr!(
                        "statsCard.mainRace",
                        "{{race}} main",
                        race = race_name(race)
                    );
                    append(
                        &mut job,
                        &text::body(ROSTER_DETAIL_SIZE, BodyWeight::Regular)
                            .with_color(theme::TEXT_SECONDARY),
                        &format!("· {main}"),
                        6.0,
                    );
                }
                job.wrap = TextWrapping {
                    max_width: left_width,
                    max_rows: 1,
                    break_anywhere: true,
                    overflow_character: Some('\u{2026}'),
                };
                text_layout(ctx, job)
            }
        };
        let rank_height = rank.as_ref().map_or(0.0, |(_, division, rating)| {
            ROSTER_EMBLEM
                .max(division.size().y + rating.as_ref().map_or(0.0, |rating| rating.size().y))
        });
        RosterRowLayout {
            color: player.color,
            race: player.race,
            height: (name.size().y + detail.size().y).max(rank_height),
            name,
            detail,
            rank,
        }
    }

    fn paint(&self, painter: &Painter, rect: Rect, rank_left: f32) {
        painter.rect_filled(
            Rect::from_min_size(rect.min, vec2(ROSTER_SWATCH_WIDTH, rect.height())),
            CornerRadius::from(theme::RADIUS_TIGHT),
            self.color,
        );
        let left = rect.left() + ROSTER_SWATCH_WIDTH + theme::SPACE_SM;
        let name_top = rect.center().y - (self.name.size().y + self.detail.size().y) * 0.5;
        let icon = icon_rect(
            pos2(
                left + ROSTER_RACE_ICON * 0.5,
                name_top + self.name.size().y * 0.5,
            ),
            ROSTER_RACE_ICON,
            painter.ctx().pixels_per_point(),
        );
        paint_race_icon(painter, icon, self.race, self.race.color());
        let text_left = left + ROSTER_RACE_ICON + ROSTER_ICON_GAP;
        painter.galley(
            pos2(text_left, name_top),
            self.name.clone(),
            theme::TEXT_PRIMARY,
        );
        painter.galley(
            pos2(text_left, name_top + self.name.size().y),
            self.detail.clone(),
            theme::TEXT_SECONDARY,
        );
        if let Some((division, division_text, rating)) = &self.rank {
            let emblem = icon_rect(
                pos2(rank_left + ROSTER_EMBLEM * 0.5, rect.center().y),
                ROSTER_EMBLEM,
                painter.ctx().pixels_per_point(),
            );
            paint_division_icon(painter, emblem, *division);
            let text_left = rank_left + ROSTER_EMBLEM + ROSTER_ICON_GAP;
            let height =
                division_text.size().y + rating.as_ref().map_or(0.0, |rating| rating.size().y);
            let top = rect.center().y - height * 0.5;
            painter.galley(
                pos2(text_left, top),
                division_text.clone(),
                theme::TEXT_PRIMARY,
            );
            if let Some(rating) = rating {
                painter.galley(
                    pos2(text_left, top + division_text.size().y),
                    rating.clone(),
                    theme::TEXT_PRIMARY,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rated(mode: MatchmakingMode, division: Division, rating: u32) -> ModeStanding {
        ModeStanding {
            mode,
            rank: Some(Rank { division, rating }),
        }
    }

    fn view(best: Option<ModeStanding>, current: Option<ModeStanding>) -> StatsCardView {
        StatsCardView {
            name: "tec27".to_string(),
            main_race: Some(RaceView::Protoss),
            wins: 120,
            losses: 80,
            best,
            current,
        }
    }

    #[test]
    fn every_division_emblem_rasterizes() {
        for division in Division::ALL {
            let image = rasterize(division.svg(), 48).expect("emblem parses");
            assert!(
                image.pixels.iter().any(|pixel| pixel.a() > 0),
                "{division:?} drew nothing"
            );
        }
    }

    fn row(caption: &str, standing: ModeStanding) -> StandingRow {
        StandingRow {
            caption: caption.to_string(),
            mode: Some(standing.mode),
            rank: standing.rank,
        }
    }

    #[test]
    fn best_and_current_modes_get_a_row_each() {
        let best = rated(MatchmakingMode::TwoVTwo, Division::Gold2, 1820);
        let current = rated(MatchmakingMode::OneVOne, Division::Silver1, 1550);
        assert_eq!(
            standing_rows(&view(Some(best), Some(current))),
            vec![row("Best mode", best), row("This game", current)]
        );
    }

    #[test]
    fn a_best_mode_that_is_this_games_mode_is_one_row() {
        let best = rated(MatchmakingMode::OneVOne, Division::Gold2, 1820);
        assert_eq!(
            standing_rows(&view(Some(best), Some(best))),
            vec![row("Best mode · This game", best)]
        );
    }

    #[test]
    fn a_player_rated_in_nothing_still_has_a_row_about_no_mode() {
        assert_eq!(
            standing_rows(&view(None, None)),
            vec![StandingRow {
                caption: "Best mode".to_string(),
                mode: None,
                rank: None,
            }]
        );
    }

    #[test]
    fn the_subtitle_names_the_main_race_and_the_record() {
        assert_eq!(
            subtitle(&view(None, None)),
            "Protoss main · 200 games · 60% won"
        );
        let mut no_games = view(None, None);
        no_games.wins = 0;
        no_games.losses = 0;
        assert_eq!(subtitle(&no_games), "No games played");
    }

    #[test]
    fn a_card_holds_then_leaves_on_its_own() {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let mut card = StatsCard::new(StatsCardContent::Stats(view(
            Some(rated(MatchmakingMode::OneVOne, Division::Gold2, 1820)),
            None,
        )));
        let mut frame_at = |time: f64| {
            ctx.begin_pass(egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1280.0, 720.0))),
                time: Some(time),
                ..Default::default()
            });
            let shown = card.draw(&ctx, None);
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            out.textures_delta.clear();
            shown
        };
        assert!(frame_at(0.0));
        assert!(frame_at(HOLD_SECS - 0.1));
        assert!(frame_at(HOLD_SECS + FADE_SECS - 0.1));
        assert!(frame_at(HOLD_SECS + FADE_SECS + 0.01));
        assert!(!frame_at(HOLD_SECS + FADE_SECS + 1.0));
    }

    #[test]
    fn the_roster_is_up_while_held_and_gone_soon_after_release() {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        let roster = RosterView {
            mode: Some(MatchmakingMode::OneVOne),
            groups: vec![RosterGroup {
                side: RosterSide::Opponents,
                players: vec![RosterPlayer {
                    name: "tec27".to_string(),
                    color: Color32::RED,
                    race: RaceView::Protoss,
                    stats: RosterStats::Loading,
                }],
            }],
        };
        let frame_at = |time: f64, held: bool| {
            ctx.begin_pass(egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1280.0, 720.0))),
                time: Some(time),
                ..Default::default()
            });
            let shown = draw_roster(&ctx, &roster, held, None);
            let mut out = ctx.end_pass();
            let _ = ctx.tessellate(out.shapes, ctx.pixels_per_point());
            out.textures_delta.clear();
            shown
        };
        assert!(frame_at(0.0, true));
        assert!(frame_at(30.0, true));
        assert!(frame_at(30.01, false));
        assert!(!frame_at(31.0, false));
    }
}
