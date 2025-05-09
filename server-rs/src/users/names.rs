use std::sync::Arc;

use async_graphql::dataloader::DataLoader;
use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context};
use regex::Regex;
use reqwest::StatusCode;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::RwLock;
use tracing::error;
use typeshare::typeshare;

use crate::{async_rayon::spawn_rayon, state::AppState};

use super::{user_id::SbUserId, SbUser, UsersLoader};

pub fn create_names_api() -> Router<AppState> {
    Router::new().route("/check-allowed/{name}", post(check_allowed))
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Serialize, sqlx::Type, async_graphql::Enum)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "restricted_name_reason", rename_all = "snake_case")]
#[typeshare]
pub enum RestrictedNameReason {
    Profanity,
    Reserved,
}

#[derive(Debug, Copy, Clone, Serialize)]
#[serde(rename = "CheckAllowedNameResponse", rename_all = "camelCase")]
#[typeshare]
pub struct CheckAllowedResponse {
    pub allowed: bool,
    pub reason: Option<RestrictedNameReason>,
}

async fn check_allowed(
    Path(name): Path<String>,
    State(name_checker): State<NameChecker>,
) -> Result<Json<CheckAllowedResponse>, (StatusCode, &'static str)> {
    let result = if let Some(restriction) = name_checker.check_name(&name).await.map_err(|e| {
        error!("Failed to check name: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
    })? {
        Json(CheckAllowedResponse {
            allowed: false,
            reason: Some(restriction.reason),
        })
    } else {
        Json(CheckAllowedResponse {
            allowed: true,
            reason: None,
        })
    };

    Ok(result)
}
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Serialize, sqlx::Type, async_graphql::Enum)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "restricted_name_kind", rename_all = "snake_case")]
pub enum RestrictedNameKind {
    Exact,
    Regex,
}

#[derive(Debug, Clone, sqlx::FromRow, async_graphql::SimpleObject)]
#[graphql(complex)]
pub struct NameRestriction {
    pub id: i32,
    pub pattern: String,
    pub kind: RestrictedNameKind,
    pub reason: RestrictedNameReason,
    pub created_at: DateTime<Utc>,
    #[graphql(skip)]
    pub created_by: SbUserId,
}

#[async_graphql::ComplexObject]
impl NameRestriction {
    async fn created_by(
        &self,
        ctx: &async_graphql::Context<'_>,
    ) -> async_graphql::Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.created_by)
            .await
    }
}

pub struct RestrictionsCache {
    exact: Vec<NameRestriction>,
    regex: Vec<(NameRestriction, Regex)>,
}

#[derive(Clone)]
pub struct NameChecker {
    db_pool: PgPool,
    restrictions: Arc<RwLock<Option<Arc<RestrictionsCache>>>>,
}

