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
use deadpool_redis::redis::{
    AsyncCommands, Cmd, ExistenceCheck, RedisResult, SetExpiry, SetOptions, aio::ConnectionLike,
};
use hmac::{Hmac, KeyInit, Mac};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use tokio::sync::{Notify, RwLock};
use tracing::{error, warn};
use url::Url;
use uuid::Uuid;

use crate::configuration::Settings;
use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::state::AppState;
use crate::users::permissions::RequiredPermission;
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
/// rather than the display name (which varies with capitalization/localization):
/// - `11989`      StarCraft
/// - `1664649323` StarCraft: Remastered
const STARCRAFT_CATEGORY_IDS: &[&str] = &["11989", "1664649323"];

/// The thumbnail size we substitute into Twitch's `{width}x{height}` template for feed entries.
const STREAM_THUMBNAIL_WIDTH: u32 = 320;
const STREAM_THUMBNAIL_HEIGHT: u32 = 180;

/// How long a pending link request (the server-issued `state`) stays valid. Long enough for a user
/// to complete the Twitch consent screen, short enough to bound abuse of a leaked state value.
const LINK_STATE_TTL_SECONDS: u64 = 600;
/// Redis hash of `sbUserId -> LiveStreamSummary` for every currently-live linked streamer.
const LIVE_STREAMS_KEY: &str = "twitch:live";
/// Atomically removes malformed hash values only if they have not changed since they were read. A
/// concurrent refresh may replace a malformed value with a valid summary between the read and this
/// cleanup, in which case the replacement must be retained.
const REMOVE_MALFORMED_LIVE_STREAMS_SCRIPT: &str = r#"
local removed = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    removed = removed + redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return removed
"#;
/// How long we remember a processed EventSub message id to drop Twitch's redeliveries.
const WEBHOOK_DEDUPE_TTL_SECONDS: u64 = 600;
/// Reject EventSub messages whose timestamp is further than this from now (replay protection).
const WEBHOOK_MAX_AGE_SECONDS: i64 = 600;
/// Delay before boot reconciliation runs, giving the HTTP server time to bind so that the
/// verification callbacks for any (re)created subscriptions can succeed.
const RECONCILE_STARTUP_DELAY: Duration = Duration::from_secs(5);
/// How often subscriptions are reconciled with Twitch after the boot pass. Revocations we receive
/// kick a reconcile immediately; this backstop catches ones we never received (e.g. delivered
/// while the callback was unreachable) and any other subscription drift.
const SUBSCRIPTION_RECONCILE_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// How often the periodic refresh reconciles every linked broadcaster against Twitch (refreshing
/// stats for those live, clearing anyone no longer live, and picking up streams whose `stream.online`
/// event was lost).
const LIVE_REFRESH_INTERVAL: Duration = Duration::from_secs(120);
/// How many times we poll Twitch's Get Streams after a `stream.online` event before concluding the
/// broadcaster isn't really live. Twitch's Get Streams endpoint routinely lags the `stream.online`
/// notification by a few seconds, so a single `None` result would otherwise drop a stream that is
/// really coming online. These retries keep the common case fast; a stream dropped here would
/// otherwise stay invisible until the periodic refresh's next pass (up to `LIVE_REFRESH_INTERVAL`).
const STREAM_ONLINE_LOOKUP_ATTEMPTS: u32 = 4;
/// Delay between the Get Streams polls counted by `STREAM_ONLINE_LOOKUP_ATTEMPTS`.
const STREAM_ONLINE_LOOKUP_RETRY_DELAY: Duration = Duration::from_secs(2);
/// How long the `live_streams` feed-block set is cached in-process (see `FeedBlockCache`). The block
/// table changes rarely, so this keeps the frequently-polled feed query off Postgres while still
/// applying a new block within a short window.
const FEED_BLOCK_CACHE_TTL: Duration = Duration::from_secs(30);

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
    /// The URL Twitch delivers EventSub webhook notifications to (`<gql origin>/twitch/eventsub`).
    eventsub_callback_url: String,
    /// The redirect URI for the web linking flow (`<canonical host>/twitch/callback`). The desktop
    /// flow uses the fixed `DESKTOP_REDIRECT_URI` instead; see `redirect_uri_for`.
    web_redirect_uri: String,
    app_token: RwLock<Option<CachedAppToken>>,
    /// Signals the reconcile loop to run a pass now (e.g. when Twitch revokes a subscription).
    reconcile_kick: Notify,
}

