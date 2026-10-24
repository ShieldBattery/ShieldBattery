//! The observer dock: the one place a watcher can see what they are being shown and change it
//! without knowing a key.
//!
//! It hangs off the right edge of the screen at the kit's ambient tier, in two forms of the same
//! list. **Collapsed** it is a strip of keycaps, one per surface, lit for the ones that are on — a
//! reminder for someone who already knows the keys, taking as little of the screen as a control can.
//! **Expanded** it is the control rail: the same list with its names spelled out, for someone who
//! does not.
//!
//! The list is the shell's panel table rather than a list of its own, so the dock offers exactly the
//! surfaces the shell can toggle.
//!
//! It stands on whatever holds the bottom of the right edge, the playback controls in the corner or
//! the selection panel at the end of the bottom row or else the bottom edge itself, rather than on
//! the middle of the screen: the surfaces above it come and go with the watcher's keys, and a dock
//! placed against them would move every time one reached a little further down its column. Only a
//! surface that reaches the dock itself moves anything, and on a screen too short for it the rows
//! give up some of their height.
//!
//! A panel the watcher wants on screen but the screen has no room for is a row of its own kind: on,
//! and not on screen. Its lamp is a ring in the accent rather than a filled dot, so the dock never
//! claims a panel is up that the watcher cannot find.

use egui::emath::GuiRounding;
use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Pos2, Rect, Response, Sense, Shape, Stroke,
    StrokeKind, Ui, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::widgets;
use crate::kit::{motion, theme, tiers};
use crate::observer::{centred, paint_text};
use crate::shell::{Hotkeys, MatchupStyle, Mode, Panel, PanelPrefs};
use crate::tr;

/// How wide the dock is collapsed, in overlay points.
pub(crate) const COLLAPSED_WIDTH: f32 = 52.0;

/// How wide it is as the control rail.
const EXPANDED_WIDTH: f32 = 216.0;

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
pub(crate) const ROW_HEIGHT: f32 = theme::HIT_PANEL;

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

/// How far past an expanded row's contents its wash and hover reach into the panel's padding, so
/// the lamp and keycap at its ends sit inside the wash rather than on its edge.
const ROW_WASH_BLEED: f32 = 6.0;

/// What `panel`'s row is called when there is room to spell it out.
fn row_label(panel: Panel) -> String {
    match panel {
        Panel::Matchup => tr!("observer.panelMatchup", "Matchup"),
        Panel::MapControl => tr!("observer.mapControl", "Map control"),
        Panel::Economy => tr!("observer.panelEconomy", "Economy"),
        Panel::Military => tr!("observer.panelMilitary", "Military"),
        Panel::Graphs => tr!("observer.panelGraphs", "Graphs"),
        Panel::Timeline => tr!("observer.panelTimeline", "Timeline"),
        Panel::Production => tr!("observer.panelProduction", "Production"),
        Panel::ControlGroups => tr!("observer.panelControlGroups", "Control groups"),
        Panel::Selection => tr!("observer.panelSelection", "Selection"),
        Panel::Minimap => tr!("observer.panelMinimap", "Minimap"),
        Panel::PlaybackControls => tr!("observer.panelPlayback", "Playback"),
        Panel::Dock => tr!("observer.panelDock", "Dock"),
    }
}

/// What a style of the matchup is called, on the card naming the chip that picks it.
fn matchup_style_label(style: MatchupStyle) -> String {
    match style {
        MatchupStyle::Bar => tr!("observer.matchupBar", "Bar along the top"),
        MatchupStyle::Compact => tr!("observer.matchupCompact", "Compact, in the corner"),
        MatchupStyle::Off => tr!("observer.matchupOff", "Hidden"),
    }
}

/// The rows this game gets, in the shell's own panel order.
///
/// The dock itself is not on the list: a row that hid the surface it sits on could not be clicked
/// again, so the dock is reached by its key alone. Spoiler-free is not either: it is a way of
/// watching rather than a surface, and the playback controls carry its switch.
fn entries(mode: Mode, map_control_available: bool) -> Vec<Panel> {
    Panel::ALL
        .into_iter()
        .filter(|panel| *panel != Panel::Dock)
        // The playback controls only exist in a replay, so offering it while observing a live game
        // would be offering a switch with nothing behind it.
        .filter(|panel| *panel != Panel::PlaybackControls || mode == Mode::Replay)
        // A host with no map-control reading gets no row for the bar: a switch that turns nothing
        // on is worse than no switch.
        .filter(|panel| *panel != Panel::MapControl || map_control_available)
        .collect()
}

