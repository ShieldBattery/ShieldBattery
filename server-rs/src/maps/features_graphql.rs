//! The GraphQL API of the weekly feature slot: the pick shown this week, the schedule of picks for
//! staff, setting and removing picks, and the weeks a map was picked.

use std::collections::HashMap;
use std::sync::Arc;

use async_graphql::connection::{Connection, CursorType, Edge, EmptyFields, OpaqueCursor};
use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{Context, Object, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use typeshare::typeshare;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{
    SbMap, is_staff, load_sb_map, load_user, require_current_user, resolve_map_id,
};
use crate::maps::collections::CollectionRow;
use crate::maps::collections::graphql::{MapCollection, current_viewer};
use crate::maps::features::{
    self, FeatureError, FeatureTarget, StoredFeature, check_schedulable, clean_blurb, parse_week,
    week_of, week_start,
};
use crate::maps::search::{MapLens, MapSearchRepo};
use crate::redis::RedisPool;
use crate::users::permissions::RequiredPermission;
use crate::users::{SbUser, SbUserId};

/// Picks per page of `mapFeatures` unless `first` says otherwise.
const DEFAULT_PAGE_SIZE: i32 = 30;
/// The most picks one page of `mapFeatures` may hold.
const MAX_PAGE_SIZE: i32 = 100;

/// Messages published to Node (via Redis pub/sub) about the weekly picks. Node tells the maker of
/// the running week's pick, once, that it is the map or collection of the week.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedMapFeatureMessage {
    /// The pick of a week was set to another map or collection, or its blurb changed. `week` is the
    /// instant the week starts. Only sent for the week that is running.
    #[serde(rename_all = "camelCase")]
    PickChanged { week: DateTime<Utc> },
}

/// Publishes a map feature message. Best-effort: a failed publish only delays a notification until
/// the next time Node looks for one, so it doesn't fail the request.
async fn publish_feature_message(ctx: &Context<'_>, message: PublishedMapFeatureMessage) {
    let Some(redis) = ctx.data_opt::<RedisPool>() else {
        tracing::warn!("no RedisPool available to publish a map feature message");
        return;
    };
    if let Err(err) = redis.publish(message).await {
        tracing::error!("failed to publish map feature message: {err:?}");
    }
}

fn feature_error(error: FeatureError) -> async_graphql::Error {
    match error.code() {
        Some(code) => graphql_error(code, error.to_string()),
        None => async_graphql::Error::new(format!("{error:?}")),
    }
}

/// The map or collection leading the Discover page for a week.
pub struct MapFeature {
    week: NaiveDate,
    family_id: Option<Uuid>,
    map_id: Option<SbMapId>,
    collection: Option<CollectionRow>,
    blurb: String,
    automatic: bool,
    created_by: Option<SbUserId>,
    shown: bool,
}

impl MapFeature {
    fn stored(feature: StoredFeature) -> Self {
        let shown = feature.shown();
        let StoredFeature { row, collection } = feature;
        Self {
            week: row.week,
            family_id: row.family_id,
            map_id: row.current_map_id,
            collection,
            blurb: row.blurb,
            automatic: false,
            created_by: Some(row.created_by),
            shown,
        }
    }

    fn new_automatic(week: NaiveDate, family_id: Uuid, map_id: SbMapId) -> Self {
        Self {
            week,
            family_id: Some(family_id),
            map_id: Some(map_id),
            collection: None,
            blurb: String::new(),
            automatic: true,
            created_by: None,
            shown: true,
        }
    }
}

/// The map or collection leading the Discover page for a week: one staff picked, or when staff
/// picked nothing everyone can see, the map rising fastest.
#[Object]
impl MapFeature {
    async fn id(&self) -> String {
        match (&self.collection, self.family_id) {
            (Some(collection), _) => {
                format!("map-feature:{}:collection:{}", self.week, collection.id)
            }
            (None, Some(family)) => format!("map-feature:{}:map:{family}", self.week),
            (None, None) => format!("map-feature:{}", self.week),
        }
    }

