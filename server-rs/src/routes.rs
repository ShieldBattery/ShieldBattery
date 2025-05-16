use std::sync::Arc;
use std::time::Duration;

use async_graphql::extensions::Tracing;
use async_graphql::http::ALL_WEBSOCKET_PROTOCOLS;
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::body::Body;
use axum::extract::{State, WebSocketUpgrade};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderName, Request, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Router, middleware};
use axum_client_ip::{ClientIp, ClientIpSource};
use axum_prometheus::PrometheusMetricLayer;
use color_eyre::eyre::{self, Context};
use jsonwebtoken::DecodingKey;
use secrecy::ExposeSecret;
use sqlx::PgPool;
use tower::ServiceBuilder;
use tower_http::ServiceBuilderExt;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::compression::CompressionLayer;
use tower_http::cors;
use tower_http::request_id::MakeRequestUuid;
use tower_http::sensitive_headers::{
    SetSensitiveRequestHeadersLayer, SetSensitiveResponseHeadersLayer,
};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::Span;

use crate::configuration::{Env, Settings};
use crate::email::MailgunClient;
use crate::file_store::file_store_from_config;
use crate::games::GamesModule;
use crate::graphql::errors::ErrorLoggerExtension;
use crate::graphql::schema_builder::SchemaBuilderModuleExt;
use crate::maps::MapsModule;
use crate::news::NewsModule;
use crate::redis::RedisPool;
use crate::schema::{SbSchema, build_schema};
use crate::sessions::{SbSession, jwt_middleware};
use crate::state::AppState;
use crate::users::names::{NameChecker, create_names_api};
use crate::users::{CurrentUser, CurrentUserRepo, UsersModule};

async fn health_check() -> impl IntoResponse {
    "OK"
}

async fn graphql_handler(
    ip: ClientIp,
    session: SbSession,
    current_user: Option<CurrentUser>,
    State(app_state): State<AppState>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    app_state
        .graphql_schema
        .execute(req.into_inner().data(ip).data(session).data(current_user))
        .await
        .into()
}

