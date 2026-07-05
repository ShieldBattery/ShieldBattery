//! Twitch integration: account linking (OAuth) and live-stream tracking (EventSub).
//!
//! Because ShieldBattery authenticates every request with a bearer JWT (not a cookie), we can't run
//! a classic server-side OAuth redirect that reads the session on a top-level browser navigation.
//! Instead the client opens the Twitch authorize URL itself (see `twitchStartLink`), captures the
//! resulting `code`/`state` from the redirect, and hands them to `twitchCompleteLink` over a normal
//! authenticated GraphQL request -- the code exchange (which needs the client secret) still happens
//! entirely server-side.
//!
//! When an account is linked we create Twitch EventSub `stream.online`/`stream.offline`
//! subscriptions (webhook transport) so Twitch pushes live/offline changes to `/twitch/eventsub`.
//! The persistent link (and the ids of its subscriptions) lives in the `twitch_connections` table;
//! the ephemeral "who is live right now" state lives in Redis (`twitch:live`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_graphql::dataloader::DataLoader;
use async_graphql::{ComplexObject, Context, Object, SimpleObject};
use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _, eyre};
use deadpool_redis::redis::{AsyncCommands, ExistenceCheck, SetExpiry, SetOptions};
use hmac::{Hmac, KeyInit, Mac};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use tokio::sync::RwLock;
use tracing::{error, warn};
use url::Url;
use uuid::Uuid;

use crate::configuration::Settings;
use crate::graphql::errors::graphql_error;
use crate::redis::RedisPool;
use crate::state::AppState;
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader};

const TWITCH_OAUTH_AUTHORIZE_URL: &str = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_OAUTH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_USERS_URL: &str = "https://api.twitch.tv/helix/users";
const TWITCH_HELIX_STREAMS_URL: &str = "https://api.twitch.tv/helix/streams";
const TWITCH_HELIX_EVENTSUB_URL: &str = "https://api.twitch.tv/helix/eventsub/subscriptions";

const SUB_TYPE_STREAM_ONLINE: &str = "stream.online";
const SUB_TYPE_STREAM_OFFLINE: &str = "stream.offline";

/// Twitch category names we treat as "StarCraft: Brood War" for the home-page live-streams feed,
/// matched case-insensitively against a stream's category. We match on name rather than Twitch's
/// numeric game id because the ids aren't easily verifiable without live API access; both the id and
/// name are stored in Redis, so this can be swapped for an id allowlist later.
const STARCRAFT_CATEGORY_NAMES: &[&str] = &["starcraft", "starcraft: brood war"];

/// The thumbnail size we substitute into Twitch's `{width}x{height}` template for feed entries.
const STREAM_THUMBNAIL_WIDTH: u32 = 320;
const STREAM_THUMBNAIL_HEIGHT: u32 = 180;

/// How long a pending link request (the server-issued `state`) stays valid. Long enough for a user
/// to complete the Twitch consent screen, short enough to bound abuse of a leaked state value.
const LINK_STATE_TTL_SECONDS: u64 = 600;
/// Redis hash of `sbUserId -> LiveStreamSummary` for every currently-live linked streamer.
const LIVE_STREAMS_KEY: &str = "twitch:live";
/// How long we remember a processed EventSub message id to drop Twitch's redeliveries.
const WEBHOOK_DEDUPE_TTL_SECONDS: u64 = 600;
/// Reject EventSub messages whose timestamp is further than this from now (replay protection).
const WEBHOOK_MAX_AGE_SECONDS: i64 = 600;
/// Delay before boot reconciliation runs, giving the HTTP server time to bind so that the
/// verification callbacks for any (re)created subscriptions can succeed.
const RECONCILE_STARTUP_DELAY: Duration = Duration::from_secs(5);

type HmacSha256 = Hmac<Sha256>;

fn link_state_key(state: &str) -> String {
    format!("twitch:link_state:{state}")
}

fn webhook_dedupe_key(message_id: &str) -> String {
    format!("twitch:eventsub_seen:{message_id}")
}

// ---------------------------------------------------------------------------------------------
// Twitch API client
// ---------------------------------------------------------------------------------------------

struct CachedAppToken {
    token: String,
    expires_at: Instant,
}

/// A client for the Twitch APIs we use, holding our app credentials and a cached app (client-
/// credentials) access token. Created only when Twitch is configured; the integration is disabled
/// otherwise. Shared (behind `Arc`) between the GraphQL resolvers, the EventSub webhook, and boot
/// reconciliation.
pub struct TwitchClient {
    http: reqwest::Client,
    client_id: String,
    client_secret: SecretString,
    eventsub_secret: SecretString,
    eventsub_callback_url: String,
    redirect_uri: String,
    app_token: RwLock<Option<CachedAppToken>>,
}

