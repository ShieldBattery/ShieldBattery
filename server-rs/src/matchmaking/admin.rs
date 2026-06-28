//! Admin GraphQL for reading and updating the runtime matchmaker config (the `matchmaking_config`
//! row), guarded by the `manageMatchmaking` permission. A successful update writes the row, appends
//! to `matchmaking_config_history`, and hot-reloads the shared [`ArcSwap`] the search loop reads —
//! so the change takes effect within one tick, no restart. The search loop and this resolver run in
//! the same process, so the in-process swap is immediate; if server-rs is ever scaled out, a Redis
//! "config changed" notification would replace the direct swap (the DB stays the source of truth).

use std::sync::Arc;

use arc_swap::ArcSwap;
use async_graphql::{Context, InputObject, Object, Result, SimpleObject};
use sqlx::PgPool;

use crate::graphql::errors::graphql_error;
use crate::matchmaking::MatchmakingType;
use crate::matchmaking::config::{
    MatchmakerConfig, ModeConfig, ModeConfigOverrides, StoredConfig, load_stored_config,
    parse_mode_key,
};
use crate::users::CurrentUser;
use crate::users::permissions::RequiredPermission;

/// The built-in default knob values, returned alongside the stored overrides so the admin UI can
/// show each field's effective default as a placeholder / reset target.
#[derive(SimpleObject)]
struct MatchmakerConfigDefaults {
    search_interval_seconds: f64,
    max_players_examined: i32,
    weight_rating_variance: f32,
    weight_win_prob: f32,
    weight_latency: f32,
    uncertainty_k: f32,
    min_quality: f32,
    adaptive_comfortable_multiplier: i32,
    adaptive_decay_per_missing: f32,
    population_half_life_seconds: f64,
}

impl Default for MatchmakerConfigDefaults {
    fn default() -> Self {
        let mode = ModeConfig::default();
        let cfg = MatchmakerConfig::default();
        Self {
            search_interval_seconds: cfg.search_interval.as_secs_f64(),
            max_players_examined: cfg.max_players_examined as i32,
            weight_rating_variance: mode.weight_rating_variance,
            weight_win_prob: mode.weight_win_prob,
            weight_latency: mode.weight_latency,
            uncertainty_k: mode.uncertainty_k,
            min_quality: mode.min_quality,
            adaptive_comfortable_multiplier: mode.adaptive_comfortable_multiplier as i32,
            adaptive_decay_per_missing: mode.adaptive_decay_per_missing,
            population_half_life_seconds: mode.population_half_life.as_secs_f64(),
        }
    }
}

/// A per-mode override entry. (The stored form is a `mode -> overrides` map; GraphQL has no native
/// map type, so it's exposed as a list keyed by `matchmakingType`.)
#[derive(SimpleObject)]
struct MatchmakerPerModeOverride {
    matchmaking_type: MatchmakingType,
    config: ModeConfigOverrides,
}

#[derive(InputObject)]
struct MatchmakerPerModeOverrideInput {
    matchmaking_type: MatchmakingType,
    config: ModeConfigOverrides,
}

/// The current matchmaker config: the stored overrides plus the built-in defaults.
#[derive(SimpleObject)]
struct MatchmakerConfigView {
    search_interval_seconds: Option<f64>,
    max_players_examined: Option<i32>,
    global: ModeConfigOverrides,
    per_mode: Vec<MatchmakerPerModeOverride>,
    defaults: MatchmakerConfigDefaults,
}

#[derive(InputObject)]
struct MatchmakerConfigInput {
    search_interval_seconds: Option<f64>,
    max_players_examined: Option<i32>,
    global: ModeConfigOverrides,
    per_mode: Vec<MatchmakerPerModeOverrideInput>,
}

fn view_from_stored(stored: StoredConfig) -> MatchmakerConfigView {
    let per_mode = stored
        .per_mode
        .into_iter()
        // Drop overrides keyed by an unrecognized mode (renamed/removed, or written by a newer
        // server) rather than failing the whole read — matches `from_stored`'s behaviour.
        .filter_map(|(key, config)| {
            parse_mode_key(&key).map(|matchmaking_type| MatchmakerPerModeOverride {
                matchmaking_type,
                config,
            })
        })
        .collect();
    MatchmakerConfigView {
        search_interval_seconds: stored.search_interval_seconds,
        max_players_examined: stored.max_players_examined,
        global: stored.global,
        per_mode,
        defaults: MatchmakerConfigDefaults::default(),
    }
}

fn stored_from_input(input: MatchmakerConfigInput) -> StoredConfig {
    let per_mode = input
        .per_mode
        .into_iter()
        // Store by the mode's stable string name (see `StoredConfig::per_mode`).
        .map(|entry| (entry.matchmaking_type.as_str().to_owned(), entry.config))
        .collect();
    StoredConfig {
        search_interval_seconds: input.search_interval_seconds,
        max_players_examined: input.max_players_examined,
        global: input.global,
        per_mode,
    }
}

#[derive(Default)]
pub struct MatchmakingConfigQuery;

#[Object]
impl MatchmakingConfigQuery {
    /// The current matchmaker config: stored overrides plus the built-in defaults.
    #[graphql(guard = RequiredPermission::ManageMatchmaking)]
    async fn matchmaking_config(&self, ctx: &Context<'_>) -> Result<MatchmakerConfigView> {
        let db = ctx.data::<PgPool>()?;
        Ok(view_from_stored(load_stored_config(db).await))
    }
}

