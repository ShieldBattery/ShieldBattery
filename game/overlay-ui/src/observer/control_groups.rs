//! The control groups panel: what every player has bound to their number keys.
//!
//! One row, for one player: the owner of whatever the watcher has selected, or whoever it showed
//! last while nothing is. A row per player was ten slots times eight in a big game, which is a wall
//! of tiles nobody reads, and what a watcher wants to know about groups is what the player they are
//! looking at has on their keys. The row is led by the bar of the player's color and their name,
//! then ten slots in the order a keyboard reads them. A slot carries the digit it answers to, what the group is, and how
//! many units are in it — which is what a caster reads a push against: a group of twelve that has
//! not been touched in four minutes is an army sitting at home.
//!
//! What the group *is* takes the middle of the slot, because it is the line a watcher reads first:
//! the game's own icon where the host has the atlas to draw it, and the unit's short code where it
//! has not. A group of two kinds names both, since an army of zealots with templar in it is a
//! different army from either of them alone. The game lets a group hold twelve units or one
//! building, so a building group has no count and is not given one.
//!
//! The ten slots are always drawn, filled or not. A row that only showed the groups a player
//! happens to have would move its tiles every time one was made or lost, and the whole point of the
//! panel is that the same key is always in the same place. An empty one keeps its space and fades
//! nearly out of the row, so what the row is made of is the keys the player is using.
//!
//! It sits at the kit's ambient tier at the top of the centred bottom stack, over the production
//! panel, so the surfaces a watcher glances at during a fight are all in the same place.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Sense, Shape, Stroke, StrokeKind,
    TextureId, Ui, pos2, vec2,
};

use crate::colors::{BLUE80, GREY_BLUE10};
use crate::kit::text;
use crate::kit::{motion, theme, tiers};
use crate::observer::{
    EdgeCursor, ProductionIcon, centred, paint_player_bar, paint_text, unit_codes, vision_alpha,
};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 790.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Width of the bar of the player's own color that leads their row, and how tall it is drawn.
///
/// Shorter than the row: the bar says whose row this is, and one run the height of three lines of
/// text would be a stripe down the panel rather than a mark against a name.
const COLOR_BAR: f32 = 4.0;
const COLOR_BAR_HEIGHT: f32 = 16.0;

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

/// Size of one slot, which is three lines tall: the digit, what the group is, and how many.
const TILE_WIDTH: f32 = 56.0;
const TILE_HEIGHT: f32 = 46.0;

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

/// Height of each of a slot's three lines: the digit it answers to, what the group is, and how many
/// units are on it.
const KEY_ROW: f32 = 11.0;
const SUBJECT_ROW: f32 = 20.0;
const COUNT_ROW: f32 = 13.0;

/// Gap between two of those lines. A hairline, because the three of them are one reading rather
/// than three: what tells them apart is their weight and their color.
const ROW_LEAD: f32 = 1.0;

/// A slot's lines are the slot: checked here, because a line more than fits would be drawn over the
/// slot's own chrome.
const _: () = assert!(KEY_ROW + ROW_LEAD + SUBJECT_ROW + ROW_LEAD + COUNT_ROW == TILE_HEIGHT);

/// Side of the icon on a slot, and of the two a group of two kinds is drawn with.
const ICON: f32 = 20.0;
const COMBO_ICON: f32 = 16.0;

/// Gap between the two icons of a group of two kinds.
const COMBO_ICON_GAP: f32 = 2.0;

/// Text size of a slot's three lines, read in the order they are written in.
///
/// The digit is set at the smallest size anything on the overlay is allowed at: it is the label of
/// a slot whose place in the row already names it, and what is being read is everything above it.
const KEY_TEXT_SIZE: f32 = text::MIN_SIZE;
const CODE_TEXT_SIZE: f32 = 11.0;
const COUNT_TEXT_SIZE: f32 = 12.5;

/// How far apart the letters of a unit's code are set, which is what keeps three capitals from
/// reading as one shape.
///
/// A group of two kinds drops it: two codes and the sign between them are as much as the slot
/// holds, and the tracking is the first thing it gives up.
const CODE_TRACKING: f32 = 0.4;

