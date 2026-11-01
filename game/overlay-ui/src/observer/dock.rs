//! The observer dock: the one place a watcher can see what they are being shown and change it
//! without knowing a key.
//!
//! It stands on whichever bottom panel holds the bottom-right corner, as part of that panel. In a
//! replay with the playback controls up it is the top of their panel: a strip of keycaps over the
//! plate, divided from it by the plate's own edge. Otherwise, while anything is selected, it is a
//! column of keycaps two wide against the selection panel's right edge and as tall as it, the two
//! drawn as one panel. With neither on screen it is a strip of its own, floating where the column
//! would end. Either way the keycaps are lit for the panels on screen: a reminder for someone who
//! already knows the keys.
//!
//! The all-panels button and its keyboard shortcut hide and restore every panel except the dock.
//! The dock moves to its floating strip whenever neither playback nor selection is shown.
//!
//! **Expanded** it spells the panels out as a table, a row for each with its name and its key, for
//! someone who does not: a strip opens upward into it, and beside the selection panel it opens over
//! the pair of them. The table lists its rows in the order the keycaps come in, so
//! the two forms read alike, and it is the shell's own panel table, so the dock offers exactly the
//! surfaces the shell can toggle.
//!
//! A panel the watcher wants on screen but the screen has no room for is a key of its own kind: on,
//! and not on screen, so the dock never claims a panel is up that the watcher cannot find. Its keycap
//! is hatched, the mark for something there and not available, and its row in the table is hollow,
//! edged in the lit row's blue with nothing in it, and says so in words.

use egui::emath::GuiRounding;
use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Painter, Pos2, Rect, Response, Sense, Shape,
    Stroke, StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{WING_GAP, WING_MARGIN, paint_text, panel_name, selection};
use crate::shell::{Action, Hotkeys, MatchupStyle, Mode, Panel, PanelPrefs};
use crate::tr;

/// Size of a keycap.
const KEY_WIDTH: f32 = 28.0;
const KEY_HEIGHT: f32 = 22.0;

/// Width of the strip's keycaps, narrower than the column's and the table's so that a key for every
/// panel the strip carries fits across the plate it stands on.
const STRIP_KEY_WIDTH: f32 = 24.0;

/// Gap between two keycaps side by side, and the room either side of the rule between two of the
/// strip's groups.
const KEY_GAP: f32 = 3.0;
const GROUP_GAP: f32 = 4.0;

/// Width of the chevron at the strip's far end that opens the table.
const CHEVRON_WIDTH: f32 = 22.0;

/// How tall the strip over the plate is, chrome included: what brings the plate's panel up to the
/// selection panel's height, so the two stand level at the end of the bottom row.
pub(crate) const STRIP_HEIGHT: f32 =
    selection::PANEL_HEIGHT - crate::playback_controls::PANEL_HEIGHT;

const _: () = assert!(STRIP_HEIGHT - tiers::PANEL_MARGIN_HEIGHT >= KEY_HEIGHT);

/// How tall the strip is floating on its own, chrome included: a keycap high, with no panel beside it
/// to match.
pub(crate) const FLOATING_STRIP_HEIGHT: f32 = KEY_HEIGHT + tiers::PANEL_MARGIN_HEIGHT;

/// How wide the table is: as wide as the playback controls, which the strip over them is laid out
/// to fit inside.
pub(crate) const TABLE_WIDTH: f32 = crate::playback_controls::PANEL_WIDTH;

/// Height of the column's keycaps, shorter than the strip's so its rows fit the height of the
/// selection panel it stands beside: one for the all-panels key and the chevron, then one a pair.
const COLUMN_KEY_HEIGHT: f32 = 20.0;
const COLUMN_ROWS: usize = PAIRS.len() + 1;

/// How wide the column is, chrome included: two keycaps side by side.
pub(crate) const COLUMN_WIDTH: f32 = KEY_WIDTH * 2.0 + KEY_GAP + tiers::PANEL_MARGIN_WIDTH;

/// How tall the column's contents are: the selection panel's, as the one panel the two make.
const COLUMN_BODY: f32 = selection::PANEL_HEIGHT - tiers::PANEL_MARGIN_HEIGHT;

const _: () = assert!(
    COLUMN_ROWS as f32 * COLUMN_KEY_HEIGHT + (COLUMN_ROWS - 1) as f32 * KEY_GAP <= COLUMN_BODY
);

/// Height of the table's title row, which keeps its keycaps as far off the first row as a row keeps
/// its own keycap off its edge, so they read as the title's rather than as the start of the rows.
const HEADER_HEIGHT: f32 = ROW_HEIGHT - ROW_GAP * 2.0;

/// Height of one of the table's rows, and the gap over every row.
const ROW_HEIGHT: f32 = theme::HIT_PANEL;
const ROW_GAP: f32 = 2.0;

/// How far a row's name and keycap sit in from the ends of its wash.
const ROW_PAD: f32 = 6.0;

/// The panels in the order the table lists them, which is the order the keycaps come in: the bars
/// along the top edge, the left wing, the right wing, the bottom row, and the game's own minimap with
/// the replay's playback controls.
const ROWS: [Panel; 11] = [
    Panel::Matchup,
    Panel::MapControl,
    Panel::Economy,
    Panel::Timeline,
    Panel::Military,
    Panel::Graphs,
    Panel::Production,
    Panel::ControlGroups,
    Panel::Selection,
    Panel::Minimap,
    Panel::PlaybackControls,
];

/// The table's rows in the pairs the column lays them out in, a row of keycaps to each. The
/// selection panel is the table's alone here, for want of room for another row: it is the panel the
/// column stands against.
const PAIRS: [[Panel; 2]; 5] = [
    [Panel::Matchup, Panel::MapControl],
    [Panel::Economy, Panel::Timeline],
    [Panel::Military, Panel::Graphs],
    [Panel::Production, Panel::ControlGroups],
    [Panel::Minimap, Panel::PlaybackControls],
];

