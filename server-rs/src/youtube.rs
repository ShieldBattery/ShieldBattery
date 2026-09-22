//! YouTube integration: channel linking (Google OAuth) and live-broadcast tracking (polling).
//!
//! Linking works like the Twitch flow: the client opens Google's authorize URL itself and hands the
//! resulting `code`/`state` back over a normal authenticated GraphQL request, so the code exchange
//! (which needs the client secret) still happens entirely server-side. The user's access token is
//! used exactly once -- to read which channel they own -- and revoked immediately afterwards. No
//! user tokens are stored, and nothing after linking needs one.
//!
//! Live detection therefore runs entirely on our own API key against public data. YouTube has no
//! push equivalent of Twitch's EventSub, and `search.list` -- the obvious way to ask "is this
//! channel live?" -- is capped by Google at 100 calls/day no matter how much quota is granted, which
//! makes it unusable here. Instead each linked channel's uploads playlist (every public video, live
//! broadcasts included, lands in it) is polled for its newest video ids, and one batched
//! `videos.list` over all of them reports which are live right now.
//!
//! Quota: `playlistItems.list` and `videos.list` cost 1 unit per call, so a pass costs one unit per
//! channel plus one per 50 collected video ids -- roughly 1.3 units per channel. At one pass every
//! `LIVE_REFRESH_INTERVAL` (288 per day) that is ~375 units per channel per day, so the default
//! 10,000-unit daily quota covers roughly 25 linked channels before Google has to raise it. Running
//! out is detected explicitly (`YoutubeApiError::QuotaExceeded`) so a pass reports it once and
//! leaves the live state alone instead of mass-clearing everyone.
//!
//! Only public videos appear in a playlist read made with an API key, so private and unlisted
//! broadcasts are never discovered.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::futures_util::{StreamExt, TryStreamExt, stream};
use async_graphql::{ComplexObject, Context, Object, SchemaBuilder, SimpleObject};
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _, eyre};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{error, warn};
use url::Url;

use crate::configuration::Settings;
use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::live_streams::{self, LiveStream, LiveStreamPlatform};
use crate::oauth_link;
use crate::redis::RedisPool;
use crate::users::{SbUserId, require_current_user};

const GOOGLE_OAUTH_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_CHANNELS_URL: &str = "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLIST_ITEMS_URL: &str = "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_URL: &str = "https://www.googleapis.com/youtube/v3/videos";

/// The only scope we ask for: enough to read which channel the authorizing account owns, and
/// nothing else. It is one of Google's "sensitive" scopes, so the OAuth client needs app
/// verification before it can be used outside the test-user list.
const YOUTUBE_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/youtube.readonly";

/// The fixed loopback redirect URI used by the desktop app's OAuth flow. Unlike the web flow (which
/// redirects to `<canonical host>/youtube/callback`), the desktop app opens the authorize URL in the
/// user's real browser and captures the redirect with a temporary loopback HTTP server, so their
/// existing Google login is reused. Google requires an exact, port-inclusive redirect_uri match, so
/// this must be a single fixed `localhost` port registered as a second redirect URI on the OAuth
/// client. The desktop app parses this port out of the authorize URL and binds its loopback server
/// on it. It shares a port with the Twitch flow because the app only ever runs one at a time.
const DESKTOP_REDIRECT_URI: &str = "http://localhost:27193/youtube/callback";

/// Redis key prefix owning this platform's pending OAuth link states.
const LINK_KEY_PREFIX: &str = "youtube";

/// Redis hash of `sbUserId -> YoutubeLiveStreamSummary` for every currently-live linked channel.
const LIVE_STREAMS_KEY: &str = "youtube:live";

/// How often every linked channel is polled for a live broadcast. Longer than the Twitch refresh
/// because each pass costs API quota that is shared across all linked channels for the whole day.
const LIVE_REFRESH_INTERVAL: Duration = Duration::from_secs(300);
/// How often stored channel titles/handles are refreshed. Channels can be renamed (and handles
/// reassigned) while the channel id stays stable, which would otherwise leave profile links and
/// labels permanently showing whatever the name was at link time.
const IDENTITY_REFRESH_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// How many of a channel's newest uploads are examined per pass. A live broadcast is by definition
/// the channel's most recent upload or close to it, so a small window finds it while keeping the
/// batched `videos.list` cheap.
const UPLOADS_PAGE_SIZE: u32 = 15;
/// Google's per-request cap on `id`-list reads (`videos.list`, `channels.list`).
const MAX_IDS_PER_REQUEST: usize = 50;
/// How many uploads-playlist reads run at once. Bounded so a large number of linked channels can't
/// open an unbounded number of simultaneous connections to Google.
const UPLOADS_FETCH_CONCURRENCY: usize = 4;

/// `snippet.liveBroadcastContent` for a broadcast that is on the air right now (as opposed to
/// `"upcoming"` for a scheduled one and `"none"` for an ordinary video or an ended broadcast).
const LIVE_BROADCAST_CONTENT: &str = "live";

/// Substrings naming StarCraft without saying which one, matched case-insensitively against a
/// broadcast's title and description. The Data API exposes no game metadata for a broadcast --
/// unlike Twitch's category -- so the title and description are all we have to go on.
const STARCRAFT_KEYWORDS: &[&str] = &["starcraft", "star craft", "스타크래프트"];

/// Substrings that can only mean Brood War. One of these puts a broadcast in the feed on its own,
/// whatever else it says.
const BROOD_WAR_KEYWORDS: &[&str] = &["brood war", "broodwar", "scbw", "sc:bw", "sc:r", "브루드워"];

/// Substrings that name StarCraft II. This feed is a Brood War feed -- its Twitch half is filtered
/// to the Brood War categories, which never carry StarCraft II -- so a broadcast that matched only
/// generically and names StarCraft II is kept out rather than mixed in.
const STARCRAFT_2_KEYWORDS: &[&str] = &[
    "starcraft ii",
    "starcraft 2",
    "starcraft2",
    "sc2",
    "스타2",
    "스타크래프트 2",
    "스타크래프트 ii",
    "스타크래프트2",
];

/// Substrings naming the remaster. They pin down which StarCraft is meant but not which game ("Age
/// of Empires Remastered"), so they never qualify a broadcast on their own -- they only keep a
/// generic StarCraft match from being excluded as StarCraft II, which is what a broadcast covering
/// both games ("StarCraft: Remastered vs StarCraft II") needs.
const REMASTER_KEYWORDS: &[&str] = &["remastered", "리마스터"];

// ---------------------------------------------------------------------------------------------
// YouTube API client
// ---------------------------------------------------------------------------------------------

