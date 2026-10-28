//! The graphs panel: one measurement of the game, plotted for every player since the first frame.
//!
//! A panel that plotted everything at once would plot nothing legibly, so it plots one series at a
//! time. Which one is up, and which one the watcher could have instead, is the tab strip under the
//! header: the key that opens the panel walks that same strip, and a walk with no map is a walk
//! nobody can aim.
//!
//! The plot itself is the kit's, so the axes, the legend and the fill under each line look the same
//! here as anywhere else the overlay draws a series.

use egui::{Align, Color32, Context, Id, Layout, Rect, Ui, vec2};
use serde::{Deserialize, Serialize};

use crate::kit::widgets::{self, Series};
use crate::kit::{theme, tiers};
use crate::observer::{Wing, wing_panel};
use crate::shell::Panel;
use crate::tr;

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 486.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 462.0;

/// How tall the plot is, axes and legend included, with all the room it wants.
const PLOT_HEIGHT: f32 = 150.0;

/// The shortest the plot is drawn, on a screen with less room under the panel than it wants: about
/// what still shows two lines crossing. Shorter than that the panel gives way altogether.
const MIN_PLOT_HEIGHT: f32 = 90.0;

/// Height of the row of tabs under the header.
const TAB_ROW: f32 = 24.0;

/// What the panel takes from top to bottom besides its plot.
const CHROME_HEIGHT: f32 =
    tiers::PANEL_MARGIN_HEIGHT + widgets::PANEL_HEADER_HEIGHT + TAB_ROW + theme::SPACE_SM;

/// How tall the plot is drawn in a panel whose top is at `top` and which must end above `floor`, or
/// `None` where not even the shortest plot fits.
fn plot_height(top: f32, floor: f32) -> Option<f32> {
    let room = floor - top - CHROME_HEIGHT;
    (room >= MIN_PLOT_HEIGHT).then(|| room.min(PLOT_HEIGHT))
}

/// Whether the panel fits between `top` and `floor` at all.
pub(crate) fn fits(top: f32, floor: f32) -> bool {
    plot_height(top, floor).is_some()
}

/// Which measurement of the game the panel is plotting.
///
/// The order is the order the panel's key walks them in, and it runs from what a watcher checks
/// most often to what they go looking for: who has the bigger army, then where that came from.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum GraphSeries {
    /// What each player's standing army cost to build, in minerals and gas together.
    #[default]
    ArmyValue,
    /// Resources gathered per minute.
    Income,
    /// Supply in use.
    Supply,
    /// How many workers each player owns.
    Workers,
    /// How many units each player has killed.
    Kills,
}

impl GraphSeries {
    pub const ALL: [GraphSeries; 5] = [
        GraphSeries::ArmyValue,
        GraphSeries::Income,
        GraphSeries::Supply,
        GraphSeries::Workers,
        GraphSeries::Kills,
    ];

    /// The series after this one, wrapping from the last back to the first.
    pub fn next(self) -> GraphSeries {
        self.stepped(1)
    }

    /// The series before this one, wrapping from the first round to the last.
    pub fn previous(self) -> GraphSeries {
        self.stepped(GraphSeries::ALL.len() - 1)
    }

    fn stepped(self, by: usize) -> GraphSeries {
        let index = GraphSeries::ALL
            .iter()
            .position(|kind| *kind == self)
            .unwrap_or_default();
        GraphSeries::ALL[(index + by) % GraphSeries::ALL.len()]
    }

    /// What this series is called, which is what its tab is labeled with.
    pub fn title(self) -> String {
        match self {
            GraphSeries::ArmyValue => tr!("observer.seriesArmyValue", "Army value"),
            GraphSeries::Income => tr!("observer.seriesIncome", "Income"),
            GraphSeries::Supply => tr!("observer.seriesSupply", "Supply"),
            GraphSeries::Workers => tr!("observer.seriesWorkers", "Workers"),
            GraphSeries::Kills => tr!("observer.seriesKills", "Kills"),
        }
    }

    /// A short name for this series in a knob panel or a log line.
    pub fn label(self) -> &'static str {
        match self {
            GraphSeries::ArmyValue => "army value",
            GraphSeries::Income => "income",
            GraphSeries::Supply => "supply",
            GraphSeries::Workers => "workers",
            GraphSeries::Kills => "kills",
        }
    }
}

