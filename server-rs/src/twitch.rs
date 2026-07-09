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

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::futures_util::TryStreamExt;
use async_graphql::{ComplexObject, Context, Object, SchemaBuilder, SimpleObject};
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
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::state::AppState;
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader};

const TWITCH_OAUTH_AUTHORIZE_URL: &str = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_OAUTH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_USERS_URL: &str = "https://api.twitch.tv/helix/users";
const TWITCH_HELIX_STREAMS_URL: &str = "https://api.twitch.tv/helix/streams";
const TWITCH_HELIX_EVENTSUB_URL: &str = "https://api.twitch.tv/helix/eventsub/subscriptions";

/// The fixed loopback redirect URI used by the desktop app's OAuth flow. Unlike the web flow (which
/// redirects to `<canonical host>/twitch/callback`), the desktop app opens the authorize URL in the
/// user's real browser and captures the redirect with a temporary loopback HTTP server, so their
/// existing Twitch login is reused. Twitch requires an exact, port-inclusive redirect_uri match and
/// rejects bare IP literals, so this must be a single fixed `localhost` port registered as a second
/// redirect URI in the Twitch console. The desktop app parses this port out of the authorize URL and
/// binds its loopback server on it -- see `runTwitchOauthFlow` in `app/app.ts`.
const DESKTOP_REDIRECT_URI: &str = "http://localhost:27193/twitch/callback";

const SUB_TYPE_STREAM_ONLINE: &str = "stream.online";
const SUB_TYPE_STREAM_OFFLINE: &str = "stream.offline";

/// Twitch category (game) ids we treat as StarCraft: Brood War for the home-page live-streams feed,
/// matched against a stream's category id. Twitch's category ids are stable, so we match on id
/// rather than the display name (which varies with capitalization/localization). Covers the three
/// non-SC2 StarCraft categories a Remastered stream can be tagged with:
/// - `11989`      StarCraft
/// - `4967`       StarCraft: Brood War
/// - `1664649323` StarCraft: Remastered
const STARCRAFT_CATEGORY_IDS: &[&str] = &["11989", "4967", "1664649323"];

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
/// How often the periodic refresh re-checks currently-live streamers against Twitch (refreshing
/// their stats and clearing anyone who is no longer live).
const LIVE_REFRESH_INTERVAL: Duration = Duration::from_secs(120);
/// How many times we poll Twitch's Get Streams after a `stream.online` event before concluding the
/// broadcaster isn't really live. Twitch's Get Streams endpoint routinely lags the `stream.online`
/// notification by a few seconds, so a single `None` result would otherwise drop a stream that is
/// really coming online -- and the periodic refresh only re-checks users already marked live, so it
/// wouldn't recover it until the next transition.
const STREAM_ONLINE_LOOKUP_ATTEMPTS: u32 = 4;
/// Delay between the Get Streams polls counted by `STREAM_ONLINE_LOOKUP_ATTEMPTS`.
const STREAM_ONLINE_LOOKUP_RETRY_DELAY: Duration = Duration::from_secs(2);

type HmacSha256 = Hmac<Sha256>;

fn link_state_key(state: &str) -> String {
    format!("twitch:link_state:{state}")
}

