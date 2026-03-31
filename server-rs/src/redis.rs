use crate::pubsub::PublishedMessage;
use color_eyre::Result;
use color_eyre::eyre::WrapErr;
use mobc::Connection;
use mobc_redis::RedisConnectionManager;
use mobc_redis::redis::AsyncCommands;

#[derive(Clone)]
pub struct RedisPool(mobc::Pool<RedisConnectionManager>);

impl RedisPool {
    pub fn new(pool: mobc::Pool<RedisConnectionManager>) -> Self {
        Self(pool)
    }

    pub async fn get(&self) -> Result<Connection<RedisConnectionManager>> {
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
                e
            })?;

        Ok(())
    }
}
