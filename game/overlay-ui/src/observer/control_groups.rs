//! The control groups panel: what a player has bound to their number keys.
//!
//! One row, for one player: the owner of whatever the watcher has selected, or whoever it showed
//! last while nothing is. A row for every player would be a wall of eighty tiles in a big game, and
//! what a watcher wants is what the player they are looking at has on their keys. The row is a bar
//! of the player's color (no name: it would be most of the row), then ten slots in the order a
//! keyboard reads them. A slot carries the digit it answers to, what the group is, and how many
//! units are in it, which is what a caster reads a push against: a group of twelve that has not
//! been touched in four minutes is an army sitting at home.
//!
//! What the group *is* takes the middle of the slot: the game's own icon where the host has the
//! atlas, and the unit's short code where it has not. A group of two kinds names both, since an army
//! of zealots with templar in it is a different army from either alone. A building group has no
//! count, since the game lets a group hold twelve units or one building.
//!
//! The ten slots are always drawn, filled or not, so the same key is always in the same place. An
//! empty one keeps its space and fades nearly out of the row.
//!
//! It sits at the kit's ambient tier along the screen's bottom edge, under the production panel.

use egui::{
    Align, Align2, Area, Color32, Context, Id, Order, Rect, Response, Sense, Shape, Stroke,
    StrokeKind, TextureId, Ui, pos2, vec2,
};

use crate::colors::{BLUE80, GREY_BLUE10};
use crate::kit::text;
use crate::kit::{motion, theme, tiers, widgets};
use crate::observer::{
    EdgeCursor, ProductionIcon, StackSlot, owner_tint, paint_icon_glow, paint_owner_wash,
    paint_player_swatch_in, paint_text, unit_codes, vision_alpha,
};

/// How wide the panel is, in overlay points.
pub const PANEL_WIDTH: f32 = 651.0;

/// The room inside the panel's chrome.
const CONTENT_WIDTH: f32 = PANEL_WIDTH - 24.0;

/// Width of the column the square of the player's own color that leads their row stands in.
const COLOR_BAR: f32 = super::PLAYER_SWATCH;

/// Gap between that square and the first slot.
const BAR_GAP: f32 = 10.0;

/// The digits a group answers to, in the order a keyboard reads them.
///
/// The group's own number is the digit, and `0` sits where it does on a keyboard rather than where
/// it does in the game's table: a watcher looking for a group is looking along the number row.
const GROUP_KEYS: [u8; 10] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/// Size of one slot: the digit over what the group is, with how many tucked into its corner.
const TILE_WIDTH: f32 = 56.0;
const TILE_HEIGHT: f32 = 46.0;

/// Gap between two slots.
const TILE_GAP: f32 = 5.0;

/// The narrowest a slot is drawn, on a screen that leaves the panel less than its design width: as
/// narrow as a group of two kinds still names both of them in.
const MIN_TILE_WIDTH: f32 = 46.0;

/// The narrowest the panel is drawn at, with every slot at its narrowest. Narrower than that the
/// panel gives way rather than drop a key: the same key always being in the same place is the
/// point of it.
pub(crate) const MIN_WIDTH: f32 = PANEL_WIDTH - (TILE_WIDTH - MIN_TILE_WIDTH) * 10.0;

/// How tall the panel is, chrome included.
pub(crate) const PANEL_HEIGHT: f32 = TILE_HEIGHT + tiers::PANEL_MARGIN_HEIGHT;

/// How wide one slot is in a panel `width` wide.
fn tile_width(width: f32) -> f32 {
    let slots = GROUP_KEYS.len() as f32;
    ((tiers::panel_content_width(width) - COLOR_BAR - BAR_GAP - TILE_GAP * (slots - 1.0)) / slots)
        .min(TILE_WIDTH)
}

/// How wide the panel is drawn in `slot`, or `None` where the slot has no room for it.
pub(crate) fn fitted_width(slot: StackSlot) -> Option<f32> {
    let span = slot.place(PANEL_WIDTH);
    (span.width() >= MIN_WIDTH && slot.room() >= PANEL_HEIGHT).then_some(span.width())
}

/// The slots are the row and the row is the panel: checked where the widths are written, because
/// one slot more than fits would be drawn outside the panel's chrome.
const _: () = assert!(
    COLOR_BAR
        + BAR_GAP
        + TILE_WIDTH * GROUP_KEYS.len() as f32
        + TILE_GAP * (GROUP_KEYS.len() as f32 - 1.0)
        == CONTENT_WIDTH
);

/// Height of a slot's two lines: the digit it answers to, and what the group is.
const KEY_ROW: f32 = 11.0;
const SUBJECT_ROW: f32 = 34.0;

/// Gap between those lines.
const ROW_LEAD: f32 = 1.0;

/// A slot's lines are the slot: checked here, because a line more than fits would be drawn over the
/// slot's own chrome.
const _: () = assert!(KEY_ROW + ROW_LEAD + SUBJECT_ROW == TILE_HEIGHT);