impl TwitchClient {
    /// Builds a client from settings, returning `None` if Twitch isn't configured.
    pub fn from_settings(settings: &Settings) -> Option<Arc<Self>> {
        let twitch = settings.twitch.as_ref()?;
        let host = settings.canonical_host.trim_end_matches('/');
        Some(Arc::new(Self {
            http: reqwest::Client::new(),
            client_id: twitch.client_id.clone(),
            client_secret: twitch.client_secret.clone(),
            eventsub_secret: twitch.eventsub_secret.clone(),
            eventsub_callback_url: format!("{host}/twitch/eventsub"),
            redirect_uri: format!("{host}/twitch/callback"),
            app_token: RwLock::new(None),
        }))
    }

    fn eventsub_secret(&self) -> &str {
        self.eventsub_secret.expose_secret()
    }

    fn eventsub_callback_url(&self) -> &str {
        &self.eventsub_callback_url
    }

    /// Builds the Twitch OAuth authorize URL for a link attempt with the given `state`.
    fn authorize_url(&self, state: &str) -> eyre::Result<String> {
        let url = Url::parse_with_params(
            TWITCH_OAUTH_AUTHORIZE_URL,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("response_type", "code"),
                // We only need to read the linking user's channel identity (Get Users returns the
                // token's owner even with no scopes), so we request no scopes.
                ("scope", ""),
                ("state", state),
            ],
        )?;
        Ok(url.to_string())
    }

    /// Returns a valid app (client-credentials) access token, fetching/refreshing as needed.
    async fn app_token(&self) -> eyre::Result<String> {
        {
            let guard = self.app_token.read().await;
            if let Some(cached) = guard.as_ref()
                && cached.expires_at > Instant::now()
            {
                return Ok(cached.token.clone());
            }
        }

        let mut guard = self.app_token.write().await;
        // Re-check in case another task refreshed while we waited for the write lock.
        if let Some(cached) = guard.as_ref()
            && cached.expires_at > Instant::now()
        {
            return Ok(cached.token.clone());
        }

        let resp = self
            .http
            .post(TWITCH_OAUTH_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.expose_secret()),
                ("grant_type", "client_credentials"),
            ])
            .send()
            .await
            .wrap_err("Failed to request Twitch app token")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(eyre!("Twitch app token request failed ({status}): {body}"));
        }
        let token: TwitchTokenResponse = resp
            .json()
            .await
            .wrap_err("Failed to parse Twitch app token response")?;
        // Refresh a minute early so we never present an about-to-expire token.
        let ttl = Duration::from_secs(token.expires_in.unwrap_or(3600).saturating_sub(60).max(1));
        *guard = Some(CachedAppToken {
            token: token.access_token.clone(),
            expires_at: Instant::now() + ttl,
        });
        Ok(token.access_token)
    }

    /// Exchanges an authorization `code` for a user access token. The redirect URI must match the
    /// one used to obtain the code.
    async fn exchange_code(&self, code: &str) -> eyre::Result<String> {
        let resp = self
            .http
            .post(TWITCH_OAUTH_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.expose_secret()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", self.redirect_uri.as_str()),
            ])
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
    async fn get_authenticated_user(&self, access_token: &str) -> eyre::Result<HelixUser> {
        let resp = self
            .http
            .get(TWITCH_HELIX_USERS_URL)
            .header("Client-Id", &self.client_id)
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

    async fn create_subscription(
        &self,
        sub_type: &str,
        broadcaster_user_id: &str,
    ) -> eyre::Result<String> {
        let token = self.app_token().await?;
        let body = serde_json::json!({
            "type": sub_type,
            "version": "1",
            "condition": { "broadcaster_user_id": broadcaster_user_id },
            "transport": {
                "method": "webhook",
                "callback": self.eventsub_callback_url,
                "secret": self.eventsub_secret(),
            },
        });
        let resp = self
            .http
            .post(TWITCH_HELIX_EVENTSUB_URL)
            .header("Client-Id", &self.client_id)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .wrap_err("Failed to create Twitch EventSub subscription")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(eyre!("Twitch EventSub create failed ({status}): {text}"));
        }
        let created: EventSubListResponse = resp
            .json()
            .await
            .wrap_err("Failed to parse Twitch EventSub create response")?;
        created
            .data
            .into_iter()
            .next()
            .map(|s| s.id)
            .ok_or_else(|| eyre!("Twitch EventSub create returned no subscription"))
    }

    async fn delete_subscription(&self, id: &str) -> eyre::Result<()> {
        let token = self.app_token().await?;
        let url = Url::parse_with_params(TWITCH_HELIX_EVENTSUB_URL, &[("id", id)])
            .wrap_err("Failed to build Twitch EventSub delete URL")?;
        let resp = self
            .http
            .delete(url)
            .header("Client-Id", &self.client_id)
            .bearer_auth(&token)
            .send()
            .await
            .wrap_err("Failed to delete Twitch EventSub subscription")?;
        // A 404 means it's already gone, which is the state we wanted anyway.
        if !resp.status().is_success() && resp.status() != StatusCode::NOT_FOUND {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(eyre!("Twitch EventSub delete failed ({status}): {text}"));
        }
        Ok(())
    }

    async fn list_subscriptions(&self) -> eyre::Result<Vec<EventSubSubscription>> {
        let token = self.app_token().await?;
        let mut subs = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params: Vec<(&str, &str)> = match &cursor {
                Some(cursor) => vec![("after", cursor.as_str())],
                None => Vec::new(),
            };
            let url = Url::parse_with_params(TWITCH_HELIX_EVENTSUB_URL, &params)
                .wrap_err("Failed to build Twitch EventSub list URL")?;
            let resp = self
                .http
                .get(url)
                .header("Client-Id", &self.client_id)
                .bearer_auth(&token)
                .send()
                .await
                .wrap_err("Failed to list Twitch EventSub subscriptions")?;
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(eyre!("Twitch EventSub list failed ({status}): {text}"));
            }
            let page: EventSubListResponse = resp
                .json()
                .await
                .wrap_err("Failed to parse Twitch EventSub list response")?;
            subs.extend(page.data);
            match page.pagination.and_then(|p| p.cursor) {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(subs)
    }

    async fn get_stream(&self, broadcaster_user_id: &str) -> eyre::Result<Option<StreamInfo>> {
        let token = self.app_token().await?;
        let url = Url::parse_with_params(
            TWITCH_HELIX_STREAMS_URL,
            &[("user_id", broadcaster_user_id)],
        )
        .wrap_err("Failed to build Twitch get-streams URL")?;
        let resp = self
            .http
            .get(url)
            .header("Client-Id", &self.client_id)
            .bearer_auth(&token)
            .send()
            .await
            .wrap_err("Failed to get Twitch stream")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(eyre!("Twitch get-streams failed ({status}): {text}"));
        }
        let streams: HelixStreamsResponse = resp
            .json()
            .await
            .wrap_err("Failed to parse Twitch streams response")?;
        Ok(streams.data.into_iter().next())
    }

    /// Ensures the online+offline subscriptions exist for a broadcaster, returning the ids that were
    /// successfully created. Best-effort: failures are logged and boot reconciliation is the safety
    /// net, so a transient error here doesn't fail the user's link.
    async fn ensure_subscriptions(&self, broadcaster_user_id: &str) -> Vec<String> {
        let mut ids = Vec::new();
        for sub_type in [SUB_TYPE_STREAM_ONLINE, SUB_TYPE_STREAM_OFFLINE] {
            match self
                .create_subscription(sub_type, broadcaster_user_id)
                .await
            {
                Ok(id) => ids.push(id),
                Err(e) => {
                    error!(
                        "Failed to create Twitch {sub_type} sub for {broadcaster_user_id}: {e:?}"
                    )
                }
            }
        }
        ids
    }

    /// Best-effort deletion of a set of subscription ids (used on unlink and reconciliation).
    async fn delete_subscriptions(&self, ids: &[String]) {
        for id in ids {
            if let Err(e) = self.delete_subscription(id).await {
                warn!("Failed to delete Twitch EventSub subscription {id}: {e:?}");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Twitch API response types
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct TwitchTokenResponse {
    access_token: String,
    expires_in: Option<u64>,
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

#[derive(Deserialize)]
struct EventSubListResponse {
    data: Vec<EventSubSubscription>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct Pagination {
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct EventSubSubscription {
    id: String,
    #[serde(rename = "type")]
    sub_type: String,
    status: String,
    condition: EventSubCondition,
    transport: EventSubTransport,
}

#[derive(Deserialize)]
struct EventSubCondition {
    #[serde(default)]
    broadcaster_user_id: Option<String>,
}

#[derive(Deserialize)]
struct EventSubTransport {
    #[serde(default)]
    callback: Option<String>,
}

#[derive(Deserialize)]
struct HelixStreamsResponse {
    data: Vec<StreamInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamInfo {
    user_login: String,
    user_name: String,
    game_id: String,
    game_name: String,
    title: String,
    viewer_count: i64,
    started_at: DateTime<Utc>,
    thumbnail_url: String,
}

// ---------------------------------------------------------------------------------------------
// Persistent connection (DB) + live state (Redis)
// ---------------------------------------------------------------------------------------------

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
    /// The EventSub subscription ids we created for this broadcaster (internal bookkeeping).
    #[graphql(skip)]
    pub eventsub_subscription_ids: Vec<String>,
}

/// The ephemeral "currently live" summary stored in Redis for a linked streamer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStreamSummary {
    pub twitch_user_id: String,
    pub twitch_login: String,
    pub twitch_display_name: String,
    pub title: String,
    pub game_id: String,
    pub game_name: String,
    pub viewer_count: i64,
    pub started_at: DateTime<Utc>,
    pub thumbnail_url: String,
}

impl LiveStreamSummary {
    fn is_starcraft(&self) -> bool {
        STARCRAFT_CATEGORY_NAMES.contains(&self.game_name.to_lowercase().as_str())
    }
}

/// A ShieldBattery user who is currently live-streaming, for the home-page feed.
#[derive(SimpleObject)]
#[graphql(complex)]
pub struct LiveStream {
    #[graphql(skip)]
    pub user_id: SbUserId,
    /// The Twitch login name (used in `twitch.tv/<login>` URLs).
    pub twitch_login: String,
    /// The Twitch display name.
    pub twitch_display_name: String,
    /// The stream's title.
    pub title: String,
    /// The Twitch category/game being streamed.
    pub game_name: String,
    /// The stream's current viewer count.
    pub viewer_count: i32,
    /// When the stream started.
    pub started_at: DateTime<Utc>,
    /// A ready-to-use thumbnail URL at a fixed size.
    pub thumbnail_url: String,
}

#[ComplexObject]
impl LiveStream {
    /// The ShieldBattery user who is streaming.
    async fn user(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.user_id)
            .await
    }
}

impl LiveStream {
    fn from_summary(user_id: SbUserId, summary: LiveStreamSummary) -> Self {
        Self {
            user_id,
            twitch_login: summary.twitch_login,
            twitch_display_name: summary.twitch_display_name,
            title: summary.title,
            game_name: summary.game_name,
            viewer_count: summary.viewer_count.clamp(0, i64::from(i32::MAX)) as i32,
            started_at: summary.started_at,
            thumbnail_url: summary
                .thumbnail_url
                .replace("{width}", &STREAM_THUMBNAIL_WIDTH.to_string())
                .replace("{height}", &STREAM_THUMBNAIL_HEIGHT.to_string()),
        }
    }
}

/// Loads every currently-live streamer from Redis (unfiltered).
async fn load_live_streams(redis: &RedisPool) -> eyre::Result<Vec<(SbUserId, LiveStreamSummary)>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let entries: HashMap<i32, String> = conn
        .hgetall(LIVE_STREAMS_KEY)
        .await
        .wrap_err("Failed to load live streams")?;

    let mut streams = Vec::with_capacity(entries.len());
    for (user_id, json) in entries {
        match serde_json::from_str::<LiveStreamSummary>(&json) {
            Ok(summary) => streams.push((SbUserId(user_id), summary)),
            Err(e) => warn!("Failed to parse live stream for user {user_id}: {e:?}"),
        }
    }
    Ok(streams)
}

/// A public view of a user's linked Twitch channel, shown on their profile.
#[derive(SimpleObject, sqlx::FromRow)]
pub struct TwitchChannel {
    /// The Twitch login name (used in `twitch.tv/<login>` URLs).
    pub twitch_login: String,
    /// The Twitch display name.
    pub twitch_display_name: String,
}

/// Loads the public Twitch channel (login/display name) a user has linked, if any.
pub async fn load_public_channel(
    pool: &PgPool,
    user_id: SbUserId,
) -> eyre::Result<Option<TwitchChannel>> {
    sqlx::query_as!(
        TwitchChannel,
        r#"
            SELECT twitch_login, twitch_display_name
            FROM twitch_connections
            WHERE user_id = $1
        "#,
        user_id as _,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to load Twitch channel")
}

/// Loads a single user's current live stream (category-agnostic), if they are live right now.
pub async fn load_user_live_stream(
    redis: &RedisPool,
    user_id: SbUserId,
) -> eyre::Result<Option<LiveStream>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let json: Option<String> = conn
        .hget(LIVE_STREAMS_KEY, i32::from(user_id))
        .await
        .wrap_err("Failed to load live stream")?;
    match json {
        Some(json) => {
            let summary: LiveStreamSummary =
                serde_json::from_str(&json).wrap_err("Failed to parse live stream")?;
            Ok(Some(LiveStream::from_summary(user_id, summary)))
        }
        None => Ok(None),
    }
}

async fn load_connection(
    pool: &PgPool,
    user_id: SbUserId,
) -> eyre::Result<Option<TwitchConnection>> {
    sqlx::query_as!(
        TwitchConnection,
        r#"
            SELECT user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at,
                eventsub_subscription_ids
            FROM twitch_connections
            WHERE user_id = $1
        "#,
        user_id as _,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to load Twitch connection")
}

async fn load_connection_by_twitch_id(
    pool: &PgPool,
    twitch_user_id: &str,
) -> eyre::Result<Option<TwitchConnection>> {
    sqlx::query_as!(
        TwitchConnection,
        r#"
            SELECT user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at,
                eventsub_subscription_ids
            FROM twitch_connections
            WHERE twitch_user_id = $1
        "#,
        twitch_user_id,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to load Twitch connection by Twitch id")
}

async fn load_all_connections(pool: &PgPool) -> eyre::Result<Vec<TwitchConnection>> {
    sqlx::query_as!(
        TwitchConnection,
        r#"
            SELECT user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at,
                eventsub_subscription_ids
            FROM twitch_connections
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load Twitch connections")
}

/// Inserts or replaces the identity of a user's Twitch connection, resetting the tracked
/// subscription ids (the caller creates fresh subscriptions and records their ids separately).
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
                eventsub_subscription_ids = '{}',
                updated_at = now()
            RETURNING user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at,
                eventsub_subscription_ids
        "#,
        user_id as _,
        twitch_user_id,
        twitch_login,
        twitch_display_name,
    )
    .fetch_one(pool)
    .await
}

async fn update_subscription_ids(
    pool: &PgPool,
    user_id: SbUserId,
    ids: &[String],
) -> eyre::Result<()> {
    sqlx::query!(
        r#"UPDATE twitch_connections SET eventsub_subscription_ids = $2 WHERE user_id = $1"#,
        user_id as _,
        ids,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to update Twitch subscription ids")?;
    Ok(())
}

/// Deletes a user's connection, returning the EventSub subscription ids it had (so the caller can
/// delete those subscriptions on Twitch), or `None` if there was no connection.
async fn delete_connection(pool: &PgPool, user_id: SbUserId) -> eyre::Result<Option<Vec<String>>> {
    let row = sqlx::query!(
        r#"
            DELETE FROM twitch_connections
            WHERE user_id = $1
            RETURNING eventsub_subscription_ids
        "#,
        user_id as _,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to delete Twitch connection")?;
    Ok(row.map(|r| r.eventsub_subscription_ids))
}

async fn set_stream_live(
    redis: &RedisPool,
    user_id: SbUserId,
    summary: &LiveStreamSummary,
) -> eyre::Result<()> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let json = serde_json::to_string(summary).wrap_err("Failed to serialize live stream")?;
    conn.hset::<_, _, _, ()>(LIVE_STREAMS_KEY, i32::from(user_id), json)
        .await
        .wrap_err("Failed to store live stream")?;
    Ok(())
}

async fn set_stream_offline(redis: &RedisPool, user_id: SbUserId) -> eyre::Result<()> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    conn.hdel::<_, _, ()>(LIVE_STREAMS_KEY, i32::from(user_id))
        .await
        .wrap_err("Failed to clear live stream")?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------------------------

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

fn require_twitch_client<'a>(ctx: &'a Context<'_>) -> async_graphql::Result<&'a Arc<TwitchClient>> {
    ctx.data::<Option<Arc<TwitchClient>>>()?
        .as_ref()
        .ok_or_else(|| {
            graphql_error(
                "TWITCH_NOT_CONFIGURED",
                "Twitch integration is not configured",
            )
        })
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

    /// ShieldBattery users currently live-streaming StarCraft, ordered by viewer count (highest
    /// first).
    async fn live_streams(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<LiveStream>> {
        let mut streams: Vec<LiveStream> = load_live_streams(ctx.data::<RedisPool>()?)
            .await?
            .into_iter()
            .filter(|(_, summary)| summary.is_starcraft())
            .map(|(user_id, summary)| LiveStream::from_summary(user_id, summary))
            .collect();
        streams.sort_by_key(|s| std::cmp::Reverse(s.viewer_count));
        Ok(streams)
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
        let client = require_twitch_client(ctx)?;

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

        Ok(TwitchLinkStart {
            url: client.authorize_url(&state)?,
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
        let client = require_twitch_client(ctx)?;
        let pool = ctx.data::<PgPool>()?;

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

        let access_token = client.exchange_code(&code).await.map_err(|e| {
            error!("Twitch code exchange failed: {e:?}");
            graphql_error(
                "TWITCH_EXCHANGE_FAILED",
                "Failed to complete Twitch linking",
            )
        })?;
        let twitch_user = client
            .get_authenticated_user(&access_token)
            .await
            .map_err(|e| {
                error!("Twitch get-users failed: {e:?}");
                graphql_error(
                    "TWITCH_EXCHANGE_FAILED",
                    "Failed to complete Twitch linking",
                )
            })?;

        // If this user was already linked (possibly to a different Twitch account), tear down the
        // old subscriptions before recording the new identity.
        if let Some(existing) = load_connection(pool, user.id).await? {
            client
                .delete_subscriptions(&existing.eventsub_subscription_ids)
                .await;
        }

        let mut connection = match upsert_connection(
            pool,
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

        // Subscribe to stream online/offline events for the newly linked broadcaster.
        let sub_ids = client.ensure_subscriptions(&twitch_user.id).await;
        if let Err(e) = update_subscription_ids(pool, user.id, &sub_ids).await {
            error!("Failed to store Twitch subscription ids: {e:?}");
        }
        connection.eventsub_subscription_ids = sub_ids;

        Ok(connection)
    }

    /// Removes the current user's Twitch connection. Returns whether a connection was removed.
    async fn twitch_unlink(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        let user = require_current_user(ctx)?;
        let pool = ctx.data::<PgPool>()?;

        let Some(sub_ids) = delete_connection(pool, user.id).await? else {
            return Ok(false);
        };

        if let Some(client) = ctx.data::<Option<Arc<TwitchClient>>>()?.as_ref() {
            client.delete_subscriptions(&sub_ids).await;
        }
        if let Err(e) = set_stream_offline(ctx.data::<RedisPool>()?, user.id).await {
            error!("Failed to clear live stream on unlink: {e:?}");
        }

        Ok(true)
    }
}

// ---------------------------------------------------------------------------------------------
// EventSub webhook
// ---------------------------------------------------------------------------------------------

pub fn create_twitch_api() -> Router<AppState> {
    Router::new().route("/eventsub", post(eventsub_callback))
}

#[derive(Deserialize)]
struct WebhookChallenge {
    challenge: String,
}

#[derive(Deserialize)]
struct EventSubNotification {
    subscription: EventSubNotificationSubscription,
    event: EventSubNotificationEvent,
}

#[derive(Deserialize)]
struct EventSubNotificationSubscription {
    #[serde(rename = "type")]
    sub_type: String,
}

#[derive(Deserialize)]
struct EventSubNotificationEvent {
    broadcaster_user_id: String,
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// Verifies the HMAC-SHA256 signature Twitch attaches to every EventSub message. The signed message
/// is the concatenation of the message id, the timestamp, and the raw request body.
fn verify_signature(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    body: &[u8],
    signature: &str,
) -> bool {
    let Some(hex_sig) = signature.strip_prefix("sha256=") else {
        return false;
    };
    let Ok(expected) = data_encoding::HEXLOWER_PERMISSIVE.decode(hex_sig.as_bytes()) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(message_id.as_bytes());
    mac.update(timestamp.as_bytes());
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
}

/// Records that we've processed `message_id`, returning whether it was already seen (i.e. this is a
/// Twitch redelivery we should drop).
async fn already_processed(redis: &RedisPool, message_id: &str) -> eyre::Result<bool> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let opts = SetOptions::default()
        .conditional_set(ExistenceCheck::NX)
        .with_expiration(SetExpiry::EX(WEBHOOK_DEDUPE_TTL_SECONDS));
    let set: Option<String> = conn
        .set_options(webhook_dedupe_key(message_id), 1, opts)
        .await
        .wrap_err("Failed to record EventSub message id")?;
    // `None` means the key already existed, so NX declined to set it -> already processed.
    Ok(set.is_none())
}

async fn handle_notification(
    client: &TwitchClient,
    db: &PgPool,
    redis: &RedisPool,
    body: &[u8],
) -> eyre::Result<()> {
    let notification: EventSubNotification =
        serde_json::from_slice(body).wrap_err("Failed to parse EventSub notification")?;
    let broadcaster_id = notification.event.broadcaster_user_id;

    let Some(connection) = load_connection_by_twitch_id(db, &broadcaster_id).await? else {
        // No linked SB user for this broadcaster (e.g. just unlinked) -- nothing to track.
        return Ok(());
    };

    match notification.subscription.sub_type.as_str() {
        SUB_TYPE_STREAM_ONLINE => match client.get_stream(&broadcaster_id).await? {
            Some(stream) => {
                let summary = LiveStreamSummary {
                    twitch_user_id: connection.twitch_user_id,
                    twitch_login: stream.user_login,
                    twitch_display_name: stream.user_name,
                    title: stream.title,
                    game_id: stream.game_id,
                    game_name: stream.game_name,
                    viewer_count: stream.viewer_count,
                    started_at: stream.started_at,
                    thumbnail_url: stream.thumbnail_url,
                };
                set_stream_live(redis, connection.user_id, &summary).await?;
            }
            None => {
                // The stream ended between the event and our lookup, or isn't visible -- make sure
                // we don't show them as live.
                set_stream_offline(redis, connection.user_id).await?;
            }
        },
        SUB_TYPE_STREAM_OFFLINE => {
            set_stream_offline(redis, connection.user_id).await?;
        }
        other => warn!("Unexpected Twitch EventSub notification type: {other}"),
    }

    Ok(())
}

async fn eventsub_callback(
    State(twitch): State<Option<Arc<TwitchClient>>>,
    State(db): State<PgPool>,
    State(redis): State<RedisPool>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(client) = twitch else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };

    let (Some(message_id), Some(timestamp), Some(signature)) = (
        header_str(&headers, "twitch-eventsub-message-id"),
        header_str(&headers, "twitch-eventsub-message-timestamp"),
        header_str(&headers, "twitch-eventsub-message-signature"),
    ) else {
        return (StatusCode::BAD_REQUEST, "Missing EventSub headers").into_response();
    };

    if !verify_signature(
        client.eventsub_secret(),
        message_id,
        timestamp,
        &body,
        signature,
    ) {
        warn!("Twitch EventSub signature verification failed");
        return (StatusCode::FORBIDDEN, "Invalid signature").into_response();
    }

    // Replay protection: reject messages whose timestamp is too far from now.
    match DateTime::parse_from_rfc3339(timestamp) {
        Ok(ts) => {
            if (Utc::now() - ts.with_timezone(&Utc)).num_seconds().abs() > WEBHOOK_MAX_AGE_SECONDS {
                warn!("Rejecting stale Twitch EventSub message");
                return (StatusCode::FORBIDDEN, "Stale message").into_response();
            }
        }
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid timestamp").into_response(),
    }

    match header_str(&headers, "twitch-eventsub-message-type").unwrap_or_default() {
        "webhook_callback_verification" => {
            match serde_json::from_slice::<WebhookChallenge>(&body) {
                Ok(challenge) => (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "text/plain")],
                    challenge.challenge,
                )
                    .into_response(),
                Err(e) => {
                    error!("Failed to parse EventSub challenge: {e:?}");
                    (StatusCode::BAD_REQUEST, "Invalid challenge").into_response()
                }
            }
        }
        "notification" => {
            match already_processed(&redis, message_id).await {
                Ok(true) => return StatusCode::NO_CONTENT.into_response(),
                Ok(false) => {}
                Err(e) => error!("EventSub dedupe check failed: {e:?}"),
            }
            if let Err(e) = handle_notification(&client, &db, &redis, &body).await {
                // Ack anyway (2xx): repeated non-2xx responses make Twitch revoke the subscription,
                // and the error is already logged for us to investigate.
                error!("Failed to handle Twitch EventSub notification: {e:?}");
            }
            StatusCode::NO_CONTENT.into_response()
        }
        "revocation" => {
            warn!("Twitch EventSub subscription was revoked; reconciliation will recreate it");
            StatusCode::NO_CONTENT.into_response()
        }
        other => {
            warn!("Unknown Twitch EventSub message type: {other}");
            StatusCode::NO_CONTENT.into_response()
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Boot reconciliation
// ---------------------------------------------------------------------------------------------

/// Reconciles our EventSub subscriptions with Twitch on startup: recreates any that Twitch dropped
/// or that failed verification, and deletes orphans left over from unlinks that happened while we
/// were down. Logs and swallows errors -- this is best-effort maintenance.
pub async fn reconcile_subscriptions(client: Arc<TwitchClient>, db: PgPool) {
    tokio::time::sleep(RECONCILE_STARTUP_DELAY).await;
    if let Err(e) = try_reconcile_subscriptions(&client, &db).await {
        error!("Twitch EventSub reconciliation failed: {e:?}");
    }
}

async fn try_reconcile_subscriptions(client: &TwitchClient, db: &PgPool) -> eyre::Result<()> {
    let connections = load_all_connections(db).await?;
    let existing_subs = client.list_subscriptions().await?;

    // Group the subscriptions that point at *our* callback by broadcaster (a shared Twitch app can
    // have subscriptions for other environments, which we must not touch).
    let mut by_broadcaster: HashMap<&str, Vec<&EventSubSubscription>> = HashMap::new();
    for sub in &existing_subs {
        if sub.transport.callback.as_deref() != Some(client.eventsub_callback_url()) {
            continue;
        }
        if let Some(bid) = &sub.condition.broadcaster_user_id {
            by_broadcaster.entry(bid.as_str()).or_default().push(sub);
        }
    }

    let linked: HashSet<&str> = connections
        .iter()
        .map(|c| c.twitch_user_id.as_str())
        .collect();

    // Delete orphaned subscriptions (ours, but no longer linked to any SB user).
    for (bid, subs) in &by_broadcaster {
        if !linked.contains(bid) {
            for sub in subs {
                if let Err(e) = client.delete_subscription(&sub.id).await {
                    warn!(
                        "Failed to delete orphaned Twitch subscription {}: {e:?}",
                        sub.id
                    );
                }
            }
        }
    }

    // Ensure each linked broadcaster has a healthy online+offline subscription, recreating any that
    // are missing or in a bad state, then persist the resulting ids.
    for conn in &connections {
        let mut healthy_ids = Vec::new();
        let mut present: HashSet<&str> = HashSet::new();
        if let Some(subs) = by_broadcaster.get(conn.twitch_user_id.as_str()) {
            for sub in subs {
                let healthy = matches!(
                    sub.status.as_str(),
                    "enabled" | "webhook_callback_verification_pending"
                ) && (sub.sub_type == SUB_TYPE_STREAM_ONLINE
                    || sub.sub_type == SUB_TYPE_STREAM_OFFLINE);
                if healthy && present.insert(sub.sub_type.as_str()) {
                    healthy_ids.push(sub.id.clone());
                } else {
                    // Unhealthy, duplicate, or unrelated -- remove it.
                    if let Err(e) = client.delete_subscription(&sub.id).await {
                        warn!(
                            "Failed to delete stale Twitch subscription {}: {e:?}",
                            sub.id
                        );
                    }
                }
            }
        }

        for sub_type in [SUB_TYPE_STREAM_ONLINE, SUB_TYPE_STREAM_OFFLINE] {
            if !present.contains(sub_type) {
                match client
                    .create_subscription(sub_type, &conn.twitch_user_id)
                    .await
                {
                    Ok(id) => healthy_ids.push(id),
                    Err(e) => error!(
                        "Failed to recreate Twitch {sub_type} sub for {}: {e:?}",
                        conn.twitch_user_id
                    ),
                }
            }
        }

        if healthy_ids != conn.eventsub_subscription_ids
            && let Err(e) = update_subscription_ids(db, conn.user_id, &healthy_ids).await
        {
            error!("Failed to persist reconciled Twitch subscription ids: {e:?}");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_signature_accepts_a_valid_signature() {
        // Reference vector computed independently with HMAC-SHA256 over id+timestamp+body.
        let secret = "shieldbattery-test-secret";
        let message_id = "abc-123";
        let timestamp = "2026-07-05T00:00:00Z";
        let body = br#"{"challenge":"pogchamp"}"#;

        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(message_id.as_bytes());
        mac.update(timestamp.as_bytes());
        mac.update(body);
        let signature = format!(
            "sha256={}",
            data_encoding::HEXLOWER.encode(&mac.finalize().into_bytes())
        );

        assert!(verify_signature(
            secret, message_id, timestamp, body, &signature
        ));
    }

    #[test]
    fn verify_signature_rejects_tampering_and_bad_input() {
        let secret = "shieldbattery-test-secret";
        let message_id = "abc-123";
        let timestamp = "2026-07-05T00:00:00Z";
        let body = br#"{"challenge":"pogchamp"}"#;

        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(message_id.as_bytes());
        mac.update(timestamp.as_bytes());
        mac.update(body);
        let signature = format!(
            "sha256={}",
            data_encoding::HEXLOWER.encode(&mac.finalize().into_bytes())
        );

        // Wrong secret.
        assert!(!verify_signature(
            "other-secret",
            message_id,
            timestamp,
            body,
            &signature
        ));
        // Tampered body.
        assert!(!verify_signature(
            secret, message_id, timestamp, b"{}", &signature
        ));
        // Missing prefix / malformed signature.
        assert!(!verify_signature(
            secret, message_id, timestamp, body, "deadbeef"
        ));
        assert!(!verify_signature(
            secret,
            message_id,
            timestamp,
            body,
            "sha256=nothex"
        ));
    }
}
