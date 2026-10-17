//! The small card that names whatever the pointer is resting on.

use egui::emath::TSTransform;
use egui::{Area, Context, Id, Order, Pos2, Rect, Shape, Stroke, StrokeKind, Ui, Vec2, pos2};

use crate::kit::theme;
use crate::kit::tiers;

/// How far the card is held off the pointer, which has to clear the cursor the game is drawing.
///
/// The game's cursor is an arrow hanging down and to the right of the pointer's tip, several times
/// taller than egui's own and larger again at the bigger cursor sizes. A card below and right of
/// the tip goes under the arrow's body unless it starts below it; a card flipped above or left of
/// the tip is clear of the arrow by any gap at all.
const POINTER_GAP: f32 = 14.0;

/// How far below the pointer's tip the card starts, which is past the bottom of the game's arrow.
const CURSOR_CLEARANCE: f32 = 40.0;

/// How close to the screen's own edge the card may come.
const EDGE_MARGIN: f32 = 8.0;

/// Draws a card at `anchor` — the pointer — carrying whatever `add` puts in it.
///
/// The card is drawn at the tier-1 gradient rather than the ambient fill: it is read for the second
/// the pointer rests somewhere, and over a moving game scene the quieter fill would be hard to read
/// in that second. It takes no input, so the thing being named keeps the hover that summoned the
/// card, and it appears and vanishes at once rather than fading: half-drawn text under a pointer
/// moving from row to row says less than no text at all.
///
/// The caller decides when there is anything to say; this draws a card every time it is called.
pub fn tooltip(ctx: &Context, id: Id, anchor: Pos2, add: impl FnOnce(&mut Ui)) {
    tooltip_on(ctx, id, anchor, TooltipSide::Below, add);
}

/// [`tooltip`], centered over the pointer instead: for a strip of controls whose card would
/// otherwise cover the controls under it, as a replay's seek bar has its buttons below it.
pub fn tooltip_above(ctx: &Context, id: Id, anchor: Pos2, add: impl FnOnce(&mut Ui)) {
    tooltip_on(ctx, id, anchor, TooltipSide::Above, add);
}

/// Which side of the pointer a card goes on where there is room for it.
#[derive(Copy, Clone)]
enum TooltipSide {
    /// Below and right, clear of the game's arrow.
    Below,
    /// Above, centered on the pointer.
    Above,
}

fn tooltip_on(ctx: &Context, id: Id, anchor: Pos2, side: TooltipSide, add: impl FnOnce(&mut Ui)) {
    let screen = ctx.viewport_rect();
    let area = Area::new(id)
        .order(Order::Tooltip)
        .interactable(false)
        .fade_in(false)
        // The card is placed by hand below, off a size only its own layout knows; egui's own
        // constraining would slide it somewhere else first and leave the two fighting.
        .constrain(false)
        // Laid out in the screen's corner rather than at the pointer, because an area is clipped to
        // the screen as it is laid out: a card built against the right edge would have its text cut
        // off there and stay cut off wherever it was then moved to.
        .fixed_pos(screen.min)
        .show(ctx, |ui| {
            // Nothing in a card wraps. An area remembers its size from frame to frame, and one card
            // after another is drawn through this same area: text that wrapped to the width of the
            // last card would come out narrower still, and narrower again the frame after.
            ui.style_mut().wrap_mode = Some(egui::TextWrapMode::Extend);
            let background = ui.painter().add(Shape::Noop);
            let inner = egui::Frame::NONE
                .inner_margin(theme::SPACE_SM)
                .show(ui, add);
            let rect = inner.response.rect;
            let corner_radius = theme::radius(theme::RADIUS_PANEL);
            ui.painter().set(
                background,
                Shape::Vec(vec![
                    tiers::gradient_round_rect(
                        rect,
                        corner_radius,
                        [theme::TIER1_FILL_TOP, theme::TIER1_FILL_BOTTOM],
                    ),
                    Shape::rect_stroke(
                        rect,
                        corner_radius,
                        Stroke::new(theme::HAIRLINE, theme::TIER1_STROKE),
                        StrokeKind::Inside,
                    ),
                ]),
            );
        });
    // The card's size is only known once it has been laid out, so it is moved into place on its own
    // layer, which the renderer applies after the pass: the first frame the pointer rests here is
    // already the settled one, with nothing jumping into place on the second.
    let rect = area.response.rect;
    ctx.set_transform_layer(
        area.response.layer_id,
        TSTransform::from_translation(clamped_offset(screen, anchor, side, rect)),
    );
}

