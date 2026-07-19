//! Pure player -> color assignment engine for custom team colors.
//!
//! SC:R melee renders every player from a single RGBA array (`rgb_colors`) that nothing writes
//! after game init, so custom team colors reduce to "decide what that array should hold". This
//! module owns that decision: given the game's color configuration, its starting alliance layout,
//! and live alliance changes, it produces a per-slot color assignment.
//!
//! It performs no BW access and contains no `unsafe`, so it is unit-tested directly on the host.
//! The surrounding DLL glue snapshots BW's originals, feeds this engine the game setup, and writes
//! [`TeamColorState::colors`] into `rgb_colors`.

use serde::Deserialize;

/// An RGBA color in the layout BW's `rgb_colors` array expects: `[r, g, b, a]`, each in `0.0..=1.0`.
pub type Color = [f32; 4];

/// Parses a `#RRGGBB` color string into a [`Color`] with full alpha, matching the `rgb_colors`
/// layout (`[r/255, g/255, b/255, 1.0]`). Returns `None` unless the string is exactly `#` followed
/// by six hex digits.
pub fn parse_hex_color(s: &str) -> Option<Color> {
    let hex = s.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some([
        f32::from(r) / 255.0,
        f32::from(g) / 255.0,
        f32::from(b) / 255.0,
        1.0,
    ])
}

/// Controls whether team-vs-FFA semantics apply, chosen once per game.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TeamColorUsage {
    /// Team semantics in any game that starts with alliances, and in any 2-player game.
    Always,
    /// Team semantics as `Always`, except a 2-player game draws from the FFA pool instead.
    ExceptIn1v1,
    /// Never apply team semantics: identity colors from the FFA pool, alliance changes never
    /// recolor anyone.
    Never,
}

/// Fully-resolved color configuration for one game. Every pool holds concrete colors (the DLL
/// hex-parses the app's `#RRGGBB` strings before building this); the engine never sees preset
/// names. Pools are priority-ordered and non-empty (`allies`/`enemies`/`ffa` all `len >= 1`); the
/// glue disables the feature rather than constructing a config with an empty pool.
#[derive(Clone, Debug)]
pub struct TeamColorConfig {
    pub usage: TeamColorUsage,
    pub shuffle: bool,
    /// The local player's color in team contexts.
    pub self_color: Color,
    /// Colors for players allied to the local player; wraps when there are more allies than colors.
    pub allies: Vec<Color>,
    /// Colors for players not allied to the local player; wraps like `allies`.
    pub enemies: Vec<Color>,
    /// Identity colors in FFA contexts (and the observer fallback); wraps if too short.
    pub ffa: Vec<Color>,
    /// The local player's fixed color in FFA contexts, if set. When present and it appears in the
    /// FFA pool, that pool entry is consumed so no other player draws it.
    pub ffa_self: Option<Color>,
}

/// The game setup this engine assigns colors for, captured once at game init.
#[derive(Clone, Debug)]
pub struct GameStartInfo {
    /// BW player ids (`0..8`) of the active (non-observer) human/computer players, ascending.
    pub active_players: Vec<u8>,
    /// The local player's BW id, or `None` for an observer or a replay watched without a seat.
    pub local_player: Option<u8>,
    /// The outgoing alliance matrix at game start: `initial_allies[a][b]` is whether `a` is allied
    /// to `b`. The relation is not assumed symmetric.
    pub initial_allies: [[bool; 8]; 8],
}

/// The live color assignment for a single game.
///
/// Built once by [`TeamColorState::new`], then advanced by [`TeamColorState::update_local_alliances`]
/// as the local player's alliances change. [`TeamColorState::colors`] reports the current per-slot
/// colors to write into `rgb_colors`.
pub struct TeamColorState {
    /// Current color per BW player slot; `None` means "leave BW's original color untouched".
    colors: [Option<Color>; 8],
    kind: StateKind,
}

