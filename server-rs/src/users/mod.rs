use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::futures_util::TryStreamExt;
use async_graphql::{
    ComplexObject, Context, Guard, InputObject, Object, Result, SchemaBuilder, SimpleObject,
};
use axum::extract::{FromRequestParts, OptionalFromRequestParts};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::{Extension, RequestPartsExt};
use axum_client_ip::ClientIp;
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use ipnetwork::IpNetwork;
use mobc_redis::redis::AsyncCommands;
use names::{
    create_case_insensitive_regex, NameChecker, NameRestriction, RestrictedNameKind,
    RestrictedNameReason,
};
use rand::distr::{Alphanumeric, SampleString};
use rand::rng;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use tracing::error;
use typeshare::typeshare;

use crate::email::{
    EmailChangeData, EmailVerificationData, MailgunClient, MailgunMessage, MailgunTemplate,
    PasswordChangeData,
};
use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::sessions::SbSession;
use crate::state::AppState;
use crate::telemetry::spawn_with_tracing;
use crate::users::auth::{get_stored_credentials, hash_password, validate_credentials};
use crate::users::permissions::{PermissionsLoader, RequiredPermission, SbPermissions};

mod auth;
pub mod names;
pub mod permissions;

pub struct UsersModule {
    db_pool: PgPool,
    redis_pool: RedisPool,
}

impl UsersModule {
    pub fn new(db_pool: PgPool, redis_pool: RedisPool) -> Self {
        Self {
            db_pool,
            redis_pool,
        }
    }
}

impl SchemaBuilderModule for UsersModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder
            .data(DataLoader::new(
                UsersLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                PermissionsLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(CurrentUserRepo::new(
                self.db_pool.clone(),
                self.redis_pool.clone(),
            ))
    }
}

#[derive(sqlx::FromRow, SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct SbUser {
    pub id: i32,
    /// The user's display name (may differ from their login name).
    pub name: String,
}

#[ComplexObject]
impl SbUser {
    #[graphql(guard = RequiredPermission::EditPermissions.or(IsCurrentUser::guard(self.id)))]
    async fn permissions(&self, ctx: &Context<'_>) -> Result<SbPermissions> {
        ctx.data_unchecked::<DataLoader<PermissionsLoader>>()
            .load_one(self.id)
            .await?
            .ok_or(graphql_error("NOT_FOUND", "User not found"))
    }
}

impl From<CurrentUser> for SbUser {
    fn from(value: CurrentUser) -> Self {
        Self {
            id: value.id,
            name: value.name,
        }
    }
}

pub struct IsCurrentUser(i32);

impl IsCurrentUser {
    fn guard(checked_user_id: i32) -> Self {
        Self(checked_user_id)
    }
}

impl Guard for IsCurrentUser {
    async fn check(&self, ctx: &Context<'_>) -> Result<()> {
        if let Some(ref user) = ctx.data_unchecked::<Option<CurrentUser>>() {
            if user.id == self.0 {
                return Ok(());
            }
        }

        Err(graphql_error("FORBIDDEN", "Forbidden"))
    }
}

#[derive(SimpleObject, Clone, Debug)]
pub struct CurrentUser {
    pub id: i32,
    /// The user's display name (may differ from their login name).
    pub name: String,
    /// The name the user logs in with (may differ from their display name).
    pub login_name: String,
    pub email: String,
    pub email_verified: bool,
    pub accepted_privacy_version: i32,
    pub accepted_terms_version: i32,
    pub accepted_use_policy_version: i32,
    pub locale: Option<String>,

    pub permissions: SbPermissions,
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> std::result::Result<Self, Self::Rejection> {
        let Extension(session): Extension<SbSession> = parts
            .extract()
            .await
            .map_err(|_| (StatusCode::UNAUTHORIZED, "Unauthorized"))?;
        let SbSession::Authenticated(session) = session else {
            return Err((StatusCode::UNAUTHORIZED, "Unauthorized"));
        };

        state
            .current_user_repo
            .load_cached_user(session.user_id, Default::default())
            .await
            .map_err(|e| {
                error!("Failed to load cached user: {e:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
            })
    }
}

impl OptionalFromRequestParts<AppState> for CurrentUser {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Option<Self>, Self::Rejection> {
        let Ok(Extension(SbSession::Authenticated(session))) = parts.extract().await else {
            return Ok(None);
        };

