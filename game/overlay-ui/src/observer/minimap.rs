//! The frame around BW's minimap for a watcher, and the strip along its top that carries what SC:R's
//! own buttons there did.
//!
//! A watcher keeps the minimap and nothing else of the game's console, which leaves the map square
//! sitting loose in the corner of a screen full of the overlay's own panels. The frame is what makes
//! it one of them: the ambient tier's band around the square, and a slim header strip above it in
//! the same chrome. The square itself is never drawn over or taken from the game: every click on it
//! is BW's, which is what a click on a minimap is for.
//!
//! SC:R puts two buttons above the minimap in a replay, one for whose vision the game is shown
//! through and one for its menu. The host hides those for a watcher, and the header carries the
//! same two in the overlay's own controls: a vision button opening an entire-map switch and a list
//! of players with a switch each, which asks exactly what a click on a half of the matchup bar asks,
//! and a menu button, which asks the host to open the game's menu the way its own key does. The
//! stretch of the header between them is kept clear for the game's clock.
//!
//! A game the host has recorded its players' perspectives for gets a row of its own above the
//! header, in the same chrome, for whose perspective the game is shown from and how (see
//! [`super::perspective`]): a dropdown of the players, which names the shown one in their color so
//! the frame says whose eyes the watcher is behind without a menu being opened, and two toggles at
//! its right end for following their camera and for showing their selection and clicks. A game
//! without perspectives has no row, and its frame is the header and the band alone.
//!
//! The frame follows the minimap wherever the game puts it, being drawn from the square the host
//! reports, and comes and goes with it.
//!
//! Its band runs on below the square to the screen's bottom edge. The view may scroll past the
//! map's bottom edge, to keep the map's last rows clear of the panels along the bottom, and the
//! game then draws the bottom of its screen box past the map's too: a band of a fixed depth hid
//! that line while the box reached into it and showed it again once the box reached past it, where
//! a band to the edge hides it however far the view goes.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Mesh, Order, Pos2, Rect, Response, Sense, Shape,
    Stroke, StrokeKind, Ui, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::{motion, symbols, theme, tiers, widgets};
use crate::observer::{
    ObserverView, PLAYER_SWATCH, PerspectiveView, paint_player_swatch_in, paint_text,
    teams_worth_dividing,
};
use crate::tr;

/// How far the frame's band reaches out around the minimap's square.
pub(crate) const FRAME_PAD: f32 = 4.0;

/// Height of the header strip above the square.
pub(crate) const HEADER_HEIGHT: f32 = 28.0;

/// Height of the row above the header that chooses whose perspective the game is shown from, and
/// of the controls in it. Both a little taller than the header and its buttons: the row's dropdown
/// runs most of the width of the frame, and a strip that long at a button's height pinches its
/// text. The toggles beside it are squares of the controls' height.
pub(crate) const PERSPECTIVE_ROW_HEIGHT: f32 = 32.0;
const PERSPECTIVE_BUTTON_HEIGHT: f32 = 24.0;

/// Gap between two of the perspective row's controls.
const PERSPECTIVE_CONTROL_GAP: f32 = theme::SPACE_XS;

/// Side of the glyph on one of the perspective row's toggles.
const PERSPECTIVE_GLYPH: f32 = 16.0;

/// Size of the chevron at the dropdown's right end, and the gap between it and what is left of it.
const CHEVRON: egui::Vec2 = vec2(9.0, 5.0);
const CHEVRON_GAP: f32 = theme::SPACE_SM;

/// Height of a button in the header, and the room either side of its label.
const BUTTON_HEIGHT: f32 = 20.0;
const BUTTON_PAD: f32 = theme::SPACE_SM;

/// The narrowest a header button is, so a short translation still makes a target worth aiming at.
const BUTTON_MIN_WIDTH: f32 = 52.0;

/// Text size of a header button's label.
const BUTTON_TEXT_SIZE: f32 = 12.0;

/// How wide the list of players is, and the height of one of its rows.
const PICKER_WIDTH: f32 = 236.0;
const PICKER_ROW: f32 = theme::HIT_PANEL;

/// Width of the column the square of a player's color at the head of their row stands in, and the
/// gap after it.
const PICKER_BAR: f32 = PLAYER_SWATCH;
const PICKER_BAR_GAP: f32 = 8.0;

