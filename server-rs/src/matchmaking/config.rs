//! Runtime-tunable matchmaker configuration.
//!
//! The matchmaker's tuning knobs (quality-formula weights, the adaptive low-population threshold, and
//! a few process-level operational settings) live in the `matchmaking_config` table rather than as
//! compile-time constants, so they can be adjusted without a code change/release. server-rs loads the
//! row at startup into an [`arc_swap::ArcSwap`] shared with the search loop; the admin GraphQL
//! mutation (separate change) rewrites the row and reloads the swap.
//!
//! The stored JSON holds only *overrides*; anything absent falls back to the [`Default`] impls below,
//! which mirror the constants the matchmaker shipped with. A missing or unparseable row therefore
//! yields the built-in defaults, so matchmaking can never be bricked by a bad config. Every value is
//! also clamped to a sane range on load as a second line of defence against a bad write.

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use sqlx::PgPool;
use sqlx::types::Json;

use crate::matchmaking::MatchmakingType;

/// Per-mode tuning knobs. Defaults mirror the constants the matchmaker shipped with (see
/// `matchmaker.rs`). Overridable globally and, sparsely, per mode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModeConfig {
    /// Seconds of wait traded per unit of skill variance.
    pub weight_rating_variance: f32,
    /// Seconds of wait traded per unit of win-probability imbalance.
    pub weight_win_prob: f32,
    /// Seconds of wait traded per latency turn-rate step.
    pub weight_latency: f32,
    /// σ multiplier for the conservative effective rating (rating − k·σ).
    pub uncertainty_k: f32,
    /// Base minimum quality (seconds of wait) a match must reach; relaxed adaptively in low pop.
    pub min_quality: f32,
    /// Comfortable population = this × `mode.total_players()`; at/above it the full threshold applies.
    pub adaptive_comfortable_multiplier: usize,
    /// Seconds the threshold drops per player below the comfortable population.
    pub adaptive_decay_per_missing: f32,
    /// Half-life of the smoothed population estimate's EWMA.
    pub population_half_life: Duration,
}

impl Default for ModeConfig {
    fn default() -> Self {
        Self {
            weight_rating_variance: 0.005,
            weight_win_prob: 50.0,
            weight_latency: 30.0,
            uncertainty_k: 1.0,
            min_quality: -30.0,
            adaptive_comfortable_multiplier: 2,
            adaptive_decay_per_missing: 15.0,
            population_half_life: Duration::from_secs(20 * 60),
        }
    }
}

/// The full matchmaker configuration: process-level operational knobs plus the global per-mode
/// defaults and any (pre-resolved) per-mode overrides.
#[derive(Debug, Clone)]
pub struct MatchmakerConfig {
    /// How often the search loop runs.
    pub search_interval: Duration,
    /// Max queue entries the matchmaker examines per mode per tick.
    pub max_players_examined: usize,
    global: ModeConfig,
    /// Fully-resolved config for the modes that carry an override (global merged with the override).
    /// Modes absent here use `global` directly.
    per_mode: HashMap<MatchmakingType, ModeConfig>,
}

impl Default for MatchmakerConfig {
    fn default() -> Self {
        Self {
            search_interval: Duration::from_secs(6),
            max_players_examined: 16,
            global: ModeConfig::default(),
            per_mode: HashMap::new(),
        }
    }
}

impl MatchmakerConfig {
    /// The resolved config for `mode`: its override if one exists, otherwise the global defaults.
    pub fn for_mode(&self, mode: MatchmakingType) -> &ModeConfig {
        self.per_mode.get(&mode).unwrap_or(&self.global)
    }

    /// Builds a config from an explicit global [`ModeConfig`], with default operational knobs and no
    /// per-mode overrides. For tests that need a specific knob value.
    #[cfg(test)]
    pub(crate) fn from_global(global: ModeConfig) -> Self {
        Self {
            global,
            ..Default::default()
        }
    }

    fn from_stored(stored: StoredConfig) -> Self {
        let global = stored.global.resolve_onto(ModeConfig::default());
        // Per-mode overrides layer on top of the *resolved global*, so a mode that overrides only one
        // field inherits the rest of the global config (including its overrides). An unrecognized mode
        // key (e.g. a removed/renamed mode, or one written by a newer server) is dropped with a log
        // rather than failing the whole parse — losing one mode's override is far better than silently
        // reverting *every* knob to defaults.
        let per_mode = stored
            .per_mode
            .iter()
            .filter_map(|(key, over)| match parse_mode_key(key) {
                Some(mode) => Some((mode, over.resolve_onto(global))),
                None => {
                    tracing::warn!("ignoring matchmaking_config override for unknown mode {key:?}");
                    None
                }
            })
            .collect();

        Self {
            search_interval: clamp_duration(stored.search_interval_seconds, 1, 60)
                .unwrap_or(Duration::from_secs(6)),
            max_players_examined: stored
                .max_players_examined
                .map(|v| v.clamp(2, 200) as usize)
                .unwrap_or(16),
            global,
            per_mode,
        }
    }
}

