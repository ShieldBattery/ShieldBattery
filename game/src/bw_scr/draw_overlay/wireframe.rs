//! The status panel's unit wireframes, which stand in for the units the command-icon atlas has no
//! icon of: a larva's egg and a lurker egg, whose atlas frames are a radiation symbol and a
//! placeholder.
//!
//! The game draws a wireframe as layers of one white mask, each multiplied by a color of its own
//! (see [`ProductionIcon::wireframe`](overlay_ui::observer::ProductionIcon::wireframe)). Which color
//! a layer is drawn in depends on how hurt the unit is: the game picks an entry of a small remap
//! for every layer and level of health, and the entry names the palette color. The remap is read
//! from `game\twire.pcx`, whose first row of pixels is it.

use std::ffi::{CStr, CString};

use bw_dat::UnitId;
use overlay_ui::observer::WIREFRAME_LAYERS;

/// How many entries the remap has.
const REMAP_LEN: usize = 24;

/// The palette remap a wireframe's layers are colored through: entry `n` is the index of a color
/// of the game's main palette.
#[derive(Copy, Clone, PartialEq, Debug)]
pub struct WireframeRemap([u8; REMAP_LEN]);

/// How many levels of health a wireframe tells apart: a unit at full health, and five levels of
/// hurt below it.
const HEALTH_LEVELS: usize = 6;

/// The remap entry each hit-point layer is drawn in at each level of health, for the kind of
/// wireframe eggs and cocoons are drawn with: indexed by the level, from the most hurt to full
/// health, then by the layer.
const POD_LAYER_ENTRIES: [[u8; WIREFRAME_LAYERS]; HEALTH_LEVELS] = [
    [0x0e, 0x06, 0x07, 0x08],
    [0x13, 0x0b, 0x0d, 0x06],
    [0x13, 0x0b, 0x0a, 0x10],
    [0x01, 0x12, 0x14, 0x10],
    [0x01, 0x12, 0x14, 0x0c],
    [0x00, 0x01, 0x12, 0x0a],
];

/// The level of health a unit at full health is at.
pub const FULL_HEALTH: usize = HEALTH_LEVELS - 1;

/// Whether a kind of unit is named by its wireframe rather than its command icon: the eggs, which
/// the command-icon atlas has no art for (a larva's egg's frame is a radiation symbol, a lurker
/// egg's reads BLANK).
pub fn draws_as_wireframe(id: UnitId) -> bool {
    matches!(id, bw_dat::unit::EGG | bw_dat::unit::LURKER_EGG)
}

/// The level of health a unit with `hit_points` of `max_hit_points` is drawn at, as the game
/// reckons it: fifths of the maximum, rounded down, so only a unit at full health reads full.
pub fn health_level(hit_points: u32, max_hit_points: u32) -> usize {
    if max_hit_points == 0 {
        return FULL_HEALTH;
    }
    let level = u64::from(hit_points) * (HEALTH_LEVELS as u64 - 1) / u64::from(max_hit_points);
    (level as usize).min(FULL_HEALTH)
}

impl WireframeRemap {
    /// Reads the remap out of the game's storage through `read`, or `None` where the game has no
    /// such file or it does not decode.
    pub fn load(read: impl FnOnce(&CStr) -> Option<Vec<u8>>) -> Option<WireframeRemap> {
        let path = CString::new("game/twire.pcx").ok()?;
        WireframeRemap::from_pcx(&read(&path)?)
    }

    /// The remap out of a PCX image's first row of pixels.
    ///
    /// Only what the game's own file is is read: one plane of 8-bit pixels, run-length encoded. A
    /// file of any other kind, or with a row too short to hold the remap, is `None`.
    fn from_pcx(pcx: &[u8]) -> Option<WireframeRemap> {
        const HEADER_LEN: usize = 128;
        let header = pcx.get(..HEADER_LEN)?;
        let word = |offset: usize| u16::from_le_bytes([header[offset], header[offset + 1]]);
        let (manufacturer, encoding, bits_per_pixel, planes) =
            (header[0], header[2], header[3], header[65]);
        if manufacturer != 0x0a || encoding != 1 || bits_per_pixel != 8 || planes != 1 {
            return None;
        }
        let width = usize::from(word(8).checked_sub(word(4))?) + 1;
        let bytes_per_line = usize::from(word(66));
        if width < REMAP_LEN || bytes_per_line < width {
            return None;
        }
        // A run's top two bits set say its other six are a count of the byte after it; any other
        // byte is a pixel of its own.
        let mut row = Vec::with_capacity(bytes_per_line);
        let mut data = pcx[HEADER_LEN..].iter().copied();
        while row.len() < bytes_per_line {
            let byte = data.next()?;
            if byte & 0xc0 == 0xc0 {
                let value = data.next()?;
                let count = usize::from(byte & 0x3f).min(bytes_per_line - row.len());
                row.extend(std::iter::repeat_n(value, count));
            } else {
                row.push(byte);
            }
        }
        Some(WireframeRemap(row[..REMAP_LEN].try_into().ok()?))
    }

