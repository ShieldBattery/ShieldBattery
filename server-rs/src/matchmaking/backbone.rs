//! Region-to-region backbone latency table used to estimate a candidate match's latency.
//!
//! Each queued player reports the region they want to home in and their measured round-trip time to
//! it. The matchmaker estimates a pair's one-way latency as `rtt_a/2 + backbone(a, b)/2 + rtt_b/2`,
//! where `backbone(a, b)` is the region-to-region round-trip time from this table (0 within a
//! region). The table is composed from two sources (see [`BackboneRttTable::compose`]): the rp2
//! coordinator's measured pairs as the base (fetched from `GET /regions`), with the operator-supplied
//! `SB_REGION_BACKBONE_RTT_JSON` overlaid per-pair on top (the override wins for any pair it names). A
//! pair present in neither falls back to a conservative default.
//!
//! This mirrors `server/lib/netcode-v2/latency-estimate.ts` on the Node side: the two deliberately
//! share the same key canonicalization, default RTT, and served-base + operator-override composition,
//! so a change to one must be mirrored in the other.

use serde::Deserialize;
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

    /// Loads the operator override layer from `SB_REGION_BACKBONE_RTT_JSON`, falling back to an empty
    /// table when the variable is unset or unparseable. This layer is overlaid on top of the
    /// coordinator-served pairs by [`BackboneRttTable::compose`]; an unset variable (the correct
    /// dev-loopback state) simply contributes no overrides, so it is not an error. In isolation
    /// (no served base) every cross-region pair it doesn't name resolves to [`DEFAULT_BACKBONE_RTT_MS`].
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

    /// Composes the lookup table the matchmaker reads from the coordinator-served pairs (`served`,
    /// the base) and an operator override (`override_table`, overlaid per-pair on top — the override
    /// wins for any pair it names). Served pair ids are re-canonicalized defensively, even though the
    /// coordinator emits them already sorted. A pair present in neither source falls back to
    /// [`DEFAULT_BACKBONE_RTT_MS`] at lookup time (see [`BackboneRttTable::rtt`]).
    ///
    /// With `served` empty this yields exactly the override layer, which is the table's state when no
    /// coordinator is configured (dev loopback).
    pub fn compose(served: &[ServedPairRtt], override_table: &BackboneRttTable) -> Self {
        let mut rtts: HashMap<String, f32> = served
            .iter()
            .map(|pair| (pair_key(&pair.a, &pair.b), pair.rtt_ms))
            .collect();
        // Operator overrides win per pair, so they are applied on top of the served base.
        for (key, &rtt) in &override_table.rtts {
            rtts.insert(key.clone(), rtt);
        }
        Self { rtts }
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

/// One region pair's backbone RTT as served by the rp2 coordinator on `GET /regions`. The coordinator
/// emits the pair already sorted (`a` < `b`) and includes a `measured_at` timestamp that the
/// matchmaker ignores (it only needs the RTT), so that field is intentionally not represented here.
#[derive(Debug, Clone, Deserialize)]
pub struct ServedPairRtt {
    pub a: String,
    pub b: String,
    /// Round-trip time (ms) between the two regions. The wire value is an integer; it is stored as
    /// `f32` to match the table's value type.
    pub rtt_ms: f32,
}

/// The subset of the coordinator's `GET /regions` response the matchmaker consumes. The region list
/// (also in that response) is the Node server's concern and is ignored here; only the served backbone
/// pairs are extracted.
#[derive(Debug, Deserialize)]
struct RegionsResponse {
    /// Absent on coordinators predating backbone-RTT serving (and omitted when the fleet has measured
    /// nothing yet), so it defaults to empty. Held as raw values so a single malformed entry is
    /// dropped individually rather than failing the whole parse.
    #[serde(default)]
    backbone_rtts: Vec<serde_json::Value>,
}

/// Parses the coordinator's `GET /regions` JSON body, extracting only the served backbone-RTT pairs.
/// A missing `backbone_rtts` field (an older coordinator, or an empty served table) yields an empty
/// list. Individual entries that don't match [`ServedPairRtt`] are dropped with a warning rather than
/// failing the whole response, so one malformed pair can't blank the table. Returns an error only
/// when the body isn't valid JSON of the expected top-level shape.
pub fn parse_served_backbone_rtts(json: &str) -> Result<Vec<ServedPairRtt>, serde_json::Error> {
    let response: RegionsResponse = serde_json::from_str(json)?;
    let mut pairs = Vec::with_capacity(response.backbone_rtts.len());
    for entry in response.backbone_rtts {
        match serde_json::from_value::<ServedPairRtt>(entry) {
            Ok(pair) => pairs.push(pair),
            Err(e) => tracing::warn!("ignoring malformed served backbone RTT entry: {e:?}"),
        }
    }
    Ok(pairs)
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

    fn served(a: &str, b: &str, rtt_ms: f32) -> ServedPairRtt {
        ServedPairRtt {
            a: a.to_string(),
            b: b.to_string(),
            rtt_ms,
        }
    }

    #[test]
    fn compose_served_only_uses_served_value() {
        let table = BackboneRttTable::compose(
            &[served("us-east", "eu-west", 90.0)],
            &BackboneRttTable::default(),
        );
        assert_eq!(table.rtt("us-east", "eu-west"), 90.0);
        // Served pairs are canonicalized, so lookups stay order-independent.
        assert_eq!(table.rtt("eu-west", "us-east"), 90.0);
    }

    #[test]
    fn compose_override_only_uses_override_value() {
        let override_table = BackboneRttTable::new([("us-east|eu-west".to_string(), 42.0)]);
        let table = BackboneRttTable::compose(&[], &override_table);
        assert_eq!(table.rtt("us-east", "eu-west"), 42.0);
    }

    #[test]
    fn compose_override_beats_served_per_pair() {
        let served_pairs = [
            served("us-east", "eu-west", 90.0),
            served("ap-south", "us-east", 200.0),
        ];
        // The override names only one of the two served pairs (in the reverse id order, to prove
        // canonicalization), so the other keeps its served value.
        let override_table = BackboneRttTable::new([("eu-west|us-east".to_string(), 55.0)]);
        let table = BackboneRttTable::compose(&served_pairs, &override_table);
        assert_eq!(table.rtt("us-east", "eu-west"), 55.0);
        assert_eq!(table.rtt("ap-south", "us-east"), 200.0);
    }

    #[test]
    fn compose_pair_in_neither_uses_default() {
        let override_table = BackboneRttTable::new([("us-east|ap-south".to_string(), 120.0)]);
        let table =
            BackboneRttTable::compose(&[served("us-east", "eu-west", 90.0)], &override_table);
        assert_eq!(
            table.rtt("us-east", "ap-northeast"),
            DEFAULT_BACKBONE_RTT_MS
        );
        // Same region is still free.
        assert_eq!(table.rtt("us-east", "us-east"), 0.0);
    }

    #[test]
    fn parse_extracts_served_pairs_when_present() {
        let json = r#"{
            "regions": [{"id": "us-east", "displayName": "US East"}],
            "backbone_rtts": [
                {"a": "eu-central", "b": "us-east", "rtt_ms": 87, "measured_at": 1752555555}
            ]
        }"#;
        let pairs = parse_served_backbone_rtts(json).unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].a, "eu-central");
        assert_eq!(pairs[0].b, "us-east");
        assert_eq!(pairs[0].rtt_ms, 87.0);
    }

    #[test]
    fn parse_absent_field_yields_empty() {
        // A coordinator that doesn't serve the field at all (and a response with no region list).
        let pairs = parse_served_backbone_rtts(r#"{"regions": [{"id": "us-east"}]}"#).unwrap();
        assert!(pairs.is_empty());
    }

    #[test]
    fn parse_drops_malformed_entries_keeping_valid_ones() {
        let json = r#"{
            "backbone_rtts": [
                {"a": "eu-central", "b": "us-east", "rtt_ms": 87},
                {"a": "eu-central"},
                {"b": "us-east", "rtt_ms": 50},
                {"a": "ap-south", "b": "us-east", "rtt_ms": 200}
            ]
        }"#;
        let pairs = parse_served_backbone_rtts(json).unwrap();
        // The two well-formed entries survive; the two missing a required field are dropped.
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].a, "eu-central");
        assert_eq!(pairs[1].a, "ap-south");
    }

    #[test]
    fn parse_rejects_non_json_body() {
        assert!(parse_served_backbone_rtts("not json at all").is_err());
    }
}
