//! The observer dock: the one place a watcher can see what they are being shown and change it
//! without knowing a key.
//!
//! It hangs off the right edge of the screen at the kit's ambient tier, in two forms of the same
//! list. **Collapsed** it is a strip of keycaps, one per surface, lit for the ones that are on — a
//! reminder for someone who already knows the keys, taking as little of the screen as a control can.
//! **Expanded** it is the control rail: the same list with its names spelled out, for someone who
//! does not.
//!
//! The list is the shell's panel table rather than a list of its own, so a surface built later
//! appears here the day its toggle does, and one that does not exist yet is not advertised.
//!
//! It is centred on the screen's right edge rather than hung at a fixed height: the list grows with
//! the panels that exist and with what is being watched, and a fixed top would sooner or later push
//! its last rows into the console band the game's own interface owns. Where the surfaces above and
//! below it on that edge leave less than the middle, it moves off the middle into the room they
//! leave, and on a screen too short even for that its rows give up some of their height.
//!
//! A panel the watcher wants on screen but the screen has no room for is a row of its own kind: on,
//! and not on screen. Its lamp is a ring in the accent rather than a filled dot, so the dock never
//! claims a panel is up that the watcher cannot find.

use egui::{
    Align, Align2, Area, Context, Id, Order, Pos2, Rect, Response, Sense, Shape, Stroke,
    StrokeKind, Ui, Vec2, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{centred, paint_text};
use crate::shell::{Action, Hotkeys, Mode, Panel, PanelPrefs};
use crate::tr;

/// How wide the dock is collapsed, in overlay points.
pub(crate) const COLLAPSED_WIDTH: f32 = 52.0;

/// How wide it is as the control rail.
const EXPANDED_WIDTH: f32 = 208.0;

/// How far the dock sits from the screen's right edge.
const EDGE_MARGIN: f32 = 16.0;

/// How much of the right edge the dock takes in the form `expanded` says, its margin included.
pub(crate) fn column_width(expanded: bool) -> f32 {
    EDGE_MARGIN
        + if expanded {
            EXPANDED_WIDTH
        } else {
            COLLAPSED_WIDTH
        }
}

/// Height of one row.
const ROW_HEIGHT: f32 = theme::HIT_PANEL;

/// The least height a row keeps on a screen too short for the dock at its full height: still a
/// keycap's height with a little room around it.
const MIN_ROW_HEIGHT: f32 = 26.0;

/// Gap between two rows.
const ROW_GAP: f32 = 4.0;

/// Height of the chevron that changes the dock between its two forms.
const CHEVRON_HEIGHT: f32 = 24.0;

/// Size of the keycap chip on a row.
const KEY_WIDTH: f32 = 28.0;
const KEY_HEIGHT: f32 = 22.0;

/// Diameter of the lamp that says whether a surface is on screen.
const LAMP: f32 = 8.0;

/// Gap between the lamp, the name and the keycap.
const ROW_GUTTER: f32 = 8.0;

/// One thing the dock can turn on and off.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Entry {
    /// A surface, named by the shell's own panel table.
    Panel(Panel),
    /// Not a surface but a way of watching: whether a replay gives its own length away.
    SpoilerFree,
}

impl Entry {
    /// The action this row stands for, which is where its keycap comes from.
    fn action(self) -> Action {
        match self {
            Entry::Panel(panel) => panel.action(),
            Entry::SpoilerFree => Action::ToggleSpoilerFree,
        }
    }

    /// What the row is called when there is room to spell it out.
    fn label(self) -> String {
        match self {
            Entry::Panel(Panel::Matchup) => tr!("observer.panelMatchup", "Matchup"),
            Entry::Panel(Panel::MapControl) => tr!("observer.mapControl", "Map control"),
            Entry::Panel(Panel::Economy) => tr!("observer.panelEconomy", "Economy"),
            Entry::Panel(Panel::Military) => tr!("observer.panelMilitary", "Military"),
            Entry::Panel(Panel::Graphs) => tr!("observer.panelGraphs", "Graphs"),
            Entry::Panel(Panel::Timeline) => tr!("observer.panelTimeline", "Timeline"),
            Entry::Panel(Panel::Production) => tr!("observer.panelProduction", "Production"),
            Entry::Panel(Panel::ControlGroups) => {
                tr!("observer.panelControlGroups", "Control groups")
            }
            Entry::Panel(Panel::Selection) => tr!("observer.panelSelection", "Selection"),
            Entry::Panel(Panel::Minimap) => tr!("observer.panelMinimap", "Minimap"),
            Entry::Panel(Panel::Transport) => tr!("observer.panelTransport", "Transport"),
            Entry::Panel(Panel::Dock) => tr!("observer.panelDock", "Dock"),
            Entry::SpoilerFree => tr!("observer.spoilerFree", "Spoiler-free"),
        }
    }

