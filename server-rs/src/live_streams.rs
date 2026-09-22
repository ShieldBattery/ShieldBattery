//! Live streams across every platform we integrate with: the GraphQL feed and per-user lookups, the
//! admin feed blocks, and the Redis plumbing each platform's module reuses.
//!
//! Every platform owns a Redis hash of `sbUserId -> <that platform's summary JSON>` (`twitch:live`,
//! `youtube:live`), written by that platform's refresh path and read here. A platform turns its own
//! summary into a `LiveStream` through its own constructor, which is also where it decides whether
//! the broadcast is StarCraft enough for the feed (`feed_eligible`) -- how that's determined differs
//! per platform, but nothing outside the platform's module needs to know how.
//!
//! A user can be live on several platforms at once, so per-user lookups return a list and the ids of
//! `LiveStream`s are qualified by platform.

use std::collections::{HashMap, HashSet};

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{ComplexObject, Context, Object, SchemaBuilder, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, Context as _};
use deadpool_redis::redis::{AsyncCommands, Cmd, RedisResult, aio::ConnectionLike};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::PgPool;
use tracing::warn;

use crate::graphql::errors::graphql_error;
use crate::graphql::schema_builder::SchemaBuilderModule;
use crate::redis::RedisPool;
use crate::users::permissions::RequiredPermission;
use crate::users::{SbUser, SbUserId, UsersLoader, require_current_user};

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

/// The platform a broadcast is happening on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, async_graphql::Enum)]
pub enum LiveStreamPlatform {
    Twitch,
    Youtube,
}

impl LiveStreamPlatform {
    /// The platform's segment in a `LiveStream` ID. Part of a client-visible ID, so it must stay
    /// stable.
    fn id_segment(self) -> &'static str {
        match self {
            Self::Twitch => "twitch",
            Self::Youtube => "youtube",
        }
    }
}

/// A ShieldBattery user's live broadcast on one platform.
#[derive(Clone, SimpleObject)]
#[graphql(complex)]
pub struct LiveStream {
    #[graphql(skip)]
    pub user_id: SbUserId,
    /// Whether this broadcast belongs in the StarCraft live-streams feed. Decided by the platform
    /// that built this stream, since only it knows what its API exposes about the game being played.
    #[graphql(skip)]
    pub feed_eligible: bool,
    pub platform: LiveStreamPlatform,
    /// Twitch display name / YouTube channel title.
    pub display_name: String,
    /// Where to watch: `https://twitch.tv/<login>` or `https://www.youtube.com/watch?v=<videoId>`.
    pub url: String,
    /// The broadcast's title.
    pub title: String,
    /// Twitch category name; null on YouTube (no game metadata is exposed).
    pub game_name: Option<String>,
    /// Null when the platform doesn't report a count (YouTube hides it for some broadcasts).
    pub viewer_count: Option<i32>,
    /// When the broadcast started.
    pub started_at: DateTime<Utc>,
    /// A ready-to-use thumbnail URL at a fixed size.
    pub thumbnail_url: String,
}

#[ComplexObject]
impl LiveStream {
    /// Globally unique: `stream:twitch:<userId>` or `stream:youtube:<userId>`.
    async fn id(&self) -> String {
        format!("stream:{}:{}", self.platform.id_segment(), self.user_id)
    }

    /// The ShieldBattery user who is streaming.
    async fn user(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<SbUser>> {
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(self.user_id)
            .await
    }
}

/// A streamer an admin has blocked from the live-streams feed (shown on the home page and the
/// dedicated live streams page), for the admin blocked-streams list. The block hides them from the
/// `liveStreams` feed only. The per-platform channel identities come from the connections the user
/// has linked right now (via LEFT JOINs), so they're absent for any platform they haven't linked or
/// have since unlinked.
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
    /// The title of the blocked user's currently-linked YouTube channel, if they still have one.
    pub youtube_channel_title: Option<String>,
    /// The `@handle` of the blocked user's currently-linked YouTube channel, if it has one.
    pub youtube_handle: Option<String>,
    /// When the block was created.
    pub created_at: DateTime<Utc>,
}