    /// When the week starts: a Monday at 00:00 UTC. The week ends when the next one starts.
    async fn week(&self) -> DateTime<Utc> {
        week_start(self.week)
    }

    /// The picked map's current file. Null for a collection.
    async fn map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The picked collection. Null for a map, and when the viewer can't see the collection.
    async fn collection(&self, ctx: &Context<'_>) -> Result<Option<MapCollection>> {
        let Some(row) = &self.collection else {
            return Ok(None);
        };
        let viewer = current_viewer(ctx).await?;
        Ok(row
            .can_read(viewer)
            .then(|| MapCollection::new(row.clone(), viewer)))
    }

    /// What staff wrote about the pick, plain text on one line. Empty when they wrote nothing, and
    /// for an automatic pick.
    async fn blurb(&self) -> &str {
        &self.blurb
    }

    /// Whether this is the automatic pick, the map rising fastest, standing in for a week without
    /// a staff pick everyone can see.
    async fn automatic(&self) -> bool {
        self.automatic
    }

    /// Who made the pick. Null for an automatic pick, and for users who can't manage maps.
    async fn created_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        if !is_staff(ctx).await {
            return Ok(None);
        }
        load_user(ctx, self.created_by).await
    }

    /// Whether the pick is shown: it points at a listed map or at a collection everyone can see.
    /// A week whose pick isn't shown gets the automatic pick instead. Only available to users who
    /// can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn shown(&self) -> bool {
        self.shown
    }
}

/// Loads the weeks up to and including the current one in which each map (family) was the staff
/// pick, newest first, by family id.
pub struct MapFeaturedWeeksLoader {
    db: PgPool,
}

impl MapFeaturedWeeksLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for MapFeaturedWeeksLoader {
    type Value = Arc<Vec<NaiveDate>>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Arc<Vec<NaiveDate>>>> {
        let this_week = week_of(Utc::now());
        Ok(features::featured_weeks(&self.db, keys, this_week)
            .await?
            .into_iter()
            .map(|(id, weeks)| (id, Arc::new(weeks)))
            .collect())
    }
}

/// The weeks, each as the instant it starts, in which the map `family_id` was the staff pick, up to
/// and including the current week, newest first.
pub(crate) async fn family_featured_weeks(
    ctx: &Context<'_>,
    family_id: Uuid,
) -> Result<Vec<DateTime<Utc>>> {
    Ok(ctx
        .data::<DataLoader<MapFeaturedWeeksLoader>>()?
        .load_one(family_id)
        .await?
        .map(|weeks| weeks.iter().copied().map(week_start).collect())
        .unwrap_or_default())
}

pub type MapFeatureConnection =
    Connection<OpaqueCursor<usize>, MapFeature, EmptyFields, EmptyFields>;

#[derive(Default)]
pub struct MapFeaturesQuery;

