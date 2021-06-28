use std::ptr::null_mut;

use crate::bw;
use crate::bw_scr::scr;

pub struct LinkedList<T> {
    pub start: *mut *mut T,
    pub end: *mut *mut T,
}

impl<T> Clone for LinkedList<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for LinkedList<T> { }

impl<T: BwListEntry> LinkedList<T> {
    /// Prepends `value` to start of `self`
    pub unsafe fn add(&self, value: *mut T) {
        if (*self.start).is_null() {
            *self.start = value;
            *self.end = value;
            *BwListEntry::next(value) = null_mut();
            *BwListEntry::prev(value) = null_mut();
        } else {
            let next = *self.start;
            *self.start = value;
            *BwListEntry::next(value) = next;
            *BwListEntry::prev(next) = value;
            *BwListEntry::prev(value) = null_mut();
        }
    }

    pub unsafe fn append(&self, value: *mut T) {
        if (*self.start).is_null() {
            *self.start = value;
            *self.end = value;
            *BwListEntry::next(value) = null_mut();
            *BwListEntry::prev(value) = null_mut();
        } else {
            let prev = *self.end;
            *self.end = value;
            *BwListEntry::prev(value) = prev;
            *BwListEntry::next(prev) = value;
            *BwListEntry::next(value) = null_mut();
        }
    }

    pub unsafe fn remove(&self, value: *mut T) {
        let prev = *BwListEntry::prev(value);
        let next = *BwListEntry::next(value);
        if prev.is_null() {
            assert!(*self.start == value);
            *self.start = next;
        } else {
            *BwListEntry::next(prev) = next;
        }
        if next.is_null() {
            assert!(*self.end == value);
            *self.end = prev;
        } else {
            *BwListEntry::prev(next) = prev;
        }
    }

    pub unsafe fn alloc(&self) -> Option<Allocation<T>> {
        let value = *self.start;
        if value.is_null() {
            None
        } else {
            self.remove(value);
            Some(Allocation {
                value,
                list: *self,
            })
        }
    }

    pub unsafe fn last(&self) -> Option<*mut T> {
        let value = *self.end;
        if value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    pub unsafe fn count_entries(&self) -> usize {
        let mut count = 0usize;
        let mut pos = *self.start;
        while !pos.is_null() {
            count = count.wrapping_add(1);
            pos = *BwListEntry::next(pos);
        }
        count
    }
}

/// An allocation that has been taken out of a linked list
/// (Generally a list storing the unallocated objects),
/// if dropped without calling move_to, it gets placed back to the
/// list it was allocated from.
pub struct Allocation<T: BwListEntry> {
    value: *mut T,
    list: LinkedList<T>
}

impl<T: BwListEntry> Allocation<T> {
    pub fn value(&self) -> *mut T {
        self.value
    }

    pub unsafe fn move_to(self, dest: &LinkedList<T>) {
        let value = self.value;
        std::mem::forget(self);
        dest.add(value);
    }

    pub unsafe fn append_to(self, dest: &LinkedList<T>) {
        let value = self.value;
        std::mem::forget(self);
        dest.append(value);
    }
}

impl<T: BwListEntry> Drop for Allocation<T> {
    fn drop(&mut self) {
        unsafe {
            self.list.add(self.value);
        }
    }
}

pub trait BwListEntry {
    unsafe fn next(this: *mut Self) -> *mut *mut Self;
    unsafe fn prev(this: *mut Self) -> *mut *mut Self;
}

impl BwListEntry for scr::Sprite {
    unsafe fn next(this: *mut Self) -> *mut *mut Self {
        &mut (*this).next
    }

    unsafe fn prev(this: *mut Self) -> *mut *mut Self {
        &mut (*this).prev
    }
}

impl BwListEntry for bw::Image {
    unsafe fn next(this: *mut Self) -> *mut *mut Self {
        &mut (*this).next
    }

    unsafe fn prev(this: *mut Self) -> *mut *mut Self {
        &mut (*this).prev
    }
}

impl BwListEntry for bw::FowSprite {
    unsafe fn next(this: *mut Self) -> *mut *mut Self {
        &mut (*this).next
    }

    unsafe fn prev(this: *mut Self) -> *mut *mut Self {
        &mut (*this).prev
    }
}

impl BwListEntry for bw::Order {
    unsafe fn next(this: *mut Self) -> *mut *mut Self {
        &mut (*this).next
    }

    unsafe fn prev(this: *mut Self) -> *mut *mut Self {
        &mut (*this).prev
    }
}