#[derive(Default)]
pub struct MatchmakingConfigMutation;

#[Object]
impl MatchmakingConfigMutation {
    /// Replaces the matchmaker config. Writes the row, appends to `matchmaking_config_history`, and
    /// hot-reloads the live config so the change takes effect within one search tick. Out-of-range
    /// values are clamped when the config is loaded, so this won't fail on a bad number.
    #[graphql(guard = RequiredPermission::ManageMatchmaking)]
    async fn update_matchmaking_config(
        &self,
        ctx: &Context<'_>,
        config: MatchmakerConfigInput,
    ) -> Result<MatchmakerConfigView> {
        let db = ctx.data::<PgPool>()?;
        let handle = ctx.data::<Arc<ArcSwap<MatchmakerConfig>>>()?;
        let changed_by = ctx.data::<Option<CurrentUser>>()?.as_ref().map(|u| u.id);

        let stored = stored_from_input(config);
        let json = serde_json::to_value(&stored)
            .map_err(|e| graphql_error("INTERNAL_SERVER_ERROR", format!("bad config: {e}")))?;
        // Resolve the live config from exactly what we're about to persist, so the in-memory swap can
        // never disagree with the row. (Re-reading via `load_matchmaker_config` would silently fall
        // back to defaults on a transient read error, leaving the live matchmaker on defaults while
        // this mutation reports success.) Building it up front is infallible; we only swap it in after
        // the write commits.
        let live = MatchmakerConfig::from_stored(&stored);

        // The row write and its audit row must land together: a committed config change always has a
        // matching history entry, and a failed audit insert rolls the config back rather than leaving
        // the persisted state ahead of the audit trail.
        let mut tx = db.begin().await?;
        let updated = sqlx::query!(
            "UPDATE matchmaking_config SET config = $1, updated_at = now(), updated_by = $2 \
             WHERE id = 1",
            json,
            changed_by.map(|id| id.0),
        )
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            // The singleton row is seeded by the migration, so its absence is an invariant violation,
            // not an expected outcome — fail loudly rather than silently writing nothing.
            return Err(graphql_error(
                "INTERNAL_SERVER_ERROR",
                "matchmaking_config row is missing",
            ));
        }

        sqlx::query!(
            "INSERT INTO matchmaking_config_history (config, changed_by) VALUES ($1, $2)",
            json,
            changed_by.map(|id| id.0),
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        // Only now that the row + audit are durably committed do we swap the live config the search
        // loop reads, so a rolled-back write never takes effect in-process. The change is picked up on
        // the next tick.
        handle.store(Arc::new(live));

        Ok(view_from_stored(stored))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_serializes_to_the_persisted_shape_and_round_trips() {
        let input = MatchmakerConfigInput {
            search_interval_seconds: Some(8.0),
            max_players_examined: Some(32),
            global: ModeConfigOverrides {
                min_quality: Some(-50.0),
                ..Default::default()
            },
            per_mode: vec![MatchmakerPerModeOverrideInput {
                matchmaking_type: MatchmakingType::Match3v3Bgh,
                config: ModeConfigOverrides {
                    adaptive_decay_per_missing: Some(25.0),
                    ..Default::default()
                },
            }],
        };

        let stored = stored_from_input(input);
        let json = serde_json::to_value(&stored).unwrap();

        // The written JSON must use camelCase keys and key per-mode overrides by the mode's serde
        // name — exactly the shape `load_stored_config` reads back.
        assert_eq!(json["searchIntervalSeconds"], 8.0);
        assert_eq!(json["maxPlayersExamined"], 32);
        assert_eq!(json["global"]["minQuality"], -50.0);
        assert_eq!(json["perMode"]["3v3bgh"]["adaptiveDecayPerMissing"], 25.0);

        // And the round-trip back through the stored form preserves the overrides.
        let reparsed: StoredConfig = serde_json::from_value(json).unwrap();
        let view = view_from_stored(reparsed);
        assert_eq!(view.global.min_quality, Some(-50.0));
        assert_eq!(view.max_players_examined, Some(32));
        assert_eq!(view.per_mode.len(), 1);
        assert_eq!(
            view.per_mode[0].matchmaking_type,
            MatchmakingType::Match3v3Bgh
        );
        assert_eq!(
            view.per_mode[0].config.adaptive_decay_per_missing,
            Some(25.0)
        );
    }

    #[test]
    fn view_drops_overrides_for_unknown_mode_keys() {
        // A per-mode override keyed by a renamed/removed mode (or one written by a newer server) is
        // dropped from the view rather than failing the read or surfacing an invalid mode — matching
        // the tolerance `from_stored` applies to the live config.
        let stored = StoredConfig {
            search_interval_seconds: None,
            max_players_examined: None,
            global: ModeConfigOverrides::default(),
            per_mode: std::collections::HashMap::from([
                (
                    "4v4chaos".to_owned(),
                    ModeConfigOverrides {
                        min_quality: Some(10.0),
                        ..Default::default()
                    },
                ),
                (
                    "3v3bgh".to_owned(),
                    ModeConfigOverrides {
                        weight_win_prob: Some(75.0),
                        ..Default::default()
                    },
                ),
            ]),
        };

        let view = view_from_stored(stored);
        assert_eq!(view.per_mode.len(), 1);
        assert_eq!(
            view.per_mode[0].matchmaking_type,
            MatchmakingType::Match3v3Bgh
        );
        assert_eq!(view.per_mode[0].config.weight_win_prob, Some(75.0));
    }
}
