use crate::configuration::Settings;
use crate::email::MailgunClient;
use crate::redis::RedisPool;
use crate::schema::SbSchema;
use crate::users::CurrentUserRepo;
use axum::extract::FromRef;
use jsonwebtoken::DecodingKey;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub settings: Arc<Settings>,
    pub db_pool: PgPool,
    pub redis_pool: RedisPool,
    pub mailgun: Arc<MailgunClient>,
    pub jwt_key: Arc<DecodingKey>,
    pub graphql_schema: SbSchema,
    pub current_user_repo: CurrentUserRepo,
}