impl NameChecker {
    pub fn new(db_pool: PgPool) -> Self {
        Self {
            db_pool,
            restrictions: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn check_name(&self, name: &str) -> eyre::Result<Option<NameRestriction>> {
        let restrictions = self.get_restrictions_cache().await?;
        let name = name.to_lowercase();

        spawn_rayon(move || {
            for restriction in &restrictions.exact {
                if restriction.pattern == name {
                    return Ok(Some(restriction.clone()));
                }
            }

            for (restriction, re) in &restrictions.regex {
                if re.is_match(&name) {
                    return Ok(Some(restriction.clone()));
                }
            }

            Ok(None)
        })
        .await
    }

    pub async fn add_restriction(
        &self,
        pattern: String,
        kind: RestrictedNameKind,
        reason: RestrictedNameReason,
        creator: SbUserId,
    ) -> eyre::Result<NameRestriction> {
        let pattern = match kind {
            RestrictedNameKind::Exact => pattern.to_lowercase(),
            RestrictedNameKind::Regex => pattern,
        };

        let db = self.db_pool.clone();
        let restriction = sqlx::query_as!(
            NameRestriction,
            r#"
                INSERT INTO restricted_names (pattern, kind, reason, created_by)
                VALUES ($1, $2, $3, $4)
                RETURNING id, pattern, kind as "kind: _", reason as "reason: _", created_at,
                    created_by
            "#,
            pattern,
            kind as _,
            reason as _,
            creator as _,
        )
        .fetch_one(&db)
        .await
        .wrap_err("failed to add name restriction")?;

        // Add to the cache (copy-on-write)
        let mut restrictions_lock = self.restrictions.write().await;
        if let Some(restrictions) = &*restrictions_lock {
            let mut restrictions_cache = RestrictionsCache {
                exact: restrictions.exact.clone(),
                regex: restrictions.regex.clone(),
            };

            match restriction.kind {
                RestrictedNameKind::Exact => {
                    restrictions_cache.exact.push(restriction.clone());
                }
                RestrictedNameKind::Regex => {
                    if let Ok(re) = create_case_insensitive_regex(&restriction.pattern) {
                        restrictions_cache.regex.push((restriction.clone(), re));
                    } else {
                        error!(
                            "Invalid regex pattern [{}]: {}",
                            restriction.id, restriction.pattern
                        );
                    }
                }
            }

            *restrictions_lock = Some(Arc::new(restrictions_cache));
        }

        Ok(restriction)
    }

    pub async fn delete_restriction(&self, id: i32) -> eyre::Result<u64> {
        let db = self.db_pool.clone();
        let r = sqlx::query!(
            r#"
                DELETE FROM restricted_names
                WHERE id = $1
            "#,
            id
        )
        .execute(&db)
        .await
        .wrap_err("failed to delete name restriction")?;

        // Remove from the cache (copy-on-write)
        let mut restrictions_lock = self.restrictions.write().await;
        if let Some(restrictions) = &*restrictions_lock {
            let mut restrictions_cache = RestrictionsCache {
                exact: restrictions.exact.clone(),
                regex: restrictions.regex.clone(),
            };

            restrictions_cache
                .exact
                .retain(|restriction| restriction.id != id);
            restrictions_cache
                .regex
                .retain(|(restriction, _)| restriction.id != id);

            *restrictions_lock = Some(Arc::new(restrictions_cache));
        }

        Ok(r.rows_affected())
    }

    /// Retrieves all the name restrictions from the database. This is a potentially expensive
    /// operation and should be limited to administrative tools.
    pub async fn get_all_restrictions(&self) -> eyre::Result<Vec<NameRestriction>> {
        let db = self.db_pool.clone();
        let restrictions = sqlx::query_as!(
            NameRestriction,
            r#"
                SELECT id, pattern, kind as "kind: _", reason as "reason: _", created_at, created_by
                FROM restricted_names
                ORDER BY created_at DESC
            "#
        )
        .fetch_all(&db)
        .await
        .wrap_err("failed to load name restrictions")?;

        Ok(restrictions)
    }

    /// Retrieve the restrictions cache, initializing it from the DB if it hasn't been already. The
    /// cache is copied whenever it is written to, so reads should generally be fast and writes
    /// will be slower.
    async fn get_restrictions_cache(&self) -> eyre::Result<Arc<RestrictionsCache>> {
        let restrictions_read = self.restrictions.read().await;
        if let Some(restrictions) = &*restrictions_read {
            // Cache is already initialized so we can simply return it
            return Ok(restrictions.clone());
        }
        drop(restrictions_read);

        // Cache is not initialized
        let mut restrictions_write = self.restrictions.write().await;
        // Double-check to ensure it wasn't initialized while we were waiting for the lock
        if let Some(restrictions) = &*restrictions_write {
            return Ok(restrictions.clone());
        }

        let db = self.db_pool.clone();
        let restrictions = sqlx::query_as!(
            NameRestriction,
            r#"
                SELECT id, pattern, kind as "kind: _", reason as "reason: _", created_at, created_by
                FROM restricted_names
            "#
        )
        .fetch_all(&db)
        .await
        .wrap_err("failed to load name restrictions")?;

        let restrictions_cache = spawn_rayon(|| {
            let mut exact = Vec::new();
            let mut regex = Vec::new();
            for mut restriction in restrictions.into_iter() {
                match restriction.kind {
                    RestrictedNameKind::Exact => {
                        restriction.pattern = restriction.pattern.to_lowercase();
                        exact.push(restriction)
                    }
                    RestrictedNameKind::Regex => {
                        if let Ok(re) = create_case_insensitive_regex(&restriction.pattern) {
                            regex.push((restriction, re));
                        } else {
                            error!(
                                "Invalid regex pattern [{}]: {}",
                                restriction.id, restriction.pattern
                            );
                        }
                    }
                }
            }

            RestrictionsCache { exact, regex }
        })
        .await;

        let arc_cache = Arc::new(restrictions_cache);
        *restrictions_write = Some(arc_cache.clone());

        Ok(arc_cache)
    }
}

pub fn create_case_insensitive_regex(pattern: &str) -> Result<Regex, regex::Error> {
    let pattern = format!("(?i){}", pattern);
    Regex::new(&pattern)
}