enum StateKind {
    /// Observer/replay: a static assignment derived from the starting alliances, never updated.
    Static,
    /// The local player has a seat: colors track live alliance changes. Boxed to keep the two enum
    /// variants close in size.
    Seated(Box<SeatedState>),
}

struct SeatedState {
    local: u8,
    /// Whether alliance changes recolor anyone. False only in a FFA context with usage `Never`
    /// (pure identity colors that never react to alliances).
    overlay_enabled: bool,
    allies: Pool,
    /// The un-allied color source in a team context. `None` in a FFA context, where un-allied
    /// players fall back to their remembered identity color instead.
    enemies: Option<Pool>,
    /// Each active player's remembered FFA identity color, used as the un-allied color in a FFA
    /// context. All `None` in a team context.
    identity: [Option<Color>; 8],
    /// The alliance state currently reflected in `colors`, so an update only moves players whose
    /// bit actually changed.
    allied: [bool; 8],
}

/// An ordered color pool with an append cursor and per-player memory.
///
/// The first time a player enters the pool it takes the color at the cursor (which then advances,
/// wrapping when the pool is exhausted). A player that re-enters a pool it was in before gets the
/// same color back — assignments are remembered and never revoked, so flip-flopping an alliance
/// never burns a fresh color.
struct Pool {
    colors: Vec<Color>,
    cursor: usize,
    /// Per BW player slot: the resolved color index (already reduced mod `colors.len()`) this
    /// player was assigned, or `None` if it has never entered this pool.
    assigned: [Option<usize>; 8],
}

impl Pool {
    fn new(colors: Vec<Color>) -> Pool {
        Pool {
            colors,
            cursor: 0,
            assigned: [None; 8],
        }
    }

    /// The color for `player` entering this pool. Re-entry returns the remembered color; a
    /// first-time entry appends at the cursor (wrapping when the pool is exhausted).
    fn enter(&mut self, player: u8) -> Color {
        if let Some(idx) = self.assigned[player as usize] {
            return self.colors[idx];
        }
        let idx = self.cursor % self.colors.len();
        self.assigned[player as usize] = Some(idx);
        self.cursor += 1;
        self.colors[idx]
    }
}

impl TeamColorState {
    /// Applies shuffle (with `shuffle_seed`), decides team-vs-FFA context, and computes the initial
    /// assignment. Colors for non-active slots are left `None`.
    pub fn new(config: TeamColorConfig, info: &GameStartInfo, shuffle_seed: u64) -> TeamColorState {
        let mut config = config;
        if config.shuffle {
            let mut rng = SplitMix64::new(shuffle_seed);
            fisher_yates(&mut config.allies, &mut rng);
            fisher_yates(&mut config.enemies, &mut rng);
            fisher_yates(&mut config.ffa, &mut rng);
        }
        match info.local_player {
            None => TeamColorState::new_observer(&config, info),
            Some(local) => {
                if is_team_context(&config, info) {
                    TeamColorState::new_team(&config, info, local)
                } else {
                    TeamColorState::new_ffa(&config, info, local)
                }
            }
        }
    }

    /// Current color for each BW player slot; `None` = leave BW's original color untouched.
    pub fn colors(&self) -> [Option<Color>; 8] {
        self.colors
    }

    /// Applies the local player's current outgoing alliance row. Only players whose allied bit
    /// changed since the last applied state move; everyone else keeps their color. Returns whether
    /// any color changed. A no-op for observers and for a FFA context with usage `Never`.
    pub fn update_local_alliances(&mut self, allied: &[bool; 8]) -> bool {
        let Self { colors, kind } = self;
        let StateKind::Seated(state) = kind else {
            return false;
        };
        if !state.overlay_enabled {
            return false;
        }
        let local = state.local;
        let mut changed = false;
        for p in 0..8u8 {
            if p == local {
                continue;
            }
            // Only players that hold a color are active participants; others stay untouched.
            if colors[p as usize].is_none() {
                continue;
            }
            let now = allied[p as usize];
            if now == state.allied[p as usize] {
                continue;
            }
            state.allied[p as usize] = now;
            let new_color = if now {
                state.allies.enter(p)
            } else if let Some(enemies) = state.enemies.as_mut() {
                enemies.enter(p)
            } else {
                match state.identity[p as usize] {
                    Some(c) => c,
                    None => continue,
                }
            };
            colors[p as usize] = Some(new_color);
            changed = true;
        }
        changed
    }