/// What stands between the two codes of a group of two kinds.
const COMBO_JOIN: &str = "+";

/// Text size of a player's name, matching the stats wings' so the panels read as one set.
const NAME_SIZE: f32 = 15.0;

/// How much of itself a group that has not been used in a while is drawn at.
///
/// Dimmed rather than dropped: a forgotten group is exactly what a watcher wants pointed out, and a
/// slot that emptied itself would read as a group that no longer exists.
const STALE_ALPHA: f32 = 0.45;

/// How much of itself a slot with nothing on it is drawn at.
///
/// Fainter than a forgotten group, because it is the grid rather than a reading: it is there so the
/// slots around it never move, and it has nothing of its own to say.
const EMPTY_ALPHA: f32 = 0.32;

/// One of a player's groups.
pub struct ControlGroupView {
    /// The digit this group answers to.
    pub key: u8,
    /// The game's own icon for whatever the group is mostly made of.
    pub icon: ProductionIcon,
    /// The icon of the other kind in a group made of two, or `None` for a group of one kind.
    pub combo: Option<ProductionIcon>,
    /// How many units are in it.
    pub count: u32,
    /// Whether the group is a building. The game lets a group hold twelve units or one building, so
    /// a building group is one building and has no count worth drawing.
    pub building: bool,
    /// Whether it has gone long enough without being recalled to be worth pointing out.
    pub stale: bool,
}

/// One player's row.
pub struct ControlGroupsPlayerView {
    /// The game's own slot for this player, which is what a selection names its owner by.
    pub player_id: u8,
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
    /// Every player and what they have bound. A game where nobody has bound anything has no panel.
    pub players: Vec<ControlGroupsPlayerView>,
}

impl ControlGroupsView {
    /// Whether there is anything at all to draw.
    pub fn is_empty(&self) -> bool {
        self.players.iter().all(|player| player.groups.is_empty())
    }

    /// The player whose row is drawn: `focus` while they have a group to show, and otherwise the
    /// first player who has, so the panel always has a row while anybody has bound anything.
    fn shown(&self, focus: Option<u8>) -> Option<&ControlGroupsPlayerView> {
        let bound = |player: &&ControlGroupsPlayerView| !player.groups.is_empty();
        self.players
            .iter()
            .filter(bound)
            .find(|player| Some(player.player_id) == focus)
            .or_else(|| self.players.iter().find(bound))
    }
}

/// Draws the control groups panel `bottom` points above the screen's own bottom edge, fading and
/// sliding it in and out, with the row of the player `focus` names. Returns nothing at all once it
/// is gone, or while nobody has a group.
pub fn render_control_groups_view(
    view: &ControlGroupsView,
    ctx: &Context,
    shown: bool,
    bottom: f32,
    focus: Option<u8>,
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
                draw_rows(ui, view, focus);
            })
            .inner
        },
    )?;
    Some(inner.response.rect)
}

