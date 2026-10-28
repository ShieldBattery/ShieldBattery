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
//! same two in the overlay's own controls: a vision button opening a list of the players with a
//! switch each, which asks exactly what a click on a half of the matchup bar asks, and a menu
//! button, which asks the host to open the game's menu the way its own key does.
//!
//! The frame follows the minimap wherever the game puts it, being drawn from the square the host
//! reports, and comes and goes with it.

use egui::{
    Align, Align2, Area, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind, Ui, pos2, vec2,
};

use crate::kit::text::{self, BodyWeight};
use crate::kit::{motion, theme, tiers, widgets};
use crate::observer::{MatchupPlayerView, paint_player_bar, paint_text, teams_worth_dividing};
use crate::tr;

/// How far the frame's band reaches out around the minimap's square.
pub(crate) const FRAME_PAD: f32 = 4.0;

/// Height of the header strip above the square.
pub(crate) const HEADER_HEIGHT: f32 = 28.0;

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

/// Width of the bar of a player's color at the head of their row, and the gap after it.
const PICKER_BAR: f32 = 4.0;
const PICKER_BAR_GAP: f32 = 8.0;

/// Text size of a player's name in the list.
const PICKER_NAME_SIZE: f32 = 15.0;

/// Gap between the list and the header it opens from.
const PICKER_GAP: f32 = 6.0;

/// How much of the screen the frame takes around a minimap at `square`: the band around the square
/// and the header above it, kept on the screen.
///
/// What the surfaces placed around the minimap keep clear of, whether or not the frame is drawn, so
/// a watcher hiding the minimap does not find the panels moving into its corner.
pub(crate) fn footprint(screen: Rect, square: Rect) -> Rect {
    let band = square.expand(FRAME_PAD);
    Rect::from_min_max(
        pos2(band.left(), band.top() - HEADER_HEIGHT),
        band.right_bottom(),
    )
    .intersect(screen)
}

/// The keys that do what the header's buttons do, as the keycaps the card under the pointer shows.
#[derive(Copy, Clone, Default)]
pub struct MinimapKeys<'a> {
    /// The key that opens the list of players.
    pub vision: &'a [&'a str],
    /// The key that opens the game's menu.
    pub menu: &'a [&'a str],
}

/// What the watcher asked of the frame this frame.
pub struct MinimapFrameOutcome {
    /// The rects of the frame that take the pointer: the header, and the list of players while it is
    /// open. The band around the square takes none, so a click on the map's own edge is the map's.
    pub rects: Vec<Rect>,
    /// The player whose vision was asked to change, if one was switched.
    pub toggled_vision: Option<u8>,
    /// Whether the menu button was pressed.
    pub open_menu: bool,
    /// Whether the list of players is to be open next frame.
    pub picker_open: bool,
}

/// Draws the frame around a minimap at `square`, fading it in and out with the minimap, with the
/// list of `players` open under the vision button while `picker_open`, and a card naming the
/// button under the pointer and its key from `keys`. Returns nothing at all once it is gone.
pub fn render_minimap_frame(
    ctx: &Context,
    square: Rect,
    shown: bool,
    players: &[MatchupPlayerView],
    picker_open: bool,
    keys: MinimapKeys,
) -> Option<MinimapFrameOutcome> {
    let screen = ctx.viewport_rect();
    let outer = footprint(screen, square);
    let header = Rect::from_min_max(
        outer.left_top(),
        pos2(outer.right(), outer.top() + HEADER_HEIGHT),
    );
    let id = Id::new("sb_minimap_frame");
    let area = Area::new(id)
        .fixed_pos(outer.left_top())
        .order(Order::Foreground);
    let inner = motion::presence_area(ctx, id.with("presence"), shown, area, |ui| {
        paint_frame(ui, outer, square, header);
        draw_header(ui, header, picker_open)
    })?;
    let (vision, menu) = inner.inner;
    // The open list already says what the vision button is for, and covers where its card goes.
    if vision.hovered() && !picker_open {
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
    }
    let mut outcome = MinimapFrameOutcome {
        rects: vec![header],
        toggled_vision: None,
        open_menu: menu.clicked(),
        picker_open: picker_open != vision.clicked(),
    };
    if picker_open && shown {
        let picker = draw_picker(ctx, vision.rect, players, &mut outcome);
        // A press anywhere but on the list and the button that opened it closes the list, the way
        // any popover closes: the watcher has moved on to something else.
        let pressed_elsewhere = ctx.input(|input| {
            input.pointer.any_pressed()
                && input
                    .pointer
                    .interact_pos()
                    .is_some_and(|pos| !picker.contains(pos) && !vision.rect.contains(pos))
        });
        if pressed_elsewhere {
            outcome.picker_open = false;
        }
        outcome.rects.push(picker);
    }
    Some(outcome)
}

