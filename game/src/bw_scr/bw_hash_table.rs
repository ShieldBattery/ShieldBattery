//! Functions to construct hash tables that BW expects.
//!
//! Since we use Rust's memory allocation, these tables cannot be passed to a BW
//! function that mutates them. Another limitation (to make code simpler) is that
//! bucket count has to be specified upon creation, there is no resizing on insert.

use std::alloc;
use std::marker::PhantomData;
use std::mem;
use std::ptr::{self, null_mut};

use super::scr;

pub struct HashTable<Key: BwHash + BwMove, Value: BwMove> {
    bw_table: scr::BwHashTable,
    key_offset: usize,
    value_offset: usize,
    phantom: PhantomData<(Key, Value)>,
}

pub trait BwHash {
    /// This hash function *MUST* be same as BW's, otherwise BW's lookups won't obviously work.
    /// Hope BW never changes it =)
    fn hash(&self) -> usize;
    fn compare(&self, other: &Self) -> bool;
}

pub trait BwMove {
    unsafe fn move_construct(&mut self, dest: *mut Self);
}

impl BwHash for scr::BwString {
    fn hash(&self) -> usize {
        let slice = unsafe {
            std::slice::from_raw_parts(self.pointer, self.length)
        };
        let mut result = 0u32;
        for chunk in slice.chunks(4) {
            let mut val = 0u32;
            for &byte in chunk.iter().rev() {
                val = (val << 8) | (byte as u32);
            }
            result ^= val.wrapping_mul(0xcc9e2d51)
                .rotate_left(0xf)
                .wrapping_mul(0x1b873593);
            if chunk.len() == 4 {
                result = result.rotate_left(0xd)
                    .wrapping_add(0xfaddaf14)
                    .wrapping_mul(5);
            }
        }
        result = result ^ (self.length as u32) ^ (result >> 0x10);
        result = result.wrapping_mul(0x85ebca6b);
        result = result ^ (result >> 0xd);
        result = result.wrapping_mul(0xc2b2ae35);
        result = result ^ (result >> 0x10);
        result as usize
    }

    fn compare(&self, other: &Self) -> bool {
        unsafe {
            let slice1 = std::slice::from_raw_parts(self.pointer, self.length);
            let slice2 = std::slice::from_raw_parts(other.pointer, other.length);
            slice1 == slice2
        }
    }
}

impl BwMove for scr::BwString {
    unsafe fn move_construct(&mut self, dest: *mut Self) {
        ptr::copy_nonoverlapping(self, dest, 1);
        if self.pointer == self.inline_buffer.as_mut_ptr() {
            (*dest).pointer = (*dest).inline_buffer.as_mut_ptr();
        }
        super::init_bw_string(self, b"");
    }
}

impl BwMove for scr::GameInfoValue {
    unsafe fn move_construct(&mut self, dest: *mut Self) {
        ptr::copy_nonoverlapping(self, dest, 1);
        if self.variant == 1 {
            // String
            let self_string = self.data.var1.as_mut_ptr() as *mut scr::BwString;
            let dest_string = (*dest).data.var1.as_mut_ptr() as *mut scr::BwString;
            (&mut *self_string).move_construct(dest_string);
            self.variant = 0;
        }
    }
}

impl<Key: BwHash + BwMove, Value: BwMove> HashTable<Key, Value> {
    pub fn new(
        bucket_count: usize,
        key_offset: usize,
        value_offset: usize,
    ) -> HashTable<Key, Value> {
        assert!(bucket_count.is_power_of_two());
        let mut buckets = vec![null_mut(); bucket_count];
        // This is probably not ever needed, but just to be sure that `bucket_count`
        // is both capacity and length, which is assumed when dropping this table.
        buckets.shrink_to_fit();
        let bw_table = scr::BwHashTable {
            bucket_count: bucket_count as u32,
            buckets: buckets.as_mut_ptr(),
            size: 0,
            resize_factor: 1.0,
        };
        mem::forget(buckets);
        HashTable {
            bw_table,
            key_offset,
            value_offset,
            phantom: PhantomData,
        }
    }

    pub fn insert(&mut self, key: &mut Key, value: &mut Value) {
        unsafe {
            let bucket_index = key.hash() & (self.bw_table.bucket_count as usize - 1);
            let mut bucket = self.bw_table.buckets.add(bucket_index);
            while (*bucket).is_null() == false {
                let entry = *bucket;
                let entry_key = self.key_from_entry(entry);
                if key.compare(&*entry_key) {
                    // Key was already inserted
                    let entry_value = self.value_from_entry(entry);
                    entry_value.drop_in_place();
                    value.move_construct(entry_value);
                    return;
                }
                bucket = &mut (*entry).next;
            }
            let layout = self.alloc_layout();
            let entry = alloc::alloc_zeroed(layout) as *mut scr::BwHashTableEntry;
            key.move_construct(self.key_from_entry(entry));
            value.move_construct(self.value_from_entry(entry));
            *bucket = entry;
            self.bw_table.size += 1;
        }
    }

    /// Creates a copy of the BwHashTable which can be embedded in BW structure.
    /// This object still stays alive and will free itself on drop, invalidating
    /// the copy object this returns as well.
    pub fn bw_table(&self) -> scr::BwHashTable {
        scr::BwHashTable {
            bucket_count: self.bw_table.bucket_count,
            buckets: self.bw_table.buckets,
            size: self.bw_table.size,
            resize_factor: self.bw_table.resize_factor,
        }
    }

    fn alloc_layout(&self) -> alloc::Layout {
        unsafe {
            let entry_size = self.value_offset + mem::size_of::<Value>();
            alloc::Layout::from_size_align_unchecked(entry_size, 0x8)
        }
    }

    unsafe fn key_from_entry(&self, entry: *mut scr::BwHashTableEntry) -> *mut Key {
        (entry as *mut u8).add(self.key_offset) as *mut Key
    }

    unsafe fn value_from_entry(&self, entry: *mut scr::BwHashTableEntry) -> *mut Value {
        (entry as *mut u8).add(self.value_offset) as *mut Value
    }
}

impl<Key: BwHash + BwMove, Value: BwMove> Drop for HashTable<Key, Value> {
    fn drop(&mut self) {
        unsafe {
            for i in 0..self.bw_table.bucket_count {
                let mut entry = *self.bw_table.buckets.add(i as usize);
                let layout = self.alloc_layout();
                while entry.is_null() == false {
                    let next_entry = (*entry).next;
                    self.key_from_entry(entry).drop_in_place();
                    self.value_from_entry(entry).drop_in_place();
                    alloc::dealloc(entry as *mut u8, layout);
                    entry = next_entry;
                }
            }
            // Drops bucket array
            Vec::from_raw_parts(
                self.bw_table.buckets,
                self.bw_table.bucket_count as usize,
                self.bw_table.bucket_count as usize,
            );
        }
    }
}

#[test]
fn test_bw_hash_string() {
    unsafe {
        let mut string: scr::BwString = mem::zeroed();
        super::init_bw_string(&mut string, b"Debug.File");
        assert_eq!(string.hash(), 0x3AA0824D);
    }
}
