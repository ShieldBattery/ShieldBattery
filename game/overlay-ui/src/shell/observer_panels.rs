//! The observer panels' composition: where each panel goes this frame given the room the others
//! took, and the state that placement and the panels' controls carry between frames.

use egui::{Context, Key, Rect};

use super::hotkeys::{self, Action, Hotkeys};
use super::prefs::{Panel, PanelPrefs};
use super::replay::ReplayCommands;
use super::{HitRect, HostFrame, Intent};
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
    /// Where the map control strip hangs from, as last asked for while it was wanted on screen.
    map_control_top: Option<f32>,
    /// The run of the dock's column, top and bottom, the dock had to itself last frame with every
    /// surface on the right edge against the edge, or `None` where it was too short for the dock at
    /// its full height. While there is room, the surfaces on that side hug the edge and the dock
    /// stands between them; where there is not, they stand in from its column.
    ///
    /// Worked out from last frame's surfaces because this frame's are placed by it. How tall they
    /// are does not depend on how far in they stand, so it settles rather than flip-flopping.
    dock_room: Option<(f32, f32)>,
    /// Whether the watcher had anything selected as of the last frame, which is whether Escape
    /// has a selection to let go of.
    has_selection: bool,
    /// The player whose number keys a digit recalls, and which of their keys have a group on them
    /// (one bit per digit), as the control groups row last showed them.
    number_keys: Option<(u8, u16)>,
    /// Where each bottom panel was last placed while it was wanted on screen, which is where it
    /// fades out from: a panel leaving because the plate beside it left too would otherwise jump
    /// across the screen on its way out.
    held_slots: HeldSlots,
    /// Which of the stacked panels were drawn last frame, which is whether they ease toward a new
    /// place in their stack or simply take it.
    drawn: DrawnLastFrame,
    /// The minimap's square as the host last reported it, which the panels beside it keep clear of
    /// while it is hidden and the host has no square to report.
    last_minimap_rect: Option<Rect>,
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

    /// Records whether the replay plate was drawn this frame, which decides whether it eases
    /// toward a new place in the stack next frame or simply takes it.
    pub(super) fn plate_drawn(&mut self, drawn: bool) {
        self.drawn.plate = drawn;
    }

    /// Draws the observer panels the watcher has left on screen, turning what they did with them
    /// into intents for the host and into preferences of its own.
    ///
    /// The panels are placed against each other rather than at the design's coordinates (see
    /// [`observer::layout`]), so they are drawn in the order the screen's room is handed out: the
    /// surfaces hung from the top edge, the minimap's frame, then the stack along the bottom edge,
    /// which between them say how much of each side is left for the wings, and the dock last, which
    /// is told what found no room. `has_playback_controls` is whether there is a replay plate to share the
    /// bottom of the screen with. Returns where the plate stands, which is decided with them.
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

        if let Some(outcome) = observer::render_matchup_view(&view.matchup, ctx, prefs.matchup) {
            hit_rects.push(HitRect::new(outcome.rect));
            top_surfaces.push(outcome.rect);
            if let Some(player_id) = outcome.toggled_vision {
                intents.push(Intent::ToggleVision { player_id });
            }
        }
        // The corner cards and the wings under them are one stack: a card is as tall as the side it
        // carries, so where the wings start is measured off what the cards actually came out as
        // rather than guessed at from a player count.
        let mut tops = observer::WingTops::under_bar(view.matchup.form().height());
        let keep_clear = prefs.dock && self.dock_room.is_none();
        let right_inset = observer::dock_inset(ctx, keep_clear);
        // A wing arriving takes its place beside the dock at once, the way the left wings simply
        // appear where they stand; one already on screen follows the dock as it comes and goes.
        let settled_inset = observer::settled_dock_inset(keep_clear);
        // How far down the surfaces on the right edge reach, which is where the dock's column
        // starts while they hug the edge.
        let mut right_reach = screen.top();
        if let Some(cards) = &view.team_cards {
            let inset = self.drawn.team_cards.inset(right_inset, settled_inset);
            let outcome = observer::render_team_cards_view(cards, ctx, prefs.matchup, inset);
            self.drawn.team_cards.drawn(outcome.right_bottom.is_some());
            for rect in outcome.rects {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
            if let Some(bottom) = outcome.left_bottom {
                tops.left = tops.left.max(bottom + gap);
            }
            if let Some(bottom) = outcome.right_bottom {
                tops.right = tops.right.max(bottom + gap);
                right_reach = right_reach.max(screen.top() + bottom);
            }
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
            // once it is put away, moving off as the bar starts to go rather than once it has. A
            // strip put away along with the bar leaves from where it stands, as the panels put away
            // with it do, rather than sliding up across the bar on its way out.
            let wanted_top = if prefs.matchup {
                view.matchup.form().height() + observer::MAP_CONTROL_GAP
            } else {
                observer::WING_MARGIN
            };
            if prefs.map_control || self.map_control_top.is_none() {
                self.map_control_top = Some(wanted_top);
            }
            let top = ctx.animate_value_with_time(
                egui::Id::new("sb_map_control_top"),
                self.map_control_top.unwrap_or(wanted_top),
                if self.drawn.map_control {
                    crate::kit::theme::MOTION_PANEL_SECS
                } else {
                    0.0
                },
            );
            let drawn = observer::render_map_control_view(map_control, ctx, prefs.map_control, top);
            if let Some(rect) = drawn {
                hit_rects.push(HitRect::new(rect));
                top_surfaces.push(rect);
            }
            self.drawn.map_control = drawn.is_some();
        }

        // The minimap's square is the game's wherever it is, and the frame around it is kept clear
        // whether or not it is drawn: a watcher who hides the minimap has not asked for the panels
        // to move into its corner.
        if host.minimap_rect.is_some() {
            self.last_minimap_rect = host.minimap_rect;
        }
        let square = layout::minimap_square(screen, self.last_minimap_rect);
        let minimap = observer::minimap::footprint(screen, square);
        let minimap_rects = self.frame_minimap(
            ctx,
            view,
            host.minimap_rect,
            prefs.minimap,
            hotkeys,
            intents,
        );
        hit_rects.extend(minimap_rects.into_iter().map(HitRect::new));
        let minimap_on_left = minimap.center().x < screen.center().x;

        // The run of the bottom edge the bottom panels have: from the minimap's frame to whatever
        // holds the right edge, which is the playback controls where they stand in the corner and the
        // dock's column where it does not.
        let edge_right = screen.right() - observer::WING_MARGIN - right_inset;
        let mut span = if minimap_on_left {
            Span {
                left: minimap.right() + gap,
                right: edge_right,
            }
        } else {
            Span {
                left: screen.left() + observer::WING_MARGIN,
                right: edge_right.min(minimap.left() - gap),
            }
        };
        let playback_controls_shown = has_playback_controls && prefs.playback_controls;
        let mut playback_placement = PlaybackControlsPlacement::default();
        let dock_width = observer::dock::column_width(prefs.dock_expanded);
        let dock_column = Span {
            left: screen.right() - dock_width,
            right: screen.right(),
        };
        // The keycap strip is there all game and keeps clear of the surfaces over its column. The
        // rail is something the watcher has just opened to read, and like every other panel it
        // passes over it may pass over those too: only the plate, a control of its own, it keeps
        // clear of.
        let dock_top = if prefs.dock_expanded {
            screen.top() + observer::WING_MARGIN
        } else {
            layout::lowest_bottom_over(dock_column, &top_surfaces, screen.top()) + gap
        };
        // Where the surfaces on the right edge are against it, the dock keeps to the room between
        // them that it had last frame.
        let dock_room = self
            .dock_room
            .filter(|_| !prefs.dock_expanded)
            .map(|(top, bottom)| (top.max(dock_top), bottom));
        // How far the plate stands in to clear the dock's column, following the dock off the edge
        // and back the way the panels on that side do.
        let dock_clearance = right_inset / observer::dock::column_width(false) * dock_width;
        let dock_fit = |bottom: f32| {
            observer::DockPlacement::fit(
                host.mode,
                self.map_control_available,
                screen.center().y,
                dock_top,
                bottom,
            )
        };
        // What the plate stands on where it gives the corner up to the panels along the bottom edge.
        enum PlateStand {
            Corner,
            Stack,
        }
        // The panels are laid along the edge as one row where it is wide enough for one, beside a
        // minimap in the corner the row can start from.
        let row_along = |run: Span| {
            if minimap_on_left {
                layout::BottomRow::along(run)
            } else {
                None
            }
        };
        let mut dock = None;
        let mut plate = PlateStand::Corner;
        let row = if playback_controls_shown {
            // The plate keeps the corner while the panels still have their row beside it, or
            // failing that their stack's narrowest width, and the dock still fits above it. Where
            // the dock does not, the plate stands in from the dock's column and the dock runs down
            // past it. Where not even the stack fits beside it, it gives the stack the bottom edge
            // and is lifted over it, standing in from the dock's column too, so the dock keeps the
            // whole edge.
            let corner = playback_placement.rect(screen);
            if prefs.dock {
                dock = match dock_room {
                    Some((top, bottom)) => observer::DockPlacement::fit(
                        host.mode,
                        self.map_control_available,
                        screen.center().y,
                        top,
                        bottom,
                    ),
                    None => dock_fit(corner.top() - gap),
                };
                if dock.is_none() {
                    playback_placement.right_inset = dock_clearance;
                }
            }
            let beside = Span {
                right: span.right.min(playback_placement.rect(screen).left() - gap),
                ..span
            };
            if let Some(row) = row_along(beside) {
                Some(row)
            } else {
                if beside.width() >= observer::MIN_STACK_WIDTH {
                    span = beside;
                } else {
                    playback_placement.right_inset = dock_clearance;
                    plate = PlateStand::Stack;
                }
                None
            }
        } else {
            row_along(span)
        };
        // What the dock's column ends on at the bottom, kept for working out its room below.
        let plate_in_corner = playback_controls_shown
            && matches!(plate, PlateStand::Corner)
            && playback_placement.right_inset == 0.0;
        let selection_ends_row = row.is_some() && prefs.selection;
        let dock = dock.or_else(|| {
            dock_room.and_then(|(top, bottom)| {
                observer::DockPlacement::fit(
                    host.mode,
                    self.map_control_available,
                    screen.center().y,
                    top,
                    bottom,
                )
            })
        });
        let dock = match dock {
            Some(dock) => dock,
            None => dock_fit(screen.bottom() - observer::WING_MARGIN).unwrap_or(
                observer::DockPlacement::centred(
                    host.mode,
                    self.map_control_available,
                    screen.height(),
                ),
            ),
        };

        // The bottom panels are drawn bottom first: each is as tall as the game it reports on, so
        // one stood on another is placed over whatever that one actually came out as, and drops
        // onto the one below when a panel between them is hidden or has no room. Along a row the
        // selection panel stands alone at the far end, and the column by the minimap is production
        // stood on control groups. In the centered stack the selection panel stands lowest, where
        // the game's console reads a selection out, with control groups and then production on it.
        let slot = |run: Span, anchor: observer::StackAnchor, bottom: f32| observer::StackSlot {
            bottom,
            span: run,
            anchor,
            middle: screen.center().x,
            ceiling: layout::lowest_bottom_over(run, &top_surfaces, screen.top()),
            screen_bottom: screen.bottom(),
        };
        let (selection_run, selection_anchor, column_run, column_anchor) = match row {
            Some(row) => (
                row.selection,
                observer::StackAnchor::Right,
                row.column,
                observer::StackAnchor::Left,
            ),
            None => (
                span,
                observer::StackAnchor::Middle,
                span,
                observer::StackAnchor::Middle,
            ),
        };
        let base = observer::WING_MARGIN;
        let selection_slot = hold_slot(
            &mut self.held_slots.selection,
            prefs.selection && !view.selection.units.is_empty(),
            slot(selection_run, selection_anchor, base),
        );
        let column_slot = |bottom: f32| slot(column_run, column_anchor, bottom);
        let mut stack = Vec::new();
        if prefs.selection
            && !view.selection.units.is_empty()
            && !observer::selection::fits(selection_slot)
        {
            displaced.push(Panel::Selection);
        }
        let selection =
            observer::render_selection_view(&view.selection, ctx, prefs.selection, selection_slot);
        if let Some(outcome) = &selection {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            match outcome.clicked {
                Some(SelectedUnitClick::Pick(index)) => {
                    intents.push(Intent::PickSelectedUnit(index));
                }
                Some(SelectedUnitClick::Follow(index)) => {
                    intents.push(Intent::FollowSelectedUnit(index));
                }
                None => {}
            }
        }
        let selection = selection.map(|outcome| outcome.rect);
        let over_selection = base
            + observer::eased_stack_share(
                ctx,
                egui::Id::new("sb_stack_selection"),
                selection,
                self.drawn.control_groups,
            );
        let under_groups = if row.is_some() { base } else { over_selection };
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
        if prefs.control_groups
            && !view.control_groups.is_empty()
            && observer::control_groups::fitted_width(column_slot(under_groups)).is_none()
        {
            displaced.push(Panel::ControlGroups);
        }
        let control_groups_slot = hold_slot(
            &mut self.held_slots.control_groups,
            prefs.control_groups && !view.control_groups.is_empty(),
            column_slot(under_groups),
        );
        let control_groups = observer::render_control_groups_view(
            &view.control_groups,
            ctx,
            prefs.control_groups,
            control_groups_slot,
            self.focused_player,
        );
        if let Some(outcome) = &control_groups {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            if let Some(digit) = outcome.clicked {
                self.recall_control_group(digit, intents);
            }
        }
        let control_groups = control_groups.map(|outcome| outcome.rect);
        self.drawn.control_groups = control_groups.is_some();
        let over_groups = under_groups
            + observer::eased_stack_share(
                ctx,
                egui::Id::new("sb_stack_control_groups"),
                control_groups,
                self.drawn.production,
            );
        if prefs.production
            && !view.production.is_empty()
            && observer::production::ProductionFit::of(&view.production, column_slot(over_groups))
                .is_none()
        {
            displaced.push(Panel::Production);
        }
        let production_slot = hold_slot(
            &mut self.held_slots.production,
            prefs.production && !view.production.is_empty(),
            column_slot(over_groups),
        );
        let production = observer::render_production_view(
            &view.production,
            ctx,
            prefs.production,
            production_slot,
        );
        self.drawn.production = production.is_some();
        if let Some(outcome) = &production {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            if let Some((player_id, item)) = outcome.clicked {
                intents.push(Intent::SelectProduction {
                    player_id,
                    item: item as u32,
                });
            }
        }
        match plate {
            PlateStand::Corner => {}
            PlateStand::Stack => {
                let over_stack = over_groups
                    + observer::eased_stack_share(
                        ctx,
                        egui::Id::new("sb_stack_production"),
                        production.as_ref().map(|outcome| outcome.rect),
                        self.drawn.plate,
                    );
                playback_placement.lift = over_stack - observer::WING_MARGIN;
            }
        }

        // The wings hang from under the top surfaces and end above whatever stands under them in
        // their own column: the stack, the minimap's frame, and the plate.
        let mut bottom_surfaces = stack;
        bottom_surfaces.push(minimap);
        if playback_controls_shown {
            bottom_surfaces.push(playback_placement.rect(screen));
        }
        let left_span = layout::left_wing_span(screen, observer::economy::PANEL_WIDTH);
        let right_span =
            layout::right_wing_span(screen, observer::military::PANEL_WIDTH, right_inset);
        let left_floor =
            layout::highest_top_under(left_span, &bottom_surfaces, screen.bottom()) - gap;
        let right_floor =
            layout::highest_top_under(right_span, &bottom_surfaces, screen.bottom()) - gap;
        // A screen too narrow for both wings side by side keeps the left one, which reports the
        // economy, over the right one, which reports what it bought.
        let right_room = right_span.left >= left_span.right + gap;

        let economy_fits = tops.left + observer::economy::panel_height(&view.economy) <= left_floor;
        if prefs.economy && !view.economy.is_empty() && !economy_fits {
            displaced.push(Panel::Economy);
        }
        let economy = observer::render_economy_view(
            &view.economy,
            ctx,
            prefs.economy && economy_fits,
            tops.left,
        );
        if let Some(rect) = economy {
            hit_rects.push(HitRect::new(rect));
        }
        let military_fits = right_room
            && tops.right + observer::military::panel_height(&view.military) <= right_floor;
        if prefs.military && !view.military.is_empty() && !military_fits {
            displaced.push(Panel::Military);
        }
        let military_inset = self.drawn.military.inset(right_inset, settled_inset);
        let military = observer::render_military_view(
            &view.military,
            ctx,
            prefs.military && military_fits,
            tops.right,
            military_inset,
        );
        self.drawn.military.drawn(military.is_some());
        if let Some(rect) = military {
            hit_rects.push(HitRect::new(rect));
            right_reach = right_reach.max(rect.bottom());
        }
        let graphs_top = observer::WingTops::below(
            ctx,
            egui::Id::new("sb_stack_military"),
            tops.right,
            military,
            self.drawn.graphs.on_screen,
        );
        let graphs_fit = right_room && observer::graphs::fits(graphs_top, right_floor);
        if prefs.graphs && !view.graphs.is_empty() && !graphs_fit {
            displaced.push(Panel::Graphs);
        }
        // The panels that report on the game so far are ways back into it, where it can be moved
        // through at all: a replay, with playback to move.
        let seekable = replay.seekable(host.mode);
        let graphs = observer::render_graphs_view(
            &view.graphs,
            ctx,
            prefs.graphs && right_room,
            graphs_top,
            right_floor,
            self.drawn.graphs.inset(right_inset, settled_inset),
            seekable.is_some(),
        );
        self.drawn.graphs.drawn(graphs.is_some());
        if let Some(outcome) = graphs {
            hit_rects.push(HitRect::new(outcome.rect));
            right_reach = right_reach.max(outcome.rect.bottom());
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
        let timeline_top = observer::WingTops::below(
            ctx,
            egui::Id::new("sb_stack_economy"),
            tops.left,
            economy,
            self.drawn.timeline,
        );
        if prefs.timeline && !observer::timeline::fits(timeline_top, left_floor) {
            displaced.push(Panel::Timeline);
        }
        let timeline = observer::render_timeline_view(
            &view.timeline,
            ctx,
            prefs.timeline,
            timeline_top,
            left_floor,
            seekable.is_some(),
        );
        self.drawn.timeline = timeline.is_some();
        if let Some(outcome) = timeline {
            hit_rects.push(HitRect::scrolling(outcome.rect));
            if let (Some(playback), Some(event)) = (seekable, outcome.clicked) {
                replay.queue_seek(playback.event_seek_target(event.secs), event.position);
            }
        }

        // The room the dock's column would leave it with the right edge's surfaces against the
        // edge: from under the lowest of them, and anything else over the column, down to the
        // plate where it keeps the corner, or to the selection panel standing at the end of the
        // row along the bottom, or to the bottom edge.
        let column_top = right_reach.max(layout::lowest_bottom_over(
            dock_column,
            &top_surfaces,
            screen.top(),
        )) + gap;
        let column_bottom = if plate_in_corner {
            Some(playback_placement.rect(screen).top() - gap)
        } else if playback_controls_shown {
            None
        } else if selection_ends_row {
            Some(screen.bottom() - observer::WING_MARGIN - observer::selection::PANEL_HEIGHT - gap)
        } else {
            Some(screen.bottom() - observer::WING_MARGIN)
        };
        self.dock_room = column_bottom
            .filter(|&bottom| {
                bottom - column_top
                    >= observer::dock::full_height(host.mode, self.map_control_available)
            })
            .map(|bottom| (column_top, bottom));

        let dock = observer::render_obs_dock(
            prefs,
            &observer::DockContext {
                hotkeys,
                mode: host.mode,
                map_control_available: self.map_control_available,
                placement: dock,
                displaced: &displaced,
            },
            ctx,
        );
        if let Some(outcome) = dock {
            hit_rects.push(HitRect::new(outcome.rect));
            if let Some(panel) = outcome.toggled {
                prefs.toggle(panel);
            }
            if let Some(spoiler_free) = outcome.spoiler_free {
                prefs.spoiler_free = spoiler_free;
            }
            if let Some(expanded) = outcome.expanded {
                prefs.dock_expanded = expanded;
            }
        }
        playback_placement
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

/// Which of the panels whose place eases as their neighbors come and go were drawn last frame.
#[derive(Default)]
struct DrawnLastFrame {
    /// The team cards' right-hand card.
    team_cards: RightWing,
    military: RightWing,
    control_groups: bool,
    map_control: bool,
    production: bool,
    plate: bool,
    graphs: RightWing,
    timeline: bool,
}

/// A wing on the right edge, which stands in from it by however much room the dock takes.
#[derive(Default)]
struct RightWing {
    /// Whether the wing was drawn last frame.
    on_screen: bool,
    /// Whether the wing follows the dock's eased inset rather than standing where the dock settles.
    ///
    /// A wing arrives where the dock settles and keeps to it until the dock's easing gets there:
    /// shown together with the dock, a wing that followed the easing from its second frame would
    /// jump to the screen's edge and slide back in beside the dock.
    follows_dock: bool,
}

impl RightWing {
    /// How far in from the right edge the wing stands this frame, given the dock's `eased` inset
    /// and the `settled` one it eases toward.
    fn inset(&mut self, eased: f32, settled: f32) -> f32 {
        if !self.on_screen {
            self.follows_dock = false;
        } else if (eased - settled).abs() < 0.5 {
            self.follows_dock = true;
        }
        if self.follows_dock { eased } else { settled }
    }

    fn drawn(&mut self, on_screen: bool) {
        self.on_screen = on_screen;
    }
}

/// The slots the bottom panels were last placed in while they were wanted on screen.
#[derive(Default)]
struct HeldSlots {
    selection: Option<observer::StackSlot>,
    control_groups: Option<observer::StackSlot>,
    production: Option<observer::StackSlot>,
}

/// The slot a bottom panel is drawn in: `slot` while it is `wanted` on screen, kept as `held`, and
/// `held` while it is not, so a panel fading out does so where it was.
fn hold_slot(
    held: &mut Option<observer::StackSlot>,
    wanted: bool,
    slot: observer::StackSlot,
) -> observer::StackSlot {
    if wanted {
        *held = Some(slot);
        slot
    } else {
        held.unwrap_or(slot)
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
    use egui::{Key, Modifiers};

    use crate::shell::Intent;
    use crate::shell::test_support::*;

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
