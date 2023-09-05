use crate::bw;
use serde::Serialize;
use serde_repr::Serialize_repr;

/// An ID used to identify a particular game client by "Storm" (e.g. mostly the networking
/// layer of SC:R).
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct StormPlayerId(pub u8);

/// An ID used to identify a particular player by the game code.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct BwPlayerId(pub u8);

impl BwPlayerId {
    /// Returns whether or not this player ID is for an observer.
    pub const fn is_observer(self) -> bool {
        self.0 >= 8
    }
}

/// Race of a player during a game (after random selection).
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize)]
pub enum AssignedRace {
    #[serde(rename = "z")]
    Zerg,
    #[serde(rename = "t")]
    Terran,
    #[serde(rename = "p")]
    Protoss,
}

impl TryFrom<u8> for AssignedRace {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            bw::RACE_ZERG => Ok(AssignedRace::Zerg),
            bw::RACE_TERRAN => Ok(AssignedRace::Terran),
            bw::RACE_PROTOSS => Ok(AssignedRace::Protoss),
            _ => Err(format!("Invalid assigned race: {value}")),
        }
    }
}

// NOTE(tec27): The name + descriptions here are derived experimentally rather than through
// reversing all the cases here, so they may not be 100% accurate.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum PlayerLoseType {
    /// The last player in the game with us was dropped. This generally implies that our results are
    /// probably "just as valid" as whatever results they report.
    TargetedDisconnect,
    /// All of the players in the game were dropped at once, which implies that we are probably at
    /// fault and the results from other players in the game are "more valid".
    MassDisconnect,
}

impl TryFrom<u8> for PlayerLoseType {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(PlayerLoseType::TargetedDisconnect),
            2 => Ok(PlayerLoseType::MassDisconnect),
            // NOTE(tec27): 0 indicates that none of these reasons apply, not really an error
            _ => Err(format!("Unknown player lose type: {value}")),
        }
    }
}

#[derive(Debug, Copy, Clone, Default, Eq, PartialEq, Hash, Serialize_repr)]
#[repr(u8)]
pub enum VictoryState {
    #[default]
    Playing = 0,
    Disconnected = 1,
    Defeat = 2,
    Victory = 3,
}

impl TryFrom<u8> for VictoryState {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(VictoryState::Playing),
            1 => Ok(VictoryState::Disconnected),
            2 => Ok(VictoryState::Defeat),
            3 => Ok(VictoryState::Victory),
            _ => Err(format!("Invalid victory state: {value}")),
        }
    }
}

#[derive(Debug, Copy, Clone, Default, Eq, PartialEq, Hash)]
pub enum AllianceState {
    #[default]
    Unallied = 0,
    Allied = 1,
    AlliedVictory = 2,
}

impl TryFrom<u8> for AllianceState {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(AllianceState::Unallied),
            1 => Ok(AllianceState::Allied),
            2 => Ok(AllianceState::AlliedVictory),
            _ => Err(format!("Invalid alliance state: {value}")),
        }
    }
}

#[derive(Debug, Copy, Clone)]
pub struct PlayerResult {
    pub victory_state: VictoryState,
    pub race: AssignedRace,
    pub alliances: [AllianceState; 8],
}

impl PlayerResult {
    pub fn alliance_with(&self, other: BwPlayerId) -> AllianceState {
        self.alliances[other.0 as usize]
    }
}

#[derive(Debug, Copy, Clone, Default)]
pub struct FinalNetworkStatus {
    /// True if the player was dropped for any reason (checksum mismatch, lag, etc)
    pub was_dropped: bool,
    /// True if the player left the game voluntarily
    pub has_quit: bool,
}