/// What we stash in Redis for a pending link `state`: the user who started the flow, plus the
/// redirect URI baked into their authorize URL. The redirect URI differs between the web and desktop
/// flows and must be replayed verbatim in the token exchange, so we remember which one was used.
#[derive(Debug, Serialize, Deserialize)]
struct PendingLink {
    user_id: i32,
    redirect_uri: String,
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
    /// The redirect URI for the web linking flow (`<canonical host>/twitch/callback`). The desktop
    /// flow uses the fixed `DESKTOP_REDIRECT_URI` instead; see `redirect_uri_for`.
    web_redirect_uri: String,
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
            web_redirect_uri: format!("{host}/twitch/callback"),
            app_token: RwLock::new(None),
        }))
    }

    fn eventsub_secret(&self) -> &str {
        self.eventsub_secret.expose_secret()
    }

    fn eventsub_callback_url(&self) -> &str {
        &self.eventsub_callback_url
    }

    /// The redirect URI to use for a link attempt, depending on whether it originates from the
    /// desktop app (a fixed loopback URI) or the web (our canonical callback).
    fn redirect_uri_for(&self, desktop: bool) -> &str {
        if desktop {
            DESKTOP_REDIRECT_URI
        } else {
            &self.web_redirect_uri
        }
    }

    /// Builds the Twitch OAuth authorize URL for a link attempt with the given `state`. `redirect_uri`
    /// must be reused verbatim in `exchange_code` (Twitch requires the two to match).
    fn authorize_url(&self, state: &str, redirect_uri: &str) -> eyre::Result<String> {
        let url = Url::parse_with_params(
            TWITCH_OAUTH_AUTHORIZE_URL,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", redirect_uri),
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

    /// Exchanges an authorization `code` for a user access token. `redirect_uri` must match the one
    /// used to obtain the code (i.e. the one baked into the authorize URL).
    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> eyre::Result<String> {
        let resp = self
            .http
            .post(TWITCH_OAUTH_TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.expose_secret()),
                ("code", code),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
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
        let ids = [broadcaster_user_id.to_string()];
        Ok(self.get_streams(&ids).await?.into_iter().next())
    }

    /// Fetches the live streams for a set of broadcasters (offline ones are simply absent from the
    /// result). Batched into Twitch's 100-ids-per-request limit.
    async fn get_streams(&self, broadcaster_user_ids: &[String]) -> eyre::Result<Vec<StreamInfo>> {
        if broadcaster_user_ids.is_empty() {
            return Ok(Vec::new());
        }
        let token = self.app_token().await?;
        let mut streams = Vec::new();
        for chunk in broadcaster_user_ids.chunks(100) {
            let params: Vec<(&str, &str)> =
                chunk.iter().map(|id| ("user_id", id.as_str())).collect();
            let url = Url::parse_with_params(TWITCH_HELIX_STREAMS_URL, &params)
                .wrap_err("Failed to build Twitch get-streams URL")?;
            let resp = self
                .http
                .get(url)
                .header("Client-Id", &self.client_id)
                .bearer_auth(&token)
                .send()
                .await
                .wrap_err("Failed to get Twitch streams")?;
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(eyre!("Twitch get-streams failed ({status}): {text}"));
            }
            let page: HelixStreamsResponse = resp
                .json()
                .await
                .wrap_err("Failed to parse Twitch streams response")?;
            streams.extend(page.data);
        }
        Ok(streams)
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
    user_id: String,
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
    fn from_stream(stream: StreamInfo) -> Self {
        Self {
            twitch_user_id: stream.user_id,
            twitch_login: stream.user_login,
            twitch_display_name: stream.user_name,
            title: stream.title,
            game_id: stream.game_id,
            game_name: stream.game_name,
            viewer_count: stream.viewer_count,
            started_at: stream.started_at,
            thumbnail_url: stream.thumbnail_url,
        }
    }

    fn is_starcraft(&self) -> bool {
        STARCRAFT_CATEGORY_IDS.contains(&self.game_id.as_str())
    }
}

/// A ShieldBattery user who is currently live-streaming, for the home-page feed.
#[derive(Clone, SimpleObject)]
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
#[derive(Clone, SimpleObject, sqlx::FromRow)]
pub struct TwitchChannel {
    /// The Twitch login name (used in `twitch.tv/<login>` URLs).
    pub twitch_login: String,
    /// The Twitch display name.
    pub twitch_display_name: String,
}

/// Batches per-user Twitch channel lookups so that selecting `twitchChannel` on a list of users
/// doesn't fan out into one DB query each.
pub struct TwitchChannelLoader {
    db: PgPool,
}

impl TwitchChannelLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbUserId> for TwitchChannelLoader {
    type Value = TwitchChannel;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, Self::Value>, Self::Error> {
        Ok(sqlx::query!(
            r#"
                SELECT user_id as "user_id: SbUserId", twitch_login, twitch_display_name
                FROM twitch_connections
                WHERE user_id = ANY($1)
            "#,
            keys as _,
        )
        .fetch(&self.db)
        .map_ok(|r| {
            (
                r.user_id,
                TwitchChannel {
                    twitch_login: r.twitch_login,
                    twitch_display_name: r.twitch_display_name,
                },
            )
        })
        .try_collect()
        .await?)
    }
}

/// Batches per-user live-stream lookups (a single Redis `HMGET`) so that selecting `liveStream` on a
/// list of users doesn't fan out into one Redis call each. Category-agnostic (any live stream).
pub struct LiveStreamLoader {
    redis: RedisPool,
}

impl LiveStreamLoader {
    pub fn new(redis: RedisPool) -> Self {
        Self { redis }
    }
}

impl Loader<SbUserId> for LiveStreamLoader {
    type Value = LiveStream;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, Self::Value>, Self::Error> {
        // The live set (currently-live streamers only) is small, so one HGETALL + filter is cheaper
        // and simpler than an HMGET, and reuses the same parsing.
        let requested: HashSet<SbUserId> = keys.iter().copied().collect();
        let live = load_live_streams(&self.redis)
            .await
            .map_err(|e| graphql_error("INTERNAL_SERVER_ERROR", e.to_string()))?;

        Ok(live
            .into_iter()
            .filter(|(user_id, _)| requested.contains(user_id))
            .map(|(user_id, summary)| (user_id, LiveStream::from_summary(user_id, summary)))
            .collect())
    }
}

pub struct TwitchModule {
    db_pool: PgPool,
    redis_pool: RedisPool,
}

impl TwitchModule {
    pub fn new(db_pool: PgPool, redis_pool: RedisPool) -> Self {
        Self {
            db_pool,
            redis_pool,
        }
    }
}

impl SchemaBuilderModule for TwitchModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder
            .data(DataLoader::new(
                TwitchChannelLoader::new(self.db_pool.clone()),
                tokio::spawn,
            ))
            .data(DataLoader::new(
                LiveStreamLoader::new(self.redis_pool.clone()),
                tokio::spawn,
            ))
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

/// Inserts or replaces the identity of a user's Twitch connection. The tracked subscription ids are
/// left untouched (the caller reconciles subscriptions and records their ids separately, only when
/// the linked account actually changes).
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
    /// `code` and `state`. `desktop` selects the loopback redirect URI used by the desktop app
    /// instead of our web callback.
    async fn twitch_start_link(
        &self,
        ctx: &Context<'_>,
        #[graphql(default)] desktop: bool,
    ) -> async_graphql::Result<TwitchLinkStart> {
        let user = require_current_user(ctx)?;
        let client = require_twitch_client(ctx)?;
        let redirect_uri = client.redirect_uri_for(desktop);

        // A server-issued, single-use `state` bound to this user, stored in Redis. Completing the
        // link requires both this state (proving the flow started here) and the same user's auth
        // token, which together prevent an attacker from linking their Twitch account to a victim.
        let state = Uuid::new_v4().to_string();
        let pending = serde_json::to_string(&PendingLink {
            user_id: i32::from(user.id),
            redirect_uri: redirect_uri.to_string(),
        })
        .wrap_err("Failed to serialize pending Twitch link")?;
        let mut redis = ctx
            .data::<RedisPool>()?
            .get()
            .await
            .wrap_err("Could not connect to Redis")?;
        redis
            .set_ex::<_, _, ()>(link_state_key(&state), pending, LINK_STATE_TTL_SECONDS)
            .await
            .wrap_err("Failed to store Twitch link state")?;

        Ok(TwitchLinkStart {
            url: client.authorize_url(&state, redirect_uri)?,
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
        let stored: Option<String> = redis
            .get(&key)
            .await
            .wrap_err("Failed to read Twitch link state")?;
        let _: () = redis
            .del(&key)
            .await
            .wrap_err("Failed to clear Twitch link state")?;

        let pending = stored
            .and_then(|s| serde_json::from_str::<PendingLink>(&s).ok())
            .filter(|p| p.user_id == i32::from(user.id));
        let Some(pending) = pending else {
            return Err(graphql_error(
                "TWITCH_INVALID_STATE",
                "Your Twitch linking request was invalid or expired. Please try again.",
            ));
        };

        let access_token = client
            .exchange_code(&code, &pending.redirect_uri)
            .await
            .map_err(|e| {
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

        // Capture any existing connection up front so we can tell whether this is a re-link. We do
        // NOT tear down its subscriptions yet: the upsert below can still fail (e.g. the target
        // account is already linked to someone else), and that must not leave the user with their
        // current account's subscriptions deleted.
        let existing = load_connection(pool, user.id).await?;

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

        // Only reconcile subscriptions when the linked Twitch account actually changed (or this is a
        // brand-new link) -- re-linking the same account keeps its existing subscriptions untouched.
        let account_changed = existing
            .as_ref()
            .map(|existing| existing.twitch_user_id != twitch_user.id)
            .unwrap_or(true);
        if account_changed {
            if let Some(existing) = &existing {
                client
                    .delete_subscriptions(&existing.eventsub_subscription_ids)
                    .await;
            }
            let sub_ids = client.ensure_subscriptions(&twitch_user.id).await;
            if let Err(e) = update_subscription_ids(pool, user.id, &sub_ids).await {
                error!("Failed to store Twitch subscription ids: {e:?}");
            }
            connection.eventsub_subscription_ids = sub_ids;
        }

        // Reflect the broadcaster's current live status immediately: this clears any stale entry
        // left over from a previous link and surfaces users who linked while already streaming
        // (EventSub only fires on transitions, so it wouldn't otherwise notice an in-progress
        // stream).
        if let Err(e) =
            refresh_stream_state(client, ctx.data::<RedisPool>()?, user.id, &twitch_user.id).await
        {
            error!("Failed to refresh Twitch live state on link: {e:?}");
        }

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

/// Atomically claims `message_id`, returning whether it was already claimed (i.e. this is a Twitch
/// redelivery we should drop). The claim is released via `release_message` if handling fails, so a
/// transient error doesn't permanently suppress redelivery of that message.
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

/// Releases a dedupe claim so Twitch's redelivery of the same message can be processed again (used
/// when handling failed).
async fn release_message(redis: &RedisPool, message_id: &str) -> eyre::Result<()> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    conn.del::<_, ()>(webhook_dedupe_key(message_id))
        .await
        .wrap_err("Failed to release EventSub dedupe claim")?;
    Ok(())
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
        // Look up the actual stream (rather than trusting the event) so we store a full, current
        // summary. Twitch's Get Streams can briefly lag the online event, so this retries a not-live
        // result before giving up instead of clearing the stream outright.
        SUB_TYPE_STREAM_ONLINE => {
            handle_stream_online(client, redis, connection.user_id, &broadcaster_id).await?
        }
        SUB_TYPE_STREAM_OFFLINE => {
            set_stream_offline(redis, connection.user_id).await?;
        }
        other => warn!("Unexpected Twitch EventSub notification type: {other}"),
    }

    Ok(())
}

/// Handles a `stream.online` event by resolving the broadcaster's full stream summary and storing it.
/// Twitch's Get Streams endpoint can lag the event by a few seconds, so a not-live (`None`) result is
/// retried a few times before we conclude the stream really isn't live -- otherwise a streamer who
/// just went live could be dropped until their next transition. A hard error propagates so the caller
/// can have Twitch redeliver the event.
async fn handle_stream_online(
    client: &TwitchClient,
    redis: &RedisPool,
    sb_user_id: SbUserId,
    broadcaster_id: &str,
) -> eyre::Result<()> {
    for attempt in 1..=STREAM_ONLINE_LOOKUP_ATTEMPTS {
        if let Some(stream) = client.get_stream(broadcaster_id).await? {
            return set_stream_live(redis, sb_user_id, &LiveStreamSummary::from_stream(stream))
                .await;
        }
        if attempt < STREAM_ONLINE_LOOKUP_ATTEMPTS {
            tokio::time::sleep(STREAM_ONLINE_LOOKUP_RETRY_DELAY).await;
        }
    }
    // Still not live after riding out the Get Streams lag -- treat as genuinely offline (e.g. a
    // stream that ended almost immediately); the next transition or periodic refresh will correct it.
    set_stream_offline(redis, sb_user_id).await
}

/// Reconciles a single user's Redis live state with their actual current Twitch status: stores a
/// fresh summary if they're live, or clears the entry if they're not. Used when an account is
/// (re)linked, to immediately reflect an in-progress stream or clear a stale entry from a prior link.
async fn refresh_stream_state(
    client: &TwitchClient,
    redis: &RedisPool,
    sb_user_id: SbUserId,
    broadcaster_id: &str,
) -> eyre::Result<()> {
    match client.get_stream(broadcaster_id).await? {
        Some(stream) => {
            set_stream_live(redis, sb_user_id, &LiveStreamSummary::from_stream(stream)).await
        }
        None => set_stream_offline(redis, sb_user_id).await,
    }
}

/// Periodically reconciles the `twitch:live` Redis hash with Twitch: refreshes viewer counts/titles
/// for streamers still live and, crucially, clears entries for anyone who is no longer live (a
/// safety net for a missed `stream.offline` event, which would otherwise pin them "live" forever).
pub async fn refresh_live_streams_loop(client: Arc<TwitchClient>, redis: RedisPool) {
    let mut interval = tokio::time::interval(LIVE_REFRESH_INTERVAL);
    loop {
        interval.tick().await;
        if let Err(e) = refresh_all_live_streams(&client, &redis).await {
            error!("Twitch live-stream refresh failed: {e:?}");
        }
    }
}

async fn refresh_all_live_streams(client: &TwitchClient, redis: &RedisPool) -> eyre::Result<()> {
    let live = load_live_streams(redis).await?;
    if live.is_empty() {
        return Ok(());
    }

    // broadcaster_user_id -> our SB user id, for everyone we currently believe is live.
    let by_broadcaster: HashMap<String, SbUserId> = live
        .into_iter()
        .map(|(user_id, summary)| (summary.twitch_user_id, user_id))
        .collect();
    let broadcaster_ids: Vec<String> = by_broadcaster.keys().cloned().collect();

    let live_now: HashMap<String, StreamInfo> = client
        .get_streams(&broadcaster_ids)
        .await?
        .into_iter()
        .map(|stream| (stream.user_id.clone(), stream))
        .collect();

    for (broadcaster_id, sb_user_id) in by_broadcaster {
        match live_now.get(&broadcaster_id) {
            Some(stream) => {
                set_stream_live(
                    redis,
                    sb_user_id,
                    &LiveStreamSummary::from_stream(stream.clone()),
                )
                .await?;
            }
            None => set_stream_offline(redis, sb_user_id).await?,
        }
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
            match handle_notification(&client, &db, &redis, &body).await {
                Ok(()) => StatusCode::NO_CONTENT.into_response(),
                Err(e) => {
                    error!("Failed to handle Twitch EventSub notification: {e:?}");
                    // Release the claim and return non-2xx so Twitch redelivers. Otherwise a
                    // transient failure (a Redis blip, a get_stream error) would drop this event
                    // permanently: the dedupe entry would block redelivery, and the periodic
                    // refresh only re-checks users already marked live, so a lost stream.online
                    // would never recover until the next transition or re-link.
                    if let Err(e) = release_message(&redis, message_id).await {
                        error!("Failed to release EventSub dedupe claim: {e:?}");
                    }
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
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