        Ok(state
            .current_user_repo
            .load_cached_user(session.user_id, Default::default())
            .await
            .ok())
    }
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedUserMessage {
    #[serde(rename_all = "camelCase")]
    PermissionsChanged {
        user_id: i32,
        permissions: SbPermissions,
    },
}

#[derive(Default)]
pub struct UsersQuery;

#[Object]
impl UsersQuery {
    async fn user(&self, ctx: &Context<'_>, id: i32) -> Result<Option<SbUser>> {
        ctx.data_unchecked::<DataLoader<UsersLoader>>()
            .load_one(id)
            .await
    }

    async fn user_by_display_name(
        &self,
        ctx: &Context<'_>,
        name: String,
    ) -> Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?.load_one(name).await
    }

    async fn current_user(&self, ctx: &Context<'_>) -> Result<Option<CurrentUser>> {
        Ok(ctx.data::<Option<CurrentUser>>()?.clone())
    }

    #[graphql(guard = RequiredPermission::ManageRestrictedNames)]
    async fn restricted_names(&self, ctx: &Context<'_>) -> Result<Vec<NameRestriction>> {
        let restrictions = ctx.data::<NameChecker>()?.get_all_restrictions().await?;
        Ok(restrictions)
    }
}

#[derive(Default)]
pub struct UsersMutation;

#[Object]
impl UsersMutation {
    async fn update_current_user(
        &self,
        ctx: &Context<'_>,
        #[graphql(secret)] current_password: String,
        changes: UpdateCurrentUserChanges,
    ) -> Result<CurrentUser> {
        let Some(user) = ctx.data_unchecked::<Option<CurrentUser>>() else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };

        let current_password: SecretString = current_password.into();
        let stored_credentials = get_stored_credentials(user.id, ctx.data_unchecked::<PgPool>())
            .await
            .wrap_err("Failed to get stored credentials")?;
        let credentials_valid = validate_credentials(current_password, stored_credentials)
            .await
            .wrap_err("Failed to validate credentials")?;
        if !credentials_valid {
            return Err(graphql_error("INVALID_PASSWORD", "Invalid password"));
        }

        // TODO(tec27): Move this code out of the mutation impl and put it somewhere it's more
        // easily testable
        let mut emails = Vec::new();

        let get_password_query = changes.new_password.map(|new_password| {
            emails.push(MailgunMessage {
                to: user.email.clone(),
                template: MailgunTemplate::PasswordChange(PasswordChangeData {
                    username: user.name.clone(),
                }),
            });

            async move {
                let hash = hash_password(new_password.into())
                    .await
                    .wrap_err("Failed to hash password")?;
                Result::<_, eyre::Error>::Ok(sqlx::query!(
                    r#"UPDATE users_private SET password = $1 WHERE user_id = $2"#,
                    hash.expose_secret(),
                    user.id
                ))
            }
        });

        let mut query = QueryBuilder::new("UPDATE users SET ");
        let mut email_verification = None;
        let mut has_update = false;
        {
            let mut query = query.separated(", ");

            if let Some(email) = changes.email {
                if email != user.email {
                    emails.push(MailgunMessage {
                        to: user.email.clone(),
                        template: MailgunTemplate::EmailChange(EmailChangeData {
                            username: user.name.clone(),
                        }),
                    });
                    let token = generate_email_token();
                    let ip: IpNetwork = ctx.data_unchecked::<ClientIp>().0.into();
                    email_verification = Some(sqlx::query!(
                        r#"
                            INSERT INTO email_verifications
                            (user_id, email, verification_code, request_time, request_ip)
                            VALUES
                            ($1, $2, $3, NOW(), $4)
                        "#,
                        user.id,
                        email.clone(),
                        token,
                        ip,
                    ));
                    emails.push(MailgunMessage {
                        to: email.clone(),
                        template: MailgunTemplate::EmailVerification(EmailVerificationData {
                            user_id: user.id,
                            username: user.name.clone(),
                            token,
                        }),
                    });

                    has_update = true;

                    query.push("email_verified = FALSE, email = ");
                    query.push_bind_unseparated(email);
                }
            }
        }

