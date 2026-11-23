//! The GraphQL API of map tags: the tag list with how many maps have each tag, managing the list,
//! a map's tags and what the viewer may do with them, and setting a map's tags.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{Context, InputObject, Object, Result, SimpleObject};
use color_eyre::eyre::WrapErr;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{MapKind, is_staff, require_current_user, resolve_existing_map_id};
use crate::maps::families::graphql::{MapFamily, MapFamilyRow, load_family};
use crate::maps::families::tag_list::{self, TagListError, TagRecord};
use crate::maps::families::tags::{
    self, EditorState, STAFF_EDITOR, TagError, TagSource, editor_source, locked_tag_ids,
};
use crate::maps::search::MapSearchRepo;
use crate::users::permissions::RequiredPermission;
use crate::users::{CurrentUser, SbUserId};

pub(crate) fn tag_error(error: TagError) -> async_graphql::Error {
    match error.code() {
        Some(code) => graphql_error(code, error.to_string()),
        None => async_graphql::Error::new(format!("{error:?}")),
    }
}

fn tag_list_error(error: TagListError) -> async_graphql::Error {
    match error.code() {
        Some(code) => graphql_error(code, error.to_string()),
        None => async_graphql::Error::new(format!("{error:?}")),
    }
}

/// A word from the list of map tags.
pub struct MapTag(TagRecord);

/// A word from a list staff manage describing what kind of map a map is (e.g. "Defense").
#[Object]
impl MapTag {
    /// Fixed when the tag is created, from its English name at the time: renaming the tag keeps it.
    async fn id(&self) -> &str {
        &self.0.id
    }

    /// The kind of map the tag is for. A tag only counts on a map whose current file is of this
    /// kind.
    async fn kind(&self) -> MapKind {
        MapKind::from_db(&self.0.kind)
    }

    /// The tag's English name.
    async fn name(&self) -> &str {
        &self.0.name
    }

    /// The tag's names in other languages, in locale code order. A language without one shows the
    /// English name.
    async fn names(&self) -> Vec<MapTagName> {
        self.0
            .names
            .iter()
            .map(|(locale, name)| MapTagName {
                locale: locale.clone(),
                name: name.clone(),
            })
            .collect()
    }

    /// How many listed maps have the tag.
    async fn map_count(&self, ctx: &Context<'_>) -> Result<i32> {
        Ok(ctx
            .data::<DataLoader<MapTagCountLoader>>()?
            .load_one(self.0.id.clone())
            .await?
            .unwrap_or(0))
    }

    /// How many maps hold the tag at all, listed or not and whatever the kind of their current
    /// file: the maps deleting the tag would take it off.
    async fn usage_count(&self, ctx: &Context<'_>) -> Result<i32> {
        Ok(ctx
            .data::<DataLoader<MapTagUsageLoader>>()?
            .load_one(self.0.id.clone())
            .await?
            .unwrap_or(0))
    }
}

/// A map tag's name in a language other than English.
#[derive(SimpleObject)]
pub struct MapTagName {
    /// The language's locale code (e.g. `zh-Hans`).
    locale: String,
    name: String,
}

/// A map tag's name in a language other than English.
#[derive(InputObject)]
pub struct MapTagNameInput {
    /// The language's locale code (e.g. `zh-Hans`): 2 or 3 letters, then any number of `-` and 2 to
    /// 8 letters or digits. Not `en`, which is the tag's own name.
    locale: String,
    /// Trimmed; left empty, the language shows the English name.
    name: String,
}

fn name_pairs(names: Vec<MapTagNameInput>) -> Vec<(String, String)> {
    names.into_iter().map(|n| (n.locale, n.name)).collect()
}

/// Loads how many listed maps have each tag, by tag id. A tag only counts on maps whose current
/// file is of its kind.
pub struct MapTagCountLoader {
    db: PgPool,
}

