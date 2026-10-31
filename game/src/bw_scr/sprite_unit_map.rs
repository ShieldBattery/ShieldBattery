//! Access to the engine's sprite-to-unit pool ID map.

use std::ptr::{self, null_mut};

use super::scr;

#[repr(C)]
pub(super) struct SpriteUnitMap {
    bucket_count: usize,
    buckets: *mut *mut Node,
    count: usize,
    max_load_factor: f32,
}

#[repr(C)]
struct Node {
    next: *mut Node,
    sprite_id: u32,
    unit_id: u32,
}

const _: () = {
    use std::mem::{offset_of, size_of};
    assert!(offset_of!(SpriteUnitMap, bucket_count) == 0);
    assert!(offset_of!(SpriteUnitMap, buckets) == size_of::<usize>());
    assert!(offset_of!(SpriteUnitMap, count) == 2 * size_of::<usize>());
    assert!(offset_of!(SpriteUnitMap, max_load_factor) == 3 * size_of::<usize>());
    assert!(offset_of!(Node, next) == 0);
    assert!(offset_of!(Node, sprite_id) == size_of::<usize>());
    assert!(offset_of!(Node, unit_id) == size_of::<usize>() + 4);
    assert!(size_of::<Node>() == if size_of::<usize>() == 8 { 16 } else { 12 });
    assert!(size_of::<SpriteUnitMap>() == if size_of::<usize>() == 8 { 32 } else { 16 });
};

#[cfg(target_pointer_width = "64")]
fn hash(key: u32) -> usize {
    let mut x = u64::from(key);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    (x ^ (x >> 33)) as usize
}

#[cfg(target_pointer_width = "32")]
fn hash(key: u32) -> usize {
    let mut x = key;
    x ^= x >> 16;
    x = x.wrapping_mul(0x85ebca6b);
    x ^= x >> 13;
    x = x.wrapping_mul(0xc2b2ae35);
    (x ^ (x >> 16)) as usize
}

unsafe fn collect_nodes(map: *const SpriteUnitMap) -> Vec<*mut Node> {
    unsafe {
        let mut nodes = Vec::with_capacity((*map).count);
        if !(*map).buckets.is_null() {
            for index in 0..(*map).bucket_count {
                let mut node = *(*map).buckets.add(index);
                while !node.is_null() {
                    nodes.push(node);
                    node = (*node).next;
                }
            }
        }
        nodes
    }
}

/// Copies the map's values in key order. The caller must exclude concurrent mutation.
pub(super) unsafe fn entries(map: *const SpriteUnitMap) -> Vec<(u32, u32)> {
    unsafe {
        let mut result: Vec<_> = collect_nodes(map)
            .into_iter()
            .map(|node| ((*node).sprite_id, (*node).unit_id))
            .collect();
        result.sort_unstable_by_key(|entry| entry.0);
        result
    }
}

/// Removes a sprite association, returning its node to the engine allocator.
/// The map must not have an outstanding prepared replacement.
pub(super) unsafe fn remove(map: *mut SpriteUnitMap, key: u32, allocator: *mut scr::Allocator) {
    unsafe {
        if (*map).buckets.is_null() {
            return;
        }
        let mut link = (*map).buckets.add(hash(key) & ((*map).bucket_count - 1));
        while !(*link).is_null() {
            let node = *link;
            if (*node).sprite_id == key {
                *link = (*node).next;
                (*map).count -= 1;
                (*(*allocator).vtable).free.call2(allocator, node.cast());
                return;
            }
            link = &raw mut (*node).next;
        }
    }
}

/// Owns new allocations while the original map remains intact.
pub(super) struct PreparedSpriteUnits {
    map: *mut SpriteUnitMap,
    allocator: *mut scr::Allocator,
    nodes: Vec<*mut Node>,
    growth: Vec<*mut Node>,
    new_buckets: *mut *mut Node,
    bucket_count: usize,
    capacity: usize,
}

