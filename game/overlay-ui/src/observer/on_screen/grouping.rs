//! Which of a player's units on screen stand together as one group, for the on-screen count to
//! label once.
//!
//! Two units stand together when they are within reach of each other, and a group is every unit a
//! chain of such pairs joins (single linkage). Whether two units are joined depends on nothing but
//! where those two stand, and whether they were together the frame before, so panning the view, or
//! a unit coming into it somewhere else, never splits or joins a group it does not reach. Two that
//! were together keep a longer reach (see [`KEEP_TOGETHER`]), so a unit at the edge of a group
//! moving about it, as workers mining do, does not flicker in and out of it.
//!
//! The reach is measured on the map, so a group is the same units in a window of any size: about
//! three tiles, which keeps a clump and the stragglers at its edge together and an army a few
//! screens' worth of tiles away apart, or four between two workers, whose mining spreads them along
//! a base's mineral line and between it and the base further apart than an army stands. Zoomed out,
//! where that is closer on the screen than two labels need to stand apart, the reach is that room
//! instead, so groups merge as the view zooms out.

use egui::Pos2;

/// How far apart on the map, in its pixels, two units can stand and still be together.
const UNIT_REACH: f32 = 96.0;

/// How far apart on the map, in its pixels, two workers can stand and still be together.
const WORKER_REACH: f32 = 128.0;

/// How close on the screen, in points, two units always are together: about half a label, so the
/// labels of two groups always have room to stand apart.
const LABEL_ROOM: f32 = 96.0;

/// How much further than its reach two units that were together the frame before stay together.
const KEEP_TOGETHER: f32 = 1.25;

/// A unit to group: where it stands on the screen, and whether it is a worker.
pub(super) struct Member {
    pub at: Pos2,
    pub worker: bool,
}

/// Splits `members` into the groups they stand in, each as indices into `members`, in the order of
/// each group's first member. `points_per_map_pixel` is how many points on the screen one of the
/// map's pixels takes up, or 0 where that is not known, which leaves only [`LABEL_ROOM`].
/// `were_together` says whether two members, by index, were in one group the frame before.
pub(super) fn stand_together(
    members: &[Member],
    points_per_map_pixel: f32,
    were_together: impl Fn(usize, usize) -> bool,
) -> Vec<Vec<usize>> {
    let reach = |a: &Member, b: &Member| {
        let on_map = if a.worker && b.worker {
            WORKER_REACH
        } else {
            UNIT_REACH
        };
        (on_map * points_per_map_pixel).max(LABEL_ROOM)
    };
    let mut parent: Vec<usize> = (0..members.len()).collect();
    for (a, first) in members.iter().enumerate() {
        for (b, second) in members.iter().enumerate().skip(a + 1) {
            let kept = if were_together(a, b) {
                KEEP_TOGETHER
            } else {
                1.0
            };
            if first.at.distance(second.at) <= reach(first, second) * kept {
                let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
                parent[ra.max(rb)] = ra.min(rb);
            }
        }
    }

    // Every root is its group's lowest index, so a group is first seen at its first member.
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut group_of_root = vec![usize::MAX; members.len()];
    for member in 0..members.len() {
        let r = root(&mut parent, member);
        if group_of_root[r] == usize::MAX {
            group_of_root[r] = groups.len();
            groups.push(Vec::new());
        }
        groups[group_of_root[r]].push(member);
    }
    groups
}

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

#[cfg(test)]
mod tests {
    use egui::{pos2, vec2};

    use super::*;

    /// Points on the screen per map pixel in a 1440-line window, which shows about 480 lines of the
    /// map.
    const SCALE: f32 = 3.0;

    fn unit(x: f32, y: f32) -> Member {
        Member {
            at: pos2(x, y),
            worker: false,
        }
    }

    fn worker(x: f32, y: f32) -> Member {
        Member {
            at: pos2(x, y),
            worker: true,
        }
    }

    /// `count` units packed in a disc around `x`, `y`, a few points apart.
    fn pile(x: f32, y: f32, count: usize) -> Vec<Member> {
        (0..count)
            .map(|i| {
                let angle = i as f32 * 2.399;
                let radius = 12.0 * (i as f32).sqrt();
                unit(x + angle.cos() * radius, y + angle.sin() * radius)
            })
            .collect()
    }