    /// Team context: the local player takes `self_color`; every other active player draws from the
    /// allies or enemies pool by its starting alliance, in ascending slot order.
    fn new_team(config: &TeamColorConfig, info: &GameStartInfo, local: u8) -> TeamColorState {
        let mut allies = Pool::new(config.allies.clone());
        let mut enemies = Pool::new(config.enemies.clone());
        let mut colors = [None; 8];
        let mut allied = [false; 8];
        for &p in &info.active_players {
            if p == local {
                colors[local as usize] = Some(config.self_color);
                continue;
            }
            let is_ally = info.initial_allies[local as usize][p as usize];
            allied[p as usize] = is_ally;
            let color = if is_ally {
                allies.enter(p)
            } else {
                enemies.enter(p)
            };
            colors[p as usize] = Some(color);
        }
        TeamColorState {
            colors,
            kind: StateKind::Seated(Box::new(SeatedState {
                local,
                // A team context is only chosen when usage != Never, so it always tracks changes.
                overlay_enabled: true,
                allies,
                enemies: Some(enemies),
                identity: [None; 8],
                allied,
            })),
        }
    }

    /// FFA context: every active player gets an identity color from the FFA pool; the local player
    /// keeps `ffa_self` if set (consuming it from the pool). Starting alliances overlay onto the
    /// allies pool when usage allows.
    fn new_ffa(config: &TeamColorConfig, info: &GameStartInfo, local: u8) -> TeamColorState {
        let overlay_enabled = config.usage != TeamColorUsage::Never;
        let mut identity = [None; 8];
        let local_color;
        if let Some(ffa_self) = config.ffa_self {
            // The local player takes ffa_self; the first pool entry equal to it is consumed so no
            // other player draws that color, and the rest draw from the remaining pool in order.
            let mut pool = config.ffa.clone();
            if let Some(pos) = pool.iter().position(|c| colors_eq(c, &ffa_self)) {
                pool.remove(pos);
            }
            // A 1-entry pool equal to ffa_self would leave nothing for others; fall back to the
            // full pool rather than dividing by zero.
            let draw_pool = if pool.is_empty() {
                config.ffa.clone()
            } else {
                pool
            };
            local_color = ffa_self;
            identity[local as usize] = Some(ffa_self);
            let mut j = 0usize;
            for &p in &info.active_players {
                if p == local {
                    continue;
                }
                identity[p as usize] = Some(draw_pool[j % draw_pool.len()]);
                j += 1;
            }
        } else {
            for (i, &p) in info.active_players.iter().enumerate() {
                identity[p as usize] = Some(config.ffa[i % config.ffa.len()]);
            }
            local_color = identity[local as usize].unwrap_or(config.ffa[0]);
        }

        let mut colors = [None; 8];
        for &p in &info.active_players {
            colors[p as usize] = identity[p as usize];
        }
        colors[local as usize] = Some(local_color);

        let mut allies = Pool::new(config.allies.clone());
        let mut allied = [false; 8];
        if overlay_enabled {
            for &p in &info.active_players {
                if p == local {
                    continue;
                }
                if info.initial_allies[local as usize][p as usize] {
                    allied[p as usize] = true;
                    colors[p as usize] = Some(allies.enter(p));
                }
            }
        }

        TeamColorState {
            colors,
            kind: StateKind::Seated(Box::new(SeatedState {
                local,
                overlay_enabled,
                allies,
                enemies: None,
                identity,
                allied,
            })),
        }
    }