    /// Whether this row is on.
    fn is_on(self, prefs: &PanelPrefs) -> bool {
        match self {
            Entry::Panel(panel) => prefs.shown(panel),
            Entry::SpoilerFree => prefs.spoiler_free,
        }
    }
}

/// The rows this game gets, in the shell's own panel order.
///
/// The dock itself is not on the list: a row that hid the surface it sits on could not be clicked
/// again, so the dock is reached by its key alone.
fn entries(mode: Mode, map_control_available: bool) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Panel::ALL
        .into_iter()
        .filter(|panel| *panel != Panel::Dock)
        // The transport plate only exists in a replay, so offering it while observing a live game
        // would be offering a switch with nothing behind it.
        .filter(|panel| *panel != Panel::Transport || mode == Mode::Replay)
        // The map-control bar reports a measurement the game does not keep, so a host with none
        // gets no row: a switch that turns nothing on is worse than no switch.
        .filter(|panel| *panel != Panel::MapControl || map_control_available)
        .map(Entry::Panel)
        .collect();
    if mode == Mode::Replay {
        entries.push(Entry::SpoilerFree);
    }
    entries
}

/// How tall the dock is with rows `row_height` tall, chrome included.
fn height(mode: Mode, map_control_available: bool, row_height: f32) -> f32 {
    let rows = entries(mode, map_control_available).len() as f32;
    tiers::PANEL_MARGIN_HEIGHT + CHEVRON_HEIGHT + rows * (ROW_GAP + row_height)
}

/// Where the dock goes on the right edge and how tall its rows are.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct DockPlacement {
    /// How far the dock's middle is from the screen's, downwards.
    pub offset_y: f32,
    pub row_height: f32,
    /// The run of the screen's height the dock covers.
    pub top: f32,
    pub bottom: f32,
}

impl DockPlacement {
    /// Where the dock goes between `top` and `bottom` on a screen whose middle is `middle`: on the
    /// middle where that leaves it inside the room, moved into the room where it does not, with its
    /// rows shortened where even the whole room is too short. `None` where the room is too short for
    /// the dock with its rows at their shortest.
    pub(crate) fn fit(
        mode: Mode,
        map_control_available: bool,
        middle: f32,
        top: f32,
        bottom: f32,
    ) -> Option<DockPlacement> {
        let room = bottom - top;
        let full = height(mode, map_control_available, ROW_HEIGHT);
        let row_height = if full <= room {
            ROW_HEIGHT
        } else {
            let rows = entries(mode, map_control_available).len() as f32;
            let fixed = height(mode, map_control_available, 0.0);
            let row = ((room - fixed) / rows).floor();
            if row < MIN_ROW_HEIGHT {
                return None;
            }
            row
        };
        let height = height(mode, map_control_available, row_height);
        let centre = middle.clamp(top + height * 0.5, (bottom - height * 0.5).max(top));
        Some(DockPlacement {
            offset_y: centre - middle,
            row_height,
            top: centre - height * 0.5,
            bottom: centre + height * 0.5,
        })
    }

    /// The dock at its full height on the middle of a screen `screen_height` tall, for a screen with
    /// no room to give it anything better.
    pub(crate) fn centred(
        mode: Mode,
        map_control_available: bool,
        screen_height: f32,
    ) -> DockPlacement {
        let height = height(mode, map_control_available, ROW_HEIGHT);
        DockPlacement {
            offset_y: 0.0,
            row_height: ROW_HEIGHT,
            top: (screen_height - height) * 0.5,
            bottom: (screen_height + height) * 0.5,
        }
    }
}

/// What the watcher asked of the dock this frame.
pub struct DockOutcome {
    /// Where the dock is on screen, for the host's hit testing.
    pub rect: Rect,
    /// A surface to turn on or off.
    pub toggled: Option<Panel>,
    /// Whether the replay's length should be withheld.
    pub spoiler_free: Option<bool>,
    /// Whether the dock should spell its rows out.
    pub expanded: Option<bool>,
}

