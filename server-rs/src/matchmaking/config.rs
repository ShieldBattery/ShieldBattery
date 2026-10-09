//! Runtime-tunable matchmaker configuration.
//!
//! The matchmaker's tuning knobs (quality-formula weights, the adaptive low-population threshold, and
//! a few process-level operational settings) live in the `matchmaking_config` table rather than as
//! compile-time constants, so they can be adjusted without a code change/release. server-rs loads the
//! row at startup into an [`arc_swap::ArcSwap`] shared with the search loop; the admin GraphQL
//! mutation (separate change) rewrites the row and reloads the swap.
//!
//! The stored JSON holds only *overrides*; anything absent falls back to the built-in defaults below
//! ([`ModeConfig::default`] layered with [`builtin_mode_overrides`]). A missing or unparseable row
//! therefore yields the built-in defaults, so matchmaking can never be bricked by a bad config. Every
//! value is also clamped to a sane range on load as a second line of defence against a bad write.
//!
//! A mode's config resolves in four layers, each overriding the fields it sets: the global built-in
//! defaults, that mode's built-in adjustments, the stored global overrides, then the stored per-mode
//! overrides. Any stored value therefore beats any built-in one.

use std::collections::HashMap;
use std::time::Duration;

use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;
use strum::IntoEnumIterator;

use crate::matchmaking::MatchmakingType;

pub const MIN_PLAYERS_EXAMINED: i32 = 6;
pub const MAX_PLAYERS_EXAMINED: i32 = 24;
const DEFAULT_MAX_PLAYERS_EXAMINED: usize = 20;

/// Per-mode tuning knobs. Overridable globally and, sparsely, per mode.
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
    /// Rating difference (between players, or team average ratings) at which the matchmaker's win
    /// probability reaches 10:1 odds. Smaller values make a given gap more decisive. Fitted per mode
    /// from match outcomes, since how decisive a rating gap is varies by mode and drifts over time.
    pub win_prob_scale: f32,
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
            weight_latency: 45.0,
            uncertainty_k: 1.0,
            win_prob_scale: 400.0,
            min_quality: -30.0,
            adaptive_comfortable_multiplier: 2,
            adaptive_decay_per_missing: 15.0,
            population_half_life: Duration::from_secs(20 * 60),
        }
    }
}

/// Built-in per-mode adjustments to [`ModeConfig::default`], for knobs whose best value depends on
/// the mode's format. Stored overrides (global or per-mode) take precedence over these.
pub fn builtin_mode_overrides(mode: MatchmakingType) -> ModeConfigOverrides {
    if mode.team_size() == 1 {
        ModeConfigOverrides {
            // Each latency step raises failed starts and sub-5-minute games about twice as much in
            // 1v1 as in team modes.
            weight_latency: Some(60.0),
            ..Default::default()
        }
    } else {
        ModeConfigOverrides {
            // Lowering uncertain players' ratings makes team win predictions worse (it can remove
            // their predictive value entirely in a mode full of new players) and inflates the skill
            // variance of any match containing a new player. In 1v1 it helps, so only teams drop it.
            uncertainty_k: Some(0.0),
            // Lopsided team games (past roughly 70/30) end in early departures noticeably more
            // often, so imbalance should cost about as much as a wide skill spread.
            weight_win_prob: Some(400.0),
            // 2v2 ratings are compressed relative to outcomes: a given average-rating gap predicts a
            // more lopsided result than the 1v1 scale implies.
            win_prob_scale: (mode == MatchmakingType::Match2v2).then_some(210.0),
            ..Default::default()
        }
    }
}

/// The full matchmaker configuration: process-level operational knobs plus the fully-resolved
/// per-mode config.
#[derive(Debug, Clone)]
pub struct MatchmakerConfig {
    /// How often the search loop runs.
    pub search_interval: Duration,
    /// Max queue entries the matchmaker examines per mode per tick.
    pub max_players_examined: usize,
    /// Fully-resolved config for every mode (all four layers applied; see the module docs).
    per_mode: HashMap<MatchmakingType, ModeConfig>,
}

impl Default for MatchmakerConfig {
    fn default() -> Self {
        Self::from_stored(&StoredConfig::default())
    }
}

impl MatchmakerConfig {
    /// The resolved config for `mode`.
    pub fn for_mode(&self, mode: MatchmakingType) -> &ModeConfig {
        self.per_mode
            .get(&mode)
            .expect("every matchmaking mode has a resolved config")
    }

    /// Builds a config that uses exactly `global` for every mode (no built-in per-mode adjustments),
    /// with default operational knobs. For tests that need a specific knob value.
    #[cfg(test)]
    pub(crate) fn from_global(global: ModeConfig) -> Self {
        Self {
            per_mode: MatchmakingType::iter().map(|mode| (mode, global)).collect(),
            ..Default::default()
        }
    }