async fn graphql_ws_handler(
    State(schema): State<SbSchema>,
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

async fn only_unforwarded_clients(request: Request<Body>, next: Next) -> Response {
    if request
        .headers()
        .get(HeaderName::from_static("x-real-ip"))
        .is_some()
    {
        (StatusCode::NOT_FOUND, "Not Found").into_response()
    } else {
        next.run(request).await
    }
}

pub async fn create_app(
    db_pool: PgPool,
    redis_pool: RedisPool,
    settings: Settings,
) -> eyre::Result<Router> {
    let mailgun = Arc::new(MailgunClient::new(
        settings.mailgun.clone(),
        settings.canonical_host.clone(),
    ));
    let file_store = file_store_from_config(&settings)
        .await
        .wrap_err("Creating file store failed")?;

    let ip_source = if settings.reverse_proxied {
        ClientIpSource::XRealIp
    } else {
        ClientIpSource::ConnectInfo
    };

    let name_checker = NameChecker::new(db_pool.clone());

    let schema = build_schema()
        .extension(Tracing)
        .extension(ErrorLoggerExtension)
        .data(settings.clone())
        .data(db_pool.clone())
        .data(redis_pool.clone())
        .data(mailgun.clone())
        .data(file_store.clone())
        .data(name_checker.clone())
        .module(MapsModule::new(db_pool.clone()))
        .module(GamesModule::new(db_pool.clone()))
        .module(NewsModule::new(db_pool.clone()))
        .module(UsersModule::new(db_pool.clone(), redis_pool.clone()))
        .limit_depth(if settings.env == Env::Production {
            // TODO(tec27): Figure out good limits
            10
        } else {
            // NOTE(tec27): GQLi introspection is a pretty deep query so we allow much greater in
            // dev mode
            999999
        })
        .finish();

    let sensitive_headers: Arc<[_]> = Arc::new([
        header::AUTHORIZATION,
        header::PROXY_AUTHORIZATION,
        header::COOKIE,
        header::SET_COOKIE,
        HeaderName::from_static("sb-session-id"),
    ]);

    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    let metrics_router = Router::new()
        .route("/", get(|| async move { metric_handle.render() }))
        .layer(middleware::from_fn(only_unforwarded_clients));
    let names_router = create_names_api().layer(middleware::from_fn(only_unforwarded_clients));

    let app_state = AppState {
        settings: Arc::new(settings.clone()),
        current_user_repo: CurrentUserRepo::new(db_pool.clone(), redis_pool.clone()),
        name_checker,
        db_pool,
        redis_pool,
        mailgun,
        file_store,
        jwt_key: Arc::new(DecodingKey::from_secret(
            settings.jwt_secret.expose_secret().as_ref(),
        )),
        graphql_schema: schema.clone(),
    };

    Ok(Router::new()
        .route("/healthcheck", get(health_check))
        .route("/gql", post(graphql_handler))
        .route("/gql/ws", get(graphql_ws_handler))
        .nest("/users/names", names_router)
        .layer(
            ServiceBuilder::new()
                .layer(prometheus_layer)
                .layer(SetSensitiveRequestHeadersLayer::from_shared(Arc::clone(
                    &sensitive_headers,
                )))
                .set_x_request_id(MakeRequestUuid)
                .layer(ip_source.into_extension())
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(|request: &Request<Body>| {
                            let span = tracing::info_span!(
                                "request",
                                req.method = %request.method(),
                                req.url = %request.uri(),
                                req.id = tracing::field::Empty,
                                req.userAgent = tracing::field::Empty,
                                req.headers = ?request.headers(),
                                req.ip = tracing::field::Empty,
                                res.statusCode = tracing::field::Empty,
                                res.responseTime = tracing::field::Empty,
                                res.headers = tracing::field::Empty,
                                error = tracing::field::Empty,
                                errorMessage = tracing::field::Empty,
                            );

                            request
                                .headers()
                                .get(HeaderName::from_static("x-request-id"))
                                .map(|v| v.to_str().map(|v| span.record("req.id", v)));
                            request
                                .headers()
                                .get(header::USER_AGENT)
                                .map(|v| v.to_str().map(|v| span.record("req.userAgent", v)));
                            // TODO(tec27): Ideally this would come from our IP source, but
                            // extracting it is async and we can't easily make use of that here, so
                            // it'll take some more figuring out to make work
                            request
                                .headers()
                                .get(HeaderName::from_static("x-real-ip"))
                                .map(|v| v.to_str().map(|v| span.record("req.ip", v)));

                            span
                        })
                        .on_response(|response: &Response<_>, latency: Duration, span: &Span| {
                            span.record("res.statusCode", response.status().as_u16());
                            span.record("res.responseTime", latency.as_millis());
                            span.record("res.headers", tracing::field::debug(response.headers()));

                            tracing::info!("request completed");
                        })
                        .on_failure(
                            |error: ServerErrorsFailureClass, latency: Duration, span: &Span| {
                                span.record("errorMessage", error.to_string());
                                span.record("res.responseTime", latency.as_millis());
                                tracing::error!(error = error.to_string(), "request failed");
                            },
                        ),
                )
                .layer(TimeoutLayer::new(Duration::from_secs(15)))
                .layer(CompressionLayer::new().no_br())
                .layer(
                    cors::CorsLayer::new()
                        .allow_origin(cors::Any)
                        .allow_headers([
                            CONTENT_TYPE,
                            HeaderName::from_static("sb-session-id"),
                            header::AUTHORIZATION,
                        ])
                        .allow_methods(cors::Any)
                        .max_age(Duration::from_secs(60 * 60 * 24)),
                )
                .layer(middleware::from_fn_with_state(
                    app_state.clone(),
                    jwt_middleware,
                ))
                .layer(SetSensitiveResponseHeadersLayer::from_shared(
                    sensitive_headers,
                ))
                .propagate_x_request_id()
                .into_inner(),
        )
        .with_state(app_state)
        .nest("/metrics", metrics_router))
}