/// Text size of a player's name in the list.
const PICKER_NAME_SIZE: f32 = 15.0;

/// Gap between a list and the top of the frame it opens from.
const PICKER_GAP: f32 = 6.0;

/// Gap between the square of the shown player's color on the dropdown and their name.
const PERSPECTIVE_SWATCH_GAP: f32 = 6.0;

/// How thick the bar draining along the dropdown's bottom edge is.
const RETURN_BAR_HEIGHT: f32 = 2.0;

/// How strongly the dropdown's lit edge is drawn while that bar drains along it.
const RETURNING_EDGE_ALPHA: f32 = 0.35;

/// How much of the screen the frame takes around a minimap at `square`: the band around the square,
/// run on down to the screen's bottom edge, the header above it, and the perspective row above that
/// where the game has one (`perspective_row`), kept on the screen.
///
/// What the surfaces placed around the minimap keep clear of, whether or not the frame is drawn, so
/// a watcher hiding the minimap does not find the panels moving into its corner.
pub(crate) fn footprint(screen: Rect, square: Rect, perspective_row: bool) -> Rect {
    let band = square.expand(FRAME_PAD);
    let row = if perspective_row {
        PERSPECTIVE_ROW_HEIGHT
    } else {
        0.0
    };
    Rect::from_min_max(
        pos2(band.left(), band.top() - HEADER_HEIGHT - row),
        pos2(band.right(), band.bottom().max(screen.bottom())),
    )
    .intersect(screen)
}

/// The keys that do what the frame's controls do, as the keycaps the card under the pointer shows.
#[derive(Copy, Clone, Default)]
pub struct MinimapKeys<'a> {
    /// The key that opens the list of players.
    pub vision: &'a [&'a str],
    /// The key that steps through the perspectives the host has recorded.
    pub perspective: &'a [&'a str],
    /// The key that opens the game's menu.
    pub menu: &'a [&'a str],
}

/// Which of the lists hanging over the top of the frame is open. One at a time, since both hang in
/// the same place.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MinimapPopover {
    /// The players whose vision the game is shown through, opened by the vision button.
    Vision,
    /// The menu of the perspectives the host has recorded, opened by the perspective row's
    /// dropdown.
    Perspective,
}

/// What the watcher asked of the frame this frame.
pub struct MinimapFrameOutcome {
    /// The rects of the frame that take the pointer: the header, the perspective row where there is
    /// one, and the open list while there is one. The band around the square takes none, so a click
    /// on the map's own edge is the map's.
    pub rects: Vec<Rect>,
    /// The player whose vision was asked to change, if one was switched.
    pub toggled_vision: Option<u8>,
    /// The entire-map setting requested by the watcher, if its switch changed.
    pub show_entire_map: Option<bool>,
    /// The perspective asked to be shown, by its index among the recorded ones, or `Some(None)` to
    /// be shown none, if one was picked from the menu.
    pub show_perspective: Option<Option<u8>>,
    /// Whether the shown player's camera is asked to be followed, if its toggle was pressed.
    pub perspective_camera: Option<bool>,
    /// Whether the shown player's selection and clicks are asked to be shown, if their toggle was
    /// pressed.
    pub perspective_actions: Option<bool>,
    /// Whether the menu button was pressed.
    pub open_menu: bool,
    /// Which list is to be open next frame.
    pub popover: Option<MinimapPopover>,
}

