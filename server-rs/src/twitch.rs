//! Twitch account linking. Because ShieldBattery authenticates every request with a bearer JWT
//! (not a cookie), we can't run a classic server-side OAuth redirect that reads the session on a
//! top-level browser navigation. Instead the client opens the Twitch authorize URL itself (see
//! `twitchStartLink`), captures the resulting `code`/`state` from the redirect, and hands them to
//! `twitchCompleteLink` over a normal authenticated GraphQL request -- the code exchange (which
//! needs the client secret) still happens entirely server-side.

use async_graphql::{Context, Object, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _, eyre};
use deadpool_redis::redis::AsyncCommands;
use secrecy::ExposeSecret;
use serde::Deserialize;
use sqlx::PgPool;
use tracing::error;
use url::Url;
use uuid::Uuid;

use crate::configuration::{Settings, TwitchSettings};
use crate::graphql::errors::graphql_error;
use crate::redis::RedisPool;
use crate::users::{CurrentUser, SbUserId};

const TWITCH_OAUTH_AUTHORIZE_URL: &str = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_OAUTH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_USERS_URL: &str = "https://api.twitch.tv/helix/users";
/// How long a pending link request (the server-issued `state`) stays valid. Long enough for a user
/// to complete the Twitch consent screen, short enough to bound abuse of a leaked state value.
const LINK_STATE_TTL_SECONDS: u64 = 600;

fn link_state_key(state: &str) -> String {
    format!("twitch:link_state:{state}")
}

/// The OAuth redirect URI, which must exactly match the one registered on the Twitch application
/// and be reused verbatim in the code exchange. In dev this resolves to
/// `http://localhost:5555/twitch/callback`.
fn redirect_uri(settings: &Settings) -> String {
    format!(
        "{}/twitch/callback",
        settings.canonical_host.trim_end_matches('/')
    )
}

/// A persistent link between a ShieldBattery user and their Twitch account.
#[derive(Debug, Clone, SimpleObject, sqlx::FromRow)]
pub struct TwitchConnection {
    #[graphql(skip)]
    pub user_id: SbUserId,
    /// Twitch's stable numeric user id for the linked account.
    pub twitch_user_id: String,
    /// The Twitch login name (used in `twitch.tv/<login>` URLs).
    pub twitch_login: String,
    /// The Twitch display name (may differ from the login name in capitalization).
    pub twitch_display_name: String,
    /// When the account was first linked.
    pub linked_at: DateTime<Utc>,
}

/// The result of starting a Twitch link: the authorize URL the client should open.
#[derive(SimpleObject)]
pub struct TwitchLinkStart {
    /// The Twitch OAuth authorize URL the client should open (e.g. in a popup) to begin linking.
    pub url: String,
}

fn require_current_user<'a>(ctx: &'a Context<'_>) -> async_graphql::Result<&'a CurrentUser> {
    ctx.data::<Option<CurrentUser>>()?
        .as_ref()
        .ok_or_else(|| graphql_error("UNAUTHORIZED", "Unauthorized"))
}

fn require_twitch_settings(settings: &Settings) -> async_graphql::Result<&TwitchSettings> {
    settings.twitch.as_ref().ok_or_else(|| {
        graphql_error(
            "TWITCH_NOT_CONFIGURED",
            "Twitch integration is not configured",
        )
    })
}