    /// Observer/replay: a static assignment. Two clean alliance teams split into a friendly pool
    /// (self color prepended to the allies pool, given to the team with the lowest slot) and the
    /// enemies pool; any other shape falls back to FFA identity colors.
    fn new_observer(config: &TeamColorConfig, info: &GameStartInfo) -> TeamColorState {
        let two_player = info.active_players.len() == 2;
        let usage_ok = config.usage != TeamColorUsage::Never
            && !(config.usage == TeamColorUsage::ExceptIn1v1 && two_player);
        let mut colors = [None; 8];
        if usage_ok
            && let Some([friendly, enemy]) = two_team_partition(info)
        {
            let mut friendly_pool = Vec::with_capacity(1 + config.allies.len());
            friendly_pool.push(config.self_color);
            friendly_pool.extend_from_slice(&config.allies);
            for (i, &p) in friendly.iter().enumerate() {
                colors[p as usize] = Some(friendly_pool[i % friendly_pool.len()]);
            }
            for (i, &p) in enemy.iter().enumerate() {
                colors[p as usize] = Some(config.enemies[i % config.enemies.len()]);
            }
            return TeamColorState {
                colors,
                kind: StateKind::Static,
            };
        }
        for (i, &p) in info.active_players.iter().enumerate() {
            colors[p as usize] = Some(config.ffa[i % config.ffa.len()]);
        }
        TeamColorState {
            colors,
            kind: StateKind::Static,
        }
    }
}

/// Whether the game is a team context (as opposed to FFA), decided once at game start.
fn is_team_context(config: &TeamColorConfig, info: &GameStartInfo) -> bool {
    let two_player = info.active_players.len() == 2;
    if config.usage == TeamColorUsage::Never {
        return false;
    }
    if config.usage == TeamColorUsage::ExceptIn1v1 && two_player {
        return false;
    }
    let any_alliance = info.active_players.iter().any(|&a| {
        info.active_players
            .iter()
            .any(|&b| a != b && info.initial_allies[a as usize][b as usize])
    });
    any_alliance || two_player
}

