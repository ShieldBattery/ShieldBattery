//! The observer panels' composition: where each panel goes this frame given the room the others
//! took, and the state that placement and the panels' controls carry between frames.

use egui::{Context, Key, Rect};

use super::hotkeys::{self, Action, Hotkeys};
use super::prefs::{MatchupStyle, Panel, PanelPrefs, PanelSet};
use super::replay::ReplayCommands;
use super::{HitRect, HostFrame, Intent, Mode};
use crate::kit::motion::Spot;
use crate::observer::{self, ObserverView, SelectedUnitClick};
use crate::playback_controls::PlaybackControlsPlacement;

/// The observer panels' state across frames.
#[derive(Default)]
pub(super) struct ObserverPanels {
    /// Whether the last observer frame carried a map-control measurement. The bar's key is only the
    /// shell's while there is something behind it, and a keypress arrives between frames, so what
    /// the last frame was told has to be kept here.
    map_control_available: bool,
    /// The player whose control groups are shown: the owner of the last unit the watcher selected.
    /// Kept across frames because it outlives the selection that set it.
    focused_player: Option<u8>,
    /// Whether the list of players under the minimap's vision button is open.
    vision_picker_open: bool,
    /// Whether the watcher had anything selected as of the last frame, which is whether Escape
    /// has a selection to let go of.
    has_selection: bool,
    /// The player whose number keys a digit recalls, and which of their keys have a group on them
    /// (one bit per digit), as the control groups row last showed them.
    number_keys: Option<(u8, u16)>,
    /// The minimap's square as the host last reported it, which the panels beside it keep clear of
    /// while it is hidden and the host has no square to report.
    last_minimap_rect: Option<Rect>,
    /// Where the dock stands, decided along with the bottom panels and kept here until the plate it
    /// may stand on has been drawn.
    dock_plan: Option<DockPlan>,
    /// The order the panels that give way to one another claim the screen's room in.
    claims: Claims,
}

/// The panels that give way to one another where the screen has no room for them all: every panel
/// but the matchup, the minimap, the selection panel and the playback controls, which are placed
/// before them and never give way to them. Listed in the order they claim room in until the watcher
/// has turned any of them on: the bottom panels' column first, then the wings.
const YIELDING: [Panel; 6] = [
    Panel::ControlGroups,
    Panel::Production,
    Panel::Economy,
    Panel::Military,
    Panel::Timeline,
    Panel::Graphs,
];

/// The order the yielding panels claim the screen's room in, the one turned on last first: a panel
/// the watcher has just asked for is drawn, and the ones in its way are kept on with no room until
/// it goes again.
struct Claims {
    order: [Panel; YIELDING.len()],
    /// Which of them were on as of the last frame, which is how one being turned on is told.
    on: Option<PanelSet>,
}

impl Default for Claims {
    fn default() -> Claims {
        Claims {
            order: YIELDING,
            on: None,
        }
    }
}

impl Claims {
    /// Moves the panels turned on since the last frame to the front, keeping their order among
    /// themselves, as a key that brings several back at once does.
    fn note(&mut self, prefs: &PanelPrefs) {
        let on = YIELDING
            .into_iter()
            .filter(|&panel| prefs.shown(panel))
            .fold(PanelSet::default(), |mut on, panel| {
                on.insert(panel);
                on
            });
        if let Some(were_on) = self.on.replace(on) {
            self.order
                .sort_by_key(|&panel| !(on.contains(panel) && !were_on.contains(panel)));
        }
    }
}

/// Where control groups and production stand this frame.
#[derive(Copy, Clone)]
struct ColumnSlots {
    /// Where control groups stand, and the form they are laid out in there.
    groups: observer::StackSlot,
    groups_form: observer::ControlGroupsForm,
    /// Where production stands with nothing under it.
    production: observer::StackSlot,
    /// Whether production stands on control groups, rather than in a run of its own.
    production_on_groups: bool,
}

impl ColumnSlots {
    /// Where production stands with control groups drawn at `groups`, if they are drawn.
    fn production(self, groups: Option<Rect>) -> observer::StackSlot {
        if self.production_on_groups {
            observer::StackSlot {
                bottom: self.production.bottom + observer::stack_share(groups),
                ..self.production
            }
        } else {
            self.production
        }
    }
}

/// Where the yielding panels would stand this frame, worked out from the view's own measures before
/// any of them is drawn, so that which of them the screen has room for can be tried a set at a time.
struct YieldingRoom<'a> {
    view: &'a ObserverView,
    /// Where control groups and production stand.
    column: ColumnSlots,
    tops: observer::WingTops,
    /// What stands under the wings besides the column: the selection panel, the minimap's frame,
    /// the plate and the dock.
    under_wings: &'a [Rect],
    left_span: observer::Span,
    right_span: observer::Span,
    /// Whether the screen has room for the right wing beside the left one at all.
    right_room: bool,
    screen_bottom: f32,
}

impl YieldingRoom<'_> {
    /// Whether every panel in `panels` fits where it stands with the others in it drawn: the column
    /// stood on the bottom edge or the minimap's frame, and each wing under the one above it and
    /// above whatever stands in its own column, the column included.
    fn all_fit(&self, panels: PanelSet) -> bool {
        use crate::observer::layout::{self, Span};
        use crate::observer::{control_groups, economy, graphs, military, timeline};

        let gap = observer::WING_GAP;
        let standing = |slot: observer::StackSlot, size: egui::Vec2| {
            let placed = slot.place(size.x);
            let bottom = slot.screen_bottom - slot.bottom;
            Rect::from_min_max(
                egui::pos2(placed.left, bottom - size.y),
                egui::pos2(placed.right, bottom),
            )
        };
        let mut under = self.under_wings.to_vec();
        let mut groups = None;
        if panels.contains(Panel::ControlGroups) {
            let (slot, form) = (self.column.groups, self.column.groups_form);
            let Some(width) = control_groups::fitted_width(slot, form) else {
                return false;
            };
            let rect = standing(slot, egui::vec2(width, form.height()));
            groups = Some(rect);
            under.push(rect);
        }
        if panels.contains(Panel::Production) {
            let slot = self.column.production(groups);
            let Some(fit) = observer::production::ProductionFit::of(&self.view.production, slot)
            else {
                return false;
            };
            under.push(standing(slot, fit.size(&self.view.production)));
        }
        let floor = |span: Span| layout::highest_top_under(span, &under, self.screen_bottom) - gap;
        let (left_floor, right_floor) = (floor(self.left_span), floor(self.right_span));
        let mut left_top = self.tops.left;
        if panels.contains(Panel::Economy) {
            let height = economy::panel_height(&self.view.economy);
            if left_top + height > left_floor {
                return false;
            }
            left_top += height + gap;
        }
        if panels.contains(Panel::Timeline) && !timeline::fits(left_top, left_floor) {
            return false;
        }
        let mut right_top = self.tops.right;
        if panels.contains(Panel::Military) {
            let height = military::panel_height(&self.view.military);
            if !self.right_room || right_top + height > right_floor {
                return false;
            }
            right_top += height + gap;
        }
        !panels.contains(Panel::Graphs) || self.right_room && graphs::fits(right_top, right_floor)
    }
}

/// What the dock is drawn from once the plate has been.
struct DockPlan {
    placement: observer::DockPlacement,
    /// The panels the watcher wants on screen that the screen had no room for.
    displaced: Vec<Panel>,
}

