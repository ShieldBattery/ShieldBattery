//! Functions to construct hash tables that BW expects.
//!
//! Since we use Rust's memory allocation, these tables cannot be passed to a BW
//! function that mutates them. Another limitation (to make code simpler) is that
//! bucket count has to be specified upon creation, there is no resizing on insert.

use std::alloc;
use std::mem;
use std::ptr::{self, null_mut};

use super::scr;

pub struct HashTable<Key: BwHash + BwMove, Value: BwMove> {
    bw_table: scr::BwHashTable<Key, Value>,
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
        let slice = unsafe { std::slice::from_raw_parts(self.pointer, self.length) };
        if cfg!(target_arch = "x86") {
            hash_bytes_32(slice, 0)
        } else {
            hash_bytes_64(slice, 0).0 as usize
        }
    }

    fn compare(&self, other: &Self) -> bool {
        unsafe {
            let slice1 = std::slice::from_raw_parts(self.pointer, self.length);
            let slice2 = std::slice::from_raw_parts(other.pointer, other.length);
            slice1 == slice2
        }
    }
}

fn hash_bytes_32(slice: &[u8], accum: u32) -> usize {
    let mut result = accum;
    for chunk in slice.chunks(4) {
        let mut val = 0u32;
        for &byte in chunk.iter().rev() {
            val = (val << 8) | (byte as u32);
        }
        result ^= val
            .wrapping_mul(0xcc9e2d51)
            .rotate_left(0xf)
            .wrapping_mul(0x1b873593);
        if chunk.len() == 4 {
            result = result
                .rotate_left(0xd)
                .wrapping_add(0xfaddaf14)
                .wrapping_mul(5);
        }
    }
    hash_u32_x86(result, slice.len() as u32) as usize
}

fn hash_bytes_64(slice: &[u8], accum: u64) -> (u64, u64) {
    let mut result1 = accum;
    let mut result2 = accum;
    for chunk in slice.chunks(16) {
        let mut val = 0u64;
        for &byte in chunk.iter().rev() {
            val = (val << 8) | (byte as u64);
        }
        result1 ^= val
            .wrapping_mul(0x87c37b91114253d5)
            .rotate_left(0x1f)
            .wrapping_mul(0x4cf5ad432745937f);
        if chunk.len() == 16 {
            result1 = result1
                .rotate_left(0x1b)
                .wrapping_add(result2)
                .wrapping_mul(5)
                .wrapping_add(0x52dce729);
        }
        if chunk.len() > 8 {
            let mut val = 0u64;
            for &byte in chunk[8..].iter().rev() {
                val = (val << 8) | (byte as u64);
            }
            result2 ^= val
                .wrapping_mul(0x4cf5ad432745937f)
                .rotate_right(0x1f)
                .wrapping_mul(0x87c37b91114253d5);
        }
        if chunk.len() == 16 {
            result2 = result2
                .rotate_left(0x1f)
                .wrapping_add(0xb41def1)
                .wrapping_add(result1)
                .wrapping_mul(5);
        }
    }
    hash_u64_pair_x86_64(result1, result2, slice.len() as u64)
}

fn hash_u32_x86(mut accum: u32, next: u32) -> u32 {
    accum = accum ^ (accum >> 0x10) ^ next;
    accum = accum.wrapping_mul(0x85ebca6b);
    accum = accum ^ (accum >> 0xd);
    accum = accum.wrapping_mul(0xc2b2ae35);
    accum = accum ^ (accum >> 0x10);
    accum
}

fn hash_u64_pair_x86_64(mut accum1: u64, mut accum2: u64, next: u64) -> (u64, u64) {
    accum1 = accum1 ^ next;
    accum2 = accum2 ^ next;

    accum1 = accum1.wrapping_add(accum2);
    accum2 = accum1.wrapping_add(accum2);

    accum1 = hash_u64_x86_64(accum1);
    accum2 = hash_u64_x86_64(accum2);

    accum1 = accum1.wrapping_add(accum2);
    accum2 = accum1.wrapping_add(accum2);
    (accum1, accum2)
}

fn hash_u64_x86_64(mut accum: u64) -> u64 {
    accum = accum ^ (accum >> 0x21);
    accum = accum.wrapping_mul(0xff51afd7ed558ccd);
    accum = accum ^ (accum >> 0x21);
    accum = accum.wrapping_mul(0xc4ceb9fe1a85ec53);
    accum = accum ^ (accum >> 0x21);
    accum
}

impl BwHash for scr::BwStringAlign8 {
    fn hash(&self) -> usize {
        self.inner.hash()
    }

