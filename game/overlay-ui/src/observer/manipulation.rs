//! Geometry for dragging and snapping observer windows.

use egui::{Pos2, Rect};

/// The flush-connected windows carried by dragging `root`, including `root` itself.
/// Connections run down a stack or sideways at the same level; dragging a lower window detaches
/// that part of the stack without pulling the windows above it.
pub(crate) fn attached_chain(root: usize, rects: &[Rect]) -> Vec<usize> {
    if root >= rects.len() || !rect_is_finite(rects[root]) {
        return Vec::new();
    }
    let mut chain = vec![root];
    let mut cursor = 0;
    while cursor < chain.len() {
        let parent = rects[chain[cursor]];
        for (index, &child) in rects.iter().enumerate() {
            if chain.contains(&index) || !rect_is_finite(child) {
                continue;
            }
            let overlap_x = parent.right().min(child.right()) - parent.left().max(child.left());
            let overlap_y = parent.bottom().min(child.bottom()) - parent.top().max(child.top());
            let below = (child.top() - parent.bottom()).abs() <= 1.0 && overlap_x > 1.0;
            let beside = child.top() >= parent.top() - 1.0
                && overlap_y > 1.0
                && ((child.left() - parent.right()).abs() <= 1.0
                    || (child.right() - parent.left()).abs() <= 1.0);
            if below || beside {
                chain.push(index);
            }
        }
        cursor += 1;
    }
    chain
}

/// Snaps a rect to the viewport or nearby rects, then keeps it reachable from the viewport.
pub fn snap_rect(rect: Rect, targets: &[Rect], screen: Rect, threshold: f32) -> Rect {
    if !rect_is_finite(rect)
        || !rect_is_finite(screen)
        || screen.width() < 0.0
        || screen.height() < 0.0
    {
        return rect;
    }

    let threshold = threshold.max(0.0);
    let mut x = AxisSnap::new();
    let mut y = AxisSnap::new();

    x.consider(screen.left() - rect.left(), threshold);
    x.consider(screen.right() - rect.right(), threshold);
    y.consider(screen.top() - rect.top(), threshold);
    y.consider(screen.bottom() - rect.bottom(), threshold);

    for &target in targets {
        if !rect_is_finite(target) {
            continue;
        }
        if ranges_near(
            rect.top(),
            rect.bottom(),
            target.top(),
            target.bottom(),
            threshold,
        ) {
            x.consider(target.left() - rect.left(), threshold);
            x.consider(target.right() - rect.right(), threshold);
            x.consider(target.left() - rect.right(), threshold);
            x.consider(target.right() - rect.left(), threshold);
        }
        if ranges_near(
            rect.left(),
            rect.right(),
            target.left(),
            target.right(),
            threshold,
        ) {
            y.consider(target.top() - rect.top(), threshold);
            y.consider(target.bottom() - rect.bottom(), threshold);
            y.consider(target.top() - rect.bottom(), threshold);
            y.consider(target.bottom() - rect.top(), threshold);
        }
    }

    let snapped = rect.translate(egui::vec2(x.offset, y.offset));
    keep_reachable(snapped, screen)
}

#[derive(Default)]
struct AxisSnap {
    offset: f32,
    distance: f32,
}

impl AxisSnap {
    fn new() -> Self {
        Self {
            offset: 0.0,
            distance: f32::INFINITY,
        }
    }

    fn consider(&mut self, offset: f32, threshold: f32) {
        let distance = offset.abs();
        if offset.is_finite() && distance <= threshold && distance < self.distance {
            self.offset = offset;
            self.distance = distance;
        }
    }
}

fn keep_reachable(rect: Rect, screen: Rect) -> Rect {
    let x = reachable_origin(rect.left(), rect.width(), screen.left(), screen.right());
    let y = reachable_origin(rect.top(), rect.height(), screen.top(), screen.bottom());
    rect.translate(egui::vec2(x - rect.left(), y - rect.top()))
}

