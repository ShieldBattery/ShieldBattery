//! The rules that propose how two possibly related map files relate, and the name and version
//! parsing they share with candidate finding.

use std::cmp::Ordering;
use std::sync::LazyLock;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

/// The version of the rules and normalization below. Bump it whenever a proposal could change, so
/// every map is scanned again and open proposals are recomputed.
pub const FAMILY_RULES_VERSION: i16 = 1;

/// Base names found for a default title, which say nothing about which map a file is.
const DEFAULT_BASE_NAMES: [&str; 2] = ["", "untitledscenario"];
/// Shorter base names match too many unrelated maps to be candidates.
pub const MIN_CANDIDATE_BASE_NAME_CHARS: usize = 3;

static BRACKETED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\[\(\|].*?[\]\)\|]").expect("bracketed pattern compiles"));
static VERSION_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(v|ver|version)?\s*\.?\d+(\.\d+)*[a-z]?\b").expect("version words compile")
});
static EDITION_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(se|obs|ob|ums|fix(ed)?|final|new|remastered|remaster|bsl|plus|re|neo)\b")
        .expect("edition words compile")
});
static NOT_BASE_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^a-z0-9가-힯]+").expect("base chars compile"));

/// A map name reduced to what stays the same across versions: lowercase, without bracketed tags
/// (`| iCCup |`, `[BSL]`, `(4)`), version numbers, edition words (SE, Remastered, Neo, ...) or
/// anything but Latin letters, digits and Hangul.
pub fn base_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|&c| (c as u32) > 0x1f && c != '\u{7f}')
        .collect();
    let name = name.to_lowercase();
    let name = BRACKETED.replace_all(&name, " ");
    let name = VERSION_WORDS.replace_all(&name, " ");
    let name = EDITION_WORDS.replace_all(&name, " ");
    NOT_BASE_CHARS.replace_all(&name, "").into_owned()
}

/// Whether a base name is specific enough to look for other files with it.
pub fn is_candidate_base_name(base: &str) -> bool {
    !DEFAULT_BASE_NAMES.contains(&base) && base.chars().count() >= MIN_CANDIDATE_BASE_NAME_CHARS
}

static TITLE_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[\[\(][^\]\)]*[\]\)]|\|[^|]*\|").expect("title tag pattern compiles")
});
static TOKEN_SEPARATOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\w.]+").expect("token separator compiles"));
static VERSION_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:v|ver|version|se)?(\.\d+|\d+(?:\.\d+){0,2}[a-z]?)$")
        .expect("version token compiles")
});
static DESCRIPTION_VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:version|ver|v)\s*[:.]?\s*(\d+(?:\.\d+){0,2}[a-z]?)")
        .expect("description version compiles")
});

/// The version in a map name: the last word that is one ("v2.9", "SE2.0", "1.05a", ".99"),
/// ignoring bracketed tags.
pub fn name_version(name: &str) -> Option<String> {
    let name = TITLE_TAG.replace_all(name, " ");
    let found = TOKEN_SEPARATOR
        .split(&name)
        .filter_map(|token| VERSION_TOKEN.captures(token))
        .last()?;
    let version = found[1].to_lowercase();
    Some(if version.starts_with('.') {
        format!("0{version}")
    } else {
        version
    })
}

/// The first "Version 1.05"-style version in a description.
pub fn description_version(description: &str) -> Option<String> {
    DESCRIPTION_VERSION
        .captures(description)
        .map(|c| c[1].to_string())
}

/// A version in comparable form. Versions with one dot compare as decimals, the way map makers
/// number them (1.05 < 1.1 < 1.21); three-part versions compare part by part; a trailing letter
/// breaks ties (4.2 < 4.2b).
#[derive(Debug, Clone, PartialEq)]
pub struct VersionKey {
    major: f64,
    minor: u64,
    patch: u64,
    suffix: String,
}

static VERSION_PARTS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d*)(?:\.(\d+))?(?:\.(\d+))?([a-z]?)$").expect("version parts compile")
});

