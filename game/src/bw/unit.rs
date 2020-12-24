//! A bit higher-level functions for working with `*mut bw::Unit`
//!
//! `Unit` just wraps the raw pointer, and since it's not worth the effort
//! to implement getters/setters for every less-used field of `bw::Unit`,
//! you can get the inner pointer by dereferencing it, as in `*unit`.
//!
//! While the raw struct `bw::Unit` is exported by this module's parent,
//! it's probably clearer to keep refering it as `bw::Unit` and import
//! this `crate::bw::unit::Unit` to `Unit` where it's used.

use std::ptr::{NonNull};
use crate::bw;

/// There are three main lists,
/// one for active units (Anything selectable or something that is drawn),
/// one for hidden units (Inside building, transport, or similarly not interacting with map),
/// one for revealers (Scanner sweeps, map revealers)
pub struct UnitIterator(Option<Unit>);

impl UnitIterator {
    pub fn new(first: Option<Unit>) -> UnitIterator {
        UnitIterator(first)
    }
}

impl Iterator for UnitIterator {
    type Item = Unit;
    fn next(&mut self) -> Option<Unit> {
        let unit = self.0?;
        unsafe {
            self.0 = Unit::from_ptr((**unit).next);
        }
        Some(unit)
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Unit(NonNull<bw::Unit>);

impl std::ops::Deref for Unit {
    type Target = *mut bw::Unit;
    fn deref(&self) -> &Self::Target {
        unsafe {
            std::mem::transmute(&self.0)
        }
    }
}

impl Unit {
    pub unsafe fn from_ptr(ptr: *mut bw::Unit) -> Option<Unit> {
        NonNull::new(ptr).map(Unit)
    }

    pub fn player(self) -> u8 {
        unsafe { (**self).player }
    }

    pub fn id(self) -> u16 {
        unsafe { (**self).unit_id }
    }

    pub fn is_landed_building(self) -> bool {
        unsafe { (**self).flags & 0x2 != 0 }
    }
}