#[Object]
impl MapFeaturesQuery {
    /// The map or collection leading the Discover page this week: the week's staff pick if it is
    /// shown (see `MapFeature.shown`) and fits `lens` (a map of the lens's kind, or any
    /// collection), otherwise the automatic pick: the listed map fitting `lens` with the highest
    /// trending score, at least 200, that wasn't a staff pick in any of the last 8 weeks (this one
    /// included), the most played in the last 28 days first on a tie. Null when nothing qualifies.
    async fn map_feature(
        &self,
        ctx: &Context<'_>,
        #[graphql(default)] lens: MapLens,
    ) -> Result<Option<MapFeature>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let this_week = week_of(Utc::now());
        if let Some(feature) = features::load_week(db, this_week).await?
            && feature.shown()
            && feature.fits(lens)
        {
            return Ok(Some(MapFeature::stored(feature)));
        }
        Ok(features::automatic_pick(db, this_week, lens)
            .await?
            .map(|(family_id, map_id)| MapFeature::new_automatic(this_week, family_id, map_id)))
    }

    /// Every staff pick, whether or not it's shown, the latest week first: the weeks to come, then
    /// this one, then the past. Pages are 30 picks unless `first` says otherwise (at most 100).
    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_features(
        &self,
        ctx: &Context<'_>,
        after: Option<String>,
        first: Option<i32>,
    ) -> Result<MapFeatureConnection> {
        let offset = match after {
            Some(after) => {
                OpaqueCursor::<usize>::decode_cursor(&after)
                    .map_err(|_| graphql_error("BAD_REQUEST", "invalid cursor"))?
                    .0
                    + 1
            }
            None => 0,
        };
        let count = first.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE) as usize;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let rows = features::load_page(db, offset, count + 1).await?;
        let mut connection = Connection::new(offset > 0, rows.len() > count);
        connection.edges.extend(
            rows.into_iter()
                .take(count)
                .enumerate()
                .map(|(i, row)| Edge::new(OpaqueCursor(offset + i), MapFeature::stored(row))),
        );
        Ok(connection)
    }
}

#[derive(Default)]
pub struct MapFeaturesMutation;

#[Object]
impl MapFeaturesMutation {
    /// Makes a map (the map the file `mapId` is in) or a collection the staff pick of a week,
    /// replacing the week's pick if it has one. Give exactly one of `mapId` and `collectionId`
    /// (`BAD_REQUEST`). The map must be listed (`NOT_LISTED`), and the collection one everyone can
    /// see (`NOT_PUBLIC`). `week` is the instant the week starts, a Monday at 00:00 UTC
    /// (`INVALID_WEEK`), from this week (`WEEK_PASSED`) up to 26 weeks ahead (`WEEK_TOO_FAR`).
    /// `blurb` is trimmed, and must be one line of at most 400 characters (`INVALID_BLURB`).
    /// Picking another map or collection for a week makes a new pick whose maker hasn't been told;
    /// picking the same one again only changes the blurb. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_feature_set(
        &self,
        ctx: &Context<'_>,
        week: DateTime<Utc>,
        map_id: Option<SbMapId>,
        collection_id: Option<Uuid>,
        blurb: Option<String>,
    ) -> Result<MapFeature> {
        let user = require_current_user(ctx)?;
        let target = match (map_id, collection_id) {
            (Some(map_id), None) => FeatureTarget::Map(map_id),
            (None, Some(collection_id)) => FeatureTarget::Collection(collection_id),
            _ => return Err(feature_error(FeatureError::TargetRequired)),
        };
        let week = parse_week(week).map_err(feature_error)?;
        check_schedulable(week, week_of(Utc::now())).map_err(feature_error)?;
        let blurb = clean_blurb(blurb.as_deref()).map_err(feature_error)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let target = match target {
            FeatureTarget::Map(id) => FeatureTarget::Map(
                resolve_map_id(db, id)
                    .await?
                    .ok_or_else(|| feature_error(FeatureError::MapNotFound))?,
            ),
            target => target,
        };
        let viewer = current_viewer(ctx).await?;
        let feature = features::set(db, week, target, &blurb, user.id, viewer)
            .await
            .map_err(feature_error)?;
        if week == week_of(Utc::now()) {
            publish_feature_message(
                ctx,
                PublishedMapFeatureMessage::PickChanged {
                    week: week_start(week),
                },
            )
            .await;
        }
        Ok(MapFeature::stored(feature))
    }

    /// Removes the staff pick of a week, past or to come. `week` is the instant the week starts, a
    /// Monday at 00:00 UTC (`INVALID_WEEK`). Returns whether the week had a pick. Only available to
    /// users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_feature_remove(&self, ctx: &Context<'_>, week: DateTime<Utc>) -> Result<bool> {
        let week = parse_week(week).map_err(feature_error)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(features::remove(db, week).await?)
    }
}