    fn group_sizes(members: &[Member], scale: f32) -> Vec<usize> {
        let mut sizes: Vec<usize> = stand_together(members, scale, |_, _| false)
            .iter()
            .map(Vec::len)
            .collect();
        sizes.sort_unstable();
        sizes
    }

    #[test]
    fn a_base_s_workers_along_its_mineral_line_are_one_group() {
        // Six workers a little over three tiles apart, as a base's first workers spread over its
        // patches: one group as workers, and six of anything else would not be.
        let line = [
            (0.0, 0.0),
            (0.0, 110.0),
            (90.0, 190.0),
            (200.0, 210.0),
            (300.0, 160.0),
        ];
        let mut workers: Vec<Member> = line
            .iter()
            .map(|&(x, y)| worker(300.0 + x * SCALE, 200.0 + y * SCALE))
            .collect();
        workers.push(worker(300.0 + 400.0 * SCALE, 200.0 + 100.0 * SCALE));
        assert_eq!(group_sizes(&workers, SCALE), vec![6]);
        let others: Vec<Member> = workers.iter().map(|w| unit(w.at.x, w.at.y)).collect();
        assert_eq!(group_sizes(&others, SCALE), vec![1, 1, 1, 1, 1, 1]);
    }

    #[test]
    fn a_unit_at_a_clump_s_edge_is_part_of_it() {
        let mut members = pile(500.0, 500.0, 10);
        members.push(unit(500.0, 500.0 + 80.0 * SCALE));
        assert_eq!(group_sizes(&members, SCALE), vec![11]);
    }

    #[test]
    fn two_armies_far_apart_are_two_groups() {
        let mut members = pile(200.0, 500.0, 15);
        members.extend(pile(200.0 + 150.0 * SCALE, 500.0, 15));
        assert_eq!(group_sizes(&members, SCALE), vec![15, 15]);
    }

    #[test]
    fn what_joins_two_units_is_only_where_those_two_stand() {
        // Two pairs a little over the reach apart, then the same with the view panned and a unit
        // come into it at the far side: the groups are the same.
        let gap = 110.0 * SCALE;
        let mut members = vec![
            unit(100.0, 100.0),
            unit(130.0, 100.0),
            unit(100.0 + gap, 100.0),
            unit(130.0 + gap, 100.0),
        ];
        let before = stand_together(&members, SCALE, |_, _| false);
        let shift = vec2(37.25, -11.5);
        for member in &mut members {
            member.at += shift;
        }
        members.push(unit(2000.0, 1200.0));
        let after = stand_together(&members, SCALE, |_, _| false);
        assert_eq!(before, vec![vec![0, 1], vec![2, 3]]);
        assert_eq!(after, vec![vec![0, 1], vec![2, 3], vec![4]]);
    }

    #[test]
    fn zoomed_out_groups_closer_than_two_labels_need_are_one() {
        // A third of a point per map pixel: the 90 points between these is 270 pixels of map,
        // too far apart to be together on the map but too close for two labels.
        let members = [unit(100.0, 100.0), unit(190.0, 100.0)];
        assert_eq!(group_sizes(&members, 1.0 / 3.0), vec![2]);
        assert_eq!(group_sizes(&members, 0.0), vec![2]);
        let apart = [unit(100.0, 100.0), unit(300.0, 100.0)];
        assert_eq!(group_sizes(&apart, 1.0 / 3.0), vec![1, 1]);
    }

    #[test]
    fn units_together_the_frame_before_stay_together_a_little_further() {
        // A little over the reach apart: two groups, unless they were one the frame before.
        let members = [unit(100.0, 100.0), unit(100.0 + 100.0 * SCALE, 100.0)];
        assert_eq!(stand_together(&members, SCALE, |_, _| false).len(), 2);
        assert_eq!(stand_together(&members, SCALE, |_, _| true).len(), 1);
        // And well past it, apart whatever they were.
        let apart = [unit(100.0, 100.0), unit(100.0 + 150.0 * SCALE, 100.0)];
        assert_eq!(stand_together(&apart, SCALE, |_, _| true).len(), 2);
    }

    #[test]
    fn groups_come_in_the_order_of_their_first_member() {
        let members = [
            unit(900.0, 900.0),
            unit(100.0, 100.0),
            unit(910.0, 900.0),
            unit(110.0, 100.0),
        ];
        assert_eq!(
            stand_together(&members, SCALE, |_, _| false),
            vec![vec![0, 2], vec![1, 3]]
        );
        assert!(stand_together(&[], SCALE, |_, _| false).is_empty());
    }
}
