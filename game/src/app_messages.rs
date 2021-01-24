use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::bw;

// Structures of messages that are used to communicate with the electron app.

#[derive(Deserialize)]
pub struct Settings {
    pub local: serde_json::Map<String, serde_json::Value>,
}

// app/common/game_status.js
pub const GAME_STATUS_ERROR: u8 = 7;
#[derive(Serialize)]
pub struct SetupProgress {
    pub status: SetupProgressInfo,
}

#[derive(Serialize)]
pub struct SetupProgressInfo {
    pub state: u8,
    pub extra: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct LocalUser {
    pub id: u32,
    pub name: String,
}

#[derive(Serialize)]
pub struct WindowMove {
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize, Copy, Clone)]
pub enum Race {
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
}

#[derive(Serialize, Clone)]
pub struct GamePlayerResult {
    pub result: u8,
    pub race: Race,
    pub apm: u32,
}

#[derive(Serialize)]
pub struct GameResults {
    #[serde(rename = "time")]
    pub time_ms: u32,
    pub results: HashMap<String, GamePlayerResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResultsReport {
    pub user_id: u32,
    pub result_code: String,
    pub time: u32,
    pub player_results: Vec<(String, GamePlayerResult)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSetupInfo {
    pub name: String,
    pub map: MapInfo,
    pub map_path: String,
    pub game_type: String,
    pub game_sub_type: Option<u8>,
    pub slots: Vec<PlayerInfo>,
    pub host: PlayerInfo,
    pub seed: u32,
    pub game_id: String,
    pub result_code: String,
    pub server_url: String,
}

impl GameSetupInfo {
    pub fn is_replay(&self) -> bool {
        self.map.is_replay == Some(true)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapInfo {
    // This object is literally completely different between playing a game and watching a replay
    pub is_replay: Option<bool>,
    pub hash: Option<String>,
    pub map_data: Option<MapData>,
    pub name: Option<String>,
    pub path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapData {
    pub height: u16,
    pub width: u16,
    pub ums_slots: u8,
    pub slots: u8,
    pub tileset: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub id: String,
    pub name: String,
    pub race: Option<String>,
    pub user_id: Option<u32>,
    pub player_id: Option<u8>,
    pub team_id: Option<u8>,
    // Player type can have shieldbattery-specific players (e.g. "observer"),
    // player type id is the id in BW structures.
    #[serde(rename = "type")]
    pub player_type: String,
    #[serde(rename = "typeId")]
    pub player_type_id: u8,
}

impl PlayerInfo {
    /// Returns true for non-observing human players
    pub fn is_human(&self) -> bool {
        self.player_type == "human"
    }

    pub fn is_observer(&self) -> bool {
        self.player_type == "observer"
    }

    pub fn bw_player_type(&self) -> u8 {
        match &*self.player_type {
            "human" | "observer" => bw::PLAYER_TYPE_HUMAN,
            "computer" => bw::PLAYER_TYPE_LOBBY_COMPUTER,
            "controlledOpen" | "controlledClosed" | "open" | "closed" => bw::PLAYER_TYPE_OPEN,
            _ => bw::PLAYER_TYPE_NONE,
        }
    }

    pub fn bw_race(&self) -> u8 {
        match self.race.as_ref().map(|x| &**x) {
            Some("z") => bw::RACE_ZERG,
            Some("t") => bw::RACE_TERRAN,
            Some("p") => bw::RACE_PROTOSS,
            _ => bw::RACE_RANDOM,
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    #[serde(rename = "for")]
    pub for_player: String,
    pub server: RallyPointServer,
    pub route_id: String,
    pub player_id: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RallyPointServer {
    pub address4: Option<String>,
    pub address6: Option<String>,
    pub port: u16,
    pub desc: String,
}