/// Draws the frame around a minimap at `square`, fading it in and out with the minimap, with the
/// list `open` hanging above it, and a card naming the control under the pointer and its key from
/// `keys`. Returns nothing at all once it is gone.
pub fn render_minimap_frame(
    ctx: &Context,
    square: Rect,
    shown: bool,
    view: &ObserverView,
    open: Option<MinimapPopover>,
    keys: MinimapKeys,
) -> Option<MinimapFrameOutcome> {
    let screen = ctx.viewport_rect();
    let perspectives = view.perspectives();
    let outer = footprint(screen, square, perspectives.is_some());
    let row = perspectives.map(|_| {
        Rect::from_min_size(
            outer.left_top(),
            vec2(outer.width(), PERSPECTIVE_ROW_HEIGHT),
        )
    });
    let header_top = row.map_or(outer.top(), |row| row.bottom());
    let header = Rect::from_min_max(
        pos2(outer.left(), header_top),
        pos2(outer.right(), header_top + HEADER_HEIGHT),
    );
    let id = Id::new("sb_minimap_frame");
    let area = Area::new(id)
        .fixed_pos(outer.left_top())
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        paint_frame(ui, outer, square, row, header);
        let (vision, menu) = draw_header(ui, header, open == Some(MinimapPopover::Vision));
        let perspective = row.zip(perspectives).map(|(row, perspectives)| {
            draw_perspective_row(
                ui,
                row,
                perspectives,
                open == Some(MinimapPopover::Perspective),
            )
        });
        (vision, perspective, menu)
    })?;
    let (vision, perspective, menu) = inner.inner;
    // An open list already says what its control is for, and covers where the control's card goes.
    if vision.hovered() && open != Some(MinimapPopover::Vision) {
        draw_hint(
            ctx,
            &vision,
            &tr!("observer.minimapVisionHint", "Player vision"),
            keys.vision,
        );
    } else if menu.hovered() {
        draw_hint(
            ctx,
            &menu,
            &tr!("observer.minimapMenuHint", "Game menu"),
            keys.menu,
        );
    } else if let Some(row) = &perspective {
        if row.dropdown.hovered() && open != Some(MinimapPopover::Perspective) {
            draw_hint(ctx, &row.dropdown, &perspective_title(), keys.perspective);
        } else if row.camera.hovered() {
            draw_hint(ctx, &row.camera, &camera_title(), &[]);
        } else if row.actions.hovered() {
            draw_hint(ctx, &row.actions, &actions_title(), &[]);
        }
    }
    let toggled = |popover: Option<MinimapPopover>, list: MinimapPopover| {
        (popover != Some(list)).then_some(list)
    };
    let mut popover = open;
    if vision.clicked() {
        popover = toggled(popover, MinimapPopover::Vision);
    }
    if perspective
        .as_ref()
        .is_some_and(|row| row.dropdown.clicked())
    {
        popover = toggled(popover, MinimapPopover::Perspective);
    }
    // A game with no perspectives has no menu of them to keep open.
    if perspectives.is_none() && popover == Some(MinimapPopover::Perspective) {
        popover = None;
    }
    let mut outcome = MinimapFrameOutcome {
        rects: vec![header],
        toggled_vision: None,
        show_entire_map: None,
        show_perspective: None,
        perspective_camera: None,
        perspective_actions: None,
        open_menu: menu.clicked(),
        popover,
    };
    outcome.rects.extend(row);
    if let Some((row, perspectives)) = perspective.as_ref().zip(perspectives) {
        if row.camera.clicked() {
            outcome.perspective_camera = Some(!perspectives.camera);
        }
        if row.actions.clicked() {
            outcome.perspective_actions = Some(!perspectives.actions);
        }
    }
    if !shown {
        return Some(outcome);
    }
    // Both lists hang from the frame's top edge, lined up with its left one, so the one that opens
    // in place of the other comes up where the other was and neither covers the frame's controls.
    let anchor = pos2(outer.left() + FRAME_PAD, outer.top() - PICKER_GAP);
    let drawn = match (open, perspectives, &perspective) {
        (Some(MinimapPopover::Vision), _, _) => {
            Some((draw_picker(ctx, anchor, view, &mut outcome), vision.rect))
        }
        (Some(MinimapPopover::Perspective), Some(perspectives), Some(row)) => {
            let (menu, picked) = draw_perspective_menu(ctx, anchor, perspectives);
            if let Some(picked) = picked {
                outcome.show_perspective = Some(picked);
                if outcome.popover == open {
                    outcome.popover = None;
                }
            }
            Some((menu, row.dropdown.rect))
        }
        _ => None,
    };
    if let Some((list, control)) = drawn {
        // A press anywhere but on the list and the control that opened it closes the list, the way
        // any popover closes: the watcher has moved on to something else. A press that opened the
        // other list has already said what is open next.
        let pressed_elsewhere = ctx.input(|input| {
            input.pointer.any_pressed()
                && input
                    .pointer
                    .interact_pos()
                    .is_some_and(|pos| !list.contains(pos) && !control.contains(pos))
        });
        if pressed_elsewhere && outcome.popover == open {
            outcome.popover = None;
        }
        outcome.rects.push(list);
    }
    Some(outcome)
}

