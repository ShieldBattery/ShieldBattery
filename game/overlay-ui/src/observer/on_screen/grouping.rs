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
//! screens' worth of tiles away apart. Zoomed out, where that is closer on the screen than two
//! labels need to stand apart, the reach is that room instead, so groups merge as the view zooms
//! out.
//!
//! Two units on the same orders, sent to the same place or at the same target, have a longer reach
//! between them: units sent somewhere together string out along the way, the faster ahead of the
//! slower, and are still the one force their player is moving. The orders only lengthen the
//! reach. Units standing together are a group whatever each has been told to do, as the marines
//! and medics of one army are while each is told something else.
//!
//! Workers at work are never joined with anything but others at the same work, however near: an
//! army standing in a mineral line is counted as the army, the base's workers as the base's
//! workers, and the worker putting up a building beside them on its own. A base's workers are one
//! group however far apart their gathering takes them, between the base and the far end of its
//! mineral line, and never one with those of another base. A worker that is at neither work, one
//! pulled to fight or sent to scout, groups as any other unit does.
//!
//! Where units stand changes faster than the groups are let to (see [`settle_into_groups`]): a
//! unit has to have stood apart from its group, or with another, for a while before it is counted
//! that way. Units on the move drift apart and close up again all the time, and a group that
//! split and joined with every such drift would have its label jumping between them.

use std::cmp::Reverse;
use std::collections::HashMap;

use egui::Pos2;

use super::WorkerJob;

/// How far apart on the map, in its pixels, two units can stand and still be together.
const UNIT_REACH: f32 = 96.0;

/// How close on the screen, in points, two units always are together: about half a label, so the
/// labels of two groups always have room to stand apart.
const LABEL_ROOM: f32 = 96.0;

/// How much further than its reach two units that were together the frame before stay together.
const KEEP_TOGETHER: f32 = 1.25;

/// A unit to group: where it stands on the screen, the work it is at, if it is a worker at work,
/// and the orders it is on, as a number two units on the same orders share.
pub(super) struct Member {
    pub at: Pos2,
    pub job: Option<WorkerJob>,
    pub orders: Option<u64>,
}