/// Draws the one row the panel shows.
fn draw_rows(ui: &mut Ui, view: &ControlGroupsView, focus: Option<u8>) {
    if let Some(player) = view.shown(focus) {
        let (row, _) = ui.allocate_exact_size(vec2(CONTENT_WIDTH, TILE_HEIGHT), Sense::hover());
        let alpha = vision_alpha(player.vision);
        let mut cursor = EdgeCursor::from_left(row);
        let bar = cursor.take(COLOR_BAR);
        paint_player_bar(
            ui,
            centred(bar, COLOR_BAR_HEIGHT),
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

/// Draws one slot: the digit it answers to and, when there is a group on it, what that group is and
/// how much of it there is.
fn draw_slot(ui: &Ui, rect: Rect, key: u8, group: Option<&ControlGroupView>, alpha: f32) {
    let alpha = match group {
        Some(group) if group.stale => alpha * STALE_ALPHA,
        Some(_) => alpha,
        None => alpha * EMPTY_ALPHA,
    };
    paint_slot_chrome(ui, rect, alpha);
    // Every line sits at the same height in every slot of the row, filled or not, so the digits
    // read as one line across the panel and a group is compared against the one beside it rather
    // than hunted for. A slot with no count is one whose last line is blank, which draws the
    // difference where the difference is.
    let mut top = rect.top();
    let mut line = |height: f32| {
        let line = Rect::from_min_size(pos2(rect.left(), top), vec2(rect.width(), height));
        top += height + ROW_LEAD;
        line
    };
    paint_key(ui, line(KEY_ROW), key, alpha);
    let Some(group) = group else {
        return;
    };
    paint_subject(ui, line(SUBJECT_ROW), group, alpha);
    if !group.building {
        paint_text(
            ui,
            line(COUNT_ROW),
            &text::body(COUNT_TEXT_SIZE, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_PRIMARY.gamma_multiply(alpha)),
            &group.count.to_string(),
            Align::Center,
        );
    }
}

/// Draws the digit a slot answers to.
fn paint_key(ui: &Ui, rect: Rect, key: u8, alpha: f32) {
    paint_text(
        ui,
        rect,
        &text::body(KEY_TEXT_SIZE, text::BodyWeight::Medium)
            .with_color(theme::TEXT_LABEL.gamma_multiply(alpha)),
        &key.to_string(),
        Align::Center,
    );
}

/// Draws what a group is: the game's own icons where the host has them, and the units' codes where
/// it has not.
fn paint_subject(ui: &Ui, rect: Rect, group: &ControlGroupView, alpha: f32) {
    let combo = group.combo;
    match (group.icon.texture, combo.and_then(|icon| icon.texture)) {
        (Some(first), Some(second)) => {
            let left = rect.center().x - (COMBO_ICON * 2.0 + COMBO_ICON_GAP) * 0.5;
            let icon = |step: f32| {
                Rect::from_center_size(
                    pos2(
                        left + step * (COMBO_ICON + COMBO_ICON_GAP) + COMBO_ICON * 0.5,
                        rect.center().y,
                    ),
                    vec2(COMBO_ICON, COMBO_ICON),
                )
            };
            paint_icon(ui, icon(0.0), first, alpha);
            paint_icon(ui, icon(1.0), second, alpha);
        }
        (Some(texture), None) => paint_icon(
            ui,
            Rect::from_center_size(rect.center(), vec2(ICON, ICON)),
            texture,
            alpha,
        ),
        (None, _) => {
            let code = unit_codes::code_or_index(group.icon.index);
            let label = match combo {
                Some(icon) => {
                    format!(
                        "{code}{COMBO_JOIN}{}",
                        unit_codes::code_or_index(icon.index)
                    )
                }
                None => code,
            };
            let spec = text::body(CODE_TEXT_SIZE, text::BodyWeight::Semibold)
                .with_color(theme::TEXT_SECONDARY.gamma_multiply(alpha))
                .with_letter_spacing(if combo.is_some() { 0.0 } else { CODE_TRACKING });
            paint_text(ui, rect, &spec, &label, Align::Center);
        }
    }
}

/// Draws one of the game's own icons.
fn paint_icon(ui: &Ui, rect: Rect, texture: TextureId, alpha: f32) {
    ui.painter().image(
        texture,
        rect,
        Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
        Color32::WHITE.gamma_multiply(alpha),
    );
}

/// Paints a slot's own chrome, at however much of itself the slot is drawn at.
///
/// Its own rather than the chrome the clickable tiles share, because a slot fades whole: an empty
/// or forgotten one whose border stayed at full strength would be the loudest thing in the row.
fn paint_slot_chrome(ui: &Ui, rect: Rect, alpha: f32) {
    let corner_radius = theme::radius(theme::RADIUS_CHIP);
    ui.painter().rect_filled(
        rect,
        corner_radius,
        theme::alpha(GREY_BLUE10, 0.85).gamma_multiply(alpha),
    );
    ui.painter().add(Shape::rect_stroke(
        rect,
        corner_radius,
        Stroke::new(
            theme::HAIRLINE,
            theme::alpha(BLUE80, 0.20).gamma_multiply(alpha),
        ),
        StrokeKind::Inside,
    ));
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