/// Partitions active players into exactly two alliance teams, or `None` if the starting alliances
/// don't form two clean mutually-allied teams (0/1/3+ teams, asymmetric alliances, or cross-team
/// alliances). The returned teams are members-ascending, and ordered so the team containing the
/// lowest slot comes first.
fn two_team_partition(info: &GameStartInfo) -> Option<[Vec<u8>; 2]> {
    let active = &info.active_players;
    let n = active.len();

    fn find(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }

    // Union players connected by any alliance edge (either direction).
    let mut parent: Vec<usize> = (0..n).collect();
    for (i, &pi) in active.iter().enumerate() {
        for (j, &pj) in active.iter().enumerate().skip(i + 1) {
            let a = pi as usize;
            let b = pj as usize;
            if info.initial_allies[a][b] || info.initial_allies[b][a] {
                let ri = find(&mut parent, i);
                let rj = find(&mut parent, j);
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
    }

    // A valid partition needs every within-team pair mutually allied and no cross-team edge at all.
    for (i, &pi) in active.iter().enumerate() {
        for (j, &pj) in active.iter().enumerate() {
            if i == j {
                continue;
            }
            let a = pi as usize;
            let b = pj as usize;
            let same = find(&mut parent, i) == find(&mut parent, j);
            let mutual = info.initial_allies[a][b] && info.initial_allies[b][a];
            let any_edge = info.initial_allies[a][b] || info.initial_allies[b][a];
            if same && !mutual {
                return None;
            }
            if !same && any_edge {
                return None;
            }
        }
    }

    let mut roots: Vec<usize> = Vec::new();
    let mut teams: Vec<Vec<u8>> = Vec::new();
    for (i, &player) in active.iter().enumerate() {
        let r = find(&mut parent, i);
        let idx = match roots.iter().position(|&x| x == r) {
            Some(k) => k,
            None => {
                roots.push(r);
                teams.push(Vec::new());
                teams.len() - 1
            }
        };
        teams[idx].push(player);
    }
    if teams.len() != 2 {
        return None;
    }
    teams.sort_by_key(|team| team.first().copied().unwrap_or(u8::MAX));
    teams.try_into().ok()
}

/// Whether two colors are the exact same RGBA value, compared bit-for-bit (both come from the same
/// hex-to-float conversion, so equal hex yields equal bits).
fn colors_eq(a: &Color, b: &Color) -> bool {
    a.iter().zip(b.iter()).all(|(x, y)| x.to_bits() == y.to_bits())
}

/// SplitMix64: a tiny, self-contained PRNG for the per-game pool shuffle. Deterministic from its
/// seed, which keeps a shuffle reproducible for a given seed (the DLL seeds from local entropy).
struct SplitMix64(u64);

impl SplitMix64 {
    fn new(seed: u64) -> SplitMix64 {
        SplitMix64(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// Fisher-Yates in place. Modulo bias is irrelevant for the tiny pools involved and a purely local
/// aesthetic.
fn fisher_yates(items: &mut [Color], rng: &mut SplitMix64) {
    for i in (1..items.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A distinct color identified by `n` (its red channel), for readable assertions.
    fn col(n: u8) -> Color {
        [n as f32, 0.0, 0.0, 1.0]
    }

    fn cols(ns: &[u8]) -> Vec<Color> {
        ns.iter().map(|&n| col(n)).collect()
    }

    struct ConfigArgs {
        usage: TeamColorUsage,
        shuffle: bool,
        self_color: u8,
        allies: &'static [u8],
        enemies: &'static [u8],
        ffa: &'static [u8],
        ffa_self: Option<u8>,
    }

    fn config(args: ConfigArgs) -> TeamColorConfig {
        TeamColorConfig {
            usage: args.usage,
            shuffle: args.shuffle,
            self_color: col(args.self_color),
            allies: cols(args.allies),
            enemies: cols(args.enemies),
            ffa: cols(args.ffa),
            ffa_self: args.ffa_self.map(col),
        }
    }

    fn info(active: &[u8], local: Option<u8>, allied_pairs: &[(u8, u8)]) -> GameStartInfo {
        let mut initial_allies = [[false; 8]; 8];
        for &(a, b) in allied_pairs {
            initial_allies[a as usize][b as usize] = true;
        }
        GameStartInfo {
            active_players: active.to_vec(),
            local_player: local,
            initial_allies,
        }
    }

    /// Alliance pairs that make `members` a mutually-allied team (both directions, all pairs).
    fn team_pairs(members: &[u8]) -> Vec<(u8, u8)> {
        let mut out = Vec::new();
        for &a in members {
            for &b in members {
                if a != b {
                    out.push((a, b));
                }
            }
        }
        out
    }

    /// Extracts the resolved color for slot `p` (panics if unassigned — the tests only ask about
    /// active slots).
    fn at(colors: &[Option<Color>; 8], p: u8) -> Color {
        colors[p as usize].expect("slot should be assigned")
    }

    #[test]
    fn parse_hex_color_valid_and_invalid() {
        assert_eq!(parse_hex_color("#000000"), Some([0.0, 0.0, 0.0, 1.0]));
        assert_eq!(parse_hex_color("#FFFFFF"), Some([1.0, 1.0, 1.0, 1.0]));
        assert_eq!(parse_hex_color("#FF0000"), Some([1.0, 0.0, 0.0, 1.0]));
        // Lowercase hex is accepted.
        assert_eq!(parse_hex_color("#00ff00"), Some([0.0, 1.0, 0.0, 1.0]));
        // A mid-range channel round-trips through the /255 conversion.
        assert_eq!(parse_hex_color("#2CB494").unwrap()[0], 0x2C as f32 / 255.0);
        // Rejections: missing '#', wrong length, non-hex digits, empty.
        assert_eq!(parse_hex_color("2CB494"), None);
        assert_eq!(parse_hex_color("#2CB49"), None);
        assert_eq!(parse_hex_color("#2CB4944"), None);
        assert_eq!(parse_hex_color("#GGGGGG"), None);
        assert_eq!(parse_hex_color(""), None);
    }

    #[test]
    fn four_v_four_team_assignment_order() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10, 11, 12, 13],
            enemies: &[20, 21, 22, 23],
            ffa: &[30],
            ffa_self: None,
        });
        let mut pairs = team_pairs(&[0, 1, 2, 3]);
        pairs.extend(team_pairs(&[4, 5, 6, 7]));
        let gi = info(&[0, 1, 2, 3, 4, 5, 6, 7], Some(0), &pairs);
        let state = TeamColorState::new(cfg, &gi, 0);
        let c = state.colors();
        assert_eq!(at(&c, 0), col(1)); // self
        assert_eq!(at(&c, 1), col(10)); // allies in ascending slot order
        assert_eq!(at(&c, 2), col(11));
        assert_eq!(at(&c, 3), col(12));
        assert_eq!(at(&c, 4), col(20)); // enemies in ascending slot order
        assert_eq!(at(&c, 5), col(21));
        assert_eq!(at(&c, 6), col(22));
        assert_eq!(at(&c, 7), col(23));
    }

    #[test]
    fn one_v_one_promotion_by_usage() {
        let make = |usage| {
            config(ConfigArgs {
                usage,
                shuffle: false,
                self_color: 1,
                allies: &[10],
                enemies: &[20],
                ffa: &[30, 31],
                ffa_self: None,
            })
        };
        let gi = info(&[0, 1], Some(0), &[]);

        // Always: a 2-player game is promoted to team context.
        let always = TeamColorState::new(make(TeamColorUsage::Always), &gi, 0).colors();
        assert_eq!(at(&always, 0), col(1)); // self
        assert_eq!(at(&always, 1), col(20)); // opponent from enemies pool

        // ExceptIn1v1: a 2-player game stays FFA.
        let except = TeamColorState::new(make(TeamColorUsage::ExceptIn1v1), &gi, 0).colors();
        assert_eq!(at(&except, 0), col(30)); // both draw FFA identity in slot order
        assert_eq!(at(&except, 1), col(31));

        // Never: also FFA identity.
        let never = TeamColorState::new(make(TeamColorUsage::Never), &gi, 0).colors();
        assert_eq!(at(&never, 0), col(30));
        assert_eq!(at(&never, 1), col(31));
    }

    #[test]
    fn short_pool_wraps_to_duplicates() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20, 21],
            ffa: &[30],
            ffa_self: None,
        });
        // Local allied to slot 1, slots 2..5 are enemies drawing from a 2-color pool.
        let gi = info(&[0, 1, 2, 3, 4], Some(0), &[(0, 1), (1, 0)]);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        assert_eq!(at(&c, 0), col(1));
        assert_eq!(at(&c, 1), col(10));
        assert_eq!(at(&c, 2), col(20));
        assert_eq!(at(&c, 3), col(21));
        assert_eq!(at(&c, 4), col(20)); // wraps
    }

    #[test]
    fn sticky_reentry_returns_original_color() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10, 11],
            enemies: &[20, 21],
            ffa: &[30],
            ffa_self: None,
        });
        // Local (0) starts allied to slot 1; slots 2 and 3 are enemies.
        let gi = info(&[0, 1, 2, 3], Some(0), &[(0, 1), (1, 0)]);
        let mut state = TeamColorState::new(cfg, &gi, 0);
        assert_eq!(at(&state.colors(), 1), col(10)); // ally color
        assert_eq!(at(&state.colors(), 2), col(20));
        assert_eq!(at(&state.colors(), 3), col(21));

        // Un-ally slot 1: it enters the enemies pool at the cursor (wraps to enemies[0]).
        let changed = state.update_local_alliances(&[false, false, false, false, false, false, false, false]);
        assert!(changed);
        assert_eq!(at(&state.colors(), 1), col(20));
        assert_eq!(at(&state.colors(), 2), col(20)); // unchanged
        assert_eq!(at(&state.colors(), 3), col(21)); // unchanged

        // Re-ally slot 1: it returns to its original ally color, not a fresh one.
        let mut row = [false; 8];
        row[1] = true;
        let changed = state.update_local_alliances(&row);
        assert!(changed);
        assert_eq!(at(&state.colors(), 1), col(10));
    }

    #[test]
    fn new_mid_game_ally_appends_at_pool_end() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10, 11],
            enemies: &[20],
            ffa: &[30],
            ffa_self: None,
        });
        // Local (0) starts allied to slot 1; slot 2 is an enemy.
        let gi = info(&[0, 1, 2], Some(0), &[(0, 1), (1, 0)]);
        let mut state = TeamColorState::new(cfg, &gi, 0);
        assert_eq!(at(&state.colors(), 1), col(10));
        assert_eq!(at(&state.colors(), 2), col(20));

        // Ally slot 2: it takes the next allies-pool color (append at end), slot 1 is untouched.
        let mut row = [false; 8];
        row[1] = true;
        row[2] = true;
        let changed = state.update_local_alliances(&row);
        assert!(changed);
        assert_eq!(at(&state.colors(), 1), col(10));
        assert_eq!(at(&state.colors(), 2), col(11));
    }

    #[test]
    fn ffa_identity_ally_overlay_and_restore() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10, 11],
            enemies: &[20],
            ffa: &[30, 31, 32, 33],
            ffa_self: None,
        });
        // No starting alliances, 4 players => FFA context.
        let gi = info(&[0, 1, 2, 3], Some(0), &[]);
        let mut state = TeamColorState::new(cfg, &gi, 0);
        let c = state.colors();
        assert_eq!(at(&c, 0), col(30));
        assert_eq!(at(&c, 1), col(31));
        assert_eq!(at(&c, 2), col(32));
        assert_eq!(at(&c, 3), col(33));

        // Ally slot 2: it moves to the allies pool; nobody else changes.
        let mut row = [false; 8];
        row[2] = true;
        assert!(state.update_local_alliances(&row));
        let c = state.colors();
        assert_eq!(at(&c, 2), col(10));
        assert_eq!(at(&c, 1), col(31));
        assert_eq!(at(&c, 3), col(33));

        // Un-ally slot 2: it returns to its remembered FFA identity.
        assert!(state.update_local_alliances(&[false; 8]));
        assert_eq!(at(&state.colors(), 2), col(32));
    }

    #[test]
    fn ffa_self_consumed_when_present() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20],
            ffa: &[30, 31, 32, 33],
            ffa_self: Some(31), // present in the FFA pool
        });
        let gi = info(&[0, 1, 2, 3], Some(0), &[]);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        assert_eq!(at(&c, 0), col(31)); // local gets ffa_self
        // 31 is consumed, others draw [30, 32, 33] in order.
        assert_eq!(at(&c, 1), col(30));
        assert_eq!(at(&c, 2), col(32));
        assert_eq!(at(&c, 3), col(33));
    }

    #[test]
    fn ffa_self_absent_from_pool() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20],
            ffa: &[30, 31, 32, 33],
            ffa_self: Some(99), // not in the FFA pool
        });
        let gi = info(&[0, 1, 2, 3], Some(0), &[]);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        assert_eq!(at(&c, 0), col(99)); // local gets ffa_self
        // Nothing consumed; others draw [30, 31, 32] in order.
        assert_eq!(at(&c, 1), col(30));
        assert_eq!(at(&c, 2), col(31));
        assert_eq!(at(&c, 3), col(32));
    }

    #[test]
    fn observer_two_team_split() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10, 11],
            enemies: &[20, 21],
            ffa: &[30],
            ffa_self: None,
        });
        // Teams {0,2} and {1,3}; no local seat (observer).
        let mut pairs = team_pairs(&[0, 2]);
        pairs.extend(team_pairs(&[1, 3]));
        let gi = info(&[0, 1, 2, 3], None, &pairs);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        // Lowest slot (0) is in {0,2} => friendly pool [self, allies...].
        assert_eq!(at(&c, 0), col(1)); // self prepended
        assert_eq!(at(&c, 2), col(10)); // allies[0]
        // The other team draws the enemies pool.
        assert_eq!(at(&c, 1), col(20));
        assert_eq!(at(&c, 3), col(21));
    }

    #[test]
    fn observer_three_teams_falls_back_to_ffa() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20],
            ffa: &[30, 31, 32, 33, 34, 35],
            ffa_self: None,
        });
        let mut pairs = team_pairs(&[0, 1]);
        pairs.extend(team_pairs(&[2, 3]));
        pairs.extend(team_pairs(&[4, 5]));
        let gi = info(&[0, 1, 2, 3, 4, 5], None, &pairs);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        for i in 0..6u8 {
            assert_eq!(at(&c, i), col(30 + i));
        }
    }

    #[test]
    fn observer_asymmetric_alliance_falls_back_to_ffa() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Always,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20],
            ffa: &[30, 31, 32, 33],
            ffa_self: None,
        });
        // 0 allied to 1 but not reciprocated => invalid partition => FFA fallback.
        let gi = info(&[0, 1, 2, 3], None, &[(0, 1)]);
        let c = TeamColorState::new(cfg, &gi, 0).colors();
        for i in 0..4u8 {
            assert_eq!(at(&c, i), col(30 + i));
        }
    }

    #[test]
    fn usage_never_ignores_alliance_updates() {
        let cfg = config(ConfigArgs {
            usage: TeamColorUsage::Never,
            shuffle: false,
            self_color: 1,
            allies: &[10],
            enemies: &[20],
            ffa: &[30, 31, 32, 33],
            ffa_self: None,
        });
        let gi = info(&[0, 1, 2, 3], Some(0), &[]);
        let mut state = TeamColorState::new(cfg, &gi, 0);
        let before = state.colors();
        // Every possible alliance change is ignored.
        let changed = state.update_local_alliances(&[true; 8]);
        assert!(!changed);
        assert_eq!(state.colors(), before);
    }

    #[test]
    fn shuffle_is_deterministic_for_equal_seeds() {
        let make = || {
            config(ConfigArgs {
                usage: TeamColorUsage::Always,
                shuffle: true,
                self_color: 1,
                allies: &[10, 11, 12, 13],
                enemies: &[20, 21, 22, 23],
                ffa: &[30],
                ffa_self: None,
            })
        };
        let mut pairs = team_pairs(&[0, 1, 2, 3]);
        pairs.extend(team_pairs(&[4, 5, 6, 7]));
        let gi = info(&[0, 1, 2, 3, 4, 5, 6, 7], Some(0), &pairs);
        let a = TeamColorState::new(make(), &gi, 0x1234_5678).colors();
        let b = TeamColorState::new(make(), &gi, 0x1234_5678).colors();
        assert_eq!(a, b);
        // The assignment is still a permutation of the same enemy colors (colors preserved).
        let mut enemy_colors: Vec<Color> = (4..8u8).map(|p| at(&a, p)).collect();
        enemy_colors.sort_by_key(|c| c[0].to_bits());
        assert_eq!(enemy_colors, cols(&[20, 21, 22, 23]));
    }
}