#[ComplexObject]
impl BlockedStream {
    /// A globally unique ID for this block. At most one block exists per user, so this is derived
    /// from the blocked user's ID.
    async fn id(&self) -> String {
        format!("blocked-stream:{}", self.user_id)
    }

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

// ---------------------------------------------------------------------------------------------
// Live state (Redis)
//
// Generic over the per-platform summary type and the hash key, so every platform gets identical
// parsing, malformed-entry cleanup and batching behaviour without duplicating it.
// ---------------------------------------------------------------------------------------------

pub(crate) struct ParsedLiveStreamEntries<T> {
    pub(crate) streams: Vec<(SbUserId, T)>,
    pub(crate) malformed: Vec<(SbUserId, String)>,
}

pub(crate) fn parse_live_stream_entries<T: DeserializeOwned>(
    key: &str,
    entries: impl IntoIterator<Item = (SbUserId, Option<String>)>,
) -> ParsedLiveStreamEntries<T> {
    let entries = entries.into_iter();
    let (lower_bound, _) = entries.size_hint();
    let mut streams = Vec::with_capacity(lower_bound);
    let mut malformed = Vec::new();

    for (user_id, json) in entries {
        let Some(json) = json else {
            continue;
        };
        match serde_json::from_str::<T>(&json) {
            Ok(summary) => streams.push((user_id, summary)),
            Err(e) => {
                warn!("Failed to parse {key} entry for user {}: {e:?}", user_id.0);
                malformed.push((user_id, json));
            }
        }
    }

    ParsedLiveStreamEntries { streams, malformed }
}

pub(crate) fn remove_malformed_live_streams_command(
    key: &str,
    entries: &[(SbUserId, String)],
) -> Cmd {
    let mut cmd = deadpool_redis::redis::cmd("EVAL");
    cmd.arg(REMOVE_MALFORMED_LIVE_STREAMS_SCRIPT)
        .arg(1)
        .arg(key);
    for (user_id, json) in entries {
        cmd.arg(i32::from(*user_id)).arg(json);
    }
    cmd
}

async fn remove_malformed_live_streams(
    key: &str,
    conn: &mut impl ConnectionLike,
    entries: &[(SbUserId, String)],
) {
    if entries.is_empty() {
        return;
    }

    let result: RedisResult<usize> = remove_malformed_live_streams_command(key, entries)
        .query_async(conn)
        .await;
    if let Err(e) = result {
        // Malformed entries have always been omitted from results. Cleanup is only a safeguard for
        // the field-only live-user-id query, so a cleanup failure must not turn a successful read
        // into a GraphQL error.
        warn!("Failed to remove malformed {key} entries from Redis: {e:?}");
    }
}

pub(crate) async fn load_live_stream_user_ids_from_connection(
    key: &str,
    redis: &mut impl AsyncCommands,
) -> RedisResult<Vec<SbUserId>> {
    let user_ids: Vec<i32> = redis.hkeys(key).await?;
    Ok(user_ids.into_iter().map(SbUserId).collect())
}

pub(crate) async fn load_live_stream_values_from_connection(
    key: &str,
    redis: &mut impl AsyncCommands,
    user_ids: &[SbUserId],
) -> RedisResult<Vec<Option<String>>> {
    let fields: Vec<i32> = user_ids.iter().copied().map(i32::from).collect();
    redis.hmget(key, fields).await
}

/// Loads every currently-live streamer on one platform from Redis (unfiltered).
pub(crate) async fn load_all_live_streams<T: DeserializeOwned>(
    key: &str,
    redis: &RedisPool,
) -> eyre::Result<Vec<(SbUserId, T)>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let entries: HashMap<i32, String> = conn
        .hgetall(key)
        .await
        .wrap_err_with(|| format!("Failed to load {key}"))?;
    let parsed = parse_live_stream_entries::<T>(
        key,
        entries
            .into_iter()
            .map(|(user_id, json)| (SbUserId(user_id), Some(json))),
    );
    remove_malformed_live_streams(key, &mut conn, &parsed.malformed).await;
    Ok(parsed.streams)
}

/// Loads only the summaries for `user_ids`, preserving the input/result alignment long enough to
/// associate each Redis value with its user before invalid or missing values are omitted.
pub(crate) async fn load_live_streams_for_users<T: DeserializeOwned>(
    key: &str,
    redis: &RedisPool,
    user_ids: &[SbUserId],
) -> eyre::Result<Vec<(SbUserId, T)>> {
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let values = load_live_stream_values_from_connection(key, &mut conn, user_ids)
        .await
        .wrap_err_with(|| format!("Failed to load {key}"))?;
    let parsed = parse_live_stream_entries::<T>(key, user_ids.iter().copied().zip(values));
    remove_malformed_live_streams(key, &mut conn, &parsed.malformed).await;
    Ok(parsed.streams)
}

