use crate::configuration::Settings;
use crate::email::MailgunClient;
use crate::file_store::FileStore;
use crate::redis::RedisPool;
use crate::schema::SbSchema;
use crate::users::CurrentUserRepo;
use crate::users::names::NameChecker;
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
    pub file_store: FileStore,
    pub jwt_key: Arc<DecodingKey>,
    pub graphql_schema: SbSchema,
    pub current_user_repo: CurrentUserRepo,
    pub name_checker: NameChecker,
}
