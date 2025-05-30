use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use async_graphql::connection::{Connection, Edge, query};
use async_graphql::dataloader::DataLoader;
use async_graphql::{ComplexObject, Context, Guard, InputObject, Object, SchemaBuilder};
use async_graphql::{Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use mobc_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use typeshare::typeshare;
use uuid::Uuid;

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
        if let Some(author_id) = post.author_id {
            if author_id != user.id {
                return Err(graphql_error(
                    "BAD_REQUEST",
                    "author_id must be the same as the current user if present",
                ));
            }
        }

        let repo = ctx.data::<NewsPostRepo>()?;
        repo.create_post(post, user.id).await.map_err(|e| e.into())
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
}

#[derive(Clone, InputObject)]
pub struct NewsPostCreation {
    pub author_id: Option<SbUserId>,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub published_at: Option<DateTime<Utc>>,
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

    pub async fn load_many(
        &self,
        include_unpublished: bool,
        after: Option<Uuid>,
        before: Option<Uuid>,
        first: Option<usize>,
        last: Option<usize>,
    ) -> eyre::Result<(bool, bool, Vec<NewsPost>)> {
        let mut query = QueryBuilder::new(
            r#"
                WITH posts AS (
                    SELECT id, author_id, cover_image_path, title, summary, content, published_at,
                        updated_at
                    FROM news_posts
            "#,
        );

        if !include_unpublished || after.is_some() || before.is_some() {
            query.push(" WHERE ");
            let mut query = query.separated(" AND ");

            if !include_unpublished {
                query.push("published_at IS NOT NULL AND published_at <= NOW()");
            }
            // TODO(tec27): There's a problem with querying for posts this way if the post being
            // used as a cursor has no publish date and there are more posts with no publish date
            // than the window size (or if there are more posts with the exact same publish date
            // than the window size, although that's far less likely). Need to figure out some way
            // to reliably sort these posts in that case (updated_at seems usable but I need to
            // figure out the query)
            if let Some(after) = after {
                query.push(
                    "published_at > COALESCE((SELECT published_at FROM news_posts WHERE id = ",
                );
                query.push_bind_unseparated(after);
                query.push_unseparated("), '-infinity'::timestamptz)");
            }
            if let Some(before) = before {
                query.push(
                    "published_at < COALESCE((SELECT published_at FROM news_posts WHERE id = ",
                );
                query.push_bind_unseparated(before);
                query.push_unseparated("), 'infinity'::timestamptz)");
            }
        }

        // NOTE(tec27): We select 1 extra item to be able to tell if there are more items available
        let mut count = usize::MAX;
        let mut inverted = false;
        if let Some(first) = first {
            query.push(" ORDER BY published_at DESC LIMIT ");
            query.push_bind((first + 1) as i64);
            count = first;
        } else if let Some(last) = last {
            query.push(" ORDER BY published_at ASC LIMIT ");
            query.push_bind((last + 1) as i64);
            count = last;
            inverted = true;
        }

        query.push(
            r#"
                )
                SELECT * FROM posts ORDER BY published_at DESC
            "#,
        );

        let mut results = query
            .build_query_as()
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load news posts from DB")?;

        let has_next_page = if results.len() > count {
            results.pop();
            true
        } else {
            false
        };
        let has_prev_page = (after.is_some() && inverted) || (before.is_some() && !inverted);

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
                INSERT INTO news_posts (author_id, title, summary, content,
                    published_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, author_id as "author_id: _", cover_image_path, title, summary,
                    content, published_at, updated_at
            "#,
            post.author_id as _,
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
}