/// The keys the strip carries after the all-panels key, grouped as the table pairs them: the panels
/// a watcher turns on and off as the game goes. The rest are the table's alone, for want of room on
/// the strip: map control is a sliver of a bar, the minimap is all but never put away, and the
/// playback controls are the panel the strip is the top of.
const STRIP_GROUPS: [&[Panel]; 4] = [
    &[Panel::Matchup],
    &[Panel::Economy, Panel::Timeline],
    &[Panel::Military, Panel::Graphs],
    &[Panel::Production, Panel::ControlGroups, Panel::Selection],
];

/// How wide the strip's keys, the rules between their groups and the chevron are laid end to end,
/// with a group's room between the last key and the chevron.
const STRIP_CONTENT_WIDTH: f32 = {
    let mut width = STRIP_KEY_WIDTH + GROUP_GAP * 2.0 + CHEVRON_WIDTH;
    let mut index = 0;
    while index < STRIP_GROUPS.len() {
        let keys = STRIP_GROUPS[index].len() as f32;
        width +=
            GROUP_GAP * 2.0 + theme::HAIRLINE + keys * STRIP_KEY_WIDTH + (keys - 1.0) * KEY_GAP;
        index += 1;
    }
    width
};

// The strip is laid out to fit the plate it stands on: a key past the room would be drawn outside
// the dock's chrome.
const _: () = assert!(STRIP_CONTENT_WIDTH <= TABLE_WIDTH - tiers::PANEL_MARGIN_WIDTH);

/// What a style of the matchup is called, on the card naming the chip that picks it.
fn matchup_style_label(style: MatchupStyle) -> String {
    match style {
        MatchupStyle::Bar => tr!("observer.matchupBar", "Bar along the top"),
        MatchupStyle::Compact => tr!("observer.matchupCompact", "Compact, in the corner"),
        MatchupStyle::Off => tr!("observer.matchupOff", "Hidden"),
    }
}

/// Whether this game gets a key for `panel`.
///
/// Spoiler-free is not a panel at all: it is a way of watching rather than a surface, and the
/// playback controls carry its switch.
fn offered(panel: Panel, mode: Mode, map_control_available: bool) -> bool {
    match panel {
        // A key that hid the surface it sits on could not be clicked again, so the dock is reached
        // by its own key alone.
        Panel::Dock => false,
        // The playback controls only exist in a replay, so offering them while observing a live
        // game would be offering a switch with nothing behind it.
        Panel::PlaybackControls => mode == Mode::Replay,
        // A host with no map-control reading gets no key for the bar: a switch that turns nothing
        // on is worse than no switch.
        Panel::MapControl => map_control_available,
        _ => true,
    }
}

/// The table's rows in this game: every panel it offers, in the table's order.
fn rows(mode: Mode, map_control_available: bool) -> impl Iterator<Item = Panel> {
    ROWS.into_iter()
        .filter(move |&panel| offered(panel, mode, map_control_available))
}

/// How tall the table's contents are with this game's rows in it: its title row over its rows.
fn table_height(mode: Mode, map_control_available: bool) -> f32 {
    HEADER_HEIGHT + rows(mode, map_control_available).count() as f32 * (ROW_GAP + ROW_HEIGHT)
}

/// The strip's place, standing on the top edge of the plate at `plate`.
fn strip_over(plate: Rect) -> Rect {
    Rect::from_min_max(
        pos2(plate.left(), plate.top() - STRIP_HEIGHT),
        plate.right_top(),
    )
}

/// The column's place, standing against the right edge of the selection panel's place at
/// `selection`, as tall as it.
fn column_beside(selection: Rect) -> Rect {
    Rect::from_min_size(
        selection.right_top(),
        vec2(COLUMN_WIDTH, selection.height()),
    )
}

/// The floating strip's place: on the bottom edge of the selection panel's place at `selection`,
/// with its right edge where the column's would be, so the dock keeps its corner as it changes form.
fn floating_strip(selection: Rect) -> Rect {
    let column = column_beside(selection);
    Rect::from_min_max(
        pos2(
            column.right() - TABLE_WIDTH,
            column.bottom() - FLOATING_STRIP_HEIGHT,
        ),
        column.right_bottom(),
    )
}

/// What the dock stands on this frame, which decides the form it is drawn in.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DockStand {
    /// The playback controls, whose panel the dock is the top of: a strip over the plate.
    Plate,
    /// The selection panel, which the dock is a column against the right edge of.
    Selection,
    /// Neither, with nothing on screen to be part of: a strip of its own.
    Nothing,
}

/// Where the dock stands this frame.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct DockPlacement {
    /// Where the playback controls are, which the dock stands on while they are up.
    pub plate: Rect,
    pub stand: DockStand,
    /// Where the selection panel is, whether or not anything is selected to put it on screen: the
    /// column keeps to its side and the floating strip to its corner either way.
    pub selection: Rect,
    /// Whether the selection panel is on screen, which the column is drawn as one panel with.
    pub selection_drawn: bool,
}

impl DockPlacement {
    /// What the dock takes of the screen collapsed, which is what the panels around it keep clear
    /// of in either form: the table opens out over the panels above it, as something the watcher
    /// has opened to read.
    pub(crate) fn footprint(self) -> Rect {
        match self.stand {
            DockStand::Plate => strip_over(self.plate),
            DockStand::Selection => column_beside(self.selection),
            DockStand::Nothing => floating_strip(self.selection),
        }
    }
}

/// What the watcher asked of the dock this frame.
pub struct DockOutcome {
    /// Where the dock's surfaces are on screen, for the host's hit testing.
    pub rects: Vec<Rect>,
    /// A surface to turn on or off.
    pub toggled: Option<Panel>,
    /// Whether every panel but the dock should be put away or brought back.
    pub all_toggled: bool,
    /// How the matchup should be on screen.
    pub matchup_style: Option<MatchupStyle>,
    /// Whether the dock should spell its rows out.
    pub expanded: Option<bool>,
}

