use std::{fmt::Write as _, sync::Arc};

use async_graphql::{
    Error, ErrorExtensions, PathSegment, Response, Value,
    extensions::{Extension, ExtensionContext, ExtensionFactory, NextExecute},
};
use color_eyre::eyre::eyre;
use tracing::error;

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

// async-graphql doesn't log errors as error level by default, so we add a custom extension to do so
// so they end up in datadog
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
                    })
                    .unwrap_or("unknown");
                ::metrics::counter!(
                    GRAPHQL_ERRORS_TOTAL,
                    "code" => code.to_string(),
                    "operation" => operation.to_string()
                )
                .increment(1);

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

                if !err.path.is_empty() {
                    let mut path = String::new();
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

                    error!(
                        "[GraphQL Error] path={} message={} source={}",
                        path, err.message, source
                    );
                } else {
                    error!("[GraphQL Error] message={} source={}", err.message, source);
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