/// Failures from the quota-charged public reads. Quota exhaustion is called out separately because
/// it is not a per-channel problem: once the daily quota is gone every remaining call in the pass
/// fails the same way, so the pass has to stop rather than conclude that nobody is live.
#[derive(Debug, thiserror::Error)]
enum YoutubeApiError {
    #[error("YouTube Data API daily quota is exhausted")]
    QuotaExceeded,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

/// A client for the Google/YouTube APIs we use, holding our OAuth app credentials and the API key
/// the public reads authenticate with. Created only when YouTube is configured; the integration is
/// disabled otherwise. Shared (behind `Arc`) between the GraphQL resolvers and the refresh loops.
pub struct YoutubeClient {
    http: reqwest::Client,
    client_id: String,
    client_secret: SecretString,
    api_key: SecretString,
    /// The redirect URI for the web linking flow (`<canonical host>/youtube/callback`). The desktop
    /// flow uses the fixed `DESKTOP_REDIRECT_URI` instead; see `redirect_uri_for`.
    web_redirect_uri: String,
}

impl YoutubeClient {
    /// Builds a client from settings, returning `None` if YouTube isn't configured.
    pub fn from_settings(settings: &Settings) -> Option<Arc<Self>> {
        let youtube = settings.youtube.as_ref()?;
        let canonical_host = settings.canonical_host.trim_end_matches('/');
        Some(Arc::new(Self {
            http: reqwest::Client::new(),
            client_id: youtube.client_id.clone(),
            client_secret: youtube.client_secret.clone(),
            api_key: youtube.api_key.clone(),
            web_redirect_uri: format!("{canonical_host}/youtube/callback"),
        }))
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

    /// Builds the Google OAuth authorize URL for a link attempt with the given `state`.
    /// `redirect_uri` must be reused verbatim in `exchange_code` (Google requires the two to match).
    fn authorize_url(&self, state: &str, redirect_uri: &str) -> eyre::Result<String> {
        let url = Url::parse_with_params(
            GOOGLE_OAUTH_AUTHORIZE_URL,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", YOUTUBE_READONLY_SCOPE),
                ("state", state),
                // The token is used once and revoked, so there is no refresh token to ask for.
                ("access_type", "online"),
                // Google would otherwise silently reuse whichever account the browser is already
                // signed into, which is the wrong one for anyone with several YouTube channels.
                ("prompt", "select_account"),
            ],
        )?;
        Ok(url.to_string())
    }

    /// Builds a URL for a public-data read. The API key travels as a `key=` query parameter, so
    /// every error raised on one of these requests must have its URL stripped (`without_url`)
    /// before it can reach a log.
    fn public_url(&self, base: &str, params: &[(&str, &str)]) -> eyre::Result<Url> {
        let mut url =
            Url::parse_with_params(base, params).wrap_err("Failed to build YouTube API URL")?;
        url.query_pairs_mut()
            .append_pair("key", self.api_key.expose_secret());
        Ok(url)
    }

    /// Exchanges an authorization `code` for a user access token. `redirect_uri` must match the one
    /// used to obtain the code (i.e. the one baked into the authorize URL).
    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> eyre::Result<String> {
        let resp = self
            .http
            .post(GOOGLE_OAUTH_TOKEN_URL)
            .form(&[
                ("code", code),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.expose_secret()),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .wrap_err("Failed to send Google token request")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(eyre!("Google token exchange failed ({status}): {body}"));
        }
        let token: GoogleTokenResponse = resp
            .json()
            .await
            .wrap_err("Failed to parse Google token response")?;
        Ok(token.access_token)
    }

    /// Looks up the channel owned by the account that authorized `access_token`, returning `None`
    /// when that Google account has no YouTube channel at all.
    async fn get_my_channel(&self, access_token: &str) -> eyre::Result<Option<MyYoutubeChannel>> {
        let url = Url::parse_with_params(
            YOUTUBE_CHANNELS_URL,
            &[("part", "snippet,contentDetails"), ("mine", "true")],
        )
        .wrap_err("Failed to build YouTube channels URL")?;
        let resp = self
            .http
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .wrap_err("Failed to send YouTube channels request")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(eyre!("YouTube channels (mine) failed ({status}): {body}"));
        }
        let page: YoutubeListResponse<YoutubeChannelItem> = resp
            .json()
            .await
            .wrap_err("Failed to parse YouTube channels response")?;
        let Some(channel) = page.items.into_iter().next() else {
            return Ok(None);
        };
        let uploads_playlist_id = channel
            .content_details
            .and_then(|details| details.related_playlists.uploads)
            .ok_or_else(|| eyre!("YouTube channel {} has no uploads playlist", channel.id))?;

        Ok(Some(MyYoutubeChannel {
            channel_id: channel.id,
            title: channel.snippet.title,
            handle: channel.snippet.custom_url,
            uploads_playlist_id,
        }))
    }

    /// Discards the user access token we just used. We only ever needed it to read the authorizing
    /// account's channel, and keeping a live grant around for a token we never store would leave
    /// users with an app authorization they can't tell is inert. Best-effort: a failure here costs
    /// nothing beyond the grant expiring on its own.
    async fn revoke_token(&self, access_token: &str) {
        let result = self
            .http
            .post(GOOGLE_OAUTH_REVOKE_URL)
            .form(&[("token", access_token)])
            .send()
            .await;
        match result {
            Ok(resp) if !resp.status().is_success() => {
                warn!("Google token revocation failed ({})", resp.status())
            }
            Ok(_) => {}
            Err(e) => warn!("Failed to send Google token revocation: {e:?}"),
        }
    }

    /// Lists the newest video ids in a channel's uploads playlist. A playlist Google no longer knows
    /// about (deleted or fully private channel) reads as empty rather than as a failure.
    async fn list_upload_video_ids(
        &self,
        playlist_id: &str,
    ) -> Result<Vec<String>, YoutubeApiError> {
        let max_results = UPLOADS_PAGE_SIZE.to_string();
        let url = self.public_url(
            YOUTUBE_PLAYLIST_ITEMS_URL,
            &[
                ("part", "contentDetails"),
                ("playlistId", playlist_id),
                ("maxResults", &max_results),
            ],
        )?;
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(reqwest::Error::without_url)
            .wrap_err("Failed to send YouTube playlist-items request")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if status == StatusCode::NOT_FOUND && has_error_reason(&body, "playlistNotFound") {
                return Ok(Vec::new());
            }
            return Err(classify_api_error("playlist-items", status, &body));
        }
        let page: YoutubeListResponse<YoutubePlaylistItem> = resp
            .json()
            .await
            .map_err(reqwest::Error::without_url)
            .wrap_err("Failed to parse YouTube playlist-items response")?;
        Ok(page
            .items
            .into_iter()
            .map(|item| item.content_details.video_id)
            .collect())
    }

    /// Fetches videos by id, batched into Google's per-request id limit. Ids Google won't serve
    /// (deleted or newly private videos) are simply absent from the result.
    async fn get_videos(&self, ids: &[String]) -> Result<Vec<YoutubeVideo>, YoutubeApiError> {
        self.get_by_ids(
            YOUTUBE_VIDEOS_URL,
            "videos",
            "snippet,liveStreamingDetails",
            ids,
        )
        .await
    }

    /// Fetches channel identities by id, batched into Google's per-request id limit.
    async fn get_channels(
        &self,
        ids: &[String],
    ) -> Result<Vec<YoutubeChannelItem>, YoutubeApiError> {
        self.get_by_ids(YOUTUBE_CHANNELS_URL, "channels", "snippet", ids)
            .await
    }

    /// Reads a set of resources by id. `maxResults` is deliberately not sent: Google rejects it
    /// alongside an `id` filter, and the chunk size already bounds the response.
    async fn get_by_ids<T: serde::de::DeserializeOwned>(
        &self,
        base: &str,
        what: &str,
        part: &str,
        ids: &[String],
    ) -> Result<Vec<T>, YoutubeApiError> {
        let mut items = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(MAX_IDS_PER_REQUEST) {
            let joined = chunk.join(",");
            let url = self.public_url(base, &[("part", part), ("id", &joined)])?;
            let resp = self
                .http
                .get(url)
                .send()
                .await
                .map_err(reqwest::Error::without_url)
                .wrap_err_with(|| format!("Failed to send YouTube {what} request"))?;
            if !resp.status().is_success() {
                return Err(api_error(what, resp).await);
            }
            let page: YoutubeListResponse<T> = resp
                .json()
                .await
                .map_err(reqwest::Error::without_url)
                .wrap_err_with(|| format!("Failed to parse YouTube {what} response"))?;
            items.extend(page.items);
        }
        Ok(items)
    }
}

