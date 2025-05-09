use async_graphql::scalar;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// All of the matchmaking types that we support. These values match the enum values used in the
/// database.
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, sqlx::Type)]
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

scalar!(
    MatchmakingType,
    "MatchmakingType",
    "All of the matchmaking types that we support. These values match the enum values used in the database."
);