/// Stages capacity for a replacement. The map and allocator must remain valid, and the map must
/// not be mutated until this value is committed or dropped. A failed allocation leaves it intact.
pub(super) unsafe fn prepare(
    map: *mut SpriteUnitMap,
    capacity: usize,
    allocator: *mut scr::Allocator,
) -> Option<PreparedSpriteUnits> {
    unsafe {
        let factor = (*map).max_load_factor;
        if !factor.is_finite() || factor <= 0.0 {
            return None;
        }
        let old_count = (*map).bucket_count;
        if old_count != 0 && !old_count.is_power_of_two() {
            return None;
        }
        let mut bucket_count = old_count;
        if capacity != 0 {
            bucket_count = bucket_count.max(8);
            while (capacity as f32) / (bucket_count as f32) > factor {
                bucket_count = bucket_count.checked_mul(2)?;
            }
        }
        let allocate_buckets =
            capacity != 0 && ((*map).buckets.is_null() || bucket_count != old_count);
        let bucket_bytes = bucket_count.checked_mul(std::mem::size_of::<*mut Node>())?;
        if bucket_bytes > isize::MAX as usize {
            return None;
        }
        let mut nodes = collect_nodes(map);
        let needed = capacity.saturating_sub(nodes.len());
        nodes.reserve(needed);
        let mut prepared = PreparedSpriteUnits {
            map,
            allocator,
            nodes,
            growth: Vec::with_capacity(needed),
            new_buckets: null_mut(),
            bucket_count,
            capacity,
        };
        if allocate_buckets {
            prepared.new_buckets = (*(*allocator).vtable)
                .alloc
                .call3(allocator, bucket_bytes, 2 * std::mem::size_of::<usize>())
                .cast();
            if prepared.new_buckets.is_null() {
                return None;
            }
        }
        for _ in 0..needed {
            let node = (*(*allocator).vtable).alloc.call3(
                allocator,
                std::mem::size_of::<Node>(),
                2 * std::mem::size_of::<usize>(),
            ) as *mut Node;
            if node.is_null() {
                return None;
            }
            prepared.growth.push(node);
            prepared.nodes.push(node);
        }
        Some(prepared)
    }
}

impl Drop for PreparedSpriteUnits {
    fn drop(&mut self) {
        unsafe {
            for node in self.growth.drain(..) {
                (*(*self.allocator).vtable)
                    .free
                    .call2(self.allocator, node.cast());
            }
            if !self.new_buckets.is_null() {
                (*(*self.allocator).vtable)
                    .free
                    .call2(self.allocator, self.new_buckets.cast());
            }
        }
    }
}

