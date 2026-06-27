use async_graphql::scalar;
use enumset::EnumSetType;
use serde::{Deserialize, Serialize};
use strum_macros::EnumIter;
use typeshare::typeshare;

use crate::users::SbUserId;

pub mod api;
pub mod config;
pub mod matchmaker;
mod metrics;

/// A single player's entry in a match found message.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub struct MatchedPlayer {
    pub id: SbUserId,
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
    /// Overall match-quality score (in seconds of wait) the match formed at.
    pub quality: f32,
    /// Variance of the matched players' effective ratings (raw skill-spread input to `quality`).
    pub skill_variance: f32,
    /// Win probability of team A vs team B (0.5 == perfectly balanced).
    pub win_probability: f32,
    /// Effective team ratings used to compute `win_probability`.
    pub team_a_rating: f32,
    pub team_b_rating: f32,
    /// Estimated one-way latency (ms) of the match's worst pairwise link, computed from the
    /// players' rally-point server pings (raw latency input to `quality`).
    pub max_latency: f32,
}

/// Messages published to the Redis `"matchmaking"` channel.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[typeshare]
pub enum PublishedMatchmakingMessage {
    MatchFound(MatchFoundMessage),
}

/// Error codes the matchmaking HTTP API returns in the `code` field of its JSON error bodies. This
/// is the single source of truth for the set of codes; it's shared with the Node.js client via
/// typeshare so both sides agree on the exact strings (rather than the client re-declaring them).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
#[typeshare]
pub enum RsMatchmakerErrorCode {
    /// The player is already in the queue.
    AlreadyInQueue,
    /// The queue request listed no modes to search for.
    NoModesSelected,
    /// The player was not found in the queue (e.g. cancel/requeue for someone already removed).
    NotFound,
    /// A requeue ticket was malformed and couldn't be decoded.
    InvalidTicket,
    /// A requeue ticket was issued by a previous process — server-rs has restarted since.
    StaleTicket,
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
    #[serde(rename = "2v2bgh")]
    #[sqlx(rename = "2v2bgh")]
    Match2v2Bgh,
    #[serde(rename = "2v2hunters")]
    #[sqlx(rename = "2v2hunters")]
    Match2v2Hunters,
    #[serde(rename = "2v2fastest")]
    #[sqlx(rename = "2v2fastest")]
    Match2v2Fastest,
    #[serde(rename = "3v3bgh")]
    #[sqlx(rename = "3v3bgh")]
    Match3v3Bgh,
    #[serde(rename = "3v3hunters")]
    #[sqlx(rename = "3v3hunters")]
    Match3v3Hunters,
    #[serde(rename = "3v3fastest")]
    #[sqlx(rename = "3v3fastest")]
    Match3v3Fastest,
}

impl MatchmakingType {
    pub fn team_size(&self) -> usize {
        match self {
            MatchmakingType::Match1v1 => 1,
            MatchmakingType::Match1v1Fastest => 1,
            MatchmakingType::Match2v2 => 2,
            MatchmakingType::Match2v2Bgh => 2,
            MatchmakingType::Match2v2Hunters => 2,
            MatchmakingType::Match2v2Fastest => 2,
            MatchmakingType::Match3v3Bgh => 3,
            MatchmakingType::Match3v3Hunters => 3,
            MatchmakingType::Match3v3Fastest => 3,
        }
    }

    pub fn total_players(&self) -> usize {
        self.team_size() * 2
    }

    /// A stable, lowercase string identifier for this mode, matching its serde/DB name. Used as a
    /// Prometheus label value (`mode="2v2bgh"`), so it must stay in sync with the `#[serde(rename)]`
    /// attributes above.
    pub fn as_str(&self) -> &'static str {
        match self {
            MatchmakingType::Match1v1 => "1v1",
            MatchmakingType::Match1v1Fastest => "1v1fastest",
            MatchmakingType::Match2v2 => "2v2",
            MatchmakingType::Match2v2Bgh => "2v2bgh",
            MatchmakingType::Match2v2Hunters => "2v2hunters",
            MatchmakingType::Match2v2Fastest => "2v2fastest",
            MatchmakingType::Match3v3Bgh => "3v3bgh",
            MatchmakingType::Match3v3Hunters => "3v3hunters",
            MatchmakingType::Match3v3Fastest => "3v3fastest",
        }
    }
}

scalar!(
    MatchmakingType,
    "MatchmakingType",
    "All of the matchmaking types that we support. These values match the enum values used in the database."
);

#[cfg(test)]
mod tests {
    use strum::IntoEnumIterator;

    use super::MatchmakingType;

    #[test]
    fn as_str_matches_serde_rename() {
        // `as_str` is used as a Prometheus label and must stay identical to the serde/DB name. This
        // catches a new mode (or a rename) that updates the serde attribute but forgets `as_str`.
        for mode in MatchmakingType::iter() {
            let serde = serde_json::to_string(&mode).unwrap();
            let serde = serde.trim_matches('"');
            assert_eq!(
                mode.as_str(),
                serde,
                "as_str() drifted from the serde rename for {mode:?}"
            );
        }
    }
}
