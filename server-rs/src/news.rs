use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use async_graphql::connection::{Connection, Edge, query};
use async_graphql::dataloader::DataLoader;
use async_graphql::{
    ComplexObject, Context, Guard, InputObject, MaybeUndefined, Object, SchemaBuilder,
};
use async_graphql::{Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use deadpool_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use typeshare::typeshare;
use uuid::Uuid;

use crate::file_store::FileStore;
use crate::users::permissions::RequiredPermission;
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader};

pub struct NewsModule {
    db_pool: PgPool,
}

impl NewsModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for NewsModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder.data(NewsPostRepo::new(self.db_pool.clone()))
    }
}

#[derive(Default)]
pub struct NewsQuery;

#[Object]
impl NewsQuery {
    async fn news_posts(
        &self,
        ctx: &Context<'_>,
        include_unpublished: Option<bool>,
        after: Option<String>,
        before: Option<String>,
        first: Option<i32>,
        last: Option<i32>,
    ) -> Result<Connection<Uuid, NewsPost>> {
        // Only users with the ManageNews permission can view unpublished posts
        if let Some(true) = include_unpublished {
            RequiredPermission::ManageNews.check(ctx).await?;
        }

        let repo = ctx.data::<NewsPostRepo>()?;

        query(
            after,
            before,
            first,
            last,
            |after, before, first, last| async move {
                let first = if first.is_none() && last.is_none() {
                    Some(10)
                } else {
                    first
                };
                let first = first.map(|f| f.clamp(1, 100));
                let last = last.map(|l| l.clamp(1, 100));

                repo.load_many(
                    include_unpublished.unwrap_or(false),
                    after,
                    before,
                    first,
                    last,
                )
                .await
                .map(|(has_prev_page, has_next_page, posts)| {
                    let mut connection = Connection::new(has_prev_page, has_next_page);
                    connection
                        .edges
                        .extend(posts.into_iter().map(|post| Edge::new(post.id, post)));
                    connection
                })
            },
        )
        .await
    }

    /// Retrieves a single news post by ID. Published posts are visible to everyone; unpublished or
    /// scheduled posts are only returned to users with the ManageNews permission (for draft preview).
    async fn news_post(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<NewsPost>> {
        let repo = ctx.data::<NewsPostRepo>()?;
        let Some(post) = repo.load_one(id).await? else {
            return Ok(None);
        };

        let is_published = post.published_at.is_some_and(|p| p <= Utc::now());
        if is_published || RequiredPermission::ManageNews.check(ctx).await.is_ok() {
            Ok(Some(post))
        } else {
            Ok(None)
        }
    }

    async fn urgent_message(&self, ctx: &Context<'_>) -> Result<Option<UrgentMessage>> {
        let redis = ctx.data::<RedisPool>()?;
        let mut redis = redis.get().await.wrap_err("Could not connect to Redis")?;

        let message: Option<String> = redis
            .get("news:urgentMessage")
            .await
            .wrap_err("Failed to get urgent message")?;

        if let Some(message) = message {
            Ok(serde_json::from_str(&message).wrap_err("Failed to deserialize urgent message")?)
        } else {
            Ok(None)
        }
    }
}

#[derive(Default)]
pub struct NewsMutation;

#[Object]
impl NewsMutation {
    // TODO(tec27): Allow a cover image upload with this
    #[graphql(guard = RequiredPermission::ManageNews)]
    async fn news_create_post(
        &self,
        ctx: &Context<'_>,
        post: NewsPostCreation,
    ) -> Result<NewsPost> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };
        if let Some(author_id) = post.author_id
            && author_id != user.id
        {
            return Err(graphql_error(
                "BAD_REQUEST",
                "author_id must be the same as the current user if present",
            ));
        }
        if let Some(path) = post.cover_image_path.as_deref() {
            validate_cover_image_path(path)?;
        }

        let repo = ctx.data::<NewsPostRepo>()?;
        let created = repo.create_post(post, user.id).await?;