/// Splits `members` into the groups they stand in, each as indices into `members`, in the order of
/// each group's first member. `points_per_map_pixel` is how many points on the screen one of the
/// map's pixels takes up, or 0 where that is not known, which leaves only [`LABEL_ROOM`].
/// `same_orders_reach` is how far apart on the map, in its pixels, two units on the same orders
/// can stand and still be together. `were_together` says whether two members, by index, were in
/// one group the frame before.
pub(super) fn stand_together(
    members: &[Member],
    points_per_map_pixel: f32,
    same_orders_reach: f32,
    were_together: impl Fn(usize, usize) -> bool,
) -> Vec<Vec<usize>> {
    let reach = (UNIT_REACH * points_per_map_pixel).max(LABEL_ROOM);
    let same_orders_reach = (same_orders_reach * points_per_map_pixel).max(reach);
    let mut parent: Vec<usize> = (0..members.len()).collect();
    for (a, first) in members.iter().enumerate() {
        for (b, second) in members.iter().enumerate().skip(a + 1) {
            if first.job != second.job {
                continue;
            }
            let same_base = matches!(first.job, Some(WorkerJob::AtBase { .. }));
            let kept = if were_together(a, b) {
                KEEP_TOGETHER
            } else {
                1.0
            };
            let reach = if first.orders.is_some() && first.orders == second.orders {
                same_orders_reach
            } else {
                reach
            };
            if same_base || first.at.distance(second.at) <= reach * kept {
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

/// The groups as they were settled a frame ago, kept while the count is up.
#[derive(Clone, Default, Debug)]
pub(super) struct Groups {
    /// The group each unit is in, by the unit's id and the group's key.
    pub group_of: HashMap<u32, u32>,
    /// How long, in seconds, each unit that no longer stands as its group has it has been so.
    pub out_of_step: HashMap<u32, f32>,
    /// The key the next new group gets. A group keeps its key for as long as it lasts, and no
    /// other group is given it after.
    pub next_key: u32,
}

/// The groups to count this frame, each with its key and its members as indices into `ids`, in
/// the order of each group's first member: the groups of the frame before, `before`, changed only
/// where the units have stood otherwise for `regroup_secs`. `stand` is how the units stand now (see
/// [`stand_together`]), `ids` their ids, and `seconds` how long it is since the frame before. What
/// is kept for the next frame is added to `after`, which starts out with `before`'s next key.
/// `joined_at_once` says, of each of `stand`, whether what stands there is counted there without
/// the wait.
///
/// Each earlier group goes on where most of it stands, and what stands there with it but was in
/// another group, or apart from it though it was in this one, is out of step with its group. A
/// unit out of step stays in its group until it has been so for `regroup_secs` without a break,
/// then joins the group going on where it stands, or, with others that left with it, a new one.
/// So the units of a group that parts in two leave it together, a group that meets a bigger one
/// joins it whole, and units that close up again before then were never counted apart. A unit new
/// to the view has no group to stay in, and is counted where it stands at once.
///
/// So is a worker that has gone to work at a base, which is where its count is looked for: kept
/// in the group it came from, it would be a second count of that base's workers next to the
/// first. One leaving a base's workers waits as any unit does, which is what keeps a worker that
/// is off its work for a few frames from being counted out and in again.
pub(super) fn settle_into_groups(
    stand: &[Vec<usize>],
    joined_at_once: &[bool],
    ids: &[u32],
    before: &Groups,
    after: &mut Groups,
    seconds: f32,
    regroup_secs: f32,
) -> Vec<(u32, Vec<usize>)> {
    let mut standing = vec![0; ids.len()];
    for (place, members) in stand.iter().enumerate() {
        for &member in members {
            standing[member] = place;
        }
    }
    let was: Vec<Option<u32>> = ids
        .iter()
        .map(|id| before.group_of.get(id).copied())
        .collect();
    // How many of each earlier group stand in each place, and the lowest id among them.
    let mut shares: HashMap<(u32, usize), (usize, u32)> = HashMap::new();
    for (member, key) in was.iter().enumerate() {
        if let Some(key) = *key {
            let share = shares
                .entry((key, standing[member]))
                .or_insert((0, u32::MAX));
            share.0 += 1;
            share.1 = share.1.min(ids[member]);
        }
    }
    // Where each earlier group goes on: the place most of it stands, and of two with as many, the
    // one its lowest id is in, so that it is the same place from frame to frame.
    let mut goes_on: HashMap<u32, (usize, usize, u32)> = HashMap::new();
    for (&(key, place), &(count, lowest)) in &shares {
        let better = goes_on
            .get(&key)
            .is_none_or(|&(_, most, id)| (count, Reverse(lowest)) > (most, Reverse(id)));
        if better {
            goes_on.insert(key, (place, count, lowest));
        }
    }
    // The group that goes on in each place: of those that would, the one with most units there.
    let mut holder: Vec<Option<(u32, usize)>> = vec![None; stand.len()];
    for (&key, &(place, count, _)) in &goes_on {
        let better =
            holder[place].is_none_or(|(held, most)| (count, Reverse(key)) > (most, Reverse(held)));
        if better {
            holder[place] = Some((key, count));
        }
    }

    let mut new_keys: Vec<Option<u32>> = vec![None; stand.len()];
    let mut groups: Vec<(u32, Vec<usize>)> = Vec::new();
    for member in 0..ids.len() {
        let place = standing[member];
        let stands_with = holder[place].map(|(key, _)| key);
        let stays = match was[member] {
            Some(key) if stands_with != Some(key) && !joined_at_once[place] => {
                let waited = before.out_of_step.get(&ids[member]).unwrap_or(&0.0) + seconds;
                (waited < regroup_secs).then(|| {
                    after.out_of_step.insert(ids[member], waited);
                    key
                })
            }
            _ => None,
        };
        let key = stays.or(stands_with).unwrap_or_else(|| {
            *new_keys[place].get_or_insert_with(|| {
                after.next_key += 1;
                after.next_key - 1
            })
        });
        after.group_of.insert(ids[member], key);
        match groups.iter_mut().find(|(group, _)| *group == key) {
            Some((_, members)) => members.push(member),
            None => groups.push((key, vec![member])),
        }
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

    /// How far units on the same orders reach, in the map's pixels.
    const SAME_ORDERS_REACH: f32 = 220.0;

    fn unit(x: f32, y: f32) -> Member {
        Member {
            at: pos2(x, y),
            job: None,
            orders: None,
        }
    }

    /// A worker gathering at the first base.
    fn gatherer(x: f32, y: f32) -> Member {
        Member {
            at: pos2(x, y),
            job: Some(WorkerJob::AtBase { base: 0 }),
            orders: None,
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
        let mut sizes: Vec<usize> = stand_together(members, scale, SAME_ORDERS_REACH, |_, _| false)
            .iter()
            .map(Vec::len)
            .collect();
        sizes.sort_unstable();
        sizes
    }

    #[test]
    fn the_workers_gathering_at_a_base_are_one_group_however_far_apart() {
        // One at the base, the rest strung along its mineral line, further from each other than
        // anything else would be together.
        let mut workers = vec![
            gatherer(300.0, 200.0),
            gatherer(300.0 + 250.0 * SCALE, 200.0),
            gatherer(300.0 + 250.0 * SCALE, 200.0 + 200.0 * SCALE),
        ];
        assert_eq!(group_sizes(&workers, SCALE), vec![3]);
        let others: Vec<Member> = workers.iter().map(|w| unit(w.at.x, w.at.y)).collect();
        assert_eq!(group_sizes(&others, SCALE), vec![1, 1, 1]);
        // One gathering at another base, standing right by them, is not one of them.
        workers.push(Member {
            at: pos2(310.0, 200.0),
            job: Some(WorkerJob::AtBase { base: 1 }),
            orders: None,
        });
        assert_eq!(group_sizes(&workers, SCALE), vec![1, 3]);
    }

    #[test]
    fn an_army_among_a_base_s_gathering_workers_is_a_group_of_its_own() {
        // Zealots standing in a mineral line, among the probes working it.
        let mut members = vec![
            gatherer(300.0, 300.0),
            unit(310.0, 300.0),
            gatherer(320.0, 300.0),
            unit(330.0, 300.0),
            gatherer(340.0, 300.0),
        ];
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false),
            vec![vec![0, 2, 4], vec![1, 3]]
        );
        // Apart however far out the view is, and whatever they were the frame before.
        assert_eq!(group_sizes(&members, 0.0), vec![2, 3]);
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| true).len(),
            2
        );
        // A worker pulled off the line to fight is one of the army.
        members[2].job = None;
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false),
            vec![vec![0, 4], vec![1, 2, 3]]
        );
        // And one putting up a building there is neither the army's nor the line's.
        members[2].job = Some(WorkerJob::Building);
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false),
            vec![vec![0, 4], vec![1, 3], vec![2]]
        );
        // Two of them at one site are together.
        members[1].job = Some(WorkerJob::Building);
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false),
            vec![vec![0, 4], vec![1, 2], vec![3]]
        );
    }

    /// The groups units standing as `stand` settle into `seconds` after `before`, regrouping after
    /// a second, and what is kept of them.
    fn settled(
        stand: &[Vec<usize>],
        ids: &[u32],
        before: &Groups,
        seconds: f32,
    ) -> (Vec<(u32, Vec<usize>)>, Groups) {
        let mut after = Groups {
            next_key: before.next_key,
            ..Default::default()
        };
        let waits = vec![false; stand.len()];
        let groups = settle_into_groups(stand, &waits, ids, before, &mut after, seconds, 1.0);
        (groups, after)
    }

    #[test]
    fn a_worker_gone_to_work_at_a_base_is_counted_with_its_workers_at_once() {
        // Two groups, then one of the first's units standing as the second's do, at a base.
        let ids = [51, 52, 53, 54];
        let (_, kept) = settled(&[vec![0, 1], vec![2, 3]], &ids, &Groups::default(), 0.1);
        let stand = [vec![0], vec![1, 2, 3]];
        let mut after = Groups {
            next_key: kept.next_key,
            ..Default::default()
        };
        let groups = settle_into_groups(&stand, &[false, true], &ids, &kept, &mut after, 0.1, 1.0);
        assert_eq!(groups, vec![(0, vec![0]), (1, vec![1, 2, 3])]);
        assert!(after.out_of_step.is_empty());
    }

    #[test]
    fn units_that_part_only_briefly_were_never_counted_apart() {
        let ids = [11, 12, 13, 14];
        let together = [vec![0, 1, 2, 3]];
        let parted = [vec![0, 1, 2], vec![3]];
        let (groups, mut kept) = settled(&together, &ids, &Groups::default(), 0.1);
        assert_eq!(groups, vec![(0, vec![0, 1, 2, 3])]);
        // One strays for most of a second, comes back, and strays again: one group throughout,
        // the time it strayed before not counting toward the next.
        for stand in [&parted[..], &together[..], &parted[..]] {
            for _ in 0..8 {
                let (groups, now) = settled(stand, &ids, &kept, 0.1);
                assert_eq!(groups, vec![(0, vec![0, 1, 2, 3])]);
                kept = now;
            }
        }
        // Once it has stayed away a second, it is a group of its own, and the rest keep theirs.
        let mut groups = Vec::new();
        for _ in 0..3 {
            (groups, kept) = settled(&parted, &ids, &kept, 0.1);
        }
        assert_eq!(groups, vec![(0, vec![0, 1, 2]), (1, vec![3])]);
        assert!(kept.out_of_step.is_empty());
    }

    #[test]
    fn groups_that_meet_only_briefly_stay_two_and_then_the_smaller_joins_the_bigger() {
        let ids = [21, 22, 23, 24, 25];
        let apart = [vec![0, 1], vec![2, 3, 4]];
        let met = [vec![0, 1, 2, 3, 4]];
        let (groups, mut kept) = settled(&apart, &ids, &Groups::default(), 0.1);
        assert_eq!(groups, vec![(0, vec![0, 1]), (1, vec![2, 3, 4])]);
        for _ in 0..9 {
            let (groups, now) = settled(&met, &ids, &kept, 0.1);
            assert_eq!(groups, vec![(0, vec![0, 1]), (1, vec![2, 3, 4])]);
            kept = now;
        }
        let (groups, kept) = settled(&met, &ids, &kept, 0.1);
        assert_eq!(groups, vec![(1, vec![0, 1, 2, 3, 4])]);
        // Parting again after that is a new group for the ones that leave, not the old one back.
        let mut kept = kept;
        let mut groups = Vec::new();
        for _ in 0..10 {
            (groups, kept) = settled(&apart, &ids, &kept, 0.1);
        }
        assert_eq!(groups, vec![(2, vec![0, 1]), (1, vec![2, 3, 4])]);
    }

    #[test]
    fn a_group_parting_evenly_goes_on_where_its_lowest_id_is() {
        let ids = [34, 31, 33, 32];
        let (_, mut kept) = settled(&[vec![0, 1, 2, 3]], &ids, &Groups::default(), 0.1);
        let mut groups = Vec::new();
        for _ in 0..10 {
            (groups, kept) = settled(&[vec![0, 2], vec![1, 3]], &ids, &kept, 0.1);
        }
        assert_eq!(groups, vec![(1, vec![0, 2]), (0, vec![1, 3])]);
    }

    #[test]
    fn a_unit_new_to_the_view_is_counted_where_it_stands_at_once() {
        let (_, kept) = settled(&[vec![0, 1]], &[41, 42], &Groups::default(), 0.1);
        // One comes into view among them, and one somewhere else.
        let (groups, kept) = settled(&[vec![0, 1, 2], vec![3]], &[41, 42, 43, 44], &kept, 0.1);
        assert_eq!(groups, vec![(0, vec![0, 1, 2]), (1, vec![3])]);
        assert!(kept.out_of_step.is_empty());
    }

    #[test]
    fn units_strung_out_on_the_same_orders_are_one_group() {
        // Five corsairs flying to one place, each some four tiles behind the last: too far apart
        // to be together but for their orders.
        let sent = |x: f32, orders| Member {
            orders,
            ..unit(100.0 + x * SCALE, 300.0)
        };
        let gaps = [0.0, 130.0, 250.0, 380.0, 500.0];
        let flight: Vec<Member> = gaps.iter().map(|&x| sent(x, Some(7))).collect();
        assert_eq!(group_sizes(&flight, SCALE), vec![5]);
        // With nothing to do, or each sent somewhere else, they are five.
        let idle: Vec<Member> = gaps.iter().map(|&x| sent(x, None)).collect();
        assert_eq!(group_sizes(&idle, SCALE), vec![1, 1, 1, 1, 1]);
        let scattered: Vec<Member> = (0u64..)
            .zip(gaps)
            .map(|(orders, x)| sent(x, Some(orders)))
            .collect();
        assert_eq!(group_sizes(&scattered, SCALE), vec![1, 1, 1, 1, 1]);
        // The same orders only reach so far: one a screen away is not with them.
        let mut flight = flight;
        flight.push(sent(1000.0, Some(7)));
        assert_eq!(group_sizes(&flight, SCALE), vec![1, 5]);
        // And units standing together are a group whatever they have each been told.
        let army = [sent(0.0, Some(1)), sent(20.0, Some(2)), sent(40.0, None)];
        assert_eq!(group_sizes(&army, SCALE), vec![3]);
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
        let before = stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false);
        let shift = vec2(37.25, -11.5);
        for member in &mut members {
            member.at += shift;
        }
        members.push(unit(2000.0, 1200.0));
        let after = stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false);
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
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false).len(),
            2
        );
        assert_eq!(
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| true).len(),
            1
        );
        // And well past it, apart whatever they were.
        let apart = [unit(100.0, 100.0), unit(100.0 + 150.0 * SCALE, 100.0)];
        assert_eq!(
            stand_together(&apart, SCALE, SAME_ORDERS_REACH, |_, _| true).len(),
            2
        );
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
            stand_together(&members, SCALE, SAME_ORDERS_REACH, |_, _| false),
            vec![vec![0, 2], vec![1, 3]]
        );
        assert!(stand_together(&[], SCALE, SAME_ORDERS_REACH, |_, _| false).is_empty());
    }
}
