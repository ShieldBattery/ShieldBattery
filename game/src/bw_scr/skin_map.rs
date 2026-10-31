//! Access to the engine's ordered skin maps. Nodes always remain owned by its allocator.

use std::marker::PhantomData;
use std::ptr::{self, null_mut};

use super::scr;

#[repr(C)]
pub(super) struct SkinMap<T: Copy> {
    root: *mut Node<T>,
    min: *mut Node<T>,
    max: *mut Node<T>,
    color: u8,
    count: usize,
}

#[repr(C)]
struct Links<T: Copy> {
    parent: *mut Node<T>,
    left: *mut Node<T>,
    right: *mut Node<T>,
    color: u8,
}

#[repr(C)]
struct Node<T: Copy> {
    links: Links<T>,
    key: u32,
    value: T,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SpriteSkin {
    pub unit_id: u16,
    pub player: u8,
}

impl SpriteSkin {
    pub(crate) fn new(unit_id: u16, player: u8) -> Self {
        Self { unit_id, player }
    }
}

const _: () = {
    use std::mem::{offset_of, size_of};
    assert!(offset_of!(SkinMap<u8>, root) == 0);
    assert!(offset_of!(SkinMap<u8>, min) == size_of::<usize>());
    assert!(offset_of!(SkinMap<u8>, max) == 2 * size_of::<usize>());
    assert!(offset_of!(SkinMap<u8>, color) == 3 * size_of::<usize>());
    assert!(offset_of!(Links<u8>, parent) == 0);
    assert!(offset_of!(Links<u8>, left) == size_of::<usize>());
    assert!(offset_of!(Links<u8>, right) == 2 * size_of::<usize>());
    assert!(offset_of!(SpriteSkin, unit_id) == 0);
    assert!(offset_of!(SpriteSkin, player) == 2);
    assert!(offset_of!(SkinMap<u8>, count) == 4 * size_of::<usize>());
    assert!(offset_of!(Links<u8>, color) == 3 * size_of::<usize>());
    assert!(offset_of!(Node<u8>, key) == 4 * size_of::<usize>());
    assert!(offset_of!(Node<u8>, value) == 4 * size_of::<usize>() + 4);
    assert!(offset_of!(Node<SpriteSkin>, value) == 4 * size_of::<usize>() + 4);
    assert!(size_of::<SpriteSkin>() == 4);
    assert!(size_of::<Node<u8>>() == if size_of::<usize>() == 8 { 40 } else { 24 });
    assert!(size_of::<Node<SpriteSkin>>() == if size_of::<usize>() == 8 { 40 } else { 24 });
    assert!(size_of::<SkinMap<u8>>() == 5 * size_of::<usize>());
};

/// The caller must provide a live engine map and exclude concurrent access.
pub(super) unsafe fn get<T: Copy>(map: *const SkinMap<T>, key: u32) -> Option<T> {
    unsafe {
        let mut node = (*map).root;
        while !node.is_null() {
            if key == (*node).key {
                return Some((*node).value);
            }
            node = if key < (*node).key {
                (*node).links.left
            } else {
                (*node).links.right
            };
        }
        None
    }
}

unsafe fn collect_nodes<T: Copy>(node: *mut Node<T>, out: &mut Vec<*mut Node<T>>) {
    unsafe {
        if !node.is_null() {
            collect_nodes((*node).links.left, out);
            out.push(node);
            collect_nodes((*node).links.right, out);
        }
    }
}

/// Copies the ordered contents without retaining engine node pointers.
pub(super) unsafe fn entries<T: Copy>(map: *const SkinMap<T>) -> Vec<(u32, T)> {
    unsafe {
        let mut nodes = Vec::with_capacity((*map).count);
        collect_nodes((*map).root, &mut nodes);
        nodes.into_iter().map(|n| ((*n).key, (*n).value)).collect()
    }
}

/// Owns newly allocated nodes until the replacement can be committed.
pub(super) struct PreparedMap<T: Copy> {
    map: *mut SkinMap<T>,
    allocator: *mut scr::Allocator,
    nodes: Vec<*mut Node<T>>,
    growth: Vec<*mut Node<T>>,
    capacity: usize,
    _value: PhantomData<T>,
}

/// Stages a replacement. The map and allocator must remain valid and unchanged until commit or
/// drop, and no other reader or writer may access the map during commit.
pub(super) unsafe fn prepare<T: Copy>(
    map: *mut SkinMap<T>,
    capacity: usize,
    allocator: *mut scr::Allocator,
) -> Option<PreparedMap<T>> {
    unsafe {
        let mut nodes = Vec::with_capacity((*map).count.max(capacity));
        collect_nodes((*map).root, &mut nodes);
        let needed = capacity.saturating_sub(nodes.len());
        let mut prepared = PreparedMap {
            map,
            allocator,
            nodes,
            growth: Vec::with_capacity(needed),
            capacity,
            _value: PhantomData,
        };
        for _ in 0..needed {
            let node = (*(*allocator).vtable).alloc.call3(
                allocator,
                std::mem::size_of::<Node<T>>(),
                2 * std::mem::size_of::<usize>(),
            ) as *mut Node<T>;
            if node.is_null() {
                return None;
            }
            prepared.growth.push(node);
            prepared.nodes.push(node);
        }
        Some(prepared)
    }
}

impl<T: Copy> Drop for PreparedMap<T> {
    fn drop(&mut self) {
        unsafe {
            for node in self.growth.drain(..) {
                (*(*self.allocator).vtable)
                    .free
                    .call2(self.allocator, node.cast());
            }
        }
    }
}

/// Builds a midpoint tree, coloring only its deepest partial level red.
unsafe fn build<T: Copy>(
    nodes: &[*mut Node<T>],
    entries: &[(u32, T)],
    parent: *mut Node<T>,
    depth: u32,
    red_level: u32,
) -> *mut Node<T> {
    if nodes.is_empty() {
        return null_mut();
    }
    let mid = nodes.len() / 2;
    let node = nodes[mid];
    unsafe {
        ptr::write(
            node,
            Node {
                links: Links {
                    parent,
                    left: build(&nodes[..mid], &entries[..mid], node, depth + 1, red_level),
                    right: build(
                        &nodes[mid + 1..],
                        &entries[mid + 1..],
                        node,
                        depth + 1,
                        red_level,
                    ),
                    color: u8::from(depth != red_level),
                },
                key: entries[mid].0,
                value: entries[mid].1,
            },
        );
    }
    node
}

impl<T: Copy> PreparedMap<T> {
    /// Replaces the map without further allocation. The map must still be unchanged since prepare.
    pub(super) unsafe fn commit(mut self, entries: &[(u32, T)]) {
        assert!(entries.len() <= self.capacity);
        assert!(entries.iter().all(|(k, _)| *k > 0 && *k < i32::MAX as u32));
        assert!(entries.windows(2).all(|w| w[0].0 < w[1].0));
        unsafe {
            let count = entries.len();
            let header = self.map.cast::<Node<T>>();
            let red_level = (count + 1).ilog2();
            let root = build(&self.nodes[..count], entries, header, 0, red_level);
            (*self.map).root = root;
            (*self.map).min = if count == 0 { header } else { self.nodes[0] };
            (*self.map).max = if count == 0 {
                header
            } else {
                self.nodes[count - 1]
            };
            (*self.map).count = count;
            self.growth.clear();
            for &node in &self.nodes[count..] {
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
    use crate::bw_scr::thiscall::Thiscall;
    use std::alloc::{Layout, alloc, dealloc};
    use std::collections::HashMap;

    #[repr(C)]
    pub(in crate::bw_scr) struct MockAllocator {
        pub(in crate::bw_scr) base: scr::Allocator,
        pub(in crate::bw_scr) remaining: usize,
        pub(in crate::bw_scr) live: usize,
        allocations: HashMap<usize, Layout>,
    }

    unsafe extern "C" fn allocate(base: *mut scr::Allocator, size: usize, align: usize) -> *mut u8 {
        unsafe {
            let mock = &mut *base.cast::<MockAllocator>();
            if mock.remaining == 0 {
                return null_mut();
            }
            mock.remaining -= 1;
            let layout = Layout::from_size_align(size, align).unwrap();
            let result = alloc(layout);
            if !result.is_null() {
                mock.live += 1;
                assert!(mock.allocations.insert(result as usize, layout).is_none());
            }
            result
        }
    }

    unsafe extern "C" fn free(base: *mut scr::Allocator, node: *mut u8) {
        unsafe {
            let mock = &mut *base.cast::<MockAllocator>();
            mock.live -= 1;
            dealloc(node, mock.allocations.remove(&(node as usize)).unwrap());
        }
    }

    pub(in crate::bw_scr) fn allocator() -> (Box<scr::AllocatorVtable>, Box<MockAllocator>) {
        let mut table = Box::new(scr::AllocatorVtable {
            delete: 0,
            alloc: Thiscall::new(allocate),
            fn2: 0,
            fn3: 0,
            free: Thiscall::new(free),
        });
        let mock = Box::new(MockAllocator {
            base: scr::Allocator {
                vtable: &mut *table,
            },
            remaining: usize::MAX,
            live: 0,
            allocations: HashMap::new(),
        });
        (table, mock)
    }

    pub(in crate::bw_scr) fn empty<T: Copy>() -> Box<SkinMap<T>> {
        let mut map = Box::new(SkinMap {
            root: null_mut(),
            min: null_mut(),
            max: null_mut(),
            color: 0,
            count: 0,
        });
        let header = (&mut *map as *mut SkinMap<T>).cast();
        map.min = header;
        map.max = header;
        map
    }

    unsafe fn validate_node<T: Copy>(
        node: *mut Node<T>,
        parent: *mut Node<T>,
        min: u32,
        max: u32,
    ) -> (usize, usize) {
        unsafe {
            if node.is_null() {
                return (0, 1);
            }
            assert_eq!((*node).links.parent, parent);
            assert!((*node).key > min && (*node).key < max);
            assert!((*node).links.color <= 1);
            let (lc, lb) = validate_node((*node).links.left, node, min, (*node).key);
            let (rc, rb) = validate_node((*node).links.right, node, (*node).key, max);
            assert_eq!(lb, rb);
            if (*node).links.color == 0 {
                assert!((*node).links.left.is_null() || (*(*node).links.left).links.color == 1);
                assert!((*node).links.right.is_null() || (*(*node).links.right).links.color == 1);
            }
            (1 + lc + rc, lb + usize::from((*node).links.color == 1))
        }
    }

    unsafe fn validate<T: Copy>(map: &mut SkinMap<T>) {
        unsafe {
            let header = (map as *mut SkinMap<T>).cast();
            if map.root.is_null() {
                assert_eq!(map.min, header);
                assert_eq!(map.max, header);
                assert_eq!(map.count, 0);
            } else {
                assert_eq!((*map.root).links.color, 1);
                let (count, _) = validate_node(map.root, header, 0, u32::MAX);
                assert_eq!(count, map.count);
                let mut left = map.root;
                while !(*left).links.left.is_null() {
                    left = (*left).links.left;
                }
                let mut right = map.root;
                while !(*right).links.right.is_null() {
                    right = (*right).links.right;
                }
                assert_eq!(map.min, left);
                assert_eq!(map.max, right);
            }
        }
    }

    fn data(n: usize) -> Vec<(u32, SpriteSkin)> {
        (1..=n)
            .map(|i| (i as u32, SpriteSkin::new(i as u16, (i % 8) as u8)))
            .collect()
    }

    #[test]
    fn all_tree_sizes_and_replacements() {
        let (_table, mut mock) = allocator();
        let allocator = &mut mock.base;
        let mut map = empty();
        unsafe {
            for n in 0..=1025 {
                prepare(&mut *map, n, allocator).unwrap().commit(&data(n));
                validate(&mut map);
                assert_eq!(entries(&*map), data(n));
                assert_eq!(get(&*map, 0), None);
                assert_eq!(get(&*map, (n + 1) as u32), None);
                if n > 0 {
                    assert_eq!(get(&*map, n as u32), Some(data(n)[n - 1].1));
                }
            }
            for n in [7, 0, 23, 1, 511, 0] {
                prepare(&mut *map, n, allocator).unwrap().commit(&data(n));
                validate(&mut map);
                assert_eq!(entries(&*map), data(n));
            }
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn unit_map_commits_a_subset_of_reserved_capacity() {
        let (_table, mut mock) = allocator();
        let allocator = &mut mock.base as *mut scr::Allocator;
        let mut map = empty::<u8>();
        unsafe {
            let pending = prepare(&mut *map, 9, allocator).unwrap();
            pending.commit(&[(1, 4), (4, 7)]);
            assert_eq!(mock.live, 2);
            assert_eq!(entries(&*map), vec![(1, 4), (4, 7)]);
            validate(&mut map);
            let existing = map.min;
            prepare(&mut *map, 2, allocator).unwrap().commit(&[(2, 8)]);
            assert_eq!(map.root, existing);
            assert_eq!(get(&*map, 2), Some(8));
            assert_eq!(get(&*map, 4), None);
            assert_eq!(map.color, 0);
            validate(&mut map);
            prepare(&mut *map, 0, allocator).unwrap().commit(&[]);
        }
        assert_eq!(mock.live, 0);
    }

    #[test]
    fn failed_preparation_preserves_both_maps_and_frees_growth() {
        let (_table, mut mock) = allocator();
        let allocator = &mut mock.base as *mut scr::Allocator;
        let mut first = empty();
        let mut second = empty();
        unsafe {
            prepare(&mut *first, 3, allocator).unwrap().commit(&data(3));
            prepare(&mut *second, 4, allocator)
                .unwrap()
                .commit(&data(4));
            let old_first = entries(&*first);
            let old_second = entries(&*second);
            let root_first = first.root;
            let root_second = second.root;
            let live = mock.live;
            mock.remaining = 4;
            let pending = prepare(&mut *first, 5, allocator).unwrap();
            assert!(prepare(&mut *second, 7, allocator).is_none());
            drop(pending);
            assert_eq!(mock.live, live);
            assert_eq!(first.root, root_first);
            assert_eq!(second.root, root_second);
            assert_eq!(entries(&*first), old_first);
            assert_eq!(entries(&*second), old_second);
            validate(&mut first);
            validate(&mut second);
            prepare(&mut *first, 0, allocator).unwrap().commit(&[]);
            prepare(&mut *second, 0, allocator).unwrap().commit(&[]);
        }
        assert_eq!(mock.live, 0);
    }
}
