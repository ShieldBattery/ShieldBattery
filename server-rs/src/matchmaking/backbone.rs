//! Static region-to-region backbone latency table used to estimate a candidate match's latency.
//!
//! Each queued player reports the region they want to home in and their measured round-trip time to
//! it. The matchmaker estimates a pair's one-way latency as `rtt_a/2 + backbone(a, b)/2 + rtt_b/2`,
//! where `backbone(a, b)` is the static region-to-region round-trip time from this table (0 within a
//! region). The table is operator-supplied via the `SB_REGION_BACKBONE_RTT_JSON` environment
//! variable; an unconfigured pair falls back to a conservative default.

use std::collections::HashMap;

/// Environment variable holding the backbone table as a JSON object of `"id_a|id_b": rtt_ms` pairs.
const BACKBONE_ENV_VAR: &str = "SB_REGION_BACKBONE_RTT_JSON";

/// Round-trip time (ms) assumed for a region pair with no entry in the table. Conservative so an
/// unconfigured cross-region pair reads as fairly distant rather than free — an operator who wants a
/// cheaper estimate must state it explicitly.
const DEFAULT_BACKBONE_RTT_MS: f32 = 150.0;

/// A static table of region-to-region backbone round-trip times (ms).
///
/// Keys are canonicalized as the two region ids sorted lexicographically and joined with a single
/// `'|'`, so lookups are independent of the order the two ids are passed (`rtt("a", "b")` ==
/// `rtt("b", "a")`). Region ids therefore must not themselves contain `'|'`. A pair paired with
/// itself is always 0; a pair absent from the table falls back to [`DEFAULT_BACKBONE_RTT_MS`].
#[derive(Debug, Clone, Default)]
pub struct BackboneRttTable {
    rtts: HashMap<String, f32>,
}

/// Canonicalizes an ordered id pair into the table's key form: the two ids sorted and joined by
/// `'|'`.
fn pair_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

/// Parses a raw config key (`"id_a|id_b"`) into a canonical key, or `None` if it isn't exactly two
/// `'|'`-separated ids.
fn canonicalize_config_key(raw: &str) -> Option<String> {
    let parts: Vec<&str> = raw.split('|').collect();
    match parts.as_slice() {
        [a, b] => Some(pair_key(a, b)),
        _ => None,
    }
}

impl BackboneRttTable {
    /// Builds a table from raw `"id_a|id_b" -> rtt_ms` config entries, canonicalizing each key so
    /// lookups are order-independent. Malformed keys (not exactly two `'|'`-separated ids) are
    /// dropped with a warning; when two entries canonicalize to the same pair, the last wins.
    pub fn new(entries: impl IntoIterator<Item = (String, f32)>) -> Self {
        let mut rtts = HashMap::new();
        for (key, rtt) in entries {
            match canonicalize_config_key(&key) {
                Some(canonical) => {
                    rtts.insert(canonical, rtt);
                }
                None => tracing::warn!("ignoring malformed backbone RTT key {key:?}"),
            }
        }
        Self { rtts }
    }

    /// Parses the table from the JSON object form used by `SB_REGION_BACKBONE_RTT_JSON`, e.g.
    /// `{"us-east|eu-west": 90}`.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let raw: HashMap<String, f32> = serde_json::from_str(json)?;
        Ok(Self::new(raw))
    }

    /// Loads the table from `SB_REGION_BACKBONE_RTT_JSON`, falling back to an empty table (every
    /// cross-region pair then uses [`DEFAULT_BACKBONE_RTT_MS`]) when the variable is unset or
    /// unparseable. An empty table is the correct dev-loopback state, so an unset variable is not an
    /// error.
    pub fn from_env() -> Self {
        match std::env::var(BACKBONE_ENV_VAR) {
            Ok(json) => match Self::from_json(&json) {
                Ok(table) => table,
                Err(e) => {
                    tracing::error!("failed to parse {BACKBONE_ENV_VAR}, using empty table: {e:?}");
                    Self::default()
                }
            },
            Err(_) => Self::default(),
        }
    }

    /// The backbone round-trip time (ms) between two regions: 0 for the same region, the configured
    /// value for a known pair, or [`DEFAULT_BACKBONE_RTT_MS`] for an unconfigured pair.
    pub fn rtt(&self, a: &str, b: &str) -> f32 {
        if a == b {
            return 0.0;
        }
        self.rtts
            .get(&pair_key(a, b))
            .copied()
            .unwrap_or(DEFAULT_BACKBONE_RTT_MS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_region_is_zero() {
        let table = BackboneRttTable::new([("us-east|eu-west".to_string(), 90.0)]);
        assert_eq!(table.rtt("us-east", "us-east"), 0.0);
        // Zero even for a region that appears in the table.
        assert_eq!(table.rtt("eu-west", "eu-west"), 0.0);
    }

    #[test]
    fn known_pair_lookup_is_order_independent() {
        let table = BackboneRttTable::new([("us-east|eu-west".to_string(), 90.0)]);
        assert_eq!(table.rtt("us-east", "eu-west"), 90.0);
        // The canonical key sorts the ids, so the reverse order finds the same entry.
        assert_eq!(table.rtt("eu-west", "us-east"), 90.0);
    }

    #[test]
    fn config_key_written_in_either_order_canonicalizes_the_same() {
        // "eu-west|us-east" is not sorted; it must canonicalize to the same key as the sorted form.
        let table = BackboneRttTable::new([("eu-west|us-east".to_string(), 90.0)]);
        assert_eq!(table.rtt("us-east", "eu-west"), 90.0);
        assert_eq!(table.rtt("eu-west", "us-east"), 90.0);
    }

    #[test]
    fn unknown_pair_uses_default() {
        let table = BackboneRttTable::new([("us-east|eu-west".to_string(), 90.0)]);
        assert_eq!(table.rtt("us-east", "ap-south"), DEFAULT_BACKBONE_RTT_MS);
    }

    #[test]
    fn empty_table_uses_default_for_all_cross_region_pairs() {
        let table = BackboneRttTable::default();
        assert_eq!(table.rtt("us-east", "eu-west"), DEFAULT_BACKBONE_RTT_MS);
        // Same region is still free.
        assert_eq!(table.rtt("us-east", "us-east"), 0.0);
    }

    #[test]
    fn from_json_parses_object_form() {
        let table =
            BackboneRttTable::from_json(r#"{"us-east|eu-west": 90, "us-east|ap-south": 200}"#)
                .unwrap();
        assert_eq!(table.rtt("eu-west", "us-east"), 90.0);
        assert_eq!(table.rtt("ap-south", "us-east"), 200.0);
        assert_eq!(table.rtt("eu-west", "ap-south"), DEFAULT_BACKBONE_RTT_MS);
    }

    #[test]
    fn malformed_keys_are_dropped_not_fatal() {
        // A key that isn't exactly two ids is ignored; the well-formed entry still applies.
        let table = BackboneRttTable::new([
            ("us-east".to_string(), 10.0),
            ("a|b|c".to_string(), 20.0),
            ("us-east|eu-west".to_string(), 90.0),
        ]);
        assert_eq!(table.rtt("us-east", "eu-west"), 90.0);
    }
}