/// Paints the frame's chrome: the band around the square, the header strip, and the edge around
/// both, leaving the square itself clear for the game's own map.
fn paint_frame(ui: &Ui, outer: Rect, square: Rect, header: Rect) {
    let painter = ui.painter();
    painter.add(Shape::rect_stroke(
        square,
        0,
        Stroke::new(FRAME_PAD, theme::TIER0_FILL),
        StrokeKind::Outside,
    ));
    let corner_radius = theme::radius(theme::RADIUS_PANEL);
    painter.rect_filled(
        header,
        egui::CornerRadius {
            nw: corner_radius.nw,
            ne: corner_radius.ne,
            sw: 0,
            se: 0,
        },
        theme::TIER0_FILL,
    );
    painter.add(Shape::line_segment(
        [
            pos2(header.left(), header.bottom()),
            pos2(header.right(), header.bottom()),
        ],
        Stroke::new(theme::HAIRLINE, theme::TIER0_DIVIDER),
    ));
    painter.add(Shape::rect_stroke(
        outer,
        corner_radius,
        Stroke::new(theme::HAIRLINE, theme::TIER0_STROKE),
        StrokeKind::Inside,
    ));
}

/// Draws the header's two buttons, returning what the pointer did to each: vision at the left end,
/// where the list it opens hangs from, and the menu at the right.
fn draw_header(ui: &mut Ui, header: Rect, picker_open: bool) -> (egui::Response, egui::Response) {
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
    let vision = header_button(ui, vision_rect, &vision_label, picker_open);
    let menu = header_button(ui, menu_rect, &menu_label, false);
    (vision, menu)
}

/// How wide a header button carrying `label` is.
fn button_width(ui: &Ui, label: &str) -> f32 {
    let width = button_spec().galley(ui, label).size().x + BUTTON_PAD * 2.0;
    width.max(BUTTON_MIN_WIDTH).ceil()
}

fn button_spec() -> text::TextSpec {
    text::body(BUTTON_TEXT_SIZE, BodyWeight::Medium).with_color(theme::TEXT_SECONDARY)
}

/// Draws one header button: the kit's chip, lit in the accent while what it opens is open.
fn header_button(ui: &mut Ui, rect: Rect, label: &str, lit: bool) -> egui::Response {
    let response = ui
        .scope_builder(egui::UiBuilder::new().max_rect(rect), |ui| {
            widgets::chip_button(ui, &button_spec(), label, rect.size())
        })
        .inner;
    if lit {
        ui.painter().add(Shape::rect_stroke(
            rect,
            theme::radius(theme::RADIUS_CHIP),
            Stroke::new(theme::HAIRLINE, theme::ACCENT),
            StrokeKind::Inside,
        ));
    }
    response
}

/// Names the header button the pointer is resting on, and the key that does the same.
///
/// Over the header rather than under it, where the card would cover the map it has nothing to say
/// about.
fn draw_hint(ctx: &Context, button: &egui::Response, title: &str, keycaps: &[&str]) {
    let Some(pointer) = button.hover_pos() else {
        return;
    };
    widgets::tooltip_above(
        ctx,
        Id::new("sb_minimap_frame").with("hint"),
        pointer,
        |ui| widgets::hint_card(ui, title, None, keycaps),
    );
}

