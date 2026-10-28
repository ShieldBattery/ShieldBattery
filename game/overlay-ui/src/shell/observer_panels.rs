//! The observer panels' composition: where each panel goes this frame given the room the others
//! took, and the state that placement and the panels' controls carry between frames.

use egui::{Context, Key, Rect};

use super::hotkeys::{self, Action, Hotkeys};
use super::prefs::{MatchupStyle, Panel, PanelPrefs};
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
    /// share the bottom of the screen with. Returns where the plate stands, which is decided with
    /// them; the dock is drawn by [`frame_dock`](Self::frame_dock) once the plate has been.
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
        // The run of the bottom edge the bottom panels have: from the minimap's frame to the right
        // edge.
        let bottom_run = || {
            let edge_right = screen.right() - observer::WING_MARGIN;
            if minimap_on_left {
                Span {
                    left: minimap.right() + gap,
                    right: edge_right,
                }
            } else {
                Span {
                    left: screen.left() + observer::WING_MARGIN,
                    right: edge_right.min(minimap.left() - gap),
                }
            }
        };
        // The part of the bottom edge the bottom panels keep to beside a minimap in the corner. A
        // minimap on the right edge leaves them the run from the left edge to it.
        let plate_corner =
            has_playback_controls.then(|| PlaybackControlsPlacement::default().rect(screen));
        let bottom_band = || {
            let run = bottom_run();
            if minimap_on_left {
                layout::bottom_band(screen, run, plate_corner)
            } else {
                run
            }
        };
        // The panels are laid along the band as one row where it is wide enough for one, beside a
        // minimap in the corner the row can start from.
        let row_along = |run: Span| {
            if minimap_on_left {
                layout::BottomRow::along(run)
            } else {
                None
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

        let mut span = bottom_band();
        let mut playback_placement = PlaybackControlsPlacement::default();
        // What the plate stands on where it gives the corner up to the panels along the bottom edge.
        enum PlateStand {
            Corner,
            Stack,
        }
        let mut plate = PlateStand::Corner;
        let row = if playback_controls_shown {
            // The plate keeps the corner while the panels still have their row beside it, or
            // failing that their stack's narrowest width. Where not even the stack fits beside it,
            // it gives the stack the bottom edge and is lifted over it.
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
                    plate = PlateStand::Stack;
                    span = bottom_run();
                }
                None
            }
        } else {
            let row = row_along(span);
            // Too narrow even for the stack, it has the whole run.
            if row.is_none() && span.width() < observer::MIN_STACK_WIDTH {
                span = bottom_run();
            }
            row
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
        let selection_slot = slot(selection_run, selection_anchor, base);
        let column_slot = |bottom: f32| slot(column_run, column_anchor, bottom);
        let mut stack = Vec::new();
        // The selection panel is not one the watcher turns on and off: it is up with the panels
        // that report on the game while anything is selected. The dock is part of the plate's
        // panel where the plate is up, of the selection panel's where that is, and floats on its own
        // with neither.
        let selection_shown = prefs.reporting_shown();
        let spot = Spot::new(
            ctx,
            spot_id("selection"),
            selection_shown && !view.selection.units.is_empty(),
            slot_place(selection_slot),
        );
        let selection_at = slot_at(selection_slot, spot.at());
        let selection_up = selection_shown
            && !view.selection.units.is_empty()
            && observer::selection::fits(selection_at);
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
            selection_shown,
            selection_at,
            prefs.dock && dock_stand == observer::DockStand::Selection,
        );
        spot.drawn(selection.is_some());
        let selection_drawn = selection.is_some();
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
        let under_groups = if row.is_some() {
            base
        } else {
            base + observer::stack_share(selection)
        };
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
        let control_groups_slot = column_slot(under_groups);
        let spot = Spot::new(
            ctx,
            spot_id("control_groups"),
            prefs.control_groups && !view.control_groups.is_empty(),
            slot_place(control_groups_slot),
        );
        let control_groups = observer::render_control_groups_view(
            &view.control_groups,
            ctx,
            prefs.control_groups,
            slot_at(control_groups_slot, spot.at()),
            self.focused_player,
        );
        spot.drawn(control_groups.is_some());
        if let Some(outcome) = &control_groups {
            hit_rects.push(HitRect::new(outcome.rect));
            stack.push(outcome.rect);
            if let Some(digit) = outcome.clicked {
                self.recall_control_group(digit, intents);
            }
        }
        let control_groups = control_groups.map(|outcome| outcome.rect);
        let over_groups = under_groups + observer::stack_share(control_groups);
        if prefs.production
            && !view.production.is_empty()
            && observer::production::ProductionFit::of(&view.production, column_slot(over_groups))
                .is_none()
        {
            displaced.push(Panel::Production);
        }
        let production_slot = column_slot(over_groups);
        let spot = Spot::new(
            ctx,
            spot_id("production"),
            prefs.production && !view.production.is_empty(),
            slot_place(production_slot),
        );
        let production = observer::render_production_view(
            &view.production,
            ctx,
            prefs.production,
            slot_at(production_slot, spot.at()),
        );
        spot.drawn(production.is_some());
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
                let over_stack =
                    over_groups + observer::stack_share(production.as_ref().map(|out| out.rect));
                playback_placement.lift = over_stack - observer::WING_MARGIN;
            }
        }

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
        };

        // The wings hang from under the top surfaces and end above whatever stands under them in
        // their own column: the stack, the minimap's frame, the plate and the dock.
        let mut bottom_surfaces = stack;
        bottom_surfaces.push(minimap);
        if playback_controls_shown {
            bottom_surfaces.push(playback_placement.rect(screen));
        }
        if prefs.dock {
            bottom_surfaces.push(dock.footprint());
        }
        let left_span = layout::left_wing_span(screen, observer::economy::PANEL_WIDTH);
        let right_span = layout::right_wing_span(screen, observer::military::PANEL_WIDTH);
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
        let economy_shown = prefs.economy && economy_fits;
        let spot = Spot::new(ctx, spot_id("economy"), economy_shown, [tops.left]);
        let [economy_top] = spot.at();
        let economy = observer::render_economy_view(&view.economy, ctx, economy_shown, economy_top);
        spot.drawn(economy.is_some());
        if let Some(rect) = economy {
            hit_rects.push(HitRect::new(rect));
        }
        let military_fits = right_room
            && tops.right + observer::military::panel_height(&view.military) <= right_floor;
        if prefs.military && !view.military.is_empty() && !military_fits {
            displaced.push(Panel::Military);
        }
        let military_shown = prefs.military && military_fits;
        let spot = Spot::new(ctx, spot_id("military"), military_shown, [tops.right]);
        let [military_top] = spot.at();
        let military =
            observer::render_military_view(&view.military, ctx, military_shown, military_top);
        spot.drawn(military.is_some());
        if let Some(rect) = military {
            hit_rects.push(HitRect::new(rect));
        }
        let graphs_top = tops.right + observer::stack_share(military);
        let graphs_fit = right_room && observer::graphs::fits(graphs_top, right_floor);
        if prefs.graphs && !view.graphs.is_empty() && !graphs_fit {
            displaced.push(Panel::Graphs);
        }
        // The panels that report on the game so far are ways back into it, where it can be moved
        // through at all: a replay, with playback to move.
        let seekable = replay.seekable(host.mode);
        let graphs_shown = prefs.graphs && right_room;
        let spot = Spot::new(
            ctx,
            spot_id("graphs"),
            graphs_shown && !view.graphs.is_empty(),
            [graphs_top],
        );
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
        if prefs.timeline && !observer::timeline::fits(timeline_top, left_floor) {
            displaced.push(Panel::Timeline);
        }
        let spot = Spot::new(ctx, spot_id("timeline"), prefs.timeline, [timeline_top]);
        let [eased_timeline_top] = spot.at();
        let timeline = observer::render_timeline_view(
            &view.timeline,
            ctx,
            prefs.timeline,
            eased_timeline_top,
            left_floor,
            seekable.is_some(),
        );
        spot.drawn(timeline.is_some());
        if let Some(outcome) = timeline {
            hit_rects.push(HitRect::scrolling(outcome.rect));
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
            prefs.toggle_all_but_controls();
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

    use crate::shell::Intent;
    use crate::shell::test_support::*;

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
            .find(|rect| rect.size() == egui::vec2(dock::TABLE_WIDTH, dock::FLOATING_STRIP_HEIGHT))
            .expect("the dock floats as a strip");
        assert!(
            (strip.bottom() - (screen.y - WING_MARGIN)).abs() < 0.5,
            "{strip:?}"
        );
        assert!(dock_column(&output).is_none());
        assert!(dock_rect(&output).is_none());
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
        for _ in 0..6 {
            frame(&mut shell, 0.5);
        }

        assert!(shell.key_pressed(Key::A, Modifiers::NONE));
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