impl DockOutcome {
    /// An outcome with nothing asked of it yet, waiting for its rects.
    fn none() -> DockOutcome {
        DockOutcome {
            rects: Vec::new(),
            toggled: None,
            all_toggled: false,
            matchup_style: None,
            expanded: None,
        }
    }

    /// Folds what the watcher asked of another of the dock's surfaces into this.
    fn merge(&mut self, other: DockOutcome) {
        self.rects.extend(other.rects);
        self.toggled = self.toggled.or(other.toggled);
        self.all_toggled |= other.all_toggled;
        self.matchup_style = self.matchup_style.or(other.matchup_style);
        self.expanded = self.expanded.or(other.expanded);
    }
}

/// What the dock draws from besides the panel preferences themselves.
pub struct DockContext<'a> {
    pub hotkeys: &'a Hotkeys,
    pub mode: Mode,
    pub map_control_available: bool,
    pub placement: DockPlacement,
    /// The panels the watcher wants on screen that the screen has no room for this frame.
    pub displaced: &'a [Panel],
}

/// Draws the dock where `dock` places it, fading each of its forms in and out as the panel it
/// stands on changes. Returns nothing at all once it is gone.
pub fn render_obs_dock(
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    ctx: &Context,
) -> Option<DockOutcome> {
    let placement = dock.placement;
    let standing = |stand: DockStand| prefs.dock && placement.stand == stand;
    let on_plate = StripStand {
        id: Id::new("sb_obs_dock"),
        rect: strip_over(placement.plate),
        joined: Some(tiers::Joined {
            edge: tiers::Edge::Bottom,
            divides: false,
        }),
    };
    let floating = StripStand {
        id: Id::new("sb_obs_dock_floating"),
        rect: floating_strip(placement.selection),
        joined: None,
    };
    let beside = standing(DockStand::Selection);
    [
        render_strip(prefs, dock, ctx, on_plate, standing(DockStand::Plate)),
        render_strip(prefs, dock, ctx, floating, standing(DockStand::Nothing)),
        render_column(prefs, dock, ctx, beside),
        render_column_table(prefs, dock, ctx, beside && prefs.dock_expanded),
    ]
    .into_iter()
    .flatten()
    .reduce(|mut outcome, other| {
        outcome.merge(other);
        outcome
    })
}

/// Where one of the dock's strips stands.
struct StripStand {
    id: Id,
    /// The strip's place collapsed, chrome included, whose bottom edge the table opens up from.
    rect: Rect,
    /// How the strip is joined to the panel under it, if it stands on one.
    joined: Option<tiers::Joined>,
}

/// A strip, or the table it opens upward into: the top of the plate's panel, or a panel of its own.
fn render_strip(
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    ctx: &Context,
    stand: StripStand,
    shown: bool,
) -> Option<DockOutcome> {
    let StripStand { id, rect, joined } = stand;
    let body = rect.height() - tiers::PANEL_MARGIN_HEIGHT;
    // The table opens like a drawer pulled up out of the strip: the strip's bottom edge stays where
    // it stands while its height eases between the two forms.
    let height = ctx.animate_value_with_time(
        id.with("height"),
        if prefs.dock_expanded {
            table_height(dock.mode, dock.map_control_available)
        } else {
            body
        },
        theme::MOTION_PANEL_SECS,
    );
    // Placed by its top edge, worked out here from this frame's height, rather than anchored by its
    // bottom: an anchored area is placed from the size it had the frame before, which for the frame
    // the height changes puts the dock's contents out past its edge.
    let area = Area::new(id)
        .pivot(Align2::LEFT_TOP)
        .fixed_pos(pos2(rect.left(), opened_top(ctx, rect.bottom(), height)))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel_joined(ui, joined, |ui| {
            let width = tiers::panel_content_width(rect.width());
            ui.set_width(width);
            let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
            if height > body + 0.5 {
                draw_table(ui, rect, prefs, dock)
            } else {
                draw_strip(ui, rect, prefs, dock)
            }
        })
        .inner
    })?;
    // The table is the one surface allowed over the panels, being something the watcher has just
    // opened to read, so it is kept over whichever of them came on screen after it.
    ctx.move_to_top(inner.response.layer_id);
    let mut outcome = inner.inner;
    outcome.rects.push(inner.response.rect);
    Some(outcome)
}

/// Where the top of a surface `height` tall goes for its bottom edge to stand at `bottom`, chrome
/// included. A table taller than the room over what it stands on stops at the screen's margin and
/// opens down over that instead, rather than taking its title row and the chevron that closes it off
/// screen.
fn opened_top(ctx: &Context, bottom: f32, height: f32) -> f32 {
    (bottom - tiers::PANEL_MARGIN_HEIGHT - height).max(ctx.viewport_rect().top() + WING_MARGIN)
}

/// The column against the selection panel's right edge.
fn render_column(
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    ctx: &Context,
    shown: bool,
) -> Option<DockOutcome> {
    let id = Id::new("sb_obs_dock_column");
    let column = column_beside(dock.placement.selection);
    let area = Area::new(id)
        .pivot(Align2::LEFT_TOP)
        .fixed_pos(column.left_top())
        .order(Order::Foreground);
    // On its own while nothing is selected, standing where it would be joined to the panel.
    let joined = dock.placement.selection_drawn.then_some(tiers::Joined {
        edge: tiers::Edge::Left,
        divides: false,
    });
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel_joined(ui, joined, |ui| {
            let size = vec2(tiers::panel_content_width(COLUMN_WIDTH), COLUMN_BODY);
            ui.set_width(size.x);
            let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
            draw_column(ui, rect, prefs, dock)
        })
        .inner
    })?;
    let mut outcome = inner.inner;
    outcome.rects.push(inner.response.rect);
    Some(outcome)
}

