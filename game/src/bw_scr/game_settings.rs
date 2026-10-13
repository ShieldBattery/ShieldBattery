//! Writes to SC:R's own settings registry, the way its in-game options popup changes a setting.
//!
//! SC:R keeps every setting in one registry: a map of group names (`speed`, `sound`, `video`,
//! `game`, `language`) to maps of setting keys, each holding a setting object that owns its value,
//! default, validator and listeners. Changing a setting through the registry's own write runs the
//! validator, stores the value, marks it for persistence and notifies the listeners, which is what
//! makes most settings take effect immediately: a volume listener reapplies the mixer, a window mode
//! listener resizes the window. The settings nothing listens to are polled by their consumers every
//! frame, so a stored value is picked up all the same.
//!
//! Settings are created the first time their getter runs, so a key that is not in the registry yet
//! has no consumer to tell either; a write to it is skipped.
//!
//! Every write here must happen on the game's main thread: the listeners run synchronously, inside
//! the write, and touch whatever state their setting governs.

use super::scr;
use super::thiscall::Thiscall;

/// One of SC:R's setting objects. Only ever handled by pointer and handed back to the game.
#[repr(C)]
pub struct GameSetting {
    _private: [u8; 0],
}

type SettingMap = scr::BwHashTable<scr::BwString, GameSetting>;
type SettingGroups = scr::BwHashTable<scr::BwString, SettingMap>;

/// What the game's setting writes are passed: the setting, a pointer to the new value, and whether
/// persisting it waits for an explicit flush (it always does here, as it does from SC:R's popup;
/// saving is the app's job).
type IntWrite = Thiscall<unsafe extern "C" fn(*mut GameSetting, *const i32, u32)>;
type BoolWrite = Thiscall<unsafe extern "C" fn(*mut GameSetting, *const u8, u32)>;

/// Where the registry lives and how to write to it, as resolved for this build.
pub struct GameSettings {
    groups: *const SettingGroups,
    write_int: IntWrite,
    write_bool: BoolWrite,
}

// The pointers are only dereferenced on the game's main thread, by the caller's contract.
unsafe impl Send for GameSettings {}
unsafe impl Sync for GameSettings {}

/// A value for one of SC:R's settings.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SettingValue {
    Int(i32),
    Bool(bool),
}

impl GameSettings {
    pub fn new(groups: usize, write_int: usize, write_bool: usize) -> GameSettings {
        GameSettings {
            groups: groups as *const SettingGroups,
            write_int: Thiscall::foreign(write_int),
            write_bool: Thiscall::foreign(write_bool),
        }
    }

    /// Changes one setting through the game's own write, returning whether the setting exists.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread, with the registry initialized.
    pub unsafe fn set(&self, group: &str, key: &str, value: SettingValue) -> bool {
        unsafe {
            let Some(settings) = find(self.groups, group.as_bytes()) else {
                return false;
            };
            let Some(setting) = find(settings, key.as_bytes()) else {
                return false;
            };
            match value {
                SettingValue::Int(value) => {
                    self.write_int.call3(setting, &value, 1);
                }
                SettingValue::Bool(value) => {
                    let value = value as u8;
                    self.write_bool.call3(setting, &value, 1);
                }
            }
            true
        }
    }
}

/// Finds a value by its string key, walking every bucket rather than hashing the key: the maps hold
/// a few dozen entries at most, and a walk can't disagree with the game about which bucket a key
/// hashes to.
unsafe fn find<V>(table: *const scr::BwHashTable<scr::BwString, V>, key: &[u8]) -> Option<*mut V> {
    unsafe {
        if table.is_null() || (*table).buckets.is_null() {
            return None;
        }
        for bucket in 0..(*table).bucket_count {
            let mut entry = *(*table).buckets.add(bucket);
            while !entry.is_null() {
                let name = &(*entry).pair.key;
                if !name.pointer.is_null()
                    && std::slice::from_raw_parts(name.pointer, name.length) == key
                {
                    return Some(&raw mut (*entry).pair.value);
                }
                entry = (*entry).next;
            }
        }
        None
    }
}