/// What the perspective row's dropdown says while nobody's perspective is shown, and what its card
/// calls it: what the row is for.
fn perspective_title() -> String {
    tr!("observer.minimapPerspective", "Player view")
}

/// What the camera toggle's card calls it.
fn camera_title() -> String {
    tr!("observer.perspectiveCamera", "Follow camera")
}

/// What the selection and clicks toggle's card calls it.
fn actions_title() -> String {
    tr!("observer.perspectiveActions", "Selection and clicks")
}

/// Paints the frame's chrome: the band around the square, the strips above it (the perspective
/// `row` where there is one, and the header), and the edge around them all, leaving the square
/// itself clear for the game's own map.
fn paint_frame(ui: &Ui, outer: Rect, square: Rect, row: Option<Rect>, header: Rect) {
    let painter = ui.painter();
    // The band is four strips meeting at shared edges in one mesh rather than shapes laid over each
    // other: the fill is translucent, so an overlap would read as a darker seam.
    let mut band = Mesh::default();
    for strip in [
        Rect::from_min_max(
            pos2(outer.left(), header.bottom()),
            pos2(outer.right(), square.top()),
        ),
        Rect::from_min_max(
            pos2(outer.left(), square.top()),
            pos2(square.left(), square.bottom()),
        ),
        Rect::from_min_max(
            pos2(square.right(), square.top()),
            pos2(outer.right(), square.bottom()),
        ),
        Rect::from_min_max(
            pos2(outer.left(), square.bottom()),
            pos2(outer.right(), outer.bottom()),
        ),
    ] {
        if strip.is_positive() {
            band.add_colored_rect(strip, theme::TIER0_FILL);
        }
    }
    painter.add(Shape::mesh(band));
    let corner_radius = theme::radius(theme::RADIUS_PANEL);
    // The strips above the band are one fill, the frame's top corners rounded on whichever is
    // uppermost.
    painter.rect_filled(
        Rect::from_min_max(outer.left_top(), pos2(outer.right(), header.bottom())),
        egui::CornerRadius {
            nw: corner_radius.nw,
            ne: corner_radius.ne,
            sw: 0,
            se: 0,
        },
        theme::TIER0_FILL,
    );
    for divider in row.iter().chain([&header]) {
        painter.add(Shape::line_segment(
            [
                pos2(divider.left(), divider.bottom()),
                pos2(divider.right(), divider.bottom()),
            ],
            Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
        ));
    }
    painter.add(Shape::rect_stroke(
        outer,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));
}

/// Draws the header's two buttons, returning what the pointer did to each: vision at the left end,
/// lit while `vision_open`, and the menu at the right.
fn draw_header(ui: &mut Ui, header: Rect, vision_open: bool) -> (Response, Response) {
    let inner = header.shrink2(vec2(theme::SPACE_XS + FRAME_PAD, 0.0));
    let vision_label = tr!("observer.minimapVision", "Vision");
    let menu_label = tr!("observer.minimapMenu", "Menu");
    let vision_width = button_width(ui, &vision_label);
    let menu_width = button_width(ui, &menu_label);
    let vision_rect = Rect::from_min_size(
        pos2(inner.left(), inner.center().y - BUTTON_HEIGHT * 0.5),
        vec2(vision_width, BUTTON_HEIGHT),
    );
    let menu_rect = Rect::from_min_size(
        pos2(
            inner.right() - menu_width,
            inner.center().y - BUTTON_HEIGHT * 0.5,
        ),
        vec2(menu_width, BUTTON_HEIGHT),
    );
    let vision = header_button(ui, vision_rect, &vision_label, vision_open);
    let menu = header_button(ui, menu_rect, &menu_label, false);
    (vision, menu)
}

/// How wide a header button carrying `label` is.
fn button_width(ui: &Ui, label: &str) -> f32 {
    let width = label_width(ui, label) + BUTTON_PAD * 2.0;
    width.max(BUTTON_MIN_WIDTH).ceil()
}