impl DockOutcome {
    /// An outcome with nothing asked of it yet, waiting for its rect.
    fn none() -> DockOutcome {
        DockOutcome {
            rect: Rect::NOTHING,
            toggled: None,
            spoiler_free: None,
            expanded: None,
        }
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

/// Draws the dock against the right edge of the screen, fading and sliding it in and out. Returns
/// nothing at all once it is gone.
pub fn render_obs_dock(
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    ctx: &Context,
) -> Option<DockOutcome> {
    let id = Id::new("sb_obs_dock");
    let area = Area::new(id)
        .anchor(
            Align2::RIGHT_CENTER,
            vec2(-EDGE_MARGIN, dock.placement.offset_y),
        )
        .order(Order::Foreground);
    let width = if prefs.dock_expanded {
        EXPANDED_WIDTH
    } else {
        COLLAPSED_WIDTH
    };
    // The dock hangs off the screen's edge, so that is where it goes when hidden: it slides its
    // whole width out past the edge and comes back the same way, rather than fading where it
    // stands like a panel that belongs to the middle of the screen.
    let inner = motion::presence_area_along(
        ctx,
        id.with("presence"),
        prefs.dock,
        area,
        vec2(width + EDGE_MARGIN, 0.0),
        |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.set_width(tiers::panel_content_width(width));
                draw_dock(ui, prefs, dock)
            })
            .inner
        },
    )?;
    // The rail is the one surface allowed over the panels, being something the watcher has just
    // opened to read, so it is kept over whichever of them came on screen after it.
    ctx.move_to_top(inner.response.layer_id);
    let mut outcome = inner.inner;
    outcome.rect = inner.response.rect;
    Some(outcome)
}

/// What the dock has to say about whatever the pointer is resting on.
struct Hint {
    /// Where the pointer is, which is what the card hangs off.
    anchor: Pos2,
    /// What the row is, in the same words the rail spells out.
    title: String,
    /// The key that does the same thing without the pointer, for a row that has one.
    key: Option<String>,
    /// Whether the row's panel is wanted and has no room, which the card says in words.
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

/// How a row stands.
#[derive(Copy, Clone, PartialEq, Eq)]
enum RowState {
    Off,
    On,
    /// Wanted on screen, with no room for it on this one.
    Displaced,
}

fn draw_dock(ui: &mut Ui, prefs: &PanelPrefs, dock: &DockContext<'_>) -> DockOutcome {
    let hotkeys = dock.hotkeys;
    // The rows are stacked by the gaps written here and by nothing else: this is a fixed layout, and
    // egui's own spacing between items would add to every one of them.
    ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
    let mut outcome = DockOutcome::none();
    let content_width = ui.available_width();

    let dock_key = hotkeys
        .chord_for(Panel::Dock.action())
        .map(|chord| chord.key.symbol_or_name());
    let header = draw_header(ui, content_width, prefs.dock_expanded, dock_key);
    if header.clicked() {
        outcome.expanded = Some(!prefs.dock_expanded);
    }
    // The chevron is named in both forms, unlike the rows: what it does is the one thing the rail
    // spells out nothing about, and the arrow alone says which way without saying what.
    let chevron_title = match prefs.dock_expanded {
        true => tr!("observer.dockCollapse", "Collapse dock"),
        false => tr!("observer.dockExpand", "Expand dock"),
    };
    let mut hint = Hint::hovered(&header, chevron_title, None);

    for entry in entries(dock.mode, dock.map_control_available) {
        let key = hotkeys
            .chord_for(entry.action())
            .map(|chord| chord.key.symbol_or_name());
        let state = match entry {
            Entry::Panel(panel) if prefs.shown(panel) && dock.displaced.contains(&panel) => {
                RowState::Displaced
            }
            _ if entry.is_on(prefs) => RowState::On,
            _ => RowState::Off,
        };
        let response = draw_row(
            ui,
            vec2(content_width, dock.placement.row_height),
            prefs.dock_expanded,
            entry,
            key,
            state,
        );
        // Collapsed a row is a keycap and nothing else, so the card is what names it; expanded the
        // rail has already said everything the card would, bar a panel with no room, which nothing
        // else on screen explains.
        if !prefs.dock_expanded || state == RowState::Displaced {
            hint = hint.or_else(|| {
                Hint::hovered(&response, entry.label(), key).map(|hint| Hint {
                    displaced: state == RowState::Displaced,
                    ..hint
                })
            });
        }
        if !response.clicked() {
            continue;
        }
        match entry {
            Entry::Panel(panel) => outcome.toggled = Some(panel),
            Entry::SpoilerFree => outcome.spoiler_free = Some(!prefs.spoiler_free),
        }
    }

    if let Some(hint) = hint {
        draw_hint(ui, &hint);
    }
    outcome
}

/// Names what the pointer is resting on, and the key that reaches it without the pointer.
fn draw_hint(ui: &Ui, hint: &Hint) {
    widgets::tooltip(
        ui.ctx(),
        Id::new("sb_obs_dock").with("hint"),
        hint.anchor,
        |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, theme::SPACE_XS);
            ui.label(text::body(13.0, BodyWeight::Medium).job(&hint.title));
            if hint.displaced {
                ui.label(
                    text::body(12.0, BodyWeight::Regular)
                        .with_color(theme::TEXT_SECONDARY)
                        .job(&tr!("observer.dockNoRoom", "No room for it on this screen")),
                );
            }
            if let Some(key) = &hint.key {
                widgets::kbd(ui, key);
            }
        },
    );
}