/// The table the column opens, over the selection panel and the column together and flush with
/// the column's right edge.
fn render_column_table(
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    ctx: &Context,
    shown: bool,
) -> Option<DockOutcome> {
    let id = Id::new("sb_obs_dock_table");
    let column = column_beside(dock.placement.selection);
    let height = table_height(dock.mode, dock.map_control_available);
    let area = Area::new(id)
        .pivot(Align2::LEFT_TOP)
        .fixed_pos(pos2(
            column.right() - TABLE_WIDTH,
            opened_top(ctx, column.top() - WING_GAP, height),
        ))
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        tiers::tier0_panel(ui, |ui| {
            let width = tiers::panel_content_width(TABLE_WIDTH);
            ui.set_width(width);
            let (rect, _) = ui.allocate_exact_size(vec2(width, height), Sense::hover());
            draw_table(ui, rect, prefs, dock)
        })
        .inner
    })?;
    ctx.move_to_top(inner.response.layer_id);
    let mut outcome = inner.inner;
    outcome.rects.push(inner.response.rect);
    Some(outcome)
}

/// What the dock has to say about whatever the pointer is resting on.
struct Hint {
    /// Where the pointer is, which is what the card hangs off.
    anchor: Pos2,
    /// What the control is, in the same words the table spells out.
    title: String,
    /// The key that does the same thing without the pointer, for a control that has one.
    key: Option<String>,
    /// Whether the control's panel is wanted and has no room, which the card says in words.
    displaced: bool,
}

impl Hint {
    /// The hint `response` asks for, or nothing while the pointer is elsewhere.
    fn hovered(response: &Response, title: String, key: Option<&str>) -> Option<Hint> {
        Some(Hint {
            anchor: response.hover_pos()?,
            title,
            key: key.map(str::to_string),
            displaced: false,
        })
    }
}

/// How a panel stands.
#[derive(Copy, Clone, PartialEq, Eq)]
enum RowState {
    Off,
    On,
    /// Wanted on screen, with no room for it on this one.
    Displaced,
}

/// How `panel` stands this frame.
fn row_state(prefs: &PanelPrefs, dock: &DockContext<'_>, panel: Panel) -> RowState {
    if !prefs.shown(panel) {
        RowState::Off
    } else if dock.displaced.contains(&panel) {
        RowState::Displaced
    } else {
        RowState::On
    }
}

/// Draws `panel`'s keycap in `rect`, as the strip and the column carry them, with the card naming
/// it under the pointer: a keycap is all there is room for, so the card is what names it. Returns
/// whether it was clicked and the card.
fn draw_panel_key(
    ui: &mut Ui,
    rect: Rect,
    panel: Panel,
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
) -> (bool, Option<Hint>) {
    let key = dock.hotkeys.bare_key(panel.action());
    let state = row_state(prefs, dock, panel);
    let response = key_button(ui, rect, panel.label(), key, state);
    let hint = Hint::hovered(&response, panel_name(panel), key).map(|hint| Hint {
        displaced: state == RowState::Displaced,
        ..hint
    });
    (response.clicked(), hint)
}

/// Draws the chevron that opens or closes the table, with the card naming it: the arrow alone says
/// which way without saying what. Returns whether it was clicked and the card.
fn draw_expander(ui: &mut Ui, rect: Rect, expanded: bool) -> (bool, Option<Hint>) {
    let response = draw_chevron(ui, rect, !expanded);
    let title = if expanded {
        tr!("observer.dockCollapse", "Collapse dock")
    } else {
        tr!("observer.dockExpand", "Expand dock")
    };
    (response.clicked(), Hint::hovered(&response, title, None))
}

/// Draws the strip in `rect`: the all-panels key, a keycap for each panel the strip carries with a
/// rule between their groups, and the chevron that opens the table at the far end.
fn draw_strip(ui: &mut Ui, rect: Rect, prefs: &PanelPrefs, dock: &DockContext<'_>) -> DockOutcome {
    let mut outcome = DockOutcome::none();
    let keycap_at = |left: f32| {
        Rect::from_min_size(
            pos2(left, rect.center().y - KEY_HEIGHT * 0.5),
            vec2(STRIP_KEY_WIDTH, KEY_HEIGHT),
        )
    };
    let all = keycap_at(rect.left());
    let (all_toggled, mut hint) = draw_all_key(ui, all, all_key_state(prefs), dock.hotkeys);
    outcome.all_toggled = all_toggled;

    let mut left = all.right();
    for group in STRIP_GROUPS {
        let rule = left + GROUP_GAP;
        ui.painter().vline(
            rule + theme::HAIRLINE * 0.5,
            rect.y_range().shrink(3.0),
            Stroke::new(theme::HAIRLINE, theme::TIER1_DIVIDER),
        );
        left = rule + theme::HAIRLINE + GROUP_GAP;
        for (index, &panel) in group.iter().enumerate() {
            if index > 0 {
                left += KEY_GAP;
            }
            let rect = keycap_at(left);
            left = rect.right();
            let (clicked, key_hint) = draw_panel_key(ui, rect, panel, prefs, dock);
            hint = hint.or(key_hint);
            if clicked {
                outcome.toggled = Some(panel);
            }
        }
    }

    let chevron = Rect::from_min_max(
        pos2(rect.right() - CHEVRON_WIDTH, rect.top()),
        rect.right_bottom(),
    );
    let (clicked, chevron_hint) = draw_expander(ui, chevron, false);
    hint = hint.or(chevron_hint);
    if clicked {
        outcome.expanded = Some(true);
    }

    if let Some(hint) = hint {
        draw_hint(ui, &hint);
    }
    outcome
}

