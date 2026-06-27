//! Prometheus metrics for the matchmaker, emitted through the `metrics` facade crate (referred to
//! below as `::metrics` to disambiguate it from this module). The global Prometheus recorder is
//! installed by `axum_prometheus`'s `PrometheusMetricLayer::pair()` (see `routes.rs`), so everything
//! recorded here is rendered on the existing `/metrics` endpoint alongside the HTTP metrics — there
//! is no separate registry to wire up. The distribution metrics render as Prometheus *summaries*
//! (quantiles), because that recorder is built without custom histogram buckets.

use std::time::{Duration, Instant};

use strum::IntoEnumIterator;

use crate::matchmaking::MatchmakingType;
use crate::matchmaking::matchmaker::{Match, Matchmaker, QueueSelector};

const QUEUE_SIZE: &str = "matchmaker_queue_size";
const POPULATION_ESTIMATE: &str = "matchmaker_population_estimate";
const EFFECTIVE_MIN_QUALITY: &str = "matchmaker_effective_min_quality";
const SEARCH_TICK_DURATION: &str = "matchmaker_search_tick_duration_seconds";
const MATCH_QUALITY: &str = "matchmaker_match_quality";
const MATCH_SKILL_VARIANCE: &str = "matchmaker_match_skill_variance";
const MATCH_WINPROB_IMBALANCE: &str = "matchmaker_match_winprob_imbalance";
const MATCH_LATENCY_MS: &str = "matchmaker_match_latency_ms";
const MATCH_WAIT_SECONDS: &str = "matchmaker_match_wait_seconds";
const MATCHES_FORMED: &str = "matchmaker_matches_formed_total";
const PLAYERS_QUEUED: &str = "matchmaker_players_queued_total";
const PLAYERS_REQUEUED: &str = "matchmaker_players_requeued_total";
const PUBLISH_FAILURES: &str = "matchmaker_publish_failures_total";

/// Registers metric descriptions (the HELP/TYPE text on `/metrics`). Safe to call once at startup;
/// recording a metric without describing it still works, this just produces nicer output.
pub fn describe_metrics() {
    use ::metrics::Unit;

    ::metrics::describe_gauge!(
        QUEUE_SIZE,
        Unit::Count,
        "Players currently queued, per mode"
    );
    ::metrics::describe_gauge!(
        POPULATION_ESTIMATE,
        Unit::Count,
        "Smoothed (EWMA) population estimate driving the adaptive threshold, per mode"
    );
    ::metrics::describe_gauge!(
        EFFECTIVE_MIN_QUALITY,
        Unit::Count,
        "Current adaptive minimum match quality (seconds of wait), per mode; lower = more relaxed"
    );
    ::metrics::describe_histogram!(
        SEARCH_TICK_DURATION,
        Unit::Seconds,
        "Wall-clock duration of one matchmaker search tick"
    );
    ::metrics::describe_histogram!(
        MATCH_QUALITY,
        Unit::Count,
        "Quality score (seconds of wait) of each formed match, per mode"
    );
    ::metrics::describe_histogram!(
        MATCH_SKILL_VARIANCE,
        Unit::Count,
        "Variance of effective ratings in each formed match, per mode"
    );
    ::metrics::describe_histogram!(
        MATCH_WINPROB_IMBALANCE,
        Unit::Count,
        "abs(0.5 - win probability) of each formed match, per mode"
    );
    ::metrics::describe_histogram!(
        MATCH_LATENCY_MS,
        Unit::Milliseconds,
        "Estimated worst-pair one-way latency of each formed match, per mode"
    );
    ::metrics::describe_histogram!(
        MATCH_WAIT_SECONDS,
        Unit::Seconds,
        "Wait time of the oldest player in each formed match, per mode"
    );
    ::metrics::describe_counter!(MATCHES_FORMED, Unit::Count, "Matches formed, per mode");
    ::metrics::describe_counter!(
        PLAYERS_QUEUED,
        Unit::Count,
        "Players added to the queue, per mode"
    );
    ::metrics::describe_counter!(
        PLAYERS_REQUEUED,
        Unit::Count,
        "Players re-queued after a failed match, per mode"
    );
    ::metrics::describe_counter!(
        PUBLISH_FAILURES,
        Unit::Count,
        "Failed attempts to publish a formed match to Redis"
    );
}

/// Samples the per-mode queue gauges. Call once per search tick while holding the matchmaker lock,
/// after the population estimate has been rolled forward and *before* the queue is drained, so the
/// gauges reflect everyone waiting this tick rather than the post-drain residual.
pub fn sample_queue_state<T: QueueSelector>(matchmaker: &Matchmaker<T>, min_quality: f32) {
    for mode in MatchmakingType::iter() {
        let label = mode.as_str();
        ::metrics::gauge!(QUEUE_SIZE, "mode" => label).set(matchmaker.queue_size(mode) as f64);
        // Absent until the first sampling window folds; leave the series unset rather than reporting
        // a misleading 0 for a mode whose population just hasn't been seeded yet.
        if let Some(estimate) = matchmaker.population_estimate(mode) {
            ::metrics::gauge!(POPULATION_ESTIMATE, "mode" => label).set(estimate as f64);
        }
        ::metrics::gauge!(EFFECTIVE_MIN_QUALITY, "mode" => label)
            .set(matchmaker.effective_min_quality(mode, min_quality) as f64);
    }
}

pub fn record_search_tick_duration(duration: Duration) {
    ::metrics::histogram!(SEARCH_TICK_DURATION).record(duration.as_secs_f64());
}

/// Records the distribution + counter metrics for a single formed match. `now` is the tick's
/// reference instant, used to derive the oldest player's wait time.
pub fn record_match_formed(m: &Match, now: Instant) {
    let label = m.mode.as_str();
    ::metrics::counter!(MATCHES_FORMED, "mode" => label).increment(1);
    ::metrics::histogram!(MATCH_QUALITY, "mode" => label).record(m.quality as f64);
    ::metrics::histogram!(MATCH_SKILL_VARIANCE, "mode" => label).record(m.skill_variance as f64);
    ::metrics::histogram!(MATCH_WINPROB_IMBALANCE, "mode" => label)
        .record((0.5 - m.win_probability).abs() as f64);
    ::metrics::histogram!(MATCH_LATENCY_MS, "mode" => label).record(m.max_latency as f64);

    let oldest = m
        .team_a
        .iter()
        .chain(m.team_b.iter())
        .map(|e| e.queue_time)
        .min();
    if let Some(oldest) = oldest {
        ::metrics::histogram!(MATCH_WAIT_SECONDS, "mode" => label)
            .record(now.saturating_duration_since(oldest).as_secs_f64());
    }
}

pub fn record_player_queued(mode: MatchmakingType) {
    ::metrics::counter!(PLAYERS_QUEUED, "mode" => mode.as_str()).increment(1);
}

pub fn record_player_requeued(mode: MatchmakingType) {
    ::metrics::counter!(PLAYERS_REQUEUED, "mode" => mode.as_str()).increment(1);
}

pub fn record_publish_failure() {
    ::metrics::counter!(PUBLISH_FAILURES).increment(1);
}