impl TwitchClient {
    /// Builds a client from settings, returning `None` if Twitch isn't configured.
    pub fn from_settings(settings: &Settings) -> Option<Arc<Self>> {
        let twitch = settings.twitch.as_ref()?;
        let canonical_host = settings.canonical_host.trim_end_matches('/');
        // EventSub webhooks are delivered to this (GraphQL) server, which is served on a different
        // host than the main web server in production, so the callback must use our own public
        // origin rather than the canonical (web) host.
        let gql_origin = settings
            .gql_origin
            .as_deref()
            .expect("checked in get_configuration")
            .trim_end_matches('/');
        Some(Arc::new(Self {
            http: reqwest::Client::new(),
            client_id: twitch.client_id.clone(),
            client_secret: twitch.client_secret.clone(),
            eventsub_secret: twitch.eventsub_secret.clone(),
            eventsub_callback_url: format!("{gql_origin}/twitch/eventsub"),
            web_redirect_uri: format!("{canonical_host}/twitch/callback"),
            app_token: RwLock::new(None),
            reconcile_kick: Notify::new(),
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

    /// Looks up Twitch users by their stable ids, batched into Twitch's 100-ids-per-request limit.
    /// Ids Twitch no longer knows (deleted/banned accounts) are simply absent from the result.
    async fn get_users_by_id(&self, ids: &[String]) -> eyre::Result<Vec<HelixUser>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Unlike `get_authenticated_user` (which resolves the token owner's own identity from a user
        // access token), this looks up arbitrary users by id, which requires the app token.
        let token = self.app_token().await?;
        let mut users = Vec::new();
        for chunk in ids.chunks(100) {
            let params: Vec<(&str, &str)> = chunk.iter().map(|id| ("id", id.as_str())).collect();
            let url = Url::parse_with_params(TWITCH_HELIX_USERS_URL, &params)
                .wrap_err("Failed to build Twitch get-users URL")?;
            let resp = self
                .http
                .get(url)
                .header("Client-Id", &self.client_id)
                .bearer_auth(&token)
                .send()
                .await
                .wrap_err("Failed to get Twitch users")?;
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(eyre!("Twitch get-users failed ({status}): {text}"));
            }
            let page: HelixUsersResponse = resp
                .json()
                .await
                .wrap_err("Failed to parse Twitch users response")?;
            users.extend(page.data);
        }
        Ok(users)
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

/// A streamer an admin has blocked from the live-streams feed (shown on the home page and the
/// dedicated live streams page), for the admin blocked-streams list. The block hides them from the
/// `liveStreams` feed only; the `twitch_login`/`twitch_display_name` come from their
/// currently-linked channel (via a LEFT JOIN) and are absent if they've since unlinked.
#[derive(SimpleObject)]
#[graphql(complex)]
pub struct BlockedStream {
    #[graphql(skip)]
    pub user_id: SbUserId,
    #[graphql(skip)]
    pub blocked_by_id: Option<SbUserId>,
    /// The Twitch login of the blocked user's currently-linked channel, if they still have one.
    pub twitch_login: Option<String>,
    /// The Twitch display name of the blocked user's currently-linked channel, if any.
    pub twitch_display_name: Option<String>,
    /// When the block was created.
    pub created_at: DateTime<Utc>,
}

#[ComplexObject]
impl BlockedStream {
    /// The blocked ShieldBattery user.
    async fn user(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.user_id)
            .await
    }

    /// The admin who created the block, if their account still exists.
    async fn blocked_by(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<SbUser>> {
        match self.blocked_by_id {
            Some(id) => ctx.data::<DataLoader<UsersLoader>>()?.load_one(id).await,
            None => Ok(None),
        }
    }
}

struct ParsedLiveStreamEntries {
    streams: Vec<(SbUserId, LiveStreamSummary)>,
    malformed: Vec<(SbUserId, String)>,
}

fn parse_live_stream_entries(
    entries: impl IntoIterator<Item = (SbUserId, Option<String>)>,
) -> ParsedLiveStreamEntries {
    let entries = entries.into_iter();
    let (lower_bound, _) = entries.size_hint();
    let mut streams = Vec::with_capacity(lower_bound);
    let mut malformed = Vec::new();

    for (user_id, json) in entries {
        let Some(json) = json else {
            continue;
        };
        match serde_json::from_str::<LiveStreamSummary>(&json) {
            Ok(summary) => streams.push((user_id, summary)),
            Err(e) => {
                warn!("Failed to parse live stream for user {}: {e:?}", user_id.0);
                malformed.push((user_id, json));
            }
        }
    }

    ParsedLiveStreamEntries { streams, malformed }
}

fn remove_malformed_live_streams_command(entries: &[(SbUserId, String)]) -> Cmd {
    let mut cmd = deadpool_redis::redis::cmd("EVAL");
    cmd.arg(REMOVE_MALFORMED_LIVE_STREAMS_SCRIPT)
        .arg(1)
        .arg(LIVE_STREAMS_KEY);
    for (user_id, json) in entries {
        cmd.arg(i32::from(*user_id)).arg(json);
    }
    cmd
}

async fn remove_malformed_live_streams(
    conn: &mut impl ConnectionLike,
    entries: &[(SbUserId, String)],
) {
    if entries.is_empty() {
        return;
    }

    let result: RedisResult<usize> = remove_malformed_live_streams_command(entries)
        .query_async(conn)
        .await;
    if let Err(e) = result {
        // Malformed entries have always been omitted from results. Cleanup is only a safeguard for
        // the field-only live-user-id query, so a cleanup failure must not turn a successful read
        // into a GraphQL error.
        warn!("Failed to remove malformed live streams from Redis: {e:?}");
    }
}

async fn load_live_stream_user_ids_from_connection(
    redis: &mut impl AsyncCommands,
) -> RedisResult<Vec<SbUserId>> {
    let user_ids: Vec<i32> = redis.hkeys(LIVE_STREAMS_KEY).await?;
    Ok(user_ids.into_iter().map(SbUserId).collect())
}

async fn load_live_stream_values_from_connection(
    redis: &mut impl AsyncCommands,
    user_ids: &[SbUserId],
) -> RedisResult<Vec<Option<String>>> {
    let fields: Vec<i32> = user_ids.iter().copied().map(i32::from).collect();
    redis.hmget(LIVE_STREAMS_KEY, fields).await
}

/// Loads every currently-live streamer from Redis (unfiltered).
async fn load_live_streams(redis: &RedisPool) -> eyre::Result<Vec<(SbUserId, LiveStreamSummary)>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let entries: HashMap<i32, String> = conn
        .hgetall(LIVE_STREAMS_KEY)
        .await
        .wrap_err("Failed to load live streams")?;
    let parsed = parse_live_stream_entries(
        entries
            .into_iter()
            .map(|(user_id, json)| (SbUserId(user_id), Some(json))),
    );
    remove_malformed_live_streams(&mut conn, &parsed.malformed).await;
    Ok(parsed.streams)
}

/// Loads only the live-stream summaries for `user_ids`, preserving the input/result alignment long
/// enough to associate each Redis value with its user before invalid or missing values are omitted.
async fn load_live_streams_for_users(
    redis: &RedisPool,
    user_ids: &[SbUserId],
) -> eyre::Result<Vec<(SbUserId, LiveStreamSummary)>> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let values = load_live_stream_values_from_connection(&mut conn, user_ids)
        .await
        .wrap_err("Failed to load live streams")?;
    let parsed = parse_live_stream_entries(user_ids.iter().copied().zip(values));
    remove_malformed_live_streams(&mut conn, &parsed.malformed).await;
    Ok(parsed.streams)
}

/// Loads the field-only live-user index. The typed writer serializes a complete summary before HSET,
/// so normal entries are valid; full/detail reads atomically remove any malformed legacy or corrupt
/// values they encounter.
async fn load_live_stream_user_ids(redis: &RedisPool) -> eyre::Result<Vec<SbUserId>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    load_live_stream_user_ids_from_connection(&mut conn)
        .await
        .wrap_err("Failed to load live streams")
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
        let live = load_live_streams_for_users(&self.redis, keys)
            .await
            .map_err(|e| graphql_error("INTERNAL_SERVER_ERROR", e.to_string()))?;

        Ok(live
            .into_iter()
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
            .data(FeedBlockCache::default())
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

/// Loads only the connection identity needed by the periodic live-state refresh.
async fn load_live_refresh_connections(pool: &PgPool) -> eyre::Result<HashMap<SbUserId, String>> {
    let rows = sqlx::query!(
        r#"
            SELECT user_id as "user_id: SbUserId", twitch_user_id
            FROM twitch_connections
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load Twitch connections")?;

    Ok(rows
        .into_iter()
        .map(|row| (row.user_id, row.twitch_user_id))
        .collect())
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

/// Updates the stored login/display name of whichever connection currently holds this Twitch
/// account, if any. A plain UPDATE (rather than the link-time upsert) so that an unlink racing an
/// in-flight identity refresh can't have its deleted connection re-inserted.
async fn update_connection_identity(
    pool: &PgPool,
    twitch_user_id: &str,
    twitch_login: &str,
    twitch_display_name: &str,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE twitch_connections
            SET twitch_login = $2, twitch_display_name = $3, updated_at = now()
            WHERE twitch_user_id = $1
        "#,
        twitch_user_id,
        twitch_login,
        twitch_display_name,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to update Twitch connection identity")?;
    Ok(())
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

/// The set of users an admin has blocked from the live-streams feed. The table holds one row per
/// blocked user, so this stays small. Callers on the hot `live_streams` path go through
/// `FeedBlockCache` rather than reading this on every poll.
async fn load_feed_blocked_user_ids(pool: &PgPool) -> eyre::Result<HashSet<SbUserId>> {
    let rows = sqlx::query!(r#"SELECT user_id as "user_id: SbUserId" FROM twitch_feed_blocks"#,)
        .fetch_all(pool)
        .await
        .wrap_err("Failed to load Twitch feed blocks")?;
    Ok(rows.into_iter().map(|r| r.user_id).collect())
}

struct CachedFeedBlocks {
    blocked: Arc<HashSet<SbUserId>>,
    expires_at: Instant,
}

/// A short-lived, in-process cache of the feed-block set. `live_streams` is polled by every
/// home/`live` client on an interval, but the block table changes rarely, so serving the set from
/// this cache keeps that hot query off Postgres. A newly added or removed block takes effect once
/// the entry expires (within `FEED_BLOCK_CACHE_TTL`), which is well inside the latency feed
/// moderation needs. Shared for the schema's lifetime via `TwitchModule`.
#[derive(Default)]
struct FeedBlockCache {
    inner: RwLock<Option<CachedFeedBlocks>>,
}

impl FeedBlockCache {
    /// Returns the current feed-block set, refreshing from `pool` when the cached copy is missing or
    /// expired. Mirrors `TwitchClient::app_token`'s read-then-double-checked-write locking.
    async fn get(&self, pool: &PgPool) -> eyre::Result<Arc<HashSet<SbUserId>>> {
        {
            let guard = self.inner.read().await;
            if let Some(cached) = guard.as_ref()
                && cached.expires_at > Instant::now()
            {
                return Ok(cached.blocked.clone());
            }
        }

        let mut guard = self.inner.write().await;
        // Re-check in case another task refreshed while we waited for the write lock.
        if let Some(cached) = guard.as_ref()
            && cached.expires_at > Instant::now()
        {
            return Ok(cached.blocked.clone());
        }

        let blocked = Arc::new(load_feed_blocked_user_ids(pool).await?);
        *guard = Some(CachedFeedBlocks {
            blocked: blocked.clone(),
            expires_at: Instant::now() + FEED_BLOCK_CACHE_TTL,
        });
        Ok(blocked)
    }
}

/// Builds the ordered `liveStreams` feed from the raw Redis entries: keep only StarCraft streams that
/// aren't feed-blocked, then sort by viewer count (highest first).
fn feed_streams(
    entries: Vec<(SbUserId, LiveStreamSummary)>,
    blocked: &HashSet<SbUserId>,
) -> Vec<LiveStream> {
    let mut streams: Vec<LiveStream> = entries
        .into_iter()
        .filter(|(user_id, summary)| summary.is_starcraft() && !blocked.contains(user_id))
        .map(|(user_id, summary)| LiveStream::from_summary(user_id, summary))
        .collect();
    streams.sort_by_key(|s| std::cmp::Reverse(s.viewer_count));
    streams
}

/// Records a feed block for `user_id`, remembering which admin created it. Idempotent: re-blocking an
/// already-blocked user keeps the original block (and its original `blocked_by`/`created_at`).
async fn insert_feed_block(
    pool: &PgPool,
    user_id: SbUserId,
    blocked_by: SbUserId,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO twitch_feed_blocks (user_id, blocked_by)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO NOTHING
        "#,
        user_id as _,
        blocked_by as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to insert Twitch feed block")?;
    Ok(())
}

/// Removes a feed block, returning whether one existed.
async fn delete_feed_block(pool: &PgPool, user_id: SbUserId) -> eyre::Result<bool> {
    let result = sqlx::query!(
        r#"DELETE FROM twitch_feed_blocks WHERE user_id = $1"#,
        user_id as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to delete Twitch feed block")?;
    Ok(result.rows_affected() > 0)
}

/// Loads the blocked-streams list for the admin UI, newest first, joining in each user's current
/// Twitch channel identity when they still have one linked.
async fn load_feed_blocks(pool: &PgPool) -> eyre::Result<Vec<BlockedStream>> {
    sqlx::query_as!(
        BlockedStream,
        r#"
            SELECT b.user_id as "user_id: SbUserId",
                b.blocked_by as "blocked_by_id: SbUserId",
                c.twitch_login as "twitch_login?",
                c.twitch_display_name as "twitch_display_name?",
                b.created_at
            FROM twitch_feed_blocks b
            LEFT JOIN twitch_connections c ON c.user_id = b.user_id
            ORDER BY b.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load Twitch feed blocks")
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

fn live_stream_updates_pipeline(
    live: &[(SbUserId, LiveStreamSummary)],
    offline: &[SbUserId],
) -> eyre::Result<deadpool_redis::redis::Pipeline> {
    let mut pipeline = deadpool_redis::redis::pipe();

    if !live.is_empty() {
        pipeline.cmd("HSET").arg(LIVE_STREAMS_KEY);
        for (user_id, summary) in live {
            let json =
                serde_json::to_string(summary).wrap_err("Failed to serialize live stream")?;
            pipeline.arg(i32::from(*user_id)).arg(json);
        }
        pipeline.ignore();
    }

    if !offline.is_empty() {
        pipeline.cmd("HDEL").arg(LIVE_STREAMS_KEY);
        for user_id in offline {
            pipeline.arg(i32::from(*user_id));
        }
        pipeline.ignore();
    }

    Ok(pipeline)
}

/// Applies one refresh phase with at most one HSET and one HDEL in a single Redis round trip.
async fn apply_live_stream_updates(
    redis: &RedisPool,
    live: &[(SbUserId, LiveStreamSummary)],
    offline: &[SbUserId],
) -> eyre::Result<()> {
    let pipeline = live_stream_updates_pipeline(live, offline)?;
    if pipeline.is_empty() {
        return Ok(());
    }

    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    pipeline
        .exec_async(&mut conn)
        .await
        .wrap_err("Failed to update live streams")
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
    /// first). Users an admin has blocked from the feed are omitted (the block hides them here only;
    /// their live state elsewhere -- profile, avatar ring, friend notifications -- is unaffected).
    async fn live_streams(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<LiveStream>> {
        let entries = load_live_streams(ctx.data::<RedisPool>()?).await?;
        // This resolver is polled frequently (every home/`live` client, on an interval); the block
        // set is served from a short-TTL cache so those polls don't each hit Postgres for a table
        // that changes rarely.
        let blocked = ctx
            .data::<FeedBlockCache>()?
            .get(ctx.data::<PgPool>()?)
            .await?;
        Ok(feed_streams(entries, &blocked))
    }

    /// Streamers an admin has blocked from the live-streams feed, newest first. For the admin
    /// blocked-streams management UI.
    #[graphql(guard = RequiredPermission::ManageLiveStreams)]
    async fn blocked_streams(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<BlockedStream>> {
        Ok(load_feed_blocks(ctx.data::<PgPool>()?).await?)
    }

    /// The ids of every ShieldBattery user who is currently live-streaming (any category). This lets
    /// the client badge "live" state across user lists (friends, chat, etc.) from a single lookup,
    /// with per-stream details fetched lazily via `SbUser.liveStream` where needed. Category-agnostic
    /// by design, matching the profile "Live" badge (`live_streams` is the StarCraft-filtered feed).
    async fn live_stream_user_ids(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<SbUserId>> {
        Ok(load_live_stream_user_ids(ctx.data::<RedisPool>()?).await?)
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

        // Only delete the state once we've confirmed it belongs to the caller -- otherwise anyone
        // who learns another flow's `state` value (e.g. from a shared link/log) could invalidate
        // that pending link just by calling this with their own session. The GET-then-DEL here isn't
        // atomic, but that's fine: if two of the owner's own requests race, the loser just fails the
        // single-use code exchange at Twitch instead of the state check.
        let pending = stored
            .and_then(|s| serde_json::from_str::<PendingLink>(&s).ok())
            .filter(|p| p.user_id == i32::from(user.id));
        let Some(pending) = pending else {
            return Err(graphql_error(
                "TWITCH_INVALID_STATE",
                "Your Twitch linking request was invalid or expired. Please try again.",
            ));
        };
        let _: () = redis
            .del(&key)
            .await
            .wrap_err("Failed to clear Twitch link state")?;

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

    /// Blocks a user's stream from appearing in the live-streams feed (shown on the home page and
    /// the dedicated live streams page). Idempotent (a repeat block keeps the original). The block
    /// hides them from the feed only, not from the profile stream card / avatar "live" ring / friend
    /// notifications. Requires the `manageLiveStreams` permission.
    #[graphql(guard = RequiredPermission::ManageLiveStreams)]
    async fn block_stream(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
    ) -> async_graphql::Result<bool> {
        let admin = require_current_user(ctx)?;
        insert_feed_block(ctx.data::<PgPool>()?, user_id, admin.id).await?;
        Ok(true)
    }

    /// Removes a user's feed block, letting their stream appear in the feed again. Returns whether a
    /// block was removed. Requires the `manageLiveStreams` permission.
    #[graphql(guard = RequiredPermission::ManageLiveStreams)]
    async fn unblock_stream(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
    ) -> async_graphql::Result<bool> {
        Ok(delete_feed_block(ctx.data::<PgPool>()?, user_id).await?)
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
/// redelivery we should drop). Handling runs off the webhook response path, so the claim isn't
/// released on failure -- a lost notification is corrected by the retry loop / periodic refresh.
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
/// Twitch's Get Streams endpoint can lag the event (returning a not-live `None`) or hiccup with a
/// transient `Err` for a few seconds, so both are retried before we give up -- otherwise a streamer
/// who just went live could be dropped until their next transition. Runs off the webhook response
/// path (spawned by `eventsub_callback`), so errors are logged by the caller rather than surfaced to
/// Twitch. A `None` that outlasts the retries means genuinely offline, so we clear the entry; an
/// `Err` that does is propagated *without* clearing -- we never confirmed the state, and since the
/// dedupe entry stops Twitch from redelivering, wrongly marking offline would hide an actually-live
/// stream until its next transition.
///
/// Ordering caveat: notifications are handled in independently-spawned tasks, so a `stream.offline`
/// processed during this handler's retry window can be overwritten afterwards if Get Streams still
/// reports the just-ended stream (it lags on the way down too), leaving a ghost "live" entry. This
/// is accepted: guarding here (e.g. skipping the write after a recent offline) would risk
/// suppressing a genuine rapid re-online -- a worse state, since the periodic refresh reconciles
/// every linked broadcaster and so corrects either a ghost "live" entry or a wrongly-suppressed one
/// within `LIVE_REFRESH_INTERVAL`.
async fn handle_stream_online(
    client: &TwitchClient,
    redis: &RedisPool,
    sb_user_id: SbUserId,
    broadcaster_id: &str,
) -> eyre::Result<()> {
    for attempt in 1..=STREAM_ONLINE_LOOKUP_ATTEMPTS {
        match client.get_stream(broadcaster_id).await {
            Ok(Some(stream)) => {
                return set_stream_live(redis, sb_user_id, &LiveStreamSummary::from_stream(stream))
                    .await;
            }
            // Not live yet -- Get Streams is lagging the event; retry.
            Ok(None) => {}
            // Persistent error: give up, but leave the entry untouched rather than clearing it (see
            // the doc comment for why we don't mark offline here).
            Err(e) if attempt == STREAM_ONLINE_LOOKUP_ATTEMPTS => {
                return Err(e.wrap_err("Failed to resolve stream after stream.online"));
            }
            // Transient error: retry.
            Err(e) => {
                warn!("get_stream failed resolving stream.online (attempt {attempt}): {e:?}")
            }
        }
        if attempt < STREAM_ONLINE_LOOKUP_ATTEMPTS {
            tokio::time::sleep(STREAM_ONLINE_LOOKUP_RETRY_DELAY).await;
        }
    }
    // Every attempt returned `None`: we rode out the lag and it's genuinely not live (e.g. a stream
    // that ended almost immediately).
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

/// Periodically reconciles the `twitch:live` Redis hash against Twitch for every linked broadcaster,
/// not just those already marked live: refreshes viewer counts/titles for streamers who are live,
/// clears entries for anyone who is no longer live (a safety net for a missed `stream.offline`
/// event, which would otherwise pin them "live" forever), and recovers streams whose `stream.online`
/// handling was lost entirely (e.g. a process crash after the webhook was acked, or a persistent
/// Twitch/Redis failure that outlasted `handle_stream_online`'s retries) -- those would otherwise
/// stay invisible until the broadcaster's next transition. It also drops entries that no longer
/// correspond to a current connection: an unlink racing an in-flight `stream.online` handler, or a
/// failed offline write during unlink, can leave an entry that no EventSub subscription remains to
/// clear, and Twitch-side reconciliation alone would keep it fresh for as long as the broadcaster
/// keeps streaming.
pub async fn refresh_live_streams_loop(client: Arc<TwitchClient>, db: PgPool, redis: RedisPool) {
    let mut interval = tokio::time::interval(LIVE_REFRESH_INTERVAL);
    loop {
        interval.tick().await;
        if let Err(e) = refresh_all_live_streams(&client, &db, &redis).await {
            error!("Twitch live-stream refresh failed: {e:?}");
        }
    }
}

async fn refresh_all_live_streams(
    client: &TwitchClient,
    db: &PgPool,
    redis: &RedisPool,
) -> eyre::Result<()> {
    // user_id -> currently linked Twitch user id, for everyone with a connection right now.
    let connections = load_live_refresh_connections(db).await?;

    let live = load_live_streams(redis).await?;

    // An entry can be orphaned if an unlink raced an in-flight stream.online handler (or the
    // offline write on unlink failed): no subscription remains to clear it, and since Twitch still
    // reports the broadcaster live, leaving it in would keep it pinned live for the rest of the
    // stream. Drop those here instead, checking against who's actually linked right now. Everyone
    // else we remember as already tracked, so we only issue an offline write below for entries that
    // actually need clearing.
    let mut tracked_live: HashSet<SbUserId> = HashSet::new();
    let mut orphaned = Vec::new();
    for (user_id, summary) in live {
        if connections.get(&user_id) == Some(&summary.twitch_user_id) {
            tracked_live.insert(user_id);
        } else {
            orphaned.push(user_id);
        }
    }
    apply_live_stream_updates(redis, &[], &orphaned).await?;

    if connections.is_empty() {
        return Ok(());
    }

    // Check every linked broadcaster, not just those already tracked as live: this is what recovers
    // a stream whose `stream.online` handling was lost entirely (a crash after the webhook was
    // acked, or a persistent failure that outlasted the retry loop) instead of leaving it invisible
    // until the broadcaster's next transition.
    let broadcaster_ids: Vec<String> = connections.values().cloned().collect();
    let mut live_now: HashMap<String, StreamInfo> = client
        .get_streams(&broadcaster_ids)
        .await?
        .into_iter()
        .map(|stream| (stream.user_id.clone(), stream))
        .collect();

    let mut live_updates = Vec::with_capacity(live_now.len());
    let mut offline_updates = Vec::new();
    for (user_id, twitch_user_id) in &connections {
        match live_now.remove(twitch_user_id) {
            Some(stream) => {
                live_updates.push((*user_id, LiveStreamSummary::from_stream(stream)));
            }
            // Only clear entries we're actually tracking so we don't issue an HDEL per offline
            // connection every pass.
            None if tracked_live.contains(user_id) => {
                offline_updates.push(*user_id);
            }
            None => {}
        }
    }
    apply_live_stream_updates(redis, &live_updates, &offline_updates).await?;

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
            // Acknowledge immediately and resolve/store the stream state off the response path.
            // `handle_stream_online` rides out Twitch's Get Streams lag/hiccups with retries (up to
            // several seconds); doing that before responding would hold Twitch's connection open the
            // whole time, and Twitch treats a slow webhook response as a delivery failure -- disabling
            // the subscription after repeated ones. The retry loop covers transient lag/errors, the
            // periodic refresh reconciles every linked broadcaster (fresh stats, missed offlines, and
            // lost onlines alike), and the dedupe check above drops duplicate deliveries. A
            // persistent failure here is logged and self-heals within one periodic-refresh pass.
            let client = client.clone();
            let db = db.clone();
            let redis = redis.clone();
            let body = body.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_notification(&client, &db, &redis, &body).await {
                    error!("Failed to handle Twitch EventSub notification: {e:?}");
                }
            });
            StatusCode::NO_CONTENT.into_response()
        }
        "revocation" => {
            warn!(
                "Twitch EventSub subscription was revoked; kicking reconciliation to recreate it"
            );
            client.reconcile_kick.notify_one();
            StatusCode::NO_CONTENT.into_response()
        }
        other => {
            warn!("Unknown Twitch EventSub message type: {other}");
            StatusCode::NO_CONTENT.into_response()
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Subscription reconciliation
// ---------------------------------------------------------------------------------------------

/// Reconciles our EventSub subscriptions with Twitch: recreates any that Twitch dropped or that
/// failed verification, and deletes orphans left over from unlinks that happened while we were
/// down. Also refreshes stored login/display names for accounts Twitch reports as renamed. Runs a
/// boot pass, then keeps running -- a revocation kicks an immediate pass, and a periodic backstop
/// interval catches any drift a kick missed. Logs and swallows errors -- this is best-effort
/// maintenance.
pub async fn reconcile_subscriptions_loop(client: Arc<TwitchClient>, db: PgPool) {
    tokio::time::sleep(RECONCILE_STARTUP_DELAY).await;
    // The first tick completes immediately, giving the boot pass. After that, a pass runs whenever
    // a revocation kicks `reconcile_kick` (a kick during a pass is stored and re-runs it once),
    // with the periodic tick as a backstop for revocations we never received.
    let mut interval = tokio::time::interval(SUBSCRIPTION_RECONCILE_INTERVAL);
    loop {
        tokio::select! {
            _ = interval.tick() => {}
            _ = client.reconcile_kick.notified() => {}
        }
        if let Err(e) = try_reconcile_subscriptions(&client, &db).await {
            error!("Twitch EventSub reconciliation failed: {e:?}");
        }
    }
}

/// Reconciles our EventSub subscriptions with Twitch (see `reconcile_subscriptions_loop`), then
/// refreshes stored Twitch identities for renamed accounts.
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

        // Twitch doesn't guarantee a listing order, so compare order-insensitively -- a mere
        // reordering of the same ids shouldn't rewrite the row every pass.
        let mut stored_sorted = conn.eventsub_subscription_ids.clone();
        stored_sorted.sort_unstable();
        let mut healthy_sorted = healthy_ids.clone();
        healthy_sorted.sort_unstable();
        if stored_sorted != healthy_sorted
            && let Err(e) = update_subscription_ids(db, conn.user_id, &healthy_ids).await
        {
            error!("Failed to persist reconciled Twitch subscription ids: {e:?}");
        }
    }

    // Best-effort: a failure here shouldn't count against the subscription reconciliation this pass
    // already did.
    if let Err(e) = refresh_connection_identities(client, db, &connections).await {
        error!("Failed to refresh Twitch identities: {e:?}");
    }

    Ok(())
}

/// Refreshes the stored Twitch login/display names for the given connections. Twitch accounts can
/// be renamed while their numeric id stays stable, and we otherwise only capture names at link
/// time, leaving profile links/labels stale. Accounts Twitch no longer returns keep their
/// last-known names.
async fn refresh_connection_identities(
    client: &TwitchClient,
    db: &PgPool,
    connections: &[TwitchConnection],
) -> eyre::Result<()> {
    if connections.is_empty() {
        return Ok(());
    }

    let ids: Vec<String> = connections
        .iter()
        .map(|c| c.twitch_user_id.clone())
        .collect();
    let by_id: HashMap<String, HelixUser> = client
        .get_users_by_id(&ids)
        .await?
        .into_iter()
        .map(|u| (u.id.clone(), u))
        .collect();

    for conn in connections {
        let Some(user) = by_id.get(&conn.twitch_user_id) else {
            continue;
        };
        if user.login == conn.twitch_login && user.display_name == conn.twitch_display_name {
            continue;
        }
        if let Err(e) =
            update_connection_identity(db, &conn.twitch_user_id, &user.login, &user.display_name)
                .await
        {
            error!(
                "Failed to refresh Twitch identity for user {}: {e:?}",
                conn.user_id
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use deadpool_redis::redis::{RedisFuture, Value};

    struct FakeRedis {
        response: Option<Value>,
        commands: Vec<Vec<u8>>,
    }

    impl FakeRedis {
        fn returning(response: Value) -> Self {
            Self {
                response: Some(response),
                commands: Vec::new(),
            }
        }
    }

    impl ConnectionLike for FakeRedis {
        fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, Value> {
            self.commands.push(cmd.get_packed_command());
            let response = self.response.take().expect("missing fake Redis response");
            Box::pin(async move { Ok(response) })
        }

        fn req_packed_commands<'a>(
            &'a mut self,
            _cmd: &'a deadpool_redis::redis::Pipeline,
            _offset: usize,
            _count: usize,
        ) -> RedisFuture<'a, Vec<Value>> {
            panic!("live-stream reads should issue one command, not a pipeline")
        }

        fn get_db(&self) -> i64 {
            0
        }
    }

    fn live_stream_summary() -> LiveStreamSummary {
        LiveStreamSummary {
            twitch_user_id: "123".to_owned(),
            twitch_login: "streamer".to_owned(),
            twitch_display_name: "Streamer".to_owned(),
            title: "Ladder".to_owned(),
            game_id: STARCRAFT_CATEGORY_IDS[0].to_owned(),
            game_name: "StarCraft".to_owned(),
            viewer_count: 42,
            started_at: DateTime::parse_from_rfc3339("2026-07-26T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            thumbnail_url: "https://example.com/{width}x{height}.jpg".to_owned(),
        }
    }

    #[tokio::test]
    async fn live_stream_user_ids_uses_hkeys() {
        let mut redis = FakeRedis::returning(Value::Array(vec![
            Value::BulkString(b"7".to_vec()),
            Value::BulkString(b"9".to_vec()),
        ]));

        let ids = load_live_stream_user_ids_from_connection(&mut redis)
            .await
            .unwrap();

        assert_eq!(ids, vec![SbUserId(7), SbUserId(9)]);
        assert_eq!(redis.commands.len(), 1);
        let mut expected = deadpool_redis::redis::cmd("HKEYS");
        expected.arg(LIVE_STREAMS_KEY);
        assert_eq!(redis.commands[0], expected.get_packed_command());
    }

    #[tokio::test]
    async fn requested_live_stream_values_use_one_aligned_hmget() {
        let valid_json = serde_json::to_string(&live_stream_summary()).unwrap();
        let mut redis = FakeRedis::returning(Value::Array(vec![
            Value::BulkString(valid_json.as_bytes().to_vec()),
            Value::Nil,
            Value::BulkString(b"{malformed".to_vec()),
        ]));
        let user_ids = [SbUserId(7), SbUserId(8), SbUserId(9)];

        let values = load_live_stream_values_from_connection(&mut redis, &user_ids)
            .await
            .unwrap();

        assert_eq!(values[0].as_deref(), Some(valid_json.as_str()));
        assert_eq!(values[1], None);
        assert_eq!(values[2].as_deref(), Some("{malformed"));
        assert_eq!(redis.commands.len(), 1);
        let mut expected = deadpool_redis::redis::cmd("HMGET");
        expected.arg(LIVE_STREAMS_KEY).arg(7).arg(8).arg(9);
        assert_eq!(redis.commands[0], expected.get_packed_command());
    }

    #[test]
    fn live_stream_parsing_omits_missing_and_malformed_values() {
        let valid_json = serde_json::to_string(&live_stream_summary()).unwrap();
        let malformed_json = "{malformed".to_owned();

        let parsed = parse_live_stream_entries([
            (SbUserId(7), Some(valid_json)),
            (SbUserId(8), None),
            (SbUserId(9), Some(malformed_json.clone())),
        ]);

        assert_eq!(parsed.streams.len(), 1);
        assert_eq!(parsed.streams[0].0, SbUserId(7));
        assert_eq!(parsed.streams[0].1.title, "Ladder");
        assert_eq!(parsed.malformed, vec![(SbUserId(9), malformed_json)]);
    }

    #[test]
    fn feed_streams_drops_blocked_and_non_starcraft_then_sorts_by_viewers() {
        let mut low = live_stream_summary();
        low.viewer_count = 10;
        let mut high = live_stream_summary();
        high.viewer_count = 500;
        let mut blocked_stream = live_stream_summary();
        blocked_stream.viewer_count = 999;
        let mut non_starcraft = live_stream_summary();
        non_starcraft.game_id = "509658".to_owned(); // "Just Chatting", not a StarCraft category

        let entries = vec![
            (SbUserId(1), low),
            (SbUserId(2), high),
            (SbUserId(3), blocked_stream),
            (SbUserId(4), non_starcraft),
        ];
        let blocked = HashSet::from([SbUserId(3)]);

        let streams = feed_streams(entries, &blocked);

        // The blocked user (3) and the non-StarCraft stream (4) are gone; the rest are ordered by
        // viewer count, highest first.
        let ids: Vec<_> = streams.iter().map(|s| s.user_id).collect();
        assert_eq!(ids, vec![SbUserId(2), SbUserId(1)]);
        assert_eq!(streams[0].viewer_count, 500);
        assert_eq!(streams[1].viewer_count, 10);
    }

    #[test]
    fn malformed_cleanup_compares_the_value_before_deleting() {
        let entries = vec![
            (SbUserId(7), "{bad-one".to_owned()),
            (SbUserId(9), "{bad-two".to_owned()),
        ];

        let actual = remove_malformed_live_streams_command(&entries);
        let mut expected = deadpool_redis::redis::cmd("EVAL");
        expected
            .arg(REMOVE_MALFORMED_LIVE_STREAMS_SCRIPT)
            .arg(1)
            .arg(LIVE_STREAMS_KEY)
            .arg(7)
            .arg("{bad-one")
            .arg(9)
            .arg("{bad-two");

        assert_eq!(actual.get_packed_command(), expected.get_packed_command());
    }

    #[test]
    fn live_stream_refresh_updates_are_batched_by_operation() {
        let first = live_stream_summary();
        let mut second = live_stream_summary();
        second.twitch_user_id = "456".to_owned();
        second.twitch_login = "other-streamer".to_owned();
        let live = vec![(SbUserId(7), first), (SbUserId(8), second)];
        let offline = vec![SbUserId(9), SbUserId(10)];

        let actual = live_stream_updates_pipeline(&live, &offline).unwrap();

        assert_eq!(actual.len(), 2);
        let mut expected = deadpool_redis::redis::pipe();
        expected
            .cmd("HSET")
            .arg(LIVE_STREAMS_KEY)
            .arg(7)
            .arg(serde_json::to_string(&live[0].1).unwrap())
            .arg(8)
            .arg(serde_json::to_string(&live[1].1).unwrap())
            .ignore()
            .cmd("HDEL")
            .arg(LIVE_STREAMS_KEY)
            .arg(9)
            .arg(10)
            .ignore();

        assert_eq!(actual.get_packed_pipeline(), expected.get_packed_pipeline());
    }

    #[test]
    fn empty_live_stream_refresh_does_not_issue_redis_commands() {
        let pipeline = live_stream_updates_pipeline(&[], &[]).unwrap();
        assert!(pipeline.is_empty());
    }

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