/// How wide `label` is set in a header button's type.
fn label_width(ui: &Ui, label: &str) -> f32 {
    button_spec().galley(ui, label).size().x
}

fn button_spec() -> text::TextSpec {
    text::body(BUTTON_TEXT_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY)
}

/// Draws one header button: the kit's chip, lit in the accent while what it opens is open.
fn header_button(ui: &mut Ui, rect: Rect, label: &str, lit: bool) -> Response {
    let response = ui
        .scope_builder(egui::UiBuilder::new().max_rect(rect), |ui| {
            widgets::chip_button(ui, &button_spec(), label, rect.size())
        })
        .inner;
    if lit {
        paint_lit_edge(ui, rect, theme::ACCENT);
    }
    response
}

/// Paints the edge in `color` that lights one of the frame's controls.
fn paint_lit_edge(ui: &Ui, rect: Rect, color: Color32) {
    ui.painter().add(Shape::rect_stroke(
        rect,
        theme::radius(theme::RADIUS_CHIP),
        Stroke::new(theme::HAIRLINE, color),
        StrokeKind::Inside,
    ));
}

/// Where the perspective row's controls stand in `row`: the two toggles, squares of the controls'
/// height, at its right end, and the dropdown taking the rest.
///
/// The toggles keep their size on every minimap and the dropdown gives way, its name elided first
/// and its words after that: a toggle cut down is no longer a target, where a dropdown cut down to
/// the color of the shown player still says whose view it is.
pub(crate) struct PerspectiveRowLayout {
    pub(crate) dropdown: Rect,
    pub(crate) camera: Rect,
    pub(crate) actions: Rect,
}

pub(crate) fn perspective_row_layout(row: Rect) -> PerspectiveRowLayout {
    let inner = row.shrink2(vec2(
        theme::SPACE_XS + FRAME_PAD,
        (PERSPECTIVE_ROW_HEIGHT - PERSPECTIVE_BUTTON_HEIGHT) * 0.5,
    ));
    let toggle = egui::Vec2::splat(PERSPECTIVE_BUTTON_HEIGHT);
    let actions = Rect::from_min_size(pos2(inner.right() - toggle.x, inner.top()), toggle);
    let camera = actions.translate(vec2(-(toggle.x + PERSPECTIVE_CONTROL_GAP), 0.0));
    let dropdown = Rect::from_min_max(
        inner.left_top(),
        pos2(
            (camera.left() - PERSPECTIVE_CONTROL_GAP).max(inner.left()),
            inner.bottom(),
        ),
    );
    PerspectiveRowLayout {
        dropdown,
        camera,
        actions,
    }
}

/// What the pointer did to each of the perspective row's controls.
struct PerspectiveRow {
    dropdown: Response,
    camera: Response,
    actions: Response,
}

/// Draws the perspective row at `row`: the dropdown of the players with its menu `open` or not,
/// then the camera and the selection and clicks toggles.
fn draw_perspective_row(
    ui: &mut Ui,
    row: Rect,
    perspectives: &PerspectiveView,
    open: bool,
) -> PerspectiveRow {
    let layout = perspective_row_layout(row);
    let dropdown = draw_perspective_dropdown(ui, layout.dropdown, perspectives, open);
    // Nothing for the toggles to say while nobody's perspective is shown, but they stay where they
    // are: what they will show is decided before choosing whose.
    let (camera, actions) = ui
        .scope(|ui| {
            widgets::set_disabled(ui, perspectives.shown_choice().is_none());
            (
                draw_perspective_toggle(
                    ui,
                    layout.camera,
                    symbols::Symbol::Videocam,
                    perspectives.camera,
                ),
                draw_perspective_toggle(
                    ui,
                    layout.actions,
                    symbols::Symbol::ArrowSelectorTool,
                    perspectives.actions,
                ),
            )
        })
        .inner;
    PerspectiveRow {
        dropdown,
        camera,
        actions,
    }
}

