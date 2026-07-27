use std::sync::Arc;
use std::time::Duration;

use arc_swap::ArcSwap;
use async_graphql::extensions::Tracing;
use async_graphql::http::ALL_WEBSOCKET_PROTOCOLS;
use async_graphql_axum::{GraphQLProtocol, GraphQLRequest, GraphQLResponse, GraphQLWebSocket};
use axum::body::Body;
use axum::extract::{State, WebSocketUpgrade};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderMap, HeaderName, Request, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Router, middleware};
use axum_client_ip::{ClientIp, ClientIpSource};
use axum_extra::{TypedHeader, headers::UserAgent};
use axum_prometheus::PrometheusMetricLayer;
use color_eyre::eyre::{self, Context};
use jsonwebtoken::DecodingKey;
use reqwest::Method;
use secrecy::ExposeSecret;
use sqlx::PgPool;
use tower::ServiceBuilder;
use tower_http::ServiceBuilderExt;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::compression::CompressionLayer;
use tower_http::compression::predicate::{NotForContentType, Predicate, SizeAbove};
use tower_http::cors::{self, AllowCredentials, AllowOrigin};
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
use crate::game_reports::GameReportsModule;
use crate::games::GamesModule;
use crate::graphql::errors::ErrorLoggerExtension;
use crate::graphql::schema_builder::SchemaBuilderModuleExt;
use crate::maps::MapsModule;
use crate::matchmaking::api::create_matchmaking_api;
use crate::matchmaking::config::load_matchmaker_config;
use crate::news::NewsModule;
use crate::redis::RedisPool;
use crate::schema::{SbSchema, build_schema};
use crate::sessions::{SbSession, jwt_middleware};
use crate::state::AppState;
use crate::twitch::{
    TwitchClient, TwitchModule, create_twitch_api, reconcile_subscriptions_loop,
    refresh_live_streams_loop,
};
use crate::users::names::{NameChecker, create_names_api};
use crate::users::{CurrentUser, CurrentUserRepo, UsersModule};

const DATABASE_POOL_CONNECTIONS: &str = "database_pool_connections";
const DATABASE_POOL_MAX_CONNECTIONS: &str = "database_pool_max_connections";
// Header values can be client-controlled, so omit unusually large values instead of allowing
// tracing to amplify them across every log emitted within the request span.
const MAX_TRACED_HEADER_VALUE_LEN: usize = 512;

async fn health_check() -> impl IntoResponse {
    "OK"
}

fn describe_database_pool_metrics() {
    use ::metrics::Unit;

    ::metrics::describe_gauge!(
        DATABASE_POOL_CONNECTIONS,
        Unit::Count,
        "Open PostgreSQL connections, by state"
    );
    ::metrics::describe_gauge!(
        DATABASE_POOL_MAX_CONNECTIONS,
        Unit::Count,
        "Maximum PostgreSQL connections allowed in this process's pool"
    );
}

fn record_database_pool_metrics(db_pool: &PgPool) {
    // These values can change independently while they are sampled, so cap idle at the observed
    // total rather than briefly emitting a negative in-use count during concurrent pool activity.
    let total = db_pool.size() as usize;
    let idle = db_pool.num_idle().min(total);
    let in_use = total - idle;

    ::metrics::gauge!(DATABASE_POOL_CONNECTIONS, "state" => "total").set(total as f64);
    ::metrics::gauge!(DATABASE_POOL_CONNECTIONS, "state" => "idle").set(idle as f64);
    ::metrics::gauge!(DATABASE_POOL_CONNECTIONS, "state" => "in_use").set(in_use as f64);
    ::metrics::gauge!(DATABASE_POOL_MAX_CONNECTIONS)
        .set(db_pool.options().get_max_connections() as f64);
}

fn record_header_field(span: &Span, field: &'static str, headers: &HeaderMap, name: HeaderName) {
    let all_values = headers.get_all(name);
    let mut values = all_values.iter();
    let Some(first) = values.next().and_then(|value| value.to_str().ok()) else {
        return;
    };
    if first.len() > MAX_TRACED_HEADER_VALUE_LEN {
        return;
    }

    let Some(second) = values.next() else {
        span.record(field, first);
        return;
    };
    let Ok(second) = second.to_str() else {
        return;
    };
    if first.len() + 2 + second.len() > MAX_TRACED_HEADER_VALUE_LEN {
        return;
    }

    let mut joined = String::with_capacity(first.len() + 2 + second.len());
    joined.push_str(first);
    joined.push_str(", ");
    joined.push_str(second);

    for value in values {
        let Ok(value) = value.to_str() else {
            return;
        };
        if joined.len() + 2 + value.len() > MAX_TRACED_HEADER_VALUE_LEN {
            return;
        }
        joined.push_str(", ");
        joined.push_str(value);
    }

    span.record(field, joined.as_str());
}