    /// Resolves a stored override set into the runtime config. Infallible (out-of-range values are
    /// clamped, unknown mode keys dropped), so the admin write path can reload from exactly what it
    /// persisted rather than re-reading the DB (whose loader silently falls back to defaults).
    pub(crate) fn from_stored(stored: &StoredConfig) -> Self {
        // An unrecognized mode key (e.g. a removed/renamed mode, or one written by a newer server) is
        // dropped with a log rather than failing the whole parse — losing one mode's override is far
        // better than silently reverting *every* knob to defaults.
        let stored_per_mode = stored
            .per_mode
            .iter()
            .filter_map(|(key, over)| match parse_mode_key(key) {
                Some(mode) => Some((mode, over)),
                None => {
                    tracing::warn!("ignoring matchmaking_config override for unknown mode {key:?}");
                    None
                }
            })
            .collect::<HashMap<_, _>>();
        let per_mode = MatchmakingType::iter()
            .map(|mode| {
                let builtin = builtin_mode_overrides(mode).resolve_onto(ModeConfig::default());
                let global = stored.global.resolve_onto(builtin);
                let resolved = match stored_per_mode.get(&mode) {
                    Some(over) => over.resolve_onto(global),
                    None => global,
                };
                (mode, resolved)
            })
            .collect();

        Self {
            search_interval: clamp_duration(stored.search_interval_seconds, 1, 60)
                .unwrap_or(Duration::from_secs(6)),
            max_players_examined: stored.max_players_examined.map_or(
                DEFAULT_MAX_PLAYERS_EXAMINED,
                |value| {
                    let clamped = value.clamp(MIN_PLAYERS_EXAMINED, MAX_PLAYERS_EXAMINED);
                    if clamped != value {
                        tracing::warn!(
                            value,
                            clamped,
                            "clamped unsafe matchmaking maxPlayersExamined value"
                        );
                    }
                    clamped as usize
                },
            ),
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
/// overrides an admin set. Unknown fields are ignored (forward-compatible). This is the exact shape
/// of the `matchmaking_config.config` JSONB column; the admin module builds and reads it.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StoredConfig {
    pub search_interval_seconds: Option<f64>,
    pub max_players_examined: Option<i32>,
    pub global: ModeConfigOverrides,
    // Keyed by the mode's stored string name rather than `MatchmakingType` so an unknown key doesn't
    // fail the entire deserialize (see `from_stored`); the keys are resolved to modes there.
    pub per_mode: HashMap<String, ModeConfigOverrides>,
}

/// Parses a stored per-mode key (e.g. `"3v3bgh"`) into a [`MatchmakingType`], or `None` if it doesn't
/// match a known mode. Uses serde so the accepted names stay in lockstep with the enum's renames.
pub(crate) fn parse_mode_key(key: &str) -> Option<MatchmakingType> {
    serde_json::from_value(serde_json::Value::String(key.to_owned())).ok()
}

/// Stored (JSON) form of [`ModeConfig`]: a sparse set of knob overrides. Doubles as the GraphQL
/// `MatchmakerModeConfigOverrides` (output) / `MatchmakerModeConfigOverridesInput` (input) type, so
/// the admin form sends and receives exactly the shape that is persisted.
#[derive(Debug, Default, Clone, PartialEq, Deserialize, Serialize, SimpleObject, InputObject)]
#[serde(rename_all = "camelCase", default)]
#[graphql(
    name = "MatchmakerModeConfigOverrides",
    input_name = "MatchmakerModeConfigOverridesInput"
)]
pub struct ModeConfigOverrides {
    pub weight_rating_variance: Option<f32>,
    pub weight_win_prob: Option<f32>,
    pub weight_latency: Option<f32>,
    pub uncertainty_k: Option<f32>,
    pub win_prob_scale: Option<f32>,
    pub min_quality: Option<f32>,
    pub adaptive_comfortable_multiplier: Option<i32>,
    pub adaptive_decay_per_missing: Option<f32>,
    pub population_half_life_seconds: Option<f64>,
}

