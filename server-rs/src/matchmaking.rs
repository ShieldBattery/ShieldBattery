use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// All of the matchmaking types that we support. These values match the enum values used in the
/// database.
#[typeshare]
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, sqlx::Type, async_graphql::Enum,
)]
#[sqlx(type_name = "matchmaking_type")]
pub enum MatchmakingType {
    #[graphql(name = "MATCH_1V1")]
    #[serde(rename = "1v1")]
    #[sqlx(rename = "1v1")]
    Match1v1,
    #[graphql(name = "MATCH_1V1_FASTEST")]
    #[serde(rename = "1v1fastest")]
    #[sqlx(rename = "1v1fastest")]
    Match1v1Fastest,
    #[graphql(name = "MATCH_2V2")]
    #[serde(rename = "2v2")]
    #[sqlx(rename = "2v2")]
    Match2v2,
}
