use std::net::SocketAddr;
use std::time::Duration;

use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use mobc_redis::redis;
use mobc_redis::RedisConnectionManager;
use secrecy::ExposeSecret;
use sqlx::postgres::PgPoolOptions;

use server::configuration::get_configuration;
use server::routes::create_app;
use server::schema::write_schema;
use server::telemetry::init_subscriber;

#[cfg(debug_assertions)]
const TRACING_ENV_FILTER: &str = "debug";
#[cfg(not(debug_assertions))]
const TRACING_ENV_FILTER: &str = "info";

#[tokio::main]
async fn main() -> eyre::Result<()> {
    color_eyre::install()?;
    dotenvy::dotenv().unwrap();

    init_subscriber("server", TRACING_ENV_FILTER, std::io::stdout);

    #[cfg(debug_assertions)]
    {
        tracing::info!("In debug mode, writing schema to file...");
        write_schema("../schema.graphql").wrap_err("Failed to write GraphQL schema")?;
        tracing::info!("GraphQL schema written!")
    }

    let settings = get_configuration().wrap_err("Failed to read configuration settings")?;

    tracing::info!("Settings: {settings:?}");

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
    let redis_pool = mobc::Pool::builder().build(redis_manager);

    let addr_string = format!("{}:{}", settings.app_host, settings.app_port);
    let addr = addr_string
        .parse::<SocketAddr>()
        .wrap_err_with(|| format!("Failed to parse address: {}", addr_string))?;

    tracing::info!("listening on http://{}", addr);
    axum::Server::bind(&addr)
        .serve(
            create_app(db_pool, redis_pool, settings)
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .wrap_err("axum failure")?;

    Ok(())
}