fn record_request_header_fields(span: &Span, headers: &HeaderMap) {
    record_header_field(span, "http.request.headers.host", headers, header::HOST);
    record_header_field(
        span,
        "http.request.headers.content-type",
        headers,
        header::CONTENT_TYPE,
    );
    record_header_field(
        span,
        "http.request.headers.content-length",
        headers,
        header::CONTENT_LENGTH,
    );
    record_header_field(
        span,
        "http.request.headers.accept-encoding",
        headers,
        header::ACCEPT_ENCODING,
    );
    record_header_field(span, "http.request.headers.origin", headers, header::ORIGIN);
    record_header_field(
        span,
        "http.request.headers.access-control-request-method",
        headers,
        header::ACCESS_CONTROL_REQUEST_METHOD,
    );
    record_header_field(
        span,
        "http.request.headers.access-control-request-headers",
        headers,
        header::ACCESS_CONTROL_REQUEST_HEADERS,
    );
    record_header_field(
        span,
        "http.request.headers.upgrade",
        headers,
        header::UPGRADE,
    );
    record_header_field(
        span,
        "http.request.headers.sec-websocket-protocol",
        headers,
        header::SEC_WEBSOCKET_PROTOCOL,
    );
}

fn record_response_header_fields(span: &Span, headers: &HeaderMap) {
    record_header_field(
        span,
        "http.response.headers.content-type",
        headers,
        header::CONTENT_TYPE,
    );
    record_header_field(
        span,
        "http.response.headers.content-length",
        headers,
        header::CONTENT_LENGTH,
    );
    record_header_field(
        span,
        "http.response.headers.content-encoding",
        headers,
        header::CONTENT_ENCODING,
    );
    record_header_field(
        span,
        "http.response.headers.cache-control",
        headers,
        header::CACHE_CONTROL,
    );
    record_header_field(span, "http.response.headers.vary", headers, header::VARY);
    record_header_field(
        span,
        "http.response.headers.retry-after",
        headers,
        header::RETRY_AFTER,
    );
    record_header_field(
        span,
        "http.response.headers.access-control-allow-origin",
        headers,
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
    );
    record_header_field(
        span,
        "http.response.headers.upgrade",
        headers,
        header::UPGRADE,
    );
    record_header_field(
        span,
        "http.response.headers.sec-websocket-protocol",
        headers,
        header::SEC_WEBSOCKET_PROTOCOL,
    );
}

fn make_request_span<B>(request: &Request<B>) -> Span {
    let span = tracing::info_span!(
        "request",
        req.method = %request.method(),
        req.url = %request.uri(),
        req.id = tracing::field::Empty,
        req.userAgent = tracing::field::Empty,
        req.ip = tracing::field::Empty,
        "http.request.headers.host" = tracing::field::Empty,
        "http.request.headers.content-type" = tracing::field::Empty,
        "http.request.headers.content-length" = tracing::field::Empty,
        "http.request.headers.accept-encoding" = tracing::field::Empty,
        "http.request.headers.origin" = tracing::field::Empty,
        "http.request.headers.access-control-request-method" = tracing::field::Empty,
        "http.request.headers.access-control-request-headers" = tracing::field::Empty,
        "http.request.headers.upgrade" = tracing::field::Empty,
        "http.request.headers.sec-websocket-protocol" = tracing::field::Empty,
        res.statusCode = tracing::field::Empty,
        res.responseTime = tracing::field::Empty,
        "http.response.headers.content-type" = tracing::field::Empty,
        "http.response.headers.content-length" = tracing::field::Empty,
        "http.response.headers.content-encoding" = tracing::field::Empty,
        "http.response.headers.cache-control" = tracing::field::Empty,
        "http.response.headers.vary" = tracing::field::Empty,
        "http.response.headers.retry-after" = tracing::field::Empty,
        "http.response.headers.access-control-allow-origin" = tracing::field::Empty,
        "http.response.headers.upgrade" = tracing::field::Empty,
        "http.response.headers.sec-websocket-protocol" = tracing::field::Empty,
        error = tracing::field::Empty,
        errorMessage = tracing::field::Empty,
    );

    record_header_field(
        &span,
        "req.id",
        request.headers(),
        HeaderName::from_static("x-request-id"),
    );
    record_header_field(
        &span,
        "req.userAgent",
        request.headers(),
        header::USER_AGENT,
    );
    // TODO(tec27): Ideally this would come from our IP source, but extracting it is async and we
    // can't easily make use of that here, so it'll take some more figuring out to make work
    record_header_field(
        &span,
        "req.ip",
        request.headers(),
        HeaderName::from_static("x-real-ip"),
    );
    record_request_header_fields(&span, request.headers());

    span
}