/// Draws the column in `rect`: the all-panels key and the chevron that opens the table over it,
/// then a row of keycaps for each pair, with a gap where this game offers no key.
fn draw_column(ui: &mut Ui, rect: Rect, prefs: &PanelPrefs, dock: &DockContext<'_>) -> DockOutcome {
    let mut outcome = DockOutcome::none();
    let pitch = rect.height() / COLUMN_ROWS as f32;
    let cell = |row: usize, column: usize| {
        Rect::from_min_size(
            pos2(
                rect.left() + column as f32 * (KEY_WIDTH + KEY_GAP),
                rect.top() + row as f32 * pitch + (pitch - COLUMN_KEY_HEIGHT) * 0.5,
            ),
            vec2(KEY_WIDTH, COLUMN_KEY_HEIGHT),
        )
    };
    let (all_toggled, mut hint) = draw_all_key(ui, cell(0, 0), all_key_state(prefs), dock.hotkeys);
    outcome.all_toggled = all_toggled;
    let (clicked, chevron_hint) = draw_expander(ui, cell(0, 1), prefs.dock_expanded);
    hint = hint.or(chevron_hint);
    if clicked {
        outcome.expanded = Some(!prefs.dock_expanded);
    }
    for (row, pair) in PAIRS.iter().enumerate() {
        for (column, &panel) in pair.iter().enumerate() {
            if !offered(panel, dock.mode, dock.map_control_available) {
                continue;
            }
            let (clicked, key_hint) = draw_panel_key(ui, cell(row + 1, column), panel, prefs, dock);
            hint = hint.or(key_hint);
            if clicked {
                outcome.toggled = Some(panel);
            }
        }
    }

    if let Some(hint) = hint {
        draw_hint(ui, &hint);
    }
    outcome
}

/// Draws the table in `rect`: the dock's title row, then a row for each panel. Laid out at its full height against the top
/// of `rect` and cut off at its bottom, so a table partway through opening or closing rides up and
/// down with the dock's top edge rather than being squeezed into the room it has.
fn draw_table(ui: &mut Ui, rect: Rect, prefs: &PanelPrefs, dock: &DockContext<'_>) -> DockOutcome {
    let hotkeys = dock.hotkeys;
    let mut outcome = DockOutcome::none();
    ui.set_clip_rect(ui.clip_rect().intersect(rect));

    let header = Rect::from_min_size(rect.left_top(), vec2(rect.width(), HEADER_HEIGHT));
    let chevron = Rect::from_min_max(
        pos2(header.right() - CHEVRON_WIDTH, header.top()),
        header.right_bottom(),
    );
    let all = Rect::from_min_size(
        pos2(
            chevron.left() - GROUP_GAP - KEY_WIDTH,
            header.center().y - KEY_HEIGHT * 0.5,
        ),
        vec2(KEY_WIDTH, KEY_HEIGHT),
    );
    // The dock is named with the key that takes it off screen, which is the one thing a watcher
    // cannot work out from the dock once it is gone.
    let title = panel_name(Panel::Dock);
    let title_spec = text::panel_title();
    let title_width = title_spec.galley(ui, &title).size().x;
    paint_text(ui, header, &title_spec, &title, Align::LEFT);
    let dock_key = Rect::from_min_size(
        pos2(
            header.left() + title_width + ROW_PAD,
            header.center().y - KEY_HEIGHT * 0.5,
        ),
        vec2(KEY_WIDTH, KEY_HEIGHT),
    );
    let key = hotkeys.bare_key(Panel::Dock.action());
    let response = key_button(ui, dock_key, "dock", key, RowState::Off);
    if response.clicked() {
        outcome.toggled = Some(Panel::Dock);
    }
    let (clicked, expander_hint) = draw_expander(ui, chevron, true);
    if clicked {
        outcome.expanded = Some(false);
    }
    let mut hint = Hint::hovered(&response, panel_name(Panel::Dock), key).or(expander_hint);
    // The table's keycaps are plain: its rows carry the panels' state, as the strip's keycaps do.
    let (all_toggled, all_hint) = draw_all_key(ui, all, RowState::Off, hotkeys);
    outcome.all_toggled = all_toggled;
    hint = hint.or(all_hint);

    let mut top = header.bottom();
    for panel in rows(dock.mode, dock.map_control_available) {
        top += ROW_GAP;
        let row = Rect::from_min_size(pos2(rect.left(), top), vec2(rect.width(), ROW_HEIGHT));
        top += ROW_HEIGHT;
        let key = hotkeys.bare_key(panel.action());
        let state = row_state(prefs, dock, panel);
        let response = draw_row(ui, row, panel, key, state);
        // The row has already said everything a card would, a panel with no room included.
        if response.clicked() {
            outcome.toggled = Some(panel);
        }
        // The matchup's style is picked in its own row, between its name and its key.
        if panel == Panel::Matchup {
            let chips = Rect::from_min_size(
                pos2(
                    row.right() - ROW_PAD - KEY_WIDTH - ROW_PAD - style_chips_width(),
                    row.center().y - STYLE_CHIP * 0.5,
                ),
                vec2(style_chips_width(), STYLE_CHIP),
            );
            let (picked, chip_hint) = draw_matchup_style_chips(ui, chips, prefs.matchup_style());
            if picked.is_some() {
                outcome.matchup_style = picked;
            }
            hint = hint.or(chip_hint);
        }
    }

    if let Some(hint) = hint {
        draw_hint(ui, &hint);
    }
    outcome
}

/// Draws the key that puts away every panel but the dock and brings them back, drawn as `state`.
/// Returns whether it was clicked and the card naming it under the pointer.
fn draw_all_key(
    ui: &mut Ui,
    rect: Rect,
    state: RowState,
    hotkeys: &Hotkeys,
) -> (bool, Option<Hint>) {
    let key = hotkeys.bare_key(Action::ToggleAllPanels);
    let response = key_button(ui, rect, "all", key, state);
    let hint = Hint::hovered(&response, tr!("observer.dockAllPanels", "All panels"), key);
    (response.clicked(), hint)
}

/// How the all-panels key stands where keycaps carry their panels' state: lit while any of the
/// panels it puts away is on screen.
fn all_key_state(prefs: &PanelPrefs) -> RowState {
    if prefs.any_toggleable_shown() {
        RowState::On
    } else {
        RowState::Off
    }
}