/// Loads the field-only live-user index. The typed writer serializes a complete summary before HSET,
/// so normal entries are valid; full/detail reads atomically remove any malformed legacy or corrupt
/// values they encounter.
pub(crate) async fn load_live_stream_user_ids(
    key: &str,
    redis: &RedisPool,
) -> eyre::Result<Vec<SbUserId>> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    load_live_stream_user_ids_from_connection(key, &mut conn)
        .await
        .wrap_err_with(|| format!("Failed to load {key}"))
}

pub(crate) async fn set_stream_live<T: Serialize>(
    key: &str,
    redis: &RedisPool,
    user_id: SbUserId,
    summary: &T,
) -> eyre::Result<()> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    let json = serde_json::to_string(summary).wrap_err("Failed to serialize live stream")?;
    conn.hset::<_, _, _, ()>(key, i32::from(user_id), json)
        .await
        .wrap_err_with(|| format!("Failed to store {key} entry"))?;
    Ok(())
}

pub(crate) async fn set_stream_offline(
    key: &str,
    redis: &RedisPool,
    user_id: SbUserId,
) -> eyre::Result<()> {
    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    conn.hdel::<_, _, ()>(key, i32::from(user_id))
        .await
        .wrap_err_with(|| format!("Failed to clear {key} entry"))?;
    Ok(())
}

pub(crate) fn live_stream_updates_pipeline<T: Serialize>(
    key: &str,
    live: &[(SbUserId, T)],
    offline: &[SbUserId],
) -> eyre::Result<deadpool_redis::redis::Pipeline> {
    let mut pipeline = deadpool_redis::redis::pipe();

    if !live.is_empty() {
        pipeline.cmd("HSET").arg(key);
        for (user_id, summary) in live {
            let json =
                serde_json::to_string(summary).wrap_err("Failed to serialize live stream")?;
            pipeline.arg(i32::from(*user_id)).arg(json);
        }
        pipeline.ignore();
    }

    if !offline.is_empty() {
        pipeline.cmd("HDEL").arg(key);
        for user_id in offline {
            pipeline.arg(i32::from(*user_id));
        }
        pipeline.ignore();
    }

    Ok(pipeline)
}

/// Applies one refresh phase with at most one HSET and one HDEL in a single Redis round trip.
pub(crate) async fn apply_live_stream_updates<T: Serialize>(
    key: &str,
    redis: &RedisPool,
    live: &[(SbUserId, T)],
    offline: &[SbUserId],
) -> eyre::Result<()> {
    let pipeline = live_stream_updates_pipeline(key, live, offline)?;
    if pipeline.is_empty() {
        return Ok(());
    }

    let mut conn = redis.get().await.wrap_err("Could not connect to Redis")?;
    pipeline
        .exec_async(&mut conn)
        .await
        .wrap_err_with(|| format!("Failed to update {key}"))
}

// ---------------------------------------------------------------------------------------------
// Feed blocks (DB)
// ---------------------------------------------------------------------------------------------