    fn compare(&self, other: &Self) -> bool {
        self.inner.compare(&other.inner)
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

impl BwMove for scr::BwStringAlign8 {
    unsafe fn move_construct(&mut self, dest: *mut Self) {
        self.inner.move_construct(ptr::addr_of_mut!((*dest).inner))
    }
}

impl BwMove for scr::GameInfoValueOld {
    unsafe fn move_construct(&mut self, dest: *mut Self) {
        ptr::copy_nonoverlapping(self, dest, 1);
        if self.variant == 1 {
            // String
            let self_string = self.data.var1.as_mut_ptr() as *mut scr::BwString;
            let dest_string = (*dest).data.var1.as_mut_ptr() as *mut scr::BwString;
            (*self_string).move_construct(dest_string);
            self.variant = 0;
        }
    }
}

impl BwMove for scr::GameInfoValue {
    unsafe fn move_construct(&mut self, dest: *mut Self) {
        ptr::copy_nonoverlapping(self, dest, 1);
        if self.variant == 1 {
            // String
            let self_string = self.data.var1.as_mut_ptr() as *mut scr::BwString;
            let dest_string = (*dest).data.var1.as_mut_ptr() as *mut scr::BwString;
            (*self_string).move_construct(dest_string);
            self.variant = 0;
        }
    }
}

impl<Key: BwHash + BwMove, Value: BwMove> HashTable<Key, Value> {
    pub fn new(bucket_count: usize) -> HashTable<Key, Value> {
        assert!(bucket_count.is_power_of_two());
        let mut buckets = vec![null_mut(); bucket_count];
        // This is probably not ever needed, but just to be sure that `bucket_count`
        // is both capacity and length, which is assumed when dropping this table.
        buckets.shrink_to_fit();
        let bw_table = scr::BwHashTable {
            bucket_count,
            buckets: buckets.as_mut_ptr(),
            size: 0,
            resize_factor: 1.0,
        };
        mem::forget(buckets);
        HashTable { bw_table }
    }

    pub fn insert(&mut self, key: &mut Key, value: &mut Value) {
        unsafe {
            let bucket_index = key.hash() & (self.bw_table.bucket_count - 1);
            let mut bucket = self.bw_table.buckets.add(bucket_index);
            while !(*bucket).is_null() {
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
            let entry = alloc::alloc_zeroed(layout) as *mut scr::BwHashTableEntry<Key, Value>;
            key.move_construct(self.key_from_entry(entry));
            value.move_construct(self.value_from_entry(entry));
            *bucket = entry;
            self.bw_table.size += 1;
        }
    }

    /// Creates a copy of the BwHashTable which can be embedded in BW structure.
    /// This object still stays alive and will free itself on drop, invalidating
    /// the copy object this returns as well.
    pub fn bw_table(&self) -> scr::BwHashTable<Key, Value> {
        scr::BwHashTable {
            bucket_count: self.bw_table.bucket_count,
            buckets: self.bw_table.buckets,
            size: self.bw_table.size,
            resize_factor: self.bw_table.resize_factor,
        }
    }

    fn alloc_layout(&self) -> alloc::Layout {
        alloc::Layout::new::<scr::BwHashTableEntry<Key, Value>>()
    }

    unsafe fn key_from_entry(&self, entry: *mut scr::BwHashTableEntry<Key, Value>) -> *mut Key {
        ptr::addr_of_mut!((*entry).key)
    }

    unsafe fn value_from_entry(&self, entry: *mut scr::BwHashTableEntry<Key, Value>) -> *mut Value {
        ptr::addr_of_mut!((*entry).value)
    }
}

impl<Key: BwHash + BwMove, Value: BwMove> Drop for HashTable<Key, Value> {
    fn drop(&mut self) {
        unsafe {
            for i in 0..self.bw_table.bucket_count {
                let mut entry = *self.bw_table.buckets.add(i);
                let layout = self.alloc_layout();
                while !entry.is_null() {
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
                self.bw_table.bucket_count,
                self.bw_table.bucket_count,
            );
        }
    }
}

#[test]
fn test_bw_hash_string() {
    assert_eq!(hash_bytes_32(b"Debug.File", 0), 0x3AA0824D);
    assert_eq!(hash_bytes_64(b"Debug.File", 0), (0xB0BB5946489FEC5E, 0xD350933E370E503A));
    assert_eq!(
        hash_bytes_64(b"Debug.File.File.File", 0),
        (0x6E05492A38DD240A, 0xCD21D6142ECB42F3),
    );
    assert_eq!(
        hash_bytes_64(b"Debug.VeryLong.File.File", 0),
        (0x410212F88830266C, 0x753A4E760502EEF7),
    );
}

#[test]
fn test_bw_hash_int() {
    assert_eq!(hash_u32_x86(0, 0), 0);
    assert_eq!(hash_u32_x86(0x77A96A68, 0), 0xE714CAF2);
    assert_eq!(hash_u32_x86(0x88888888, 0), 0x1D6EF8AE);

    assert_eq!(hash_u64_x86_64(0), 0);
    assert_eq!(hash_u64_x86_64(0x77A96A68), 0x1246F150F558A4EF);
    assert_eq!(hash_u64_x86_64(0x88888888), 0xF44D1EF7A8A4302C);
    assert_eq!(hash_u64_x86_64(0x77A96A6877A96A68), 0xDB50A145449DFD7E);
    assert_eq!(hash_u64_x86_64(0x8888888888888888), 0xB6CC53E034B6E8D0);
}
