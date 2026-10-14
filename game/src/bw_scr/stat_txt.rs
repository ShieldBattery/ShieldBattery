//! Reads names out of SC:R's stat_txt: the game's table of unit, upgrade and tech names (and most of
//! its other console text), in the language the game is running in.
//!
//! SC:R keeps stat_txt as a string table object loaded from `rez/stat_txt.json`. Its strings sit in
//! one buffer, a count followed by an offset per string, each string being NUL-terminated UTF-8 at
//! its offset. The names are read straight out of that buffer rather than through the game's
//! lookup, which fills the table's string cache and allocates a copy on every call.
//!
//! The table is loaded the first time the game asks it for anything, and is replaced whole when the
//! language changes, freeing the old buffer. So nothing read out of it is kept across calls: every
//! lookup reads the buffer's pointer again and copies the string out. Lookups are only safe on the
//! game's main thread, which is the only thread that loads or replaces the table.

use std::ffi::c_void;

use bw_dat::{TechId, UnitId, UpgradeId, WeaponId};

/// The start of SC:R's string table object, as far as the string buffer.
///
/// The buffer pointer is null until the table has been loaded. `wide_offsets` says which of the two
/// forms the buffer is in: the json loader writes the wide one, u32 counts and offsets; the narrow
/// one, u16 counts and offsets, is the classic `.tbl` layout.
#[repr(C)]
struct StringTableHead {
    vtable: *const c_void,
    data: *const u8,
    byte_length: usize,
    wide_offsets: u8,
}

#[cfg(target_arch = "x86")]
const _: () = {
    assert!(std::mem::offset_of!(StringTableHead, data) == 0x4);
    assert!(std::mem::offset_of!(StringTableHead, byte_length) == 0x8);
    assert!(std::mem::offset_of!(StringTableHead, wide_offsets) == 0xc);
};

#[cfg(target_arch = "x86_64")]
const _: () = {
    assert!(std::mem::offset_of!(StringTableHead, data) == 0x8);
    assert!(std::mem::offset_of!(StringTableHead, byte_length) == 0x10);
    assert!(std::mem::offset_of!(StringTableHead, wide_offsets) == 0x18);
};

/// How many unit types the game has, which is how long the map's array of name overrides is.
const UNIT_TYPE_COUNT: u16 = 0xe4;

/// Where stat_txt lives in this build of the game.
#[derive(Copy, Clone)]
pub struct StatTxt {
    table: *const StringTableHead,
    /// The map's `u16[UNIT_TYPE_COUNT]` of string ids for the units it gives a name of its own.
    unit_map_name_overrides: Option<*const u16>,
}

// The pointers are only dereferenced on the game's main thread, by the caller's contract.
unsafe impl Send for StatTxt {}
unsafe impl Sync for StatTxt {}

impl StatTxt {
    pub fn new(table: usize, unit_map_name_overrides: Option<usize>) -> StatTxt {
        StatTxt {
            table: table as *const StringTableHead,
            unit_map_name_overrides: unit_map_name_overrides.map(|x| x as *const u16),
        }
    }

    /// The name the game gives a unit type, or `None` before stat_txt is loaded.
    ///
    /// Also `None` for a unit the map has renamed: the map's own string table is not one this reads,
    /// and the stock name would be the wrong one for a unit the map calls something else.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread.
    pub unsafe fn unit_name(&self, unit_id: UnitId) -> Option<String> {
        unsafe {
            if let Some(overrides) = self.unit_map_name_overrides
                && unit_id.0 < UNIT_TYPE_COUNT
                && overrides.add(unit_id.0 as usize).read_unaligned() != 0
            {
                return None;
            }
            // Unit names are the first strings of stat_txt, in unit id order.
            self.string(u32::from(unit_id.0) + 1)
        }
    }

    /// The name the game gives an upgrade, or `None` before stat_txt is loaded.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread, after the dat files are loaded.
    pub unsafe fn upgrade_name(&self, upgrade_id: UpgradeId) -> Option<String> {
        unsafe { self.string(upgrade_id.label()) }
    }

    /// The name the game gives a tech, or `None` before stat_txt is loaded.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread, after the dat files are loaded.
    pub unsafe fn tech_name(&self, tech_id: TechId) -> Option<String> {
        unsafe { self.string(tech_id.label()) }
    }

    /// The name the game gives a weapon, or `None` before stat_txt is loaded.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread, after the dat files are loaded.
    pub unsafe fn weapon_name(&self, weapon_id: WeaponId) -> Option<String> {
        unsafe { self.string(weapon_id.label()) }
    }

    /// The string with stat_txt id `id`, which counts from 1 as the dat files' labels do.
    unsafe fn string(&self, id: u32) -> Option<String> {
        unsafe {
            let index = id.checked_sub(1)?;
            let table = &*self.table;
            if table.data.is_null() {
                return None;
            }
            let buffer = std::slice::from_raw_parts(table.data, table.byte_length);
            let offsets = if table.wide_offsets != 0 {
                OffsetWidth::Wide
            } else {
                OffsetWidth::Narrow
            };
            entry(buffer, offsets, index).map(display_text)
        }
    }
}

/// Which of the string table's two buffer layouts a buffer is in.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum OffsetWidth {
    /// A u16 count, then a u16 offset per string.
    Narrow,
    /// A u32 count, then a u32 offset per string.
    Wide,
}