async fn load_connection(
    pool: &PgPool,
    user_id: SbUserId,
) -> eyre::Result<Option<TwitchConnection>> {
    sqlx::query_as!(
        TwitchConnection,
        r#"
            SELECT user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at
            FROM twitch_connections
            WHERE user_id = $1
        "#,
        user_id as _,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to load Twitch connection")
}

async fn upsert_connection(
    pool: &PgPool,
    user_id: SbUserId,
    twitch_user_id: &str,
    twitch_login: &str,
    twitch_display_name: &str,
) -> Result<TwitchConnection, sqlx::Error> {
    sqlx::query_as!(
        TwitchConnection,
        r#"
            INSERT INTO twitch_connections
                (user_id, twitch_user_id, twitch_login, twitch_display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO UPDATE SET
                twitch_user_id = EXCLUDED.twitch_user_id,
                twitch_login = EXCLUDED.twitch_login,
                twitch_display_name = EXCLUDED.twitch_display_name,
                updated_at = now()
            RETURNING user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at
        "#,
        user_id as _,
        twitch_user_id,
        twitch_login,
        twitch_display_name,
    )
    .fetch_one(pool)
    .await
}

async fn delete_connection(pool: &PgPool, user_id: SbUserId) -> eyre::Result<bool> {
    let result = sqlx::query!(
        r#"DELETE FROM twitch_connections WHERE user_id = $1"#,
        user_id as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to delete Twitch connection")?;
    Ok(result.rows_affected() > 0)
}

#[derive(Deserialize)]
struct TwitchTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct HelixUsersResponse {
    data: Vec<HelixUser>,
}

#[derive(Deserialize)]
struct HelixUser {
    id: String,
    login: String,
    display_name: String,
}

/// Exchanges an authorization `code` for a user access token via the Twitch token endpoint. The
/// `redirect_uri` must be byte-identical to the one used to obtain the code.
async fn exchange_code(
    twitch: &TwitchSettings,
    http: &reqwest::Client,
    code: &str,
    redirect_uri: &str,
) -> eyre::Result<String> {
    let params = [
        ("client_id", twitch.client_id.as_str()),
        ("client_secret", twitch.client_secret.expose_secret()),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ];
    let resp = http
        .post(TWITCH_OAUTH_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .wrap_err("Failed to send Twitch token request")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(eyre!("Twitch token exchange failed ({status}): {body}"));
    }
    let token: TwitchTokenResponse = resp
        .json()
        .await
        .wrap_err("Failed to parse Twitch token response")?;
    Ok(token.access_token)
}

/// Looks up the identity of the user who owns `access_token`. With no user id parameter, Twitch's
/// Get Users endpoint returns the token's owner, so no OAuth scopes are required.
async fn get_authenticated_user(
    twitch: &TwitchSettings,
    http: &reqwest::Client,
    access_token: &str,
) -> eyre::Result<HelixUser> {
    let resp = http
        .get(TWITCH_HELIX_USERS_URL)
        .header("Client-Id", twitch.client_id.as_str())
        .bearer_auth(access_token)
        .send()
        .await
        .wrap_err("Failed to send Twitch users request")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(eyre!("Twitch get-users failed ({status}): {body}"));
    }
    let users: HelixUsersResponse = resp
        .json()
        .await
        .wrap_err("Failed to parse Twitch users response")?;
    users
        .data
        .into_iter()
        .next()
        .ok_or_else(|| eyre!("Twitch get-users returned no user"))
}

#[derive(Default)]
pub struct TwitchQuery;

#[Object]
impl TwitchQuery {
    /// The current user's linked Twitch connection, or `null` if they haven't linked one.
    async fn my_twitch_connection(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<TwitchConnection>> {
        let user = require_current_user(ctx)?;
        Ok(load_connection(ctx.data::<PgPool>()?, user.id).await?)
    }
}

#[derive(Default)]
pub struct TwitchMutation;

#[Object]
impl TwitchMutation {
    /// Begins linking the current user's Twitch account, returning the Twitch OAuth authorize URL
    /// the client should open. Completing the flow calls `twitchCompleteLink` with the resulting
    /// `code` and `state`.
    async fn twitch_start_link(&self, ctx: &Context<'_>) -> async_graphql::Result<TwitchLinkStart> {
        let user = require_current_user(ctx)?;
        let settings = ctx.data::<Settings>()?;
        let twitch = require_twitch_settings(settings)?;

        // A server-issued, single-use `state` bound to this user, stored in Redis. Completing the
        // link requires both this state (proving the flow started here) and the same user's auth
        // token, which together prevent an attacker from linking their Twitch account to a victim.
        let state = Uuid::new_v4().to_string();
        let mut redis = ctx
            .data::<RedisPool>()?
            .get()
            .await
            .wrap_err("Could not connect to Redis")?;
        redis
            .set_ex::<_, _, ()>(
                link_state_key(&state),
                i32::from(user.id),
                LINK_STATE_TTL_SECONDS,
            )
            .await
            .wrap_err("Failed to store Twitch link state")?;

        let authorize_url = Url::parse_with_params(
            TWITCH_OAUTH_AUTHORIZE_URL,
            &[
                ("client_id", twitch.client_id.as_str()),
                ("redirect_uri", redirect_uri(settings).as_str()),
                ("response_type", "code"),
                // We only need to read the linking user's channel identity (Get Users returns the
                // token's owner even with no scopes), so we request no scopes.
                ("scope", ""),
                ("state", state.as_str()),
            ],
        )
        .wrap_err("Failed to build Twitch authorize URL")?;

        Ok(TwitchLinkStart {
            url: authorize_url.to_string(),
        })
    }

    /// Completes linking the current user's Twitch account using the `code` and `state` returned by
    /// the Twitch OAuth redirect.
    async fn twitch_complete_link(
        &self,
        ctx: &Context<'_>,
        code: String,
        state: String,
    ) -> async_graphql::Result<TwitchConnection> {
        let user = require_current_user(ctx)?;
        let settings = ctx.data::<Settings>()?;
        let twitch = require_twitch_settings(settings)?;

        // Validate + consume the one-time state.
        let mut redis = ctx
            .data::<RedisPool>()?
            .get()
            .await
            .wrap_err("Could not connect to Redis")?;
        let key = link_state_key(&state);
        let stored_user_id: Option<i32> = redis
            .get(&key)
            .await
            .wrap_err("Failed to read Twitch link state")?;
        let _: () = redis
            .del(&key)
            .await
            .wrap_err("Failed to clear Twitch link state")?;

        if stored_user_id != Some(i32::from(user.id)) {
            return Err(graphql_error(
                "TWITCH_INVALID_STATE",
                "Your Twitch linking request was invalid or expired. Please try again.",
            ));
        }

        let http = reqwest::Client::new();
        let redirect_uri = redirect_uri(settings);
        let access_token = exchange_code(twitch, &http, &code, &redirect_uri)
            .await
            .map_err(|e| {
                error!("Twitch code exchange failed: {e:?}");
                graphql_error(
                    "TWITCH_EXCHANGE_FAILED",
                    "Failed to complete Twitch linking",
                )
            })?;
        let twitch_user = get_authenticated_user(twitch, &http, &access_token)
            .await
            .map_err(|e| {
                error!("Twitch get-users failed: {e:?}");
                graphql_error(
                    "TWITCH_EXCHANGE_FAILED",
                    "Failed to complete Twitch linking",
                )
            })?;

        let connection = match upsert_connection(
            ctx.data::<PgPool>()?,
            user.id,
            &twitch_user.id,
            &twitch_user.login,
            &twitch_user.display_name,
        )
        .await
        {
            Ok(connection) => connection,
            Err(e) => {
                if e.as_database_error().and_then(|db| db.constraint())
                    == Some("twitch_connections_twitch_user_id_key")
                {
                    return Err(graphql_error(
                        "TWITCH_ALREADY_LINKED",
                        "That Twitch account is already linked to another ShieldBattery account.",
                    ));
                }
                error!("Failed to upsert Twitch connection: {e:?}");
                return Err(graphql_error(
                    "TWITCH_LINK_FAILED",
                    "Failed to link Twitch account",
                ));
            }
        };

        Ok(connection)
    }

    /// Removes the current user's Twitch connection. Returns whether a connection was removed.
    async fn twitch_unlink(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        let user = require_current_user(ctx)?;
        Ok(delete_connection(ctx.data::<PgPool>()?, user.id).await?)
    }
}