/// Draws the dock's own row: what it is, the key that hides it, and the chevron that changes it
/// between its two forms. Clicking anywhere along the row is what makes that change.
///
/// Expanded there is room to name the dock and the key that takes it off screen, which is the one
/// thing a watcher cannot work out from the dock once it is gone. Collapsed, the chevron is all that
/// fits.
fn draw_header(ui: &mut Ui, width: f32, expanded: bool, key: Option<&str>) -> Response {
    let (rect, response) = ui.allocate_exact_size(vec2(width, CHEVRON_HEIGHT), Sense::click());
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    widgets::state_overlay(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    let arm = 4.0;
    let mut centre = rect.center();
    if expanded {
        centre.x = rect.right() - arm - theme::HAIRLINE;
        let key_rect = Rect::from_min_size(
            pos2(
                centre.x - arm - theme::SPACE_XS - KEY_WIDTH,
                rect.center().y - KEY_HEIGHT * 0.5,
            ),
            vec2(KEY_WIDTH, KEY_HEIGHT),
        );
        paint_key_chip(ui, key_rect, key, RowState::Off);
        paint_text(
            ui,
            Rect::from_min_max(
                rect.left_top(),
                pos2(key_rect.left() - ROW_GUTTER, rect.bottom()),
            ),
            &text::panel_title(),
            &Entry::Panel(Panel::Dock).label(),
            Align::LEFT,
        );
    }
    // Points at the edge the dock would move towards, so the control says what it does without a
    // word: left to open the rail out over the game, right to fold it back against the edge.
    let tip_x = if expanded {
        centre.x + arm
    } else {
        centre.x - arm
    };
    let back_x = if expanded {
        centre.x - arm
    } else {
        centre.x + arm
    };
    let stroke = Stroke::new(theme::HAIRLINE + 0.4, color);
    ui.painter().add(Shape::line(
        vec![
            pos2(back_x, centre.y - arm),
            pos2(tip_x, centre.y),
            pos2(back_x, centre.y + arm),
        ],
        stroke,
    ));
    response
}

/// Draws one row, returning what the pointer did to it.
fn draw_row(
    ui: &mut Ui,
    size: Vec2,
    expanded: bool,
    entry: Entry,
    key: Option<&str>,
    state: RowState,
) -> Response {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    let on = state == RowState::On;
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    if on && expanded {
        ui.painter()
            .rect_filled(rect, corner_radius, theme::alpha(theme::ACCENT, 0.10));
    }
    widgets::state_overlay(ui, &response, rect, corner_radius);

    // Collapsed, the keycap is the whole row: there is no room for a name, and a watcher reading a
    // strip of keys is reading the same table the rail spells out.
    if !expanded {
        // Square, and as wide as the dock lets it be: collapsed there is nothing else in the row,
        // so the keycap is the row.
        paint_key_chip(
            ui,
            centred(rect, rect.width().min(rect.height())),
            key,
            state,
        );
        return response;
    }

    let lamp = Rect::from_min_size(
        pos2(rect.left(), rect.center().y - LAMP * 0.5),
        vec2(LAMP, LAMP),
    );
    paint_lamp(ui, lamp, state);
    let key_rect = Rect::from_min_size(
        pos2(rect.right() - KEY_WIDTH, rect.center().y - KEY_HEIGHT * 0.5),
        vec2(KEY_WIDTH, KEY_HEIGHT),
    );
    paint_key_chip(ui, key_rect, key, state);
    let label = Rect::from_min_max(
        pos2(lamp.right() + ROW_GUTTER, rect.top()),
        pos2(key_rect.left() - ROW_GUTTER, rect.bottom()),
    );
    let color = match state {
        RowState::On => theme::TEXT_PRIMARY,
        RowState::Displaced => theme::TEXT_SECONDARY,
        RowState::Off => theme::TEXT_DIM,
    };
    paint_text(
        ui,
        label,
        &text::body(13.0, BodyWeight::Medium).with_color(color),
        &entry.label(),
        Align::LEFT,
    );
    response
}

/// Draws the lamp that says whether a surface is on screen: filled when it is, an empty ring when it
/// is not, so the two states differ in shape as well as in brightness. A surface wanted but with no
/// room is a ring in the accent: asked for, like a lit lamp, and not there, like an unlit one.
fn paint_lamp(ui: &Ui, rect: Rect, state: RowState) {
    let centre = rect.center();
    let radius = rect.width() * 0.5;
    let ring = |color| {
        ui.painter().circle_stroke(
            centre,
            radius - theme::HAIRLINE * 0.5,
            Stroke::new(theme::HAIRLINE, color),
        );
    };
    match state {
        RowState::On => {
            ui.painter().circle_filled(centre, radius, theme::ACCENT);
        }
        RowState::Displaced => ring(theme::ACCENT),
        RowState::Off => ring(theme::TEXT_LABEL),
    }
}

/// Draws the keycap chip for a row, lit while the surface it opens is on screen, and unlit but
/// edged in the accent while it is wanted with no room for it.
fn paint_key_chip(ui: &Ui, rect: Rect, key: Option<&str>, state: RowState) {
    let Some(key) = key else {
        return;
    };
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    // A lit keycap is filled in the overlay's own blue rather than tinted: the dock is read at a
    // glance from the edge of the screen, and a tint is not a state anyone reads from there.
    let (fill, edge, color) = match state {
        RowState::On => (
            theme::alpha(crate::colors::BLUE60, 0.40),
            theme::alpha(crate::colors::BLUE80, 0.45),
            theme::TEXT_PRIMARY,
        ),
        RowState::Displaced => (
            theme::alpha(crate::colors::GREY_BLUE10, 0.60),
            theme::alpha(theme::ACCENT, 0.70),
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
    paint_text(
        ui,
        rect,
        &text::body(11.0, BodyWeight::Medium).with_color(color),
        key,
        Align::Center,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placed(prefs: &PanelPrefs, placement: DockPlacement) -> Option<Rect> {
        let hotkeys = Hotkeys::defaults();
        crate::observer::test_support::settled_rect(|ctx| {
            render_obs_dock(
                prefs,
                &DockContext {
                    hotkeys: &hotkeys,
                    mode: Mode::Replay,
                    map_control_available: false,
                    placement,
                    displaced: &[],
                },
                ctx,
            )
            .map(|outcome| outcome.rect)
        })
    }

    #[test]
    fn the_dock_is_drawn_where_it_was_placed() {
        let prefs = PanelPrefs::default();
        let middle = DockPlacement::centred(Mode::Replay, false, 1080.0);
        let rect = placed(&prefs, middle).expect("the dock is drawn");
        assert_eq!(rect.top(), middle.top);
        assert_eq!(rect.bottom(), middle.bottom);

        // Short of room, the rows give up height and the dock moves into the room it has.
        let squeezed = DockPlacement::fit(Mode::Replay, false, 540.0, 600.0, 1060.0).unwrap();
        assert!(squeezed.row_height < ROW_HEIGHT);
        let rect = placed(&prefs, squeezed).expect("the dock is drawn");
        assert!(rect.top() >= 600.0 - 0.5 && rect.bottom() <= 1060.0 + 0.5);
        assert_eq!(rect.height(), squeezed.bottom - squeezed.top);
    }

    #[test]
    fn the_dock_keeps_the_middle_while_it_fits_there() {
        let placement = DockPlacement::fit(Mode::Replay, false, 540.0, 16.0, 1064.0).unwrap();
        assert_eq!(placement.offset_y, 0.0);
        assert_eq!(placement.row_height, ROW_HEIGHT);
        // Under a bar that reaches into its column it moves down, without shrinking.
        let placement = DockPlacement::fit(Mode::Replay, false, 360.0, 98.0, 704.0).unwrap();
        assert!(placement.top >= 98.0);
        assert_eq!(placement.row_height, ROW_HEIGHT);
        // With no room even for its shortest rows it has no place at all.
        assert!(DockPlacement::fit(Mode::Replay, false, 360.0, 300.0, 500.0).is_none());
    }
}
