//! Terrain similarity between map files: shown to people (the compare page, the staff move dialog)
//! and never used to change anything by itself.

use color_eyre::eyre::{self, WrapErr};
use sqlx::PgPool;

use crate::maps::SbMapId;

/// The least terrain similarity for a file to be listed as similar to another.
pub const MIN_SIMILAR_FILE_SIMILARITY: f32 = 0.90;
/// The most files [`similar_files`] returns.
const MAX_SIMILAR_FILES: usize = 50;

/// Terrain similarity of two fingerprints of the same dimensions: of the build tiles walkable in
/// either map, the share with the same terrain class. Tiles unwalkable in both are left out, so
/// open ground decides, not the shared void around it.
pub fn terrain_similarity(a: &[u8], b: &[u8], tiles: usize) -> Option<f32> {
    if a.len() != b.len() || a.len() < tiles.div_ceil(4) {
        return None;
    }
    let mut counted = 0u32;
    let mut same = 0u32;
    for i in 0..tiles {
        let shift = (i % 4) * 2;
        let x = (a[i / 4] >> shift) & 3;
        let y = (b[i / 4] >> shift) & 3;
        if x == 3 && y == 3 {
            continue;
        }
        counted += 1;
        if x == y {
            same += 1;
        }
    }
    (counted > 0).then(|| same as f32 / counted as f32)
}

/// A file whose terrain is similar to another file's.
#[derive(Debug, Clone, PartialEq)]
pub struct SimilarFile {
    pub id: SbMapId,
    pub similarity: f32,
}

/// The listed files outside `file_id`'s family whose terrain is at least
/// [`MIN_SIMILAR_FILE_SIMILARITY`] similar to it, the most similar first. Only files of the same
/// dimensions (and fingerprint version) can be compared, so other files are never returned.
pub async fn similar_files(db: &PgPool, file_id: SbMapId) -> eyre::Result<Vec<SimilarFile>> {
    let Some(target) = sqlx::query!(
        r#"
            SELECT m.width, m.height, m.family_id, a.terrain_fingerprint as "fingerprint!",
                a.fingerprint_version as "fingerprint_version!"
            FROM maps m
            INNER JOIN map_analysis a ON a.map_id = m.id
            WHERE m.id = $1 AND a.terrain_fingerprint IS NOT NULL
                AND a.fingerprint_version IS NOT NULL
        "#,
        file_id as _,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load the file's fingerprint")?
    else {
        return Ok(Vec::new());
    };

    let candidates = sqlx::query!(
        r#"
            SELECT m.id as "id: SbMapId", a.terrain_fingerprint as "fingerprint!"
            FROM maps m
            INNER JOIN map_analysis a ON a.map_id = m.id
            WHERE m.listed AND m.width = $1 AND m.height = $2 AND m.family_id <> $3
                AND a.fingerprint_version = $4 AND a.terrain_fingerprint IS NOT NULL
        "#,
        target.width,
        target.height,
        target.family_id,
        target.fingerprint_version,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load same-size fingerprints")?;

    let tiles = usize::try_from(target.width * target.height).unwrap_or(0);
    let mut similar: Vec<SimilarFile> = candidates
        .into_iter()
        .filter_map(|row| {
            let similarity = terrain_similarity(&target.fingerprint, &row.fingerprint, tiles)?;
            (similarity >= MIN_SIMILAR_FILE_SIMILARITY).then_some(SimilarFile {
                id: row.id,
                similarity,
            })
        })
        .collect();
    similar.sort_by(|x, y| {
        y.similarity
            .total_cmp(&x.similarity)
            .then(x.id.0.cmp(&y.id.0))
    });
    similar.truncate(MAX_SIMILAR_FILES);
    Ok(similar)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similarity_ignores_tiles_unwalkable_in_both() {
        // 4 tiles per byte, low bits first: [0, 1, 3, 3] and [0, 2, 3, 3].
        let a = [0b1111_0100];
        let b = [0b1111_1000];
        assert_eq!(terrain_similarity(&a, &b, 4), Some(0.5));
        assert_eq!(terrain_similarity(&a, &a, 4), Some(1.0));
        assert_eq!(terrain_similarity(&a, &[0, 0], 4), None);
    }
}
