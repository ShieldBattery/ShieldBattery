//! Filenames for the replay SC:R auto-saves after each game, rendered from the user's template:
//! literal text interleaved with `{token}` placeholders, e.g. `[SB]{time}-{map}`.
//!
//! The parsing and rendering mirror `common/replay-name-template.ts`, which previews templates on
//! the app's settings page, so the two must agree on the token names, the sanitization and the
//! length cap. Everything here is pure; the BW glue in `bw_scr` builds the [`NameContext`].

use std::sync::OnceLock;

use crate::bw::players::AssignedRace;

/// The name games have always been saved under, and the one a blank template falls back to.
pub const DEFAULT_TEMPLATE: &str = "[SB]{time}-{map}";

/// Longest a rendered name gets (in characters, before `.rep` and any ` (2)` suffix), so the full
/// path stays well inside Windows' 260-character path limit.
const MAX_NAME_LENGTH: usize = 100;

static TEMPLATE: OnceLock<String> = OnceLock::new();

/// Sets the template this game's replay is named with. `None` keeps the default.
pub fn set_template(template: Option<String>) {
    if let Some(template) = template
        && TEMPLATE.set(template).is_err()
    {
        warn!("Replay name template set twice");
    }
}

pub fn template() -> &'static str {
    TEMPLATE
        .get()
        .map(|x| x.as_str())
        .unwrap_or(DEFAULT_TEMPLATE)
}

/// A game participant (human or computer; observers aren't participants).
#[derive(Clone, Debug)]
pub struct NamePlayer {
    pub name: String,
    pub race: Option<AssignedRace>,
    /// BW's `players[].team`: 0 when the game type has no teams, so the player stands alone.
    pub team: u8,
    pub is_local: bool,
}

#[derive(Clone, Debug)]
pub struct NameContext {
    /// `YYYY-MM-DD`, local time.
    pub date: String,
    /// `HHMMSS`, local time.
    pub time: String,
    pub map: String,
    pub is_ums: bool,
    /// The local user's name, also set when they're observing.
    pub local_name: Option<String>,
    /// Participants in slot order.
    pub players: Vec<NamePlayer>,
}

enum Part<'a> {
    Text(&'a str),
    Token(&'a str),
}

const TOKENS: &[&str] = &[
    "date",
    "time",
    "map",
    "name",
    "opponents",
    "race",
    "opponentRaces",
    "format",
    "matchup",
];

/// Splits a template into text and known tokens. A brace that doesn't open a known `{token}` is
/// kept as text (and dropped later by sanitization).
fn parse(template: &str) -> Vec<Part<'_>> {
    let mut parts = Vec::new();
    let mut text_start = 0;
    let mut pos = 0;
    while let Some(offset) = template[pos..].find('{') {
        let open = pos + offset;
        let rest = &template[open + 1..];
        let name_len = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        let name = &rest[..name_len];
        if name_len > 0 && rest[name_len..].starts_with('}') && TOKENS.contains(&name) {
            if open > text_start {
                parts.push(Part::Text(&template[text_start..open]));
            }
            parts.push(Part::Token(name));
            pos = open + name_len + 2;
            text_start = pos;
        } else {
            pos = open + 1;
        }
    }
    if text_start < template.len() {
        parts.push(Part::Text(&template[text_start..]));
    }
    parts
}

/// Whether a character survives into a filename: Windows rejects control characters (which
/// include StarCraft's color codes) and `<>:"/\|?*`, and braces delimit tokens.
fn is_allowed_char(c: char) -> bool {
    !(c < ' '
        || matches!(
            c,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '{' | '}'
        ))
}

fn race_letter(race: AssignedRace) -> char {
    match race {
        AssignedRace::Protoss => 'P',
        AssignedRace::Terran => 'T',
        AssignedRace::Zerg => 'Z',
    }
}

/// The participants grouped by team: the local user's team first, then the rest in slot order.
/// Players on team 0 each stand alone.
fn teams(players: &[NamePlayer]) -> Vec<Vec<&NamePlayer>> {
    let mut teams: Vec<Vec<&NamePlayer>> = Vec::new();
    for player in players {
        let existing = match player.team {
            0 => None,
            team => teams.iter_mut().find(|t| t[0].team == team),
        };
        match existing {
            Some(members) => members.push(player),
            None => teams.push(vec![player]),
        }
    }
    if let Some(local) = teams.iter().position(|t| t.iter().any(|p| p.is_local)) {
        let local_team = teams.remove(local);
        teams.insert(0, local_team);
    }
    teams
}

/// A team's race letters in alphabetical order (`PZ`, not `ZP`), so a matchup reads the same
/// whatever the slot order.
fn races(players: &[&NamePlayer]) -> String {
    let mut letters = players
        .iter()
        .filter_map(|p| p.race.map(race_letter))
        .collect::<Vec<_>>();
    letters.sort_unstable();
    letters.into_iter().collect()
}

