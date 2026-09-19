//! The small card that names whatever the pointer is resting on.

use egui::emath::TSTransform;
use egui::{Area, Context, Id, Order, Pos2, Rect, Shape, Stroke, StrokeKind, Ui, Vec2, vec2};

use crate::kit::theme;
use crate::kit::tiers;

/// How far the card is held off the pointer, which has to clear the cursor the game is drawing.
const POINTER_GAP: f32 = 14.0;

/// How close to the screen's own edge the card may come.
const EDGE_MARGIN: f32 = 8.0;

/// Draws a card at `anchor` — the pointer — carrying whatever `add` puts in it.
///
/// The card is drawn at the tier-1 gradient rather than the ambient fill every panel around it
/// wears: it is read for the second the pointer rests somewhere and then gone, and over a moving
/// game scene the quieter fill would be a second of squinting. It takes no input at all, so the
/// thing being named keeps the hover that summoned the card, and it appears and vanishes at once
/// rather than fading: a fade is read as a surface arriving, and this one is only ever the tail of
/// a pointer that is already there — half-drawn text under a pointer moving from row to row says
/// less than no text at all.
///
/// The caller decides when there is anything to say; this draws a card every time it is called.
pub fn tooltip(ctx: &Context, id: Id, anchor: Pos2, add: impl FnOnce(&mut Ui)) {
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
        TSTransform::from_translation(clamped_offset(screen, anchor, rect)),
    );
}

/// How far a card laid out below and right of `anchor` has to move to sit inside `screen`.
///
/// A card that would run off an edge is flipped to the other side of the pointer rather than slid
/// along the edge, so it never lands under the pointer and hides the thing it is naming; an edge it
/// still overhangs after the flip — a card taller than the room above and below it — is the one
/// case that gives way and slides.
fn clamped_offset(screen: Rect, anchor: Pos2, rect: Rect) -> Vec2 {
    let room = screen.shrink(EDGE_MARGIN);
    let size = rect.size();
    let mut wanted = anchor + vec2(POINTER_GAP, POINTER_GAP);
    if wanted.x + size.x > room.right() {
        wanted.x = anchor.x - POINTER_GAP - size.x;
    }
    if wanted.y + size.y > room.bottom() {
        wanted.y = anchor.y - POINTER_GAP - size.y;
    }
    wanted.x = wanted
        .x
        .clamp(room.left(), (room.right() - size.x).max(room.left()));
    wanted.y = wanted
        .y
        .clamp(room.top(), (room.bottom() - size.y).max(room.top()));
    wanted - rect.min
}

#[cfg(test)]
mod tests {
    use egui::pos2;

    use super::*;

    fn screen() -> Rect {
        Rect::from_min_size(Pos2::ZERO, vec2(1920.0, 1080.0))
    }

    /// The card as egui would have laid it out at the pointer, which is what the offset moves.
    fn laid_out(anchor: Pos2, size: Vec2) -> Rect {
        Rect::from_min_size(anchor + vec2(POINTER_GAP, POINTER_GAP), size)
    }

    #[test]
    fn a_card_with_room_stays_below_and_right_of_the_pointer() {
        let anchor = pos2(400.0, 300.0);
        let size = vec2(160.0, 60.0);
        assert_eq!(
            clamped_offset(screen(), anchor, laid_out(anchor, size)),
            Vec2::ZERO
        );
    }

    #[test]
    fn a_card_that_would_overhang_flips_to_the_other_side_of_the_pointer() {
        let anchor = pos2(1900.0, 1070.0);
        let size = vec2(160.0, 60.0);
        let rect = laid_out(anchor, size);
        let placed = Rect::from_min_size(rect.min + clamped_offset(screen(), anchor, rect), size);
        assert_eq!(placed.right(), anchor.x - POINTER_GAP);
        assert_eq!(placed.bottom(), anchor.y - POINTER_GAP);
    }

    #[test]
    fn a_card_too_tall_to_flip_gives_way_and_slides_inside_the_screen() {
        let anchor = pos2(960.0, 1000.0);
        let size = vec2(160.0, 1000.0);
        let rect = laid_out(anchor, size);
        let placed = Rect::from_min_size(rect.min + clamped_offset(screen(), anchor, rect), size);
        assert_eq!(placed.top(), EDGE_MARGIN);
    }
}