        query.push(" WHERE id = ");
        query.push_bind(user.id);

        if !has_update && get_password_query.is_none() {
            return Ok(user.clone());
        }

        let mut tx = ctx
            .data_unchecked::<PgPool>()
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;

        let update_sessions = match (has_update, get_password_query) {
            (false, None) => false,
            (false, Some(get_password_query)) => {
                get_password_query
                    .await?
                    .execute(&mut *tx)
                    .await
                    .wrap_err("Failed to update password")?;
                // Changing the password doesn't change anything in the session data
                false
            }
            (true, None) => {
                query
                    .build()
                    .execute(&mut *tx)
                    .await
                    .wrap_err("Failed to update user data")?;
                if let Some(q) = email_verification {
                    q.execute(&mut *tx)
                        .await
                        .wrap_err("Failed to insert email verification")?;
                }
                true
            }
            (true, Some(get_password_query)) => {
                query
                    .build()
                    .execute(&mut *tx)
                    .await
                    .wrap_err("Failed to update user data")?;
                if let Some(q) = email_verification {
                    q.execute(&mut *tx)
                        .await
                        .wrap_err("Failed to insert email verification")?;
                }
                get_password_query
                    .await?
                    .execute(&mut *tx)
                    .await
                    .wrap_err("Failed to update password")?;

                true
            }
        };

        tx.commit().await.wrap_err("Failed to commit transaction")?;

        let mailgun = ctx.data_unchecked::<Arc<MailgunClient>>();
        for email in emails.into_iter() {
            let mailgun = mailgun.clone();
            spawn_with_tracing(async move {
                if let Err(e) = mailgun.send(email).await {
                    error!("sending email failed: {e:?}")
                }
            });
        }

        if update_sessions {
            let user = ctx
                .data_unchecked::<CurrentUserRepo>()
                .load_cached_user(user.id, CacheBehavior::ForceRefresh)
                .await
                .wrap_err("Failed to update sessions")?;
            Ok(user)
        } else {
            Ok(user.clone())
        }
    }

    #[graphql(guard = RequiredPermission::EditPermissions)]
    async fn update_user_permissions(
        &self,
        ctx: &Context<'_>,
        user_id: i32,
        permissions: SbPermissions,
    ) -> Result<SbUser> {
        sqlx::query!(
            r#"
                UPDATE permissions
                SET
                    edit_permissions = $2,
                    debug = $3,
                    ban_users = $4,
                    manage_leagues = $5,
                    manage_maps = $6,
                    manage_map_pools = $7,
                    manage_matchmaking_seasons = $8,
                    manage_matchmaking_times = $9,
                    manage_rally_point_servers = $10,
                    mass_delete_maps = $11,
                    moderate_chat_channels = $12,
                    manage_news = $13,
                    manage_bug_reports = $14,
                    manage_restricted_names = $15
                WHERE user_id = $1
            "#,
            user_id,
            permissions.edit_permissions,
            permissions.debug,
            permissions.ban_users,
            permissions.manage_leagues,
            permissions.manage_maps,
            permissions.manage_map_pools,
            permissions.manage_matchmaking_seasons,
            permissions.manage_matchmaking_times,
            permissions.manage_rally_point_servers,
            permissions.mass_delete_maps,
            permissions.moderate_chat_channels,
            permissions.manage_news,
            permissions.manage_bug_reports,
            permissions.manage_restricted_names,
        )
        .execute(ctx.data_unchecked::<PgPool>())
        .await?;

        let user = ctx
            .data_unchecked::<CurrentUserRepo>()
            .load_cached_user(user_id, CacheBehavior::ForceRefresh)
            .await?;

        ctx.data_unchecked::<RedisPool>()
            .publish(PublishedUserMessage::PermissionsChanged {
                user_id,
                permissions,
            })
            .await?;

        Ok(user.into())
    }