/// The bytes of string `index` (counting from 0) in a string table buffer, up to its NUL, or `None`
/// for an index past the count or an offset past the buffer.
///
/// Bounds are checked the way the game checks them, so a string the game would find is found and
/// one it would refuse is refused. A string with no NUL before the buffer's end runs to the end.
fn entry(buffer: &[u8], width: OffsetWidth, index: u32) -> Option<&[u8]> {
    let size: usize = match width {
        OffsetWidth::Narrow => 2,
        OffsetWidth::Wide => 4,
    };
    let read = |at: usize| -> Option<usize> {
        let bytes = buffer.get(at..at.checked_add(size)?)?;
        Some(match width {
            OffsetWidth::Narrow => u16::from_le_bytes([bytes[0], bytes[1]]) as usize,
            OffsetWidth::Wide => {
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize
            }
        })
    };
    let index = index as usize;
    if index >= read(0)? {
        return None;
    }
    let offset = read(index.checked_add(1)?.checked_mul(size)?)?;
    let rest = buffer.get(offset..).filter(|rest| !rest.is_empty())?;
    let end = rest.iter().position(|&x| x == 0).unwrap_or(rest.len());
    Some(&rest[..end])
}

/// The text of a stat_txt string as it is shown.
///
/// Names carry none of the game's control bytes, the color and formatting codes below 0x20, but a
/// string that did would print them as junk, so any there are dropped. The json the table is loaded
/// from is UTF-8; a byte that is not is replaced rather than trusted.
fn display_text(bytes: &[u8]) -> String {
    let printable: Vec<u8> = bytes.iter().copied().filter(|&x| x >= 0x20).collect();
    String::from_utf8_lossy(&printable).into_owned()
}

#[cfg(test)]
mod test {
    use super::*;

    /// A buffer in `width`'s layout holding `strings`, each NUL-terminated after the offsets.
    fn buffer(width: OffsetWidth, strings: &[&[u8]]) -> Vec<u8> {
        let size = match width {
            OffsetWidth::Narrow => 2,
            OffsetWidth::Wide => 4,
        };
        let push = |out: &mut Vec<u8>, value: usize| match width {
            OffsetWidth::Narrow => out.extend_from_slice(&(value as u16).to_le_bytes()),
            OffsetWidth::Wide => out.extend_from_slice(&(value as u32).to_le_bytes()),
        };
        let mut out = Vec::new();
        push(&mut out, strings.len());
        let mut offset = size * (strings.len() + 1);
        for string in strings {
            push(&mut out, offset);
            offset += string.len() + 1;
        }
        for string in strings {
            out.extend_from_slice(string);
            out.push(0);
        }
        out
    }

    #[test]
    fn reads_both_layouts() {
        for width in [OffsetWidth::Narrow, OffsetWidth::Wide] {
            let data = buffer(width, &[b"Terran Marine", b"Terran Ghost", b""]);
            assert_eq!(entry(&data, width, 0), Some(&b"Terran Marine"[..]));
            assert_eq!(entry(&data, width, 1), Some(&b"Terran Ghost"[..]));
            assert_eq!(entry(&data, width, 2), Some(&b""[..]));
        }
    }

    #[test]
    fn refuses_indexes_past_the_count() {
        for width in [OffsetWidth::Narrow, OffsetWidth::Wide] {
            let data = buffer(width, &[b"Terran Marine"]);
            assert_eq!(entry(&data, width, 1), None);
            assert_eq!(entry(&data, width, u32::MAX), None);
        }
    }

    #[test]
    fn refuses_offsets_past_the_buffer() {
        let mut data = buffer(OffsetWidth::Wide, &[b"Terran Marine"]);
        let past = data.len() as u32;
        data[4..8].copy_from_slice(&past.to_le_bytes());
        assert_eq!(entry(&data, OffsetWidth::Wide, 0), None);
        // A count larger than the offsets the buffer has room for.
        let mut data = buffer(OffsetWidth::Narrow, &[b"Terran Marine"]);
        data.truncate(4);
        data[0..2].copy_from_slice(&5u16.to_le_bytes());
        assert_eq!(entry(&data, OffsetWidth::Narrow, 2), None);
        assert_eq!(entry(&[], OffsetWidth::Wide, 0), None);
        assert_eq!(entry(&[1], OffsetWidth::Narrow, 0), None);
    }

    #[test]
    fn cuts_strings_at_their_nul() {
        let data = buffer(OffsetWidth::Wide, &[b"Zerg Zergling\0<0>Zergling", b"Next"]);
        assert_eq!(
            entry(&data, OffsetWidth::Wide, 0),
            Some(&b"Zerg Zergling"[..])
        );
        // A last string the buffer ends before terminating runs to the end.
        let mut data = buffer(OffsetWidth::Narrow, &[b"Unterminated"]);
        data.pop();
        assert_eq!(
            entry(&data, OffsetWidth::Narrow, 0),
            Some(&b"Unterminated"[..])
        );
    }

    #[test]
    fn drops_control_bytes_and_keeps_utf8() {
        assert_eq!(display_text(b"\x03Terran\x01 Marine"), "Terran Marine");
        assert_eq!(
            display_text("Терран Пехотинец".as_bytes()),
            "Терран Пехотинец"
        );
        assert_eq!(display_text(b"Bad \xff byte"), "Bad \u{fffd} byte");
    }
}