/// How tall the dock is with rows `row_height` tall, chrome included.
/// How tall the dock is with its rows at their full height.
pub(crate) fn full_height(mode: Mode, map_control_available: bool) -> f32 {
    height(mode, map_control_available, ROW_HEIGHT)
}

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
    /// Where the dock goes between `top` and `bottom` on a screen whose middle is `middle`: standing
    /// on `bottom`, with its rows shortened where the whole room is too short. `None` where the room
    /// is too short for the dock with its rows at their shortest.
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
        let centre = bottom - height * 0.5;
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
    /// How the matchup should be on screen.
    pub matchup_style: Option<MatchupStyle>,
    /// Whether the dock should spell its rows out.
    pub expanded: Option<bool>,
}

impl DockOutcome {
    /// An outcome with nothing asked of it yet, waiting for its rect.
    fn none() -> DockOutcome {
        DockOutcome {
            rect: Rect::NOTHING,
            toggled: None,
            matchup_style: None,
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
    // The dock opens like a drawer: its right edge stays against the screen's while its width eases
    // between the two forms, and the spelled-out rows are uncovered from the right as it widens.
    let width = ctx.animate_value_with_time(
        id.with("width"),
        if prefs.dock_expanded {
            EXPANDED_WIDTH
        } else {
            COLLAPSED_WIDTH
        },
        theme::MOTION_PANEL_SECS,
    );
    // Placed by its left edge, worked out here from this frame's width, rather than anchored by
    // its right: an anchored area is placed from the size it had the frame before, which for the
    // frame the width changes puts the dock's contents out past its edge.
    let screen = ctx.viewport_rect();
    let area = Area::new(id)
        .pivot(Align2::LEFT_CENTER)
        .fixed_pos(pos2(
            screen.right() - EDGE_MARGIN - width,
            screen.center().y + dock.placement.offset_y,
        ))
        .order(Order::Foreground);
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
                draw_dock(ui, prefs, dock, width > COLLAPSED_WIDTH + 0.5)
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

/// Draws the dock's rows, `spelled` out as the rail while the dock is any wider than its strip of
/// keys.
///
/// Spelled out, a row is always laid out at the rail's full width against the dock's right edge and
/// clipped to the dock as it stands, so a dock partway through opening or closing shows the rail
/// cut off at its left rather than squeezed into the room it has.
fn draw_dock(
    ui: &mut Ui,
    prefs: &PanelPrefs,
    dock: &DockContext<'_>,
    spelled: bool,
) -> DockOutcome {
    let hotkeys = dock.hotkeys;
    // The rows are stacked by the gaps written here and by nothing else: this is a fixed layout, and
    // egui's own spacing between items would add to every one of them.
    ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
    let mut outcome = DockOutcome::none();
    let content_width = ui.available_width();
    let row_width = match spelled {
        true => tiers::panel_content_width(EXPANDED_WIDTH),
        false => content_width,
    };
    let content = ui.max_rect();
    ui.set_clip_rect(
        ui.clip_rect().intersect(
            content
                .with_min_x(content.left() - ROW_WASH_BLEED)
                .with_max_x(content.right() + ROW_WASH_BLEED),
        ),
    );
    // A row's own rect: its slot in the stack, widened out to the left to the rail's width.
    let row = |ui: &mut Ui, height: f32| {
        let (slot, _) = ui.allocate_exact_size(vec2(content_width, height), Sense::hover());
        Rect::from_min_max(
            pos2(slot.right() - row_width, slot.top()),
            slot.right_bottom(),
        )
    };

    let dock_key = hotkeys.bare_key(Panel::Dock.action());
    let header_rect = row(ui, CHEVRON_HEIGHT);
    let header = draw_header(ui, header_rect, spelled, prefs.dock_expanded, dock_key);
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

    for panel in entries(dock.mode, dock.map_control_available) {
        let key = hotkeys.bare_key(panel.action());
        let state = if !prefs.shown(panel) {
            RowState::Off
        } else if dock.displaced.contains(&panel) {
            RowState::Displaced
        } else {
            RowState::On
        };
        let rect = row(ui, dock.placement.row_height);
        // The matchup's style is picked on its own row, where the rail has room for it.
        let style_chips =
            (spelled && panel == Panel::Matchup).then(|| matchup_style_chips_rect(rect));
        let reserved = style_chips.map_or(0.0, |chips| chips.width() + ROW_GUTTER);
        let response = draw_row(ui, rect, spelled, panel, key, state, reserved);
        if let Some(chips) = style_chips {
            let (picked, chip_hint) = draw_matchup_style_chips(ui, chips, prefs.matchup_style());
            if picked.is_some() {
                outcome.matchup_style = picked;
            }
            hint = hint.or(chip_hint);
        }
        // Collapsed a row is a keycap and nothing else, so the card is what names it; expanded the
        // rail has already said everything the card would, bar a panel with no room, which nothing
        // else on screen explains.
        if !prefs.dock_expanded || state == RowState::Displaced {
            hint = hint.or_else(|| {
                Hint::hovered(&response, row_label(panel), key).map(|hint| Hint {
                    displaced: state == RowState::Displaced,
                    ..hint
                })
            });
        }
        if response.clicked() {
            outcome.toggled = Some(panel);
        }
    }

    if let Some(hint) = hint {
        draw_hint(ui, &hint);
    }
    outcome
}

/// Side of one of the chips the matchup's style is picked with, which is a keycap's height, and the
/// gap between two of them.
const STYLE_CHIP: f32 = KEY_HEIGHT;
const STYLE_CHIP_GAP: f32 = 3.0;

/// Size of the picture of the screen on a style chip.
const STYLE_PICTURE: egui::Vec2 = vec2(14.0, 10.0);

/// Where the chips the matchup's style is picked with go in the matchup's row: just ahead of its
/// keycap.
fn matchup_style_chips_rect(row: Rect) -> Rect {
    let count = MatchupStyle::ALL.len() as f32;
    let width = STYLE_CHIP * count + STYLE_CHIP_GAP * (count - 1.0);
    let right = row.right() - KEY_WIDTH - ROW_GUTTER;
    Rect::from_min_max(
        pos2(right - width, row.center().y - STYLE_CHIP * 0.5),
        pos2(right, row.center().y + STYLE_CHIP * 0.5),
    )
}

/// Draws the chips the matchup's style is picked with, side by side in `rect`, the one on screen
/// lit as a keycap is. Returns the style picked, if one was, and the card naming a chip the pointer
/// is resting on, since a picture that small says where without saying what.
///
/// The row around the chips shows and hides the matchup as every row does its surface; the chips
/// are the one place all three ways it can be are offered at once.
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
            egui::Vec2::splat(STYLE_CHIP),
        );
        let response = ui.interact(
            chip,
            ui.id().with(("sb_dock_matchup_style", index)),
            Sense::click(),
        );
        let lit = style == current;
        let (fill, edge, color) = if lit {
            (
                theme::alpha(crate::colors::BLUE60, 0.40),
                theme::alpha(crate::colors::BLUE80, 0.45),
                theme::TEXT_PRIMARY,
            )
        } else {
            (
                theme::alpha(crate::colors::GREY_BLUE10, 0.60),
                theme::CHIP_STROKE,
                theme::TEXT_DIM,
            )
        };
        ui.painter().rect_filled(chip, corner_radius, fill);
        ui.painter().add(Shape::rect_stroke(
            chip,
            corner_radius,
            Stroke::new(theme::HAIRLINE, edge),
            StrokeKind::Inside,
        ));
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
fn paint_style_picture(painter: &egui::Painter, chip: Rect, style: MatchupStyle, color: Color32) {
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
fn draw_hint(ui: &Ui, hint: &Hint) {
    widgets::tooltip(
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

/// Draws the dock's own row: what it is, the key that hides it, and the chevron that changes it
/// between its two forms. Clicking anywhere along the row is what makes that change.
///
/// Expanded there is room to name the dock and the key that takes it off screen, which is the one
/// thing a watcher cannot work out from the dock once it is gone. Collapsed, the chevron is all that
/// fits.
fn draw_header(
    ui: &mut Ui,
    rect: Rect,
    spelled: bool,
    expanded: bool,
    key: Option<&str>,
) -> Response {
    let response = ui.interact(rect, ui.id().with("sb_dock_header"), Sense::click());
    let corner_radius = theme::radius(theme::RADIUS_TIGHT);
    widgets::state_overlay(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        theme::TEXT_DIM
    };
    let arm = 4.0;
    let mut centre = rect.center();
    if spelled {
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
            &row_label(Panel::Dock),
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

/// Draws one row in `rect`, returning what the pointer did to it. Spelled out, the name gives up
/// `reserved` of its room ahead of the keycap, for a control the caller puts there.
fn draw_row(
    ui: &mut Ui,
    rect: Rect,
    expanded: bool,
    panel: Panel,
    key: Option<&str>,
    state: RowState,
    reserved: f32,
) -> Response {
    let on = state == RowState::On;
    let (wash, corner_radius) = match expanded {
        true => (
            rect.expand2(vec2(ROW_WASH_BLEED, 0.0)),
            theme::radius(theme::RADIUS_PANEL),
        ),
        false => (rect, theme::radius(theme::RADIUS_TIGHT)),
    };
    let response = ui.interact(
        wash,
        ui.id().with(("sb_dock_row", panel.label())),
        Sense::click(),
    );
    if on && expanded {
        ui.painter()
            .rect_filled(wash, corner_radius, theme::alpha(theme::ACCENT, 0.10));
    }
    widgets::state_overlay(ui, &response, wash, corner_radius);

    // Collapsed, the keycap is the whole row: there is no room for a name, and a watcher reading a
    // strip of keys is reading the same table the rail spells out.
    if !expanded {
        // Square, and as wide as the dock lets it be.
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
        pos2(key_rect.left() - ROW_GUTTER - reserved, rect.bottom()),
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
        &row_label(panel),
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

    /// The dock's keycaps, and the panel headers that share them, each have room for one key: a
    /// surface whose only bindings take a modifier would be left with a blank keycap.
    #[test]
    fn every_row_and_the_dock_itself_have_a_key_of_their_own() {
        let hotkeys = Hotkeys::defaults();
        let actions = entries(Mode::Replay, true)
            .into_iter()
            .map(Panel::action)
            .chain([Panel::Dock.action()]);
        for action in actions {
            assert!(
                hotkeys.bare_key(action).is_some(),
                "{action:?} has no key that works on its own"
            );
        }
    }

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
        let bottom = 600.0 + full_height(Mode::Replay, false) - 20.0;
        let squeezed = DockPlacement::fit(Mode::Replay, false, 540.0, 600.0, bottom).unwrap();
        assert!(squeezed.row_height < ROW_HEIGHT);
        let rect = placed(&prefs, squeezed).expect("the dock is drawn");
        assert!(rect.top() >= 600.0 - 0.5 && rect.bottom() <= bottom + 0.5);
        assert_eq!(rect.height(), squeezed.bottom - squeezed.top);
    }

    #[test]
    fn the_dock_stands_on_the_bottom_of_its_room() {
        let placement = DockPlacement::fit(Mode::Replay, false, 540.0, 16.0, 1064.0).unwrap();
        assert_eq!(placement.bottom, 1064.0);
        assert_eq!(placement.row_height, ROW_HEIGHT);
        assert_eq!(
            placement.offset_y,
            (placement.top + placement.bottom) * 0.5 - 540.0
        );
        // A surface above that reaches further down its column moves nothing while the dock fits.
        let under_graphs = DockPlacement::fit(Mode::Replay, false, 540.0, 400.0, 1064.0).unwrap();
        assert_eq!(under_graphs, placement);
        // With no room even for its shortest rows it has no place at all.
        assert!(DockPlacement::fit(Mode::Replay, false, 360.0, 300.0, 500.0).is_none());
    }
}
