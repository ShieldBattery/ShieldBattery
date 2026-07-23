use std::fmt::Display;
use std::path::PathBuf;

use atomic_enum::atomic_enum;
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

use crate::bw;
use crate::bw::players::{AllianceState, AssignedRace, PlayerLoseType, VictoryState};
use crate::bw::{BwGameType, LobbyOptions};
use crate::team_colors::{Color, TeamColorConfig, TeamColorUsage, parse_hex_color};

// Structures of messages that are used to communicate with the electron app.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub local: serde_json::Map<String, serde_json::Value>,
    pub scr: serde_json::Map<String, serde_json::Value>,
    pub settings_file_path: String,
    /// If set, the bounds of the monitor that the user wants to launch on (in fullscreen modes).
    pub monitor_bounds: Option<(i32, i32, u32, u32)>,
    /// The user's resolved custom team-color scheme, or `None` from a client that doesn't send it.
    /// The app maps presets to concrete `#RRGGBB` values before sending, so the DLL only ever sees
    /// resolved colors.
    #[serde(default)]
    pub team_colors: Option<TeamColorsSettings>,
}

/// Fully-resolved custom team-color scheme, as sent by the app. Colors are `#RRGGBB` strings; the
/// DLL parses them into the engine's [`TeamColorConfig`] via [`TeamColorsSettings::to_config`].
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamColorsSettings {
    pub usage: TeamColorUsage,
    pub shuffle: bool,
    pub team: TeamSchemeColors,
    /// Optional fixed local-player color in team contexts, resolved by the app. When set it
    /// overrides the preset's `team.self` for any preset; absent / `null` leaves the local player on
    /// the preset self color.
    pub team_self: Option<String>,
    /// Identity color pool for FFA / non-team contexts.
    pub ffa: Vec<String>,
    /// Optional fixed local-player color in FFA contexts.
    pub ffa_self: Option<String>,
}

/// The team-scheme half of [`TeamColorsSettings`]: the local player's color plus the ally/enemy
/// pools used when team semantics apply.
#[derive(Deserialize, Debug, Clone)]
pub struct TeamSchemeColors {
    /// The local player's color. `self` is a Rust keyword, so the wire key is remapped.
    #[serde(rename = "self")]
    pub self_color: String,
    pub allies: Vec<String>,
    pub enemies: Vec<String>,
}

impl TeamColorsSettings {
    /// Converts the wire settings into the engine's [`TeamColorConfig`], hex-parsing every pool.
    /// Individually invalid entries are logged and dropped; if the local color is unparseable or
    /// any required pool resolves empty, the feature is disabled (`None`) rather than running with
    /// a degenerate pool.
    pub fn to_config(&self) -> Option<TeamColorConfig> {
        let self_color = match parse_hex_color(&self.team.self_color) {
            Some(c) => c,
            None => {
                warn!(
                    "Custom team colors disabled: invalid self color '{}'",
                    self.team.self_color
                );
                return None;
            }
        };
        let allies = parse_color_pool(&self.team.allies, "team allies");
        let enemies = parse_color_pool(&self.team.enemies, "team enemies");
        let ffa = parse_color_pool(&self.ffa, "ffa");
        let team_self_override = self.team_self.as_deref().and_then(|s| {
            let parsed = parse_hex_color(s);
            if parsed.is_none() {
                warn!("Ignoring invalid team self color '{s}'");
            }
            parsed
        });
        let ffa_self = self.ffa_self.as_deref().and_then(|s| {
            let parsed = parse_hex_color(s);
            if parsed.is_none() {
                warn!("Ignoring invalid ffa self color '{s}'");
            }
            parsed
        });
        if allies.is_empty() || enemies.is_empty() || ffa.is_empty() {
            warn!(
                "Custom team colors disabled: a color pool resolved empty \
                 (allies={}, enemies={}, ffa={})",
                allies.len(),
                enemies.len(),
                ffa.len()
            );
            return None;
        }
        Some(TeamColorConfig {
            usage: self.usage,
            shuffle: self.shuffle,
            self_color,
            team_self_override,
            allies,
            enemies,
            ffa,
            ffa_self,
        })
    }
}