/// Whether the plot's lines are the game's sides or the players on them.
///
/// Only a game that has both is asked: one player per side gives the same plot either way, and a
/// panel that offered to switch between two identical plots would be advertising a distinction the
/// game does not have.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum GraphGrouping {
    Teams,
    Players,
}

/// One line on the plot: a player's, or a whole side's.
pub struct GraphLineView {
    /// Who the line belongs to, which is what the legend names it by.
    pub label: String,
    /// The color this player is on the map, so a line and the player it plots are the same color
    /// everywhere the overlay draws either of them.
    pub color: Color32,
    /// Evenly spaced samples over the whole game so far, oldest first.
    pub values: Vec<f32>,
}

/// Everything the graphs panel draws from.
pub struct GraphsView {
    /// Which measurement these lines are of. The host is told which one the watcher asked for and
    /// samples that one, rather than sending every series every frame.
    pub series: GraphSeries,
    /// How much game time the samples cover, in seconds, which is what the time axis is labeled
    /// from: a plot of the first two minutes and a plot of an hour look identical without it.
    pub span_secs: u32,
    pub lines: Vec<GraphLineView>,
    /// What the lines are of, for a game that has both forms, or `None` for one that does not. The
    /// panel offers the other form beside its series tabs while this is set.
    pub grouping: Option<GraphGrouping>,
}

impl GraphsView {
    /// Whether there is anything at all to plot.
    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(|line| line.values.len() < 2)
    }
}

/// What the watcher asked of the graphs panel this frame.
pub struct GraphsOutcome {
    /// Where the panel is on screen, for the host's hit testing.
    pub rect: Rect,
    /// A measurement to plot instead.
    pub series: Option<GraphSeries>,
    /// Whether the lines should be the players rather than the sides they are on.
    pub per_player: Option<bool>,
    /// How far into the game the watcher clicked the plot, in seconds, for a plot that takes clicks.
    pub seek_secs: Option<u32>,
}

/// Draws the graphs panel against the right edge of the screen at `top`, fading and sliding it in
/// and out. Returns nothing at all once it is gone, or before there are two samples to draw a line
/// between.
///
/// The panel ends above `floor`, shortening its plot to do so, and gives way altogether where even
/// the shortest plot would not: it is the last thing on the right edge, and a plot too short to
/// show two lines crossing is not worth the room it would take from the game.
///
/// `seekable` is whether the game being watched can be moved to a time, which only a replay can:
/// the plot then takes a click as a pick of the time under the pointer, and its hover card says so.
pub fn render_graphs_view(
    view: &GraphsView,
    ctx: &Context,
    shown: bool,
    top: f32,
    floor: f32,
    seekable: bool,
) -> Option<GraphsOutcome> {
    let id = Id::new("sb_graphs_panel");
    let plot = plot_height(top, floor);
    let inner = wing_panel(
        ctx,
        id,
        Wing::Right,
        top,
        PANEL_WIDTH,
        shown && !view.is_empty() && plot.is_some(),
        |ui| draw_panel(ui, view, plot.unwrap_or(MIN_PLOT_HEIGHT), seekable),
    )?;
    let ((series, per_player), seek_secs) = inner.inner;
    Some(GraphsOutcome {
        rect: inner.response.rect,
        series,
        per_player,
        seek_secs,
    })
}

/// Draws the panel, returning what its tabs picked and the time a click on the plot picked.
fn draw_panel(
    ui: &mut Ui,
    view: &GraphsView,
    plot: f32,
    seekable: bool,
) -> ((Option<GraphSeries>, Option<bool>), Option<u32>) {
    widgets::panel_header(
        ui,
        &tr!("observer.panelGraphs", "Graphs"),
        Panel::Graphs.key_label().as_deref(),
    );
    let picked = ui
        .allocate_ui_with_layout(
            vec2(CONTENT_WIDTH, TAB_ROW),
            Layout::top_down(Align::Min),
            |ui| {
                ui.set_min_height(TAB_ROW);
                draw_tabs(ui, view)
            },
        )
        .inner;
    ui.add_space(theme::SPACE_SM);
    let series: Vec<Series<'_>> = view
        .lines
        .iter()
        .map(|line| Series {
            label: &line.label,
            color: line.color,
            values: &line.values,
            // Two washed areas over each other would make the overlap a third color that belongs to
            // neither player, so the lines are drawn bare and told apart by their color alone.
            filled: false,
        })
        .collect();
    let size = vec2(CONTENT_WIDTH, plot);
    let seek_secs = if seekable {
        let hint = tr!("observer.graphSeekHint", "Click to jump here");
        widgets::line_plot_clickable(ui, &series, size, view.span_secs, &hint).clicked_secs
    } else {
        widgets::line_plot(ui, &series, size, view.span_secs);
        None
    };
    (picked, seek_secs)
}

