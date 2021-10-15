//! A bit higher-level functions for working with `*mut bw::Unit`
//!
//! `bw_dat::Unit` just wraps the raw pointer, and since it's not worth the effort
//! to implement getters/setters for every less-used field of `bw::Unit`,
//! you can get the inner pointer by dereferencing it, as in `*unit`.
//!
//! While the raw struct `bw::Unit` is exported by this module's parent,
//! it's probably clearer to keep refering it as `bw::Unit` and import
//! this `crate::bw::unit::Unit` to `Unit` where it's used.
//!
//! `bw_dat::Unit` contains most of the implementations, but this file can have some
//! extensions added as needed.

pub use bw_dat::Unit;

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
            self.0 = Unit::from_ptr((**unit).flingy.next as *mut bw::Unit);
        }
        Some(unit)
    }
}