fn reachable_origin(origin: f32, length: f32, screen_min: f32, screen_max: f32) -> f32 {
    let screen_length = screen_max - screen_min;
    if length <= screen_length {
        return origin.clamp(screen_min, screen_max - length);
    }

    // Alt-drag works anywhere on a surface, so a visible strip keeps oversized panels movable.
    let reachable = screen_length.min(32.0);
    origin.clamp(screen_min - length + reachable, screen_max - reachable)
}

fn ranges_near(a_min: f32, a_max: f32, b_min: f32, b_max: f32, allowance: f32) -> bool {
    a_min <= b_max + allowance && b_min <= a_max + allowance
}

fn pos_is_finite(pos: Pos2) -> bool {
    pos.x.is_finite() && pos.y.is_finite()
}

fn rect_is_finite(rect: Rect) -> bool {
    pos_is_finite(rect.min) && pos_is_finite(rect.max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::{pos2, vec2};

    fn rect(x: f32, y: f32, width: f32, height: f32) -> Rect {
        Rect::from_min_size(pos2(x, y), vec2(width, height))
    }

    #[test]
    fn snaps_to_viewport_edges_with_a_nonzero_origin_and_clamps_fit_panels() {
        let screen = rect(100.0, 200.0, 400.0, 300.0);
        let near = snap_rect(rect(105.0, 490.0, 80.0, 40.0), &[], screen, 12.0);
        assert_eq!(near.left_top(), pos2(100.0, 460.0));

        let escaped = snap_rect(rect(-100.0, 900.0, 80.0, 40.0), &[], screen, 12.0);
        assert_eq!(escaped.left_top(), pos2(100.0, 460.0));
    }

    #[test]
    fn snaps_adjacent_and_aligned_edges_when_the_other_axis_is_nearby() {
        let screen = rect(0.0, 0.0, 800.0, 600.0);
        let target = rect(300.0, 100.0, 100.0, 100.0);
        let adjacent = snap_rect(rect(203.0, 110.0, 100.0, 80.0), &[target], screen, 10.0);
        assert_eq!(adjacent.right(), 300.0);
        assert_eq!(adjacent.top(), 100.0);

        let aligned = snap_rect(rect(305.0, 205.0, 80.0, 70.0), &[target], screen, 10.0);
        assert_eq!(aligned.left(), 300.0);
        assert_eq!(aligned.top(), 200.0);
    }

    #[test]
    fn ignores_distant_panels_and_displacements_beyond_the_threshold() {
        let screen = rect(0.0, 0.0, 1_000.0, 1_000.0);
        let distant = rect(300.0, 500.0, 100.0, 100.0);
        let result = snap_rect(rect(193.0, 0.0, 100.0, 80.0), &[distant], screen, 10.0);
        assert_eq!(result, rect(193.0, 0.0, 100.0, 80.0));

        let near_axis = rect(300.0, 5.0, 100.0, 100.0);
        let beyond = snap_rect(rect(180.0, 0.0, 100.0, 80.0), &[near_axis], screen, 10.0);
        assert_eq!(beyond.left(), 180.0);
    }

    #[test]
    fn large_panels_keep_a_grabbable_strip_on_screen() {
        let screen = rect(100.0, 200.0, 200.0, 100.0);
        let result = snap_rect(rect(-1_000.0, 900.0, 500.0, 300.0), &[], screen, 8.0);
        assert!(result.right() >= screen.left() + 32.0);
        assert!(result.top() <= screen.bottom() - 32.0);
    }
    #[test]
    fn chains_follow_flush_edges_but_exclude_gaps_overlaps_and_windows_above() {
        let windows = [
            rect(100.0, 100.0, 100.0, 80.0),
            rect(100.0, 180.0, 100.0, 80.0),
            rect(200.0, 180.0, 100.0, 80.0),
            rect(100.0, 260.0, 100.0, 80.0),
            rect(100.0, 350.0, 100.0, 80.0),
            rect(110.0, 200.0, 30.0, 30.0),
        ];
        assert_eq!(attached_chain(0, &windows), vec![0, 1, 2, 3]);
        assert_eq!(attached_chain(1, &windows), vec![1, 2, 3]);
        assert_eq!(attached_chain(4, &windows), vec![4]);
        assert!(attached_chain(20, &windows).is_empty());
    }
}