        ctx.data::<RedisPool>()?
            .publish(PublishedNewsMessage::NewsPostsChanged(()))
            .await?;

        Ok(created)
    }

    #[graphql(guard = RequiredPermission::ManageNews)]
    async fn news_update_post(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        updates: NewsPostUpdates,
    ) -> Result<NewsPost> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };
        if let MaybeUndefined::Value(path) = &updates.cover_image_path {
            validate_cover_image_path(path)?;
        }

        let repo = ctx.data::<NewsPostRepo>()?;
        let updated = repo.update_post(id, updates, user.id).await?;

        ctx.data::<RedisPool>()?
            .publish(PublishedNewsMessage::NewsPostsChanged(()))
            .await?;

        Ok(updated)
    }

    #[graphql(guard = RequiredPermission::ManageNews)]
    async fn news_delete_post(&self, ctx: &Context<'_>, id: Uuid) -> Result<bool> {
        let repo = ctx.data::<NewsPostRepo>()?;
        repo.delete_post(id).await?;

        ctx.data::<RedisPool>()?
            .publish(PublishedNewsMessage::NewsPostsChanged(()))
            .await?;

        Ok(true)
    }

    /// Sets (or clears, if message is not provided) the urgent message at the top of the home page.
    #[graphql(guard = RequiredPermission::ManageNews)]
    async fn news_set_urgent_message(
        &self,
        ctx: &Context<'_>,
        message: Option<UrgentMessageInput>,
    ) -> Result<bool> {
        // Save the urgent message to redis
        let redis = ctx.data::<RedisPool>()?;

        let message = message.map(|msg| UrgentMessage {
            id: Uuid::new_v4(),
            title: msg.title,
            message: msg.message,
            published_at: Utc::now(),
        });

        {
            let mut redis = redis.get().await.wrap_err("Could not connect to Redis")?;

            if let Some(message) = message.clone() {
                let message = serde_json::to_string(&message)
                    .wrap_err("Failed to serialize urgent message")?;
                redis
                    .set::<_, _, ()>("news:urgentMessage", message)
                    .await
                    .wrap_err("Failed to set urgent message")?;
            } else {
                redis
                    .del::<_, ()>("news:urgentMessage")
                    .await
                    .wrap_err("Failed to delete urgent message")?;
            }
        }

        redis
            .publish(PublishedNewsMessage::UrgentMessageChanged(()))
            .await?;

        Ok(true)
    }
}

#[derive(SimpleObject, Clone, Debug, sqlx::FromRow)]
#[graphql(complex)]
pub struct NewsPost {
    pub id: Uuid,
    #[graphql(skip)]
    pub author_id: Option<SbUserId>,
    pub cover_image_path: Option<String>,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub published_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[ComplexObject]
impl NewsPost {
    async fn author(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let Some(author_id) = self.author_id else {
            return Ok(None);
        };
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(author_id)
            .await
    }

    /// A fully-qualified URL to this post's cover image, or null if it has none.
    async fn cover_image_url(&self, ctx: &Context<'_>) -> Result<Option<String>> {
        let Some(path) = self.cover_image_path.as_deref() else {
            return Ok(None);
        };
        Ok(Some(ctx.data::<FileStore>()?.url(path)?))
    }

    /// A fully-qualified URL to the half-resolution variant of this post's cover image, or null if
    /// it has none.
    async fn cover_image_small_url(&self, ctx: &Context<'_>) -> Result<Option<String>> {
        let Some(path) = self.cover_image_path.as_deref() else {
            return Ok(None);
        };
        Ok(Some(
            ctx.data::<FileStore>()?.url(&small_variant_path(path))?,
        ))
    }

