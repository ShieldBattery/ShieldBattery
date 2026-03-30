use async_graphql::scalar;
use enumset::EnumSetType;
use serde::{Deserialize, Serialize};
use strum_macros::EnumIter;
use typeshare::typeshare;

pub mod api;
pub mod matchmaker;

/// A single player's entry in a match found message.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct MatchedPlayer {
    pub id: i32,
    /// Base64-encoded JSON QueueTicket. Node.js stores this and sends it back
    /// via POST /matchmaker/requeue if the match fails to start.
    pub ticket: String,
}

/// Data carried by the [`PublishedMatchmakingMessage::MatchFound`] event.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct MatchFoundMessage {
    pub mode: MatchmakingType,
    pub team_a: Vec<MatchedPlayer>,
    pub team_b: Vec<MatchedPlayer>,
    pub quality: f32,
}

/// Messages published to the Redis `"matchmaking"` channel.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[typeshare]
pub enum PublishedMatchmakingMessage {
    MatchFound(MatchFoundMessage),
}

/// All of the matchmaking types that we support. These values match the enum values used in the
/// database.
#[typeshare]
#[derive(Debug, Hash, EnumIter, EnumSetType, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "matchmaking_type")]
pub enum MatchmakingType {
    #[serde(rename = "1v1")]
    #[sqlx(rename = "1v1")]
    Match1v1,
    #[serde(rename = "1v1fastest")]
    #[sqlx(rename = "1v1fastest")]
    Match1v1Fastest,
    #[serde(rename = "2v2")]
    #[sqlx(rename = "2v2")]
    Match2v2,
}

impl MatchmakingType {
    pub fn team_size(&self) -> usize {
        match self {
            MatchmakingType::Match1v1 => 1,
            MatchmakingType::Match1v1Fastest => 1,
            MatchmakingType::Match2v2 => 2,
        }
    }

    pub fn total_players(&self) -> usize {
        self.team_size() * 2
    }
}

scalar!(
    MatchmakingType,
    "MatchmakingType",
    "All of the matchmaking types that we support. These values match the enum values used in the database."
);
