//! Which of a player's units on screen stand together as one group, for the on-screen count to
//! label once.
//!
//! The groups are HDBSCAN's clusters (Campello, Moulavi and Sander, 2013), over the units' places
//! on the screen. It finds groups however tightly or loosely each one is packed, and it never lets
//! fewer than [`MIN_GROUP`] units be a group of their own: a few units trailing an army are units
//! that fell out of the army, not an army. Two extensions on top of it suit a label of a fixed size
//! on the screen:
//!
//! - Groups the algorithm would split but that stand within [`SPLIT_REACH`] of each other are kept
//!   whole, as HDBSCAN(ε̂) does (Malzer and Baum, 2019). Measured on the screen, this is what makes
//!   groups merge as the view zooms out and split as it zooms in.
//! - A unit that fell out of a group joins it again while the gap it fell out at is within what the
//!   group reaches, which grows with how many units it holds (see [`group_reach`]): the stragglers a
//!   short way behind a big army are part of it, and a scout across the screen is not.
//!
//! Whatever is left, units the clusters do not take, is split into groups by distance alone.

use egui::Pos2;

/// The fewest units that are a group on their own account. Anything smaller is only ever part of a
/// bigger group or, standing apart from every group, a group of what is left over.
const MIN_GROUP: usize = 5;

/// How many of a unit's nearest neighbours the density around it is read from: the distance to the
/// furthest of them is how sparse its surroundings are, which keeps a thin line of units from
/// chaining two groups together.
const NEIGHBOURS: usize = 4;

/// How close, in points, two groups can stand and still be kept as one: about half a label, so the
/// labels of two groups always have room to stand apart.
pub(super) const SPLIT_REACH: f32 = 96.0;

/// The furthest, in points, any group reaches for a straggler.
const MAX_GROUP_REACH: f32 = 320.0;

/// How far a group of `population` units reaches for a unit that fell out of it: further the more
/// units it holds, by the fourth root of how many, so five units reach half again as far as
/// [`SPLIT_REACH`], sixteen twice as far and eighty-one three times, short of [`MAX_GROUP_REACH`].
/// A big army spreads over more ground than a handful of units, and the gaps inside it grow with it.
fn group_reach(population: usize) -> f32 {
    (SPLIT_REACH * (population as f32).powf(0.25)).min(MAX_GROUP_REACH)
}

/// One merge of the tree single linkage builds: the two subtrees it joins (a point's index below
/// the number of points, a merge's index past them), the distance they join at, and how many points
/// the result holds.
struct Merge {
    left: usize,
    right: usize,
    distance: f32,
    size: usize,
}

/// A cluster of the condensed tree: the one it split off from, the distance it appeared at, its
/// size then, its stability (how long its points stayed in it, summed), and the clusters it split
/// into.
struct Cluster {
    parent: Option<usize>,
    birth: f32,
    size: usize,
    stability: f32,
    children: Vec<usize>,
}