/// Draws a keycap that can be clicked, as the strip's keys and the all-panels key are.
fn key_button(ui: &mut Ui, rect: Rect, salt: &str, key: Option<&str>, state: RowState) -> Response {
    let response = ui.interact(rect, ui.id().with(("sb_dock_key", salt)), Sense::click());
    paint_key_chip(ui, rect, key, state);
    widgets::state_overlay(ui, &response, rect, theme::radius(theme::RADIUS_CHIP));
    response
}

/// Draws the chevron that opens or closes the table, pointing the way the dock's top edge would
/// move: up to open the table out of the strip, down to fold it back into it.
fn draw_chevron(ui: &mut Ui, rect: Rect, up: bool) -> Response {
    let response = ui.interact(rect, ui.id().with("sb_dock_chevron"), Sense::click());
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    widgets::state_overlay(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    let arm = 4.0;
    let centre = rect.center();
    let (tip_y, back_y) = if up {
        (centre.y - arm * 0.5, centre.y + arm * 0.5)
    } else {
        (centre.y + arm * 0.5, centre.y - arm * 0.5)
    };
    ui.painter().add(Shape::line(
        vec![
            pos2(centre.x - arm, back_y),
            pos2(centre.x, tip_y),
            pos2(centre.x + arm, back_y),
        ],
        Stroke::new(theme::HAIRLINE + 0.4, color),
    ));
    response
}

/// Draws one of the table's rows in `rect`, returning what the pointer did to it: the panel's name on
/// the face a keycap for it would have, lit while the panel is on screen, and its keycap plain at the
/// far end, with the room [`reserved`] for the row's own controls kept free before it. A row reads
/// as the strip's keycap for its panel spelled out.
fn draw_row(ui: &mut Ui, rect: Rect, panel: Panel, key: Option<&str>, state: RowState) -> Response {
    let response = ui.interact(
        rect,
        ui.id().with(("sb_dock_row", panel.label())),
        Sense::click(),
    );
    let color = paint_chip_face(ui, rect, state);
    widgets::state_overlay(ui, &response, rect, theme::radius(theme::RADIUS_CHIP));
    let key_rect = Rect::from_min_size(
        pos2(
            rect.right() - ROW_PAD - KEY_WIDTH,
            rect.center().y - KEY_HEIGHT * 0.5,
        ),
        vec2(KEY_WIDTH, KEY_HEIGHT),
    );
    paint_key_chip(ui, key_rect, key, RowState::Off);
    let mut label = Rect::from_min_max(
        pos2(rect.left() + ROW_PAD, rect.top()),
        pos2(key_rect.left() - ROW_PAD - reserved(panel), rect.bottom()),
    );
    // A hollow row is the one state the table spells out: a keycap face that is on and empty is
    // worth reading as words where there is room for them.
    if state == RowState::Displaced {
        let note = tr!("observer.dockNoRoomShort", "No room");
        let spec = text::body(11.0, BodyWeight::Regular).with_color(theme::TEXT_DIM);
        let width = spec.galley(ui, &note).size().x;
        paint_text(ui, label, &spec, &note, Align::RIGHT);
        label.max.x -= width + ROW_PAD;
    }
    paint_text(
        ui,
        label,
        &row_name().with_color(color),
        &panel_name(panel),
        Align::LEFT,
    );
    response
}

/// How much of `panel`'s row is kept for controls of its own, between its name and its keycap: the
/// matchup's style chips.
fn reserved(panel: Panel) -> f32 {
    if panel == Panel::Matchup {
        style_chips_width() + ROW_PAD
    } else {
        0.0
    }
}

/// How a row's name is set.
fn row_name() -> text::TextSpec {
    text::body(13.0, BodyWeight::Medium)
}

/// Side of one of the chips the matchup's style is picked with, which is a keycap's height, and the
/// gap between two of them.
const STYLE_CHIP: f32 = KEY_HEIGHT;
const STYLE_CHIP_GAP: f32 = 3.0;

/// Size of the picture of the screen on a style chip.
const STYLE_PICTURE: Vec2 = vec2(14.0, 10.0);

/// How wide the matchup's style chips are side by side.
fn style_chips_width() -> f32 {
    let count = MatchupStyle::ALL.len() as f32;
    STYLE_CHIP * count + STYLE_CHIP_GAP * (count - 1.0)
}

/// Draws the chips the matchup's style is picked with, side by side in `rect`, the one on screen
/// lit as a keycap is. Returns the style picked, if one was, and the card naming a chip the pointer
/// is resting on, since a picture that small says where without saying what.
///
/// The matchup's row shows and hides the matchup as every row does its surface; the chips are the
/// one place all three ways it can be are offered at once.
fn draw_matchup_style_chips(
    ui: &Ui,
    rect: Rect,
    current: MatchupStyle,
) -> (Option<MatchupStyle>, Option<Hint>) {
    let mut picked = None;
    let mut hint = None;
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    for (index, style) in MatchupStyle::ALL.into_iter().enumerate() {
        let chip = Rect::from_min_size(
            pos2(
                rect.left() + index as f32 * (STYLE_CHIP + STYLE_CHIP_GAP),
                rect.top(),
            ),
            Vec2::splat(STYLE_CHIP),
        );
        let response = ui.interact(
            chip,
            ui.id().with(("sb_dock_matchup_style", index)),
            Sense::click(),
        );
        let lit = style == current;
        let color = paint_chip_face(ui, chip, if lit { RowState::On } else { RowState::Off });
        paint_style_picture(ui.painter(), chip, style, color);
        widgets::state_overlay(ui, &response, chip, corner_radius);
        if response.clicked() && !lit {
            picked = Some(style);
        }
        hint = hint.or_else(|| Hint::hovered(&response, matchup_style_label(style), None));
    }
    (picked, hint)
}

/// Paints a small picture of the screen in `color`, centered in `chip`, with the matchup where
/// `style` puts it: a bar along the middle of the top edge, a box in the top-right corner, or no
/// matchup at all, the screen struck through.
fn paint_style_picture(painter: &Painter, chip: Rect, style: MatchupStyle, color: Color32) {
    let screen = Rect::from_center_size(chip.center(), STYLE_PICTURE)
        .round_to_pixels(painter.pixels_per_point());
    let line = Stroke::new(theme::HAIRLINE, color);
    painter.rect_stroke(screen, theme::radius(1), line, StrokeKind::Inside);
    // The matchup is set in from the screen's edge by the width of its line plus a hair, so it reads
    // as something on the screen rather than as part of the frame.
    let inner = screen.shrink(theme::HAIRLINE * 2.0);
    match style {
        MatchupStyle::Bar => {
            painter.rect_filled(
                Rect::from_center_size(
                    pos2(inner.center().x, inner.top() + 1.0),
                    vec2(inner.width() * 0.6, 2.0),
                ),
                0.0,
                color,
            );
        }
        MatchupStyle::Compact => {
            painter.rect_filled(
                Rect::from_min_max(
                    pos2(inner.right() - inner.width() * 0.4, inner.top()),
                    pos2(inner.right(), inner.top() + inner.height() * 0.5),
                ),
                0.0,
                color,
            );
        }
        MatchupStyle::Off => {
            painter.line_segment([screen.left_bottom(), screen.right_top()], line);
        }
    }
}

/// Names what the pointer is resting on, and the key that reaches it without the pointer.
///
/// Over the pointer rather than under it, as the plate's own cards are: the dock is the top of the
/// plate's panel, so a card hung under the pointer would lie on the seek bar.
fn draw_hint(ui: &Ui, hint: &Hint) {
    widgets::tooltip_above(
        ui.ctx(),
        Id::new("sb_obs_dock").with("hint"),
        hint.anchor,
        |ui| {
            let note = hint
                .displaced
                .then(|| tr!("observer.dockNoRoom", "No room for it on this screen"));
            widgets::hint_card(
                ui,
                &hint.title,
                note.as_deref(),
                hint.key.as_deref().as_slice(),
            );
        },
    );
}

/// The edge a row for a panel with no room is drawn hollow with: the lit row's blue, brighter for
/// having no fill to carry it.
const HOLLOW_EDGE: Color32 = theme::alpha(crate::colors::BLUE80, 0.75);

/// How far apart the stripes across a hatched keycap are.
const HATCH_SPACING: f32 = 5.0;

/// Draws a keycap, lit while the surface it opens is on screen, and hatched while it is wanted with no
/// room for it: a keycap has no room to say so in words, as the table's rows do.
fn paint_key_chip(ui: &Ui, rect: Rect, key: Option<&str>, state: RowState) {
    let Some(key) = key else {
        return;
    };
    let color = if state == RowState::Displaced {
        paint_hatched_face(ui, rect)
    } else {
        paint_chip_face(ui, rect, state)
    };
    paint_text(
        ui,
        rect,
        &text::body(11.0, BodyWeight::Medium).with_color(color),
        key,
        Align::Center,
    );
}

/// Paints the face of a keycap whose panel is wanted with no room for it, and returns the color to
/// mark it with: the lit face dimmed and struck through with stripes.
fn paint_hatched_face(ui: &Ui, rect: Rect) -> Color32 {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(crate::colors::BLUE60, 0.18),
    );
    // Kept a hair inside the edge, so the stripes stop short of the rounded corners.
    let painter = ui
        .painter()
        .with_clip_rect(rect.shrink(theme::HAIRLINE).intersect(ui.clip_rect()));
    let stripe = Stroke::new(theme::HAIRLINE, theme::alpha(crate::colors::BLUE80, 0.40));
    let mut left = rect.left() - rect.height();
    while left < rect.right() {
        painter.line_segment(
            [
                pos2(left, rect.bottom()),
                pos2(left + rect.height(), rect.top()),
            ],
            stripe,
        );
        left += HATCH_SPACING;
    }
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::alpha(crate::colors::BLUE80, 0.45)),
        StrokeKind::Inside,
    ));
    theme::TEXT_SECONDARY
}

