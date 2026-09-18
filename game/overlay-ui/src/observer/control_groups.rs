//! The control groups panel: what every player has bound to their number keys.
//!
//! One row per player, led by the bar of their own color and their name, then ten slots in the
//! order a keyboard reads them. A slot carries the digit it answers to, the icon of whatever the
//! group is mostly made of, and how many units are in it — which is what a caster reads a push
//! against: a group of twelve that has not been touched in four minutes is an army sitting at home.
//!
//! The ten slots are always drawn, filled or not. A row that only showed the groups a player
//! happens to have would move its tiles every time one was made or lost, and the whole point of the
//! panel is that the same key is always in the same place.
//!
//! It sits at the kit's ambient tier just above the production panel, centred, so the two surfaces
//! a watcher glances at during a fight are in the same place.

use egui::{Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Ui, pos2, vec2};

use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, ProductionIcon, centred, paint_player_bar, paint_text, paint_tile_chrome,
    vision_alpha,
};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 790.0;

/// How far the panel's bottom edge sits above the screen's when the production panel under it is
/// the height the design drew it at, which is the band the design leaves this one.
pub(crate) const BOTTOM_MARGIN: f32 = 388.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Width of the bar of the player's own color that leads their row.
const COLOR_BAR: f32 = 4.0;

/// Gap between that bar and the player's name.
const BAR_GAP: f32 = 9.0;

/// Width the player's name is laid out in. Fixed, because a name is player-chosen: one longer than
/// its slot would otherwise push every tile beside it out of the design's grid.
const NAME_WIDTH: f32 = 127.0;

/// Gap between the name and the first slot.
const NAME_GAP: f32 = 12.0;

/// The digits a group answers to, in the order a keyboard reads them.
///
/// The group's own number is the digit, and `0` sits where it does on a keyboard rather than where
/// it does in the game's table: a watcher looking for a group is looking along the number row.
const GROUP_KEYS: [u8; 10] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/// Size of one slot.
const TILE_WIDTH: f32 = 56.0;
const TILE_HEIGHT: f32 = 26.0;

/// Gap between two slots.
const TILE_GAP: f32 = 6.0;

/// Gap between two players' rows.
const ROW_GAP: f32 = 4.0;

/// The slots are the row and the row is the panel: checked where the widths are written, because
/// one slot more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    COLOR_BAR
        + BAR_GAP
        + NAME_WIDTH
        + NAME_GAP
        + TILE_WIDTH * GROUP_KEYS.len() as f32
        + TILE_GAP * (GROUP_KEYS.len() as f32 - 1.0)
        == CONTENT_WIDTH
);

/// Width of the digit at the head of a slot.
const KEY_WIDTH: f32 = 12.0;

/// Side of the icon on a slot.
const ICON: f32 = 22.0;

/// Width the unit count is laid out in.
const COUNT_WIDTH: f32 = 16.0;

/// Gap between the three cells of a slot.
const CELL_GAP: f32 = 3.0;

// A slot's cells are the slot: checked here, because a cell more than fits would be drawn over the
// slot beside it.
const _: () = assert!(KEY_WIDTH + CELL_GAP + ICON + CELL_GAP + COUNT_WIDTH == TILE_WIDTH);

/// Text size of a slot's three cells: the digit it answers to, the icon's own number where the
/// host has no atlas to draw the icon from, and how many units are on it. They are read in that
/// order and sized in it too.
const KEY_TEXT_SIZE: f32 = 11.0;
const ICON_TEXT_SIZE: f32 = 11.0;
const COUNT_TEXT_SIZE: f32 = 12.5;

/// Text size of a player's name, matching the stats wings' so the panels read as one set.
const NAME_SIZE: f32 = 15.0;

/// How much of itself a group that has not been used in a while is drawn at.
///
/// Dimmed rather than dropped: a forgotten group is exactly what a watcher wants pointed out, and a
/// slot that emptied itself would read as a group that no longer exists.
const STALE_ALPHA: f32 = 0.45;

/// One of a player's groups.
pub struct ControlGroupView {
    /// The digit this group answers to.
    pub key: u8,
    /// The game's own icon for whatever the group is mostly made of.
    pub icon: ProductionIcon,
    /// How many units are in it.
    pub count: u32,
    /// Whether it has gone long enough without being recalled to be worth pointing out.
    pub stale: bool,
}

/// One player's row.
pub struct ControlGroupsPlayerView {
    pub name: String,
    /// The color this player is on the map, which is what ties the row to what the watcher sees.
    pub color: Color32,
    /// Whether the watcher currently sees the game through this player's eyes.
    pub vision: bool,
    /// The groups this player has, in any order: each is drawn at the slot its own key names.
    pub groups: Vec<ControlGroupView>,
}

