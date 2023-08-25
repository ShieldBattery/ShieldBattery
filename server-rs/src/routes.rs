use std::sync::Arc;
use std::time::Duration;

use crate::configuration::Settings;
use crate::email::MailgunClient;
use async_graphql::dataloader::DataLoader;
use async_graphql::extensions::Tracing;
use async_graphql::http::{playground_source, GraphQLPlaygroundConfig, ALL_WEBSOCKET_PROTOCOLS};
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::error_handling::HandleErrorLayer;
use axum::extract::WebSocketUpgrade;
use axum::http::header::CONTENT_TYPE;
use axum::http::{header, HeaderName, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Router};
use axum_client_ip::{SecureClientIp, SecureClientIpSource};
use sqlx::PgPool;
use tower::{BoxError, ServiceBuilder};
use tower_http::compression::CompressionLayer;
use tower_http::cors;
use tower_http::sensitive_headers::{
    SetSensitiveRequestHeadersLayer, SetSensitiveResponseHeadersLayer,
};
use tower_http::trace::{DefaultMakeSpan, DefaultOnRequest, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::redis::RedisPool;
use crate::schema::{build_schema, SbSchema};
use crate::sessions::SbSession;
use crate::users::UsersLoader;

async fn health_check() -> impl IntoResponse {
    "OK"
}

#[cfg(debug_assertions)]
async fn graphql_playground() -> impl IntoResponse {
    Html(playground_source(
        GraphQLPlaygroundConfig::new("/gql").subscription_endpoint("/gql/ws"),
    ))
}

#[cfg(not(debug_assertions))]
async fn graphql_playground() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, "Not Found")
}

async fn graphql_handler(
    ip: SecureClientIp,
    session: SbSession,
    schema: Extension<SbSchema>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema
        .execute(req.into_inner().data(ip).data(session))
        .await
        .into()
}

async fn graphql_ws_handler(
    Extension(schema): Extension<SbSchema>,
    protocol: GraphQLProtocol,
    websocket: WebSocketUpgrade,
) -> Response {
    websocket
        .protocols(ALL_WEBSOCKET_PROTOCOLS)
        .on_upgrade(move |stream| {
            // TODO(tec27): Implement on_connection_init that grabs the session (might be passed
            // over the websocket rather than grabbed from headers? unsure)
            GraphQLWebSocket::new(stream, schema.clone(), protocol).serve()
        })
}

pub fn create_app(db_pool: PgPool, redis_pool: RedisPool, settings: Settings) -> Router {
    let mailgun = Arc::new(MailgunClient::new(
        settings.mailgun,
        settings.canonical_host,
    ));

    let ip_source = if settings.reverse_proxied {
        SecureClientIpSource::XRealIp
    } else {
        SecureClientIpSource::ConnectInfo
    };

    let schema = build_schema()
        .extension(Tracing)
        .data(db_pool.clone())
        .data(redis_pool.clone())
        .data(mailgun.clone())
        .data(DataLoader::new(
            UsersLoader::new(db_pool.clone()),
            tokio::spawn,
        ))
        .finish();

    let sensitive_headers: Arc<[_]> = Arc::new([
        header::AUTHORIZATION,
        header::PROXY_AUTHORIZATION,
        header::COOKIE,
        header::SET_COOKIE,
    ]);

    Router::new()
        .route("/healthcheck", get(health_check))
        .route("/gql", get(graphql_playground).post(graphql_handler))
        .route("/gql/ws", get(graphql_ws_handler))
        .layer(
            ServiceBuilder::new()
                .layer(SetSensitiveRequestHeadersLayer::from_shared(Arc::clone(
                    &sensitive_headers,
                )))
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(DefaultMakeSpan::new().include_headers(true))
                        .on_request(DefaultOnRequest::new().level(Level::INFO))
                        .on_response(
                            DefaultOnResponse::new()
                                .level(Level::INFO)
                                .include_headers(true),
                        ),
                )
                .layer(HandleErrorLayer::new(|error: BoxError| async move {
                    if error.is::<tower::timeout::error::Elapsed>() {
                        Ok(StatusCode::REQUEST_TIMEOUT)
                    } else {
                        Err((
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Unhandled internal error: {}", error),
                        ))
                    }
                }))
                .timeout(Duration::from_secs(10))
                .layer(ip_source.into_extension())
                .layer(CompressionLayer::new().no_br())
                .layer(
                    cors::CorsLayer::new()
                        .allow_origin(cors::Any)
                        .allow_headers([CONTENT_TYPE, HeaderName::from_static("sb-session-id")])
                        .allow_methods(cors::Any)
                        .max_age(Duration::from_secs(60 * 60 * 24)),
                )
                .layer(SetSensitiveResponseHeadersLayer::from_shared(
                    sensitive_headers,
                ))
                .layer(Extension(schema))
                .layer(Extension(db_pool))
                .layer(Extension(redis_pool))
                .layer(Extension(mailgun))
                .into_inner(),
        )
}