/// Builds a clamped [`Duration`] from optional seconds, or `None` to fall back to a default. Drops
/// non-finite inputs defensively (standard JSON can't carry NaN/∞, but this keeps `from_secs_f64`
/// from ever seeing one).
fn clamp_duration(seconds: Option<f64>, min: u64, max: u64) -> Option<Duration> {
    seconds
        .filter(|s| s.is_finite())
        .map(|s| Duration::from_secs_f64(s.clamp(min as f64, max as f64)))
}

/// Stored (JSON) form of [`MatchmakerConfig`]: every field optional so the row carries only the
/// overrides an admin set. Unknown fields are ignored (forward-compatible).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredConfig {
    search_interval_seconds: Option<f64>,
    max_players_examined: Option<i64>,
    global: StoredModeConfig,
    // Keyed by the mode's stored string name rather than `MatchmakingType` so an unknown key doesn't
    // fail the entire deserialize (see `from_stored`); the keys are resolved to modes there.
    per_mode: HashMap<String, StoredModeConfig>,
}

/// Parses a stored per-mode key (e.g. `"3v3bgh"`) into a [`MatchmakingType`], or `None` if it doesn't
/// match a known mode. Uses serde so the accepted names stay in lockstep with the enum's renames.
fn parse_mode_key(key: &str) -> Option<MatchmakingType> {
    serde_json::from_value(serde_json::Value::String(key.to_owned())).ok()
}

/// Stored (JSON) form of [`ModeConfig`]: a sparse set of knob overrides.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredModeConfig {
    weight_rating_variance: Option<f32>,
    weight_win_prob: Option<f32>,
    weight_latency: Option<f32>,
    uncertainty_k: Option<f32>,
    min_quality: Option<f32>,
    adaptive_comfortable_multiplier: Option<i64>,
    adaptive_decay_per_missing: Option<f32>,
    population_half_life_seconds: Option<f64>,
}

impl StoredModeConfig {
    /// Resolves this sparse override onto `base`, clamping every field to its valid range.
    fn resolve_onto(&self, base: ModeConfig) -> ModeConfig {
        ModeConfig {
            weight_rating_variance: clamp_f32(
                self.weight_rating_variance,
                base.weight_rating_variance,
                0.0,
                0.1,
            ),
            weight_win_prob: clamp_f32(self.weight_win_prob, base.weight_win_prob, 0.0, 500.0),
            weight_latency: clamp_f32(self.weight_latency, base.weight_latency, 0.0, 300.0),
            uncertainty_k: clamp_f32(self.uncertainty_k, base.uncertainty_k, 0.0, 3.0),
            min_quality: clamp_f32(self.min_quality, base.min_quality, -600.0, 60.0),
            adaptive_comfortable_multiplier: self
                .adaptive_comfortable_multiplier
                .map(|v| v.clamp(1, 10) as usize)
                .unwrap_or(base.adaptive_comfortable_multiplier),
            adaptive_decay_per_missing: clamp_f32(
                self.adaptive_decay_per_missing,
                base.adaptive_decay_per_missing,
                0.0,
                120.0,
            ),
            population_half_life: clamp_duration(
                self.population_half_life_seconds,
                60,
                24 * 60 * 60,
            )
            .unwrap_or(base.population_half_life),
        }
    }
}

/// Returns `value` (when present and finite) clamped to `[min, max]`, else `base`.
fn clamp_f32(value: Option<f32>, base: f32, min: f32, max: f32) -> f32 {
    value
        .filter(|v| v.is_finite())
        .unwrap_or(base)
        .clamp(min, max)
}