/// Draws the dropdown of the players at `rect`: a chip in the header's style carrying what the row
/// is for while nobody's perspective is shown and the shown player's color and name while somebody's
/// is, with the kit's dropdown chevron at its right end. Lit while its menu is `open`, as the vision
/// button is, and not for a perspective being shown: the row says whose it is in their color
/// already, and an accent edge kept up for a whole game would be the loudest thing on the screen.
///
/// While the watcher has the camera, a bar along its bottom edge drains away as the wait before the
/// camera follows again runs out, and a lit edge is dimmed meanwhile: a bar in the same color as a
/// full-strength edge would read as nothing more than a thicker edge.
fn draw_perspective_dropdown(
    ui: &mut Ui,
    rect: Rect,
    perspectives: &PerspectiveView,
    open: bool,
) -> Response {
    let response = header_button(ui, rect, "", false);
    if open {
        let edge = match perspectives.camera_returns {
            Some(_) => theme::alpha(theme::ACCENT, RETURNING_EDGE_ALPHA),
            None => theme::ACCENT,
        };
        paint_lit_edge(ui, rect, edge);
    }
    let content = rect.shrink2(vec2(BUTTON_PAD, 0.0));
    let hovered = response.hovered();
    let chevron = Rect::from_min_size(
        pos2(
            content.right() - CHEVRON.x,
            content.center().y - CHEVRON.y * 0.5,
        ),
        CHEVRON,
    );
    widgets::paint_chevron(
        ui.painter(),
        chevron,
        if hovered {
            theme::TEXT_PRIMARY
        } else {
            theme::TEXT_SECONDARY
        },
    );
    let room = Rect::from_min_max(
        content.left_top(),
        pos2(
            (chevron.left() - CHEVRON_GAP).max(content.left()),
            content.bottom(),
        ),
    );
    match perspectives.shown_choice() {
        None => paint_text(
            ui,
            room,
            &button_spec().with_color(if hovered {
                theme::TEXT_PRIMARY
            } else {
                theme::TEXT_SECONDARY
            }),
            &perspective_title(),
            Align::LEFT,
        ),
        Some(choice) => {
            let swatch = Rect::from_min_max(
                room.left_top(),
                pos2(room.left() + PLAYER_SWATCH, room.bottom()),
            );
            if swatch.right() <= room.right() {
                paint_player_swatch_in(ui, swatch, choice.color, 1.0);
            }
            paint_text(
                ui,
                Rect::from_min_max(
                    pos2(swatch.right() + PERSPECTIVE_SWATCH_GAP, room.top()),
                    room.right_bottom(),
                ),
                &button_spec().with_color(theme::TEXT_PRIMARY),
                &choice.name,
                Align::LEFT,
            );
        }
    }
    if let Some(share) = perspectives.camera_returns {
        paint_return_bar(ui, rect, share);
    }
    response
}

/// Draws one of the perspective row's toggles at `rect`: `symbol` on a chip face lit the way the
/// dock lights a panel that is on, and dim while `on` is not.
fn draw_perspective_toggle(ui: &mut Ui, rect: Rect, symbol: symbols::Symbol, on: bool) -> Response {
    let response = ui.allocate_rect(rect, Sense::click());
    if !ui.is_rect_visible(rect) {
        return response;
    }
    let state = if on {
        super::dock::RowState::On
    } else {
        super::dock::RowState::Off
    };
    let color = super::dock::paint_chip_face(ui, rect, state);
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    widgets::state_overlay(ui, &response, rect, corner_radius);
    let color = if response.hovered() {
        theme::TEXT_PRIMARY
    } else {
        color
    };
    symbols::paint_symbol(
        ui.painter(),
        rect.center(),
        PERSPECTIVE_GLYPH,
        symbol,
        color,
    );
    response
}

/// Paints the bar along the bottom edge of the control at `control` that stands for how much of the
/// wait before the camera follows its player again is left: the whole width at the start of the
/// wait, and nothing once the camera is theirs again. Kept clear of the control's rounded corners.
fn paint_return_bar(ui: &Ui, control: Rect, share: f32) {
    let inset = f32::from(theme::RADIUS_CHIP);
    let track = Rect::from_min_max(
        pos2(control.left() + inset, control.bottom() - RETURN_BAR_HEIGHT),
        pos2(control.right() - inset, control.bottom()),
    );
    let mut bar = track;
    bar.set_right(track.left() + track.width() * share.clamp(0.0, 1.0));
    if bar.width() > 0.0 {
        ui.painter().rect_filled(bar, 0.0, theme::ACCENT);
    }
}

