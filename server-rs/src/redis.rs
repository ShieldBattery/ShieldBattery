use color_eyre::eyre::WrapErr;
use color_eyre::Result;
use mobc::Connection;
use mobc_redis::RedisConnectionManager;

pub type RedisPool = mobc::Pool<RedisConnectionManager>;

pub async fn get_redis(pool: &RedisPool) -> Result<Connection<RedisConnectionManager>> {
    pool.get()
        .await
        .wrap_err("Failed to get Redis connection")
        .map_err(|e| {
            tracing::error!("Failed to get Redis connection: {e:?}");
            e
        })
}
