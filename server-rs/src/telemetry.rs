use std::future::Future;
use tokio::task::JoinHandle;
use tracing::Instrument;
use tracing_bunyan_formatter::{BunyanFormattingLayer, JsonStorageLayer};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

pub fn init_subscriber<Sink>(name: impl Into<String>, env_filter: impl AsRef<str>, sink: Sink)
where
    Sink: for<'a> MakeWriter<'a> + Send + Sync + 'static,
{
    let formatting_layer = BunyanFormattingLayer::new(name.into(), sink);
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(env_filter)))
        .with(JsonStorageLayer)
        .with(formatting_layer)
        .init();
}

/// Calls [tokio::task::spawn_blocking] in a way that preserves traces from the calling scope.
pub fn spawn_blocking_with_tracing<F, R>(f: F) -> JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let current_span = tracing::Span::current();
    tokio::task::spawn_blocking(move || current_span.in_scope(f))
}

/// Calls [tokio::spawn], linking the spawned task to the current span via
/// [tracing::Span::follows_from].
pub fn spawn_with_tracing<F>(f: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    let current_span = tracing::Span::current();
    let new_span = tracing::span!(tracing::Level::INFO, "spawned_task");
    new_span.follows_from(current_span);
    tokio::spawn(f.instrument(new_span))
}