    #[graphql(guard = RequiredPermission::ManageNews)]
    async fn edits(&self, ctx: &Context<'_>) -> Result<Vec<NewsPostEdit>> {
        Ok(ctx.data::<NewsPostRepo>()?.load_edits(self.id).await?)
    }
}

/// Inserts the `_0.5x` size suffix before the file extension of a cover image path
/// (e.g. `news-images/ab/cd/xyz.jpg` -> `news-images/ab/cd/xyz_0.5x.jpg`).
fn small_variant_path(path: &str) -> String {
    match path.rfind('.') {
        // Only treat the dot as an extension separator if it lies within the final path segment.
        Some(dot) if !path[dot..].contains('/') => {
            format!("{}_0.5x{}", &path[..dot], &path[dot..])
        }
        _ => format!("{path}_0.5x"),
    }
}

/// Ensures an admin-supplied cover image path points inside the news images directory rather than an
/// arbitrary file-store location.
fn validate_cover_image_path(path: &str) -> Result<()> {
    if path.starts_with("news-images/") {
        Ok(())
    } else {
        Err(graphql_error(
            "BAD_REQUEST",
            "cover_image_path must be within the news-images/ directory",
        ))
    }
}

#[derive(Clone, InputObject)]
pub struct NewsPostCreation {
    pub author_id: Option<SbUserId>,
    pub cover_image_path: Option<String>,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub published_at: Option<DateTime<Utc>>,
}

/// Partial updates for an existing news post. Fields omitted from the input are left unchanged.
/// For `publishedAt` and `coverImagePath`, an explicit null clears the current value (e.g.
/// unpublishing a post), so a single mutation covers editing, publishing now, scheduling, and
/// unpublishing.
#[derive(InputObject)]
pub struct NewsPostUpdates {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub published_at: MaybeUndefined<DateTime<Utc>>,
    pub cover_image_path: MaybeUndefined<String>,
}

#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct NewsPostEdit {
    pub id: Uuid,
    #[graphql(skip)]
    pub editor_id: Option<SbUserId>,
    #[graphql(skip)]
    pub author_id: Option<SbUserId>,
    pub cover_image_path: Option<String>,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub published_at: Option<DateTime<Utc>>,
    pub edited_at: DateTime<Utc>,
}

#[ComplexObject]
impl NewsPostEdit {
    async fn editor(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let Some(editor_id) = self.editor_id else {
            return Ok(None);
        };
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(editor_id)
            .await
    }

    async fn author(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let Some(author_id) = self.author_id else {
            return Ok(None);
        };
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(author_id)
            .await
    }
}

/// Repository implementation for retrieving/creating/updating news posts.
#[derive(Clone)]
pub struct NewsPostRepo {
    db: PgPool,
}

impl NewsPostRepo {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    pub async fn load_one(&self, id: Uuid) -> eyre::Result<Option<NewsPost>> {
        sqlx::query_as!(
            NewsPost,
            r#"
                SELECT id, author_id as "author_id: _", cover_image_path, title, summary, content, published_at,
                    updated_at
                FROM news_posts
                WHERE id = $1
            "#,
            id as _
        )
        .fetch_one(&self.db)
        .await
        .map(Some)
        .or_else(|e| match e {
            sqlx::Error::RowNotFound => Ok(None),
            e => Err(e),
        })
        .wrap_err("Failed to load news post")
    }

    /// Resolves a cursor Uuid into its `published_at` value. Returns `None` if the referenced post
    /// no longer exists, in which case callers treat the cursor as absent.
    async fn resolve_cursor(&self, id: Uuid) -> eyre::Result<Option<ResolvedCursor>> {
        let row = sqlx::query!("SELECT published_at FROM news_posts WHERE id = $1", id)
            .fetch_optional(&self.db)
            .await
            .wrap_err("Failed to resolve news cursor")?;

        Ok(row.map(|r| ResolvedCursor {
            id,
            published_at: r.published_at,
        }))
    }

