use async_graphql::{ComplexObject, Context, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::Context as _;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{file_store::FileStore, matchmaking::MatchmakingType};

#[derive(Default)]
pub struct LeaguesQuery;

#[Object]
impl LeaguesQuery {
    async fn active_leagues(&self, ctx: &Context<'_>) -> Result<Vec<League>> {
        let db = ctx.data::<PgPool>()?;
        Ok(sqlx::query_as!(
            League,
            r#"
                SELECT id, name, matchmaking_type as "matchmaking_type: _", description,
                    signups_after, start_at, end_at, badge_path, image_path, rules_and_info,
                    link
                FROM leagues
                WHERE start_at <= NOW() AND end_at > NOW()
                ORDER BY start_at DESC
            "#,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch active leagues")?)
    }

    async fn future_leagues(&self, ctx: &Context<'_>) -> Result<Vec<League>> {
        let db = ctx.data::<PgPool>()?;
        Ok(sqlx::query_as!(
            League,
            r#"
                SELECT id, name, matchmaking_type as "matchmaking_type: _", description,
                    signups_after, start_at, end_at, badge_path, image_path, rules_and_info,
                    link
                FROM leagues
                WHERE end_at > NOW() AND start_at > NOW() and signups_after <= NOW()
                ORDER BY start_at DESC
            "#,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch future leagues")?)
    }

    async fn past_leagues(&self, ctx: &Context<'_>) -> Result<Vec<League>> {
        let db = ctx.data::<PgPool>()?;
        Ok(sqlx::query_as!(
            League,
            r#"
                SELECT id, name, matchmaking_type as "matchmaking_type: _", description,
                    signups_after, start_at, end_at, badge_path, image_path, rules_and_info,
                    link
                FROM leagues
                WHERE end_at <= NOW()
                ORDER BY end_at DESC
            "#,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch past leagues")?)
    }
}

#[derive(SimpleObject, Debug, Clone, sqlx::FromRow)]
#[graphql(complex)]
pub struct League {
    pub id: Uuid,
    pub name: String,
    pub matchmaking_type: MatchmakingType,
    pub description: String,
    pub signups_after: DateTime<Utc>,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    #[graphql(skip)]
    pub badge_path: Option<String>,
    #[graphql(skip)]
    pub image_path: Option<String>,
    pub rules_and_info: Option<String>,
    pub link: Option<String>,
}

#[ComplexObject]
impl League {
    async fn image_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<String>> {
        let Some(image_path) = &self.image_path else {
            return Ok(None);
        };
        let file_store = ctx.data::<FileStore>()?;
        Ok(Some((file_store.url(image_path)?).to_string()))
    }

    async fn badge_url(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<String>> {
        let Some(badge_path) = &self.badge_path else {
            return Ok(None);
        };
        let file_store = ctx.data::<FileStore>()?;
        Ok(Some((file_store.url(badge_path)?).to_string()))
    }
}