/// What the observer panels read and write of the rest of the shell while they are drawn.
pub(super) struct ObserverFrame<'a> {
    pub(super) host: &'a HostFrame,
    pub(super) hotkeys: &'a Hotkeys,
    pub(super) prefs: &'a mut PanelPrefs,
    pub(super) replay: &'a mut ReplayCommands,
    pub(super) intents: &'a mut Vec<Intent>,
    pub(super) hit_rects: &'a mut Vec<HitRect>,
}

impl ObserverPanels {
    /// Whether the list of players under the minimap's vision button is open.
    pub(super) fn vision_picker_open(&self) -> bool {
        self.vision_picker_open
    }

    pub(super) fn set_vision_picker_open(&mut self, open: bool) {
        self.vision_picker_open = open;
    }

    /// Asks for the watcher's selection to be let go of, returning whether there was one.
    pub(super) fn clear_selection(&mut self, intents: &mut Vec<Intent>) -> bool {
        if !self.has_selection {
            return false;
        }
        self.has_selection = false;
        intents.push(Intent::ClearSelection);
        true
    }

    /// Whether the last observer frame carried a map-control measurement.
    pub(super) fn map_control_available(&self) -> bool {
        self.map_control_available
    }

    /// Draws the observer panels the watcher has left on screen, turning what they did with them
    /// into intents for the host and into preferences of its own.
    ///
    /// The panels are placed against each other rather than at the design's coordinates (see
    /// [`observer::layout`]), so they are drawn in the order the screen's room is handed out: the
    /// surfaces hung from the top edge, then the minimap's frame, the stack along the bottom edge and
    /// the dock's place against the plate or the selection panel, which between them say how much of
    /// each side is left for the wings. `has_playback_controls` is whether there is a replay plate to
    /// share the bottom of the screen with. Returns whether the dock stands on the plate's top
    /// edge, the plate itself keeping its corner either way; the dock is drawn by
    /// [`frame_dock`](Self::frame_dock) once the plate has been.
    pub(super) fn frame(
        &mut self,
        ctx: &Context,
        view: &ObserverView,
        has_playback_controls: bool,
        shell: ObserverFrame<'_>,
    ) -> PlaybackControlsPlacement {
        use observer::layout::{self, Span};

        let ObserverFrame {
            host,
            hotkeys,
            prefs,
            replay,
            intents,
            hit_rects,
        } = shell;

        self.map_control_available = view.map_control.is_some();
        let screen = ctx.viewport_rect();
        let gap = observer::WING_GAP;
        // What the watcher wants on screen and the screen had no room for this frame.
        let mut displaced = Vec::new();
        // The surfaces hung from the screen's top edge, which everything below keeps under.
        let mut top_surfaces = Vec::new();

        // The matchup is either the bar across the top edge, with the corner cards a game too big
        // for it gets, or the compact scoreboard in the top-right corner. Both forms are drawn every
        // frame with only the watcher's choice shown, so a switch fades one out as the other comes
        // in rather than cutting between them.
        let style = prefs.matchup_style();
        let bar_shown = style == MatchupStyle::Bar;
        if let Some(outcome) = observer::render_matchup_view(&view.matchup, ctx, bar_shown) {
            hit_rects.push(HitRect::new(outcome.rect));
            top_surfaces.push(outcome.rect);
            if let Some(player_id) = outcome.toggled_vision {
                intents.push(Intent::ToggleVision { player_id });
            }
        }
        // The reporting panels take no clicks of their own, but every one of them is an opaque
        // surface: a click that landed on a number and went on to select whatever unit was behind
        // it would make the panels unusable exactly where they are most worth reading.
        if let Some(map_control) = &view.map_control {
            if prefs.map_control && !observer::map_control::fits(screen.width()) {
                displaced.push(Panel::MapControl);
            }
            // Hung under the matchup bar while the bar is up, and from the screen's own top edge
            // once it is put away or the matchup is the scoreboard in the corner, moving off as the
            // bar starts to go rather than once it has. A strip put away along with the bar leaves
            // from where it stands, as the panels put away with it do, rather than sliding up
            // across the bar on its way out.
            let wanted_top = if bar_shown {
                view.matchup.form().height() + observer::MAP_CONTROL_GAP
            } else {
                observer::WING_MARGIN
            };
            let spot = Spot::new(ctx, spot_id("map_control"), prefs.map_control, [wanted_top]);
            let [top] = spot.at();
            let drawn = observer::render_map_control_view(map_control, ctx, prefs.map_control, top);
            spot.drawn(drawn.is_some());
            if let Some(rect) = drawn {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
        }

        // The minimap's square is the game's wherever it is, and the frame around it is kept clear
        // whether or not it is drawn: a watcher who hides the minimap has not asked for the panels
        // to move into its corner.
        if host.minimap_rect.is_some() {
            self.last_minimap_rect = host.minimap_rect;
        }
        let square = layout::minimap_square(screen, self.last_minimap_rect);
        let minimap = observer::minimap::footprint(screen, square);
        let minimap_on_left = minimap.center().x < screen.center().x;
        // The bottom panels keep clear of the frame the minimap has at its largest rather than the
        // one it is drawn with: the game draws a map smaller than its square, or one that is not
        // square, smaller, and reports no minimap at all while it is hidden, so panels kept to the
        // minimap's own frame would move with the map and with the minimap's key. Only a minimap
        // the game puts past that square moves them.
        let reserve = observer::minimap::footprint(screen, observer::minimap_reserve(screen));
        let minimap_right = minimap.right().max(reserve.right());
        let minimap_top = minimap.top().min(reserve.top());
        // The run of the bottom edge the bottom panels keep to: from the frame of a minimap in the
        // bottom-left corner to its reserve's mirror image, short of the plate's corner in a replay
        // whether or not the plate is up (see `layout::bottom_band`), so the selection panel at its
        // far end never moves. A minimap on the right edge leaves them the run from the left edge
        // to it.
        let band = {
            let edge_right = screen.right() - observer::WING_MARGIN;
            if minimap_on_left {
                let run = Span {
                    left: minimap_right + gap,
                    right: edge_right,
                };
                let plate_corner = has_playback_controls
                    .then(|| PlaybackControlsPlacement::default().rect(screen));
                layout::bottom_band(screen, run, plate_corner)
            } else {
                Span {
                    left: screen.left() + observer::WING_MARGIN,
                    right: edge_right.min(minimap.left() - gap),
                }
            }
        };

        let playback_controls_shown = has_playback_controls && prefs.playback_controls;

        let scoreboard =
            observer::render_scoreboard_view(&view.matchup, ctx, style == MatchupStyle::Compact);
        if let Some(outcome) = &scoreboard {
            hit_rects.push(HitRect::new(outcome.rect));
            top_surfaces.push(outcome.rect);
            if let Some(player_id) = outcome.toggled_vision {
                intents.push(Intent::ToggleVision { player_id });
            }
            if outcome.closed {
                prefs.toggle(Panel::Matchup);
            }
        }
        // The wings stack under whichever form the matchup takes: the scoreboard and the corner
        // cards are as tall as the game has players, so where the wings start is measured off what
        // they actually came out as rather than guessed at from a player count.
        let mut tops = if prefs.compact_scoreboard {
            observer::WingTops::beside_scoreboard(scoreboard.map(|outcome| outcome.rect))
        } else {
            observer::WingTops::under_bar(view.matchup.form().height())
        };
        if let Some(cards) = &view.team_cards {
            let outcome = observer::render_team_cards_view(cards, ctx, bar_shown);
            for rect in outcome.rects {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
            if let Some(bottom) = outcome.left_bottom {
                tops.left = tops.left.max(bottom + gap);
            }
            if let Some(bottom) = outcome.right_bottom {
                tops.right = tops.right.max(bottom + gap);
            }
            if let Some(player_id) = outcome.toggled_vision {
                intents.push(Intent::ToggleVision { player_id });
            }
        }
        let minimap_rects = self.frame_minimap(
            ctx,
            view,
            host.minimap_rect,
            prefs.minimap,
            hotkeys,
            intents,
        );
        hit_rects.extend(minimap_rects.into_iter().map(HitRect::new));

        let mut playback_placement = PlaybackControlsPlacement::default();

        // The bottom panels are drawn bottom first: each is as tall as the game it reports on, so
        // one stood on another is placed over whatever that one actually came out as, and drops
        // onto the one below when a panel between them is hidden or has no room. The selection
        // panel keeps the band's far end on every screen. The column of production stood on
        // control groups stands beside it at the band's other end where the band has room for the
        // two side by side, and on the minimap's frame at the left edge where it does not, so
        // nothing is ever stacked on the selection panel. Without that room control groups fold
        // into their grid, which stands on the bottom edge between the minimap and the selection
        // panel where it has room there, and under production on the minimap's frame where not.
        let slot = |run: Span, anchor: observer::StackAnchor, bottom: f32| observer::StackSlot {
            bottom,
            span: run,
            anchor,
            ceiling: layout::lowest_bottom_over(run, &top_surfaces, screen.top()),
            screen_bottom: screen.bottom(),
        };
        let base = observer::WING_MARGIN;
        let column = match layout::BottomRow::along(band) {
            Some(row) => {
                let stand = slot(row.column, observer::StackAnchor::Left, base);
                ColumnSlots {
                    groups: stand,
                    groups_form: observer::ControlGroupsForm::Row,
                    production: stand,
                    production_on_groups: true,
                }
            }
            None => {
                let over_minimap = slot(
                    layout::column_over_minimap(screen, band),
                    observer::StackAnchor::Left,
                    screen.bottom() - minimap_top + gap,
                );
                let beside = layout::groups_beside_minimap(band)
                    .map(|run| slot(run, observer::StackAnchor::Left, base));
                ColumnSlots {
                    groups: beside.unwrap_or(over_minimap),
                    groups_form: observer::ControlGroupsForm::Grid,
                    production: over_minimap,
                    production_on_groups: beside.is_none(),
                }
            }
        };
        let selection_slot = slot(
            layout::selection_run(band),
            observer::StackAnchor::Right,
            base,
        );
        let mut bottom_surfaces = Vec::new();
        // The dock is part of the plate's panel where the plate is up, of the selection panel's
        // where that is, and floats on its own with neither.
        let selection_wanted = prefs.selection && !view.selection.units.is_empty();
        if selection_wanted && !observer::selection::fits(selection_slot) {
            displaced.push(Panel::Selection);
        }
        let spot = Spot::new(
            ctx,
            spot_id("selection"),
            selection_wanted,
            slot_place(selection_slot),
        );
        let selection_at = slot_at(selection_slot, spot.at());
        let selection_up = selection_wanted && observer::selection::fits(selection_at);
        let dock_stand = if playback_controls_shown {
            observer::DockStand::Plate
        } else if selection_up {
            observer::DockStand::Selection
        } else {
            observer::DockStand::Nothing
        };
        let selection = observer::render_selection_view(
            &view.selection,
            ctx,
            prefs.selection,
            selection_at,
            prefs.dock && dock_stand == observer::DockStand::Selection,
        );
        spot.drawn(selection.is_some());
        let selection_drawn = selection.is_some();
        if let Some(outcome) = &selection {
            hit_rects.push(HitRect::new(outcome.rect));
            bottom_surfaces.push(outcome.rect);
            match outcome.clicked {
                Some(SelectedUnitClick::Pick(index)) => {
                    intents.push(Intent::PickSelectedUnit(index));
                }
                Some(SelectedUnitClick::Deselect(index)) => {
                    intents.push(Intent::DeselectSelectedUnit(index));
                }
                Some(SelectedUnitClick::PickKind(index)) => {
                    intents.push(Intent::PickSelectedKind(index));
                }
                Some(SelectedUnitClick::Follow(index)) => {
                    intents.push(Intent::FollowSelectedUnit(index));
                }
                None => {}
            }
        }
        // The row shown is the selected unit's owner, and stays theirs after the selection is
        // cleared: a watcher who clicks the ground has not asked to see somebody else's keys.
        if let Some(owner) = view.selection.units.first().and_then(|unit| unit.owner) {
            self.focused_player = Some(owner);
        }
        self.has_selection = !view.selection.units.is_empty();
        self.number_keys = view
            .control_groups
            .shown(self.focused_player)
            .map(|player| {
                let keys = player
                    .groups
                    .iter()
                    .fold(0u16, |keys, group| keys | 1 << group.key);
                (player.player_id, keys)
            });
        // The dock stands at the end of the bottom row, measured off the selection panel's place
        // whether or not anything is selected, so the floating strip keeps the column's corner.
        playback_placement.dock_on_top = prefs.dock;
        let selection_place = {
            let placed = selection_at.place(observer::selection::PANEL_WIDTH);
            let bottom = selection_at.screen_bottom - selection_at.bottom;
            Rect::from_min_max(
                egui::pos2(placed.left, bottom - observer::selection::PANEL_HEIGHT),
                egui::pos2(placed.right, bottom),
            )
        };
        let dock = observer::DockPlacement {
            plate: playback_placement.rect(screen),
            stand: dock_stand,
            selection: selection_place,
            selection_drawn,
            has_plate: has_playback_controls,
        };

        // The wings hang from under the top surfaces and end above whatever stands under them in
        // their own column: the selection panel and the column, the minimap's frame, the plate and
        // the dock.
        bottom_surfaces.push(minimap);
        if playback_controls_shown {
            bottom_surfaces.push(playback_placement.rect(screen));
        }
        if prefs.dock {
            bottom_surfaces.push(dock.footprint());
        }
        let left_span = layout::left_wing_span(screen, observer::economy::PANEL_WIDTH);
        let right_span = layout::right_wing_span(screen, observer::military::PANEL_WIDTH);
        // A screen too narrow for both wings side by side keeps the left one, which reports the
        // economy, over the right one, which reports what it bought.
        let right_room = right_span.left >= left_span.right + gap;

        // The panels the watcher wants that would stand in each other's way take the room in the
        // order they were turned on, the last first. A panel the room is gone for stays on, with no
        // room, and is drawn again once the one in its way goes.
        self.claims.note(prefs);
        let kept = {
            let room = YieldingRoom {
                view,
                column,
                tops,
                under_wings: &bottom_surfaces,
                left_span,
                right_span,
                right_room,
                screen_bottom: screen.bottom(),
            };
            let wanted = |panel: Panel| {
                prefs.shown(panel)
                    && match panel {
                        Panel::ControlGroups => !view.control_groups.is_empty(),
                        Panel::Production => !view.production.is_empty(),
                        Panel::Economy => !view.economy.is_empty(),
                        Panel::Military => !view.military.is_empty(),
                        Panel::Graphs => !view.graphs.is_empty(),
                        _ => true,
                    }
            };
            let mut kept = PanelSet::default();
            for panel in self.claims.order {
                if !wanted(panel) {
                    continue;
                }
                let mut trial = kept;
                trial.insert(panel);
                if room.all_fit(trial) {
                    kept = trial;
                } else {
                    displaced.push(panel);
                }
            }
            kept
        };
        let shown = |panel: Panel| prefs.shown(panel) && kept.contains(panel);
        let (control_groups_shown, production_shown) =
            (shown(Panel::ControlGroups), shown(Panel::Production));
        let (economy_shown, military_shown) = (shown(Panel::Economy), shown(Panel::Military));
        let (timeline_shown, graphs_shown) = (shown(Panel::Timeline), shown(Panel::Graphs));

        let spot = Spot::new(
            ctx,
            spot_id("control_groups"),
            control_groups_shown,
            slot_place(column.groups),
        );
        let control_groups = observer::render_control_groups_view(
            &view.control_groups,
            ctx,
            control_groups_shown,
            slot_at(column.groups, spot.at()),
            column.groups_form,
            self.focused_player,
        );
        spot.drawn(control_groups.is_some());
        if let Some(outcome) = &control_groups {
            hit_rects.push(HitRect::new(outcome.rect));
            bottom_surfaces.push(outcome.rect);
            if let Some(digit) = outcome.clicked {
                self.recall_control_group(digit, intents);
            }
        }
        let control_groups = control_groups.map(|outcome| outcome.rect);
        let production_slot = column.production(control_groups);
        let spot = Spot::new(
            ctx,
            spot_id("production"),
            production_shown,
            slot_place(production_slot),
        );
        let production = observer::render_production_view(
            &view.production,
            ctx,
            production_shown,
            slot_at(production_slot, spot.at()),
        );
        spot.drawn(production.is_some());
        if let Some(outcome) = &production {
            hit_rects.push(HitRect::new(outcome.rect));
            bottom_surfaces.push(outcome.rect);
            if let Some((player_id, item)) = outcome.clicked {
                intents.push(Intent::SelectProduction {
                    player_id,
                    item: item as u32,
                });
            }
        }

        let left_floor =
            layout::highest_top_under(left_span, &bottom_surfaces, screen.bottom()) - gap;
        let right_floor =
            layout::highest_top_under(right_span, &bottom_surfaces, screen.bottom()) - gap;

        let spot = Spot::new(ctx, spot_id("economy"), economy_shown, [tops.left]);
        let [economy_top] = spot.at();
        let economy = observer::render_economy_view(&view.economy, ctx, economy_shown, economy_top);
        spot.drawn(economy.is_some());
        if let Some(outcome) = &economy {
            hit_rects.push(HitRect::new(outcome.rect));
            if outcome.closed {
                prefs.toggle(Panel::Economy);
            }
        }
        let economy = economy.map(|outcome| outcome.rect);
        let spot = Spot::new(ctx, spot_id("military"), military_shown, [tops.right]);
        let [military_top] = spot.at();
        let military =
            observer::render_military_view(&view.military, ctx, military_shown, military_top);
        spot.drawn(military.is_some());
        if let Some(outcome) = &military {
            hit_rects.push(HitRect::new(outcome.rect));
            if outcome.closed {
                prefs.toggle(Panel::Military);
            }
        }
        let military = military.map(|outcome| outcome.rect);
        // The panels that report on the game so far are ways back into it, where it can be moved
        // through at all: a replay, with playback to move.
        let seekable = replay.seekable(host.mode);
        let graphs_top = tops.right + observer::stack_share(military);
        let spot = Spot::new(ctx, spot_id("graphs"), graphs_shown, [graphs_top]);
        let [eased_graphs_top] = spot.at();
        let graphs = observer::render_graphs_view(
            &view.graphs,
            ctx,
            graphs_shown,
            eased_graphs_top,
            right_floor,
            seekable.is_some(),
        );
        spot.drawn(graphs.is_some());
        if let Some(outcome) = graphs {
            hit_rects.push(HitRect::new(outcome.rect));
            if outcome.closed {
                prefs.toggle(Panel::Graphs);
            }
            if let Some(series) = outcome.series {
                prefs.graph_series = series;
            }
            if let Some(per_player) = outcome.per_player {
                prefs.graph_per_player = per_player;
            }
            if let (Some(playback), Some(secs)) = (seekable, outcome.seek_secs) {
                replay.queue_seek(playback.frame_at_secs(u64::from(secs)), None);
            }
        }
        let timeline_top = tops.left + observer::stack_share(economy);
        let spot = Spot::new(ctx, spot_id("timeline"), timeline_shown, [timeline_top]);
        let [eased_timeline_top] = spot.at();
        let timeline = observer::render_timeline_view(
            &view.timeline,
            ctx,
            timeline_shown,
            eased_timeline_top,
            left_floor,
            seekable.is_some(),
        );
        spot.drawn(timeline.is_some());
        if let Some(outcome) = timeline {
            hit_rects.push(HitRect::scrolling(outcome.rect));
            if outcome.closed {
                prefs.toggle(Panel::Timeline);
            }
            if let (Some(playback), Some(event)) = (seekable, outcome.clicked) {
                replay.queue_seek(playback.event_seek_target(event.secs), event.position);
            }
        }

        self.dock_plan = Some(DockPlan {
            placement: dock,
            displaced,
        });
        playback_placement
    }

    /// Draws the dock where the last [`frame`](Self::frame) placed it, against the plate as it was
    /// drawn at `plate`, and turns what the watcher did with it into preferences. Drawn after the
    /// plate, so it stands on where the plate is this frame rather than where it is easing to.
    pub(super) fn frame_dock(
        &mut self,
        ctx: &Context,
        mode: Mode,
        hotkeys: &Hotkeys,
        prefs: &mut PanelPrefs,
        plate: Option<Rect>,
        hit_rects: &mut Vec<HitRect>,
    ) {
        let Some(DockPlan {
            mut placement,
            displaced,
        }) = self.dock_plan.take()
        else {
            return;
        };
        if let Some(plate) = plate {
            placement.plate = plate;
        }
        let Some(outcome) = observer::render_obs_dock(
            prefs,
            &observer::DockContext {
                hotkeys,
                mode,
                map_control_available: self.map_control_available,
                placement,
                displaced: &displaced,
            },
            ctx,
        ) else {
            return;
        };
        hit_rects.extend(outcome.rects.iter().copied().map(HitRect::new));
        if let Some(panel) = outcome.toggled {
            prefs.toggle(panel);
        }
        if outcome.all_toggled {
            prefs.toggle_all();
        }
        if let Some(style) = outcome.matchup_style {
            prefs.set_matchup_style(style);
        }
        if let Some(expanded) = outcome.expanded {
            prefs.dock_expanded = expanded;
        }
    }

    /// Draws the frame around the game's minimap, where the host can say where the minimap is, and
    /// turns what the watcher did with its header into intents. Returns the rects the frame takes the
    /// pointer in.
    ///
    /// `square` is where the host says the minimap is, `wanted` whether the watcher has the
    /// minimap's panel on, and `hotkeys` what the header's cards name.
    fn frame_minimap(
        &mut self,
        ctx: &Context,
        view: &ObserverView,
        square: Option<Rect>,
        wanted: bool,
        hotkeys: &Hotkeys,
        intents: &mut Vec<Intent>,
    ) -> Vec<Rect> {
        let shown = wanted && square.is_some();
        if !shown {
            self.vision_picker_open = false;
        }
        let Some(square) = square else {
            return Vec::new();
        };
        let vision_keys = hotkeys
            .chord_for(Action::ToggleVisionPicker)
            .map(|chord| chord.keycaps(false))
            .unwrap_or_default();
        let menu_keys = hotkeys::MENU_CHORDS[0].keycaps(false);
        let Some(outcome) = observer::render_minimap_frame(
            ctx,
            square,
            shown,
            &view.matchup.players,
            self.vision_picker_open,
            observer::MinimapKeys {
                vision: &vision_keys,
                menu: &menu_keys,
            },
        ) else {
            return Vec::new();
        };
        self.vision_picker_open = shown && outcome.picker_open;
        if let Some(player_id) = outcome.toggled_vision {
            intents.push(Intent::ToggleVision { player_id });
        }
        if outcome.open_menu {
            self.vision_picker_open = false;
            intents.push(Intent::OpenGameMenu);
        }
        outcome.rects
    }

    /// Selects the group on `digit` of the player whose keys the control groups row shows, the way
    /// that player pressing it would. A digit with nothing on it does nothing, as it would for that
    /// player: left to the game, it would recall another player's group on that digit. With nobody's
    /// keys to read the digit stays the game's.
    pub(super) fn recall_control_group(&self, digit: u8, intents: &mut Vec<Intent>) -> bool {
        let Some((player_id, keys)) = self.number_keys else {
            return false;
        };
        if keys & 1 << digit != 0 {
            intents.push(Intent::SelectControlGroup {
                player_id,
                key: digit,
            });
        }
        true
    }
}

/// The spot `name` keeps a surface's place under (see [`Spot`]).
fn spot_id(name: &'static str) -> egui::Id {
    egui::Id::new(("sb_observer_spot", name))
}

/// The numbers a bottom panel's place is eased by: how far up it stands, and the ends of its run.
fn slot_place(slot: observer::StackSlot) -> [f32; 3] {
    [slot.bottom, slot.span.left, slot.span.right]
}

/// `slot` at the place `at` its spot has eased it to.
fn slot_at(slot: observer::StackSlot, [bottom, left, right]: [f32; 3]) -> observer::StackSlot {
    observer::StackSlot {
        bottom,
        span: observer::Span { left, right },
        ..slot
    }
}

/// The digit a number key stands for.
pub(super) fn number_key_digit(key: Key) -> Option<u8> {
    [
        Key::Num0,
        Key::Num1,
        Key::Num2,
        Key::Num3,
        Key::Num4,
        Key::Num5,
        Key::Num6,
        Key::Num7,
        Key::Num8,
        Key::Num9,
    ]
    .iter()
    .position(|&digit| digit == key)
    .map(|digit| digit as u8)
}

#[cfg(test)]
mod tests {
    use egui::{Key, Modifiers, Rect};

    use crate::shell::test_support::*;
    use crate::shell::{Intent, PanelPrefs};

    const SMALL_SCREEN: egui::Vec2 = egui::vec2(1280.0, 720.0);

    /// The dock's strip among a frame's hit rects: as tall as a strip is and as wide as the plate.
    fn dock_rect(output: &crate::shell::FrameOutput) -> Option<Rect> {
        output.hit_rects.iter().map(|hit| hit.rect).find(|rect| {
            rect.height() == crate::observer::dock::STRIP_HEIGHT
                && rect.width() == crate::observer::dock::TABLE_WIDTH
        })
    }

    /// The dock's column among a frame's hit rects.
    fn dock_column(output: &crate::shell::FrameOutput) -> Option<Rect> {
        output
            .hit_rects
            .iter()
            .map(|hit| hit.rect)
            .find(|rect| rect.width() == crate::observer::dock::COLUMN_WIDTH)
    }

    #[test]
    fn the_dock_is_part_of_the_plate_or_the_selection_panel_and_the_wings_keep_clear_of_it() {
        use crate::observer::{WING_GAP, WING_MARGIN, selection};

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let mut prefs = *shell.panel_prefs();
        prefs.military = true;
        prefs.graphs = true;
        shell.set_panel_prefs(prefs);
        let (playback, game) = (replay(), with_a_selection(game_with_right_wings()));
        let screen = egui::vec2(1920.0, 1080.0);
        let mut time = 0.0;
        let mut settled = |shell: &mut crate::shell::Shell| {
            let mut output = None;
            for _ in 0..8 {
                time += 0.5;
                output = Some(run_watched_frame_at(
                    shell, &ctx, &playback, &game, screen, time,
                ));
            }
            output.unwrap()
        };
        // The surfaces down the right edge: the scoreboard and the wings under it, one width.
        let wings = |output: &crate::shell::FrameOutput| -> Vec<Rect> {
            output
                .hit_rects
                .iter()
                .map(|hit| hit.rect)
                .filter(|rect| rect.width() == crate::observer::military::PANEL_WIDTH)
                .collect()
        };
        let selection = |output: &crate::shell::FrameOutput| {
            output
                .hit_rects
                .iter()
                .map(|hit| hit.rect)
                .find(|rect| rect.width() == selection::PANEL_WIDTH)
                .expect("the selection panel is up")
        };
        let close = |a: f32, b: f32| (a - b).abs() < 0.5;
        let keeps_clear = |output: &crate::shell::FrameOutput, dock: Rect| {
            let wings = wings(output);
            assert_eq!(wings.len(), 3);
            for wing in wings {
                assert!(close(wing.right(), screen.x - WING_MARGIN), "{wing:?}");
                assert!(
                    wing.bottom() <= dock.top() - WING_GAP + 0.5,
                    "{wing:?} {dock:?}"
                );
            }
        };

        // With the plate up the dock is the top of its panel, the strip standing on its edge.
        let with_plate = settled(&mut shell);
        let plate = crate::playback_controls::PlaybackControlsPlacement::default()
            .rect(Rect::from_min_size(egui::Pos2::ZERO, screen));
        let dock = dock_rect(&with_plate).expect("the dock is up");
        assert!(close(dock.right(), plate.right()), "{dock:?}");
        assert!(close(dock.width(), plate.width()), "{dock:?}");
        assert!(close(dock.bottom(), plate.top()), "{dock:?}");
        assert!(
            close(plate.bottom() - dock.top(), selection::PANEL_HEIGHT),
            "{dock:?} {plate:?}"
        );
        assert!(dock_column(&with_plate).is_none());
        keeps_clear(&with_plate, dock);

        // Without it the dock is a column against the selection panel's side, as tall as it.
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        let without_plate = settled(&mut shell);
        let column = dock_column(&without_plate).expect("the dock is up");
        let beside = selection(&without_plate);
        assert!(
            close(column.left(), beside.right()),
            "{column:?} {beside:?}"
        );
        assert!(close(column.top(), beside.top()), "{column:?} {beside:?}");
        assert!(
            close(column.bottom(), beside.bottom()),
            "{column:?} {beside:?}"
        );
        assert!(dock_rect(&without_plate).is_none());
        keeps_clear(&without_plate, column);
    }

    #[test]
    fn with_neither_the_plate_nor_a_selection_up_the_dock_floats_as_a_strip() {
        use crate::observer::{WING_MARGIN, dock};

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), empty_game());
        let screen = egui::vec2(1920.0, 1080.0);
        let mut time = 0.0;
        let mut settled = |shell: &mut crate::shell::Shell| {
            let mut output = None;
            for _ in 0..8 {
                time += 0.5;
                output = Some(run_watched_frame_at(
                    shell, &ctx, &playback, &game, screen, time,
                ));
            }
            output.unwrap()
        };
        settled(&mut shell);
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        let output = settled(&mut shell);
        let strip = output
            .hit_rects
            .iter()
            .map(|hit| hit.rect)
            .find(|rect| {
                rect.size()
                    == egui::vec2(
                        dock::floating_strip_width(true),
                        dock::FLOATING_STRIP_HEIGHT,
                    )
            })
            .expect("the dock floats as a strip");
        assert!(
            (strip.bottom() - (screen.y - WING_MARGIN)).abs() < 0.5,
            "{strip:?}"
        );
        assert!(dock_column(&output).is_none());
        assert!(dock_rect(&output).is_none());
    }