/// Splits `points` into the groups they stand in, each as indices into `points`, in the order of
/// each group's first point.
pub(super) fn stand_together(points: &[Pos2]) -> Vec<Vec<usize>> {
    let n = points.len();
    if n == 0 {
        return Vec::new();
    }
    let merges = single_linkage(points);
    let (clusters, fell_out) = condense(n, &merges);
    let chosen = choose(&clusters);

    let mut group_of = vec![None; n];
    for (point, &(home, distance)) in fell_out.iter().enumerate() {
        let mut cluster = Some(home);
        while let Some(c) = cluster {
            if chosen[c] {
                if distance <= group_reach(clusters[c].size) {
                    group_of[point] = Some(c);
                }
                break;
            }
            cluster = clusters[c].parent;
        }
    }

    // What no cluster took is split by distance alone, at the reach two groups are kept whole at.
    let left_over: Vec<usize> = (0..n).filter(|&i| group_of[i].is_none()).collect();
    let mut parent: Vec<usize> = (0..left_over.len()).collect();
    for a in 0..left_over.len() {
        for b in a + 1..left_over.len() {
            if points[left_over[a]].distance(points[left_over[b]]) <= SPLIT_REACH {
                let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
                parent[ra.max(rb)] = ra.min(rb);
            }
        }
    }

    // Each point's group, keyed so a cluster and a set of left-over points cannot share a key.
    let key = |point: usize, parent: &mut [usize]| match group_of[point] {
        Some(cluster) => cluster,
        None => {
            let index = left_over.binary_search(&point).unwrap_or(0);
            clusters.len() + root(parent, index)
        }
    };
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut group_of_key = vec![usize::MAX; clusters.len() + left_over.len()];
    for point in 0..n {
        let k = key(point, &mut parent);
        if group_of_key[k] == usize::MAX {
            group_of_key[k] = groups.len();
            groups.push(Vec::new());
        }
        groups[group_of_key[k]].push(point);
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

/// The single-linkage tree of `points` under mutual reachability: the distance between two points,
/// or how sparse the surroundings of either one are where that is further (see [`NEIGHBOURS`]).
/// Built from the minimum spanning tree, its edges joined shortest first.
fn single_linkage(points: &[Pos2]) -> Vec<Merge> {
    let n = points.len();
    let distance = |a: usize, b: usize| points[a].distance(points[b]);
    let sparseness: Vec<f32> = (0..n)
        .map(|i| {
            let mut around: Vec<f32> = (0..n).filter(|&j| j != i).map(|j| distance(i, j)).collect();
            around.sort_by(f32::total_cmp);
            around
                .get(NEIGHBOURS - 1)
                .or(around.last())
                .copied()
                .unwrap_or(0.0)
        })
        .collect();
    let reachability = |a: usize, b: usize| distance(a, b).max(sparseness[a]).max(sparseness[b]);

    // Prim's algorithm over the complete graph, which at a screen's worth of units is cheaper than
    // building the graph's edges to sort.
    let mut in_tree = vec![false; n];
    let mut nearest = vec![f32::INFINITY; n];
    let mut nearest_from = vec![0; n];
    let mut edges = Vec::with_capacity(n.saturating_sub(1));
    let mut next = 0;
    for _ in 0..n {
        in_tree[next] = true;
        if next != 0 {
            edges.push((nearest[next], nearest_from[next], next));
        }
        let mut best = None;
        for other in 0..n {
            if in_tree[other] {
                continue;
            }
            let reach = reachability(next, other);
            if reach < nearest[other] {
                nearest[other] = reach;
                nearest_from[other] = next;
            }
            if best.is_none_or(|best: usize| nearest[other] < nearest[best]) {
                best = Some(other);
            }
        }
        match best {
            Some(best) => next = best,
            None => break,
        }
    }
    edges.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut parent: Vec<usize> = (0..n).collect();
    let mut node_of_root: Vec<usize> = (0..n).collect();
    let size = |node: usize, merges: &[Merge]| if node < n { 1 } else { merges[node - n].size };
    let mut merges: Vec<Merge> = Vec::with_capacity(n.saturating_sub(1));
    for (distance, a, b) in edges {
        let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
        let (left, right) = (node_of_root[ra], node_of_root[rb]);
        merges.push(Merge {
            left,
            right,
            distance,
            size: size(left, &merges) + size(right, &merges),
        });
        let kept = ra.min(rb);
        parent[ra.max(rb)] = kept;
        node_of_root[kept] = n + merges.len() - 1;
    }
    merges
}

/// How sharply a cluster holds together at `distance`: HDBSCAN's lambda, the inverse of the
/// distance, so a cluster that lasts from a long distance down to a short one has a large span.
fn lambda(distance: f32) -> f32 {
    1.0 / distance.max(f32::EPSILON)
}

/// The condensed tree of `merges` over `n` points: walking down from the whole set, a split that
/// leaves both sides at least [`MIN_GROUP`] strong is two new clusters, and one that leaves a side
/// smaller is that side's points falling out of the cluster. Returns the clusters, the root first
/// and every cluster after the one it split off from, and for each point the cluster it fell out of
/// and the distance it fell out at.
fn condense(n: usize, merges: &[Merge]) -> (Vec<Cluster>, Vec<(usize, f32)>) {
    let size = |node: usize| if node < n { 1 } else { merges[node - n].size };
    let points_of = |node: usize| {
        let mut points = Vec::new();
        let mut stack = vec![node];
        while let Some(node) = stack.pop() {
            if node < n {
                points.push(node);
            } else {
                let merge = &merges[node - n];
                stack.extend([merge.left, merge.right]);
            }
        }
        points
    };
    let mut clusters = vec![Cluster {
        parent: None,
        birth: f32::INFINITY,
        size: n,
        stability: 0.0,
        children: Vec::new(),
    }];
    let mut fell_out = vec![(0, 0.0); n];
    let mut stack = vec![(n + merges.len().saturating_sub(1), 0)];
    if merges.is_empty() {
        // A single point: it is the whole tree, and falls out of the root at once.
        fell_out[0] = (0, 0.0);
        return (clusters, fell_out);
    }
    while let Some((node, cluster)) = stack.pop() {
        let born = lambda(clusters[cluster].birth);
        if node < n {
            // Only reached for a cluster of one point, which MIN_GROUP rules out; it falls out where
            // it stands.
            fell_out[node] = (cluster, 0.0);
            continue;
        }
        let merge = &merges[node - n];
        let split = lambda(merge.distance);
        let left_real = size(merge.left) >= MIN_GROUP;
        let right_real = size(merge.right) >= MIN_GROUP;
        match (left_real, right_real) {
            (true, true) => {
                clusters[cluster].stability += merge.size as f32 * (split - born);
                for side in [merge.left, merge.right] {
                    let child = clusters.len();
                    clusters.push(Cluster {
                        parent: Some(cluster),
                        birth: merge.distance,
                        size: size(side),
                        stability: 0.0,
                        children: Vec::new(),
                    });
                    clusters[cluster].children.push(child);
                    stack.push((side, child));
                }
            }
            (true, false) | (false, true) => {
                let (kept, lost) = if left_real {
                    (merge.left, merge.right)
                } else {
                    (merge.right, merge.left)
                };
                clusters[cluster].stability += size(lost) as f32 * (split - born);
                for point in points_of(lost) {
                    fell_out[point] = (cluster, merge.distance);
                }
                stack.push((kept, cluster));
            }
            (false, false) => {
                clusters[cluster].stability += merge.size as f32 * (split - born);
                for point in points_of(node) {
                    fell_out[point] = (cluster, merge.distance);
                }
            }
        }
    }
    (clusters, fell_out)
}

/// Which clusters are the groups: the most stable set of clusters no two of which contain each
/// other, the whole set included (one army on screen is one group), and then, for each, the
/// cluster it split off from in its place for as long as it split off within [`SPLIT_REACH`].
fn choose(clusters: &[Cluster]) -> Vec<bool> {
    fn descendants(clusters: &[Cluster], of: usize) -> Vec<usize> {
        let mut found = Vec::new();
        let mut stack = clusters[of].children.clone();
        while let Some(cluster) = stack.pop() {
            found.push(cluster);
            stack.extend(clusters[cluster].children.iter().copied());
        }
        found
    }

    // Every cluster comes after the one it split off from, so walking backwards sees every
    // cluster's children before it.
    let mut chosen = vec![false; clusters.len()];
    let mut best = vec![0.0f32; clusters.len()];
    for cluster in (0..clusters.len()).rev() {
        let below: f32 = clusters[cluster]
            .children
            .iter()
            .map(|&child| best[child])
            .sum();
        if clusters[cluster].children.is_empty() || clusters[cluster].stability >= below {
            chosen[cluster] = true;
            best[cluster] = clusters[cluster].stability;
            for descendant in descendants(clusters, cluster) {
                chosen[descendant] = false;
            }
        } else {
            best[cluster] = below;
        }
    }

    let mut kept = vec![false; clusters.len()];
    for cluster in (0..clusters.len()).filter(|&cluster| chosen[cluster]) {
        let mut whole = cluster;
        while clusters[whole].birth < SPLIT_REACH
            && let Some(parent) = clusters[whole].parent
        {
            whole = parent;
        }
        kept[whole] = true;
    }
    for cluster in 0..clusters.len() {
        if kept[cluster] {
            for descendant in descendants(clusters, cluster) {
                kept[descendant] = false;
            }
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use egui::pos2;

    use super::*;

    /// `count` points packed in a disc around `center`, a few points apart.
    fn pile(center: Pos2, count: usize) -> Vec<Pos2> {
        (0..count)
            .map(|i| {
                let angle = i as f32 * 2.399;
                let radius = 4.0 * (i as f32).sqrt();
                center + egui::vec2(angle.cos(), angle.sin()) * radius
            })
            .collect()
    }

    fn group_sizes(points: &[Pos2]) -> Vec<usize> {
        let mut sizes: Vec<usize> = stand_together(points).iter().map(Vec::len).collect();
        sizes.sort_unstable();
        sizes
    }

    #[test]
    fn stragglers_behind_an_army_are_part_of_it() {
        let mut points = pile(pos2(500.0, 500.0), 30);
        points.extend([pos2(620.0, 500.0), pos2(630.0, 515.0), pos2(615.0, 525.0)]);
        assert_eq!(group_sizes(&points), vec![33]);
    }

    #[test]
    fn two_armies_far_apart_are_two_groups() {
        let mut points = pile(pos2(200.0, 500.0), 15);
        points.extend(pile(pos2(800.0, 500.0), 15));
        assert_eq!(group_sizes(&points), vec![15, 15]);
    }

    #[test]
    fn two_armies_closer_than_a_label_are_one_group() {
        let mut points = pile(pos2(500.0, 500.0), 15);
        points.extend(pile(pos2(560.0, 500.0), 15));
        assert_eq!(group_sizes(&points), vec![30]);
    }

    #[test]
    fn a_scout_across_the_screen_is_a_group_of_its_own() {
        let mut points = pile(pos2(300.0, 500.0), 30);
        points.push(pos2(1200.0, 300.0));
        assert_eq!(group_sizes(&points), vec![1, 30]);
    }

    #[test]
    fn a_few_units_on_their_own_group_by_distance() {
        let points = [
            pos2(100.0, 100.0),
            pos2(130.0, 100.0),
            pos2(900.0, 900.0),
            pos2(920.0, 880.0),
        ];
        assert_eq!(group_sizes(&points), vec![2, 2]);
        assert_eq!(group_sizes(&[pos2(10.0, 10.0)]), vec![1]);
        assert!(stand_together(&[]).is_empty());
    }
}