/// Draws the list of players hanging above the vision button, each with a switch for their vision,
/// and returns where it is. A switch thrown is recorded in `outcome`.
///
/// Above the button rather than under it, because the frame sits on the screen's bottom edge: a list
/// opened downwards would open into the map it is about, or off the screen.
fn draw_picker(
    ctx: &Context,
    button: Rect,
    players: &[MatchupPlayerView],
    outcome: &mut MinimapFrameOutcome,
) -> Rect {
    let id = Id::new("sb_minimap_vision_picker");
    // Above the header's own top edge, so the list covers neither button.
    let bottom = button.top() - (HEADER_HEIGHT - BUTTON_HEIGHT) * 0.5 - PICKER_GAP;
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(pos2(button.left() - theme::SPACE_XS, bottom))
        .order(Order::Tooltip)
        .constrain(true);
    let inner = area.show(ctx, |ui| {
        tiers::tier1_panel(ui, theme::radius(theme::RADIUS_PANEL), |ui| {
            ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
            let width = tiers::panel_content_width(PICKER_WIDTH);
            ui.set_width(width);
            let (title, _) = ui.allocate_exact_size(vec2(width, 20.0), Sense::hover());
            paint_text(
                ui,
                title,
                &text::hero_title(),
                &tr!("observer.minimapVisionTitle", "Vision"),
                Align::LEFT,
            );
            ui.add_space(theme::SPACE_XS);
            let divided = teams_worth_dividing(players.iter().map(|player| player.team));
            let mut team = players.first().map(|player| player.team);
            for player in players {
                if divided && team != Some(player.team) {
                    ui.add_space(theme::SPACE_SM);
                    widgets::divider(ui);
                    ui.add_space(theme::SPACE_SM);
                }
                team = Some(player.team);
                if let Some(player_id) = draw_picker_row(ui, width, player) {
                    outcome.toggled_vision = Some(player_id);
                }
            }
        });
    });
    inner.response.rect
}

/// Draws one player's row of the list: the bar of their color, their name, and the switch for their
/// vision. Returns their id when the switch was thrown.
fn draw_picker_row(ui: &mut Ui, width: f32, player: &MatchupPlayerView) -> Option<u8> {
    let (row, _) = ui.allocate_exact_size(vec2(width, PICKER_ROW), Sense::hover());
    paint_player_bar(
        ui,
        Rect::from_center_size(
            pos2(row.left() + PICKER_BAR * 0.5, row.center().y),
            vec2(PICKER_BAR, PICKER_ROW * 0.5),
        ),
        player.color,
        1.0,
    );
    let mut on = player.vision;
    let switched = ui
        .scope_builder(
            egui::UiBuilder::new()
                .max_rect(row)
                .layout(egui::Layout::right_to_left(Align::Center)),
            |ui| {
                ui.push_id(("sb_vision_switch", player.player_id), |ui| {
                    widgets::switch(ui, &mut on)
                })
                .inner
            },
        )
        .inner;
    let name = Rect::from_min_max(
        pos2(row.left() + PICKER_BAR + PICKER_BAR_GAP, row.top()),
        pos2(switched.rect.left() - theme::SPACE_SM, row.bottom()),
    );
    paint_text(
        ui,
        name,
        &text::player_name(PICKER_NAME_SIZE).with_color(if player.vision {
            theme::TEXT_PRIMARY
        } else {
            theme::TEXT_DIM
        }),
        &player.name,
        Align::LEFT,
    );
    switched.changed().then_some(player.player_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_footprint_is_the_band_and_the_header_kept_on_the_screen() {
        let screen = Rect::from_min_size(pos2(0.0, 0.0), vec2(1280.0, 960.0));
        // A minimap flush with the screen's corner keeps no band past the screen's edges.
        let square = Rect::from_min_size(pos2(0.0, 650.0), vec2(310.0, 310.0));
        let outer = footprint(screen, square);
        assert_eq!(outer.left(), 0.0);
        assert_eq!(outer.bottom(), 960.0);
        assert_eq!(outer.right(), 310.0 + FRAME_PAD);
        assert_eq!(outer.top(), 650.0 - FRAME_PAD - HEADER_HEIGHT);
    }
}