/// Side of the icon on a slot, and of the two a group of two kinds is drawn with. As big as the
/// subject line holds: the game's icons are detailed renders that turn to smudges any smaller.
const ICON: f32 = 32.0;
const COMBO_ICON: f32 = 22.0;

/// The two icons of a group of two kinds fit the narrowest slot.
const _: () = assert!(COMBO_ICON * 2.0 + COMBO_ICON_GAP <= MIN_TILE_WIDTH);

/// How far the count stands in from the corner of the subject line it is tucked into.
const COUNT_INSET: f32 = 3.0;

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

/// How much of itself a group that has not been used in a while is drawn at.
///
/// Dimmed rather than dropped: a forgotten group is exactly what a watcher wants pointed out, and a
/// slot that emptied itself would read as a group that no longer exists.
const STALE_ALPHA: f32 = 0.7;

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
    /// Every player and what they have bound.
    pub players: Vec<ControlGroupsPlayerView>,
    /// The player whose row is shown before the watcher has picked one, where the host has a
    /// reason to start from somebody: the watcher's own seat in a replay of their own game.
    pub default_player: Option<u8>,
}

impl ControlGroupsView {
    /// Whether there is no player to draw a row for. A game where nobody has bound anything yet
    /// still has a panel: its slots are drawn empty, so the panel is already where it will be once
    /// they fill.
    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }

    /// The player whose row is drawn: `focus`, whatever they have bound, and before anyone has been
    /// focused, or once the focused player has left the game, the
    /// [default player](Self::default_player), or failing one the player in the lowest slot.
    ///
    /// A focused player with nothing bound still gets their row, empty: a watcher who clicked one
    /// player's building and was shown somebody else's keys would read them as that player's. The
    /// row shown before then does not depend on who has bound what, so it does not change hands as
    /// the players start binding.
    pub(crate) fn shown(&self, focus: Option<u8>) -> Option<&ControlGroupsPlayerView> {
        let find = |id: u8| self.players.iter().find(|player| player.player_id == id);
        focus
            .and_then(find)
            .or_else(|| self.default_player.and_then(find))
            .or_else(|| self.players.iter().min_by_key(|player| player.player_id))
    }
}

/// What the control groups panel did this frame.
pub struct ControlGroupsOutcome {
    /// Where the panel was drawn.
    pub rect: Rect,
    /// The digit of a group the watcher clicked, which recalls it as pressing the digit does.
    pub clicked: Option<u8>,
}

/// Draws the control groups panel in `slot`, fading and sliding it in and out, with the row of the
/// player `focus` names. Returns nothing at all once it is gone, in a game with no players, or
/// where the slot has no room for it.
///
/// A slot narrower than the panel's design width narrows every key's slot alike rather than
/// dropping any of them.
pub fn render_control_groups_view(
    view: &ControlGroupsView,
    ctx: &Context,
    shown: bool,
    slot: StackSlot,
    focus: Option<u8>,
) -> Option<ControlGroupsOutcome> {
    let id = Id::new("sb_control_groups_panel");
    let fitted = fitted_width(slot);
    let width = fitted.unwrap_or(PANEL_WIDTH);
    let placed = slot.place(width);
    // Pinned by its own bottom-left corner rather than by its middle: an area anchored by its
    // middle is placed from its size, which a panel coming back on screen does not know until it has
    // been laid out once, and would arrive sideways from half its width away.
    let area = Area::new(id)
        .pivot(Align2::LEFT_BOTTOM)
        .fixed_pos(pos2(placed.left, slot.screen_bottom - slot.bottom))
        .order(Order::Foreground);
    let inner = motion::presence_area(
        ctx,
        id.with("presence"),
        shown && !view.is_empty() && fitted.is_some(),
        area,
        |ui| {
            tiers::tier0_panel(ui, |ui| {
                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                ui.set_width(tiers::panel_content_width(width));
                draw_rows(ui, view, focus, width)
            })
            .inner
        },
    )?;
    Some(ControlGroupsOutcome {
        rect: inner.response.rect,
        clicked: inner.inner,
    })
}

/// Draws the one row the panel shows, across a panel `width` wide, and returns the digit of the
/// group clicked, if one was.
fn draw_rows(ui: &mut Ui, view: &ControlGroupsView, focus: Option<u8>, width: f32) -> Option<u8> {
    let mut clicked = None;
    if let Some(player) = view.shown(focus) {
        let (row, _) = ui.allocate_exact_size(
            vec2(tiers::panel_content_width(width), TILE_HEIGHT),
            Sense::hover(),
        );
        let tile_width = tile_width(width);
        let alpha = vision_alpha(player.vision);
        let mut cursor = EdgeCursor::from_left(row);
        paint_player_swatch_in(
            ui,
            cursor.take(COLOR_BAR),
            player.color,
            // The swatch keeps more of itself than the rest of a vision-less row: it is what says
            // whose row this is, and two rows dimmed alike are hard to tell apart.
            if player.vision { 1.0 } else { 0.5 },
        );
        cursor.skip(BAR_GAP);
        for (index, key) in GROUP_KEYS.into_iter().enumerate() {
            if index > 0 {
                cursor.skip(TILE_GAP);
            }
            let slot = cursor.take(tile_width);
            let group = player.groups.iter().find(|group| group.key == key);
            // Only a slot with a group on it is a target: an empty one has nothing to recall.
            let response = group.map(|_| {
                ui.interact(
                    slot,
                    Id::new(("sb_control_group_slot", key)),
                    Sense::click(),
                )
            });
            draw_slot(ui, slot, key, group, player.color, alpha, response.as_ref());
            if response.is_some_and(|response| response.clicked()) {
                clicked = Some(key);
            }
        }
    }
    clicked
}