fn token_value(token: &str, context: &NameContext) -> String {
    let teams = teams(&context.players);
    let has_local = teams.first().is_some_and(|t| t.iter().any(|p| p.is_local));
    // An observer has no team, so everyone playing counts as an opponent.
    let opponent_teams = &teams[has_local as usize..];
    match token {
        "date" => context.date.clone(),
        "time" => context.time.clone(),
        "map" => context.map.clone(),
        "name" => context.local_name.clone().unwrap_or_default(),
        "opponents" => opponent_teams
            .iter()
            .flatten()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>()
            .join("+"),
        "race" => context
            .players
            .iter()
            .find(|p| p.is_local)
            .and_then(|p| p.race)
            .map(|r| race_letter(r).to_string())
            .unwrap_or_default(),
        "opponentRaces" => opponent_teams.iter().map(|t| races(t)).collect(),
        "format" => {
            if context.is_ums {
                "UMS".into()
            } else if teams.len() > 2 && teams.iter().all(|t| t.len() == 1) {
                "FFA".into()
            } else {
                teams
                    .iter()
                    .map(|t| t.len().to_string())
                    .collect::<Vec<_>>()
                    .join("v")
            }
        }
        "matchup" => teams.iter().map(|t| races(t)).collect::<Vec<_>>().join("v"),
        _ => String::new(),
    }
}

fn render_template(template: &str, context: &NameContext) -> String {
    let mut name = String::new();
    for part in parse(template) {
        let value;
        let text = match part {
            Part::Text(text) => text,
            Part::Token(token) => {
                value = token_value(token, context);
                &value
            }
        };
        name.extend(text.chars().filter(|&c| is_allowed_char(c)));
    }
    let name = name.chars().take(MAX_NAME_LENGTH).collect::<String>();
    name.trim_end_matches(['.', ' ']).trim().to_string()
}

/// Renders `template` into a filename without its extension, falling back to the default template
/// when it renders to nothing.
pub fn render(template: &str, context: &NameContext) -> String {
    let name = render_template(template, context);
    if name.is_empty() {
        render_template(DEFAULT_TEMPLATE, context)
    } else {
        name
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn player(name: &str, race: AssignedRace, team: u8, is_local: bool) -> NamePlayer {
        NamePlayer {
            name: name.into(),
            race: Some(race),
            team,
            is_local,
        }
    }

    fn context(players: Vec<NamePlayer>) -> NameContext {
        NameContext {
            date: "2026-09-29".into(),
            time: "204105".into(),
            map: "Fighting Spirit".into(),
            is_ums: false,
            local_name: players.iter().find(|p| p.is_local).map(|p| p.name.clone()),
            players,
        }
    }

    fn one_v_one() -> NameContext {
        context(vec![
            player("Opp", AssignedRace::Terran, 0, false),
            player("Me", AssignedRace::Zerg, 0, true),
        ])
    }

    fn two_v_two() -> NameContext {
        context(vec![
            player("A", AssignedRace::Terran, 1, false),
            player("Me", AssignedRace::Zerg, 2, true),
            player("B", AssignedRace::Protoss, 1, false),
            player("Ally", AssignedRace::Protoss, 2, false),
        ])
    }

    #[test]
    fn default_template() {
        assert_eq!(
            render(DEFAULT_TEMPLATE, &one_v_one()),
            "[SB]204105-Fighting Spirit"
        );
    }

    #[test]
    fn one_v_one_tokens() {
        assert_eq!(
            render(
                "{date} {name} ({race}) vs {opponents} ({opponentRaces}) {format} {matchup}",
                &one_v_one()
            ),
            "2026-09-29 Me (Z) vs Opp (T) 1v1 ZvT",
        );
    }

    #[test]
    fn team_tokens_put_the_local_team_first() {
        assert_eq!(
            render(
                "{format} {matchup} {opponents} {opponentRaces}",
                &two_v_two()
            ),
            "2v2 PZvPT A+B PT",
        );
    }

    #[test]
    fn ffa() {
        let ctx = context(vec![
            player("Me", AssignedRace::Zerg, 0, true),
            player("A", AssignedRace::Terran, 0, false),
            player("B", AssignedRace::Protoss, 0, false),
        ]);
        assert_eq!(render("{format} {matchup}", &ctx), "FFA ZvTvP");
    }

    #[test]
    fn ums() {
        let mut ctx = two_v_two();
        ctx.is_ums = true;
        assert_eq!(render("{format}", &ctx), "UMS");
    }

    #[test]
    fn observer_sees_everyone_as_opponents() {
        let mut ctx = context(vec![
            player("A", AssignedRace::Terran, 0, false),
            player("B", AssignedRace::Zerg, 0, false),
        ]);
        ctx.local_name = Some("Obs".into());
        assert_eq!(
            render("{name} {race}{opponents} {matchup}", &ctx),
            "Obs A+B TvZ"
        );
    }

    #[test]
    fn unknown_placeholders_are_text_and_braces_are_dropped() {
        assert_eq!(
            render("a{nope}{{map}}", &one_v_one()),
            "anopeFighting Spirit"
        );
    }

    #[test]
    fn strips_illegal_characters_from_text_and_values() {
        let mut ctx = one_v_one();
        ctx.map = "\x03Map<1>?".into();
        assert_eq!(render("a:b/c\\d|{map}", &ctx), "abcdMap1");
    }

    #[test]
    fn drops_trailing_dots_and_spaces() {
        assert_eq!(render("{name}. . ", &one_v_one()), "Me");
    }

    #[test]
    fn empty_result_falls_back_to_default() {
        assert_eq!(render("", &one_v_one()), "[SB]204105-Fighting Spirit");
        assert_eq!(render("::", &one_v_one()), "[SB]204105-Fighting Spirit");
    }

    #[test]
    fn caps_the_length() {
        let mut ctx = one_v_one();
        ctx.map = "é".repeat(300);
        assert_eq!(render("{map}", &ctx).chars().count(), MAX_NAME_LENGTH);
    }
}