impl MapTagCountLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<String> for MapTagCountLoader {
    type Value = i32;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, i32>> {
        let rows = sqlx::query!(
            r#"
                SELECT t.tag_id, count(*) as "count!"
                FROM map_family_tags t
                INNER JOIN map_tags mt ON mt.id = t.tag_id
                INNER JOIN map_families f ON f.id = t.family_id AND f.listed
                INNER JOIN maps cur ON cur.id = f.current_map_id AND cur.kind = mt.kind
                WHERE t.tag_id = ANY($1)
                GROUP BY t.tag_id
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to count maps by tag")?;
        Ok(rows
            .into_iter()
            .map(|row| (row.tag_id, i32::try_from(row.count).unwrap_or(i32::MAX)))
            .collect())
    }
}

/// Loads how many maps hold each tag at all (listed or not, whatever their current file's kind),
/// by tag id.
pub struct MapTagUsageLoader {
    db: PgPool,
}

impl MapTagUsageLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<String> for MapTagUsageLoader {
    type Value = i32;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, i32>> {
        let rows = sqlx::query!(
            r#"
                SELECT tag_id, count(*) as "count!"
                FROM map_family_tags
                WHERE tag_id = ANY($1)
                GROUP BY tag_id
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to count map tag uses")?;
        Ok(rows
            .into_iter()
            .map(|row| (row.tag_id, i32::try_from(row.count).unwrap_or(i32::MAX)))
            .collect())
    }
}

/// One tag of a map, as [`MapFamilyTagsLoader`] lists it.
#[derive(Debug, Clone)]
pub struct FamilyTag {
    tag: TagRecord,
    source: TagSource,
}

/// Loads the tags of families that apply (those of their current file's kind), in list order, by
/// family id.
pub struct MapFamilyTagsLoader {
    db: PgPool,
}

impl MapFamilyTagsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for MapFamilyTagsLoader {
    type Value = Arc<Vec<FamilyTag>>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Arc<Vec<FamilyTag>>>> {
        let rows = sqlx::query!(
            r#"
                SELECT t.family_id, t.tag_id, mt.kind, mt.name,
                    mt.names as "names: Json<BTreeMap<String, String>>", t.source
                FROM map_family_tags t
                INNER JOIN map_tags mt ON mt.id = t.tag_id
                INNER JOIN map_families f ON f.id = t.family_id
                INNER JOIN maps cur ON cur.id = f.current_map_id AND cur.kind = mt.kind
                WHERE t.family_id = ANY($1)
                ORDER BY t.family_id, mt.position
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load family tags")?;
        let mut tags: HashMap<Uuid, Vec<FamilyTag>> = HashMap::new();
        for row in rows {
            tags.entry(row.family_id).or_default().push(FamilyTag {
                tag: TagRecord {
                    id: row.tag_id,
                    kind: row.kind,
                    name: row.name,
                    names: row.names.0,
                },
                source: TagSource::from_db(&row.source)?,
            });
        }
        Ok(tags
            .into_iter()
            .map(|(id, tags)| (id, Arc::new(tags)))
            .collect())
    }
}

/// Loads what decides whether users who aren't staff may edit tags as players, by user id.
pub struct TagEditorLoader {
    db: PgPool,
}

impl TagEditorLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbUserId> for TagEditorLoader {
    type Value = EditorState;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, EditorState>> {
        Ok(tags::load_editors(&self.db, keys)
            .await?
            .into_iter()
            .collect())
    }
}

async fn load_family_tags(ctx: &Context<'_>, family_id: Uuid) -> Result<Arc<Vec<FamilyTag>>> {
    Ok(ctx
        .data::<DataLoader<MapFamilyTagsLoader>>()?
        .load_one(family_id)
        .await?
        .unwrap_or_default())
}

/// The map's tags that apply, in list order.
pub(crate) async fn family_tags(ctx: &Context<'_>, family_id: Uuid) -> Result<Vec<MapTag>> {
    Ok(load_family_tags(ctx, family_id)
        .await?
        .iter()
        .map(|tag| MapTag(tag.tag.clone()))
        .collect())
}

/// The source the viewer would edit `family`'s tags as, or `None` when they can't edit them
/// (including when logged out). The hourly limit on players' edits isn't considered.
async fn viewer_tag_source(ctx: &Context<'_>, family: &MapFamilyRow) -> Result<Option<TagSource>> {
    let Some(viewer) = ctx.data::<Option<CurrentUser>>()? else {
        return Ok(None);
    };
    let staff = is_staff(ctx).await;
    let editor = if staff {
        STAFF_EDITOR
    } else {
        let Some(editor) = ctx
            .data::<DataLoader<TagEditorLoader>>()?
            .load_one(viewer.id)
            .await?
        else {
            return Ok(None);
        };
        editor
    };
    Ok(editor_source(
        staff,
        family.owner_id,
        family.listed,
        viewer.id,
        &editor,
        false,
    )
    .ok())
}

/// Whether the viewer may edit `family`'s tags.
pub(crate) async fn can_edit_tags(ctx: &Context<'_>, family: &MapFamilyRow) -> Result<bool> {
    Ok(viewer_tag_source(ctx, family).await?.is_some())
}

/// The ids of `family`'s tags the viewer can't remove, in list order. Empty when they can't edit its
/// tags at all.
pub(crate) async fn viewer_locked_tag_ids(
    ctx: &Context<'_>,
    family: &MapFamilyRow,
) -> Result<Vec<String>> {
    let Some(source) = viewer_tag_source(ctx, family).await? else {
        return Ok(Vec::new());
    };
    let tags = load_family_tags(ctx, family.id).await?;
    Ok(locked_tag_ids(
        tags.iter().map(|t| (t.tag.id.as_str(), t.source)),
        source,
    ))
}

#[derive(Default)]
pub struct MapTagsQuery;

#[Object]
impl MapTagsQuery {
    /// Every map tag, in list order: melee tags first, then UMS tags.
    async fn map_tags(&self, ctx: &Context<'_>) -> Result<Vec<MapTag>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(tag_list::load_tag_list(db)
            .await?
            .into_iter()
            .map(MapTag)
            .collect())
    }
}

#[derive(Default)]
pub struct MapTagsMutation;

#[Object]
impl MapTagsMutation {
    /// Sets the tags of the map a file is in: `tags` is every tag the map should have, at most 3,
    /// each of the kind of the map's current file. Tags of the other kind are removed. Users who
    /// can manage maps can set any map's tags; the map's maker (while not restricted from
    /// publishing) can set theirs; anyone else can set the tags of a listed map with no maker if
    /// they've verified their email and aren't restricted from publishing, up to 30 times an hour.
    /// A tag set by someone who outranks the current user (staff over the maker over players)
    /// can't be removed (`TAG_LOCKED`). Setting the tags the map already has changes nothing.
    async fn map_family_set_tags(
        &self,
        ctx: &Context<'_>,
        map_id: SbMapId,
        tags: Vec<String>,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, map_id).await?;
        let staff = is_staff(ctx).await;
        let family_id = tags::set_tags(db, file_id, &tags, user.id, staff)
            .await
            .map_err(tag_error)?;
        load_family(ctx, family_id).await
    }