impl VersionKey {
    pub fn parse(version: &str) -> Option<Self> {
        let version = version.to_lowercase();
        let parts = VERSION_PARTS.captures(&version)?;
        let whole: u64 = parts
            .get(1)
            .map(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .map_or(Some(0), |s| s.parse().ok())?;
        let suffix = parts[4].to_string();
        Some(match (parts.get(2), parts.get(3)) {
            (Some(minor), Some(patch)) => Self {
                major: whole as f64,
                minor: minor.as_str().parse().ok()?,
                patch: patch.as_str().parse().ok()?,
                suffix,
            },
            (Some(fraction), None) => Self {
                major: format!("{whole}.{}", fraction.as_str()).parse().ok()?,
                minor: 0,
                patch: 0,
                suffix,
            },
            _ => Self {
                major: whole as f64,
                minor: 0,
                patch: 0,
                suffix,
            },
        })
    }
}

impl PartialOrd for VersionKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(
            self.major
                .total_cmp(&other.major)
                .then(self.minor.cmp(&other.minor))
                .then(self.patch.cmp(&other.patch))
                .then_with(|| self.suffix.cmp(&other.suffix)),
        )
    }
}

fn has_hangul(s: &str) -> bool {
    s.chars().any(|c| ('\u{ac00}'..='\u{d7af}').contains(&c))
}

/// A file's version: from its title, else its description, else the name ShieldBattery shows.
pub fn file_version(title: &str, description: &str, display_name: &str) -> Option<String> {
    name_version(title)
        .or_else(|| description_version(description))
        .or_else(|| name_version(display_name))
}

/// What the rules read about one map file.
#[derive(Debug, Clone)]
pub struct RuleMap {
    pub title: String,
    /// The name ShieldBattery shows: the staff-set public name, else the title.
    pub display_name: String,
    pub description: String,
    pub ums_content: bool,
    pub first_seen_at: DateTime<Utc>,
    pub chk_hash: Option<Vec<u8>>,
    pub makers: Vec<String>,
    pub credited: Vec<String>,
}

impl RuleMap {
    /// The candidate base names of this map: its title's and its display name's.
    pub fn base_names(&self) -> Vec<String> {
        let mut names = vec![base_name(&self.title), base_name(&self.display_name)];
        names.dedup();
        names
    }

    /// The file's version: from its title, else its description, else its display name.
    pub fn version(&self) -> Option<String> {
        file_version(&self.title, &self.description, &self.display_name)
    }

    fn is_korean(&self) -> bool {
        has_hangul(&self.title)
    }
}

/// How the detection rules propose two files relate.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize, async_graphql::Enum)]
#[serde(rename_all = "snake_case")]
#[graphql(name = "MapProposedRelation")]
pub enum ProposedRelation {
    /// The newer file is a newer version of the older one.
    Version,
    /// The files are the same version with small changes.
    Variant,
    /// One file is the other in another language.
    Translation,
    /// One file is someone else's map based on the other.
    Fork,
    /// A UMS map built on the other map's terrain: related, but never in its family.
    TerrainOnly,
    /// The files aren't related.
    Unrelated,
}

