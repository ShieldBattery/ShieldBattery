use crate::pubsub::PublishedMessage;
use color_eyre::Result;
use color_eyre::eyre::WrapErr;
use deadpool_redis::redis::AsyncCommands;
use deadpool_redis::{Config, Connection, Pool, Runtime};

const PUBLISH_FAILURES: &str = "redis_publish_failures_total";

/// Registers metric descriptions (the HELP/TYPE text on `/metrics`). Safe to call once at startup;
/// recording a metric without describing it still works, this just produces nicer output.
pub fn describe_metrics() {
    use ::metrics::Unit;

    ::metrics::describe_counter!(
        PUBLISH_FAILURES,
        Unit::Count,
        "Failed attempts to publish a message to Redis, per channel"
    );
}

#[derive(Clone)]
pub struct RedisPool(Pool);

impl RedisPool {
    /// Creates a new pool of connections to the Redis server at the given URL (e.g.
    /// `redis://host:port`).
    pub fn new(url: &str) -> Result<Self> {
        let pool = Config::from_url(url)
            .create_pool(Some(Runtime::Tokio1))
            .wrap_err("Failed to create Redis connection pool")?;
        Ok(Self(pool))
    }

    pub async fn get(&self) -> Result<Connection> {
        self.0
            .get()
            .await
            .wrap_err("Failed to get Redis connection")
            .map_err(|e| {
                tracing::error!("Failed to get Redis connection: {e:?}");
                e
            })
    }

    /// Publish a message to the given channel. This is a convenience method for retrieving a
    /// connection from the pool, serializing a message, and publishing it, since the places that
    /// do this don't often have a need for performing other Redis operations with the same
    /// connection.
    pub async fn publish(&self, message: impl Into<PublishedMessage>) -> Result<()> {
        let mut redis = self.get().await?;
        let message: PublishedMessage = message.into();
        let channel = message.channel();
        let message = serde_json::to_string(&message).wrap_err("Failed to serialize message")?;
        redis
            .publish::<_, _, ()>(channel, &message)
            .await
            .wrap_err("Failed to publish message")
            .map_err(|e| {
                tracing::error!("Failed to publish message to '{channel:?}': {e:?}");
                ::metrics::counter!(PUBLISH_FAILURES, "channel" => channel).increment(1);
                e
            })?;

        Ok(())
    }
}