    /// Adds a tag of `kind` at the end of that kind's tags, with the English name `name` and the
    /// names in other languages `names`. Names are trimmed, and must be 1 to 24 characters without
    /// control characters (`BAD_REQUEST`); a name in another language left empty is dropped. No
    /// other tag of the kind may have the same English name, ignoring case (`NAME_TAKEN`). A locale
    /// code that doesn't look like one, `en`, a locale given twice or more than 20 of them is
    /// `BAD_REQUEST`. The tag's id is made from its English name: lowercase, every run of
    /// characters other than `a`-`z` and `0`-`9` turned into one `-`, without `-` at either end, at
    /// most 32 characters, and `-2`, `-3`, ... added when another tag of either kind has it. A name
    /// without any of those characters is `BAD_REQUEST`. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_tag_create(
        &self,
        ctx: &Context<'_>,
        name: String,
        kind: MapKind,
        names: Option<Vec<MapTagNameInput>>,
    ) -> Result<MapTag> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let tag = tag_list::create(
            db,
            &name,
            kind.as_str(),
            name_pairs(names.unwrap_or_default()),
        )
        .await
        .map_err(tag_list_error)?;
        Ok(MapTag(tag))
    }

    /// Changes a tag (`NOT_FOUND` if there's none with the id): `name`, when given, becomes its
    /// English name, and `names`, when given, replaces all its names in other languages, by the
    /// rules of `mapTagCreate`. Its id and kind never change. Only available to users who can
    /// manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_tag_update(
        &self,
        ctx: &Context<'_>,
        id: String,
        name: Option<String>,
        names: Option<Vec<MapTagNameInput>>,
    ) -> Result<MapTag> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let tag = tag_list::update(db, &id, name.as_deref(), names.map(name_pairs))
            .await
            .map_err(tag_list_error)?;
        Ok(MapTag(tag))
    }

    /// Puts the tags of `kind` in the order of `ids`, which must list every tag of that kind
    /// exactly once (`BAD_REQUEST`). The other kind's order is kept. Returns every tag, in list
    /// order. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_tags_set_order(
        &self,
        ctx: &Context<'_>,
        kind: MapKind,
        ids: Vec<String>,
    ) -> Result<Vec<MapTag>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(tag_list::set_order(db, kind.as_str(), &ids)
            .await
            .map_err(tag_list_error)?
            .into_iter()
            .map(MapTag)
            .collect())
    }

    /// Deletes a tag (`NOT_FOUND` if there's none with the id), taking it off every map. Returns
    /// the deleted tag's id. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_tag_delete(&self, ctx: &Context<'_>, id: String) -> Result<String> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        tag_list::delete(db, &id).await.map_err(tag_list_error)?;
        Ok(id)
    }
}
