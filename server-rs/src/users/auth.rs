use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use secrecy::{ExposeSecret, SecretString};
use sqlx::PgPool;

use crate::telemetry::spawn_blocking_with_tracing;

#[derive(thiserror::Error, Debug)]
pub enum AuthError {
    #[error(transparent)]
    UnexpectedError(#[from] eyre::Error),
}

pub type Credentials = (i32, SecretString);

#[tracing::instrument(skip_all)]
pub async fn get_stored_credentials(user_id: i32, pool: &PgPool) -> Result<Credentials, AuthError> {
    let result = sqlx::query!(
        r#"
        SELECT user_id, password
        FROM users_private
        WHERE user_id = $1
        "#,
        user_id,
    )
    .fetch_one(pool)
    .await
    .wrap_err("Failed to perform a query to retrieve stored credentials")
    .map(|row| (row.user_id, row.password.into()))
    .map_err(AuthError::UnexpectedError)?;

    Ok(result)
}

#[tracing::instrument(skip_all)]
pub async fn validate_credentials(
    entered_password: SecretString,
    credentials: Credentials,
) -> Result<bool, eyre::Error> {
    let result =
        spawn_blocking_with_tracing(move || verify_password_hash(entered_password, credentials.1))
            .await
            .wrap_err("Failed to spawn blocking task.")
            .map_err(AuthError::UnexpectedError)??;

    Ok(result)
}

#[tracing::instrument(skip_all)]
fn verify_password_hash(
    entered_password: SecretString,
    expected_hash: SecretString,
) -> Result<bool, AuthError> {
    bcrypt::verify(
        entered_password.expose_secret(),
        expected_hash.expose_secret(),
    )
    .wrap_err("Bcrypt verification failed.")
    .map_err(AuthError::UnexpectedError)
}

#[tracing::instrument(skip_all)]
pub async fn hash_password(entered_password: SecretString) -> Result<SecretString, eyre::Error> {
    let result = spawn_blocking_with_tracing(move || hash_password_work(entered_password))
        .await
        .wrap_err("Failed to spawn blocking task.")
        .map_err(AuthError::UnexpectedError)??;

    Ok(result)
}

#[tracing::instrument(skip_all)]
fn hash_password_work(entered_password: SecretString) -> Result<SecretString, AuthError> {
    bcrypt::hash(
        entered_password.expose_secret(),
        11, /* This should ideally match what we use in the JS server */
    )
    .wrap_err("Bcrypt hashing failed.")
    .map_err(AuthError::UnexpectedError)
    .map(Into::into)
}
