//! Approximate terrain colors from classic tileset graphics.

use std::collections::HashMap;

pub(super) const EDGE_ROWS: usize = 4;

/// Returns one smoothed color per column for a top-to-bottom strip ending at the map edge.
/// Uses valid base tiles and interpolates across gaps.
pub(super) fn edge_colors(
    tiles: &[u16],
    width: usize,
    cv5: &[u8],
    vx4ex: &[u8],
    vr4: &[u8],
    wpe: &[u8],
) -> Option<Vec<[u8; 4]>> {
    if width == 0 || tiles.is_empty() || !tiles.len().is_multiple_of(width) || wpe.len() < 256 * 4 {
        return None;
    }
    let rows = tiles.len() / width;
    if rows > EDGE_ROWS {
        return None;
    }

    let mut cache = HashMap::new();
    let mut columns = Vec::with_capacity(width);
    for x in 0..width {
        let mut sum = [0u64; 3];
        let mut weight = 0u64;
        for y in 0..rows {
            let tile = tiles[y * width + x];
            let color = *cache
                .entry(tile)
                .or_insert_with(|| tile_color(tile, cv5, vx4ex, vr4, wpe));
            if let Some(color) = color {
                let row_weight = (y + 1) as u64;
                for channel in 0..3 {
                    sum[channel] += u64::from(color[channel]) * row_weight;
                }
                weight += row_weight;
            }
        }
        columns.push(
            (weight != 0).then(|| std::array::from_fn::<_, 3, _>(|i| (sum[i] / weight) as u8)),
        );
    }

    // Fill gaps from valid neighboring columns before smoothing, so isolated doodads don't
    // produce dark bands. An all-doodad or invalid strip has no reliable terrain color.
    let mut left = vec![None; width];
    let mut previous = None;
    for x in 0..width {
        if columns[x].is_some() {
            previous = Some(x);
        }
        left[x] = previous;
    }
    let mut right = None;
    for x in (0..width).rev() {
        if columns[x].is_some() {
            right = Some(x);
            continue;
        }
        columns[x] = match (left[x], right) {
            (Some(l), Some(r)) => {
                let a = columns[l]?;
                let b = columns[r]?;
                let span = (r - l) as u64;
                Some(std::array::from_fn(|i| {
                    ((u64::from(a[i]) * (r - x) as u64 + u64::from(b[i]) * (x - l) as u64) / span)
                        as u8
                }))
            }
            (Some(l), None) => columns[l],
            (None, Some(r)) => columns[r],
            (None, None) => return None,
        };
    }

    let weights = [1u32, 2, 3, 2, 1];
    let mut result = Vec::with_capacity(width);
    for x in 0..width {
        let mut sum = [0u32; 3];
        let mut total = 0u32;
        for (offset, &weight) in weights.iter().enumerate() {
            let Some(sample_x) = x.checked_add(offset).and_then(|v| v.checked_sub(2)) else {
                continue;
            };
            let Some(Some(color)) = columns.get(sample_x) else {
                continue;
            };
            for channel in 0..3 {
                sum[channel] += u32::from(color[channel]) * weight;
            }
            total += weight;
        }
        result.push([
            (sum[0] / total) as u8,
            (sum[1] / total) as u8,
            (sum[2] / total) as u8,
            255,
        ]);
    }
    Some(result)
}

fn tile_color(tile: u16, cv5: &[u8], vx4ex: &[u8], vr4: &[u8], wpe: &[u8]) -> Option<[u8; 3]> {
    let group = usize::from(tile >> 4);
    let variant = usize::from(tile & 15);
    let group_offset = group.checked_mul(52)?;
    let group_data = cv5.get(group_offset..group_offset.checked_add(52)?)?;
    // The first field is terrain type: 1 denotes a doodad, including SC:R doodads
    // whose group index is below the traditional 1024 boundary.
    if u16::from_le_bytes(group_data.get(..2)?.try_into().ok()?) == 1 {
        return None;
    }
    let index = 20 + variant * 2;
    let mega = usize::from(u16::from_le_bytes(
        group_data.get(index..index + 2)?.try_into().ok()?,
    ));
    let offset = mega.checked_mul(64)?;
    let mini_refs = vx4ex.get(offset..offset.checked_add(64)?)?;
    let mut sum = [0u64; 3];
    for &reference in mini_refs.as_chunks::<4>().0 {
        let mini = u32::from_le_bytes(reference) >> 1;
        let offset = usize::try_from(mini).ok()?.checked_mul(64)?;
        let pixels = vr4.get(offset..offset.checked_add(64)?)?;
        // Mirroring has no effect on a whole-tile mean.
        for &pixel in pixels {
            let offset = usize::from(pixel) * 4;
            let color = wpe.get(offset..offset + 3)?;
            for channel in 0..3 {
                sum[channel] += u64::from(color[channel]);
            }
        }
    }
    Some(std::array::from_fn(|i| (sum[i] / 1024) as u8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assets() -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut cv5 = vec![0; 52 * 3];
        cv5[0..2].copy_from_slice(&2u16.to_le_bytes());
        cv5[52..54].copy_from_slice(&1u16.to_le_bytes());
        cv5[104..106].copy_from_slice(&2u16.to_le_bytes());
        cv5[124..126].copy_from_slice(&1u16.to_le_bytes());
        let mut vx4ex = vec![0; 128];
        for mini in vx4ex[64..].as_chunks_mut::<4>().0 {
            *mini = 2u32.to_le_bytes();
        }
        let mut vr4 = vec![0; 128];
        vr4[64..].fill(1);
        let mut wpe = vec![0; 1024];
        wpe[..3].copy_from_slice(&[30, 60, 90]);
        wpe[4..7].copy_from_slice(&[150, 180, 210]);
        (cv5, vx4ex, vr4, wpe)
    }

    #[test]
    fn excludes_doodad_and_interpolates_gap() {
        let (cv5, vx4ex, vr4, wpe) = assets();
        let colors = edge_colors(&[0, 16, 32], 3, &cv5, &vx4ex, &vr4, &wpe).unwrap();
        assert_eq!(colors[1], [90, 120, 150, 255]);
        assert!(colors[0][0] < colors[1][0]);
        assert!(colors[2][0] > colors[1][0]);
        assert!(edge_colors(&[16], 1, &cv5, &vx4ex, &vr4, &wpe).is_none());
    }

    #[test]
    fn weights_edge_rows_and_rejects_bad_input() {
        let (cv5, vx4ex, vr4, wpe) = assets();
        assert_eq!(
            edge_colors(&[0, 32], 1, &cv5, &vx4ex, &vr4, &wpe),
            Some(vec![[110, 140, 170, 255]])
        );
        assert!(edge_colors(&[0], 0, &cv5, &vx4ex, &vr4, &wpe).is_none());
        assert!(edge_colors(&[0], 1, &cv5, &vx4ex[..10], &vr4, &wpe).is_none());
        assert!(edge_colors(&[0], 1, &cv5, &vx4ex, &vr4, &wpe[..10]).is_none());
    }
}
