//! Similarity between map files: shown to people (the compare page, the staff move dialog, the
//! "this looks like a version of X" question at publish) and never used to change anything by
//! itself.

use std::cmp::Ordering;
use std::collections::HashMap;

use color_eyre::eyre::{self, WrapErr};
use sqlx::types::Json;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::parse::TriggerProfile;

/// The least terrain similarity for a file to be listed as similar to another.
pub const MIN_SIMILAR_FILE_SIMILARITY: f32 = 0.90;
/// The most files [`similar_files`] returns.
const MAX_SIMILAR_FILES: usize = 50;

/// The least terrain similarity for a listed file to make its map a publish suggestion. A higher
/// threshold drops true versions of a map without removing false candidates, since even identical
/// terrain is often a different map (UMS content built on a melee map's terrain). So the threshold
/// only finds candidates: kind and triggers order them, and a person always confirms.
pub const MIN_SUGGESTION_SIMILARITY: f32 = 0.90;
/// The least trigger similarity for two UMS files to count as playing the same way, which ranks a
/// suggestion above ones with other triggers.
pub const MIN_TRIGGER_MATCH_SIMILARITY: f32 = 0.9;
/// The most maps [`publish_suggestions`] returns.
const MAX_PUBLISH_SUGGESTIONS: usize = 3;

/// Trigger similarity of two trigger profiles: the weighted Jaccard index over every action kind,
/// `sum(min(a, b)) / sum(max(a, b))`. `None` when both profiles are empty.
pub fn trigger_similarity(a: &TriggerProfile, b: &TriggerProfile) -> Option<f32> {
    let mut shared = 0u64;
    let mut total = 0u64;
    for (kind, &x) in a {
        let y = b.get(kind).copied().unwrap_or(0);
        shared += u64::from(x.min(y));
        total += u64::from(x.max(y));
    }
    for (kind, &y) in b {
        if !a.contains_key(kind) {
            total += u64::from(y);
        }
    }
    (total > 0).then(|| (shared as f64 / total as f64) as f32)
}

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

/// A map suggested as the one a file is a version of, through its file most similar to it.
#[derive(Debug, Clone, PartialEq)]
pub struct PublishSuggestion {
    pub family_id: Uuid,
    /// The suggested map's file most similar to the file.
    pub file_id: SbMapId,
    /// The terrain similarity of the two files.
    pub similarity: f32,
    /// Whether both files are melee maps, or both UMS maps.
    pub same_kind: bool,
    /// The trigger similarity of the two files, when both have UMS content.
    pub trigger_similarity: Option<f32>,
    /// Whether the files have the same number of mineral fields and geysers and the same minerals
    /// in total.
    pub same_resources: bool,
}

impl PublishSuggestion {
    fn triggers_match(&self) -> bool {
        self.trigger_similarity
            .is_some_and(|s| s >= MIN_TRIGGER_MATCH_SIMILARITY)
    }
}

/// A listed file that could make its map a publish suggestion.
#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionCandidate {
    pub suggestion: PublishSuggestion,
    /// Games played on the candidate's map ever (or on the file, when the map has no stats of its
    /// own yet).
    pub games: i64,
}

/// Picks the maps to suggest from `candidates`: one per map, its file most similar to the target,
/// ranked by the same kind (melee or UMS) first, then (for UMS maps) matching triggers, then terrain
/// similarity, then games played, then map id. At most [`MAX_PUBLISH_SUGGESTIONS`].
pub fn rank_suggestions(candidates: Vec<SuggestionCandidate>) -> Vec<PublishSuggestion> {
    let mut best: HashMap<Uuid, SuggestionCandidate> = HashMap::new();
    for candidate in candidates {
        let family_id = candidate.suggestion.family_id;
        match best.get(&family_id) {
            Some(kept) if better_file(kept, &candidate) != Ordering::Greater => {}
            _ => {
                best.insert(family_id, candidate);
            }
        }
    }
    let mut ranked: Vec<SuggestionCandidate> = best.into_values().collect();
    ranked.sort_by(|a, b| {
        let (x, y) = (&a.suggestion, &b.suggestion);
        y.same_kind
            .cmp(&x.same_kind)
            .then(y.triggers_match().cmp(&x.triggers_match()))
            .then(y.similarity.total_cmp(&x.similarity))
            .then(b.games.cmp(&a.games))
            .then(x.family_id.cmp(&y.family_id))
    });
    ranked.truncate(MAX_PUBLISH_SUGGESTIONS);
    ranked.into_iter().map(|c| c.suggestion).collect()
}