/// Paints the face of one of the dock's chips or rows, a keycap, a matchup style or a row of the
/// table, lit while what it stands for is on screen and hollow while it is wanted with no room for
/// it, and returns the color to mark it with.
fn paint_chip_face(ui: &Ui, rect: Rect, state: RowState) -> Color32 {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    // A lit chip is filled in the overlay's own blue rather than tinted: the strip is read at a
    // glance from the corner of the screen, and a tint is not a state anyone reads from there.
    let (fill, edge, color) = match state {
        RowState::On => (
            theme::alpha(crate::colors::BLUE60, 0.40),
            theme::alpha(crate::colors::BLUE80, 0.45),
            theme::TEXT_PRIMARY,
        ),
        // On and not on screen: the lit edge around the unlit face.
        RowState::Displaced => (
            theme::alpha(crate::colors::GREY_BLUE10, 0.60),
            HOLLOW_EDGE,
            theme::TEXT_SECONDARY,
        ),
        RowState::Off => (
            theme::alpha(crate::colors::GREY_BLUE10, 0.60),
            theme::CHIP_STROKE,
            theme::TEXT_DIM,
        ),
    };
    ui.painter().rect_filled(rect, corner_radius, fill);
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(theme::HAIRLINE, edge),
        StrokeKind::Inside,
    ));
    color
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The dock's keycaps, and the panel headers that share them, each have room for one key: a
    /// surface whose only bindings take a modifier would be left with a blank keycap.
    #[test]
    fn every_key_and_the_dock_itself_have_a_key_of_their_own() {
        let hotkeys = Hotkeys::defaults();
        let actions = ROWS
            .into_iter()
            .map(Panel::action)
            .chain([Panel::Dock.action(), Action::ToggleAllPanels]);
        for action in actions {
            assert!(
                hotkeys.bare_key(action).is_some(),
                "{action:?} has no key that works on its own"
            );
        }
    }

    #[test]
    fn every_panel_but_the_dock_has_a_row() {
        for panel in Panel::ALL {
            assert_eq!(ROWS.contains(&panel), panel != Panel::Dock, "{panel:?}");
        }
    }

    /// The column reads as the table does, short only of the panel it stands against.
    #[test]
    fn the_columns_pairs_are_the_tables_rows_but_the_selection() {
        assert!(
            PAIRS
                .into_iter()
                .flatten()
                .eq(ROWS.into_iter().filter(|&panel| panel != Panel::Selection))
        );
    }

    #[test]
    fn every_name_fits_its_row() {
        let ctx = Context::default();
        crate::install_fonts_and_style(&ctx, &crate::DynamicFonts::default());
        ctx.begin_pass(egui::RawInput::default());
        let row = tiers::panel_content_width(TABLE_WIDTH);
        let spec = row_name();
        let widths = ROWS
            .into_iter()
            .map(|panel| {
                let label = panel_name(panel);
                let width = spec.layout(&ctx, spec.job(&label)).size().x;
                let room = row - ROW_PAD * 3.0 - KEY_WIDTH - reserved(panel);
                (label, width, room)
            })
            .collect::<Vec<_>>();
        // A layout check has no GPU texture store to hand the atlas to.
        ctx.end_pass().textures_delta.clear();
        for (label, width, room) in widths {
            assert!(width <= room, "{label} is {width} wide, with {room} for it");
        }
    }

    /// The playback controls' place on a 1080p screen.
    const PLATE: Rect = Rect {
        min: pos2(1580.0, 950.0),
        max: pos2(1904.0, 1064.0),
    };

    /// The selection panel's place at the end of the bottom row on a 1080p screen.
    const SELECTION: Rect = Rect {
        min: pos2(1095.0, 1064.0 - selection::PANEL_HEIGHT),
        max: pos2(1555.0, 1064.0),
    };

    /// The rects the dock's surfaces settle into, as many of them as there are to draw.
    fn placed(expanded: bool, placement: DockPlacement, count: usize) -> Vec<Rect> {
        let hotkeys = Hotkeys::defaults();
        let prefs = PanelPrefs {
            dock_expanded: expanded,
            ..PanelPrefs::default()
        };
        (0..count)
            .map(|index| {
                crate::observer::test_support::settled_rect(|ctx| {
                    render_obs_dock(
                        &prefs,
                        &DockContext {
                            hotkeys: &hotkeys,
                            mode: Mode::Replay,
                            map_control_available: true,
                            placement,
                            displaced: &[],
                        },
                        ctx,
                    )
                    .and_then(|outcome| outcome.rects.get(index).copied())
                })
                .expect("the dock is drawn")
            })
            .collect()
    }

    fn on_plate(plate: Rect) -> DockPlacement {
        DockPlacement {
            plate,
            stand: DockStand::Plate,
            selection: SELECTION,
            selection_drawn: true,
        }
    }

    #[test]
    fn on_the_plate_the_dock_is_the_top_of_its_panel_and_opens_upward() {
        let placement = on_plate(PLATE);
        let [strip] = placed(false, placement, 1)[..] else {
            panic!("the strip alone is drawn");
        };
        assert_eq!(strip, placement.footprint());
        assert_eq!(strip.bottom(), PLATE.top());
        assert_eq!(strip.x_range(), PLATE.x_range());

        let [table] = placed(true, placement, 1)[..] else {
            panic!("the table alone is drawn");
        };
        assert_eq!(table.right_bottom(), strip.right_bottom());
        assert_eq!(table.width(), strip.width());
        assert_eq!(
            table.height(),
            table_height(Mode::Replay, true) + tiers::PANEL_MARGIN_HEIGHT
        );
    }

    #[test]
    fn a_table_with_no_room_over_the_plate_opens_down_from_the_screens_margin() {
        let high = PLATE.translate(vec2(0.0, 200.0 - PLATE.top()));
        let [table] = placed(true, on_plate(high), 1)[..] else {
            panic!("the table alone is drawn");
        };
        assert_eq!(table.top(), WING_MARGIN);
        assert_eq!(table.right(), high.right());
    }

    #[test]
    fn beside_the_selection_the_dock_is_a_column_as_tall_as_it_that_opens_over_both() {
        let placement = DockPlacement {
            stand: DockStand::Selection,
            ..on_plate(PLATE)
        };
        let [column] = placed(false, placement, 1)[..] else {
            panic!("the column alone is drawn");
        };
        assert_eq!(column, placement.footprint());
        assert_eq!(column.left_top(), SELECTION.right_top());
        assert_eq!(column.height(), SELECTION.height());
        assert_eq!(column.width(), COLUMN_WIDTH);

        let [still, table] = placed(true, placement, 2)[..] else {
            panic!("the column and its table are drawn");
        };
        assert_eq!(still, column);
        assert_eq!(table.right(), column.right());
        assert_eq!(table.bottom(), column.top() - WING_GAP);
        assert_eq!(table.width(), TABLE_WIDTH);
    }

    #[test]
    fn with_nothing_to_stand_on_the_dock_floats_as_a_strip_in_the_columns_corner() {
        let placement = DockPlacement {
            stand: DockStand::Nothing,
            selection_drawn: false,
            ..on_plate(PLATE)
        };
        let [strip] = placed(false, placement, 1)[..] else {
            panic!("the strip alone is drawn");
        };
        assert_eq!(strip, placement.footprint());
        assert_eq!(strip.right(), SELECTION.right() + COLUMN_WIDTH);
        assert_eq!(strip.bottom(), SELECTION.bottom());
        assert_eq!(strip.size(), vec2(TABLE_WIDTH, FLOATING_STRIP_HEIGHT));

        let [table] = placed(true, placement, 1)[..] else {
            panic!("the table alone is drawn");
        };
        assert_eq!(table.right_bottom(), strip.right_bottom());
        assert_eq!(
            table.height(),
            table_height(Mode::Replay, true) + tiers::PANEL_MARGIN_HEIGHT
        );
    }
}
