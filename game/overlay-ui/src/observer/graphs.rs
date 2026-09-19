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

use crate::kit::theme;
use crate::kit::widgets::{self, Series};
use crate::observer::{Wing, wing_panel};
use crate::tr;

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 486.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = 462.0;

/// How tall the plot is, axes and legend included.
const PLOT_HEIGHT: f32 = 150.0;

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

    /// The next series in the walk, or `None` after the last one.
    ///
    /// `None` rather than wrapping, because the key that walks these is also the key that closes
    /// the panel: a walk with no end would leave the watcher pressing it five more times to get
    /// their screen back.
    pub fn next(self) -> Option<GraphSeries> {
        let index = GraphSeries::ALL.iter().position(|kind| *kind == self)?;
        GraphSeries::ALL.get(index + 1).copied()
    }

    /// The series before this one, or `None` at the first one. Ends rather than wrapping, for the
    /// reason [`GraphSeries::next`] does.
    pub fn previous(self) -> Option<GraphSeries> {
        let index = GraphSeries::ALL.iter().position(|kind| *kind == self)?;
        GraphSeries::ALL.get(index.checked_sub(1)?).copied()
    }

    /// What this series is called, which is what its tab is labelled with.
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
    /// How much game time the samples cover, in seconds, which is what the time axis is labelled
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
}

/// Draws the graphs panel against the right edge of the screen at `top`, fading and sliding it in
/// and out. Returns nothing at all once it is gone, or before there are two samples to draw a line
/// between.
pub fn render_graphs_view(
    view: &GraphsView,
    ctx: &Context,
    shown: bool,
    top: f32,
) -> Option<GraphsOutcome> {
    let id = Id::new("sb_graphs_panel");
    let inner = wing_panel(
        ctx,
        id,
        Wing::Right,
        top,
        PANEL_WIDTH,
        shown && !view.is_empty(),
        |ui| draw_panel(ui, view),
    )?;
    let (series, per_player) = inner.inner;
    Some(GraphsOutcome {
        rect: inner.response.rect,
        series,
        per_player,
    })
}

fn draw_panel(ui: &mut Ui, view: &GraphsView) -> (Option<GraphSeries>, Option<bool>) {
    widgets::panel_header(ui, &tr!("observer.panelGraphs", "Graphs"), Some("G"));
    let picked = draw_tabs(ui, view);
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
    widgets::line_plot(
        ui,
        &series,
        vec2(CONTENT_WIDTH, PLOT_HEIGHT),
        view.span_secs,
    );
    picked
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
    fn the_walk_ends_rather_than_wrapping() {
        let mut series = GraphSeries::default();
        let mut walked = vec![series];
        while let Some(next) = series.next() {
            series = next;
            walked.push(series);
        }
        assert_eq!(walked, GraphSeries::ALL.to_vec());
    }

    #[test]
    fn walking_back_retraces_the_way_forward() {
        let mut series = *GraphSeries::ALL.last().unwrap();
        let mut walked = vec![series];
        while let Some(previous) = series.previous() {
            series = previous;
            walked.push(series);
        }
        walked.reverse();
        assert_eq!(walked, GraphSeries::ALL.to_vec());
    }
}