    /// The main-palette index each hit-point layer of an egg or a cocoon is drawn in at the
    /// `level` of health [`health_level`] reckons.
    pub fn pod_layer_colors(&self, level: usize) -> [u8; WIREFRAME_LAYERS] {
        POD_LAYER_ENTRIES[level.min(FULL_HEALTH)].map(|entry| self.0[usize::from(entry)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the game's `game\twire.pcx` decodes to.
    const TWIRE_REMAP: [u8; REMAP_LEN] = [
        0x87, 0x75, 0x8a, 0xa5, 0xa5, 0xa2, 0xa2, 0xa0, 0xa0, 0x29, 0xae, 0x17, 0x17, 0x62, 0xa4,
        0xa4, 0xa3, 0xa1, 0x9c, 0xb1, 0x1a, 0x00, 0x00, 0x00,
    ];

    /// The pixels of the game's file, as they are encoded there: runs of two and three among single
    /// pixels.
    const TWIRE_PIXELS: [u8; 23] = [
        0x87, 0x75, 0x8a, 0xc2, 0xa5, 0xc2, 0xa2, 0xc2, 0xa0, 0x29, 0xae, 0xc2, 0x17, 0x62, 0xc2,
        0xa4, 0xa3, 0xa1, 0x9c, 0xb1, 0x1a, 0xc3, 0x00,
    ];

    /// A PCX file of one row of 8-bit pixels `width` wide, encoded as `pixels`.
    fn pcx(width: u16, pixels: &[u8]) -> Vec<u8> {
        let mut file = vec![0; 128];
        file[..4].copy_from_slice(&[0x0a, 5, 1, 8]);
        file[8..10].copy_from_slice(&(width - 1).to_le_bytes());
        file[65] = 1;
        file[66..68].copy_from_slice(&width.to_le_bytes());
        file.extend_from_slice(pixels);
        // The 256-color palette that follows the pixels, which is not read.
        file.push(0x0c);
        file.extend([0; 768]);
        file
    }

    #[test]
    fn decodes_the_games_remap() {
        assert_eq!(
            WireframeRemap::from_pcx(&pcx(24, &TWIRE_PIXELS)),
            Some(WireframeRemap(TWIRE_REMAP))
        );
    }

    #[test]
    fn reads_the_first_pixels_of_a_wider_row() {
        let mut pixels = TWIRE_PIXELS.to_vec();
        pixels.extend([0xc8, 0x55]);
        assert_eq!(
            WireframeRemap::from_pcx(&pcx(32, &pixels)),
            Some(WireframeRemap(TWIRE_REMAP))
        );
    }

    #[test]
    fn refuses_a_row_too_short_for_the_remap() {
        assert_eq!(WireframeRemap::from_pcx(&pcx(23, &TWIRE_PIXELS)), None);
    }

    #[test]
    fn refuses_a_truncated_file() {
        let file = pcx(24, &TWIRE_PIXELS);
        assert_eq!(WireframeRemap::from_pcx(&file[..140]), None);
        assert_eq!(WireframeRemap::from_pcx(&file[..100]), None);
    }

    #[test]
    fn refuses_a_file_that_is_not_8_bit() {
        let mut file = pcx(24, &TWIRE_PIXELS);
        file[3] = 4;
        assert_eq!(WireframeRemap::from_pcx(&file), None);
    }

    #[test]
    fn a_run_is_cut_at_the_end_of_the_row() {
        // One run of 30 pixels where the row only has room for 24.
        assert_eq!(
            WireframeRemap::from_pcx(&pcx(24, &[0xc0 | 30, 0x42])),
            Some(WireframeRemap([0x42; REMAP_LEN]))
        );
    }

    #[test]
    fn only_full_health_reads_full() {
        assert_eq!(health_level(200, 200), FULL_HEALTH);
        assert_eq!(health_level(199, 200), 4);
        assert_eq!(health_level(40, 200), 1);
        assert_eq!(health_level(39, 200), 0);
        assert_eq!(health_level(0, 200), 0);
        assert_eq!(health_level(250, 200), FULL_HEALTH);
        assert_eq!(health_level(1, 0), FULL_HEALTH);
    }

    #[test]
    fn layers_take_their_levels_entries() {
        let remap = WireframeRemap(TWIRE_REMAP);
        assert_eq!(
            remap.pod_layer_colors(FULL_HEALTH),
            [0x87, 0x75, 0x9c, 0xae]
        );
        assert_eq!(remap.pod_layer_colors(0), [0xa4, 0xa2, 0xa0, 0xa0]);
        assert_eq!(
            remap.pod_layer_colors(9),
            remap.pod_layer_colors(FULL_HEALTH)
        );
    }
}