/// Whether `b` represents its map better than `a` (`Greater`) as a suggestion: the more similar
/// terrain, then the same kind, then matching triggers, then the lower file id.
fn better_file(a: &SuggestionCandidate, b: &SuggestionCandidate) -> Ordering {
    let (x, y) = (&a.suggestion, &b.suggestion);
    y.similarity
        .total_cmp(&x.similarity)
        .then(y.same_kind.cmp(&x.same_kind))
        .then(y.triggers_match().cmp(&x.triggers_match()))
        .then(x.file_id.0.cmp(&y.file_id.0))
}

/// The maps `file_id` most likely is a version of: maps with a listed file of the same dimensions
/// whose terrain is at least [`MIN_SUGGESTION_SIMILARITY`] similar, ranked by [`rank_suggestions`].
/// The file's own map is never suggested. A file without a terrain fingerprint gets none.
pub async fn publish_suggestions(
    conn: &mut PgConnection,
    file_id: SbMapId,
) -> eyre::Result<Vec<PublishSuggestion>> {
    let Some(target) = sqlx::query!(
        r#"
            SELECT m.width, m.height, m.family_id, m.kind as "kind!",
                COALESCE(m.ums_content, false) as "ums_content!",
                a.terrain_fingerprint as "fingerprint!",
                a.fingerprint_version as "fingerprint_version!",
                a.mineral_fields, a.mineral_total, a.geysers,
                a.trigger_profile as "trigger_profile: Json<TriggerProfile>"
            FROM maps m
            INNER JOIN map_analysis a ON a.map_id = m.id
            WHERE m.id = $1 AND a.terrain_fingerprint IS NOT NULL
                AND a.fingerprint_version IS NOT NULL
        "#,
        file_id as _,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to load the file's fingerprint")?
    else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query!(
        r#"
            SELECT m.id as "id: SbMapId", m.family_id, m.kind as "kind!",
                COALESCE(m.ums_content, false) as "ums_content!",
                a.terrain_fingerprint as "fingerprint!",
                a.mineral_fields, a.mineral_total, a.geysers,
                a.trigger_profile as "trigger_profile: Json<TriggerProfile>",
                COALESCE(
                    (SELECT fs.games_total FROM map_family_stats fs
                        WHERE fs.family_id = m.family_id),
                    (SELECT s.games_total FROM map_stats s WHERE s.map_id = m.id),
                    0
                ) as "games!"
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
    .fetch_all(&mut *conn)
    .await
    .wrap_err("Failed to load same-size fingerprints")?;

    let tiles = usize::try_from(target.width * target.height).unwrap_or(0);
    let target_triggers = target
        .ums_content
        .then_some(target.trigger_profile.as_ref())
        .flatten();
    let candidates = rows
        .into_iter()
        .filter_map(|row| {
            let similarity = terrain_similarity(&target.fingerprint, &row.fingerprint, tiles)?;
            if similarity < MIN_SUGGESTION_SIMILARITY {
                return None;
            }
            let trigger_similarity = match (target_triggers, &row.trigger_profile) {
                (Some(a), Some(b)) if row.ums_content => trigger_similarity(a, b),
                _ => None,
            };
            Some(SuggestionCandidate {
                suggestion: PublishSuggestion {
                    family_id: row.family_id,
                    file_id: row.id,
                    similarity,
                    same_kind: row.kind == target.kind,
                    trigger_similarity,
                    same_resources: row.mineral_fields == target.mineral_fields
                        && row.mineral_total == target.mineral_total
                        && row.geysers == target.geysers,
                },
                games: i64::from(row.games),
            })
        })
        .collect();
    Ok(rank_suggestions(candidates))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        family: u8,
        file: u8,
        similarity: f32,
        same_kind: bool,
        trigger_similarity: Option<f32>,
        games: i64,
    ) -> SuggestionCandidate {
        SuggestionCandidate {
            suggestion: PublishSuggestion {
                family_id: Uuid::from_bytes([family; 16]),
                file_id: SbMapId(Uuid::from_bytes([file; 16])),
                similarity,
                same_kind,
                trigger_similarity,
                same_resources: false,
            },
            games,
        }
    }

    fn families(suggestions: &[PublishSuggestion]) -> Vec<u8> {
        suggestions
            .iter()
            .map(|s| s.family_id.as_bytes()[0])
            .collect()
    }

    #[test]
    fn trigger_similarity_is_weighted_jaccard() {
        let profile = |pairs: &[(&str, u32)]| -> TriggerProfile {
            pairs.iter().map(|&(k, v)| (k.to_string(), v)).collect()
        };
        let a = profile(&[("CreateUnit", 4), ("Victory", 1)]);
        let b = profile(&[("CreateUnit", 2), ("Defeat", 1)]);
        // min: CreateUnit 2; max: CreateUnit 4, Victory 1, Defeat 1
        assert_eq!(trigger_similarity(&a, &b), Some(2.0 / 6.0));
        assert_eq!(trigger_similarity(&b, &a), Some(2.0 / 6.0));
        assert_eq!(trigger_similarity(&a, &a), Some(1.0));
        assert_eq!(trigger_similarity(&a, &TriggerProfile::new()), Some(0.0));
        assert_eq!(
            trigger_similarity(&TriggerProfile::new(), &TriggerProfile::new()),
            None
        );
    }

    #[test]
    fn same_kind_beats_similarity() {
        let ranked = rank_suggestions(vec![
            candidate(1, 1, 1.0, false, None, 100),
            candidate(2, 2, MIN_SUGGESTION_SIMILARITY, true, None, 0),
        ]);
        assert_eq!(families(&ranked), vec![2, 1]);
    }

    #[test]
    fn matching_triggers_beat_similarity_among_ums_maps() {
        let ranked = rank_suggestions(vec![
            candidate(1, 1, 1.0, true, Some(0.5), 100),
            candidate(
                2,
                2,
                0.96,
                true,
                Some(MIN_TRIGGER_MATCH_SIMILARITY + 0.05),
                0,
            ),
            candidate(
                3,
                3,
                0.99,
                true,
                Some(MIN_TRIGGER_MATCH_SIMILARITY - 0.01),
                0,
            ),
        ]);
        assert_eq!(families(&ranked), vec![2, 1, 3]);
    }

    #[test]
    fn games_then_family_id_break_ties() {
        let ranked = rank_suggestions(vec![
            candidate(3, 3, 0.97, true, None, 5),
            candidate(2, 2, 0.97, true, None, 5),
            candidate(1, 1, 0.97, true, None, 1),
        ]);
        assert_eq!(families(&ranked), vec![2, 3, 1]);
    }

    #[test]
    fn keeps_each_maps_most_similar_file() {
        let ranked = rank_suggestions(vec![
            candidate(1, 1, 0.96, true, None, 0),
            candidate(1, 2, 0.99, false, None, 0),
            candidate(1, 3, 0.97, true, None, 0),
            candidate(2, 4, 0.98, true, None, 0),
        ]);
        assert_eq!(families(&ranked), vec![2, 1]);
        assert_eq!(ranked[1].file_id, SbMapId(Uuid::from_bytes([2; 16])));
        assert!(
            !ranked[1].same_kind,
            "the map is represented by its most similar file"
        );
    }

    #[test]
    fn suggests_at_most_three_maps() {
        let ranked = rank_suggestions(
            (1..=5)
                .map(|n| {
                    let similarity = MIN_SUGGESTION_SIMILARITY + f32::from(n) / 100.0;
                    candidate(n, n, similarity, true, None, 0)
                })
                .collect(),
        );
        assert_eq!(families(&ranked), vec![5, 4, 3]);
    }

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