/// The set of users an admin has blocked from the live-streams feed. Read on each `live_streams`
/// poll so a block takes effect on the very next feed refresh; the table holds one row per blocked
/// user, so this stays small and the read is negligible next to the Redis scan on the same path.
async fn load_feed_blocked_user_ids(pool: &PgPool) -> eyre::Result<HashSet<SbUserId>> {
    let rows =
        sqlx::query!(r#"SELECT user_id as "user_id: SbUserId" FROM live_stream_feed_blocks"#,)
            .fetch_all(pool)
            .await
            .wrap_err("Failed to load live stream feed blocks")?;
    Ok(rows.into_iter().map(|r| r.user_id).collect())
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
            INSERT INTO live_stream_feed_blocks (user_id, blocked_by)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO NOTHING
        "#,
        user_id as _,
        blocked_by as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to insert live stream feed block")?;
    Ok(())
}

/// Removes a feed block, returning whether one existed.
async fn delete_feed_block(pool: &PgPool, user_id: SbUserId) -> eyre::Result<bool> {
    let result = sqlx::query!(
        r#"DELETE FROM live_stream_feed_blocks WHERE user_id = $1"#,
        user_id as _,
    )
    .execute(pool)
    .await
    .wrap_err("Failed to delete live stream feed block")?;
    Ok(result.rows_affected() > 0)
}

/// Loads the blocked-streams list for the admin UI, newest first, joining in each user's current
/// channel identity on every platform they still have linked.
async fn load_feed_blocks(pool: &PgPool) -> eyre::Result<Vec<BlockedStream>> {
    sqlx::query_as!(
        BlockedStream,
        r#"
            SELECT b.user_id as "user_id: SbUserId",
                b.blocked_by as "blocked_by_id: SbUserId",
                t.twitch_login as "twitch_login?",
                t.twitch_display_name as "twitch_display_name?",
                y.youtube_channel_title as "youtube_channel_title?",
                y.youtube_handle as "youtube_handle?",
                b.created_at
            FROM live_stream_feed_blocks b
            LEFT JOIN twitch_connections t ON t.user_id = b.user_id
            LEFT JOIN youtube_connections y ON y.user_id = b.user_id
            ORDER BY b.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .wrap_err("Failed to load live stream feed blocks")
}

/// Builds the ordered `liveStreams` feed from every platform's broadcasts: keep only the ones their
/// platform judged StarCraft and that aren't feed-blocked, then sort by viewer count (highest
/// first), with broadcasts whose platform reports no count at all last rather than treated as zero.
fn feed_streams(streams: Vec<LiveStream>, blocked: &HashSet<SbUserId>) -> Vec<LiveStream> {
    let mut streams: Vec<LiveStream> = streams
        .into_iter()
        .filter(|s| s.feed_eligible && !blocked.contains(&s.user_id))
        .collect();
    streams.sort_by_key(|s| (s.viewer_count.is_none(), std::cmp::Reverse(s.viewer_count)));
    streams
}

/// Reads every platform's live hash and turns the results into `LiveStream`s, Twitch first.
async fn load_all_platform_streams(redis: &RedisPool) -> eyre::Result<Vec<LiveStream>> {
    let (twitch, youtube) = tokio::try_join!(
        crate::twitch::load_live_streams(redis),
        crate::youtube::load_live_streams(redis),
    )?;

    Ok(twitch
        .into_iter()
        .map(|(user_id, summary)| summary.into_live_stream(user_id))
        .chain(
            youtube
                .into_iter()
                .map(|(user_id, summary)| summary.into_live_stream(user_id)),
        )
        .collect())
}

// ---------------------------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------------------------

/// Batches per-user live-broadcast lookups (one `HMGET` per platform) so that selecting
/// `liveStreams` on a list of users doesn't fan out into one Redis call each. Category-agnostic:
/// every live broadcast is returned, feed-eligible or not.
pub struct LiveStreamsLoader {
    redis: RedisPool,
}

impl LiveStreamsLoader {
    pub fn new(redis: RedisPool) -> Self {
        Self { redis }
    }
}

impl Loader<SbUserId> for LiveStreamsLoader {
    type Value = Vec<LiveStream>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbUserId]) -> Result<HashMap<SbUserId, Self::Value>, Self::Error> {
        let (twitch, youtube) = tokio::try_join!(
            crate::twitch::load_live_streams_for_users(&self.redis, keys),
            crate::youtube::load_live_streams_for_users(&self.redis, keys),
        )
        .map_err(|e| graphql_error("INTERNAL_SERVER_ERROR", e.to_string()))?;

        let mut by_user: HashMap<SbUserId, Vec<LiveStream>> = HashMap::new();
        for (user_id, summary) in twitch {
            by_user
                .entry(user_id)
                .or_default()
                .push(summary.into_live_stream(user_id));
        }
        for (user_id, summary) in youtube {
            by_user
                .entry(user_id)
                .or_default()
                .push(summary.into_live_stream(user_id));
        }
        Ok(by_user)
    }
}

pub struct LiveStreamsModule {
    redis_pool: RedisPool,
}

impl LiveStreamsModule {
    pub fn new(redis_pool: RedisPool) -> Self {
        Self { redis_pool }
    }
}

impl SchemaBuilderModule for LiveStreamsModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S> {
        builder.data(DataLoader::new(
            LiveStreamsLoader::new(self.redis_pool.clone()),
            tokio::spawn,
        ))
    }
}

#[derive(Default)]
pub struct LiveStreamsQuery;