    #[test]
    fn the_selection_key_puts_the_panel_away_and_the_dock_floats_where_its_column_stood() {
        use crate::observer::{dock, selection};

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), with_a_selection(empty_game()));
        let screen = egui::vec2(1920.0, 1080.0);
        let mut time = 0.0;
        let mut settled = |shell: &mut crate::shell::Shell| {
            let mut output = None;
            for _ in 0..8 {
                time += 0.5;
                output = Some(run_watched_frame_at(
                    shell, &ctx, &playback, &game, screen, time,
                ));
            }
            output.unwrap()
        };
        settled(&mut shell);
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        let column =
            dock_column(&settled(&mut shell)).expect("the dock stands beside the selection");

        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        let output = settled(&mut shell);
        let rects = || output.hit_rects.iter().map(|hit| hit.rect);
        assert!(rects().all(|rect| rect.width() != selection::PANEL_WIDTH));
        assert!(dock_column(&output).is_none());
        let strip = rects()
            .find(|rect| {
                rect.size()
                    == egui::vec2(
                        dock::floating_strip_width(true),
                        dock::FLOATING_STRIP_HEIGHT,
                    )
            })
            .expect("the dock floats as a strip");
        assert!(
            (strip.right_bottom() - column.right_bottom()).length() < 0.5,
            "{strip:?} {column:?}"
        );
    }

    #[test]
    fn dock_and_hotkey_share_the_hidden_panels_as_the_dock_moves() {
        use crate::kit::tiers;
        use crate::observer::dock;

        for controls in [false, true] {
            let ctx = fresh_ctx();
            let mut shell = spectating_shell();
            let initial = PanelPrefs {
                playback_controls: controls,
                economy: true,
                graphs: true,
                ..PanelPrefs::default()
            };
            shell.set_panel_prefs(initial);
            let (playback, game) = (replay(), with_a_selection(empty_game()));
            let screen = egui::vec2(1920.0, 1080.0);
            let mut time = 0.0;
            let mut frame = |shell: &mut crate::shell::Shell,
                             events: Vec<egui::Event>,
                             step: f64| {
                time += step;
                run_watched_frame_with_events(shell, &ctx, &playback, &game, screen, events, time)
            };
            let original = settle(&mut frame, &mut shell, Vec::new());
            let all = if controls {
                let strip = dock_rect(&original).expect("the dock stands on the plate");
                egui::pos2(
                    strip.left() + tiers::PANEL_MARGIN_WIDTH * 0.5 + 10.0,
                    strip.center().y,
                )
            } else {
                let column = dock_column(&original).expect("the dock stands beside the selection");
                column.left_top()
                    + egui::vec2(
                        tiers::PANEL_MARGIN_WIDTH * 0.5 + 10.0,
                        tiers::PANEL_MARGIN_HEIGHT * 0.5 + 10.0,
                    )
            };
            let click = |frame: &mut dyn FnMut(
                &mut crate::shell::Shell,
                Vec<egui::Event>,
                f64,
            ) -> crate::shell::FrameOutput,
                         shell: &mut crate::shell::Shell,
                         pos| {
                settle(frame, shell, vec![egui::Event::PointerMoved(pos)]);
                for pressed in [true, false] {
                    frame(
                        shell,
                        vec![egui::Event::PointerButton {
                            pos,
                            button: egui::PointerButton::Primary,
                            pressed,
                            modifiers: Modifiers::NONE,
                        }],
                        if pressed { 0.5 } else { 0.05 },
                    );
                }
            };
            click(&mut frame, &mut shell, all);
            assert!(shell.panel_prefs().dock);
            assert!(!shell.panel_prefs().any_toggleable_shown());
            assert!(!shell.panel_prefs().playback_controls);
            let hidden = settle(&mut frame, &mut shell, Vec::new());
            assert!(dock_column(&hidden).is_none());
            let floating = hidden
                .hit_rects
                .iter()
                .map(|hit| hit.rect)
                .find(|rect| {
                    rect.size()
                        == egui::vec2(
                            dock::floating_strip_width(true),
                            dock::FLOATING_STRIP_HEIGHT,
                        )
                })
                .expect("the dock floats with the pointer still at its old button");

            assert!(shell.key_pressed(Key::A, Modifiers::NONE));
            assert_eq!(*shell.panel_prefs(), initial);
            settle(&mut frame, &mut shell, Vec::new());
            assert!(shell.key_pressed(Key::A, Modifiers::NONE));
            assert!(shell.panel_prefs().dock);
            assert!(!shell.panel_prefs().any_toggleable_shown());
            let hidden = settle(&mut frame, &mut shell, Vec::new());
            assert!(hidden.hit_rects.iter().any(|hit| hit.rect == floating));
            let floating_all = egui::pos2(
                floating.left() + tiers::PANEL_MARGIN_WIDTH * 0.5 + 10.0,
                floating.center().y,
            );
            click(&mut frame, &mut shell, floating_all);
            assert_eq!(*shell.panel_prefs(), initial);
        }
    }

    #[test]
    fn neither_the_table_nor_a_column_the_plate_comes_up_under_holds_its_place() {
        use crate::observer::dock;

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.set_panel_prefs(PanelPrefs {
            playback_controls: false,
            ..PanelPrefs::default()
        });
        let (playback, game) = (replay(), with_a_selection(empty_game()));
        let screen = egui::vec2(1920.0, 1080.0);
        let plate = crate::playback_controls::PlaybackControlsPlacement::default()
            .rect(Rect::from_min_size(egui::Pos2::ZERO, screen));
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, events: Vec<egui::Event>, step: f64| {
            time += step;
            run_watched_frame_with_events(shell, &ctx, &playback, &game, screen, events, time)
        };
        let column = dock_column(&settle(&mut frame, &mut shell, Vec::new()))
            .expect("the dock stands beside the selection");
        settle(
            &mut frame,
            &mut shell,
            vec![egui::Event::PointerMoved(column.center())],
        );
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        let on_plate = settle(&mut frame, &mut shell, Vec::new());
        assert!(dock_column(&on_plate).is_none());
        let strip = dock_rect(&on_plate).expect("the dock is part of the plate's panel");
        assert!(
            (strip.bottom() - plate.top()).abs() < 0.5,
            "{strip:?} {plate:?}"
        );

        // Opened beside the selection panel, the table goes with the dock when the panel does.
        assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
        settle(&mut frame, &mut shell, Vec::new());
        shell.set_panel_prefs(PanelPrefs {
            dock_expanded: true,
            ..*shell.panel_prefs()
        });
        let opened = settle(&mut frame, &mut shell, Vec::new());
        let table = opened
            .hit_rects
            .iter()
            .map(|hit| hit.rect)
            .find(|rect| rect.width() == dock::TABLE_WIDTH)
            .expect("the table opens over the selection panel");
        settle(
            &mut frame,
            &mut shell,
            vec![egui::Event::PointerMoved(table.center())],
        );
        assert!(shell.key_pressed(Key::W, Modifiers::NONE));
        let floated = settle(&mut frame, &mut shell, Vec::new());
        assert!(dock_column(&floated).is_none());
        assert!(floated.hit_rects.iter().all(|hit| hit.rect != table));
    }

    /// Runs `frame` until the panels have settled, half a second at a time, with `events` arriving
    /// before the first.
    fn settle(
        frame: &mut (
                 impl FnMut(&mut crate::shell::Shell, Vec<egui::Event>, f64) -> crate::shell::FrameOutput
                 + ?Sized
             ),
        shell: &mut crate::shell::Shell,
        events: Vec<egui::Event>,
    ) -> crate::shell::FrameOutput {
        let mut output = frame(shell, events, 0.5);
        for _ in 0..7 {
            output = frame(shell, Vec::new(), 0.5);
        }
        output
    }

    #[test]
    fn the_panel_turned_on_last_keeps_the_room_and_gives_it_back_once_it_goes() {
        use egui::{Id, LayerId, Order};

        let playback = replay();
        let game = game_with_right_wings();
        let drawn = |ctx: &egui::Context, id: Id| {
            ctx.memory(|memory| {
                memory
                    .areas()
                    .visible_last_frame(&LayerId::new(Order::Foreground, id))
            })
        };
        // Whether military and the graphs are on screen.
        let wings = |ctx: &egui::Context| {
            (
                drawn(ctx, crate::observer::wing_id(crate::shell::Panel::Military)),
                drawn(ctx, crate::observer::wing_id(crate::shell::Panel::Graphs)),
            )
        };
        let settle = |shell: &mut crate::shell::Shell,
                      ctx: &egui::Context,
                      screen: egui::Vec2,
                      time: &mut f64| {
            for _ in 0..4 {
                *time += 0.5;
                run_watched_frame_at(shell, ctx, &playback, &game, screen, *time);
            }
        };
        let with = |military, graphs| PanelPrefs {
            military,
            graphs,
            ..PanelPrefs::default()
        };
        let fresh = |screen, prefs| {
            let ctx = fresh_ctx();
            let mut shell = spectating_shell();
            shell.set_panel_prefs(prefs);
            settle(&mut shell, &ctx, screen, &mut 0.0);
            wings(&ctx)
        };
        // A screen with room on the right for military or for the graphs, and not for the two.
        let screen = (40..135)
            .map(|eighths| egui::vec2(1280.0, eighths as f32 * 8.0))
            .find(|&screen| {
                fresh(screen, with(true, false)) == (true, false)
                    && fresh(screen, with(false, true)) == (false, true)
                    && fresh(screen, with(true, true)) != (true, true)
            })
            .expect("some screen has room on the right for one wing and not two");

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.set_panel_prefs(with(true, false));
        let mut time = 0.0;
        settle(&mut shell, &ctx, screen, &mut time);
        assert_eq!(wings(&ctx), (true, false));

        // The graphs turned on take the room military had, which stays on with none.
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        settle(&mut shell, &ctx, screen, &mut time);
        assert_eq!(wings(&ctx), (false, true));
        assert!(shell.panel_prefs().military);

        // Put away again, they give it back.
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        settle(&mut shell, &ctx, screen, &mut time);
        assert_eq!(wings(&ctx), (true, false));

        // Military turned on after the graphs takes the room back from them.
        assert!(shell.key_pressed(Key::G, Modifiers::NONE));
        settle(&mut shell, &ctx, screen, &mut time);
        assert_eq!(wings(&ctx), (false, true));
        assert!(shell.key_pressed(Key::M, Modifiers::NONE));
        settle(&mut shell, &ctx, screen, &mut time);
        assert!(shell.key_pressed(Key::M, Modifiers::NONE));
        settle(&mut shell, &ctx, screen, &mut time);
        assert_eq!(wings(&ctx), (true, false));
        assert!(shell.panel_prefs().graphs);
    }

    #[test]
    fn the_keycap_on_a_wings_title_row_puts_it_away_as_its_key_does() {
        use crate::kit::tiers;
        use crate::shell::Panel;

        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        shell.set_panel_prefs(PanelPrefs {
            military: true,
            ..PanelPrefs::default()
        });
        let (playback, game) = (replay(), game_with_right_wings());
        let screen = egui::vec2(1920.0, 1080.0);
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, events: Vec<egui::Event>, step: f64| {
            time += step;
            run_watched_frame_with_events(shell, &ctx, &playback, &game, screen, events, time)
        };
        settle(&mut frame, &mut shell, Vec::new());
        let panel = ctx
            .memory(|memory| memory.area_rect(crate::observer::wing_id(Panel::Military)))
            .expect("military is drawn");
        // Inside the keycap at the right end of the title row.
        let key = egui::pos2(
            panel.right() - tiers::PANEL_MARGIN_WIDTH * 0.5 - 8.0,
            panel.top() + tiers::PANEL_MARGIN_HEIGHT * 0.5 + 10.0,
        );
        let button = |pressed| egui::Event::PointerButton {
            pos: key,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: Modifiers::NONE,
        };
        settle(&mut frame, &mut shell, vec![egui::Event::PointerMoved(key)]);
        frame(&mut shell, vec![button(true)], 0.5);
        frame(&mut shell, vec![button(false)], 0.05);
        assert!(!shell.panel_prefs().military);
    }

    #[test]
    fn the_column_keeps_its_place_whatever_the_minimap_is_drawn_at() {
        use crate::observer::{ControlGroupsForm, ControlGroupsPlayerView, WING_MARGIN, minimap};

        let mut game = empty_game();
        game.control_groups.players.push(ControlGroupsPlayerView {
            player_id: 0,
            color: crate::kit::theme::player_color(0),
            vision: true,
            groups: Vec::new(),
        });
        let playback = replay();
        // Wide enough for the row beside the selection panel, too narrow for it, and a 4:3 screen.
        for (screen, form) in [
            (egui::vec2(1920.0, 1080.0), ControlGroupsForm::Row),
            (egui::vec2(1600.0, 900.0), ControlGroupsForm::Grid),
            (egui::vec2(1600.0, 1200.0), ControlGroupsForm::Grid),
        ] {
            let ctx = fresh_ctx();
            let mut shell = spectating_shell();
            shell.set_panel_prefs(PanelPrefs {
                control_groups: true,
                ..PanelPrefs::default()
            });
            let full =
                crate::observer::minimap_reserve(Rect::from_min_size(egui::Pos2::ZERO, screen));
            // A hidden minimap is not reported, and a map smaller than the square, or not square,
            // is drawn in a control inside it.
            let narrower = Rect::from_min_max(
                egui::pos2(full.left() + 12.0, full.top()),
                egui::pos2(full.right() - 12.0, full.bottom()),
            );
            let smaller = Rect::from_center_size(full.center(), full.size() * 0.75);
            let mut time = 0.0;
            let mut placed = Vec::new();
            for minimap in [None, Some(full), None, Some(narrower), Some(smaller)] {
                let mut output = None;
                for _ in 0..8 {
                    time += 0.5;
                    output = Some(run_watched_frame_with_minimap(
                        &mut shell, &ctx, &playback, &game, screen, minimap, time,
                    ));
                }
                let groups = output
                    .unwrap()
                    .hit_rects
                    .iter()
                    .map(|hit| hit.rect)
                    .find(|rect| rect.size() == egui::vec2(form.width(), form.height()))
                    .expect("control groups are drawn");
                placed.push(groups);
            }
            assert!(
                placed.iter().all(|groups| *groups == placed[0]),
                "{screen:?}: {placed:?}"
            );
            // Either form stands on the bottom edge, the grid beside the minimap's frame.
            assert_eq!(placed[0].bottom(), screen.y - WING_MARGIN, "{screen:?}");
            let frame = minimap::footprint(Rect::from_min_size(egui::Pos2::ZERO, screen), full);
            assert!(placed[0].left() > frame.right(), "{screen:?}");
        }
    }

    #[test]
    fn the_selection_panel_stands_still_as_the_plate_comes_and_goes() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), with_a_selection(empty_game()));
        let screen = egui::vec2(1920.0, 1080.0);
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, step: f64| {
            time += step;
            run_watched_frame_at(shell, &ctx, &playback, &game, screen, time)
        };
        let selection = |output: &crate::shell::FrameOutput| {
            output
                .hit_rects
                .iter()
                .map(|hit| hit.rect)
                .find(|rect| rect.width() == crate::observer::selection::PANEL_WIDTH)
                .expect("the selection panel is up")
        };
        for _ in 0..6 {
            frame(&mut shell, 0.5);
        }
        let standing = selection(&frame(&mut shell, 0.5));
        // Out of the plate's corner, which stays the plate's or the viewer's.
        let corner = crate::playback_controls::PlaybackControlsPlacement::default()
            .rect(egui::Rect::from_min_size(egui::Pos2::ZERO, screen));
        assert!(standing.right() < corner.left(), "{standing:?}");

        for _ in 0..2 {
            assert!(shell.key_pressed(Key::Y, Modifiers::NONE));
            for _ in 0..20 {
                assert_eq!(selection(&frame(&mut shell, 0.03)), standing);
            }
        }
    }

    #[test]
    fn the_bottom_row_stands_still_as_the_minimap_comes_and_goes() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), with_a_selection(empty_game()));
        let screen = egui::vec2(1920.0, 1080.0);
        // BW's own minimap, a little smaller than the reserve kept for it while it is hidden.
        let minimap = Rect::from_min_size(egui::pos2(12.0, 776.0), egui::vec2(292.0, 292.0));
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, minimap: Option<Rect>| {
            time += 0.5;
            run_watched_frame_with_minimap(shell, &ctx, &playback, &game, screen, minimap, time)
        };
        let selection = |output: &crate::shell::FrameOutput| {
            output
                .hit_rects
                .iter()
                .map(|hit| hit.rect)
                .find(|rect| rect.width() == crate::observer::selection::PANEL_WIDTH)
                .expect("the selection panel is up")
        };
        let mut hidden = None;
        for _ in 0..6 {
            hidden = Some(selection(&frame(&mut shell, None)));
        }
        let mut shown = None;
        for _ in 0..6 {
            shown = Some(selection(&frame(&mut shell, Some(minimap))));
        }
        assert_eq!(shown, hidden);
    }

    #[test]
    fn the_dock_leaves_from_where_it_stood_when_the_plate_goes_with_it() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), empty_game());
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, step: f64| {
            time += step;
            run_watched_frame_at(shell, &ctx, &playback, &game, SMALL_SCREEN, time)
        };
        for _ in 0..6 {
            frame(&mut shell, 0.5);
        }
        let standing = dock_rect(&frame(&mut shell, 0.5)).expect("the dock is up");

        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.key_pressed(Key::R, Modifiers::NONE));
        assert!(!shell.panel_prefs().dock && !shell.panel_prefs().playback_controls);
        // The slide out is a transform on the dock's layer, so its rect keeps its place along the
        // edge as it goes; what matters is that it keeps its height too.
        let mut leaving_frames = 0;
        for _ in 0..8 {
            let Some(leaving) = dock_rect(&frame(&mut shell, 0.03)) else {
                break;
            };
            assert_eq!(leaving.center().y, standing.center().y);
            leaving_frames += 1;
        }
        assert!(
            leaving_frames >= 2,
            "the dock left in {leaving_frames} frames"
        );
    }

    #[test]
    fn the_dock_comes_back_onto_the_plate_when_the_plate_comes_back_with_it() {
        let ctx = fresh_ctx();
        let mut shell = spectating_shell();
        let (playback, game) = (replay(), empty_game());
        let mut time = 0.0;
        let mut frame = |shell: &mut crate::shell::Shell, step: f64| {
            time += step;
            run_watched_frame_at(shell, &ctx, &playback, &game, SMALL_SCREEN, time)
        };
        for _ in 0..6 {
            frame(&mut shell, 0.5);
        }
        let standing = dock_rect(&frame(&mut shell, 0.5)).expect("the dock is up");
        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.key_pressed(Key::R, Modifiers::NONE));
        for _ in 0..6 {
            frame(&mut shell, 0.5);
        }

        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
        assert!(shell.key_pressed(Key::R, Modifiers::NONE));
        assert!(shell.panel_prefs().dock && shell.panel_prefs().playback_controls);
        // Every frame of the way in, at the height it settles at: it slides in along the edge.
        for _ in 0..12 {
            let arriving = dock_rect(&frame(&mut shell, 0.03)).expect("the dock is coming back");
            assert_eq!(arriving.center().y, standing.center().y);
        }
    }

    #[test]
    fn the_map_control_key_waits_for_a_measurement_to_draw() {
        let mut shell = spectating_shell();
        assert!(!shell.key_pressed(Key::N, Modifiers::NONE));
        shell.observer.map_control_available = true;
        let was_shown = shell.panel_prefs().map_control;
        assert!(shell.key_pressed(Key::N, Modifiers::NONE));
        assert_ne!(shell.panel_prefs().map_control, was_shown);
    }

    #[test]
    fn escape_closes_the_vision_list_and_nothing_else() {
        let mut shell = spectating_shell();
        shell.set_vision_picker_open(true);
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert!(!shell.vision_picker_open());
        assert!(shell.panel_prefs().minimap);
        // With the list closed the key is the game's again.
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
    }

    #[test]
    fn escape_lets_go_of_a_watchers_selection_and_is_the_games_without_one() {
        let mut shell = spectating_shell();
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
        shell.observer.has_selection = true;
        assert!(shell.key_pressed(Key::Escape, Modifiers::NONE));
        assert!(shell.pending_intents().contains(&Intent::ClearSelection));
        // Let go of once: a second press before the next frame has nothing left to clear.
        assert!(!shell.key_pressed(Key::Escape, Modifiers::NONE));
    }

    #[test]
    fn number_keys_are_the_shown_players_even_where_they_have_no_group() {
        let mut shell = spectating_shell();
        // Nobody's keys are shown: the game recalls the watcher's own groups.
        assert!(!shell.key_pressed(Key::Num1, Modifiers::NONE));
        shell.observer.number_keys = Some((3, 1 << 1));
        assert!(shell.key_pressed(Key::Num1, Modifiers::NONE));
        assert!(
            shell
                .pending_intents()
                .contains(&Intent::SelectControlGroup {
                    player_id: 3,
                    key: 1,
                })
        );
        // Taken but empty, rather than left to recall somebody else's group on the same digit.
        assert!(shell.key_pressed(Key::Num6, Modifiers::NONE));
        assert!(
            !shell
                .pending_intents()
                .contains(&Intent::SelectControlGroup {
                    player_id: 3,
                    key: 6,
                })
        );
    }
}
