use std::sync::Mutex;

use lazy_static::lazy_static;

lazy_static! {
    static ref ALLY_OVERRIDE: Mutex<Option<u8>> = Mutex::new(None);
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct StormPlayerId(pub u8);

pub fn set_ally_override(storm_ids: &[StormPlayerId]) {
    let mut bits = 0u8;
    for &id in storm_ids {
        assert!(id.0 < 8);
        bits |= 1 << id.0;
    }
    *ALLY_OVERRIDE.lock().unwrap() = Some(bits);
}

pub fn clear_ally_override() {
    *ALLY_OVERRIDE.lock().unwrap() = None;
}

pub fn get_ally_override() -> Option<u8> {
    ALLY_OVERRIDE.lock().unwrap().clone()
}