fn record_response_fields<B>(response: &Response<B>, latency: Duration, span: &Span) {
    span.record("res.statusCode", response.status().as_u16());
    span.record("res.responseTime", latency.as_millis());
    record_response_header_fields(span, response.headers());
}

async fn graphql_handler(
    ip: ClientIp,
    user_agent: Option<TypedHeader<UserAgent>>,
    session: SbSession,
    current_user: Option<CurrentUser>,
    State(schema): State<SbSchema>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema
        .execute(
            req.into_inner()
                .data(ip)
                .data(user_agent)
                .data(session)
                .data(current_user),
        )
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

    // Load the runtime matchmaker config from the DB into a swappable handle shared by the search
    // loop (reads it each tick) and the admin GraphQL mutation (rewrites + hot-reloads it). Falls
    // back to built-in defaults if the row is missing/unparseable.
    let matchmaker_config = Arc::new(ArcSwap::from_pointee(
        load_matchmaker_config(&db_pool).await,
    ));

    // Only present when Twitch is configured; disables the integration otherwise.
    let twitch_client = TwitchClient::from_settings(&settings);
    if let Some(twitch_client) = twitch_client.clone() {
        tokio::spawn(reconcile_subscriptions_loop(
            twitch_client.clone(),
            db_pool.clone(),
        ));
        tokio::spawn(refresh_live_streams_loop(
            twitch_client,
            db_pool.clone(),
            redis_pool.clone(),
        ));
    }

    let schema = build_schema()
        .extension(Tracing)
        .extension(ErrorLoggerExtension)
        .data(settings.clone())
        .data(db_pool.clone())
        .data(redis_pool.clone())
        .data(mailgun.clone())
        .data(file_store.clone())
        .data(name_checker.clone())
        .data(matchmaker_config.clone())
        .data(twitch_client.clone())
        .module(TwitchModule::new(db_pool.clone(), redis_pool.clone()))
        .module(MapsModule::new(db_pool.clone()))
        .module(GamesModule::new(db_pool.clone()))
        .module(GameReportsModule::new(db_pool.clone()))
        .module(NewsModule::new(db_pool.clone()))
        .module(UsersModule::new(
            db_pool.clone(),
            redis_pool.clone(),
            file_store.clone(),
        ))
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
    describe_database_pool_metrics();

    let metrics_db_pool = db_pool.clone();
    let metrics_router = Router::new()
        .route(
            "/",
            get(move || {
                let metric_handle = metric_handle.clone();
                let db_pool = metrics_db_pool.clone();
                async move {
                    record_database_pool_metrics(&db_pool);
                    metric_handle.render()
                }
            }),
        )
        .layer(middleware::from_fn(only_unforwarded_clients));
    let names_router = create_names_api().layer(middleware::from_fn(only_unforwarded_clients));
    let matchmaker_router = create_matchmaking_api(
        redis_pool.clone(),
        matchmaker_config,
        settings.rp2_coordinator_url.clone(),
    )
    .layer(middleware::from_fn(only_unforwarded_clients));

    let app_state = AppState {
        settings: Arc::new(settings.clone()),
        current_user_repo: CurrentUserRepo::new(
            db_pool.clone(),
            redis_pool.clone(),
            file_store.clone(),
        ),
        name_checker,
        db_pool,
        redis_pool,
        mailgun,
        file_store,
        jwt_key: Arc::new(DecodingKey::from_secret(
            settings.jwt_secret.expose_secret().as_ref(),
        )),
        graphql_schema: schema.clone(),
        twitch_client,
    };

    Ok(Router::new()
        .route("/healthcheck", get(health_check))
        .route("/gql", get(graphql_handler).post(graphql_handler))
        .route("/gql/ws", get(graphql_ws_handler))
        // Twitch EventSub webhook -- external-facing (Twitch calls it) and unauthenticated (verified
        // by HMAC signature instead), so it stays on the main router rather than behind
        // `only_unforwarded_clients`.
        .nest("/twitch", create_twitch_api())
        .nest("/users/names", names_router)
        .nest("/matchmaker", matchmaker_router)
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
                        .make_span_with(make_request_span)
                        .on_response(|response: &Response<_>, latency: Duration, span: &Span| {
                            record_response_fields(response, latency, span);

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
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::REQUEST_TIMEOUT,
                    Duration::from_secs(15),
                ))
                .layer(
                    CompressionLayer::new().no_br().compress_when(
                        SizeAbove::new(1024)
                            .and(NotForContentType::GRPC)
                            .and(NotForContentType::IMAGES)
                            .and(NotForContentType::SSE),
                    ),
                )
                .layer(
                    cors::CorsLayer::new()
                        // NOTE(tec27): We do this instead of `Any` because browsers will preflight
                        // every request with an Authorization header for `*`, but not if we specify
                        // that this specific origin is allowed
                        .allow_origin(AllowOrigin::predicate(|_, _| true))
                        .allow_headers([CONTENT_TYPE, header::AUTHORIZATION])
                        .allow_methods([
                            Method::DELETE,
                            Method::GET,
                            Method::HEAD,
                            Method::PATCH,
                            Method::POST,
                            Method::PUT,
                        ])
                        .allow_credentials(AllowCredentials::yes())
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use axum::http::HeaderValue;
    use serde_json::{Value, json};
    use tracing::{Event, Subscriber};
    use tracing_bunyan_formatter::{JsonStorage, JsonStorageLayer};
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::{Context as LayerContext, SubscriberExt};
    use tracing_subscriber::registry::LookupSpan;

    use super::*;

    #[derive(Clone)]
    struct CaptureSpanFields {
        fields: Arc<Mutex<Option<HashMap<String, Value>>>>,
    }

    impl<S> Layer<S> for CaptureSpanFields
    where
        S: Subscriber + for<'a> LookupSpan<'a>,
    {
        fn on_event(&self, event: &Event<'_>, ctx: LayerContext<'_, S>) {
            let Some(span) = ctx.event_span(event) else {
                return;
            };
            let extensions = span.extensions();
            let Some(storage) = extensions.get::<JsonStorage>() else {
                return;
            };
            let fields = storage
                .values()
                .iter()
                .map(|(&key, value)| (key.to_string(), value.clone()))
                .collect();
            *self.fields.lock().unwrap() = Some(fields);
        }
    }

    fn capture_request_fields(
        request: &Request<Body>,
        response: &Response<Body>,
    ) -> HashMap<String, Value> {
        let captured = Arc::new(Mutex::new(None));
        let subscriber =
            tracing_subscriber::registry()
                .with(JsonStorageLayer)
                .with(CaptureSpanFields {
                    fields: Arc::clone(&captured),
                });

        tracing::subscriber::with_default(subscriber, || {
            let span = make_request_span(request);
            record_response_fields(response, Duration::from_millis(25), &span);
            span.in_scope(|| tracing::info!("request completed"));
        });

        captured
            .lock()
            .unwrap()
            .take()
            .expect("request event should have been captured")
    }

    fn assert_field(fields: &HashMap<String, Value>, name: &str, expected: &str) {
        assert_eq!(fields.get(name), Some(&json!(expected)), "{name}");
    }

    #[test]
    fn allowlisted_headers_are_recorded_as_structured_fields() {
        let request = Request::builder()
            .method("POST")
            .uri("/gql")
            .header("x-request-id", "request-123")
            .header(header::USER_AGENT, "ShieldBattery/Test")
            .header("x-real-ip", "192.0.2.10")
            .header(header::HOST, "api.example.test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONTENT_LENGTH, "128")
            .header(header::ACCEPT_ENCODING, "gzip, zstd")
            .header(header::ORIGIN, "https://example.test")
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "authorization, content-type",
            )
            .header(header::UPGRADE, "websocket")
            .header(
                header::SEC_WEBSOCKET_PROTOCOL,
                "graphql-transport-ws, graphql-ws",
            )
            .body(Body::empty())
            .unwrap();
        let response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONTENT_LENGTH, "64")
            .header(header::CONTENT_ENCODING, "zstd")
            .header(header::CACHE_CONTROL, "private, max-age=0")
            .header(header::VARY, "origin")
            .header(header::VARY, "accept-encoding")
            .header(header::RETRY_AFTER, "30")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "https://example.test")
            .header(header::UPGRADE, "websocket")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "graphql-transport-ws")
            .body(Body::empty())
            .unwrap();

        let fields = capture_request_fields(&request, &response);

        assert_field(&fields, "req.id", "request-123");
        assert_field(&fields, "req.userAgent", "ShieldBattery/Test");
        assert_field(&fields, "req.ip", "192.0.2.10");
        assert_field(&fields, "http.request.headers.host", "api.example.test");
        assert_field(
            &fields,
            "http.request.headers.content-type",
            "application/json",
        );
        assert_field(&fields, "http.request.headers.content-length", "128");
        assert_field(
            &fields,
            "http.request.headers.accept-encoding",
            "gzip, zstd",
        );
        assert_field(
            &fields,
            "http.request.headers.origin",
            "https://example.test",
        );
        assert_field(
            &fields,
            "http.request.headers.access-control-request-method",
            "POST",
        );
        assert_field(
            &fields,
            "http.request.headers.access-control-request-headers",
            "authorization, content-type",
        );
        assert_field(&fields, "http.request.headers.upgrade", "websocket");
        assert_field(
            &fields,
            "http.request.headers.sec-websocket-protocol",
            "graphql-transport-ws, graphql-ws",
        );
        assert_field(
            &fields,
            "http.response.headers.content-type",
            "application/json",
        );
        assert_field(&fields, "http.response.headers.content-length", "64");
        assert_field(&fields, "http.response.headers.content-encoding", "zstd");
        assert_field(
            &fields,
            "http.response.headers.cache-control",
            "private, max-age=0",
        );
        assert_field(
            &fields,
            "http.response.headers.vary",
            "origin, accept-encoding",
        );
        assert_field(&fields, "http.response.headers.retry-after", "30");
        assert_field(
            &fields,
            "http.response.headers.access-control-allow-origin",
            "https://example.test",
        );
        assert_field(&fields, "http.response.headers.upgrade", "websocket");
        assert_field(
            &fields,
            "http.response.headers.sec-websocket-protocol",
            "graphql-transport-ws",
        );
    }

    #[test]
    fn sensitive_and_unapproved_headers_are_not_recorded() {
        let request = Request::builder()
            .uri("/healthcheck")
            .header(header::CONTENT_TYPE, "request-allowed")
            .header(header::AUTHORIZATION, "request-authorization-secret")
            .header(
                header::PROXY_AUTHORIZATION,
                "request-proxy-authorization-secret",
            )
            .header(header::COOKIE, "request-cookie-secret")
            .header("sb-session-id", "request-session-secret")
            .header(
                "twitch-eventsub-message-signature",
                "request-twitch-signature-secret",
            )
            .header(header::REFERER, "request-referer-secret")
            .header("x-custom-secret", "request-custom-secret")
            .body(Body::empty())
            .unwrap();
        let response = Response::builder()
            .header(header::CONTENT_TYPE, "response-allowed")
            .header(header::SET_COOKIE, "response-cookie-secret")
            .header(header::LOCATION, "response-location-secret")
            .header("x-custom-secret", "response-custom-secret")
            .body(Body::empty())
            .unwrap();

        let fields = capture_request_fields(&request, &response);

        assert_field(
            &fields,
            "http.request.headers.content-type",
            "request-allowed",
        );
        assert_field(
            &fields,
            "http.response.headers.content-type",
            "response-allowed",
        );
        assert!(!fields.contains_key("req.headers"));
        assert!(!fields.contains_key("res.headers"));

        let serialized = serde_json::to_string(&fields).unwrap();
        for secret in [
            "request-authorization-secret",
            "request-proxy-authorization-secret",
            "request-cookie-secret",
            "request-session-secret",
            "request-twitch-signature-secret",
            "request-referer-secret",
            "request-custom-secret",
            "response-cookie-secret",
            "response-location-secret",
            "response-custom-secret",
        ] {
            assert!(!serialized.contains(secret), "{secret} was recorded");
        }
    }

    #[test]
    fn invalid_or_oversized_header_values_are_not_recorded() {
        let mut request = Request::builder()
            .uri("/healthcheck")
            .body(Body::empty())
            .unwrap();
        request.headers_mut().insert(
            header::ORIGIN,
            HeaderValue::from_str(&"a".repeat(MAX_TRACED_HEADER_VALUE_LEN + 1)).unwrap(),
        );
        request.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_bytes(&[0xff]).unwrap(),
        );
        let response = Response::new(Body::empty());

        let fields = capture_request_fields(&request, &response);

        assert!(!fields.contains_key("http.request.headers.origin"));
        assert!(!fields.contains_key("http.request.headers.content-type"));
    }
}