/// Draws one slot: the digit it answers to and, when there is a group on it, what that group is and
/// how much of it there is, washed while the pointer is over it or pressing it.
fn draw_slot(
    ui: &Ui,
    rect: Rect,
    key: u8,
    group: Option<&ControlGroupView>,
    owner: Color32,
    alpha: f32,
    response: Option<&Response>,
) {
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
    paint_owner_wash(ui.painter(), rect, owner, alpha);
    if let Some(response) = response {
        widgets::state_overlay(ui, response, rect, theme::radius(theme::RADIUS_CHIP));
    }
    let subject = line(SUBJECT_ROW);
    paint_subject(ui, subject, group, owner, alpha);
    if !group.building {
        // Tucked into the corner the way the production tiles count, so the icon has the slot.
        let count = text::body(COUNT_TEXT_SIZE, text::BodyWeight::Semibold);
        let galley = count.galley(ui, &group.count.to_string());
        ui.painter().galley(
            pos2(
                subject.right() - COUNT_INSET - galley.size().x,
                subject.bottom() - COUNT_INSET - galley.size().y,
            ),
            galley,
            theme::TEXT_PRIMARY.gamma_multiply(alpha),
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

/// Draws what a group is: the game's own icons, in its `owner`'s color, where the host has them,
/// and the units' codes where it has not.
fn paint_subject(ui: &Ui, rect: Rect, group: &ControlGroupView, owner: Color32, alpha: f32) {
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
            paint_icon(ui, icon(0.0), &group.icon, first, owner, alpha);
            if let Some(combo) = &combo {
                paint_icon(ui, icon(1.0), combo, second, owner, alpha);
            }
        }
        (Some(texture), None) => paint_icon(
            ui,
            Rect::from_center_size(rect.center(), vec2(ICON, ICON)),
            &group.icon,
            texture,
            owner,
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

/// Draws one of the game's own icons, in its `owner`'s color.
fn paint_icon(
    ui: &Ui,
    rect: Rect,
    icon: &ProductionIcon,
    texture: TextureId,
    owner: Color32,
    alpha: f32,
) {
    paint_icon_glow(ui.painter(), rect, alpha);
    icon.paint(
        ui.painter(),
        texture,
        rect,
        owner_tint(owner).gamma_multiply(alpha),
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

    fn player(player_id: u8, groups: Vec<ControlGroupView>) -> ControlGroupsPlayerView {
        ControlGroupsPlayerView {
            player_id,
            color: Color32::WHITE,
            vision: true,
            groups,
        }
    }

    fn group(key: u8) -> ControlGroupView {
        ControlGroupView {
            key,
            icon: ProductionIcon {
                texture: None,
                index: 0,
                size: None,
                margin: 0.0,
                wireframe: None,
            },
            combo: None,
            count: 1,
            building: false,
            stale: false,
        }
    }

    #[test]
    fn a_game_nobody_has_bound_anything_in_still_has_a_row() {
        let view = ControlGroupsView {
            players: vec![player(4, Vec::new()), player(2, Vec::new())],
            default_player: None,
        };
        assert!(!view.is_empty());
        assert_eq!(view.shown(None).map(|player| player.player_id), Some(2));
    }

    #[test]
    fn the_row_before_a_focus_stays_put_as_players_bind() {
        let mut view = ControlGroupsView {
            players: vec![player(4, vec![group(1)]), player(2, Vec::new())],
            default_player: None,
        };
        assert_eq!(view.shown(None).map(|player| player.player_id), Some(2));
        view.default_player = Some(4);
        assert_eq!(view.shown(None).map(|player| player.player_id), Some(4));
        // A focus still wins, and a default the game has no row for falls back to the lowest slot.
        assert_eq!(view.shown(Some(2)).map(|player| player.player_id), Some(2));
        view.default_player = Some(7);
        assert_eq!(view.shown(None).map(|player| player.player_id), Some(2));
    }

    #[test]
    fn a_focused_player_who_left_hands_the_row_on() {
        let view = ControlGroupsView {
            players: vec![player(4, vec![group(1)]), player(2, Vec::new())],
            default_player: None,
        };
        // Player 6 has left the game, and with it the panel's rows.
        assert_eq!(view.shown(Some(6)).map(|player| player.player_id), Some(2));
    }

    #[test]
    fn the_slots_are_the_number_row_rather_than_the_games_own_order() {
        assert_eq!(GROUP_KEYS.first(), Some(&1));
        assert_eq!(GROUP_KEYS.last(), Some(&0));
    }
}
