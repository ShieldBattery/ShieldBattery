//! Who a map's description says made it and who it credits as the original, used to tell a new
//! version of a map (same maker) from someone else's fork of it.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

/// A credit line's role and the separator after it: "Created by X", "Author: X", "homage to X".
static ROLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?P<role>remake|remade|tribute made|re-imagined|created|made|designed|map|make|author|creator|creater|layout|edited|editor|original(?:ly)?(?: map)?(?: made| created)?|inspired|concept|draft|draught|presented|sponsored|modified(?: for \w+)?|thanks|homage|based on)\s*(?P<sep>by|:|to|on)\s*[-:]?\s*",
    )
    .expect("credit role pattern compiles")
});
/// Where a name ends: a run of spaces (columns of credits), a sentence end, or the next credit.
static NAME_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s{2,}|\. |\.$|!|\bpresented\b|\bunauthorized\b|\bspecial\b")
        .expect("name end pattern compiles")
});
static ALIAS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(([^)]*)\)").expect("alias pattern compiles"));
static NAME_SEPARATOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r",|\band\b|&").expect("name separator pattern compiles"));
static TRAILING_COLUMN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s{2,}.*$").expect("trailing column pattern compiles"));
static NON_WORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\W+").expect("non-word pattern compiles"));

/// Names that show up after "by" without naming a person, including organizations written as if
/// they were a maker's alias ("Terrance (KeSPA)").
const NOT_NAMES: [&str; 5] = ["the", "user", "popular", "shieldbattery", "kespa"];

/// Roles that name the maker of a remake of someone else's map. They take precedence over plain
/// maker roles, since a remake's description usually names the original maker too.
const FORK_ROLES: [&str; 4] = ["remake", "remade", "tribute made", "re-imagined"];
const MAKER_ROLES: [&str; 9] = [
    "created", "made", "designed", "map", "make", "author", "creator", "creater", "layout",
];
const EDIT_ROLES: [&str; 2] = ["edited", "editor"];
const CREDIT_PREFIXES: [&str; 7] = [
    "original", "inspired", "concept", "draft", "draught", "homage", "based on",
];

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub struct MapCredits {
    /// Who made the map, normalized with [`normalize_name`]. From the strongest role found: a
    /// remake's maker, else "Created/Made/Designed by", else "Edited by".
    pub makers: Vec<String>,
    /// Who the map credits as the original ("Original by X", "Inspired by X"), normalized.
    pub credited: Vec<String>,
}

/// A name in comparable form: the first column of it, lowercased, letters and digits only.
pub fn normalize_name(name: &str) -> String {
    let name = TRAILING_COLUMN.replace(name.trim(), "");
    NON_WORD.replace_all(&name.to_lowercase(), "").into_owned()
}

fn split_names(raw: &str, names: &mut BTreeSet<String>) {
    let raw = raw.trim();
    let raw = match NAME_END.find(raw) {
        Some(end) => &raw[..end.start()],
        None => raw,
    };
    // "효진(CrystalDrag)": the name in parentheses is the same person.
    for alias in ALIAS.captures_iter(raw) {
        split_names(&alias[1], names);
    }
    let raw = match raw.find('(') {
        Some(paren) => &raw[..paren],
        None => raw,
    };
    for part in NAME_SEPARATOR.split(raw) {
        let name = normalize_name(part);
        let len = name.chars().count();
        // A name without letters is a date or a player count ("Created: 2021.03.11", "(4)").
        if (2..=30).contains(&len)
            && name.chars().any(char::is_alphabetic)
            && !NOT_NAMES.contains(&name.as_str())
        {
            names.insert(name);
        }
    }
}

/// Parses the credit lines of a map's description.
pub fn parse_credits(description: &str) -> MapCredits {
    let mut forks = BTreeSet::new();
    let mut makers = BTreeSet::new();
    let mut edits = BTreeSet::new();
    let mut credited = BTreeSet::new();
    for line in description.split('\n') {
        let line = line.trim_end_matches('\r');
        let matches: Vec<_> = ROLE.captures_iter(line).collect();
        for (i, captures) in matches.iter().enumerate() {
            let whole = captures.get(0).expect("match has a whole group");
            let end = matches
                .get(i + 1)
                .map(|next| next.get(0).expect("match has a whole group").start())
                .unwrap_or(line.len());
            let role = captures["role"].to_lowercase();
            let sep = captures["sep"].to_lowercase();
            if ["thanks", "presented", "sponsored"].contains(&role.as_str())
                || role.starts_with("modified")
            {
                continue;
            }
            let is_reference = role == "homage" || role == "based on";
            if is_reference != (sep == "to" || sep == "on") {
                continue;
            }
            let target = if FORK_ROLES.contains(&role.as_str()) {
                &mut forks
            } else if MAKER_ROLES.contains(&role.as_str()) {
                &mut makers
            } else if EDIT_ROLES.contains(&role.as_str()) {
                &mut edits
            } else if CREDIT_PREFIXES.iter().any(|p| role.starts_with(p)) {
                &mut credited
            } else {
                continue;
            };
            split_names(&line[whole.end()..end], target);
        }
    }
    let makers = [forks, makers, edits]
        .into_iter()
        .find(|names| !names.is_empty())
        .unwrap_or_default();
    MapCredits {
        makers: makers.into_iter().collect(),
        credited: credited.into_iter().collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credits(description: &str) -> (Vec<String>, Vec<String>) {
        let parsed = parse_credits(description);
        (parsed.makers, parsed.credited)
    }

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn remake_maker_wins_over_the_original() {
        assert_eq!(
            credits("Original by Drunken Bird and i_terran\r\nRemake by Suricatta\r\nVersion 3.3"),
            (names(&["suricatta"]), names(&["drunkenbird", "i_terran"]))
        );
    }

    #[test]
    fn reads_aliases_and_columns() {
        assert_eq!(
            credits("Created by - 효진(CrystalDrag)\nVersion 1.31 Ob"),
            (names(&["crystaldrag", "효진"]), names(&[]))
        );
        assert_eq!(
            credits("Created by Rose.of.Dream.      Presented by Kespa"),
            (names(&["roseofdream"]), names(&[]))
        );
    }

    #[test]
    fn credits_homages_and_inspirations() {
        assert_eq!(
            credits(
                "This map was updated in homage to Earthattack, official StarCraft map designer.\nTribute made by Testbug."
            ),
            // Comma-separated names are split, so an appositive comes along; harmless, since
            // only overlaps with another file's makers count.
            (
                names(&["testbug"]),
                names(&["earthattack", "officialstarcraftmapdesigner"])
            )
        );
        assert_eq!(
            credits("Created by: Testbug (Shield Battery)\nOriginal map made by Terrance (KeSPA)"),
            (names(&["testbug"]), names(&["terrance"]))
        );
    }

    #[test]
    fn ignores_names_without_letters() {
        assert_eq!(
            credits("Created by theLeo_UA (14.6.2010)\nMade by Etarded (2)"),
            (names(&["etarded", "theleo_ua"]), names(&[]))
        );
    }

    #[test]
    fn ignores_sponsors_and_modifiers() {
        assert_eq!(
            credits("Created by KM-\n Special Thanks to Testbug\nPresented by AfreecaTV"),
            (names(&["km"]), names(&[]))
        );
        assert_eq!(
            credits("Created by LatiAs\nModified by Freakling\nPresented by BSL11"),
            (names(&["latias"]), names(&[]))
        );
        assert_eq!(
            credits("Edited by Scan유승곤"),
            (names(&["scan유승곤"]), names(&[]))
        );
    }
}