impl ProposedRelation {
    /// Whether accepting this relation puts both files in one family.
    pub fn links(self) -> bool {
        matches!(
            self,
            Self::Version | Self::Variant | Self::Translation | Self::Fork
        )
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Older {
    A,
    B,
}

/// The rules' proposal for a pair of files, stored as the suggestion's verdict.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct Proposal {
    pub relation: ProposedRelation,
    /// Which file the older one is, for versions.
    pub older: Option<Older>,
    /// Which rule decided, for staff and for measuring rules against staff decisions.
    pub rule: &'static str,
}

/// Two name sets overlap when a name is in both, or one name of 4+ characters contains the other
/// ("rose.of.dream" vs "roseofdreamkespa").
fn names_overlap(a: &[String], b: &[String]) -> bool {
    a.iter().any(|x| {
        b.iter().any(|y| {
            x == y
                || (x.chars().count() >= 4 && y.contains(x.as_str()))
                || (y.chars().count() >= 4 && x.contains(y.as_str()))
        })
    })
}

/// Whether `x` is a fork of `y`: it credits `y`'s maker as the original and isn't made by them,
/// or it's a credited derivative with its own maker while `y` names nobody.
fn is_fork_of(x: &RuleMap, y: &RuleMap) -> bool {
    if !y.makers.is_empty()
        && !names_overlap(&x.makers, &y.makers)
        && names_overlap(&x.credited, &y.makers)
    {
        return true;
    }
    !x.makers.is_empty()
        && !x.credited.is_empty()
        && !names_overlap(&x.credited, &x.makers)
        && y.makers.is_empty()
        && y.credited.is_empty()
}

/// Proposes how two candidate files relate.
pub fn propose(a: &RuleMap, b: &RuleMap) -> Proposal {
    let proposal = |relation, older, rule| Proposal {
        relation,
        older,
        rule,
    };
    if a.chk_hash.is_some() && a.chk_hash == b.chk_hash {
        return proposal(ProposedRelation::Variant, None, "same_scenario");
    }
    if a.ums_content != b.ums_content {
        return proposal(ProposedRelation::TerrainOnly, None, "melee_and_ums");
    }
    let base_a: Vec<_> = a
        .base_names()
        .into_iter()
        .filter(|n| !DEFAULT_BASE_NAMES.contains(&n.as_str()))
        .collect();
    let same_name = b
        .base_names()
        .iter()
        .any(|n| !DEFAULT_BASE_NAMES.contains(&n.as_str()) && base_a.contains(n));
    if a.ums_content && !same_name {
        return proposal(ProposedRelation::Unrelated, None, "ums_names_differ");
    }

    let same_line = |rule| {
        let key_a = a.version().as_deref().and_then(VersionKey::parse);
        let key_b = b.version().as_deref().and_then(VersionKey::parse);
        match (key_a, key_b) {
            (Some(key_a), Some(key_b)) if key_a != key_b => {
                let older = if key_a < key_b { Older::A } else { Older::B };
                proposal(ProposedRelation::Version, Some(older), rule)
            }
            (key_a, key_b) if key_a == key_b => {
                let relation = if a.is_korean() != b.is_korean() {
                    ProposedRelation::Translation
                } else {
                    ProposedRelation::Variant
                };
                proposal(relation, None, rule)
            }
            // Only one side has a version: the older file came first.
            _ => {
                let older = if a.first_seen_at <= b.first_seen_at {
                    Older::A
                } else {
                    Older::B
                };
                proposal(ProposedRelation::Version, Some(older), rule)
            }
        }
    };

    if !a.makers.is_empty() && !b.makers.is_empty() && names_overlap(&a.makers, &b.makers) {
        return same_line("same_maker");
    }
    if is_fork_of(a, b) || is_fork_of(b, a) {
        return proposal(ProposedRelation::Fork, None, "credits_original");
    }
    if !a.makers.is_empty() && !b.makers.is_empty() {
        return proposal(ProposedRelation::Fork, None, "makers_differ");
    }
    if same_name {
        return same_line("same_name");
    }
    proposal(ProposedRelation::Fork, None, "similar_terrain")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maps::credits::parse_credits;

    fn map(title: &str, description: &str) -> RuleMap {
        let credits = parse_credits(description);
        RuleMap {
            title: title.into(),
            display_name: title.into(),
            description: description.into(),
            ums_content: false,
            first_seen_at: DateTime::UNIX_EPOCH,
            chk_hash: None,
            makers: credits.makers,
            credited: credits.credited,
        }
    }

    #[test]
    fn base_names_drop_tags_versions_and_editions() {
        assert_eq!(base_name("| iCCup | Fighting Spirit 1.3"), "fightingspirit");
        assert_eq!(
            base_name("(4)Paranoid Android XXL v2.9"),
            "paranoidandroidxxl"
        );
        assert_eq!(base_name("Neo Dark Origin 2.1"), "darkorigin");
        assert_eq!(base_name("Colosseum SE 2.6"), "colosseum");
        assert_eq!(base_name("투혼 1.4"), "투혼");
        assert!(!is_candidate_base_name(&base_name("Untitled Scenario")));
    }

    #[test]
    fn finds_versions_in_names_and_descriptions() {
        assert_eq!(
            name_version("(4)Paranoid Android XXL v2.9").as_deref(),
            Some("2.9")
        );
        assert_eq!(name_version("Revolver SE2.0").as_deref(), Some("2.0"));
        assert_eq!(name_version("Last Temples .99").as_deref(), Some("0.99"));
        assert_eq!(
            name_version("Neo Dark Origin 2.1  ZvZ UMS").as_deref(),
            Some("2.1")
        );
        assert_eq!(name_version("Polypoid [BSL]"), None);
        assert_eq!(name_version("Hunters 1v7"), None);
        assert_eq!(
            description_version("Would be even better with fjords!\nVersion 1.05").as_deref(),
            Some("1.05")
        );
    }

    #[test]
    fn orders_versions_like_map_makers_number_them() {
        let key = |v| VersionKey::parse(v).unwrap();
        assert!(key("1.05") < key("1.1"));
        assert!(key("1.1") < key("1.21"));
        assert!(key("4.2") < key("4.2b"));
        assert!(key("7.8.1") < key("7.9.1"));
        assert!(key("0.99") < key("1.0"));
        assert_eq!(key("1"), key("1.0"));
    }

    #[test]
    fn same_maker_is_a_version_line() {
        let old = map("Polypoid 1.65", "Created by KM-\nReleased 2021.3.11.");
        let new = map("Polypoid 1.75", "Created by KM-\nSpecial Thanks to Testbug");
        assert_eq!(
            propose(&old, &new),
            Proposal {
                relation: ProposedRelation::Version,
                older: Some(Older::A),
                rule: "same_maker"
            }
        );
    }

    #[test]
    fn a_remake_crediting_the_original_is_a_fork() {
        let original = map(
            "| iCCup | Luna 2.1",
            "Author: i_terran (draft by DrunkenBird)",
        );
        let remake = map(
            "Neo Luna 3.3",
            "Original by Drunken Bird and i_terran\nRemake by Suricatta\nVersion 3.3",
        );
        assert_eq!(propose(&original, &remake).relation, ProposedRelation::Fork);
    }

    #[test]
    fn translations_need_a_shared_maker_or_name() {
        let korean = map("신 단장의 능선 2.1", "");
        let english = map("Heartbreak Ridge 2.1", "");
        assert_eq!(
            propose(&korean, &english),
            Proposal {
                relation: ProposedRelation::Fork,
                older: None,
                rule: "similar_terrain"
            }
        );
        let korean = map(
            "투혼 1.3",
            "Created by Rose.of.Dream.      Presented by Kespa",
        );
        let english = map(
            "| iCCup | Fighting Spirit 1.3",
            "Created by Rose.of.Dream.     Presented by Kespa",
        );
        assert_eq!(
            propose(&korean, &english).relation,
            ProposedRelation::Translation
        );
    }

    #[test]
    fn ums_built_on_melee_terrain_is_terrain_only() {
        let melee = map("Polypoid 1.75", "Created by KM-");
        let mut practice = map("Polypoid ZvP FFE Practice", "Jy Dojo. 1.0.");
        practice.ums_content = true;
        assert_eq!(
            propose(&melee, &practice).relation,
            ProposedRelation::TerrainOnly
        );
    }

    #[test]
    fn identical_scenarios_are_variants() {
        let mut a = map("Big Game Hunters", "");
        let mut b = map("Big Game Hunters", "");
        a.chk_hash = Some(vec![1; 32]);
        b.chk_hash = Some(vec![1; 32]);
        assert_eq!(propose(&a, &b).rule, "same_scenario");
    }
}