impl ModeConfigOverrides {
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
            win_prob_scale: clamp_f32(self.win_prob_scale, base.win_prob_scale, 100.0, 1000.0),
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

/// Reads the raw stored config overrides from the database, returning an empty (all-defaults)
/// config on any failure (missing row, unparseable JSON, DB error) — with a log. This is the exact
/// shape the admin tools read and write; [`load_matchmaker_config`] resolves it into the runtime
/// config the matchmaker uses.
pub async fn load_stored_config(db: &PgPool) -> StoredConfig {
    match sqlx::query!(
        r#"SELECT config as "config: Json<StoredConfig>" FROM matchmaking_config WHERE id = 1"#
    )
    .fetch_optional(db)
    .await
    {
        Ok(Some(row)) => row.config.0,
        Ok(None) => {
            tracing::info!("no matchmaking_config row found; using built-in matchmaker defaults");
            StoredConfig::default()
        }
        Err(e) => {
            tracing::error!("failed to load matchmaking_config, using built-in defaults: {e:?}");
            StoredConfig::default()
        }
    }
}

/// Loads the current matchmaker config from the database, resolved into the runtime form the
/// matchmaker uses (see [`load_stored_config`] for the failure behaviour).
pub async fn load_matchmaker_config(db: &PgPool) -> MatchmakerConfig {
    MatchmakerConfig::from_stored(&load_stored_config(db).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> MatchmakerConfig {
        MatchmakerConfig::from_stored(&serde_json::from_str(json).unwrap())
    }

    /// The built-in config for `mode`: global defaults with that mode's built-in adjustments.
    fn builtin(mode: MatchmakingType) -> ModeConfig {
        builtin_mode_overrides(mode).resolve_onto(ModeConfig::default())
    }

    #[test]
    fn empty_config_is_defaults() {
        let cfg = parse("{}");
        let defaults = MatchmakerConfig::default();
        assert_eq!(defaults.max_players_examined, 20);
        assert_eq!(cfg.max_players_examined, defaults.max_players_examined);
        assert_eq!(cfg.search_interval, defaults.search_interval);
        for mode in MatchmakingType::iter() {
            assert_eq!(*cfg.for_mode(mode), builtin(mode));
            assert_eq!(*defaults.for_mode(mode), builtin(mode));
        }
    }

    #[test]
    fn builtin_mode_adjustments_apply() {
        let cfg = parse("{}");
        let one = cfg.for_mode(MatchmakingType::Match1v1);
        assert_eq!(one.weight_latency, 60.0);
        assert_eq!(one.uncertainty_k, 1.0);
        assert_eq!(one.win_prob_scale, 400.0);

        let two = cfg.for_mode(MatchmakingType::Match2v2);
        assert_eq!(two.weight_latency, 45.0);
        assert_eq!(two.uncertainty_k, 0.0);
        assert_eq!(two.weight_win_prob, 400.0);
        assert_eq!(two.win_prob_scale, 210.0);

        let three = cfg.for_mode(MatchmakingType::Match3v3Bgh);
        assert_eq!(three.uncertainty_k, 0.0);
        assert_eq!(three.weight_win_prob, 400.0);
        assert_eq!(three.win_prob_scale, 400.0);
    }

    #[test]
    fn stored_values_beat_builtin_mode_adjustments() {
        // A stored global value overrides every mode's built-in adjustment for that field, and a
        // stored per-mode value overrides both.
        let cfg = parse(
            r#"{
                "global": {"uncertaintyK": 0.5, "weightLatency": 40},
                "perMode": {"2v2": {"winProbScale": 300, "uncertaintyK": 2}}
            }"#,
        );
        let one = cfg.for_mode(MatchmakingType::Match1v1);
        assert_eq!(one.uncertainty_k, 0.5);
        assert_eq!(one.weight_latency, 40.0);
        let three = cfg.for_mode(MatchmakingType::Match3v3Bgh);
        assert_eq!(three.uncertainty_k, 0.5);
        // Untouched built-in adjustments survive.
        assert_eq!(three.weight_win_prob, 400.0);
        let two = cfg.for_mode(MatchmakingType::Match2v2);
        assert_eq!(two.uncertainty_k, 2.0);
        assert_eq!(two.win_prob_scale, 300.0);
        assert_eq!(two.weight_latency, 40.0);
    }

    #[test]
    fn unknown_fields_ignored() {
        let cfg = parse(r#"{"somethingNew": 5, "global": {"alsoNew": true}}"#);
        assert_eq!(
            *cfg.for_mode(MatchmakingType::Match1v1),
            builtin(MatchmakingType::Match1v1)
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
            // Untouched fields keep their built-in values.
            assert_eq!(
                cfg.for_mode(mode).weight_latency,
                builtin(mode).weight_latency
            );
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
                "global": {
                    "weightWinProb": -10,
                    "uncertaintyK": 999,
                    "minQuality": -100000,
                    "winProbScale": 5
                }
            }"#,
        );
        assert_eq!(cfg.search_interval, Duration::from_secs(60));
        assert_eq!(cfg.max_players_examined, MAX_PLAYERS_EXAMINED as usize);
        let m = cfg.for_mode(MatchmakingType::Match1v1);
        assert_eq!(m.weight_win_prob, 0.0); // clamped up from -10
        assert_eq!(m.uncertainty_k, 3.0); // clamped down from 999
        assert_eq!(m.min_quality, -600.0); // clamped up from -100000
        assert_eq!(m.win_prob_scale, 100.0); // clamped up from 5
    }

    #[test]
    fn max_players_examined_can_fill_every_match_size() {
        let cfg = parse(r#"{"maxPlayersExamined": 2}"#);
        assert_eq!(cfg.max_players_examined, MIN_PLAYERS_EXAMINED as usize);
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