/// Hex-parses a pool of `#RRGGBB` strings, logging and dropping any entry that doesn't parse.
fn parse_color_pool(hexes: &[String], label: &str) -> Vec<Color> {
    let mut out = Vec::with_capacity(hexes.len());
    for hex in hexes {
        match parse_hex_color(hex) {
            Some(color) => out.push(color),
            None => warn!("Dropping invalid {label} color '{hex}'"),
        }
    }
    out
}

#[atomic_enum]
#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StartingFog {
    #[default]
    Transparent,
    ShowResources,
    Legacy,
}

/// The minimap player-color mode, cycled in-game with Shift+Tab. The discriminants match the game's
/// internal `minimap_color_mode` global so the enum can be read/written against it directly, and
/// `serde_repr` (de)serializes it as that number across the wire and in local settings.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Default, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum MinimapColorMode {
    /// Default SC:R player colors everywhere.
    #[default]
    Standard = 0,
    /// Apply the user's color preset on the minimap only.
    PresetOnMinimapOnly = 1,
    /// Apply the user's color preset on both the minimap and the game view.
    Preset = 2,
}

impl TryFrom<u8> for MinimapColorMode {
    type Error = ();

    /// Maps a raw `minimap_color_mode` global value to the enum, failing if it's unrecognized.
    fn try_from(value: u8) -> Result<MinimapColorMode, Self::Error> {
        match value {
            0 => Ok(MinimapColorMode::Standard),
            1 => Ok(MinimapColorMode::PresetOnMinimapOnly),
            2 => Ok(MinimapColorMode::Preset),
            _ => Err(()),
        }
    }
}

// app/common/game_status.js
pub const GAME_STATUS_ERROR: u32 = 666;
#[derive(Serialize)]
pub struct SetupProgress {
    pub status: SetupProgressInfo,
}

#[derive(Serialize)]
pub struct SetupProgressInfo {
    pub state: u32,
    pub extra: Option<String>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SbUserId(pub u32);

impl From<u32> for SbUserId {
    fn from(value: u32) -> Self {
        SbUserId(value)
    }
}

impl From<&u32> for SbUserId {
    fn from(value: &u32) -> Self {
        SbUserId(*value)
    }
}

impl From<SbUserId> for u32 {
    fn from(value: SbUserId) -> Self {
        value.0
    }
}

impl From<&SbUserId> for u32 {
    fn from(value: &SbUserId) -> Self {
        value.0
    }
}

impl Display for SbUserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct SbUser {
    pub id: SbUserId,
    pub name: String,
    /// A fully-qualified URL to the user's uploaded profile avatar, or `None` if they haven't
    /// uploaded one. This is a resolved URL, not the underlying storage path.
    #[serde(rename = "avatarUrl", default)]
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct WindowMove {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Sent when a game exits to persist the minimap color/terrain toggles (Shift+Tab / Tab) that the
/// user may have changed during play. Fields are omitted when the corresponding game global could
/// not be located, so the previously-saved value is left untouched.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<MinimapColorMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terrain_hidden: Option<bool>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Deserialize)]
pub enum UmsLobbyRace {
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
    #[serde(rename = "r")]
    Random,
    #[serde(rename = "any")]
    Any,
}

#[derive(Serialize, Debug, Copy, Clone, Eq, PartialEq)]
pub struct GamePlayerResult {
    pub result: VictoryState,
    pub race: AssignedRace,
    pub apm: u32,
}

#[derive(Debug, Copy, Clone, Serialize)]
pub struct NetworkStallInfo {
    pub count: u32,
    pub min: u32,
    pub max: u32,
    pub median: u32,
}

/// Which turn transport a game session runs on, reported to the app via `/game/networkStatus`.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkTransport {
    /// The rally-point2 QUIC turn transport (netcode v2).
    NetcodeV2,
    /// No relay: a local-only game (a solo game versus AI, or a replay).
    Native,
}

/// Payload of `/game/networkStatus` (game DLL -> app): sent once during game init when the
/// transport choice settles, so external tooling can assert on it instead of grepping logs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
    pub transport: NetworkTransport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GameResults {
    pub time_ms: u64,
    pub results: HashMap<SbUserId, GamePlayerResult>,
    pub network_stalls: NetworkStallInfo,
    /// Raw per-player evidence rows sent to the server, one per non-observer human and per computer.
    pub raw_players: Vec<RawPlayerResult>,
    /// Raw network status for all 8 storm ids sent to the server.
    pub raw_net_players: Vec<RawNetPlayer>,
    /// The type of loss the local player received (if any).
    pub local_player_lose_type: Option<PlayerLoseType>,
    /// Path to the temporary replay file saved for upload.
    /// This file should be cleaned up after upload completes.
    pub replay_path: Option<PathBuf>,
}

/// Version of GameResults that gets sent to the Electron app via websocket.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResultsMessage<'a> {
    #[serde(rename = "time")]
    pub time: u64,
    pub results: &'a HashMap<SbUserId, GamePlayerResult>,
    pub network_stalls: &'a NetworkStallInfo,
    /// Path to the temporary replay file saved for upload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_replay_path: Option<&'a str>,
}

/// A single player's raw end-of-game evidence, as read directly from the game.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawPlayerResult {
    /// SbUserId of the human occupying this slot, or `None` for a computer.
    pub user_id: Option<SbUserId>,
    pub bw_player_id: u8,
    /// Storm id of the human occupying this slot, or `None` for a computer.
    pub storm_id: Option<u8>,
    pub race: AssignedRace,
    pub victory_state: VictoryState,
    pub alliances: [AllianceState; 8],
}