async fn api_error(what: &str, resp: reqwest::Response) -> YoutubeApiError {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    classify_api_error(what, status, &body)
}

/// Classifies a failed public read, separating the daily-quota rejection from everything else. The
/// body is inspected for Google's machine-readable reason before it becomes an error message.
fn classify_api_error(what: &str, status: StatusCode, body: &str) -> YoutubeApiError {
    if status == StatusCode::FORBIDDEN && has_error_reason(body, "quotaExceeded") {
        return YoutubeApiError::QuotaExceeded;
    }
    YoutubeApiError::Other(eyre!("YouTube {what} failed ({status}): {body}"))
}

/// Whether a Google API error body carries the given machine-readable `reason`. Bodies that don't
/// parse as one are treated as not matching, so an unexpected shape falls through to the generic
/// error path rather than being mistaken for a known condition.
fn has_error_reason(body: &str, reason: &str) -> bool {
    serde_json::from_str::<GoogleErrorResponse>(body)
        .map(|resp| resp.error.errors.iter().any(|e| e.reason == reason))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------------------------
// YouTube API response types
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleErrorResponse {
    error: GoogleError,
}

#[derive(Deserialize)]
struct GoogleError {
    #[serde(default)]
    errors: Vec<GoogleErrorDetail>,
}

#[derive(Deserialize)]
struct GoogleErrorDetail {
    #[serde(default)]
    reason: String,
}

/// The envelope every list endpoint wraps its results in. `items` is omitted entirely (rather than
/// sent empty) when nothing matched, which is how "this Google account owns no channel" arrives.
// The bound is spelled out because serde would otherwise infer `T: Default` from the field default.
#[derive(Deserialize)]
#[serde(bound(deserialize = "T: Deserialize<'de>"))]
struct YoutubeListResponse<T> {
    #[serde(default)]
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeChannelItem {
    id: String,
    snippet: YoutubeChannelSnippet,
    /// Only requested (and so only present) on the link-time read that resolves the uploads
    /// playlist; the periodic identity refresh asks for the snippet alone.
    #[serde(default)]
    content_details: Option<YoutubeChannelContentDetails>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeChannelSnippet {
    title: String,
    /// The channel's `@handle`. Channels are not required to have one.
    #[serde(default)]
    custom_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeChannelContentDetails {
    related_playlists: YoutubeRelatedPlaylists,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeRelatedPlaylists {
    #[serde(default)]
    uploads: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubePlaylistItem {
    content_details: YoutubePlaylistItemContentDetails,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubePlaylistItemContentDetails {
    video_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeVideo {
    id: String,
    snippet: YoutubeVideoSnippet,
    /// Absent on videos that were never broadcasts.
    #[serde(default)]
    live_streaming_details: Option<YoutubeLiveStreamingDetails>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeVideoSnippet {
    /// When the video was uploaded. Optional so that a snippet missing it costs us only that one
    /// video's timestamp, rather than failing deserialization of the whole batched `videos.list`
    /// page it arrived in and aborting the pass for every channel in it.
    #[serde(default)]
    published_at: Option<DateTime<Utc>>,
    channel_id: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    thumbnails: YoutubeThumbnails,
    #[serde(default)]
    channel_title: String,
    #[serde(default)]
    live_broadcast_content: String,
}

#[derive(Debug, Default, Deserialize)]
struct YoutubeThumbnails {
    #[serde(default)]
    medium: Option<YoutubeThumbnail>,
}

#[derive(Debug, Deserialize)]
struct YoutubeThumbnail {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeLiveStreamingDetails {
    #[serde(default)]
    actual_start_time: Option<DateTime<Utc>>,
    /// A decimal string, and absent entirely when the broadcaster has hidden the count.
    #[serde(default)]
    concurrent_viewers: Option<String>,
}

impl YoutubeVideo {
    fn is_live(&self) -> bool {
        self.snippet.live_broadcast_content == LIVE_BROADCAST_CONTENT
    }

    fn concurrent_viewers(&self) -> Option<i64> {
        self.live_streaming_details
            .as_ref()?
            .concurrent_viewers
            .as_deref()?
            .parse()
            .ok()
    }

    /// When the broadcast went on the air. A broadcast that is live always has an actual start
    /// time; the upload timestamp is a floor for the rare case where it hasn't propagated yet, and
    /// the current time for the rarer one where neither is reported at all.
    fn started_at(&self) -> DateTime<Utc> {
        self.live_streaming_details
            .as_ref()
            .and_then(|details| details.actual_start_time)
            .or(self.snippet.published_at)
            .unwrap_or_else(Utc::now)
    }

    /// YouTube serves a medium (320x180) thumbnail for every video at a predictable URL, so a
    /// snippet that omits the thumbnail map still yields a usable image rather than a blank card.
    fn thumbnail_url(&self) -> String {
        match &self.snippet.thumbnails.medium {
            Some(thumbnail) => thumbnail.url.clone(),
            None => format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", self.id),
        }
    }
}

/// The identity of the channel owned by the account that just authorized a link.
struct MyYoutubeChannel {
    channel_id: String,
    title: String,
    handle: Option<String>,
    uploads_playlist_id: String,
}

// ---------------------------------------------------------------------------------------------
// Persistent connection (DB) + live state (Redis)
// ---------------------------------------------------------------------------------------------

/// A persistent link between a ShieldBattery user and their YouTube channel.
#[derive(Debug, Clone, SimpleObject, sqlx::FromRow)]
#[graphql(complex)]
pub struct YoutubeConnection {
    #[graphql(skip)]
    pub user_id: SbUserId,
    /// YouTube's stable channel id for the linked channel.
    pub channel_id: String,
    /// The channel's display title.
    pub title: String,
    /// The channel's `@handle` (e.g. `@flash`), if it has one.
    pub handle: Option<String>,
    /// When the channel was first linked.
    pub linked_at: DateTime<Utc>,
}

#[ComplexObject]
impl YoutubeConnection {
    /// A globally unique ID for this link. At most one YouTube channel is linked per user, so this
    /// is derived from the ShieldBattery user's ID.
    async fn id(&self) -> String {
        format!("youtube-connection:{}", self.user_id)
    }
}

/// A public view of a user's linked YouTube channel, shown on their profile.
#[derive(Clone, SimpleObject)]
#[graphql(complex)]
pub struct YoutubeChannel {
    #[graphql(skip)]
    pub user_id: SbUserId,
    /// YouTube's stable channel id for the linked channel.
    pub channel_id: String,
    /// The channel's display title.
    pub title: String,
    /// The channel's `@handle` (e.g. `@flash`), if it has one.
    pub handle: Option<String>,
}

#[ComplexObject]
impl YoutubeChannel {
    /// A globally unique ID for this channel. At most one YouTube channel is linked per user, so
    /// this is derived from the ShieldBattery user's ID.
    async fn id(&self) -> String {
        format!("youtube-channel:{}", self.user_id)
    }

    /// `https://www.youtube.com/<handle>` when there is a handle, else
    /// `https://www.youtube.com/channel/<channelId>`.
    async fn url(&self) -> String {
        channel_url(&self.channel_id, self.handle.as_deref())
    }
}

/// A channel's public page. Handles are served straight off the site root, so they're used verbatim;
/// the `/channel/<id>` form always works and is the fallback for channels without one.
fn channel_url(channel_id: &str, handle: Option<&str>) -> String {
    match handle {
        Some(handle) => format!("https://www.youtube.com/{handle}"),
        None => format!("https://www.youtube.com/channel/{channel_id}"),
    }
}

/// The ephemeral "currently broadcasting" summary stored in Redis for a linked channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeLiveStreamSummary {
    pub channel_id: String,
    pub channel_title: String,
    pub video_id: String,
    pub title: String,
    /// Whether this broadcast belongs in the StarCraft feed, decided once when the entry is written
    /// so that reads never have to re-run the keyword match.
    pub is_starcraft: bool,
    /// Absent when the broadcaster hides their concurrent viewer count.
    pub viewer_count: Option<i64>,
    pub started_at: DateTime<Utc>,
    pub thumbnail_url: String,
}

impl YoutubeLiveStreamSummary {
    fn from_video(video: &YoutubeVideo, channel_title_fallback: &str) -> Self {
        let channel_title = if video.snippet.channel_title.is_empty() {
            channel_title_fallback.to_owned()
        } else {
            video.snippet.channel_title.clone()
        };

        Self {
            channel_id: video.snippet.channel_id.clone(),
            channel_title,
            video_id: video.id.clone(),
            title: video.snippet.title.clone(),
            is_starcraft: is_starcraft_broadcast(&video.snippet.title, &video.snippet.description),
            viewer_count: video.concurrent_viewers(),
            started_at: video.started_at(),
            thumbnail_url: video.thumbnail_url(),
        }
    }

    pub(crate) fn into_live_stream(self, user_id: SbUserId) -> LiveStream {
        LiveStream {
            user_id,
            feed_eligible: self.is_starcraft,
            platform: LiveStreamPlatform::Youtube,
            display_name: self.channel_title,
            url: format!("https://www.youtube.com/watch?v={}", self.video_id),
            title: self.title,
            // The Data API exposes nothing about what is being played.
            game_name: None,
            viewer_count: self
                .viewer_count
                .map(|count| count.clamp(0, i64::from(i32::MAX)) as i32),
            started_at: self.started_at,
            thumbnail_url: self.thumbnail_url,
        }
    }
}

/// Whether a broadcast counts as StarCraft: Brood War for the live-streams feed. Matches the title
/// and description together, so a generically-titled stream still qualifies on a description that
/// names the game.
fn is_starcraft_broadcast(title: &str, description: &str) -> bool {
    let haystack = format!("{title}\n{description}").to_lowercase();
    let matches_any = |keywords: &[&str]| keywords.iter().any(|keyword| haystack.contains(keyword));

    matches_any(BROOD_WAR_KEYWORDS)
        || (matches_any(STARCRAFT_KEYWORDS)
            && (!matches_any(STARCRAFT_2_KEYWORDS) || matches_any(REMASTER_KEYWORDS)))
}

/// Loads every currently-live YouTube broadcaster from Redis (unfiltered).
pub(crate) async fn load_live_streams(
    redis: &RedisPool,
) -> eyre::Result<Vec<(SbUserId, YoutubeLiveStreamSummary)>> {
    live_streams::load_all_live_streams(LIVE_STREAMS_KEY, redis).await
}

/// Loads only the live-broadcast summaries for `user_ids`.
pub(crate) async fn load_live_streams_for_users(
    redis: &RedisPool,
    user_ids: &[SbUserId],
) -> eyre::Result<Vec<(SbUserId, YoutubeLiveStreamSummary)>> {
    live_streams::load_live_streams_for_users(LIVE_STREAMS_KEY, redis, user_ids).await
}

/// Loads the field-only index of users currently broadcasting on YouTube.
pub(crate) async fn load_live_stream_user_ids(redis: &RedisPool) -> eyre::Result<Vec<SbUserId>> {
    live_streams::load_live_stream_user_ids(LIVE_STREAMS_KEY, redis).await
}

async fn load_connection(
    pool: &PgPool,
    user_id: SbUserId,
) -> eyre::Result<Option<YoutubeConnection>> {
    sqlx::query_as!(
        YoutubeConnection,
        r#"
            SELECT user_id, youtube_channel_id as channel_id, youtube_channel_title as title,
                youtube_handle as handle, linked_at
            FROM youtube_connections
            WHERE user_id = $1
        "#,
        user_id as _,
    )
    .fetch_optional(pool)
    .await
    .wrap_err("Failed to load YouTube connection")
}

/// Inserts or replaces a user's YouTube connection.
async fn upsert_connection(
    pool: &PgPool,
    user_id: SbUserId,
    channel: &MyYoutubeChannel,
) -> Result<YoutubeConnection, sqlx::Error> {
    sqlx::query_as!(
        YoutubeConnection,
        r#"
            INSERT INTO youtube_connections
                (user_id, youtube_channel_id, youtube_channel_title, youtube_handle,
                    uploads_playlist_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id) DO UPDATE SET
                youtube_channel_id = EXCLUDED.youtube_channel_id,
                youtube_channel_title = EXCLUDED.youtube_channel_title,
                youtube_handle = EXCLUDED.youtube_handle,
                uploads_playlist_id = EXCLUDED.uploads_playlist_id,
                updated_at = now()
            RETURNING user_id, youtube_channel_id as channel_id, youtube_channel_title as title,
                youtube_handle as handle, linked_at
        "#,
        user_id as _,
        channel.channel_id,
        channel.title,
        channel.handle,
        channel.uploads_playlist_id,
    )
    .fetch_one(pool)
    .await
}

/// Deletes a user's connection, returning whether there was one.
async fn delete_connection(pool: &PgPool, user_id: SbUserId) -> eyre::Result<bool> {
    let result = sqlx::query!(
        r#"DELETE FROM youtube_connections WHERE user_id = $1"#,
        user_id as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to delete YouTube connection")?;
    Ok(result.rows_affected() > 0)
}

/// Updates the stored title/handle of whichever connection currently holds this channel, if any. A
/// plain UPDATE (rather than the link-time upsert) so that an unlink racing an in-flight identity
/// refresh can't have its deleted connection re-inserted.
async fn update_connection_identity(
    pool: &PgPool,
    channel_id: &str,
    title: &str,
    handle: Option<&str>,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE youtube_connections
            SET youtube_channel_title = $2, youtube_handle = $3, updated_at = now()
            WHERE youtube_channel_id = $1
        "#,
        channel_id,
        title,
        handle,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to update YouTube connection identity")?;
    Ok(())
}

/// What the periodic live refresh needs about one linked channel: which playlist to poll, which
/// channel the videos it finds must belong to, and the name to fall back on if a video's snippet
/// carries no channel title.
#[derive(Debug, Clone)]
struct LiveRefreshTarget {
    channel_id: String,
    channel_title: String,
    uploads_playlist_id: String,
}

async fn load_live_refresh_connections(
    pool: &PgPool,
) -> eyre::Result<HashMap<SbUserId, LiveRefreshTarget>> {
    let rows = sqlx::query!(
        r#"
            SELECT user_id as "user_id: SbUserId", youtube_channel_id, youtube_channel_title,
                uploads_playlist_id
            FROM youtube_connections
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load YouTube connections")?;

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.user_id,
                LiveRefreshTarget {
                    channel_id: row.youtube_channel_id,
                    channel_title: row.youtube_channel_title,
                    uploads_playlist_id: row.uploads_playlist_id,
                },
            )
        })
        .collect())
}

/// The stored identity of one linked channel, for the periodic refresh that catches renames.
struct StoredIdentity {
    user_id: SbUserId,
    channel_id: String,
    title: String,
    handle: Option<String>,
}

async fn load_stored_identities(pool: &PgPool) -> eyre::Result<Vec<StoredIdentity>> {
    let rows = sqlx::query!(
        r#"
            SELECT user_id as "user_id: SbUserId", youtube_channel_id, youtube_channel_title,
                youtube_handle
            FROM youtube_connections
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load YouTube connections")?;

    Ok(rows
        .into_iter()
        .map(|row| StoredIdentity {
            user_id: row.user_id,
            channel_id: row.youtube_channel_id,
            title: row.youtube_channel_title,
            handle: row.youtube_handle,
        })
        .collect())
}

// ---------------------------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------------------------

/// The result of starting a YouTube link: the authorize URL the client should open.
#[derive(SimpleObject)]
pub struct YoutubeLinkStart {
    /// The Google OAuth authorize URL the client should open (e.g. in a popup) to begin linking.
    pub url: String,
}

/// Batches per-user YouTube channel lookups so that selecting `youtubeChannel` on a list of users
/// doesn't fan out into one DB query each.
pub struct YoutubeChannelLoader {
    db: PgPool,
}

impl YoutubeChannelLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbUserId> for YoutubeChannelLoader {
    type Value = YoutubeChannel;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, Self::Value>, Self::Error> {
        Ok(sqlx::query!(
            r#"
                SELECT user_id as "user_id: SbUserId", youtube_channel_id, youtube_channel_title,
                    youtube_handle
                FROM youtube_connections
                WHERE user_id = ANY($1)
            "#,
            keys as _,
        )
        .fetch(&self.db)
        .map_ok(|r| {
            (
                r.user_id,
                YoutubeChannel {
                    user_id: r.user_id,
                    channel_id: r.youtube_channel_id,
                    title: r.youtube_channel_title,
                    handle: r.youtube_handle,
                },
            )
        })
        .try_collect()
        .await?)
    }
}

pub struct YoutubeModule {
    db_pool: PgPool,
}

impl YoutubeModule {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }
}

impl SchemaBuilderModule for YoutubeModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder.data(DataLoader::new(
            YoutubeChannelLoader::new(self.db_pool.clone()),
            tokio::spawn,
        ))
    }
}

fn require_youtube_client<'a>(
    ctx: &'a Context<'_>,
) -> async_graphql::Result<&'a Arc<YoutubeClient>> {
    ctx.data::<Option<Arc<YoutubeClient>>>()?
        .as_ref()
        .ok_or_else(|| {
            graphql_error(
                "YOUTUBE_NOT_CONFIGURED",
                "YouTube integration is not configured",
            )
        })
}

#[derive(Default)]
pub struct YoutubeQuery;

#[Object]
impl YoutubeQuery {
    /// The current user's linked YouTube connection, or `null` if they haven't linked one.
    async fn my_youtube_connection(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<YoutubeConnection>> {
        let user = require_current_user(ctx)?;
        Ok(load_connection(ctx.data::<PgPool>()?, user.id).await?)
    }
}

#[derive(Default)]
pub struct YoutubeMutation;

#[Object]
impl YoutubeMutation {
    /// Begins linking the current user's YouTube channel, returning the Google OAuth authorize URL
    /// the client should open. Completing the flow calls `youtubeCompleteLink` with the resulting
    /// `code` and `state`. `desktop` selects the loopback redirect URI used by the desktop app
    /// instead of our web callback.
    async fn youtube_start_link(
        &self,
        ctx: &Context<'_>,
        #[graphql(default)] desktop: bool,
    ) -> async_graphql::Result<YoutubeLinkStart> {
        let user = require_current_user(ctx)?;
        let client = require_youtube_client(ctx)?;
        let redirect_uri = client.redirect_uri_for(desktop);

        let state = oauth_link::store_pending_link(
            ctx.data::<RedisPool>()?,
            LINK_KEY_PREFIX,
            user.id,
            redirect_uri,
        )
        .await?;

        Ok(YoutubeLinkStart {
            url: client.authorize_url(&state, redirect_uri)?,
        })
    }

    /// Completes linking the current user's YouTube channel using the `code` and `state` returned by
    /// the Google OAuth redirect.
    async fn youtube_complete_link(
        &self,
        ctx: &Context<'_>,
        code: String,
        state: String,
    ) -> async_graphql::Result<YoutubeConnection> {
        let user = require_current_user(ctx)?;
        let client = require_youtube_client(ctx)?;
        let pool = ctx.data::<PgPool>()?;
        let redis_pool = ctx.data::<RedisPool>()?;

        let Some(pending) =
            oauth_link::consume_pending_link(redis_pool, LINK_KEY_PREFIX, &state, user.id).await?
        else {
            return Err(graphql_error(
                "YOUTUBE_INVALID_STATE",
                "Your YouTube linking request was invalid or expired. Please try again.",
            ));
        };

        let access_token = client
            .exchange_code(&code, &pending.redirect_uri)
            .await
            .map_err(|e| {
                error!("Google code exchange failed: {e:?}");
                graphql_error(
                    "YOUTUBE_EXCHANGE_FAILED",
                    "Failed to complete YouTube linking",
                )
            })?;
        let channel = client.get_my_channel(&access_token).await.map_err(|e| {
            error!("YouTube channels (mine) failed: {e:?}");
            graphql_error(
                "YOUTUBE_EXCHANGE_FAILED",
                "Failed to complete YouTube linking",
            )
        })?;
        // The token has served its only purpose either way, so give it back before deciding whether
        // the link can go through.
        client.revoke_token(&access_token).await;

        let Some(channel) = channel else {
            return Err(graphql_error(
                "YOUTUBE_NO_CHANNEL",
                "That Google account has no YouTube channel.",
            ));
        };

        let connection = match upsert_connection(pool, user.id, &channel).await {
            Ok(connection) => connection,
            Err(e) => {
                if e.as_database_error().and_then(|db| db.constraint())
                    == Some("youtube_connections_youtube_channel_id_key")
                {
                    return Err(graphql_error(
                        "YOUTUBE_ALREADY_LINKED",
                        "That YouTube channel is already linked to another ShieldBattery account.",
                    ));
                }
                error!("Failed to upsert YouTube connection: {e:?}");
                return Err(graphql_error(
                    "YOUTUBE_LINK_FAILED",
                    "Failed to link YouTube channel",
                ));
            }
        };

        // Reflect the channel's current broadcast status immediately: this clears any stale entry
        // left over from a previous link and surfaces users who linked while already broadcasting,
        // who would otherwise stay invisible until the next refresh pass.
        if let Err(e) = refresh_channel_live_state(client, redis_pool, user.id, &channel).await {
            error!("Failed to refresh YouTube live state on link: {e:?}");
        }

        Ok(connection)
    }

    /// Removes the current user's YouTube connection. Returns whether a connection was removed.
    async fn youtube_unlink(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        let user = require_current_user(ctx)?;

        if !delete_connection(ctx.data::<PgPool>()?, user.id).await? {
            return Ok(false);
        }

        if let Err(e) =
            live_streams::set_stream_offline(LIVE_STREAMS_KEY, ctx.data::<RedisPool>()?, user.id)
                .await
        {
            error!("Failed to clear YouTube live stream on unlink: {e:?}");
        }

        Ok(true)
    }
}

// ---------------------------------------------------------------------------------------------
// Refresh loops
// ---------------------------------------------------------------------------------------------

/// Picks the broadcast to show for a channel: the live ones it actually owns (an uploads playlist
/// can carry videos Google attributes elsewhere), most concurrent viewers first, ties broken by the
/// earliest start so a channel running several at once stays on the same one between passes.
/// Broadcasts with a hidden viewer count lose to any broadcast that reports one.
fn best_live_broadcast<'a>(
    channel_id: &str,
    videos: impl IntoIterator<Item = &'a YoutubeVideo>,
) -> Option<&'a YoutubeVideo> {
    videos
        .into_iter()
        .filter(|video| video.is_live() && video.snippet.channel_id == channel_id)
        .min_by_key(|video| {
            (
                std::cmp::Reverse(video.concurrent_viewers()),
                video.started_at(),
            )
        })
}

const LIVE_REFRESH_PASSES_TOTAL: &str = "youtube_live_refresh_passes_total";

/// Registers metric descriptions (the HELP/TYPE text on `/metrics`). Safe to call once at startup;
/// recording a metric without describing it still works, this just produces nicer output.
pub fn describe_youtube_metrics() {
    use ::metrics::Unit;

    ::metrics::describe_counter!(
        LIVE_REFRESH_PASSES_TOTAL,
        Unit::Count,
        "YouTube live-broadcast refresh passes, per outcome. A pass that stops on an exhausted \
         daily quota freezes everyone's live state until the quota resets without anything \
         failing, so short of reading log lines this counter is the only signal that it \
         happened."
    );
}

/// Reports a pass that ran into the daily quota. Every remaining call in the pass would fail the
/// same way, so it stops after one line rather than repeating the same API error per channel.
fn warn_quota_exhausted(pass: &str) {
    warn!(
        "YouTube Data API daily quota is exhausted; skipping this {pass} and leaving the stored \
         state untouched"
    );
}

struct TrackedStreams {
    /// Users whose Redis entry still matches their linked channel, so a clear is only worth issuing
    /// for these when they turn out not to be broadcasting.
    tracked: HashSet<SbUserId>,
    /// Entries naming a channel nobody has linked any more. Nothing will ever clear these
    /// otherwise: the relink or failed unlink that stranded them also took away the connection the
    /// refresh would have polled.
    orphaned: Vec<SbUserId>,
}

fn partition_tracked_streams(
    live: Vec<(SbUserId, YoutubeLiveStreamSummary)>,
    connections: &HashMap<SbUserId, LiveRefreshTarget>,
) -> TrackedStreams {
    let mut tracked = HashSet::new();
    let mut orphaned = Vec::new();
    for (user_id, summary) in live {
        match connections.get(&user_id) {
            Some(target) if target.channel_id == summary.channel_id => {
                tracked.insert(user_id);
            }
            _ => orphaned.push(user_id),
        }
    }
    TrackedStreams { tracked, orphaned }
}

/// Reconciles one channel's Redis live state with what it is broadcasting right now. Used when a
/// channel is (re)linked, to immediately reflect an in-progress broadcast or clear a stale entry
/// from a prior link.
async fn refresh_channel_live_state(
    client: &YoutubeClient,
    redis: &RedisPool,
    user_id: SbUserId,
    channel: &MyYoutubeChannel,
) -> Result<(), YoutubeApiError> {
    let video_ids = client
        .list_upload_video_ids(&channel.uploads_playlist_id)
        .await?;
    let videos = client.get_videos(&video_ids).await?;

    match best_live_broadcast(&channel.channel_id, &videos) {
        Some(video) => {
            let summary = YoutubeLiveStreamSummary::from_video(video, &channel.title);
            live_streams::set_stream_live(LIVE_STREAMS_KEY, redis, user_id, &summary).await?
        }
        None => live_streams::set_stream_offline(LIVE_STREAMS_KEY, redis, user_id).await?,
    }
    Ok(())
}

/// Polls every linked channel for a live broadcast and reconciles the `youtube:live` Redis hash with
/// what it finds. This is the only thing that ever marks a YouTube user live or offline -- Google
/// pushes us nothing -- so a user goes live in the feed up to `LIVE_REFRESH_INTERVAL` after they
/// actually do.
pub async fn refresh_live_streams_loop(client: Arc<YoutubeClient>, db: PgPool, redis: RedisPool) {
    let mut interval = tokio::time::interval(LIVE_REFRESH_INTERVAL);
    loop {
        interval.tick().await;
        let outcome = match refresh_all_live_streams(&client, &db, &redis).await {
            Ok(RefreshOutcome::Ok) => "ok",
            Ok(RefreshOutcome::QuotaExceeded) => "quota_exceeded",
            Err(e) => {
                error!("YouTube live-stream refresh failed: {e:?}");
                "failed"
            }
        };
        ::metrics::counter!(LIVE_REFRESH_PASSES_TOTAL, "outcome" => outcome).increment(1);
    }
}

/// How a refresh pass ended. A quota-exhausted pass is neither a success nor a failure: nothing
/// went wrong, but no live state was reconciled either.
enum RefreshOutcome {
    Ok,
    QuotaExceeded,
}

async fn refresh_all_live_streams(
    client: &YoutubeClient,
    db: &PgPool,
    redis: &RedisPool,
) -> eyre::Result<RefreshOutcome> {
    let connections = load_live_refresh_connections(db).await?;
    let live = load_live_streams(redis).await?;

    let TrackedStreams { tracked, orphaned } = partition_tracked_streams(live, &connections);
    live_streams::apply_live_stream_updates::<YoutubeLiveStreamSummary>(
        LIVE_STREAMS_KEY,
        redis,
        &[],
        &orphaned,
    )
    .await?;

    if connections.is_empty() {
        return Ok(RefreshOutcome::Ok);
    }

    // Owned playlist ids rather than borrows of `connections`: the returned stream would otherwise
    // hold a borrow whose lifetime can't be named in the spawned refresh task.
    let poll_targets: Vec<(SbUserId, String)> = connections
        .iter()
        .map(|(user_id, target)| (*user_id, target.uploads_playlist_id.clone()))
        .collect();
    let uploads = stream::iter(poll_targets)
        .map(|(user_id, playlist_id)| async move {
            (user_id, client.list_upload_video_ids(&playlist_id).await)
        })
        .buffer_unordered(UPLOADS_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let mut video_ids_by_user: HashMap<SbUserId, Vec<String>> = HashMap::new();
    let mut all_video_ids: Vec<String> = Vec::new();
    let mut quota_exceeded = false;
    for (user_id, result) in uploads {
        match result {
            Ok(ids) => {
                all_video_ids.extend(ids.iter().cloned());
                video_ids_by_user.insert(user_id, ids);
            }
            Err(YoutubeApiError::QuotaExceeded) => quota_exceeded = true,
            // A channel we couldn't read tells us nothing about whether it is broadcasting, so its
            // entry is left exactly as it was rather than being cleared on no evidence.
            Err(e) => warn!("Failed to list YouTube uploads for user {user_id}: {e:?}"),
        }
    }
    if quota_exceeded {
        warn_quota_exhausted("live-stream refresh");
        return Ok(RefreshOutcome::QuotaExceeded);
    }

    let videos = match client.get_videos(&all_video_ids).await {
        Ok(videos) => videos,
        Err(YoutubeApiError::QuotaExceeded) => {
            warn_quota_exhausted("live-stream refresh");
            return Ok(RefreshOutcome::QuotaExceeded);
        }
        Err(YoutubeApiError::Other(e)) => return Err(e),
    };
    let videos_by_id: HashMap<&str, &YoutubeVideo> = videos
        .iter()
        .map(|video| (video.id.as_str(), video))
        .collect();

    let mut live_updates = Vec::new();
    let mut offline_updates = Vec::new();
    for (user_id, video_ids) in &video_ids_by_user {
        let Some(target) = connections.get(user_id) else {
            continue;
        };
        let candidates = video_ids
            .iter()
            .filter_map(|id| videos_by_id.get(id.as_str()).copied());
        match best_live_broadcast(&target.channel_id, candidates) {
            Some(video) => live_updates.push((
                *user_id,
                YoutubeLiveStreamSummary::from_video(video, &target.channel_title),
            )),
            // Only clear entries we're actually tracking so we don't issue an HDEL per offline
            // channel every pass.
            None if tracked.contains(user_id) => offline_updates.push(*user_id),
            None => {}
        }
    }
    live_streams::apply_live_stream_updates(
        LIVE_STREAMS_KEY,
        redis,
        &live_updates,
        &offline_updates,
    )
    .await?;

    Ok(RefreshOutcome::Ok)
}

/// Keeps stored channel titles and handles current. Channels can be renamed (and handles released
/// and reclaimed) while their channel id stays stable, and we otherwise only capture the name at
/// link time, leaving profile links and labels stale.
pub async fn refresh_identities_loop(client: Arc<YoutubeClient>, db: PgPool) {
    let mut interval = tokio::time::interval(IDENTITY_REFRESH_INTERVAL);
    loop {
        interval.tick().await;
        if let Err(e) = refresh_connection_identities(&client, &db).await {
            error!("YouTube identity refresh failed: {e:?}");
        }
    }
}

async fn refresh_connection_identities(client: &YoutubeClient, db: &PgPool) -> eyre::Result<()> {
    let stored = load_stored_identities(db).await?;
    if stored.is_empty() {
        return Ok(());
    }

    let ids: Vec<String> = stored
        .iter()
        .map(|identity| identity.channel_id.clone())
        .collect();
    let by_id: HashMap<String, YoutubeChannelItem> = match client.get_channels(&ids).await {
        Ok(channels) => channels
            .into_iter()
            .map(|channel| (channel.id.clone(), channel))
            .collect(),
        Err(YoutubeApiError::QuotaExceeded) => {
            warn_quota_exhausted("identity refresh");
            return Ok(());
        }
        Err(YoutubeApiError::Other(e)) => return Err(e),
    };

    for identity in &stored {
        // Channels Google no longer returns (deleted, suspended) keep their last-known identity.
        let Some(channel) = by_id.get(&identity.channel_id) else {
            continue;
        };
        if channel.snippet.title == identity.title && channel.snippet.custom_url == identity.handle
        {
            continue;
        }
        if let Err(e) = update_connection_identity(
            db,
            &identity.channel_id,
            &channel.snippet.title,
            channel.snippet.custom_url.as_deref(),
        )
        .await
        {
            error!(
                "Failed to refresh YouTube identity for user {}: {e:?}",
                identity.user_id
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str, channel_id: &str, live_content: &str) -> YoutubeVideo {
        YoutubeVideo {
            id: id.to_owned(),
            snippet: YoutubeVideoSnippet {
                published_at: Some(
                    DateTime::parse_from_rfc3339("2026-09-22T10:00:00Z")
                        .unwrap()
                        .with_timezone(&Utc),
                ),
                channel_id: channel_id.to_owned(),
                title: "StarCraft ladder".to_owned(),
                description: String::new(),
                thumbnails: YoutubeThumbnails::default(),
                channel_title: "Streamer".to_owned(),
                live_broadcast_content: live_content.to_owned(),
            },
            live_streaming_details: None,
        }
    }

    fn broadcasting(
        id: &str,
        channel_id: &str,
        viewers: Option<&str>,
        started_at: &str,
    ) -> YoutubeVideo {
        let mut video = video(id, channel_id, LIVE_BROADCAST_CONTENT);
        video.live_streaming_details = Some(YoutubeLiveStreamingDetails {
            actual_start_time: Some(
                DateTime::parse_from_rfc3339(started_at)
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            concurrent_viewers: viewers.map(ToOwned::to_owned),
        });
        video
    }

    fn summary(channel_id: &str) -> YoutubeLiveStreamSummary {
        YoutubeLiveStreamSummary {
            channel_id: channel_id.to_owned(),
            channel_title: "Streamer".to_owned(),
            video_id: "vid".to_owned(),
            title: "StarCraft ladder".to_owned(),
            is_starcraft: true,
            viewer_count: Some(42),
            started_at: DateTime::parse_from_rfc3339("2026-09-22T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            thumbnail_url: "https://i.ytimg.com/vi/vid/mqdefault.jpg".to_owned(),
        }
    }

    fn refresh_target(channel_id: &str) -> LiveRefreshTarget {
        LiveRefreshTarget {
            channel_id: channel_id.to_owned(),
            channel_title: "Streamer".to_owned(),
            uploads_playlist_id: "UU123".to_owned(),
        }
    }

    #[test]
    fn starcraft_detection_matches_title_or_description_case_insensitively() {
        assert!(is_starcraft_broadcast("StarCraft ladder grind", ""));
        assert!(is_starcraft_broadcast("LADDER", "playing some BROOD WAR"));
        assert!(is_starcraft_broadcast("sc:r ladder", ""));
        assert!(is_starcraft_broadcast("래더 방송", "스타크래프트 리마스터"));
        assert!(is_starcraft_broadcast("Star Craft with friends", ""));
        assert!(is_starcraft_broadcast("StarCraft: Remastered ladder", ""));
        assert!(is_starcraft_broadcast("스타크래프트 리마스터", ""));

        assert!(!is_starcraft_broadcast("Just chatting", "no games today"));
        assert!(!is_starcraft_broadcast(
            "Warcraft III ladder",
            "orcs and humans"
        ));
    }

    #[test]
    fn starcraft_detection_excludes_starcraft_ii() {
        assert!(!is_starcraft_broadcast("StarCraft II ladder", ""));
        assert!(!is_starcraft_broadcast("SC2 grandmaster", ""));
        assert!(!is_starcraft_broadcast("스타2 래더", ""));

        // A Brood War marker wins outright, and naming the remaster disambiguates a broadcast that
        // covers both games.
        assert!(is_starcraft_broadcast(
            "starcraft 2 vs brood war showmatch",
            ""
        ));
        assert!(is_starcraft_broadcast(
            "StarCraft: Remastered vs StarCraft II showmatch",
            ""
        ));

        // The remaster keywords never qualify a broadcast on their own.
        assert!(!is_starcraft_broadcast("Age of Empires II Remastered", ""));
    }

    #[test]
    fn best_broadcast_prefers_most_viewers_then_earliest_start() {
        let videos = vec![
            broadcasting("low", "chan", Some("10"), "2026-09-22T12:00:00Z"),
            broadcasting("high-late", "chan", Some("500"), "2026-09-22T13:00:00Z"),
            broadcasting("high-early", "chan", Some("500"), "2026-09-22T11:00:00Z"),
        ];

        let best = best_live_broadcast("chan", &videos).unwrap();

        assert_eq!(best.id, "high-early");
    }

    #[test]
    fn best_broadcast_ignores_other_channels_and_non_live_videos() {
        let videos = vec![
            video("upload", "chan", "none"),
            video("scheduled", "chan", "upcoming"),
            broadcasting(
                "elsewhere",
                "other-chan",
                Some("900"),
                "2026-09-22T11:00:00Z",
            ),
            broadcasting("ours", "chan", None, "2026-09-22T12:00:00Z"),
        ];

        let best = best_live_broadcast("chan", &videos).unwrap();

        assert_eq!(best.id, "ours");
        assert!(best_live_broadcast("chan", &videos[..3]).is_none());
    }

    #[test]
    fn best_broadcast_ranks_a_hidden_viewer_count_below_a_reported_one() {
        let videos = vec![
            broadcasting("hidden", "chan", None, "2026-09-22T11:00:00Z"),
            broadcasting("reported", "chan", Some("1"), "2026-09-22T13:00:00Z"),
        ];

        let best = best_live_broadcast("chan", &videos).unwrap();

        assert_eq!(best.id, "reported");
    }

    #[test]
    fn tracked_streams_separate_orphans_from_entries_backed_by_a_connection() {
        let connections = HashMap::from([
            (SbUserId(1), refresh_target("chan-1")),
            // This user relinked to a different channel since their entry was written.
            (SbUserId(2), refresh_target("chan-other")),
        ]);
        let live = vec![
            (SbUserId(1), summary("chan-1")),
            (SbUserId(2), summary("chan-2")),
            // This user unlinked entirely.
            (SbUserId(3), summary("chan-3")),
        ];

        let TrackedStreams { tracked, orphaned } = partition_tracked_streams(live, &connections);

        assert_eq!(tracked, HashSet::from([SbUserId(1)]));
        assert_eq!(orphaned, vec![SbUserId(2), SbUserId(3)]);
    }

    #[test]
    fn live_stream_refresh_updates_target_the_youtube_hash() {
        let live = vec![(SbUserId(7), summary("chan-7"))];
        let offline = vec![SbUserId(9)];

        let actual =
            live_streams::live_stream_updates_pipeline(LIVE_STREAMS_KEY, &live, &offline).unwrap();

        let mut expected = deadpool_redis::redis::pipe();
        expected
            .cmd("HSET")
            .arg("youtube:live")
            .arg(7)
            .arg(serde_json::to_string(&live[0].1).unwrap())
            .ignore()
            .cmd("HDEL")
            .arg("youtube:live")
            .arg(9)
            .ignore();

        assert_eq!(actual.get_packed_pipeline(), expected.get_packed_pipeline());
    }

    #[test]
    fn live_stream_summary_is_stored_as_camel_case_json() {
        let json = serde_json::to_value(summary("chan-7")).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "channelId": "chan-7",
                "channelTitle": "Streamer",
                "videoId": "vid",
                "title": "StarCraft ladder",
                "isStarcraft": true,
                "viewerCount": 42,
                "startedAt": "2026-09-22T12:00:00Z",
                "thumbnailUrl": "https://i.ytimg.com/vi/vid/mqdefault.jpg",
            })
        );
    }

    #[test]
    fn a_video_without_a_thumbnail_map_falls_back_to_the_predictable_url() {
        let video = broadcasting("abc123", "chan", Some("5"), "2026-09-22T12:00:00Z");

        let built = YoutubeLiveStreamSummary::from_video(&video, "Fallback");

        assert_eq!(
            built.thumbnail_url,
            "https://i.ytimg.com/vi/abc123/mqdefault.jpg"
        );
        assert_eq!(built.channel_title, "Streamer");
        assert_eq!(built.viewer_count, Some(5));
    }

    #[test]
    fn channel_url_prefers_the_handle() {
        assert_eq!(
            channel_url("UC123", Some("@flash")),
            "https://www.youtube.com/@flash"
        );
        assert_eq!(
            channel_url("UC123", None),
            "https://www.youtube.com/channel/UC123"
        );
    }

    #[test]
    fn quota_exhaustion_is_recognized_from_googles_error_body() {
        let quota = r#"{"error":{"code":403,"errors":[{"domain":"youtube.quota",
            "reason":"quotaExceeded","message":"The request cannot be completed."}]}}"#;

        assert!(matches!(
            classify_api_error("videos", StatusCode::FORBIDDEN, quota),
            YoutubeApiError::QuotaExceeded
        ));
        // A 403 for any other reason is an ordinary per-call failure, not grounds for abandoning
        // the whole pass.
        assert!(matches!(
            classify_api_error(
                "videos",
                StatusCode::FORBIDDEN,
                r#"{"error":{"code":403,"errors":[{"reason":"forbidden"}]}}"#,
            ),
            YoutubeApiError::Other(_)
        ));
        assert!(matches!(
            classify_api_error("videos", StatusCode::NOT_FOUND, quota),
            YoutubeApiError::Other(_)
        ));
        assert!(matches!(
            classify_api_error("videos", StatusCode::FORBIDDEN, "not json at all"),
            YoutubeApiError::Other(_)
        ));

        assert!(has_error_reason(quota, "quotaExceeded"));
        assert!(!has_error_reason(quota, "playlistNotFound"));
    }
}