/// Everything the control groups panel draws from.
#[derive(Default)]
pub struct ControlGroupsView {
    /// The players with at least one group. A player with none has no row, and a game where nobody
    /// has bound anything has no panel.
    pub players: Vec<ControlGroupsPlayerView>,
}

impl ControlGroupsView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        self.players.iter().all(|player| player.groups.is_empty())
    }
}

/// Draws the control groups panel `bottom` points above the screen's own bottom edge, fading and
/// sliding it in and out. Returns nothing at all once it is gone, or while nobody has a group.
pub fn render_control_groups_view(
    view: &ControlGroupsView,
    ctx: &Context,
    shown: bool,
    bottom: f32,
) -> Option<Rect> {
    let id = Id::new("sb_control_groups_panel");
    let area = Area::new(id)
        .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -bottom))
        .order(Order::Foreground);
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        shown && !view.is_empty(),
        area,
        |ui| {
            tiers::tier0_panel(ui, |ui| {
                // The rows are stacked by the gap written here and by nothing else, so the panel is
                // exactly as tall as the players who have bound anything.
                ui.spacing_mut().item_spacing = vec2(0.0, ROW_GAP);
                ui.set_width(CONTENT_WIDTH);
                draw_rows(ui, view);
            })
            .inner
        },
    )?;
    Some(inner.response.rect)
}

/// Draws one row per player with a group to show.
fn draw_rows(ui: &mut Ui, view: &ControlGroupsView) {
    for player in view.players.iter().filter(|p| !p.groups.is_empty()) {
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, TILE_HEIGHT), Sense::hover());
        let alpha = vision_alpha(player.vision);
        let mut cursor = EdgeCursor::from_left(row);
        let bar = cursor.take(COLOR_BAR);
        paint_player_bar(
            ui,
            centred(bar, row.height()),
            player.color,
            // The color bar keeps more of itself than the rest of a vision-less row: it is what
            // says whose row this is, and two rows dimmed alike are hard to tell apart.
            if player.vision { 1.0 } else { 0.5 },
        );
        cursor.skip(BAR_GAP);
        paint_text(
            ui,
            cursor.take(NAME_WIDTH),
            &text::player_name(NAME_SIZE).with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
            &player.name,
            Align::LEFT,
        );
        cursor.skip(NAME_GAP);
        for (index, key) in GROUP_KEYS.into_iter().enumerate() {
            if index > 0 {
                cursor.skip(TILE_GAP);
            }
            let slot = cursor.take(TILE_WIDTH);
            let group = player.groups.iter().find(|group| group.key == key);
            draw_slot(ui, slot, key, group, alpha);
        }
    }
}

/// Draws one slot: the digit it answers to and, when there is a group on it, what that group is.
fn draw_slot(ui: &Ui, rect: Rect, key: u8, group: Option<&ControlGroupView>, alpha: f32) {
    let alpha = match group {
        Some(group) if group.stale => alpha * STALE_ALPHA,
        Some(_) => alpha,
        // An empty slot is the grid rather than a reading, so it is drawn at the same weight a
        // stale one is: present, and plainly holding nothing.
        None => alpha * STALE_ALPHA,
    };
    paint_tile_chrome(ui, rect, false);
    let mut cursor = EdgeCursor::from_left(rect);
    paint_text(
        ui,
        cursor.take(KEY_WIDTH),
        &text::body(KEY_TEXT_SIZE, text::BodyWeight::Medium)
            .with_color(theme::TEXT_LABEL.gamma_multiply(alpha)),
        &key.to_string(),
        Align::Center,
    );
    cursor.skip(CELL_GAP);
    let icon_rect = centred(cursor.take(ICON), ICON.min(rect.height() - 2.0));
    cursor.skip(CELL_GAP);
    let count_rect = cursor.take(COUNT_WIDTH);
    let Some(group) = group else {
        return;
    };
    match group.icon.texture {
        Some(texture) => {
            ui.painter().image(
                texture,
                icon_rect,
                Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                Color32::WHITE.gamma_multiply(alpha),
            );
        }
        None => paint_text(
            ui,
            icon_rect,
            &text::body(ICON_TEXT_SIZE, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha)),
            &group.icon.index.to_string(),
            Align::Center,
        ),
    }
    paint_text(
        ui,
        count_rect,
        &text::body(COUNT_TEXT_SIZE, text::BodyWeight::Semibold)
            .with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
        &group.count.to_string(),
        Align::RIGHT,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rows_fill_the_panels_own_width() {
        assert_eq!(
            crate::kit::tiers::panel_content_width(PANEL_WIDTH),
            CONTENT_WIDTH
        );
    }

    #[test]
    fn the_slots_are_the_number_row_rather_than_the_games_own_order() {
        assert_eq!(GROUP_KEYS.first(), Some(&1));
        assert_eq!(GROUP_KEYS.last(), Some(&0));
    }
}
