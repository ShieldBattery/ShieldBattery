use std::{fmt::Write as _, sync::Arc};

use async_graphql::{
    Error, ErrorExtensions, PathSegment, Response, Value,
    extensions::{Extension, ExtensionContext, ExtensionFactory, NextExecute},
};
use color_eyre::eyre::eyre;
use tracing::{error, info};

// TODO(tec27): We need some better way of documenting/restricting codes here, and it would probably
// make sense to do that via an Error type that can be converted into a graphql Error automatically
// + assigns these extension values during that
pub fn graphql_error(code: &'static str, message: impl Into<String>) -> Error {
    let message = message.into();
    eyre!(message.clone()).extend_with(|_err, e| {
        e.set("code", code);
        e.set("message", message);
    })
}

const GRAPHQL_ERRORS_TOTAL: &str = "graphql_errors_total";

/// Registers metric descriptions (the HELP/TYPE text on `/metrics`). Safe to call once at startup;
/// recording a metric without describing it still works, this just produces nicer output.
pub fn describe_metrics() {
    use ::metrics::Unit;

    ::metrics::describe_counter!(
        GRAPHQL_ERRORS_TOTAL,
        Unit::Count,
        "GraphQL errors returned in a response, per error code and operation"
    );
}

/// Errors raised through `graphql_error` with one of these codes indicate a server-side failure;
/// every other code is an expected, client-facing outcome (bad input, missing permissions, a
/// cooldown, etc.).
const SERVER_FAILURE_CODES: &[&str] = &["INTERNAL_SERVER_ERROR"];

// async-graphql doesn't log errors by default, so we add a custom extension to do so so they end up
// in datadog. Uncoded errors (unexpected failures propagated with `?`, or async-graphql's own
// request errors) and server-failure codes log at error level; expected client-facing outcomes log
// at info so they don't drown out real failures.
#[derive(Default)]
pub struct ErrorLoggerExtension;

#[async_trait::async_trait]
impl Extension for ErrorLoggerExtension {
    async fn execute(
        &self,
        ctx: &ExtensionContext<'_>,
        operation_name: Option<&str>,
        next: NextExecute<'_>,
    ) -> Response {
        let resp = next.run(ctx, operation_name).await;

        if resp.is_err() {
            // GraphQL responses come back as HTTP 200 even when they carry errors, so the
            // axum-level HTTP metrics never see these -- record them here instead.
            let operation = operation_name.unwrap_or("unknown");
            for err in &resp.errors {
                let code = err
                    .extensions
                    .as_ref()
                    .and_then(|extensions| extensions.get("code"))
                    .and_then(|value| match value {
                        Value::String(code) => Some(code.as_str()),
                        _ => None,
                    });
                ::metrics::counter!(
                    GRAPHQL_ERRORS_TOTAL,
                    "code" => code.unwrap_or("unknown").to_string(),
                    "operation" => operation.to_string()
                )
                .increment(1);
                let is_server_failure = code.is_none_or(|c| SERVER_FAILURE_CODES.contains(&c));

                let source = match &err.source {
                    Some(source) => {
                        if let Some(report) = source.downcast_ref::<color_eyre::Report>() {
                            format!("{report:?}")
                        } else {
                            format!("{source:?}")
                        }
                    }
                    None => "None".to_string(),
                };

                let mut path = String::new();
                if !err.path.is_empty() {
                    path.push_str("path=");
                    for (idx, s) in err.path.iter().enumerate() {
                        if idx > 0 {
                            path.push('.');
                        }
                        match s {
                            PathSegment::Index(idx) => {
                                let _ = write!(&mut path, "{idx}");
                            }
                            PathSegment::Field(name) => {
                                let _ = write!(&mut path, "{name}");
                            }
                        }
                    }
                    path.push(' ');
                }

                if is_server_failure {
                    error!(
                        "[GraphQL Error] {path}message={} source={source}",
                        err.message
                    );
                } else {
                    info!(
                        "[GraphQL Error] {path}message={} source={source}",
                        err.message
                    );
                }
            }
        }

        resp
    }
}

impl ExtensionFactory for ErrorLoggerExtension {
    fn create(&self) -> Arc<dyn Extension> {
        Arc::new(ErrorLoggerExtension)
    }
}