/// Names the control the pointer is resting on, and the key that does the same.
///
/// Over the frame rather than under it, where the card would cover the map it has nothing to say
/// about.
fn draw_hint(ctx: &Context, control: &Response, title: &str, keycaps: &[&str]) {
    let Some(pointer) = control.hover_pos() else {
        return;
    };
    widgets::tooltip_above(
        ctx,
        Id::new("sb_minimap_frame").with("hint"),
        pointer,
        |ui| widgets::hint_card(ui, title, None, keycaps),
    );
}

/// Draws a list with its bottom left corner at `anchor`, under `title` where it has one, with what
/// `add` puts in it at the width it is handed, and returns where the list is.
///
/// Above the frame rather than under it, because the frame sits on the screen's bottom edge: a list
/// opened downwards would open into the map it is about, or off the screen.
fn draw_popover(
    ctx: &Context,
    id: Id,
    anchor: Pos2,
    title: Option<&str>,
    add: impl FnOnce(&mut Ui, f32),
) -> Rect {
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(anchor)
        .order(Order::Tooltip)
        .constrain(true);
    let inner = area.show(ctx, |ui| {
        tiers::tier1_panel(ui, theme::radius(theme::RADIUS_PANEL), |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let width = tiers::panel_content_width(PICKER_WIDTH);
            ui.set_width(width);
            if let Some(title) = title {
                let (title_rect, _) = ui.allocate_exact_size(vec2(width, 20.0), Sense::hover());
                paint_text(ui, title_rect, &text::hero_title(), title, Align::LEFT);
                ui.add_space(theme::SPACE_XS);
            }
            add(ui, width);
        });
    });
    inner.response.rect
}

/// Draws the list of players hanging at `anchor`, each with a switch for their vision, and returns
/// where it is. A switch thrown is recorded in `outcome`.
fn draw_picker(
    ctx: &Context,
    anchor: Pos2,
    view: &ObserverView,
    outcome: &mut MinimapFrameOutcome,
) -> Rect {
    let id = Id::new("sb_minimap_vision_picker");
    let title = tr!("observer.minimapVisionTitle", "Vision");
    draw_popover(ctx, id, anchor, Some(&title), |ui, width| {
        let mut show = view.show_entire_map;
        if draw_switch_row(
            ui,
            width,
            Id::new("sb_entire_map_switch"),
            None,
            &text::player_name(PICKER_NAME_SIZE),
            &tr!("observer.entireMap", "Entire Map"),
            &mut show,
        ) {
            outcome.show_entire_map = Some(show);
        }
        ui.add_space(theme::SPACE_SM);
        widgets::divider(ui);
        ui.add_space(theme::SPACE_SM);
        let players = &view.matchup.players;
        let divided = teams_worth_dividing(players.iter().map(|player| player.team));
        let mut team = players.first().map(|player| player.team);
        for player in players {
            if divided && team != Some(player.team) {
                ui.add_space(theme::SPACE_SM);
                widgets::divider(ui);
                ui.add_space(theme::SPACE_SM);
            }
            team = Some(player.team);
            let mut on = player.vision;
            let name = text::player_name(PICKER_NAME_SIZE).with_color(if player.vision {
                theme::TEXT_PRIMARY
            } else {
                theme::TEXT_DIM
            });
            if draw_switch_row(
                ui,
                width,
                Id::new(("sb_vision_switch", player.player_id)),
                Some(player.color),
                &name,
                &player.name,
                &mut on,
            ) {
                outcome.toggled_vision = Some(player.player_id);
            }
        }
    })
}