    #[graphql(guard = RequiredPermission::ManageRestrictedNames)]
    async fn add_restricted_name(
        &self,
        ctx: &Context<'_>,
        pattern: String,
        kind: RestrictedNameKind,
        reason: RestrictedNameReason,
    ) -> Result<NameRestriction> {
        let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"));
        };

        if kind == RestrictedNameKind::Regex {
            if let Err(e) = create_case_insensitive_regex(&pattern) {
                return Err(graphql_error(
                    "INVALID_REGEX",
                    format!("Invalid regex: {e}"),
                ));
            }
        }

        let restriction = ctx
            .data::<NameChecker>()?
            .add_restriction(pattern, kind, reason, user.id)
            .await
            .map_err(|e| {
                graphql_error(
                    "INTERNAL_SERVER_ERROR",
                    format!("Failed to add restriction: {e}"),
                )
            })?;

        Ok(restriction)
    }

    #[graphql(guard = RequiredPermission::ManageRestrictedNames)]
    async fn delete_restricted_name(&self, ctx: &Context<'_>, id: i32) -> Result<u64> {
        let result = ctx
            .data::<NameChecker>()?
            .delete_restriction(id)
            .await
            .map_err(|e| {
                graphql_error(
                    "INTERNAL_SERVER_ERROR",
                    format!("Failed to remove restriction: {e}"),
                )
            })?;

        Ok(result)
    }

    #[graphql(guard = RequiredPermission::ManageRestrictedNames)]
    async fn test_restricted_name(
        &self,
        ctx: &Context<'_>,
        name: String,
    ) -> Result<Option<NameRestriction>> {
        let result = ctx
            .data::<NameChecker>()?
            .check_name(&name)
            .await
            .map_err(|e| {
                graphql_error(
                    "INTERNAL_SERVER_ERROR",
                    format!("Failed to check name: {e}"),
                )
            })?;

        Ok(result)
    }
}

#[derive(Clone, Default, Eq, PartialEq, InputObject)]
pub struct UpdateCurrentUserChanges {
    #[graphql(validator(min_length = 3, max_length = 100, regex = r"^[^@]+@[^@]+$"))]
    pub email: Option<String>,
    #[graphql(secret, validator(min_length = 6))]
    pub new_password: Option<String>,
}

pub struct UsersLoader {
    db: PgPool,
}

impl UsersLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<i32> for UsersLoader {
    type Value = SbUser;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[i32]) -> Result<HashMap<i32, Self::Value>, Self::Error> {
        Ok(sqlx::query_as!(
            SbUser,
            r#"SELECT id, name::TEXT as "name!" FROM users WHERE id = ANY($1)"#,
            keys
        )
        .fetch(&self.db)
        .map_ok(|u| (u.id, u))
        .try_collect()
        .await?)
    }
}

impl Loader<String> for UsersLoader {
    type Value = SbUser;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, Self::Value>, Self::Error> {
        // TODO(tec27): Move to the query_as! (macro) version once sqlx properly supports citext
        // columns: https://github.com/launchbadge/sqlx/pull/2478
        Ok(
            sqlx::query_as(r#"SELECT id, name::TEXT as "name" FROM users WHERE name = ANY($1)"#)
                .bind(keys)
                .fetch(&self.db)
                .map_ok(|u: SbUser| (u.name.clone(), u))
                .try_collect()
                .await?,
        )
    }
}

fn generate_email_token() -> String {
    Alphanumeric.sample_string(&mut rng(), 12)
}

/// Repository implementation for retrieving/updating info about the current user. Utilizes a cache
/// in front of the DB for this purpose.
#[derive(Clone)]
pub struct CurrentUserRepo {
    db: PgPool,
    redis: RedisPool,
}

// TODO(tec27): Move this somewhere common for other caches to use
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum CacheBehavior {
    #[default]
    AllowCached,
    ForceRefresh,
}

impl CurrentUserRepo {
    // NOTE(tec27): If you update this here, also update it in the node server's UserService.
    const USER_CACHE_TIME: Duration = Duration::from_secs(60 * 60);

