use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::Request;
use axum::ServiceExt;
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use mobc_redis::redis;
use mobc_redis::RedisConnectionManager;
use secrecy::ExposeSecret;
use sqlx::postgres::PgPoolOptions;

use server::configuration::{get_configuration, Env};
use server::redis::RedisPool;
use server::routes::create_app;
#[cfg(debug_assertions)]
use server::schema::write_schema;
use server::telemetry::init_subscriber;
use tower::Layer;
use tower_http::normalize_path::NormalizePathLayer;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    color_eyre::install()?;

    if let Err(e) = dotenvy::dotenv() {
        match e {
            dotenvy::Error::Io(_e) => {
                // We ignore this outside of debug mode because we won't usually use a .env file
                // directly in production
                #[cfg(debug_assertions)]
                tracing::error!("I/O error while loading .env file: {_e:?}");
            }
            _ => {
                tracing::warn!("Error while loading .env file: {e:?}");
            }
        }
    }

    let settings = get_configuration().wrap_err("Failed to read configuration settings")?;

    let env_filter = if settings.env == Env::Production {
        "info"
    } else {
        "debug"
    };

    init_subscriber(&settings, "server", env_filter, std::io::stdout);

    tracing::info!("Settings: {settings:?}");

    #[cfg(debug_assertions)]
    {
        tracing::info!("In debug mode, writing schema to file...");
        write_schema("../schema.graphql").wrap_err("Failed to write GraphQL schema")?;
        tracing::info!("GraphQL schema written!")
    }

    let connection_string = settings.database.connection_string();
    let db_pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_secs(3))
        .connect(connection_string.expose_secret())
        .await
        .wrap_err("Failed to connect to Postgres")?;

    let redis_host = format!("redis://{}:{}", settings.redis.host, settings.redis.port);
    let redis_client = redis::Client::open(redis_host.clone())
        .wrap_err_with(|| format!("Failed to open Redis server at {}", redis_host))?;
    let redis_manager = RedisConnectionManager::new(redis_client);
    let redis_pool = RedisPool::new(mobc::Pool::builder().build(redis_manager));

    let addr_string = format!("{}:{}", settings.app_host, settings.app_port);
    let addr = addr_string
        .parse::<SocketAddr>()
        .wrap_err_with(|| format!("Failed to parse address: {}", addr_string))?;

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("listening on http://{}", listener.local_addr().unwrap());

    let router = create_app(db_pool, redis_pool, settings).await?;
    let app = NormalizePathLayer::trim_trailing_slash().layer(router);
    axum::serve(
        listener,
        ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(app),
    )
    .await
    .wrap_err("axum failure")?;

    Ok(())
}
