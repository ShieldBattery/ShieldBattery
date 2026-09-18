//! The graphs panel: one measurement of the game, plotted for every player since the first frame.
//!
//! A panel that plotted everything at once would plot nothing legibly, so it plots one series at a
//! time and the watcher walks between them. That is why the panel's title is the series' own name
//! rather than the word "graphs": the key that opens the panel is also the key that cycles it, and
//! the title is what tells the watcher where in the cycle they are.
//!
//! The plot itself is the kit's, so the axes, the legend and the fill under each line look the same
//! here as anywhere else the overlay draws a series.

use egui::{Color32, Context, Id, Rect, Ui, vec2};
use serde::{Deserialize, Serialize};

use crate::kit::widgets::{self, Series};
use crate::observer::{Wing, wing_panel};
use crate::tr;

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 486.0;

/// How far its top edge sits below the screen's, which is under the military panel above it.
const PANEL_TOP: f32 = 224.0;

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

    /// The next series in the cycle, or `None` after the last one.
    ///
    /// `None` rather than wrapping, because the key that walks this cycle is also the key that
    /// closes the panel: a cycle with no end would leave the watcher pressing it five more times to
    /// get their screen back.
    pub fn next(self) -> Option<GraphSeries> {
        let index = GraphSeries::ALL.iter().position(|kind| *kind == self)?;
        GraphSeries::ALL.get(index + 1).copied()
    }

    /// What this series is called, which is also the panel's title while it is the one plotted.
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

/// One player's line on the plot.
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
}

impl GraphsView {
    /// Whether there is anything at all to plot.
    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(|line| line.values.len() < 2)
    }
}

/// Draws the graphs panel against the right edge of the screen, fading and sliding it in and out.
/// Returns nothing at all once it is gone, or before there are two samples to draw a line between.
pub fn render_graphs_view(view: &GraphsView, ctx: &Context, shown: bool) -> Option<Rect> {
    let id = Id::new("sb_graphs_panel");
    let inner = wing_panel(
        ctx,
        id,
        Wing::Right,
        PANEL_TOP,
        PANEL_WIDTH,
        shown && !view.is_empty(),
        |ui| draw_panel(ui, view),
    )?;
    Some(inner.response.rect)
}

fn draw_panel(ui: &mut Ui, view: &GraphsView) {
    widgets::panel_header(ui, &view.series.title(), Some("G"));
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
    fn the_cycle_ends_rather_than_wrapping() {
        let mut series = GraphSeries::default();
        let mut walked = vec![series];
        while let Some(next) = series.next() {
            series = next;
            walked.push(series);
        }
        assert_eq!(walked, GraphSeries::ALL.to_vec());
    }
}