    pub fn new(db: PgPool, redis: RedisPool) -> Self {
        Self { db, redis }
    }

    fn user_cache_key(user_id: i32) -> String {
        format!("users:{}", user_id)
    }

    pub async fn load_cached_user(
        &self,
        user_id: i32,
        cache_behavior: CacheBehavior,
    ) -> eyre::Result<CurrentUser> {
        if cache_behavior == CacheBehavior::AllowCached {
            let mut redis = self.redis.get().await?;
            match redis
                .get::<_, Option<String>>(&CurrentUserRepo::user_cache_key(user_id))
                .await
            {
                Ok(user_json) => {
                    if let Some(user_json) = user_json {
                        match serde_json::from_str::<CachedCurrentUser>(&user_json) {
                            Ok(user) => {
                                return Ok(user.into());
                            }
                            Err(e) => {
                                error!("Failed to deserialize cached user: {e:?}");
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to get cached user: {e:?}");
                }
            }
        }

        let db = self.db.clone();
        let (user, permissions) = tokio::join!(
            sqlx::query_as!(
                SelfUser,
                r#"
                    SELECT id, name::TEXT as "name!", login_name::TEXT as "login_name!",
                        email, email_verified, accepted_privacy_version, accepted_terms_version,
                        accepted_use_policy_version, locale
                    FROM users
                    WHERE id = $1
                "#,
                user_id
            )
            .fetch_one(&db),
            sqlx::query_as!(
                SbPermissions,
                r#"
                    SELECT user_id as "id", edit_permissions, debug, ban_users, manage_leagues,
                        manage_maps, manage_map_pools, manage_matchmaking_seasons,
                        manage_matchmaking_times, manage_rally_point_servers, mass_delete_maps,
                        moderate_chat_channels, manage_news, manage_bug_reports,
                        manage_restricted_names
                    FROM permissions
                    WHERE user_id = $1
                "#,
                user_id
            )
            .fetch_one(&db)
        );

        let cached_user = CachedCurrentUser {
            user: user.wrap_err("failed to load user")?,
            permissions: permissions.wrap_err("failed to load permissions")?,
        };

        let mut redis = self
            .redis
            .get()
            .await
            .wrap_err("Couldn't get redis connection")?;
        redis
            .set_ex::<_, _, ()>(
                CurrentUserRepo::user_cache_key(user_id),
                serde_json::to_string(&cached_user).wrap_err("Failed to serialize cached user")?,
                CurrentUserRepo::USER_CACHE_TIME.as_secs() as usize,
            )
            .await
            .wrap_err("Failed to save cached user")?;

        Ok(cached_user.into())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct SelfUser {
    pub id: i32,
    pub name: String,
    pub login_name: String,
    pub email: String,
    pub email_verified: bool,
    pub accepted_privacy_version: i32,
    pub accepted_terms_version: i32,
    pub accepted_use_policy_version: i32,
    pub locale: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCurrentUser {
    user: SelfUser,
    permissions: SbPermissions,
}

impl From<CachedCurrentUser> for CurrentUser {
    fn from(value: CachedCurrentUser) -> Self {
        CurrentUser {
            id: value.user.id,
            name: value.user.name,
            login_name: value.user.login_name,
            email: value.user.email,
            email_verified: value.user.email_verified,
            accepted_privacy_version: value.user.accepted_privacy_version,
            accepted_terms_version: value.user.accepted_terms_version,
            accepted_use_policy_version: value.user.accepted_use_policy_version,
            locale: value.user.locale,

            permissions: value.permissions,
        }
    }
}