    pub async fn load_many(
        &self,
        include_unpublished: bool,
        after: Option<Uuid>,
        before: Option<Uuid>,
        first: Option<usize>,
        last: Option<usize>,
    ) -> eyre::Result<(bool, bool, Vec<NewsPost>)> {
        let after_cursor = match after {
            Some(id) => self.resolve_cursor(id).await?,
            None => None,
        };
        let before_cursor = match before {
            Some(id) => self.resolve_cursor(id).await?,
            None => None,
        };

        let mut query = QueryBuilder::new(
            r#"
                WITH posts AS (
                    SELECT id, author_id, cover_image_path, title, summary, content, published_at,
                        updated_at
                    FROM news_posts
            "#,
        );

        if !include_unpublished || after_cursor.is_some() || before_cursor.is_some() {
            query.push(" WHERE ");
            let mut query = query.separated(" AND ");

            if !include_unpublished {
                query.push("published_at IS NOT NULL AND published_at <= NOW()");
            }
            // The (COALESCE(published_at, 'infinity'), id) row-values compare with the same ordering
            // as `ORDER BY published_at DESC, id DESC` (Postgres sorts NULLs first for DESC, i.e. as
            // +infinity), so `after` returns strictly older posts and `before` strictly newer ones.
            if let Some(cursor) = &after_cursor {
                query.push("(COALESCE(published_at, 'infinity'::timestamptz), id) < (");
                match cursor.published_at {
                    Some(ts) => query.push_bind_unseparated(ts),
                    None => query.push_unseparated("'infinity'::timestamptz"),
                };
                query.push_unseparated(", ");
                query.push_bind_unseparated(cursor.id);
                query.push_unseparated(")");
            }
            if let Some(cursor) = &before_cursor {
                query.push("(COALESCE(published_at, 'infinity'::timestamptz), id) > (");
                match cursor.published_at {
                    Some(ts) => query.push_bind_unseparated(ts),
                    None => query.push_unseparated("'infinity'::timestamptz"),
                };
                query.push_unseparated(", ");
                query.push_bind_unseparated(cursor.id);
                query.push_unseparated(")");
            }
        }

        // NOTE(tec27): We select 1 extra item to be able to tell if there are more items available
        let mut count = usize::MAX;
        let mut is_last = false;
        if let Some(first) = first {
            query.push(" ORDER BY published_at DESC, id DESC LIMIT ");
            query.push_bind((first + 1) as i64);
            count = first;
        } else if let Some(last) = last {
            query.push(" ORDER BY published_at ASC, id ASC LIMIT ");
            query.push_bind((last + 1) as i64);
            count = last;
            is_last = true;
        }

        query.push(
            r#"
                )
                SELECT * FROM posts ORDER BY published_at DESC, id DESC
            "#,
        );

        let mut results: Vec<NewsPost> = query
            .build_query_as()
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load news posts from DB")?;

        // With the outer re-order to newest-first, the extra probe row is the oldest fetched row
        // (the last element) when paging forward, but the newest fetched row (the first element)
        // when paging backward with `last`.
        let (has_prev_page, has_next_page) = if is_last {
            let has_prev = results.len() > count;
            if has_prev {
                results.remove(0);
            }
            (has_prev, before_cursor.is_some())
        } else {
            let has_next = results.len() > count;
            if has_next {
                results.pop();
            }
            (after_cursor.is_some(), has_next)
        };

        Ok((has_prev_page, has_next_page, results))
    }

