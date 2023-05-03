use std::collections::HashMap;
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::futures_util::TryStreamExt;
use async_graphql::{Context, InputObject, Object, Result, SimpleObject};
use async_trait::async_trait;
use axum_client_ip::SecureClientIp;
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use ipnetwork::IpNetwork;
use rand::distributions::{Alphanumeric, DistString};
use rand::thread_rng;
use secrecy::{ExposeSecret, Secret};
use sqlx::{PgPool, QueryBuilder};

use crate::email::{
    EmailChangeData, EmailVerificationData, MailgunClient, MailgunMessage, MailgunTemplate,
    PasswordChangeData,
};
use crate::errors::graphql_error;
use crate::redis::RedisPool;
use crate::sessions::{
    update_all_sessions_for_user, AuthenticatedSession, SbPermissions, SbSession,
};
use crate::telemetry::spawn_with_tracing;
use crate::users::auth::{get_stored_credentials, hash_password, validate_credentials};

mod auth;

#[derive(sqlx::FromRow, SimpleObject, Clone, Debug)]
pub struct User {
    pub id: i32,
    pub name: String,
}

#[derive(SimpleObject, Clone, Debug)]
pub struct CurrentUser {
    pub id: i32,
    pub name: String,
    pub email: String,
    pub email_verified: bool,
    pub accepted_privacy_version: u32,
    pub accepted_terms_version: u32,
    pub accepted_use_policy_version: u32,
    pub permissions: SbPermissions,
}

impl From<&AuthenticatedSession> for CurrentUser {
    fn from(session: &AuthenticatedSession) -> Self {
        CurrentUser {
            id: session.data.user_id,
            name: session.data.user_name.clone(),
            email: session.data.email.clone(),
            email_verified: session.data.email_verified,
            accepted_privacy_version: session.data.accepted_privacy_version,
            accepted_terms_version: session.data.accepted_terms_version,
            accepted_use_policy_version: session.data.accepted_use_policy_version,
            permissions: session.data.permissions.clone(),
        }
    }
}

#[derive(Default)]
pub struct UsersQuery;

#[Object]
impl UsersQuery {
    async fn user(&self, ctx: &Context<'_>, id: i32) -> Result<Option<User>> {
        ctx.data_unchecked::<DataLoader<UsersLoader>>()
            .load_one(id)
            .await
    }

    async fn user_by_display_name(&self, ctx: &Context<'_>, name: String) -> Result<Option<User>> {
        ctx.data_unchecked::<DataLoader<UsersLoader>>()
            .load_one(name)
            .await
    }

    async fn current_user(&self, ctx: &Context<'_>) -> Result<Option<CurrentUser>> {
        let session = ctx.data_unchecked::<SbSession>();
        match session {
            SbSession::Authenticated(session) => Ok(Some(session.into())),
            _ => Ok(None),
        }
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
        let SbSession::Authenticated(session) = ctx.data_unchecked::<SbSession>() else {
            return Err(graphql_error("UNAUTHORIZED", "Unauthorized"))
        };

        let current_password = Secret::new(current_password);
        let stored_credentials =
            get_stored_credentials(session.data.user_id, ctx.data_unchecked::<PgPool>())
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
                to: session.data.email.clone(),
                template: MailgunTemplate::PasswordChange(PasswordChangeData {
                    username: session.data.user_name.clone(),
                }),
            });

            async move {
                let hash = hash_password(Secret::new(new_password))
                    .await
                    .wrap_err("Failed to hash password")?;
                Result::<_, eyre::Error>::Ok(sqlx::query!(
                    r#"UPDATE users_private SET password = $1 WHERE user_id = $2"#,
                    hash.expose_secret(),
                    session.data.user_id
                ))
            }
        });

        let mut query = QueryBuilder::new("UPDATE users SET ");
        let mut email_verification = None;
        let mut new_session = session.clone();
        let mut has_update = false;
        {
            let mut query = query.separated(", ");

            if let Some(email) = changes.email {
                if email != session.data.email {
                    emails.push(MailgunMessage {
                        to: session.data.email.clone(),
                        template: MailgunTemplate::EmailChange(EmailChangeData {
                            username: session.data.user_name.clone(),
                        }),
                    });
                    let token = generate_email_token();
                    let ip: IpNetwork = ctx.data_unchecked::<SecureClientIp>().0.into();
                    email_verification = Some(sqlx::query!(
                        r#"
                            INSERT INTO email_verifications
                            (user_id, email, verification_code, request_time, request_ip)
                            VALUES
                            ($1, $2, $3, NOW(), $4)
                        "#,
                        session.data.user_id,
                        email.clone(),
                        token,
                        ip,
                    ));
                    emails.push(MailgunMessage {
                        to: email.clone(),
                        template: MailgunTemplate::EmailVerification(EmailVerificationData {
                            user_id: session.data.user_id,
                            username: session.data.user_name.clone(),
                            token,
                        }),
                    });

                    has_update = true;
                    new_session.data.email = email.clone();
                    new_session.data.email_verified = false;

                    query.push("email_verified = FALSE, email = ");
                    query.push_bind_unseparated(email);
                }
            }
        }

        query.push(" WHERE id = ");
        query.push_bind(session.data.user_id);

        if !has_update && get_password_query.is_none() {
            return Ok(session.into());
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
                    tracing::error!("sending email failed: {e:?}")
                }
            });
        }

        if update_sessions {
            update_all_sessions_for_user(&new_session, ctx.data_unchecked::<RedisPool>())
                .await
                .wrap_err("Failed to update sessions")?;
            Ok((&new_session).into())
        } else {
            Ok(session.into())
        }
    }
}

#[derive(Clone, Default, Eq, PartialEq, InputObject)]
pub struct UpdateCurrentUserChanges {
    pub email: Option<String>,
    #[graphql(secret)]
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

#[async_trait]
impl Loader<i32> for UsersLoader {
    type Value = User;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[i32]) -> Result<HashMap<i32, Self::Value>, Self::Error> {
        Ok(sqlx::query_as!(
            User,
            r#"SELECT id, name::TEXT as "name!" FROM users WHERE id = ANY($1)"#,
            keys
        )
        .fetch(&self.db)
        .map_ok(|u| (u.id, u))
        .try_collect()
        .await?)
    }
}

#[async_trait]
impl Loader<String> for UsersLoader {
    type Value = User;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[String]) -> Result<HashMap<String, Self::Value>, Self::Error> {
        // TODO(tec27): Move to the query_as! (macro) version once sqlx properly supports citext
        // columns: https://github.com/launchbadge/sqlx/pull/2478
        Ok(
            sqlx::query_as(r#"SELECT id, name::TEXT as "name" FROM users WHERE name = ANY($1)"#)
                .bind(keys)
                .fetch(&self.db)
                .map_ok(|u: User| (u.name.clone(), u))
                .try_collect()
                .await?,
        )
    }
}

fn generate_email_token() -> String {
    Alphanumeric.sample_string(&mut thread_rng(), 12)
}