/// How far a card laid out at `rect` has to move to sit on `side` of `anchor` inside `screen`.
///
/// A card that would run off an edge is flipped to the other side of the pointer rather than slid
/// along the edge, so it never lands under the pointer and hides the thing it is naming; an edge it
/// still overhangs after the flip — a card taller than the room above and below it — is the one
/// case that gives way and slides.
fn clamped_offset(screen: Rect, anchor: Pos2, side: TooltipSide, rect: Rect) -> Vec2 {
    let room = screen.shrink(EDGE_MARGIN);
    let size = rect.size();
    let below = anchor.y + CURSOR_CLEARANCE;
    let above = anchor.y - POINTER_GAP - size.y;
    let mut wanted = match side {
        TooltipSide::Below => pos2(anchor.x + POINTER_GAP, below),
        TooltipSide::Above => pos2(anchor.x - size.x * 0.5, above),
    };
    match side {
        TooltipSide::Below => {
            if wanted.x + size.x > room.right() {
                wanted.x = anchor.x - POINTER_GAP - size.x;
            }
            if wanted.y + size.y > room.bottom() {
                wanted.y = above;
            }
        }
        TooltipSide::Above => {
            if wanted.y < room.top() {
                wanted.y = below;
            }
        }
    }
    wanted.x = crate::kit::clamp_layout(wanted.x, room.left(), room.right() - size.x);
    wanted.y = crate::kit::clamp_layout(wanted.y, room.top(), room.bottom() - size.y);
    wanted - rect.min
}

#[cfg(test)]
mod tests {
    use egui::vec2;

    use super::*;

    fn screen() -> Rect {
        Rect::from_min_size(Pos2::ZERO, vec2(1920.0, 1080.0))
    }

    /// The card as egui would have laid it out at the pointer, which is what the offset moves.
    fn laid_out(anchor: Pos2, size: Vec2) -> Rect {
        Rect::from_min_size(anchor + vec2(POINTER_GAP, CURSOR_CLEARANCE), size)
    }

    #[test]
    fn a_card_with_room_stays_below_and_right_of_the_pointer() {
        let anchor = pos2(400.0, 300.0);
        let size = vec2(160.0, 60.0);
        assert_eq!(
            clamped_offset(screen(), anchor, TooltipSide::Below, laid_out(anchor, size)),
            Vec2::ZERO
        );
    }

    #[test]
    fn a_card_that_would_overhang_flips_to_the_other_side_of_the_pointer() {
        let anchor = pos2(1900.0, 1070.0);
        let size = vec2(160.0, 60.0);
        let rect = laid_out(anchor, size);
        let placed = Rect::from_min_size(
            rect.min + clamped_offset(screen(), anchor, TooltipSide::Below, rect),
            size,
        );
        assert_eq!(placed.right(), anchor.x - POINTER_GAP);
        assert_eq!(placed.bottom(), anchor.y - POINTER_GAP);
    }

    #[test]
    fn a_card_too_tall_to_flip_gives_way_and_slides_inside_the_screen() {
        let anchor = pos2(960.0, 1000.0);
        let size = vec2(160.0, 1000.0);
        let rect = laid_out(anchor, size);
        let placed = Rect::from_min_size(
            rect.min + clamped_offset(screen(), anchor, TooltipSide::Below, rect),
            size,
        );
        assert_eq!(placed.top(), EDGE_MARGIN);
    }

    #[test]
    fn a_card_above_is_centered_over_the_pointer_and_flips_below_without_room() {
        let size = vec2(160.0, 30.0);
        let anchor = pos2(800.0, 1000.0);
        let rect = Rect::from_min_size(Pos2::ZERO, size);
        let placed = Rect::from_min_size(
            clamped_offset(screen(), anchor, TooltipSide::Above, rect).to_pos2(),
            size,
        );
        assert_eq!(placed.center().x, anchor.x);
        assert_eq!(placed.bottom(), anchor.y - POINTER_GAP);
        let near_top = pos2(800.0, 20.0);
        let placed = Rect::from_min_size(
            clamped_offset(screen(), near_top, TooltipSide::Above, rect).to_pos2(),
            size,
        );
        assert!(placed.top() > near_top.y);
    }
}