    async fn create_post(
        &self,
        post: NewsPostCreation,
        creator_id: SbUserId,
    ) -> eyre::Result<NewsPost> {
        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;

        let post = sqlx::query_as!(
            NewsPost,
            r#"
                INSERT INTO news_posts (author_id, cover_image_path, title, summary, content,
                    published_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, author_id as "author_id: _", cover_image_path, title, summary,
                    content, published_at, updated_at
            "#,
            post.author_id as _,
            post.cover_image_path,
            post.title,
            post.summary,
            post.content,
            post.published_at,
            Utc::now(),
        )
        .fetch_one(&mut *tx)
        .await
        .wrap_err("Failed to create news post in DB")?;

        sqlx::query!(
            r#"
                INSERT INTO news_post_edits
                    (post_id, editor_id, author_id, cover_image_path, title, summary, content,
                        published_at, edited_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            post.id,
            creator_id as _,
            post.author_id as _,
            post.cover_image_path,
            post.title,
            post.summary,
            post.content,
            post.published_at,
            post.updated_at,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to update edit log in DB")?;

        tx.commit().await.wrap_err("Failed to commit transaction")?;

        Ok(post)
    }

    async fn update_post(
        &self,
        id: Uuid,
        updates: NewsPostUpdates,
        editor_id: SbUserId,
    ) -> Result<NewsPost> {
        // The MaybeUndefined fields become a "should set" flag plus a nullable value: undefined
        // leaves the column unchanged, null clears it, and a value sets it.
        let (set_published_at, published_at) = match updates.published_at {
            MaybeUndefined::Undefined => (false, None),
            MaybeUndefined::Null => (true, None),
            MaybeUndefined::Value(v) => (true, Some(v)),
        };
        let (set_cover_image, cover_image_path) = match updates.cover_image_path {
            MaybeUndefined::Undefined => (false, None),
            MaybeUndefined::Null => (true, None),
            MaybeUndefined::Value(v) => (true, Some(v)),
        };

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;

        let post = sqlx::query_as!(
            NewsPost,
            r#"
                UPDATE news_posts
                SET
                    title = COALESCE($2, title),
                    summary = COALESCE($3, summary),
                    content = COALESCE($4, content),
                    published_at = CASE WHEN $5 THEN $6 ELSE published_at END,
                    cover_image_path = CASE WHEN $7 THEN $8 ELSE cover_image_path END,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id, author_id as "author_id: _", cover_image_path, title, summary,
                    content, published_at, updated_at
            "#,
            id,
            updates.title,
            updates.summary,
            updates.content,
            set_published_at,
            published_at,
            set_cover_image,
            cover_image_path,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::RowNotFound => graphql_error("NOT_FOUND", "News post not found"),
            e => graphql_error(
                "INTERNAL_SERVER_ERROR",
                format!("Failed to update news post in DB: {e}"),
            ),
        })?;

        sqlx::query!(
            r#"
                INSERT INTO news_post_edits
                    (post_id, editor_id, author_id, cover_image_path, title, summary, content,
                        published_at, edited_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            post.id,
            editor_id as _,
            post.author_id as _,
            post.cover_image_path,
            post.title,
            post.summary,
            post.content,
            post.published_at,
            post.updated_at,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to update edit log in DB")?;

        tx.commit().await.wrap_err("Failed to commit transaction")?;

        Ok(post)
    }

    async fn delete_post(&self, id: Uuid) -> Result<()> {
        let result = sqlx::query!("DELETE FROM news_posts WHERE id = $1", id)
            .execute(&self.db)
            .await
            .wrap_err("Failed to delete news post")?;

        if result.rows_affected() == 0 {
            return Err(graphql_error("NOT_FOUND", "News post not found"));
        }

        Ok(())
    }

    async fn load_edits(&self, post_id: Uuid) -> eyre::Result<Vec<NewsPostEdit>> {
        sqlx::query_as!(
            NewsPostEdit,
            r#"
                SELECT id, editor_id as "editor_id: _", author_id as "author_id: _",
                    cover_image_path, title, summary, content, published_at, edited_at
                FROM news_post_edits
                WHERE post_id = $1
                ORDER BY edited_at DESC
            "#,
            post_id
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load news post edits")
    }
}

/// A resolved pagination cursor: the referenced post's id plus its (nullable) publish time.
struct ResolvedCursor {
    id: Uuid,
    published_at: Option<DateTime<Utc>>,
}

#[typeshare]
#[derive(SimpleObject, Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrgentMessage {
    pub id: Uuid,
    pub title: String,
    pub message: String,
    /// The time the message was published (in UTC). This will serialize as an RFC 3339 string.
    pub published_at: DateTime<Utc>,
}

#[derive(InputObject, Clone, Debug)]
pub struct UrgentMessageInput {
    pub title: String,
    pub message: String,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedNewsMessage {
    UrgentMessageChanged(()),
    NewsPostsChanged(()),
}
