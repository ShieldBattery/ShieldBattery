//! Short codes for the game's units, for the panels that name one where they cannot draw it.
//!
//! A tile names a unit with the game's own icon. A host that has not mapped the game's icon atlas
//! into its renderer has no icon to draw, and the unit's number tells a reader nothing: `66` is a
//! dragoon to the three people who know the table by heart. A three-letter code is readable without
//! the atlas and still narrow enough for the cell the icon would have filled.
//!
//! These are codes rather than words, like `APM`, so they are not translated: they are the
//! shorthand the game's own community writes in, and a translated `ZEA` would be a code nobody
//! uses.
//!
//! Only the units a game is played with are here. A hero, a critter or a map's own doodad falls
//! back to its number, which is honest about there being nothing to say.

/// Every unit with a code, by the id the game's icon atlas is indexed with.
///
/// In the game's own numbering rather than grouped by race, so the table can be searched rather
/// than walked.
const UNIT_CODES: &[(u16, &str)] = &[
    (0x00, "MAR"),
    (0x01, "GHO"),
    (0x02, "VUL"),
    (0x03, "GOL"),
    (0x05, "TNK"),
    (0x07, "SCV"),
    (0x08, "WRA"),
    (0x09, "SCI"),
    (0x0b, "DRP"),
    (0x0c, "BC"),
    (0x0d, "SMI"),
    (0x0e, "NUK"),
    // The tank's two modes are two units to the game and one unit to a watcher.
    (0x1e, "TNK"),
    (0x20, "FIR"),
    (0x22, "MED"),
    (0x23, "LAR"),
    (0x24, "EGG"),
    (0x25, "LNG"),
    (0x26, "HYD"),
    (0x27, "ULT"),
    (0x28, "BRL"),
    (0x29, "DRN"),
    (0x2a, "OVL"),
    (0x2b, "MUT"),
    (0x2c, "GUA"),
    (0x2d, "QUE"),
    (0x2e, "DEF"),
    (0x2f, "SCO"),
    (0x32, "INF"),
    (0x3a, "VAL"),
    (0x3b, "COC"),
    (0x3c, "COR"),
    (0x3d, "DT"),
    (0x3e, "DEV"),
    (0x3f, "DA"),
    (0x40, "PRB"),
    (0x41, "ZEA"),
    (0x42, "DRG"),
    (0x43, "HT"),
    (0x44, "ARC"),
    (0x45, "SHU"),
    (0x46, "SCT"),
    (0x47, "ARB"),
    (0x48, "CAR"),
    (0x49, "INT"),
    (0x53, "REA"),
    (0x54, "OBS"),
    (0x55, "SCB"),
    (0x61, "LEG"),
    (0x67, "LUR"),
    // The buildings, addons included: an addon is bound to a key like anything else.
    (0x6a, "CC"),
    (0x6b, "COM"),
    (0x6c, "SIL"),
    (0x6d, "DEP"),
    (0x6e, "REF"),
    (0x6f, "RAX"),
    (0x70, "ACA"),
    (0x71, "FAC"),
    (0x72, "SPT"),
    (0x73, "CT"),
    (0x74, "SCF"),
    (0x75, "CO"),
    (0x76, "PL"),
    (0x78, "MS"),
    (0x7a, "EBY"),
    (0x7b, "ARM"),
    (0x7c, "TUR"),
    (0x7d, "BUN"),
    (0x83, "HAT"),
    (0x84, "LAI"),
    (0x85, "HIV"),
    (0x86, "NYD"),
    (0x87, "DEN"),
    (0x88, "MND"),
    (0x89, "GSP"),
    (0x8a, "NST"),
    (0x8b, "EVO"),
    (0x8c, "CAV"),
    (0x8d, "SPR"),
    (0x8e, "SPL"),
    (0x8f, "CRP"),
    (0x90, "SPO"),
    (0x92, "SNK"),
    (0x95, "EXT"),
    (0x9a, "NEX"),
    (0x9b, "ROB"),
    (0x9c, "PYL"),
    (0x9d, "ASM"),
    (0x9f, "OBY"),
    (0xa0, "GAT"),
    (0xa2, "CAN"),
    (0xa3, "CIT"),
    (0xa4, "CYB"),
    (0xa5, "ARX"),
    (0xa6, "FRG"),
    (0xa7, "STG"),
    (0xa9, "FLB"),
    (0xaa, "TRI"),
    (0xab, "RSB"),
    (0xac, "BAT"),
];

/// The code for a unit, or `None` for one with no shorthand worth writing.
pub fn unit_code(index: u16) -> Option<&'static str> {
    UNIT_CODES
        .binary_search_by_key(&index, |&(id, _)| id)
        .ok()
        .map(|found| UNIT_CODES[found].1)
}

/// What a tile writes in place of an icon it cannot draw: the unit's code, or its number when it
/// has none.
pub(crate) fn code_or_index(index: u16) -> String {
    match unit_code(index) {
        Some(code) => code.to_string(),
        None => index.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_in_the_order_it_is_searched_in() {
        assert!(UNIT_CODES.windows(2).all(|pair| pair[0].0 < pair[1].0));
    }

    #[test]
    fn the_units_a_game_is_played_with_have_codes() {
        assert_eq!(unit_code(0x05), Some("TNK"));
        assert_eq!(unit_code(0x41), Some("ZEA"));
        assert_eq!(unit_code(0x42), Some("DRG"));
        assert_eq!(unit_code(0x6a), Some("CC"));
        assert_eq!(unit_code(0x9a), Some("NEX"));
    }

    #[test]
    fn a_unit_no_game_is_played_with_falls_back_to_its_number() {
        // A hero, a critter and a map's own doodad.
        assert_eq!(unit_code(0x10), None);
        assert_eq!(unit_code(0x5a), None);
        assert_eq!(unit_code(0xd6), None);
        assert_eq!(code_or_index(0x10), "16");
    }
}