/// Draws the menu of perspectives hanging at `anchor`: nobody first, then every player whose
/// perspective was recorded, the shown one marked as the current choice. Returns where it is and the
/// perspective picked this frame, `Some(None)` for nobody.
///
/// The kit's menu rows, on the frame's own list surface rather than in the kit's menu: that menu is
/// lifted off the dialog it opens from by a long shadow cast downwards, which here would fall across
/// the row the menu opens from and dim its toggles until one that is on reads as off.
fn draw_perspective_menu(
    ctx: &Context,
    anchor: Pos2,
    perspectives: &PerspectiveView,
) -> (Rect, Option<Option<u8>>) {
    let mut picked = None;
    let id = Id::new("sb_minimap_perspective_menu");
    let rect = draw_popover(ctx, id, anchor, None, |ui, _| {
        // Two words, which no player's name can be mistaken for: a name has no spaces in it.
        let none = tr!("observer.perspectiveNone", "No player");
        let row = widgets::MenuRow::new(&none)
            .dense()
            .selected(perspectives.shown_choice().is_none());
        if ui
            .push_id("sb_perspective_none", |ui| row.show(ui))
            .inner
            .clicked()
        {
            picked = Some(None);
        }
        for (choice, index) in perspectives.choices.iter().zip(0u8..) {
            let row = widgets::MenuRow::new(&choice.name)
                .dense()
                .swatch(choice.color)
                .selected(perspectives.shown == Some(usize::from(index)));
            if ui
                .push_id(("sb_perspective_choice", index), |ui| row.show(ui))
                .inner
                .clicked()
            {
                picked = Some(Some(index));
            }
        }
    });
    (rect, picked)
}

/// Draws one row of a list: the square of a player's color where the row is a player's, `label` set
/// in `spec`, and a switch at the right end holding `on`. Returns whether the switch was thrown.
fn draw_switch_row(
    ui: &mut Ui,
    width: f32,
    id: Id,
    swatch: Option<Color32>,
    spec: &text::TextSpec,
    label: &str,
    on: &mut bool,
) -> bool {
    let (row, _) = ui.allocate_exact_size(vec2(width, PICKER_ROW), Sense::hover());
    let mut label_left = row.left();
    if let Some(color) = swatch {
        paint_player_swatch_in(
            ui,
            Rect::from_min_size(row.left_top(), vec2(PICKER_BAR, row.height())),
            color,
            1.0,
        );
        label_left += PICKER_BAR + PICKER_BAR_GAP;
    }
    let switched = draw_picker_switch(ui, row, id, on);
    paint_text(
        ui,
        Rect::from_min_max(
            pos2(label_left, row.top()),
            pos2(switched.rect.left() - theme::SPACE_SM, row.bottom()),
        ),
        spec,
        label,
        Align::LEFT,
    );
    switched.changed()
}

fn draw_picker_switch(ui: &mut Ui, row: Rect, id: Id, on: &mut bool) -> Response {
    ui.scope_builder(
        egui::UiBuilder::new()
            .max_rect(row)
            .layout(egui::Layout::right_to_left(Align::Center)),
        |ui| ui.push_id(id, |ui| widgets::switch(ui, on)).inner,
    )
    .inner
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_footprint_is_the_band_and_the_header_kept_on_the_screen() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 960.0));
        // A minimap flush with the screen's corner keeps no band past the screen's edges.
        let square = Rect::from_min_size(pos2(0.0, 650.0), vec2(310.0, 310.0));
        let outer = footprint(screen, square, false);
        assert_eq!(outer.left(), 0.0);
        assert_eq!(outer.bottom(), 960.0);
        assert_eq!(outer.right(), 310.0 + FRAME_PAD);
        assert_eq!(outer.top(), 650.0 - FRAME_PAD - HEADER_HEIGHT);
    }

    #[test]
    fn the_perspective_row_adds_its_height_to_the_footprint_and_nothing_else() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0));
        let square = Rect::from_min_size(pos2(12.0, 776.0), vec2(292.0, 292.0));
        let without = footprint(screen, square, false);
        let with = footprint(screen, square, true);
        assert_eq!(with.top(), without.top() - PERSPECTIVE_ROW_HEIGHT);
        assert_eq!(with.left(), without.left());
        assert_eq!(with.right(), without.right());
        assert_eq!(with.bottom(), without.bottom());
    }

    #[test]
    fn the_band_runs_on_to_the_screens_bottom_edge() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1920.0, 1080.0));
        // Short of the edge by more than the band's own depth, as SC:R stands its minimap.
        let square = Rect::from_min_size(pos2(12.0, 812.0), vec2(292.0, 260.0));
        assert_eq!(footprint(screen, square, false).bottom(), 1080.0);
    }
}