/// Loads the current matchmaker config from the database. Any failure (missing row, unparseable
/// JSON, DB error) falls back to the built-in defaults and logs — matchmaking must keep running.
pub async fn load_matchmaker_config(db: &PgPool) -> MatchmakerConfig {
    match sqlx::query!(
        r#"SELECT config as "config: Json<StoredConfig>" FROM matchmaking_config WHERE id = 1"#
    )
    .fetch_optional(db)
    .await
    {
        Ok(Some(row)) => MatchmakerConfig::from_stored(row.config.0),
        Ok(None) => {
            tracing::info!("no matchmaking_config row found; using built-in matchmaker defaults");
            MatchmakerConfig::default()
        }
        Err(e) => {
            tracing::error!("failed to load matchmaking_config, using built-in defaults: {e:?}");
            MatchmakerConfig::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> MatchmakerConfig {
        MatchmakerConfig::from_stored(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn empty_config_is_defaults() {
        let cfg = parse("{}");
        let defaults = MatchmakerConfig::default();
        assert_eq!(cfg.max_players_examined, defaults.max_players_examined);
        assert_eq!(cfg.search_interval, defaults.search_interval);
        assert_eq!(
            *cfg.for_mode(MatchmakingType::Match1v1),
            ModeConfig::default()
        );
    }

    #[test]
    fn unknown_fields_ignored() {
        let cfg = parse(r#"{"somethingNew": 5, "global": {"alsoNew": true}}"#);
        assert_eq!(
            *cfg.for_mode(MatchmakingType::Match1v1),
            ModeConfig::default()
        );
    }

    #[test]
    fn unknown_per_mode_key_dropped_without_losing_the_rest() {
        // A bogus/renamed mode key must not nuke the whole config: the global override and any valid
        // per-mode override still apply, the unknown key is simply ignored.
        let cfg = parse(
            r#"{
                "global": {"minQuality": -45},
                "perMode": {"4v4chaos": {"minQuality": 10}, "3v3bgh": {"weightWinProb": 75}}
            }"#,
        );
        assert_eq!(cfg.for_mode(MatchmakingType::Match1v1).min_quality, -45.0);
        let team = cfg.for_mode(MatchmakingType::Match3v3Bgh);
        assert_eq!(team.min_quality, -45.0);
        assert_eq!(team.weight_win_prob, 75.0);
    }

    #[test]
    fn global_override_applies_to_all_modes() {
        let cfg = parse(r#"{"global": {"weightWinProb": 75, "minQuality": -45}}"#);
        for mode in [MatchmakingType::Match1v1, MatchmakingType::Match3v3Bgh] {
            assert_eq!(cfg.for_mode(mode).weight_win_prob, 75.0);
            assert_eq!(cfg.for_mode(mode).min_quality, -45.0);
            // Untouched fields keep their defaults.
            assert_eq!(cfg.for_mode(mode).weight_latency, 30.0);
        }
    }

    #[test]
    fn per_mode_override_layers_on_global() {
        let cfg = parse(
            r#"{"global": {"minQuality": -45}, "perMode": {"3v3bgh": {"adaptiveDecayPerMissing": 25}}}"#,
        );
        // 1v1 has no per-mode override: global only.
        let one = cfg.for_mode(MatchmakingType::Match1v1);
        assert_eq!(one.min_quality, -45.0);
        assert_eq!(one.adaptive_decay_per_missing, 15.0);
        // 3v3bgh inherits the global minQuality and applies its own decay override.
        let team = cfg.for_mode(MatchmakingType::Match3v3Bgh);
        assert_eq!(team.min_quality, -45.0);
        assert_eq!(team.adaptive_decay_per_missing, 25.0);
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let cfg = parse(
            r#"{
                "searchIntervalSeconds": 9000,
                "maxPlayersExamined": 100000,
                "global": {"weightWinProb": -10, "uncertaintyK": 999, "minQuality": -100000}
            }"#,
        );
        assert_eq!(cfg.search_interval, Duration::from_secs(60));
        assert_eq!(cfg.max_players_examined, 200);
        let m = cfg.for_mode(MatchmakingType::Match1v1);
        assert_eq!(m.weight_win_prob, 0.0); // clamped up from -10
        assert_eq!(m.uncertainty_k, 3.0); // clamped down from 999
        assert_eq!(m.min_quality, -600.0); // clamped up from -100000
    }

    #[test]
    fn half_life_seconds_parsed_and_clamped() {
        let cfg = parse(r#"{"global": {"populationHalfLifeSeconds": 600}}"#);
        assert_eq!(
            cfg.for_mode(MatchmakingType::Match1v1).population_half_life,
            Duration::from_secs(600)
        );
        // Below the 60s floor → clamped up.
        let cfg = parse(r#"{"global": {"populationHalfLifeSeconds": 1}}"#);
        assert_eq!(
            cfg.for_mode(MatchmakingType::Match1v1).population_half_life,
            Duration::from_secs(60)
        );
    }
}