impl PreparedSpriteUnits {
    /// Replaces the map with sorted, unique entries without allocating.
    pub(super) unsafe fn commit(mut self, entries: &[(u32, u32)]) {
        assert!(entries.len() <= self.capacity);
        assert!(entries.windows(2).all(|w| w[0].0 < w[1].0));
        unsafe {
            let old_buckets = (*self.map).buckets;
            let buckets = if self.new_buckets.is_null() {
                old_buckets
            } else {
                self.new_buckets
            };
            if !buckets.is_null() {
                ptr::write_bytes(buckets, 0, self.bucket_count);
            }
            for (&node, &(sprite_id, unit_id)) in self.nodes.iter().zip(entries) {
                let bucket = hash(sprite_id) & (self.bucket_count - 1);
                ptr::write(
                    node,
                    Node {
                        next: *buckets.add(bucket),
                        sprite_id,
                        unit_id,
                    },
                );
                *buckets.add(bucket) = node;
            }
            (*self.map).bucket_count = self.bucket_count;
            (*self.map).buckets = buckets;
            (*self.map).count = entries.len();
            self.growth.clear();
            if !self.new_buckets.is_null() {
                self.new_buckets = null_mut();
                if !old_buckets.is_null() {
                    (*(*self.allocator).vtable)
                        .free
                        .call2(self.allocator, old_buckets.cast());
                }
            }
            for &node in &self.nodes[entries.len()..] {
                (*(*self.allocator).vtable)
                    .free
                    .call2(self.allocator, node.cast());
            }
        }
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::bw_scr::skin_map::tests::allocator;

    pub(in crate::bw_scr) fn empty() -> Box<SpriteUnitMap> {
        Box::new(SpriteUnitMap {
            bucket_count: 0,
            buckets: null_mut(),
            count: 0,
            max_load_factor: 1.0,
        })
    }

    /// The caller must first remove every node from the map.
    pub(in crate::bw_scr) unsafe fn free_buckets(
        map: &mut SpriteUnitMap,
        allocator: *mut scr::Allocator,
    ) {
        assert_eq!(map.count, 0);
        unsafe {
            if !map.buckets.is_null() {
                (*(*allocator).vtable)
                    .free
                    .call2(allocator, map.buckets.cast());
            }
            map.buckets = null_mut();
            map.bucket_count = 0;
        }
    }

    unsafe fn lookup(map: &SpriteUnitMap, key: u32) -> Option<u32> {
        unsafe {
            if map.buckets.is_null() {
                return None;
            }
            let mut node = *map.buckets.add(hash(key) & (map.bucket_count - 1));
            while !node.is_null() {
                if (*node).sprite_id == key {
                    return Some((*node).unit_id);
                }
                node = (*node).next;
            }
            None
        }
    }

    fn data(count: u32) -> Vec<(u32, u32)> {
        (1..=count).map(|i| (i, i + 10)).collect()
    }

    #[test]
    fn roundtrip_grow_shrink_and_reuse() {
        let (_table, mut mock) = allocator();
        let alloc = &mut mock.base as *mut scr::Allocator;
        let mut map = empty();
        unsafe {
            prepare(&mut *map, 0, alloc).unwrap().commit(&[]);
            assert!(map.buckets.is_null());
            prepare(&mut *map, 20, alloc).unwrap().commit(&data(20));
            assert_eq!(map.bucket_count, 32);
            assert_eq!(entries(&*map), data(20));
            for (key, value) in data(20) {
                assert_eq!(lookup(&map, key), Some(value));
            }
            let buckets = map.buckets;
            let original = collect_nodes(&*map);
            prepare(&mut *map, 5, alloc)
                .unwrap()
                .commit(&[(2, 90), (4, 80), (100, 70)]);
            assert_eq!(map.buckets, buckets);
            assert_eq!(map.bucket_count, 32);
            assert_eq!(lookup(&map, 2), Some(90));
            assert_eq!(lookup(&map, 1), None);
            assert_eq!(entries(&*map), vec![(2, 90), (4, 80), (100, 70)]);
            assert!(collect_nodes(&*map).iter().all(|p| original.contains(p)));
            assert_eq!(mock.live, 4);
            prepare(&mut *map, 0, alloc).unwrap().commit(&[]);
            assert!(entries(&*map).is_empty());
            assert_eq!(mock.live, 1);
            free_buckets(&mut map, alloc);
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn collision_chains_match_native_bucket_hash() {
        let (_table, mut mock) = allocator();
        let alloc = &mut mock.base as *mut scr::Allocator;
        let mut map = empty();
        let keys: Vec<u32> = (1..).filter(|&x| hash(x) & 7 == 3).take(8).collect();
        let values: Vec<_> = keys.iter().map(|&x| (x, x + 1)).collect();
        unsafe {
            prepare(&mut *map, values.len(), alloc)
                .unwrap()
                .commit(&values);
            assert_eq!(map.bucket_count, 8);
            for &(key, value) in &values {
                assert_eq!(lookup(&map, key), Some(value));
            }
            assert_eq!(entries(&*map), values);
            prepare(&mut *map, 0, alloc).unwrap().commit(&[]);
            free_buckets(&mut map, alloc);
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn remove_collision_chain_and_missing_keys() {
        let (_table, mut mock) = allocator();
        let alloc = &mut mock.base as *mut scr::Allocator;
        let mut map = empty();
        let keys: Vec<u32> = (1..).filter(|&x| hash(x) & 7 == 3).take(5).collect();
        let values: Vec<_> = keys.iter().map(|&x| (x, x + 1)).collect();
        unsafe {
            remove(&mut *map, 123, alloc);
            prepare(&mut *map, values.len(), alloc)
                .unwrap()
                .commit(&values);
            // Commit inserts at the bucket head, in reverse key order.
            remove(&mut *map, keys[4], alloc);
            remove(&mut *map, keys[2], alloc);
            remove(&mut *map, keys[0], alloc);
            assert_eq!(map.count, 2);
            assert_eq!(entries(&*map), vec![values[1], values[3]]);
            assert_eq!(mock.live, 3);
            remove(&mut *map, keys[2], alloc);
            assert_eq!(map.count, 2);
            assert_eq!(mock.live, 3);
            assert_eq!(lookup(&map, keys[1]), Some(keys[1] + 1));
            assert_eq!(lookup(&map, keys[3]), Some(keys[3] + 1));
            remove(&mut *map, keys[1], alloc);
            remove(&mut *map, keys[3], alloc);
            assert_eq!(map.count, 0);
            assert!(entries(&*map).is_empty());
            free_buckets(&mut map, alloc);
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn failed_allocation_leaves_old_map_and_frees_growth() {
        let (_table, mut mock) = allocator();
        let alloc = &mut mock.base as *mut scr::Allocator;
        let mut map = empty();
        unsafe {
            prepare(&mut *map, 3, alloc).unwrap().commit(&data(3));
            let old_nodes = collect_nodes(&*map);
            let old_buckets = map.buckets;
            let old_live = mock.live;
            for allowed in [0, 1, 3] {
                mock.remaining = allowed;
                assert!(prepare(&mut *map, 20, alloc).is_none());
                assert_eq!(map.buckets, old_buckets);
                assert_eq!(map.bucket_count, 8);
                assert_eq!(map.count, 3);
                assert_eq!(entries(&*map), data(3));
                assert_eq!(collect_nodes(&*map), old_nodes);
                assert_eq!(mock.live, old_live);
            }
            mock.remaining = usize::MAX;
            prepare(&mut *map, 0, alloc).unwrap().commit(&[]);
            free_buckets(&mut map, alloc);
        }
        assert_eq!(mock.live, 0);
    }
}