#[Object]
impl LiveStreamsQuery {
    /// ShieldBattery users currently live-streaming StarCraft, ordered by viewer count (highest
    /// first; broadcasts whose platform reports no count come last). Users an admin has blocked from
    /// the feed are omitted (the block hides them here only; their live state elsewhere -- profile,
    /// avatar ring, friend notifications -- is unaffected).
    async fn live_streams(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<LiveStream>> {
        let streams = load_all_platform_streams(ctx.data::<RedisPool>()?).await?;
        let blocked = load_feed_blocked_user_ids(ctx.data::<PgPool>()?).await?;
        Ok(feed_streams(streams, &blocked))
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

    /// The ids of every ShieldBattery user who is currently live-streaming on any platform (any
    /// category). This lets the client badge "live" state across user lists (friends, chat, etc.)
    /// from a single lookup, with per-stream details fetched lazily via `SbUser.liveStreams` where
    /// needed. Category-agnostic by design, matching the profile "Live" badge (`liveStreams` is the
    /// StarCraft-filtered feed).
    async fn live_stream_user_ids(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<SbUserId>> {
        let redis = ctx.data::<RedisPool>()?;
        let (mut user_ids, youtube) = tokio::try_join!(
            crate::twitch::load_live_stream_user_ids(redis),
            crate::youtube::load_live_stream_user_ids(redis),
        )?;

        // A user can be live on both platforms at once, so this is a union rather than a
        // concatenation.
        let from_twitch: HashSet<SbUserId> = user_ids.iter().copied().collect();
        user_ids.extend(youtube.into_iter().filter(|id| !from_twitch.contains(id)));
        Ok(user_ids)
    }
}

#[derive(Default)]
pub struct LiveStreamsMutation;

#[Object]
impl LiveStreamsMutation {
    /// Blocks a user's streams from appearing in the live-streams feed (shown on the home page and
    /// the dedicated live streams page). The block covers every platform they stream on and is
    /// idempotent (a repeat block keeps the original). It hides them from the feed only, not from
    /// the profile stream cards / avatar "live" ring / friend notifications. Requires the
    /// `manageLiveStreams` permission.
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

    /// Removes a user's feed block, letting their streams appear in the feed again. Returns whether
    /// a block was removed. Requires the `manageLiveStreams` permission.
    #[graphql(guard = RequiredPermission::ManageLiveStreams)]
    async fn unblock_stream(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
    ) -> async_graphql::Result<bool> {
        Ok(delete_feed_block(ctx.data::<PgPool>()?, user_id).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deadpool_redis::redis::{RedisFuture, Value};
    use serde::Deserialize;

    const TEST_KEY: &str = "test:live";

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

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TestSummary {
        title: String,
    }

    fn test_summary(title: &str) -> TestSummary {
        TestSummary {
            title: title.to_owned(),
        }
    }

    fn live_stream(user_id: i32, platform: LiveStreamPlatform, viewers: Option<i32>) -> LiveStream {
        LiveStream {
            user_id: SbUserId(user_id),
            feed_eligible: true,
            platform,
            display_name: "Streamer".to_owned(),
            url: "https://example.com/watch".to_owned(),
            title: "Ladder".to_owned(),
            game_name: None,
            viewer_count: viewers,
            started_at: DateTime::parse_from_rfc3339("2026-09-22T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            thumbnail_url: "https://example.com/thumb.jpg".to_owned(),
        }
    }

    #[tokio::test]
    async fn live_stream_user_ids_uses_hkeys() {
        let mut redis = FakeRedis::returning(Value::Array(vec![
            Value::BulkString(b"7".to_vec()),
            Value::BulkString(b"9".to_vec()),
        ]));

        let ids = load_live_stream_user_ids_from_connection(TEST_KEY, &mut redis)
            .await
            .unwrap();

        assert_eq!(ids, vec![SbUserId(7), SbUserId(9)]);
        assert_eq!(redis.commands.len(), 1);
        let mut expected = deadpool_redis::redis::cmd("HKEYS");
        expected.arg(TEST_KEY);
        assert_eq!(redis.commands[0], expected.get_packed_command());
    }

    #[tokio::test]
    async fn requested_live_stream_values_use_one_aligned_hmget() {
        let valid_json = serde_json::to_string(&test_summary("Ladder")).unwrap();
        let mut redis = FakeRedis::returning(Value::Array(vec![
            Value::BulkString(valid_json.as_bytes().to_vec()),
            Value::Nil,
            Value::BulkString(b"{malformed".to_vec()),
        ]));
        let user_ids = [SbUserId(7), SbUserId(8), SbUserId(9)];

        let values = load_live_stream_values_from_connection(TEST_KEY, &mut redis, &user_ids)
            .await
            .unwrap();

        assert_eq!(values[0].as_deref(), Some(valid_json.as_str()));
        assert_eq!(values[1], None);
        assert_eq!(values[2].as_deref(), Some("{malformed"));
        assert_eq!(redis.commands.len(), 1);
        let mut expected = deadpool_redis::redis::cmd("HMGET");
        expected.arg(TEST_KEY).arg(7).arg(8).arg(9);
        assert_eq!(redis.commands[0], expected.get_packed_command());
    }

    #[test]
    fn live_stream_parsing_omits_missing_and_malformed_values() {
        let valid_json = serde_json::to_string(&test_summary("Ladder")).unwrap();
        let malformed_json = "{malformed".to_owned();

        let parsed = parse_live_stream_entries::<TestSummary>(
            TEST_KEY,
            [
                (SbUserId(7), Some(valid_json)),
                (SbUserId(8), None),
                (SbUserId(9), Some(malformed_json.clone())),
            ],
        );

        assert_eq!(parsed.streams, vec![(SbUserId(7), test_summary("Ladder"))]);
        assert_eq!(parsed.malformed, vec![(SbUserId(9), malformed_json)]);
    }

    #[test]
    fn malformed_cleanup_compares_the_value_before_deleting() {
        let entries = vec![
            (SbUserId(7), "{bad-one".to_owned()),
            (SbUserId(9), "{bad-two".to_owned()),
        ];

        let actual = remove_malformed_live_streams_command(TEST_KEY, &entries);
        let mut expected = deadpool_redis::redis::cmd("EVAL");
        expected
            .arg(REMOVE_MALFORMED_LIVE_STREAMS_SCRIPT)
            .arg(1)
            .arg(TEST_KEY)
            .arg(7)
            .arg("{bad-one")
            .arg(9)
            .arg("{bad-two");

        assert_eq!(actual.get_packed_command(), expected.get_packed_command());
    }

    #[test]
    fn live_stream_refresh_updates_are_batched_by_operation() {
        let live = vec![
            (SbUserId(7), test_summary("Ladder")),
            (SbUserId(8), test_summary("Customs")),
        ];
        let offline = vec![SbUserId(9), SbUserId(10)];

        let actual = live_stream_updates_pipeline(TEST_KEY, &live, &offline).unwrap();

        assert_eq!(actual.len(), 2);
        let mut expected = deadpool_redis::redis::pipe();
        expected
            .cmd("HSET")
            .arg(TEST_KEY)
            .arg(7)
            .arg(serde_json::to_string(&live[0].1).unwrap())
            .arg(8)
            .arg(serde_json::to_string(&live[1].1).unwrap())
            .ignore()
            .cmd("HDEL")
            .arg(TEST_KEY)
            .arg(9)
            .arg(10)
            .ignore();

        assert_eq!(actual.get_packed_pipeline(), expected.get_packed_pipeline());
    }

    #[test]
    fn empty_live_stream_refresh_does_not_issue_redis_commands() {
        let pipeline = live_stream_updates_pipeline::<TestSummary>(TEST_KEY, &[], &[]).unwrap();
        assert!(pipeline.is_empty());
    }

    #[test]
    fn feed_streams_drops_blocked_and_ineligible_then_sorts_by_viewers() {
        let low = live_stream(1, LiveStreamPlatform::Twitch, Some(10));
        let high = live_stream(2, LiveStreamPlatform::Youtube, Some(500));
        let blocked_stream = live_stream(3, LiveStreamPlatform::Twitch, Some(999));
        let mut ineligible = live_stream(4, LiveStreamPlatform::Youtube, Some(800));
        ineligible.feed_eligible = false;
        let unreported_viewers = live_stream(5, LiveStreamPlatform::Youtube, None);

        let blocked = HashSet::from([SbUserId(3)]);
        let streams = feed_streams(
            vec![low, high, blocked_stream, ineligible, unreported_viewers],
            &blocked,
        );

        // The blocked user (3) and the feed-ineligible broadcast (4) are gone; the rest are ordered
        // by viewer count, highest first, with the unreported count (5) last.
        let ids: Vec<_> = streams.iter().map(|s| s.user_id).collect();
        assert_eq!(ids, vec![SbUserId(2), SbUserId(1), SbUserId(5)]);
        assert_eq!(streams[0].platform, LiveStreamPlatform::Youtube);
        assert_eq!(streams[1].platform, LiveStreamPlatform::Twitch);
        assert_eq!(streams[2].viewer_count, None);
    }
}