/// A single storm player's raw network status at the end of the game.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawNetPlayer {
    pub storm_id: u8,
    pub was_dropped: bool,
    pub has_quit: bool,
}

/// Raw end-of-game evidence report sent to the server over the relay's reliable control stream.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawGameResultsReport<'a> {
    pub version: u8,
    pub user_id: SbUserId,
    pub result_code: &'a str,
    pub time: u64,
    pub players: &'a [RawPlayerResult],
    pub net_players: &'a [RawNetPlayer],
    pub local_player_lose_type: Option<PlayerLoseType>,
}

#[derive(Serialize)]
pub struct ReplaySaved {
    pub path: String,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameType {
    Melee,
    Ffa,
    OneVOne,
    Ums,
    TeamMelee,
    TeamFfa,
    TopVBottom,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSetupInfo {
    pub name: String,
    pub map: MapInfo,
    pub map_path: String,
    pub game_type: GameType,
    pub game_sub_type: Option<u8>,
    pub slots: Vec<PlayerInfo>,
    pub host: PlayerInfo,
    pub users: Vec<SbUser>,
    #[expect(dead_code)]
    pub ratings: Option<Vec<(SbUserId, f32)>>,
    pub disable_alliance_changes: Option<bool>,
    pub use_legacy_limits: Option<bool>,
    pub turn_rate: Option<u32>,
    pub user_latency: Option<u32>,
    pub seed: u32,
    pub game_id: String,
    pub result_code: Option<String>,
    pub is_chat_restricted: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub server_url: String,
}

impl GameSetupInfo {
    pub fn is_replay(&self) -> bool {
        match self.map {
            MapInfo::Replay(_) => true,
            MapInfo::Game(_) => false,
        }
    }

    pub fn bw_game_type(&self) -> Option<BwGameType> {
        match self.game_type {
            GameType::Melee => Some(BwGameType::melee()),
            GameType::Ffa => Some(BwGameType::ffa()),
            GameType::OneVOne => Some(BwGameType::one_v_one()),
            GameType::Ums => Some(BwGameType::ums()),
            GameType::TeamMelee => Some(BwGameType::team_melee(self.game_sub_type?)),
            GameType::TeamFfa => Some(BwGameType::team_ffa(self.game_sub_type?)),
            GameType::TopVBottom => Some(BwGameType::top_v_bottom(self.game_sub_type?)),
        }
    }
}

impl From<&GameSetupInfo> for LobbyOptions {
    fn from(value: &GameSetupInfo) -> Self {
        LobbyOptions {
            game_type: value.bw_game_type().unwrap_or(BwGameType {
                primary: 0x2,
                subtype: 0x1,
            }),
            turn_rate: value.turn_rate.unwrap_or(0),
            use_legacy_limits: value.use_legacy_limits.unwrap_or(false),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
pub enum MapInfo {
    Replay(ReplayMapInfo),
    Game(GameMapInfo),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ReplayMapInfo {
    pub is_replay: bool,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct GameMapInfo {
    pub id: String,
    pub hash: String,
    pub name: String,
    pub description: String,
    pub map_data: MapData,
    pub map_url: Option<String>,
    pub image256_url: Option<String>,
    pub image512_url: Option<String>,
    pub image1024_url: Option<String>,
    pub image2048_url: Option<String>,
    pub image_version: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MapData {
    pub height: u16,
    pub width: u16,
    pub ums_slots: u8,
    pub slots: u8,
    pub tileset: u16,
    pub ums_forces: Vec<MapForce>,
    pub is_eud: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapForce {
    pub players: Vec<MapForcePlayer>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapForcePlayer {
    pub id: u8,
    pub race: UmsLobbyRace,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Hash)]
#[serde(transparent)]
pub struct LobbyPlayerId(String);

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SbSlotType {
    Human,
    Observer,
    Computer,
    ControlledOpen,
    ControlledClosed,
    UmsComputer,
    Open,
    Closed,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    // The lobby player id from the server's slot list. Part of the wire format but not consulted by
    // the game DLL (it maps players by user id / slot index instead).
    #[allow(dead_code)]
    pub id: LobbyPlayerId,
    pub race: Option<String>,
    pub user_id: Option<SbUserId>,
    /// BW player slot index. Only set in UMS; for other game types the index is equal to
    /// GameSetupInfo.slots index.
    /// And either way this value becomes useless after BW randomizes the slots during
    /// game initialization.
    pub player_id: Option<u8>,
    pub team_id: u8,
    /// This is the slot type used by ShieldBattery code.
    #[serde(rename = "type")]
    pub player_type: SbSlotType,
    /// This is the slot type ID used in BW structures.
    #[serde(rename = "typeId")]
    pub player_type_id: u8,
}

impl PlayerInfo {
    /// Returns true for non-observing human players
    pub fn is_human(&self) -> bool {
        self.player_type == SbSlotType::Human
    }

    pub fn is_observer(&self) -> bool {
        self.player_type == SbSlotType::Observer
    }

    /// Returns true for AI (computer-controlled) players — both regular and UMS computers.
    pub fn is_computer(&self) -> bool {
        matches!(
            self.player_type,
            SbSlotType::Computer | SbSlotType::UmsComputer
        )
    }

    pub fn bw_player_type(&self) -> u8 {
        match self.player_type {
            SbSlotType::Human | SbSlotType::Observer => bw::PLAYER_TYPE_HUMAN,
            SbSlotType::Computer => bw::PLAYER_TYPE_LOBBY_COMPUTER,
            SbSlotType::ControlledOpen
            | SbSlotType::ControlledClosed
            | SbSlotType::Open
            | SbSlotType::Closed => bw::PLAYER_TYPE_OPEN,
            _ => bw::PLAYER_TYPE_NONE,
        }
    }

    pub fn bw_race(&self) -> u8 {
        match self.race.as_deref() {
            Some("z") => bw::RACE_ZERG,
            Some("t") => bw::RACE_TERRAN,
            Some("p") => bw::RACE_PROTOSS,
            _ => bw::RACE_RANDOM,
        }
    }
}

/// A string whose contents must never appear in logs or error output. Wraps a value (e.g. a
/// base64-encoded private key) so an accidental `{:?}` — via `debug!`, an error `context`, or a
/// panic message — prints a redaction marker instead of the secret.
///
/// This is defense-in-depth for the netcode v2 credential handoff: the client's per-session Ed25519
/// private key is handed to the DLL at launch and must stay inside trusted local process memory.
/// `Deserialize` is derived so it drops straight in as a JSON string field.
///
/// NOTE(security): this redacts the *log/format* leak vector only. The plaintext still lives in the
/// `String` until dropped; true zeroization-on-drop is a follow-up (would need the `zeroize` crate).
#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// Borrows the secret. Callers must not log or format the returned value.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Test-only constructor (the real path is `Deserialize` from the app's JSON).
    #[cfg(test)]
    pub fn from_base64_for_test(value: &str) -> Self {
        Secret(value.to_owned())
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// One relay's reachable endpoint plus the TLS material to trust it. Direct dual-stack IPs (D3)
/// rule out a public CA, so the relay's leaf cert is pinned: the coordinator hands it to the app in
/// the session descriptor, the app forwards it here, and it seeds the client's trust roots
/// (architecture.md, "Client → relay trust").
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcodeV2Relay {
    /// The coordinator's numeric id for this relay. Named in a re-home request when this client
    /// believes the relay is dead. Defaults to 0 if an older server omits it; 0 never names a live
    /// relay, so a re-home ask against it harmlessly answers `unavailable`.
    #[serde(default)]
    pub relay_id: u64,
    pub address4: Option<String>,
    pub address6: Option<String>,
    pub port: u16,
    /// TLS server name checked against the certificate the relay presents.
    pub server_name: String,
    /// base64 (standard, padded) of the relay's leaf certificate in DER form, pinned into the
    /// client's `RootCertStore`.
    pub cert: String,
}

/// One entry of the session's slot roster: which ShieldBattery user occupies a rally-point2 slot.
/// The coordinator's session response is the authoritative source (its `tokens[]` carry one slot
/// per player); the server resolves each slot back to the user it requested it for and the app
/// forwards the full pairing here, so the turn state can map every peer's rp2 slot — not just our own —
/// to the BW network id that player is assigned during join.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcodeV2RosterEntry {
    /// The player's rally-point2 slot within the session.
    pub slot: u8,
    /// The ShieldBattery user occupying that slot.
    pub user_id: SbUserId,
    /// The coordinator-assigned home relay for this slot at session create, surfaced in the
    /// `/netstat` per-player home column. `None` from an older server that omits it; peers' later
    /// re-homes are not client-observable, so this stays the create-time assignment.
    #[serde(default)]
    pub home_relay_id: Option<u64>,
    /// The home relay's region label at session create (e.g. `local-a`), or `None` when the setup
    /// carried none. Rendered beside the relay id in the `/netstat` home column.
    #[serde(default)]
    pub home_region: Option<String>,
}

/// The netcode v2 launch handoff (app → game DLL): everything one client needs to authorize a
/// single game session against its home relay. The app generates the per-session Ed25519 keypair,
/// requests a coordinator-signed token embedding the public half, and forwards both here with the
/// relay endpoints.
///
/// The token already carries session / slot / tenant / expiry, so those are not duplicated here;
/// the DLL decodes the token (`SignedToken::decode`) rather than trusting separately-sent copies.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcodeV2Setup {
    /// base64 (standard, padded) of the coordinator-signed `SignedToken` (`SignedToken::encode()`).
    pub token: String,
    /// base64 (standard, padded) of the PKCS#8 v2 Ed25519 private key the app generated for this
    /// session. Redacted from all logging via [`Secret`].
    pub client_private_key: Secret,
    /// The home relay this client dials.
    pub home_relay: NetcodeV2Relay,
    /// The session's full slot roster (every player, including ourselves). Our own slot still comes
    /// from the signed token — this list exists to map the *other* players' slots.
    pub roster: Vec<NetcodeV2RosterEntry>,
    /// The turn pipe depth to start the session at, seeded from the session's buffer-bounds
    /// minimum. The relay's decision-maker starts there too and only sends a resize directive once
    /// its computed depth moves off that starting point, so a client that seeded some other
    /// default would disagree with the relay until the first such directive arrived.
    pub initial_buffer_turns: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_status_serializes_camel_case_with_error() {
        let status = NetworkStatus {
            transport: NetworkTransport::Native,
            error: Some("dial timed out".to_owned()),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "transport": "native",
                "error": "dial timed out",
            })
        );
    }

    #[test]
    fn network_status_omits_none_fields() {
        let status = NetworkStatus {
            transport: NetworkTransport::NetcodeV2,
            error: None,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json, serde_json::json!({ "transport": "netcodeV2" }));
    }

    #[test]
    fn team_colors_settings_deserialize_and_convert() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "exceptIn1v1",
            "shuffle": true,
            "team": {
                "self": "#2CB494",
                "allies": ["#FCFC38"],
                "enemies": ["#F40404"],
            },
            "teamSelf": "#123456",
            "ffa": ["#F40404", "#0C48CC"],
            "ffaSelf": "#00E4FC",
        }))
        .unwrap();
        // The wire `self` key maps onto `self_color`.
        assert_eq!(settings.team.self_color, "#2CB494");
        assert_eq!(settings.usage, TeamColorUsage::ExceptIn1v1);
        assert!(settings.shuffle);

        let config = settings.to_config().expect("valid pools resolve");
        assert_eq!(config.usage, TeamColorUsage::ExceptIn1v1);
        assert!(config.shuffle);
        assert_eq!(config.self_color, parse_hex_color("#2CB494").unwrap());
        // `teamSelf` resolves to the override; `team.self` still carries the preset self color.
        assert_eq!(
            config.team_self_override,
            Some(parse_hex_color("#123456").unwrap())
        );
        assert_eq!(config.allies, vec![parse_hex_color("#FCFC38").unwrap()]);
        assert_eq!(config.enemies, vec![parse_hex_color("#F40404").unwrap()]);
        assert_eq!(config.ffa.len(), 2);
        assert_eq!(config.ffa_self, Some(parse_hex_color("#00E4FC").unwrap()));
    }

    #[test]
    fn team_colors_optional_self_colors_default_to_none() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
        }))
        .unwrap();
        // Absent `teamSelf` / `ffaSelf` leave both overrides unset without disabling the feature.
        let config = settings.to_config().unwrap();
        assert_eq!(config.team_self_override, None);
        assert_eq!(config.ffa_self, None);
    }

    #[test]
    fn team_colors_invalid_team_self_is_ignored() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "teamSelf": "not-a-color",
            "ffa": ["#F40404"],
        }))
        .unwrap();
        // An unparseable team self override is logged and dropped, not fatal: unlike the required
        // pools, the feature stays enabled with no override.
        assert_eq!(settings.to_config().unwrap().team_self_override, None);
    }

    #[test]
    fn team_colors_empty_pool_disables_feature() {
        // All-invalid entries drop to an empty pool, which disables the feature rather than
        // building a degenerate config.
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "#2CB494", "allies": ["not-a-color"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
            "ffaSelf": null,
        }))
        .unwrap();
        assert!(settings.to_config().is_none());
    }

    #[test]
    fn team_colors_invalid_self_disables_feature() {
        let settings: TeamColorsSettings = serde_json::from_value(serde_json::json!({
            "usage": "always",
            "shuffle": false,
            "team": { "self": "bad", "allies": ["#FCFC38"], "enemies": ["#F40404"] },
            "ffa": ["#F40404"],
        }))
        .unwrap();
        assert!(settings.to_config().is_none());
    }

    #[test]
    fn settings_without_team_colors_defaults_to_none() {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "local": {},
            "scr": {},
            "settingsFilePath": "path",
            "monitorBounds": null,
        }))
        .unwrap();
        assert!(settings.team_colors.is_none());
    }
}
