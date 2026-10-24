use std::collections::HashMap;

use async_graphql::dataloader::Loader;
use async_graphql::futures_util::TryStreamExt;
use async_graphql::{Object, SimpleObject};

use crate::users::permissions::RequiredPermission;
use data_encoding::BASE64;
use sqlx::PgPool;
use sqlx::types::Json;

use crate::maps::MapHash;
use crate::maps::parse::MapBase;

#[derive(Clone, Debug)]
pub struct MapFileAnalysis {
    pub hash: MapHash,
    pub bases: Option<Vec<MapBase>>,
    pub trigger_count: i32,
    pub ums_action_kinds: Vec<String>,
    pub makers: Vec<String>,
    pub credited: Vec<String>,
}

/// What analyzing a map file found about how it plays.
#[Object(name = "MapAnalysis")]
impl MapFileAnalysis {
    /// The map file's hash, the same as the map file's id.
    async fn id(&self) -> String {
        BASE64.encode(&self.hash.0)
    }

    /// The number of resource bases. Null if the bases couldn't be found.
    async fn base_count(&self) -> Option<i32> {
        self.bases
            .as_ref()
            .map(|b| i32::try_from(b.len()).unwrap_or(i32::MAX))
    }

    async fn trigger_count(&self) -> i32 {
        self.trigger_count
    }

    /// The kinds of trigger actions the map uses that melee games don't, e.g. `CreateUnit`. Empty
    /// for melee maps.
    async fn ums_action_kinds(&self) -> &[String] {
        &self.ums_action_kinds
    }

    /// Who the map's description says made it, normalized for comparison (lowercase, letters and
    /// digits only). A hint for sorting families, never shown as a credit. Only available to users
    /// who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn makers(&self) -> &[String] {
        &self.makers
    }

    /// Who the map's description credits as the original, normalized like `makers`. Only
    /// available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn credited(&self) -> &[String] {
        &self.credited
    }

    /// The resource bases. Null if they couldn't be found.
    async fn bases(&self) -> Option<Vec<MapFileBase>> {
        let hash = BASE64.encode(&self.hash.0);
        self.bases.as_ref().map(|bases| {
            bases
                .iter()
                .enumerate()
                .map(|(i, base)| MapFileBase::new(&hash, i, base))
                .collect()
        })
    }
}

/// A resource base: a town hall position with minerals or geysers around it.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "MapBase")]
pub struct MapFileBase {
    /// The map file's hash and the base's index, unique across all map files.
    pub id: String,
    /// The center of the town hall position, in map pixels (32 per tile).
    pub x: i32,
    pub y: i32,
    pub mineral_fields: i32,
    /// The minerals in all of the base's mineral fields.
    pub minerals: i32,
    pub geysers: i32,
    /// The player slots (0-7) whose start location is at this base.
    pub start_slots: Vec<i32>,
}

impl MapFileBase {
    fn new(hash: &str, index: usize, base: &MapBase) -> Self {
        let int = |v: u64| i32::try_from(v).unwrap_or(i32::MAX);
        Self {
            id: format!("{hash}:{index}"),
            x: int(base.x.into()),
            y: int(base.y.into()),
            mineral_fields: int(base.mineral_fields.into()),
            minerals: int(base.minerals),
            geysers: int(base.geysers.into()),
            start_slots: base.start_slots.iter().map(|&s| s.into()).collect(),
        }
    }
}

/// Loads the analysis of map files by hash. Files that haven't been analyzed are left out.
pub struct MapAnalysisLoader {
    db: PgPool,
}

impl MapAnalysisLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<MapHash> for MapAnalysisLoader {
    type Value = MapFileAnalysis;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[MapHash]) -> Result<HashMap<MapHash, Self::Value>, Self::Error> {
        Ok(sqlx::query!(
            r#"
                SELECT m.hash as "hash: MapHash", a.bases as "bases: Json<Vec<MapBase>>",
                    a.trigger_count, a.ums_action_kinds, a.makers, a.credited
                FROM map_analysis a
                JOIN maps m ON m.id = a.map_id
                WHERE m.hash = ANY($1)
            "#,
            keys as _,
        )
        .fetch(&self.db)
        .map_ok(|row| {
            (
                row.hash,
                MapFileAnalysis {
                    hash: row.hash,
                    bases: row.bases.map(|b| b.0),
                    trigger_count: row.trigger_count,
                    ums_action_kinds: row.ums_action_kinds,
                    makers: row.makers,
                    credited: row.credited,
                },
            )
        })
        .try_collect()
        .await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bases_convert_with_ids() {
        let base = MapBase {
            x: 2112,
            y: 368,
            mineral_fields: 8,
            minerals: 10_800,
            geysers: 1,
            start_slots: vec![0, 3],
        };
        let converted = MapFileBase::new("aGFzaA==", 2, &base);
        assert_eq!(converted.id, "aGFzaA==:2");
        assert_eq!((converted.x, converted.y), (2112, 368));
        assert_eq!(converted.mineral_fields, 8);
        assert_eq!(converted.minerals, 10_800);
        assert_eq!(converted.geysers, 1);
        assert_eq!(converted.start_slots, [0, 3]);

        let huge = MapBase {
            minerals: u64::from(u32::MAX) * 8,
            ..base
        };
        assert_eq!(MapFileBase::new("h", 0, &huge).minerals, i32::MAX);
    }
}