/// Draws the row under the header: the measurements on the left, and what the lines stand for at
/// the right end of it in a game that has both forms of them.
///
/// A row of its own rather than tabs in the header, because five measurements, a title and a keycap
/// do not share one line in every language the overlay is read in.
fn draw_tabs(ui: &mut Ui, view: &GraphsView) -> (Option<GraphSeries>, Option<bool>) {
    let series_labels: Vec<String> = GraphSeries::ALL
        .into_iter()
        .map(|series| series.title())
        .collect();
    let grouping_labels = [
        tr!("observer.graphTeams", "Teams"),
        tr!("observer.graphPlayers", "Players"),
    ];
    ui.horizontal(|ui| {
        let row = ui.available_width();
        let grouping_room = match view.grouping {
            Some(_) => widgets::tab_strip_width(ui, &borrowed(&grouping_labels)) + theme::SPACE_MD,
            None => 0.0,
        };
        let index = GraphSeries::ALL
            .iter()
            .position(|series| *series == view.series)
            .unwrap_or(0);
        // The series strip is the one that gives way when the row is short: the grouping chips are
        // two short words, and a pair of them elided is a pair nobody can tell apart.
        let picked = widgets::tab_strip(
            ui,
            index,
            &borrowed(&series_labels),
            (row - grouping_room).max(0.0),
        )
        .and_then(|index| GraphSeries::ALL.get(index).copied());
        let grouping = view.grouping.and_then(|grouping| {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let active = usize::from(grouping == GraphGrouping::Players);
                widgets::tab_strip(
                    ui,
                    active,
                    &borrowed(&grouping_labels),
                    ui.available_width(),
                )
            })
            .inner
            .map(|index| index == 1)
        });
        (picked, grouping)
    })
    .inner
}

/// The kit's strips take borrowed labels, which is what a translated string has to be lent as.
fn borrowed(labels: &[String]) -> Vec<&str> {
    labels.iter().map(String::as_str).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plot_fills_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }

    #[test]
    fn the_panel_is_its_chrome_and_its_plot() {
        let view = GraphsView {
            series: GraphSeries::ArmyValue,
            span_secs: 600,
            lines: vec![GraphLineView {
                label: "Rhynso".to_string(),
                color: Color32::WHITE,
                values: vec![0.0, 1.0, 2.0],
            }],
            grouping: Some(GraphGrouping::Teams),
        };
        for floor in [1000.0, 100.0 + CHROME_HEIGHT + MIN_PLOT_HEIGHT + 20.0] {
            let rect = crate::observer::test_support::settled_rect(|ctx| {
                render_graphs_view(&view, ctx, true, 100.0, floor, false)
                    .map(|outcome| outcome.rect)
            })
            .expect("the panel is drawn");
            assert_eq!(
                rect.height(),
                CHROME_HEIGHT + plot_height(100.0, floor).unwrap()
            );
        }
    }

    #[test]
    fn the_plot_shortens_to_fit_and_then_gives_way() {
        assert_eq!(plot_height(100.0, 1000.0), Some(PLOT_HEIGHT));
        let short = 100.0 + CHROME_HEIGHT + MIN_PLOT_HEIGHT + 10.0;
        assert_eq!(plot_height(100.0, short), Some(MIN_PLOT_HEIGHT + 10.0));
        assert_eq!(plot_height(100.0, short - 20.0), None);
    }

    #[test]
    fn stepping_forward_visits_every_series_and_wraps() {
        let mut series = GraphSeries::ALL[0];
        let mut walked = vec![series];
        for _ in 1..GraphSeries::ALL.len() {
            series = series.next();
            walked.push(series);
        }
        assert_eq!(walked, GraphSeries::ALL.to_vec());
        assert_eq!(series.next(), GraphSeries::ALL[0]);
    }

    #[test]
    fn stepping_back_retraces_the_way_forward() {
        for series in GraphSeries::ALL {
            assert_eq!(series.next().previous(), series);
        }
        assert_eq!(
            GraphSeries::ALL[0].previous(),
            *GraphSeries::ALL.last().unwrap()
        );
    }
}
